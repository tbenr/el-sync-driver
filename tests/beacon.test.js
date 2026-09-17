const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { BeaconClient } = require('../beacon');

const roots = { head: '0x' + 'a1'.repeat(32), parent: '0x' + 'a2'.repeat(32) };
const payload = (n) => ({ block_hash: '0x' + n.repeat(32), parent_hash: '0x' + '00'.repeat(32) });

function denebBlock(root, parentRoot) {
    return {
        version: 'deneb',
        data: { message: { slot: '10', parent_root: parentRoot, body: { execution_payload: payload('b1'), blob_kzg_commitments: ['0x' + 'ab'.repeat(48)] } } },
    };
}
function electraBlock() {
    const b = denebBlock(roots.head, roots.parent);
    b.version = 'electra';
    b.data.message.body.execution_requests = { deposits: [], withdrawals: [], consolidations: [] };
    return b;
}
function gloasBlock(slot, parentRoot, blockHash) {
    return {
        version: 'gloas',
        data: { message: { slot, parent_root: parentRoot, body: { signed_execution_payload_bid: { message: { block_hash: blockHash, parent_block_hash: '0x' + 'ee'.repeat(32), blob_kzg_commitments: [] } } } } },
    };
}
function envelope(root, parentRoot, blockHash) {
    return { version: 'gloas', data: { message: { payload: { ...payload('00'), block_hash: blockHash }, execution_requests: { deposits: [], withdrawals: [], consolidations: [] }, beacon_block_root: root, parent_beacon_block_root: parentRoot } } };
}

let routes = {};
const server = http.createServer((req, res) => {
    const r = routes[req.url];
    if (!r) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{"code":404,"message":"not found"}'); }
    res.writeHead(r.status || 200, { 'Content-Type': 'application/json', ...(r.headers || {}) });
    res.end(JSON.stringify(r.body));
});
const ready = new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
after(() => server.close());

async function client() {
    await ready;
    return new BeaconClient(`http://127.0.0.1:${server.address().port}`);
}

test('getHeadBlock returns fork, block, and block root from the response header', async () => {
    routes = { '/eth/v2/beacon/blocks/head': { body: denebBlock(roots.head, roots.parent), headers: { 'Eth-Consensus-Block-Root': roots.head } } };
    const head = await (await client()).getHeadBlock();
    assert.equal(head.fork, 'deneb');
    assert.equal(head.root, roots.head);
    assert.equal(head.block.slot, '10');
});

test('getPayloadContext for pre-gloas forks reads the payload from the block body', async () => {
    routes = {};
    const head = { fork: 'electra', root: roots.head, block: electraBlock().data.message };
    const ctx = await (await client()).getPayloadContext(head);
    assert.equal(ctx.fork, 'electra');
    assert.equal(ctx.execution_payload.block_hash, '0x' + 'b1'.repeat(32));
    assert.equal(ctx.parent_beacon_block_root, roots.parent);
    assert.equal(ctx.blob_kzg_commitments.length, 1);
    assert.deepEqual(ctx.execution_requests.deposits, []);
    assert.equal(ctx.slot, '10');
});

test('getPayloadContext for gloas fetches the execution payload envelope for the head root', async () => {
    const hash = '0x' + 'c1'.repeat(32);
    routes = { [`/eth/v1/beacon/execution_payload_envelopes/${roots.head}`]: { body: envelope(roots.head, roots.parent, hash) } };
    const head = { fork: 'gloas', root: roots.head, block: gloasBlock('20', roots.parent, hash).data.message };
    const ctx = await (await client()).getPayloadContext(head);
    assert.equal(ctx.execution_payload.block_hash, hash);
    assert.equal(ctx.parent_beacon_block_root, roots.parent);
    assert.equal(ctx.slot, '20');
    assert.equal(ctx.fallback, false);
});

test('getPayloadContext for gloas falls back to the parent block when the head envelope is not yet available', async () => {
    const headHash = '0x' + 'c1'.repeat(32);
    const parentHash = '0x' + 'c2'.repeat(32);
    const grandParent = '0x' + 'a3'.repeat(32);
    routes = {
        [`/eth/v2/beacon/blocks/${roots.parent}`]: { body: gloasBlock('19', grandParent, parentHash), headers: { 'Eth-Consensus-Block-Root': roots.parent } },
        [`/eth/v1/beacon/execution_payload_envelopes/${roots.parent}`]: { body: envelope(roots.parent, grandParent, parentHash) },
    };
    const head = { fork: 'gloas', root: roots.head, block: gloasBlock('20', roots.parent, headHash).data.message };
    const ctx = await (await client()).getPayloadContext(head);
    assert.equal(ctx.execution_payload.block_hash, parentHash);
    assert.equal(ctx.slot, '19');
    assert.equal(ctx.fallback, true);
});

