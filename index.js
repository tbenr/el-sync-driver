const fs = require('node:fs');
const path = require('node:path');
const { createLogger } = require('./logger');
const { BeaconClient } = require('./beacon');
const { doJsonrpcCall } = require('./jsonrpc');
const { createDriver } = require('./driver');
const { SUPPORTED_FORKS } = require('./engineApi');

const POLL_INTERVAL_MS = 12_000;

function loadConfig() {
    const configPath = path.resolve(process.env.CONFIG || 'config.json');
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

function readSecretFromFile(filePath) {
    return Buffer.from(fs.readFileSync(filePath, 'utf-8').trim().replace(/^0x/, ''), 'hex');
}

function main() {
    const log = createLogger('driver');
    const config = loadConfig();

    log.info(`el-sync-driver starting (log level: ${log.level})`);
    log.info(`CL: ${config.ClRestApiEndpoint}`);
    log.info(`supported forks: ${SUPPORTED_FORKS.join(', ')}`);

    const secrets = {};
    for (const { endpoint, jwtSecretFile } of config.ElJsonrpcEndpoints) {
        secrets[endpoint] = readSecretFromFile(jwtSecretFile);
        log.info(`EL: ${endpoint} (jwt secret: ${jwtSecretFile})`);
    }

    const driver = createDriver({
        config,
        secrets,
        beacon: new BeaconClient(config.ClRestApiEndpoint),
        rpc: doJsonrpcCall,
        log,
    });

    driver.poll();
    setInterval(driver.poll, POLL_INTERVAL_MS);
}

if (require.main === module) {
    main();
}
