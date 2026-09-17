const crypto = require('node:crypto');

function b64url(input) {
    return Buffer.from(input).toString('base64url');
}

// Minimal HS256 JWT signer, enough for the Engine API auth (EIP-3675 / engine spec "Authentication").
function signHs256(secretBuffer, claims) {
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = b64url(JSON.stringify(claims));
    const signature = crypto.createHmac('sha256', secretBuffer).update(`${header}.${payload}`).digest('base64url');
    return `${header}.${payload}.${signature}`;
}

module.exports = { signHs256 };
