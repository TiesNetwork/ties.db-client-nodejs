const { assert } = require('console');

const
    elliptic = require('elliptic'),
    secp256k1 = new (elliptic.ec)('secp256k1'), // eslint-disable-line
    createKeccakHash = require('keccak'),
    etu = require('ethereumjs-util'),
    crypto = require('crypto');

function stripZeros(buffer) {
    var i = 0; // eslint-disable-line
    for (i = 0; i < buffer.length; i++) {
        if (buffer[i] !== 0) { break; }
    }
    return (i > 0) ? buffer.slice(i) : buffer;
}

function padToEven(str) {
    return str.length % 2 ? '0' + str : str;
}

function bnToBuffer(bn) {
    return stripZeros(Buffer.from(padToEven(bn.toString(16)), 'hex'));
}

function hashMessage(data) {
    let message = data;
    let messageBuffer = Buffer.from(message);
    // console.log('Hash: '+messageBuffer.toString('hex'));
    let preamble = "\x19Ethereum Signed Message:\n" + message.length;
    let preambleBuffer = Buffer.from(preamble);
    // console.log('Preamble: '+preambleBuffer.toString('hex'));
    let ethMessage = Buffer.concat([preambleBuffer, messageBuffer]);
    // console.log('MessageData: '+ethMessage.toString('hex'));
    return createKeccakHash('keccak256').update(ethMessage).digest();
};

function zeroPadding(hexString, lenBytes) {
    return hexString.length == lenBytes * 2 ? hexString : "0".repeat(lenBytes * 2 - hexString.length) + hexString;
}

function normalizeToString(value) {
    if (typeof value === 'string') {
        return value;
    }
    if (Buffer.isBuffer(value)) {
        return value.toString('hex');
    }
    throw new Error('Value should be a valid string or buffer');
}

function getChequeHash(contractAddress, signerAddress, sessionId, tablespaceName, tableName, amount, nonce) {
    tKey = createKeccakHash('keccak256').update(tablespaceName).update('#').update(tableName).digest().toString('hex');
    let children = [
        20, normalizeToString(contractAddress),
        20, normalizeToString(signerAddress),
        16, normalizeToString(sessionId),
        32, normalizeToString(tKey),
        32, BigInt(amount).toString(16),
        32, BigInt(nonce).toString(16),
    ];
    let keccak = createKeccakHash('keccak256');
    for (let i = 0; i < children.length; i += 2) {
        keccak.update(Buffer.from(zeroPadding(children[i + 1], children[i]), 'hex'));
    }
    return keccak.digest();
}

function newChequeFactory(pk) {

    const keyPair = secp256k1.keyFromPrivate(pk);
    const pubKey = (Buffer.from(keyPair.getPublic(false, 'hex'), 'hex')).slice(1);
    const signerAddress = etu.pubToAddress(pubKey);

    function signChequeHash(hash) {
        //console.log(' Hash: 0x' + hash.toString('hex'));
        //console.log('Address: 0x' + etu.pubToAddress(pubKey).toString('hex'));
        hash = hashMessage(hash);
        //console.log('HashMessage: 0x' + hash.toString('hex'));
        {
            const signature = keyPair.sign((hash), { canonical: true });
            const sigParts = [
                bnToBuffer(signature.r),
                bnToBuffer(signature.s),
                Buffer.from([27 + signature.recoveryParam]),
            ];
            // console.log('Signature.r: 0x' + sigParts[0].toString('hex'));
            // console.log('Signature.s: 0x' + sigParts[1].toString('hex'));
            // console.log('Signature.v: 0x' + sigParts[2].toString('hex'));
            const sigBuffer = Buffer.concat(sigParts);
            // console.log('Signature: 0x' + sigBuffer.toString('hex'));
            return sigBuffer;
        }
    }

    function signCheque(contractAddress, signerAddress, sessionId, tablespaceName, tableName, amount, nonce) {
        let signature = signChequeHash(
            getChequeHash(
                contractAddress,
                signerAddress,
                sessionId,
                tablespaceName,
                tableName,
                amount,
                nonce
            )
        );
        return {
            contractAddress,
            signerAddress,
            sessionId,
            tablespaceName,
            tableName,
            amount,
            nonce,
            signature,
        }
    }

    const forSession = (fun) =>
        (contractAddress, sessionId, tablespaceName, tableName, amount, nonce) =>
            fun(contractAddress,
                signerAddress,
                sessionId,
                tablespaceName,
                tableName,
                amount,
                nonce);

    const factory = {
        getSignerAddress: () => {
            const buf = Buffer.alloc(20);
            signerAddress.copy(buf);
            return buf;
        },
        signCheque: forSession(signCheque),
        getChequeHash: forSession(getChequeHash),
        openSession: (contractAddr, sessionKey) => newSession(contractAddr, sessionKey, factory),
    };
    return Object.freeze(factory);
}

function newSession(contractAddr, sessionKey, chequeFactory) {
    if (!chequeFactory) {
        throw new Error('ChequeFactory is missing or invalid: ' + chequeFactory);
    }
    if (typeof contractAddr === 'string') {
        contractAddr = Buffer.from(contractAddr, 'hex');
    }
    if (!Buffer.isBuffer(contractAddr) || contractAddr.length !== 20) {
        throw new Error('ContractAddr is missing or invalid: ' + contractAddr);
    }
    if (!sessionKey) {
        sessionKey = crypto.randomBytes(16);
    } else {
        if (typeof sessionKey === 'string') {
            sessionKey = Buffer.from(sessionKey, 'hex');
        }
        if (!Buffer.isBuffer(sessionKey) || sessionKey.length !== 16) {
            throw new Error('SessionKey is invalid: ' + sessionKey);
        }
    }
    const sessionId = Buffer.from(sessionKey.toString('hex'),'hex'); // Just buffer cloning. Implement more adequate logic please!
    const contractAddress = contractAddr.toString('hex');

    const forSession = (fun) =>
        (tablespaceName, tableName, amount, nonce) =>
            fun(contractAddress,
                sessionId,
                tablespaceName,
                tableName,
                amount,
                nonce);

    const session = {
        chequeFactory,
        signCheque: forSession(chequeFactory.signCheque),
        getChequeHash: forSession(chequeFactory.getChequeHash),
        getSessionKey: () => sessionKey,
        trackingSession: (totalAmount = 0, latestNonce = 0) => newTrackingSession(totalAmount, latestNonce, session),
    };
    return Object.freeze(session);
}

function newTrackingSession(totalAmount = 0, latestNonce = 0, session) {
    if (!session) {
        throw new Error('Session is missing or invalid: ' + session);
    }

    const forSession = (fun) =>
        (tablespaceName, tableName, amount) =>
            fun(tablespaceName,
                tableName,
                totalAmount += amount,
                ++latestNonce);

    const trackingSession = {
        session,
        signCheque: forSession(session.signCheque),
        getChequeHash: forSession(session.getChequeHash),
        getLatestNonce: () => latestNonce,
        getTotalAmount: () => getTotalAmount,
    };
    return Object.freeze(trackingSession);
}

module.exports = {
    newChequeFactory,
    getChequeHash,
}