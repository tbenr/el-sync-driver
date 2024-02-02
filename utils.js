const crypto = require('crypto');


function calculateSHA256FromHex(hexData) {
    const data = hexData.startsWith('0x') ? hexData.substring(2) : data
    const hash = crypto.createHash('sha256');
    hash.update(Buffer.from(data, 'hex'));
    return hash.digest('hex');
}

function kzgCommitmentToVersionedHash(kzgCommitment) {
    const kzgCommitmentHash = calculateSHA256FromHex(kzgCommitment);

    return str = '0x01' + kzgCommitmentHash.substring(2);
}

function toQuantity(value) {
    return '0x' + BigInt(value).toString(16);
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

module.exports = {
    kzgCommitmentToVersionedHash,
    toQuantity,
    calculateWithdrawals
};
