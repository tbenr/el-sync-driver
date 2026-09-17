const {
    FORK_ORDER,
    forkAtLeast,
    kzgCommitmentToVersionedHash,
    encodeExecutionRequests,
    payloadToEngineFormat,
} = require('./utils');

const SUPPORTED_FORKS = FORK_ORDER;

function assertSupported(fork) {
    if (!SUPPORTED_FORKS.includes(fork)) {
        throw new Error(`unsupported fork: ${fork}`);
    }
}

// Engine API method per fork. Electra and Fulu share V4; Gloas (Amsterdam) moves to V5.
function newPayloadMethod(fork) {
    if (forkAtLeast(fork, 'gloas')) return 'engine_newPayloadV5';
    if (forkAtLeast(fork, 'electra')) return 'engine_newPayloadV4';
    if (forkAtLeast(fork, 'deneb')) return 'engine_newPayloadV3';
    return 'engine_newPayloadV2';
}

function forkchoiceUpdatedMethod(fork) {
    if (forkAtLeast(fork, 'gloas')) return 'engine_forkchoiceUpdatedV4';
    if (forkAtLeast(fork, 'deneb')) return 'engine_forkchoiceUpdatedV3';
    return 'engine_forkchoiceUpdatedV2';
}

/**
 * @param {object} ctx
 * @param {string} ctx.fork
 * @param {object} ctx.execution_payload            beacon API execution payload
 * @param {string[]} [ctx.blob_kzg_commitments]      deneb+
 * @param {string} [ctx.parent_beacon_block_root]    deneb+
 * @param {object} [ctx.execution_requests]          electra+ ({deposits, withdrawals, consolidations})
 */
function prepareNewPayloadCall({ fork, execution_payload, blob_kzg_commitments, parent_beacon_block_root, execution_requests }) {
    assertSupported(fork);

    const params = [payloadToEngineFormat(execution_payload, fork)];

    if (forkAtLeast(fork, 'deneb')) {
        params.push((blob_kzg_commitments || []).map(kzgCommitmentToVersionedHash));
        params.push(parent_beacon_block_root);
    }
    if (forkAtLeast(fork, 'electra')) {
        params.push(encodeExecutionRequests(execution_requests || {}));
    }

    return { method: newPayloadMethod(fork), params };
}

function prepareForkchoiceUpdatedCall(fork_choice, headBlockHash, fork) {
    assertSupported(fork);

    const nodes = fork_choice.fork_choice_nodes;
    const state = {
        headBlockHash,
        safeBlockHash: executionBlockHashLookup(fork_choice.justified_checkpoint.root, nodes),
        finalizedBlockHash: executionBlockHashLookup(fork_choice.finalized_checkpoint.root, nodes),
    };

    const params = [state];
    if (forkAtLeast(fork, 'gloas')) {
        // payloadAttributes, custodyColumns
        params.push(null, null);
    }

    return { method: forkchoiceUpdatedMethod(fork), params };
}

// Resolves a beacon block root to the execution block hash the EL should be told about.
// In Gloas (ePBS) a block may be canonical while its payload was never revealed
// (`payload_status` != "full"); in that case the EL-visible hash is the parent's.
function executionBlockHashLookup(beaconBlockRoot, forkChoiceNodes) {
    let node = forkChoiceNodes.find(n => n.block_root === beaconBlockRoot);

    // Bounded by the number of nodes so a malformed parent cycle cannot spin forever.
    for (let hops = 0; node && node.payload_status !== undefined && node.payload_status !== 'full'; hops++) {
        if (hops >= forkChoiceNodes.length) return null;
        node = forkChoiceNodes.find(n => n.block_root === node.parent_root);
    }

    return node ? node.execution_block_hash : null;
}

module.exports = {
    SUPPORTED_FORKS,
    forkAtLeast,
    prepareNewPayloadCall,
    prepareForkchoiceUpdatedCall,
};
