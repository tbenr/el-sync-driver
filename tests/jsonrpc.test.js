const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { doJsonrpcCall } = require('../jsonrpc');

let lastRequest;
let responder = () => ({ result: 'ok' });
const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
        lastRequest = { headers: req.headers, body: JSON.parse(body) };
        const r = responder();
        if (r.hang) return;
        res.writeHead(r.status || 200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: lastRequest.body.id, ...r }));
    });
});
const ready = new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
after(() => server.close());

async function endpoint() {
    await ready;
    return `http://127.0.0.1:${server.address().port}`;
}

test('doJsonrpcCall sends a JSON-RPC 2.0 request with a bearer token and returns the result', async () => {
    responder = () => ({ result: { status: 'VALID' } });
    const out = await doJsonrpcCall(await endpoint(), { method: 'engine_test', params: [1] }, 'tok');
    assert.equal(lastRequest.headers.authorization, 'Bearer tok');
    assert.equal(lastRequest.body.jsonrpc, '2.0');
    assert.equal(lastRequest.body.method, 'engine_test');
    assert.deepEqual(lastRequest.body.params, [1]);
    assert.equal(typeof lastRequest.body.id, 'number');
    assert.equal(out.ok, true);
    assert.deepEqual(out.result, { status: 'VALID' });
    assert.equal(typeof out.ms, 'number');
});

test('doJsonrpcCall increments the request id per call', async () => {
    responder = () => ({ result: null });
    await doJsonrpcCall(await endpoint(), { method: 'a', params: [] }, 'tok');
    const first = lastRequest.body.id;
    await doJsonrpcCall(await endpoint(), { method: 'a', params: [] }, 'tok');
    assert.equal(lastRequest.body.id, first + 1);
});

test('doJsonrpcCall returns the JSON-RPC error object on error responses', async () => {
    responder = () => ({ error: { code: -32602, message: 'Invalid params' } });
    const out = await doJsonrpcCall(await endpoint(), { method: 'a', params: [] }, 'tok');
    assert.equal(out.ok, false);
    assert.deepEqual(out.error, { code: -32602, message: 'Invalid params' });
});

test('doJsonrpcCall reports non-200 HTTP responses as errors', async () => {
    responder = () => ({ status: 401, error: { code: 1, message: 'unauthorized' } });
    const out = await doJsonrpcCall(await endpoint(), { method: 'a', params: [] }, 'tok');
    assert.equal(out.ok, false);
    assert.match(out.error.message, /401/);
});

test('doJsonrpcCall reports connection failures without throwing', async () => {
    const out = await doJsonrpcCall('http://127.0.0.1:1', { method: 'a', params: [] }, 'tok');
    assert.equal(out.ok, false);
    assert.equal(typeof out.error.message, 'string');
});

test('doJsonrpcCall times out', async () => {
    responder = () => ({ hang: true });
    const out = await doJsonrpcCall(await endpoint(), { method: 'a', params: [] }, 'tok', { timeoutMs: 50 });
    assert.equal(out.ok, false);
    assert.match(out.error.message, /timed? ?out/i);
});

test('doJsonrpcCall includes the response body in non-200 errors', async () => {
    responder = () => ({ status: 401, error: { code: 1, message: 'token is expired' } });
    const out = await doJsonrpcCall(await endpoint(), { method: 'a', params: [] }, 'tok');
    assert.match(out.error.message, /token is expired/);
});
