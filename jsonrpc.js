// Dependencies
const axios = require('axios');
const jsonrpc = require('jsonrpc-lite');

let requestIdCounter = 0;

async function doJsonrpcCall(endpoint, engineCall, jwtToken) {
    try {
        requestIdCounter++;

        const request = jsonrpc.request(requestIdCounter, engineCall.method, engineCall.params);

        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${jwtToken}`
        };

        console.log(`[${endpoint}] calling ${engineCall.method}`);

        const response = await axios.post(endpoint, request, { headers });

        if (response.status !== 200) {
            console.error('Error in JSON-RPC call:', response.status);
            return;
        }

        const { result, error } = response.data;

        if (error) {
            console.error(`[${endpoint}] ${engineCall.method} error:`, error);
        } else {
            console.log(`[${endpoint}] ${engineCall.method}  result:`, result);
        }
    } catch (error) {
        console.error(`[${endpoint}] an error occurred during ${engineCall.method} call:`, error.cause);
    }
}

// Rest of the code remains the same

module.exports = {
    doJsonrpcCall
};
