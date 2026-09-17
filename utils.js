const crypto = require('node:crypto');

function stripHex(hex) {
    return hex.startsWith('0x') ? hex.slice(2) : hex;
}

function hexToBytes(hex) {
    return Buffer.from(stripHex(hex), 'hex');
}

function u64le(value) {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(BigInt(value));
    return buf;
}

function calculateSHA256FromHex(hexData) {
    return crypto.createHash('sha256').update(hexToBytes(hexData)).digest('hex');
}

// EIP-4844: versioned hash = 0x01 || sha256(commitment)[1:]
function kzgCommitmentToVersionedHash(kzgCommitment) {
    return '0x01' + calculateSHA256FromHex(kzgCommitment).substring(2);
}

function toQuantity(value) {
    return '0x' + BigInt(value).toString(16);
}

function calculateWithdrawals(beaconBlockWithdrawals) {
    return beaconBlockWithdrawals.map(withdrawal => ({
        index: toQuantity(withdrawal.index),
        validatorIndex: toQuantity(withdrawal.validator_index),
        address: withdrawal.address,
        amount: toQuantity(withdrawal.amount),
    }));
}

// SSZ serialization of the fixed-size request containers (EIP-7685 / EIP-7251 / EIP-7002 / EIP-6110).
// Since every field is fixed-size, an SSZ list of them is a plain concatenation.
const REQUEST_ENCODERS = [
    // 0x00 DepositRequest
    { type: 0x00, key: 'deposits', encode: r => Buffer.concat([hexToBytes(r.pubkey), hexToBytes(r.withdrawal_credentials), u64le(r.amount), hexToBytes(r.signature), u64le(r.index)]) },
    // 0x01 WithdrawalRequest
    { type: 0x01, key: 'withdrawals', encode: r => Buffer.concat([hexToBytes(r.source_address), hexToBytes(r.validator_pubkey), u64le(r.amount)]) },
    // 0x02 ConsolidationRequest
    { type: 0x02, key: 'consolidations', encode: r => Buffer.concat([hexToBytes(r.source_address), hexToBytes(r.source_pubkey), hexToBytes(r.target_pubkey)]) },
];

// Returns the engine API `executionRequests` list: `type || ssz(list)`, ordered by type, empty lists omitted.
function encodeExecutionRequests(executionRequests) {
    const out = [];
    for (const { type, key, encode } of REQUEST_ENCODERS) {
        const items = executionRequests[key] || [];
        if (items.length === 0) continue;
        const body = Buffer.concat(items.map(encode));
        out.push('0x' + Buffer.concat([Buffer.from([type]), body]).toString('hex'));
    }
    return out;
}

const FORK_ORDER = ['capella', 'deneb', 'electra', 'fulu', 'gloas'];

function forkAtLeast(fork, target) {
    return FORK_ORDER.indexOf(fork) >= FORK_ORDER.indexOf(target);
}

// Maps a beacon API execution payload (snake_case, decimal strings) to the engine API
// ExecutionPayloadV2/V3/V4 shape for the given fork.
function payloadToEngineFormat(execution_payload, fork) {
    const payload = {
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
    };
    if (forkAtLeast(fork, 'deneb')) {
        payload.blobGasUsed = toQuantity(execution_payload.blob_gas_used);
        payload.excessBlobGas = toQuantity(execution_payload.excess_blob_gas);
    }
    if (forkAtLeast(fork, 'gloas')) {
        payload.blockAccessList = execution_payload.block_access_list;
        payload.slotNumber = toQuantity(execution_payload.slot_number);
    }
    return payload;
}

function shortHash(hash) {
    return hash ? `${hash.slice(0, 8)}…${hash.slice(-4)}` : String(hash);
}

module.exports = {
    FORK_ORDER,
    forkAtLeast,
    kzgCommitmentToVersionedHash,
    toQuantity,
    calculateWithdrawals,
    encodeExecutionRequests,
    payloadToEngineFormat,
    shortHash,
};