test('getPayloadContext for gloas returns null when neither head nor parent envelope is available', async () => {
    routes = { [`/eth/v2/beacon/blocks/${roots.parent}`]: { body: gloasBlock('19', '0x' + 'a3'.repeat(32), '0x' + 'c2'.repeat(32)) } };
    const head = { fork: 'gloas', root: roots.head, block: gloasBlock('20', roots.parent, '0x' + 'c1'.repeat(32)).data.message };
    const ctx = await (await client()).getPayloadContext(head);
    assert.equal(ctx, null);
});

test('getForkChoice returns the debug fork choice response', async () => {
    routes = { '/eth/v1/debug/fork_choice': { body: { justified_checkpoint: {}, finalized_checkpoint: {}, fork_choice_nodes: [] } } };
    const fc = await (await client()).getForkChoice();
    assert.deepEqual(fc.fork_choice_nodes, []);
});

test('getBlock resolves the root via /root when the block-root header is absent', async () => {
    routes = {
        '/eth/v2/beacon/blocks/head': { body: denebBlock(roots.head, roots.parent) },
        '/eth/v1/beacon/blocks/head/root': { body: { data: { root: roots.head } } },
    };
    const head = await (await client()).getHeadBlock();
    assert.equal(head.root, roots.head);
});

test('getPayloadContext for gloas ignores an envelope whose beacon_block_root does not match the block', async () => {
    const hash = '0x' + 'c1'.repeat(32);
    routes = {
        [`/eth/v1/beacon/execution_payload_envelopes/${roots.head}`]: { body: envelope('0x' + 'ff'.repeat(32), roots.parent, hash) },
        [`/eth/v2/beacon/blocks/${roots.parent}`]: { body: gloasBlock('19', '0x' + 'a3'.repeat(32), '0x' + 'c2'.repeat(32)) },
    };
    const head = { fork: 'gloas', root: roots.head, block: gloasBlock('20', roots.parent, hash).data.message };
    const ctx = await (await client()).getPayloadContext(head);
    assert.equal(ctx, null);
});

test('getPayloadContext for gloas falls back to envelope blob commitments when the bid has none', async () => {
    const hash = '0x' + 'c1'.repeat(32);
    const env = envelope(roots.head, roots.parent, hash);
    env.data.message.blob_kzg_commitments = ['0x' + 'ab'.repeat(48)];
    routes = { [`/eth/v1/beacon/execution_payload_envelopes/${roots.head}`]: { body: env } };
    const block = gloasBlock('20', roots.parent, hash).data.message;
    delete block.body.signed_execution_payload_bid.message.blob_kzg_commitments;
    const ctx = await (await client()).getPayloadContext({ fork: 'gloas', root: roots.head, block });
    assert.equal(ctx.blob_kzg_commitments.length, 1);
});

test('getPayloadContext fallback reports the parent fork and grandparent root', async () => {
    const parentHash = '0x' + 'c2'.repeat(32);
    const grandParent = '0x' + 'a3'.repeat(32);
    const parentBlock = denebBlock(roots.parent, grandParent);
    parentBlock.version = 'fulu';
    routes = { [`/eth/v2/beacon/blocks/${roots.parent}`]: { body: parentBlock, headers: { 'Eth-Consensus-Block-Root': roots.parent } } };
    const head = { fork: 'gloas', root: roots.head, block: gloasBlock('20', roots.parent, '0x' + 'c1'.repeat(32)).data.message };
    const ctx = await (await client()).getPayloadContext(head);
    assert.equal(ctx.fork, 'fulu');
    assert.equal(ctx.parent_beacon_block_root, grandParent);
    assert.equal(ctx.fallback, true);
});

test('getForkChoice returns null when the debug endpoint is not available', async () => {
    routes = {};
    assert.equal(await (await client()).getForkChoice(), null);
});

test('getJson throws a BeaconApiError with the status on non-404 failures', async () => {
    routes = { '/boom': { status: 500, body: { message: 'kaboom' } } };
    const { BeaconApiError } = require('../beacon');
    await assert.rejects((await client()).getJson('/boom'), err => err instanceof BeaconApiError && err.status === 500);
});
