// Dependencies
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { doJsonrpcCall } = require('./jsonrpc');
const { prepareNewPayloadCall, prepareForkchoiceUpdatedCall } = require('./engineApi');
const config = require('./config.json');
const fs = require('fs');

let jwtTokens = {};

const supportedForks = ['capella', 'deneb']

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

    const beaconBlockHeadResponse = response.data;
    const fork = ('' + beaconBlockHeadResponse.version).toLocaleLowerCase();

    if (!supportedForks.includes(fork)) {
        console.error(fork + 'is unsupported');
        return;
    }

    const beacon_block = beaconBlockHeadResponse.data.message;
    const execution_payload = beacon_block.body.execution_payload;

    const newPayloadCall = prepareNewPayloadCall(beacon_block, fork)

    const slot = beaconBlockHeadResponse.data.message.slot;

    console.log(`newPayload for slot ${slot}, block number: ${execution_payload.block_number}, block hash ${execution_payload.block_hash}`);

    const jsonrpcNewPayloadPromises = [];

    for (const endpointConfig of config.ElJsonrpcEndpoints) {
        const { endpoint } = endpointConfig;

        const jsonrpcPromise = doJsonrpcCall(endpoint, newPayloadCall, jwtTokens[endpoint]);
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
    const headBlockHash = beacon_block.body.execution_payload.block_hash

    const forkhoiceUpdatedCall = prepareForkchoiceUpdatedCall(fork_choice, headBlockHash, fork)

    const jsonrpcForkChoicePromises = [];


    for (const endpointConfig of config.ElJsonrpcEndpoints) {
        const { endpoint } = endpointConfig;

        const jsonrpcPromise = doJsonrpcCall(endpoint, forkhoiceUpdatedCall, jwtTokens[endpoint]);
        jsonrpcForkChoicePromises.push(jsonrpcPromise);
    }

    await Promise.allSettled(jsonrpcForkChoicePromises);
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
