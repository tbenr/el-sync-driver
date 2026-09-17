const { signHs256 } = require('./jwt');
const { SUPPORTED_FORKS, prepareNewPayloadCall, prepareForkchoiceUpdatedCall } = require('./engineApi');
const { shortHash } = require('./utils');

function elLabel(endpoint) {
    try {
        return new URL(endpoint).host;
    } catch {
        return endpoint;
    }
}

function describeError(error) {
    return error.code !== undefined ? `${error.code} ${error.message}` : error.message;
}

function describeStatus(res, pickStatus) {
    if (!res.ok) return 'ERR';
    return pickStatus(res.result) ?? '?';
}

/**
 * Poll orchestration with injectable collaborators (for tests).
 * @param {object} deps
 * @param {object} deps.config   { ElJsonrpcEndpoints: [{ endpoint }] }
 * @param {object} deps.secrets  endpoint -> Buffer (JWT secret)
 * @param {object} deps.beacon   BeaconClient-like: getHeadBlock, getPayloadContext, getForkChoice
 * @param {function} deps.rpc    doJsonrpcCall-like
 * @param {object} deps.log      logger
 */
function createDriver({ config, secrets, beacon, rpc, log }) {
    let lastHeadBlockHash = null;
    let polling = false;

    // Engine API auth (geth rejects `iat` older than 60s), so sign a fresh token for every request.
    function freshToken(endpoint) {
        return signHs256(secrets[endpoint], { iat: Math.floor(Date.now() / 1000) });
    }

    // Broadcasts one engine call to every EL and returns [{ endpoint, ...callResult }].
    async function broadcast(engineCall) {
        log.debug(`${engineCall.method} params`, engineCall.params);
        return Promise.all(config.ElJsonrpcEndpoints.map(async ({ endpoint }) => {
            const res = await rpc(endpoint, engineCall, freshToken(endpoint));
            if (res.ok) {
                log.debug(`[${elLabel(endpoint)}] ${engineCall.method} result`, res.result);
            } else {
                log.warn(`[${elLabel(endpoint)}] ${engineCall.method} failed: ${describeError(res.error)}`);
            }
            return { endpoint, ...res };
        }));
    }

    async function pollOnce() {
        const head = await beacon.getHeadBlock();
        if (!head) {
            log.warn('CL returned no head block');
            return;
        }

        if (!SUPPORTED_FORKS.includes(head.fork)) {
            log.error(`fork "${head.fork}" is unsupported (supported: ${SUPPORTED_FORKS.join(', ')})`);
            return;
        }

        const ctx = await beacon.getPayloadContext(head);
        if (!ctx) {
            log.info(`slot ${head.block.slot} (${head.fork}): execution payload not revealed yet, skipping`);
            return;
        }

        const payload = ctx.execution_payload;
        const headChanged = payload.block_hash !== lastHeadBlockHash;

        let npResults = null;
        if (headChanged) {
            npResults = await broadcast(prepareNewPayloadCall(ctx));
        } else {
            log.debug(`head unchanged (${shortHash(payload.block_hash)}), sending forkchoiceUpdated only`);
        }

        const forkChoice = await beacon.getForkChoice();
        if (!forkChoice) {
            log.warn('debug/fork_choice not available on the CL, skipping forkchoiceUpdated');
            return;
        }
        const fcuResults = await broadcast(prepareForkchoiceUpdatedCall(forkChoice, payload.block_hash, ctx.fork));

        lastHeadBlockHash = payload.block_hash;

        const perEl = fcuResults.map((fcu, i) => {
            const np = npResults && npResults[i];
            const npPart = np ? `NP=${describeStatus(np, r => r?.status)}(${np.ms}ms) ` : '';
            const fcuStatus = describeStatus(fcu, r => r?.payloadStatus?.status);
            return `${elLabel(fcu.endpoint)}: ${npPart}FCU=${fcuStatus}(${fcu.ms}ms)`;
        });
        const fallbackNote = ctx.fallback ? ' [parent, head payload pending]' : '';
        const line = `slot ${ctx.slot} (${ctx.fork}) block #${payload.block_number} ${shortHash(payload.block_hash)}${fallbackNote} | ${perEl.join(' | ')}`;
        if (headChanged) log.info(line); else log.debug(line);
    }

    async function poll() {
        if (polling) {
            log.warn('previous poll still running, skipping this one');
            return;
        }
        polling = true;
        try {
            await pollOnce();
        } catch (err) {
            log.error('poll failed:', err);
        } finally {
            polling = false;
        }
    }

    return { poll, pollOnce };
}

module.exports = { createDriver };
