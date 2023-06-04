// Dependencies
const axios = require('axios');
const jsonrpc = require('jsonrpc-lite');

let requestIdCounter = 0;

async function executeForkchoiceUpdated(endpoint, params, jwtToken) {
    await doJsonrpcCall(endpoint, params, jwtToken, 'engine_forkchoiceUpdatedV2')
}

async function executeNewPayload(endpoint, params, jwtToken) {
    await doJsonrpcCall(endpoint, params, jwtToken, 'engine_newPayloadV2')
}

async function doJsonrpcCall(endpoint, params, jwtToken, method) {
    try {
        requestIdCounter++;

        const request = jsonrpc.request(requestIdCounter, method, [
            params
        ]);

        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${jwtToken}`
        };

        console.error(`[${endpoint}] calling ${method}`);

        const response = await axios.post(endpoint, request, { headers });

        if (response.status !== 200) {
            console.error('Error in JSON-RPC call:', response.status);
            return;
        }

        const { result, error } = response.data;

        if (error) {
            console.error(`[${endpoint}] ${method} error:`, error);
        } else {
            console.log(`[${endpoint}] ${method}  result:`, result);
        }
    } catch (error) {
        console.error(`[${endpoint}] an error occurred during ${method} call:`, error.cause);
    }
}

// Rest of the code remains the same

module.exports = {
    executeForkchoiceUpdated,
    executeNewPayload
};
