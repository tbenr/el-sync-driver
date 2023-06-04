// Dependencies
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { executeForkchoiceUpdated, executeNewPayload } = require('./jsonrpc');
const config = require('./config.json');
const fs = require('fs');

let jwtTokens = {};

async function pollCLAndCallEL() {
    let response;
    try {
        response = await axios.get(`${config.ClRestApiEndpoint}/eth/v2/beacon/blocks/head`);

        if (response.status !== 200) {
            console.error('Error in CL REST API call:', response.status);
            return;
        }
    } catch (error) {
        console.error('An error occurred CL REST API call:', error.cause);
        return;
    }

    const beaconBlockHead = response.data;
    const execution_payload = beaconBlockHead.data.message.body.execution_payload;

    const newPayload = calculateNewPayload(execution_payload);

    const slot = beaconBlockHead.data.message.slot;

    console.log(`newPayload for slot ${slot}, block number: ${execution_payload.block_number}, block hash ${execution_payload.block_hash}`);

    const jsonrpcNewPayloadPromises = [];

    for (const endpointConfig of config.ElJsonrpcEndpoints) {
        const { endpoint } = endpointConfig;

        const jsonrpcPromise = executeNewPayload(endpoint, newPayload, jwtTokens[endpoint]);
        jsonrpcNewPayloadPromises.push(jsonrpcPromise);
    }

    await Promise.allSettled(jsonrpcNewPayloadPromises);

    try {
        response = await axios.get(`${config.ClRestApiEndpoint}/eth/v1/debug/fork_choice`);

        if (response.status !== 200) {
            console.error('Error in CL REST API call:', response.status);
            return;
        }
    } catch (error) {
        console.error('An error occurred CL REST API call:', error);
    }

    const fork_choice = response.data;

    const justifiedCheckpointRoot = fork_choice.justified_checkpoint.root;
    const finalizedCheckpointRoot = fork_choice.finalized_checkpoint.root;
    const forkChoiceNodes = fork_choice.fork_choice_nodes;

    const safeBlockHash = calculateSafeBlockHash(justifiedCheckpointRoot, forkChoiceNodes);
    const finalizedBlockHash = calculateFinalizedBlockHash(finalizedCheckpointRoot, forkChoiceNodes);
    const headBlockHash = newPayload.blockHash

    console.log('forkChoice state:', {
        headBlockHash: headBlockHash,
        safeBlockHash: safeBlockHash,
        finalizedBlockHash: finalizedBlockHash
    });


    const jsonrpcForkChoicePromises = [];


    for (const endpointConfig of config.ElJsonrpcEndpoints) {
        const { endpoint } = endpointConfig;

        const jsonrpcPromise = executeForkchoiceUpdated(endpoint, {
            headBlockHash,
            safeBlockHash,
            finalizedBlockHash,
        }, jwtTokens[endpoint]);
        jsonrpcForkChoicePromises.push(jsonrpcPromise);
    }

    await Promise.allSettled(jsonrpcForkChoicePromises);
}

function calculateNewPayload(execution_payload) {
    return {
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
        withdrawals: calculateWithdrawals(execution_payload.withdrawals)
    }
}

function calculateWithdrawals(beaconBlockithdrawals) {
    let withdrawals = [];

    for (const withdrawal of beaconBlockithdrawals) {
        withdrawals.push(
            {
                index: toQuantity(withdrawal.index),
                validatorIndex: toQuantity(withdrawal.validator_index),
                address: withdrawal.address,
                amount: toQuantity(withdrawal.amount)
            }
        );
    }

    return withdrawals;
}

function toQuantity(value) {
    return '0x' + BigInt(value).toString(16);
}

// Helper function to calculate the safeBlockHash
function calculateSafeBlockHash(justifiedCheckpointRoot, forkChoiceNodes) {
    const safeBlockNode = forkChoiceNodes.find(node => node.block_root === justifiedCheckpointRoot);

    if (safeBlockNode) {
        return safeBlockNode.execution_block_hash;
    }

    return null;
}

// Helper function to calculate the finalizedBlockHash
function calculateFinalizedBlockHash(finalizedCheckpointRoot, forkChoiceNodes) {
    const finalizedBlockNode = forkChoiceNodes.find(node => node.block_root === finalizedCheckpointRoot);

    if (finalizedBlockNode) {
        return finalizedBlockNode.execution_block_hash;
    }

    return null;
}

// Read the secret from file and return it as a buffer
function readSecretFromFile(filePath) {
    const secretHex = fs.readFileSync(filePath, 'utf-8').trim();
    const secretBuffer = Buffer.from(secretHex, 'hex');
    return secretBuffer;
}

function generateAndRenewJwtToken(endpoint, secretBuffer) {
    const issuedAt = Math.floor(Date.now() / 1000);
    const expirationTime = issuedAt + (5 * 60);


    jwtTokens[endpoint] = jwt.sign({ iat: issuedAt }, secretBuffer, {
        algorithm: 'HS256',
        expiresIn: expirationTime
    });
}


async function main() {
    const renewalInterval = 1 * 60;

    for (const endpointConfig of config.ElJsonrpcEndpoints) {
        const { endpoint, jwtSecretFile } = endpointConfig;

        const secretBuffer = readSecretFromFile(jwtSecretFile)

        generateAndRenewJwtToken(endpoint, secretBuffer);

        setInterval(() => {
            generateAndRenewJwtToken(endpoint, secretBuffer);
            console.log('Renewed JWT token for ', endpoint);
        }, renewalInterval * 1000);
    }

    pollCLAndCallEL();

    setInterval(pollCLAndCallEL, 12000);
}


main();
