const { toQuantity, calculateWithdrawals, kzgCommitmentToVersionedHash } = require('./utils');



function prepareNewPayloadCall(beacon_block, fork) {
    const execution_payload = beacon_block.body.execution_payload;

    switch (fork) {
        case 'capella':
            return {
                method: 'engine_newPayloadV2',
                params: [
                    {
                        parentHash: execution_payload.parent_hash,
                        feeRecipient: execution_payload.fee_recipient,
                        stateRoot: execution_payload.state_root,
                        receiptsRoot: execution_payload.receipts_root,
                        logsBloom: execution_payload.logs_bloom,
                        prevRandao: execution_payload.prev_randao,
                        blockNumber: toQuantity(execution_payload.block_number),
                        gasLimit: toQuantity(execution_payload.gas_limit),
                        gasUsed: toQuantity(execution_payload.gas_used),
                        timestamp: toQuantity(execution_payload.timestamp),
                        extraData: execution_payload.extra_data,
                        baseFeePerGas: toQuantity(execution_payload.base_fee_per_gas),
                        blockHash: execution_payload.block_hash,
                        transactions: execution_payload.transactions,
                        withdrawals: calculateWithdrawals(execution_payload.withdrawals)
                    }
                ]
            };
        case 'deneb':
            const blob_kzg_commitments = beacon_block.body.blob_kzg_commitments;

            return {
                method: 'engine_newPayloadV3',
                params: [
                    {
                        parentHash: execution_payload.parent_hash,
                        feeRecipient: execution_payload.fee_recipient,
                        stateRoot: execution_payload.state_root,
                        receiptsRoot: execution_payload.receipts_root,
                        logsBloom: execution_payload.logs_bloom,
                        prevRandao: execution_payload.prev_randao,
                        blockNumber: toQuantity(execution_payload.block_number),
                        gasLimit: toQuantity(execution_payload.gas_limit),
                        gasUsed: toQuantity(execution_payload.gas_used),
                        timestamp: toQuantity(execution_payload.timestamp),
                        extraData: execution_payload.extra_data,
                        baseFeePerGas: toQuantity(execution_payload.base_fee_per_gas),
                        blockHash: execution_payload.block_hash,
                        transactions: execution_payload.transactions,
                        withdrawals: calculateWithdrawals(execution_payload.withdrawals),
                        blobGasUsed: toQuantity(execution_payload.blob_gas_used),
                        excessBlobGas: toQuantity(execution_payload.excess_blob_gas)
                    },
                    blob_kzg_commitments.map(kzgCommitmentToVersionedHash),
                    beacon_block.parent_root
                ]
            };
    }
}

function prepareForkchoiceUpdatedCall(fork_choice, headBlockHash, fork) {
    const justifiedCheckpointRoot = fork_choice.justified_checkpoint.root;
    const finalizedCheckpointRoot = fork_choice.finalized_checkpoint.root;
    const forkChoiceNodes = fork_choice.fork_choice_nodes;

    const safeBlockHash = executionBlockHashLookup(justifiedCheckpointRoot, forkChoiceNodes);
    const finalizedBlockHash = executionBlockHashLookup(finalizedCheckpointRoot, forkChoiceNodes);

    switch (fork) {
        case 'capella':
            return {
                method: 'engine_forkchoiceUpdatedV2',
                params: [
                    {
                        headBlockHash,
                        safeBlockHash,
                        finalizedBlockHash,
                    }
                ]
            };
        case 'deneb':
            return {
                method: 'engine_forkchoiceUpdatedV3',
                params: [
                    {
                        headBlockHash,
                        safeBlockHash,
                        finalizedBlockHash,
                    }
                ]
            };
    }
}

function executionBlockHashLookup(beaconBlockRoot, forkChoiceNodes) {
    const node = forkChoiceNodes.find(node => node.block_root === beaconBlockRoot);

    if (node) {
        return node.execution_block_hash;
    }

    return null;
}

module.exports = {
    prepareNewPayloadCall,
    prepareForkchoiceUpdatedCall
};