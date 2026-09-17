const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    SUPPORTED_FORKS,
    forkAtLeast,
    prepareNewPayloadCall,
    prepareForkchoiceUpdatedCall,
} = require('../engineApi');

const payload = {
    parent_hash: '0x' + '01'.repeat(32),
    fee_recipient: '0x' + '02'.repeat(20),
    state_root: '0x' + '03'.repeat(32),
    receipts_root: '0x' + '04'.repeat(32),
    logs_bloom: '0x' + '00'.repeat(256),
    prev_randao: '0x' + '05'.repeat(32),
    block_number: '10',
    gas_limit: '30000000',
    gas_used: '21000',
    timestamp: '1700000000',
    extra_data: '0x',
    base_fee_per_gas: '7',
    block_hash: '0x' + '06'.repeat(32),
    transactions: [],
    withdrawals: [],
    blob_gas_used: '0',
    excess_blob_gas: '0',
    block_access_list: '0xc0',
    slot_number: '5',
};
const parentRoot = '0x' + '07'.repeat(32);
const commitments = ['0x' + 'ab'.repeat(48)];
const requests = { deposits: [], withdrawals: [], consolidations: [] };

test('SUPPORTED_FORKS lists capella through gloas in order', () => {
    assert.deepEqual(SUPPORTED_FORKS, ['capella', 'deneb', 'electra', 'fulu', 'gloas']);
});

test('forkAtLeast compares forks by activation order', () => {
    assert.equal(forkAtLeast('fulu', 'deneb'), true);
    assert.equal(forkAtLeast('deneb', 'deneb'), true);
    assert.equal(forkAtLeast('capella', 'deneb'), false);
});

test('capella uses engine_newPayloadV2 with only the payload', () => {
    const call = prepareNewPayloadCall({ fork: 'capella', execution_payload: payload });
    assert.equal(call.method, 'engine_newPayloadV2');
    assert.equal(call.params.length, 1);
    assert.equal(call.params[0].blockHash, payload.block_hash);
});

test('deneb uses engine_newPayloadV3 with versioned hashes and parent beacon block root', () => {
    const call = prepareNewPayloadCall({
        fork: 'deneb', execution_payload: payload, blob_kzg_commitments: commitments, parent_beacon_block_root: parentRoot,
    });
    assert.equal(call.method, 'engine_newPayloadV3');
    assert.equal(call.params.length, 3);
    assert.equal(call.params[1].length, 1);
    assert.match(call.params[1][0], /^0x01[0-9a-f]{62}$/);
    assert.equal(call.params[2], parentRoot);
});

test('electra and fulu use engine_newPayloadV4 with encoded execution requests', () => {
    for (const fork of ['electra', 'fulu']) {
        const call = prepareNewPayloadCall({
            fork, execution_payload: payload, blob_kzg_commitments: commitments,
            parent_beacon_block_root: parentRoot, execution_requests: requests,
        });
        assert.equal(call.method, 'engine_newPayloadV4', fork);
        assert.equal(call.params.length, 4, fork);
        assert.deepEqual(call.params[3], [], fork);
        assert.equal('blockAccessList' in call.params[0], false, fork);
    }
});

test('gloas uses engine_newPayloadV5 with a V4 payload', () => {
    const call = prepareNewPayloadCall({
        fork: 'gloas', execution_payload: payload, blob_kzg_commitments: commitments,
        parent_beacon_block_root: parentRoot, execution_requests: requests,
    });
    assert.equal(call.method, 'engine_newPayloadV5');
    assert.equal(call.params.length, 4);
    assert.equal(call.params[0].blockAccessList, '0xc0');
    assert.equal(call.params[0].slotNumber, '0x5');
});

test('prepareNewPayloadCall throws on an unsupported fork', () => {
    assert.throws(() => prepareNewPayloadCall({ fork: 'bellatrix', execution_payload: payload }), /unsupported/i);
});

