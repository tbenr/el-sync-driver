// Dependencies
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { executeForkchoiceUpdated } = require('./jsonrpc');
const config = require('./config.json');
const fs = require('fs');

let jwtTokens = {};

async function pollCLAndCallEL() {
    let response;
    try {
        response = await axios.get(`${config.restApiEndpoint}/eth/v1/debug/fork_choice`);

        if (response.status !== 200) {
            console.error('Error in CL REST API call:', response.status);
            return;
        }
    } catch (error) {
        console.error('An error occurred CL REST API call:', error);
    }

    const data = response.data;
    const justifiedCheckpointRoot = data.justified_checkpoint.root;
    const finalizedCheckpointRoot = data.finalized_checkpoint.root;
    const forkChoiceNodes = data.fork_choice_nodes;

    const safeBlockHash = calculateSafeBlockHash(justifiedCheckpointRoot, forkChoiceNodes);
    const finalizedBlockHash = calculateFinalizedBlockHash(finalizedCheckpointRoot, forkChoiceNodes);
    const headBlockHash = getHeadBlockHash(forkChoiceNodes);

    console.log('forkChoice state:', {
        headBlockHash: headBlockHash,
        safeBlockHash: safeBlockHash,
        finalizedBlockHash: finalizedBlockHash
    });


    const jsonrpcPromises = [];


    for (const endpointConfig of config.jsonrpcEndpoints) {
        const { endpoint } = endpointConfig;

        console.log('calling forkChoiceUpdated for: ', endpoint);

        const jsonrpcPromise = executeForkchoiceUpdated(endpoint, {
            headBlockHash,
            safeBlockHash,
            finalizedBlockHash,
        }, jwtTokens[endpoint]);
        jsonrpcPromises.push(jsonrpcPromise);
    }

    try {
        await Promise.all(jsonrpcPromises);

        console.log('All ELs updated.');
    } catch (error) {
        console.error('An error occurred during EL forkchoice update call:', error);
    }
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

// Helper function to get the headBlockHash
function getHeadBlockHash(forkChoiceNodes) {
    let headBlockNode = null;

    for (const node of forkChoiceNodes) {
        if (node.validity === 'VALID' && (!headBlockNode || node.slot > headBlockNode.slot)) {
            headBlockNode = node;
        }
    }

    if (headBlockNode) {
        return headBlockNode.execution_block_hash;
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
    const renewalInterval = 4 * 60;

    jwtTokens[endpoint] = jwt.sign({ iat: issuedAt }, secretBuffer, {
        algorithm: 'HS256',
        expiresIn: expirationTime
    });

    setInterval(() => {
        generateAndRenewJwtToken(secret, secretBuffer);
        console.log('Renewed JWT token for ', endpoint);
    }, renewalInterval * 1000);
}


async function main() {
    for (const endpointConfig of config.jsonrpcEndpoints) {
        const { endpoint, jwtSecretFile } = endpointConfig;

        const secretBuffer = readSecretFromFile(jwtSecretFile)

        generateAndRenewJwtToken(endpoint, secretBuffer);
    }

    pollCLAndCallEL();

    setInterval(pollCLAndCallEL, 12000);
}


main();
