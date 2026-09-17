let requestIdCounter = 0;

/**
 * Performs a single JSON-RPC 2.0 call. Never throws; returns
 *   { ok: true,  result, ms }  or
 *   { ok: false, error: { code?, message }, ms }
 */
async function doJsonrpcCall(endpoint, engineCall, jwtToken, { timeoutMs = 30_000 } = {}) {
    const id = ++requestIdCounter;
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);

    const body = JSON.stringify({ jsonrpc: '2.0', id, method: engineCall.method, params: engineCall.params });

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwtToken}` },
            body,
            signal: AbortSignal.timeout(timeoutMs),
        });

        if (response.status !== 200) {
            const text = (await response.text()).replace(/\s+/g, ' ').trim().slice(0, 200);
            return { ok: false, error: { message: `HTTP ${response.status} ${response.statusText} ${text}`.replace(/\s+/g, ' ').trim() }, ms: elapsed() };
        }

        const { result, error } = await response.json();
        if (error) {
            return { ok: false, error, ms: elapsed() };
        }
        return { ok: true, result, ms: elapsed() };
    } catch (err) {
        const message = err.name === 'TimeoutError'
            ? `timed out after ${timeoutMs}ms`
            : (err.cause && err.cause.message) || err.message;
        return { ok: false, error: { message }, ms: elapsed() };
    }
}

module.exports = { doJsonrpcCall };
