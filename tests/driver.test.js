const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDriver } = require('../driver');
const { createLogger } = require('../logger');

const EL1 = 'http://el1:8551', EL2 = 'http://el2:8551';
const secrets = { [EL1]: Buffer.alloc(32, 1), [EL2]: Buffer.alloc(32, 2) };
const payload = {
    parent_hash: '0x' + '01'.repeat(32), fee_recipient: '0x' + '02'.repeat(20), state_root: '0x' + '03'.repeat(32),
    receipts_root: '0x' + '04'.repeat(32), logs_bloom: '0x' + '00'.repeat(256), prev_randao: '0x' + '05'.repeat(32),
    block_number: '7', gas_limit: '30000000', gas_used: '0', timestamp: '1700000000', extra_data: '0x',
    base_fee_per_gas: '7', block_hash: '0x' + 'b1'.repeat(32), transactions: [], withdrawals: [],
    blob_gas_used: '0', excess_blob_gas: '0',
};
const head = { fork: 'fulu', root: '0x' + 'a1'.repeat(32), block: { slot: '9', parent_root: '0x' + 'a0'.repeat(32) } };
const ctx = { fork: 'fulu', slot: '9', parent_beacon_block_root: head.block.parent_root, execution_payload: payload, blob_kzg_commitments: [], execution_requests: { deposits: [], withdrawals: [], consolidations: [] }, fallback: false };
const forkChoice = { justified_checkpoint: { root: head.root }, finalized_checkpoint: { root: head.root }, fork_choice_nodes: [{ block_root: head.root, parent_root: head.block.parent_root, execution_block_hash: payload.block_hash }] };

function setup({ beacon = {}, rpcResult } = {}) {
    const calls = [];
    const lines = [];
    const rpc = async (endpoint, call, token) => {
        calls.push({ endpoint, method: call.method, token });
        if (rpcResult) return rpcResult(call);
        if (call.method.startsWith('engine_newPayload')) return { ok: true, result: { status: 'VALID' }, ms: 1 };
        return { ok: true, result: { payloadStatus: { status: 'VALID' } }, ms: 1 };
    };
    const driver = createDriver({
        config: { ElJsonrpcEndpoints: [{ endpoint: EL1 }, { endpoint: EL2 }] },
        secrets,
        beacon: { getHeadBlock: async () => head, getPayloadContext: async () => ctx, getForkChoice: async () => forkChoice, ...beacon },
        rpc,
        log: createLogger('t', { level: 'debug', write: l => lines.push(l), color: false }),
    });
    return { driver, calls, lines };
}

test('pollOnce sends newPayload then forkchoiceUpdated to every EL and logs a summary', async () => {
    const { driver, calls, lines } = setup();
    await driver.pollOnce();
    assert.deepEqual(calls.map(c => [c.endpoint, c.method]), [
        [EL1, 'engine_newPayloadV4'], [EL2, 'engine_newPayloadV4'],
        [EL1, 'engine_forkchoiceUpdatedV3'], [EL2, 'engine_forkchoiceUpdatedV3'],
    ]);
    const summary = lines.find(l => l.includes('slot 9 (fulu)'));
    assert.match(summary, /INFO/);
    assert.match(summary, /el1:8551: NP=VALID\(1ms\) FCU=VALID\(1ms\) \| el2:8551: NP=VALID/);
});

test('pollOnce signs a fresh JWT per request with the endpoint secret', async () => {
    const { driver, calls } = setup();
    const before = Math.floor(Date.now() / 1000);
    await driver.pollOnce();
    const decode = t => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());
    assert.ok(decode(calls[0].token).iat >= before);
    assert.notEqual(calls[0].token, calls[1].token, 'different secrets yield different tokens');
});

test('pollOnce sends only forkchoiceUpdated when the head payload is unchanged', async () => {
    const { driver, calls, lines } = setup();
    await driver.pollOnce();
    calls.length = 0;
    lines.length = 0;
    await driver.pollOnce();
    assert.deepEqual(calls.map(c => c.method), ['engine_forkchoiceUpdatedV3', 'engine_forkchoiceUpdatedV3']);
    assert.ok(lines.some(l => /DEBUG .*head unchanged/.test(l)));
    assert.ok(!lines.some(l => /INFO .*slot 9/.test(l)), 'no info summary for an unchanged head');
});

test('pollOnce warns and skips forkchoiceUpdated when debug/fork_choice is unavailable', async () => {
    const { driver, calls, lines } = setup({ beacon: { getForkChoice: async () => null } });
    await driver.pollOnce();
    assert.deepEqual(calls.map(c => c.method), ['engine_newPayloadV4', 'engine_newPayloadV4']);
    assert.ok(lines.some(l => /WARN .*fork_choice/.test(l)));
});

test('pollOnce tolerates a null JSON-RPC result and reports the status as unknown', async () => {
    const { driver, lines } = setup({ rpcResult: () => ({ ok: true, result: null, ms: 2 }) });
    await driver.pollOnce();
    assert.ok(lines.some(l => /NP=\?\(2ms\) FCU=\?\(2ms\)/.test(l)));
});

test('pollOnce marks failed calls as ERR and logs the error', async () => {
    const { driver, lines } = setup({ rpcResult: () => ({ ok: false, error: { code: -32602, message: 'Invalid params' }, ms: 3 }) });
    await driver.pollOnce();
    assert.ok(lines.some(l => /WARN .*-32602 Invalid params/.test(l)));
    assert.ok(lines.some(l => /NP=ERR\(3ms\)/.test(l)));
});

test('pollOnce logs an error and sends nothing for an unsupported fork', async () => {
    const { driver, calls, lines } = setup({ beacon: { getHeadBlock: async () => ({ ...head, fork: 'bellatrix' }) } });
    await driver.pollOnce();
    assert.equal(calls.length, 0);
    assert.ok(lines.some(l => /ERROR .*bellatrix.*unsupported/.test(l)));
});

test('pollOnce skips the round when no payload is available yet', async () => {
    const { driver, calls, lines } = setup({ beacon: { getPayloadContext: async () => null } });
    await driver.pollOnce();
    assert.equal(calls.length, 0);
    assert.ok(lines.some(l => /INFO .*not revealed yet/.test(l)));
});

test('poll does not overlap and logs the cause of a failure', async () => {
    let release;
    const gate = new Promise(r => release = r);
    const { driver, lines } = setup({ beacon: { getHeadBlock: () => gate } });
    const first = driver.poll();
    await driver.poll();
    assert.ok(lines.some(l => /WARN .*still running/.test(l)));
    release(Promise.reject(new Error('fetch failed', { cause: new Error('ECONNREFUSED') })));
    await first;
    assert.ok(lines.some(l => /ERROR .*poll failed: fetch failed \(ECONNREFUSED\)/.test(l)));
});
