const { test } = require('node:test');
const assert = require('node:assert/strict');
const { signHs256 } = require('../jwt');

const secret = Buffer.from('aa'.repeat(32), 'hex');

test('signHs256 produces a three-segment token with an HS256 header', () => {
    const token = signHs256(secret, { iat: 1700000000 });
    const parts = token.split('.');
    assert.equal(parts.length, 3);
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    assert.deepEqual(header, { alg: 'HS256', typ: 'JWT' });
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    assert.deepEqual(payload, { iat: 1700000000 });
});

test('signHs256 matches a pinned vector (same output as the jsonwebtoken library for this input)', () => {
    // header {"alg":"HS256","typ":"JWT"}, payload {"iat":1700000000}, secret 0xaa*32
    assert.equal(
        signHs256(secret, { iat: 1700000000 }),
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3MDAwMDAwMDB9.ttwUx34P9DHovHNBcrh7m0mwBLOPKrLQxTxAiDjmn3Q',
    );
});
