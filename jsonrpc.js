// Dependencies
const axios = require('axios');
const jsonrpc = require('jsonrpc-lite');

let requestIdCounter = 0;

async function executeForkchoiceUpdated(endpoint, params, jwtToken) {
    try {
        requestIdCounter++;

        const request = jsonrpc.request(requestIdCounter, 'engine_forkchoiceUpdatedV2', [
            params
        ]);

        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${jwtToken}`
        };

        const response = await axios.post(endpoint, request, { headers });

        if (response.status !== 200) {
            console.error('Error in JSON-RPC call:', response.status);
            return;
        }

        const { result, error } = response.data;

        if (error) {
            console.error('JSON-RPC error:', error);
        } else {
            console.log('JSON-RPC result:', result);
        }
    } catch (error) {
        console.error('An error occurred during JSON-RPC call:', error);
    }
}

async function executeNewPayload(endpoint, params, jwtToken) {
    try {
        requestIdCounter++;

        const request = jsonrpc.request(requestIdCounter, 'engine_newPayloadV2', [
            params
        ]);

        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${jwtToken}`
        };

        const response = await axios.post(endpoint, request, { headers });

        if (response.status !== 200) {
            console.error('Error in JSON-RPC call:', response.status);
            return;
        }

        const { result, error } = response.data;

        if (error) {
            console.error('JSON-RPC error:', error);
        } else {
            console.log('JSON-RPC result:', result);
        }
    } catch (error) {
        console.error('An error occurred during JSON-RPC call:', error);
    }
}

// Rest of the code remains the same

module.exports = {
    executeForkchoiceUpdated,
    executeNewPayload
};
