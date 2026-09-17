const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
    toQuantity,
    kzgCommitmentToVersionedHash,
    calculateWithdrawals,
    encodeExecutionRequests,
    payloadToEngineFormat,
} = require('../utils');

test('toQuantity encodes decimal strings as minimal hex', () => {
    assert.equal(toQuantity('0'), '0x0');
    assert.equal(toQuantity('255'), '0xff');
    assert.equal(toQuantity('18446744073709551615'), '0xffffffffffffffff');
});

test('kzgCommitmentToVersionedHash prefixes 0x01 and drops the first sha256 byte', () => {
    const commitment = '0x' + 'ab'.repeat(48);
    const sha = crypto.createHash('sha256').update(Buffer.from('ab'.repeat(48), 'hex')).digest('hex');
    assert.equal(kzgCommitmentToVersionedHash(commitment), '0x01' + sha.slice(2));
});

test('kzgCommitmentToVersionedHash accepts commitments without 0x prefix', () => {
    const withPrefix = kzgCommitmentToVersionedHash('0x' + 'cd'.repeat(48));
    const withoutPrefix = kzgCommitmentToVersionedHash('cd'.repeat(48));
    assert.equal(withoutPrefix, withPrefix);
});

test('calculateWithdrawals maps beacon withdrawals to engine format', () => {
    const out = calculateWithdrawals([
        { index: '1', validator_index: '2', address: '0x' + '11'.repeat(20), amount: '1000' },
    ]);
    assert.deepEqual(out, [
        { index: '0x1', validatorIndex: '0x2', address: '0x' + '11'.repeat(20), amount: '0x3e8' },
    ]);
});

const deposit = {
    pubkey: '0x' + 'aa'.repeat(48),
    withdrawal_credentials: '0x' + 'bb'.repeat(32),
    amount: '1',
    signature: '0x' + 'cc'.repeat(96),
    index: '256',
};
const withdrawal = {
    source_address: '0x' + 'dd'.repeat(20),
    validator_pubkey: '0x' + 'ee'.repeat(48),
    amount: '32000000000',
};
const consolidation = {
    source_address: '0x' + 'dd'.repeat(20),
    source_pubkey: '0x' + 'ee'.repeat(48),
    target_pubkey: '0x' + 'ff'.repeat(48),
};

test('encodeExecutionRequests returns empty list when all request lists are empty', () => {
    assert.deepEqual(encodeExecutionRequests({ deposits: [], withdrawals: [], consolidations: [] }), []);
});

test('encodeExecutionRequests encodes a deposit request as type 0x00 + 192 bytes', () => {
    const [encoded] = encodeExecutionRequests({ deposits: [deposit], withdrawals: [], consolidations: [] });
    assert.equal(encoded.slice(0, 4), '0x00');
    assert.equal((encoded.length - 2) / 2, 1 + 192);
    const bytes = encoded.slice(4);
    assert.equal(bytes.slice(0, 96), 'aa'.repeat(48));
    assert.equal(bytes.slice(96, 160), 'bb'.repeat(32));
    assert.equal(bytes.slice(160, 176), '0100000000000000', 'amount is uint64 little-endian');
    assert.equal(bytes.slice(176, 368), 'cc'.repeat(96));
    assert.equal(bytes.slice(368, 384), '0001000000000000', 'index 256 is uint64 little-endian');
});

test('encodeExecutionRequests encodes withdrawal (76 B) and consolidation (116 B) requests in type order', () => {
    const out = encodeExecutionRequests({ deposits: [], withdrawals: [withdrawal], consolidations: [consolidation] });
    assert.equal(out.length, 2);
    assert.equal(out[0].slice(0, 4), '0x01');
    assert.equal((out[0].length - 2) / 2, 1 + 76);
    assert.equal(out[1].slice(0, 4), '0x02');
    assert.equal((out[1].length - 2) / 2, 1 + 116);
});

test('encodeExecutionRequests concatenates multiple requests of the same type', () => {
    const [encoded] = encodeExecutionRequests({ deposits: [deposit, deposit], withdrawals: [], consolidations: [] });
    assert.equal((encoded.length - 2) / 2, 1 + 2 * 192);
});

const basePayload = {
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
    transactions: ['0x01'],
    withdrawals: [],
};

test('payloadToEngineFormat for capella has no blob or gloas fields', () => {
    const out = payloadToEngineFormat(basePayload, 'capella');
    assert.equal(out.blockNumber, '0xa');
    assert.equal(out.parentHash, basePayload.parent_hash);
    assert.deepEqual(out.withdrawals, []);
    assert.equal('blobGasUsed' in out, false);
    assert.equal('blockAccessList' in out, false);
});

test('payloadToEngineFormat for deneb through fulu adds blob gas fields', () => {
    const payload = { ...basePayload, blob_gas_used: '1', excess_blob_gas: '2' };
    for (const fork of ['deneb', 'electra', 'fulu']) {
        const out = payloadToEngineFormat(payload, fork);
        assert.equal(out.blobGasUsed, '0x1', fork);
        assert.equal(out.excessBlobGas, '0x2', fork);
        assert.equal('blockAccessList' in out, false, fork);
    }
});

test('payloadToEngineFormat for gloas adds blockAccessList and slotNumber', () => {
    const payload = { ...basePayload, blob_gas_used: '1', excess_blob_gas: '2', block_access_list: '0xc0', slot_number: '42' };
    const out = payloadToEngineFormat(payload, 'gloas');
    assert.equal(out.blockAccessList, '0xc0');
    assert.equal(out.slotNumber, '0x2a');
    assert.equal(out.blobGasUsed, '0x1');
});
