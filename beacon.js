const { forkAtLeast } = require('./utils');

class BeaconApiError extends Error {
    constructor(path, status, body) {
        super(`${path} -> HTTP ${status}${body ? ` ${body}` : ''}`);
        this.status = status;
    }
}

/**
 * Thin client for the Beacon Node REST API endpoints this tool needs.
 */
class BeaconClient {
    constructor(endpoint, { timeoutMs = 30_000 } = {}) {
        this.endpoint = endpoint.replace(/\/+$/, '');
        this.timeoutMs = timeoutMs;
    }

    // Returns { status, data, headers }. Throws on network failure or non-2xx other than 404 (which returns data: null).
    async getJson(path) {
        const response = await fetch(this.endpoint + path, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (response.status === 404) {
            return { status: 404, data: null, headers: response.headers };
        }
        if (!response.ok) {
            throw new BeaconApiError(path, response.status, (await response.text()).slice(0, 200));
        }
        return { status: response.status, data: await response.json(), headers: response.headers };
    }

    // Returns { fork, root, block } or null if the block is unknown.
    async getBlock(blockId) {
        const { data, headers } = await this.getJson(`/eth/v2/beacon/blocks/${blockId}`);
        if (!data) return null;
        return {
            fork: String(data.version).toLowerCase(),
            root: headers.get('eth-consensus-block-root') ?? await this.getBlockRoot(blockId),
            block: data.data.message,
        };
    }

    async getBlockRoot(blockId) {
        const { data } = await this.getJson(`/eth/v1/beacon/blocks/${blockId}/root`);
        return data ? data.data.root : null;
    }

    getHeadBlock() {
        return this.getBlock('head');
    }

    // Gloas: returns the ExecutionPayloadEnvelope message, or null if the payload has not been revealed yet.
    async getExecutionPayloadEnvelope(blockId) {
        const { data } = await this.getJson(`/eth/v1/beacon/execution_payload_envelopes/${blockId}`);
        return data ? data.data.message : null;
    }

    async getForkChoice() {
        const { data } = await this.getJson('/eth/v1/debug/fork_choice');
        return data;
    }

    /**
     * Builds the fork-agnostic input for engine_newPayload from a block:
     *   { fork, slot, root, parent_beacon_block_root, execution_payload, blob_kzg_commitments, execution_requests, fallback }
     * Pre-gloas: everything is in the block body.
     * Gloas (ePBS): the payload lives in a separate envelope which may not be revealed yet (404);
     * in that case we fall back once to the parent block. Returns null if nothing is available.
     */
    async getPayloadContext({ fork, root, block }, { allowFallback = true } = {}) {
        const body = block.body;
        const base = { fork, slot: block.slot, root, parent_beacon_block_root: block.parent_root, fallback: false };

        if (!forkAtLeast(fork, 'gloas')) {
            return {
                ...base,
                execution_payload: body.execution_payload,
                blob_kzg_commitments: body.blob_kzg_commitments ?? [],
                execution_requests: body.execution_requests ?? null,
            };
        }

        // The envelope must be looked up by root: "head" could resolve to a newer block between the two calls.
        const envelope = root ? await this.getExecutionPayloadEnvelope(root) : null;
        if (envelope && envelope.beacon_block_root === root) {
            const bid = body.signed_execution_payload_bid.message;
            return {
                ...base,
                execution_payload: envelope.payload,
                blob_kzg_commitments: bid.blob_kzg_commitments ?? envelope.blob_kzg_commitments ?? [],
                execution_requests: envelope.execution_requests,
            };
        }

        if (!allowFallback) return null;

        const parent = await this.getBlock(block.parent_root);
        if (!parent) return null;
        const parentCtx = await this.getPayloadContext({ ...parent, root: block.parent_root }, { allowFallback: false });
        return parentCtx ? { ...parentCtx, fallback: true } : null;
    }
}

module.exports = { BeaconClient, BeaconApiError };