const roots = { head: '0x' + 'a1'.repeat(32), justified: '0x' + 'a2'.repeat(32), finalized: '0x' + 'a3'.repeat(32) };
const hashes = { head: '0x' + 'b1'.repeat(32), justified: '0x' + 'b2'.repeat(32), finalized: '0x' + 'b3'.repeat(32), finalizedParent: '0x' + 'b4'.repeat(32) };
const forkChoice = {
    justified_checkpoint: { epoch: '2', root: roots.justified },
    finalized_checkpoint: { epoch: '1', root: roots.finalized },
    fork_choice_nodes: [
        { slot: '30', block_root: '0x' + 'a4'.repeat(32), parent_root: '0x' + '00'.repeat(32), execution_block_hash: hashes.finalizedParent },
        { slot: '32', block_root: roots.finalized, parent_root: '0x' + 'a4'.repeat(32), execution_block_hash: hashes.finalized },
        { slot: '64', block_root: roots.justified, parent_root: roots.finalized, execution_block_hash: hashes.justified },
        { slot: '70', block_root: roots.head, parent_root: roots.justified, execution_block_hash: hashes.head },
    ],
};

test('forkchoiceUpdated version follows the fork', () => {
    const expected = { capella: 'engine_forkchoiceUpdatedV2', deneb: 'engine_forkchoiceUpdatedV3', electra: 'engine_forkchoiceUpdatedV3', fulu: 'engine_forkchoiceUpdatedV3', gloas: 'engine_forkchoiceUpdatedV4' };
    for (const [fork, method] of Object.entries(expected)) {
        assert.equal(prepareForkchoiceUpdatedCall(forkChoice, hashes.head, fork).method, method, fork);
    }
});

test('forkchoiceUpdated resolves safe and finalized hashes from fork choice nodes', () => {
    const call = prepareForkchoiceUpdatedCall(forkChoice, hashes.head, 'deneb');
    assert.deepEqual(call.params, [{ headBlockHash: hashes.head, safeBlockHash: hashes.justified, finalizedBlockHash: hashes.finalized }]);
});

test('forkchoiceUpdated uses null when a checkpoint root is not in the fork choice nodes', () => {
    const fc = { ...forkChoice, finalized_checkpoint: { epoch: '0', root: '0x' + 'ff'.repeat(32) } };
    const call = prepareForkchoiceUpdatedCall(fc, hashes.head, 'deneb');
    assert.equal(call.params[0].finalizedBlockHash, null);
});

test('gloas forkchoiceUpdatedV4 passes null payload attributes and custody columns', () => {
    const call = prepareForkchoiceUpdatedCall(forkChoice, hashes.head, 'gloas');
    assert.equal(call.params.length, 3);
    assert.equal(call.params[1], null);
    assert.equal(call.params[2], null);
});

test('gloas uses the parent execution hash when a checkpoint block payload is not full', () => {
    const nodes = forkChoice.fork_choice_nodes.map(n => n.block_root === roots.finalized ? { ...n, payload_status: 'empty' } : { ...n, payload_status: 'full' });
    const call = prepareForkchoiceUpdatedCall({ ...forkChoice, fork_choice_nodes: nodes }, hashes.head, 'gloas');
    assert.equal(call.params[0].finalizedBlockHash, hashes.finalizedParent);
    assert.equal(call.params[0].safeBlockHash, hashes.justified);
});

test('electra passes non-empty execution requests through to params', () => {
    const deposit = { pubkey: '0x' + 'aa'.repeat(48), withdrawal_credentials: '0x' + 'bb'.repeat(32), amount: '1', signature: '0x' + 'cc'.repeat(96), index: '0' };
    const call = prepareNewPayloadCall({
        fork: 'electra', execution_payload: payload, blob_kzg_commitments: [],
        parent_beacon_block_root: parentRoot, execution_requests: { deposits: [deposit], withdrawals: [], consolidations: [] },
    });
    assert.equal(call.params[3].length, 1);
    assert.equal(call.params[3][0].slice(0, 4), '0x00');
});

test('gloas payload-status walk terminates on a malformed parent cycle', () => {
    const a = '0x' + 'd1'.repeat(32), b = '0x' + 'd2'.repeat(32);
    const fc = {
        justified_checkpoint: { epoch: '1', root: a },
        finalized_checkpoint: { epoch: '1', root: a },
        fork_choice_nodes: [
            { slot: '1', block_root: a, parent_root: b, execution_block_hash: '0x01', payload_status: 'empty' },
            { slot: '2', block_root: b, parent_root: a, execution_block_hash: '0x02', payload_status: 'pending' },
        ],
    };
    const call = prepareForkchoiceUpdatedCall(fc, hashes.head, 'gloas');
    assert.equal(call.params[0].finalizedBlockHash, null);
});
