const
    codec = require('./codec'),
    Tag = codec.Tag;

class Context {

    constructor(pk, contractAddress, sessionId, amount, nonce) {
        this.pk = pk;
        this.chequeTrackingSession = codec.cheque
            .newChequeFactory(pk)
            .openSession(contractAddress, sessionId)
            .trackingSession(amount, nonce);
    }

    writeEntryCheque(tagEntry) {
        let amount = 10; // Entry creation fee
        amount = 0 < this.chequeTrackingSession.getLatestNonce() ? amount : amount + 100; // Session creation fee

        let tagEntryHeader = tagEntry.getChild("EntryHeader");
        let tagTablespaceName = tagEntryHeader.getChild('TablespaceName');
        let tagTableName = tagEntryHeader.getChild('TableName');
        let tagChequeList = new Tag('ChequeList');
        let tagCheque = new Tag('Cheque');

        let sigData = this.chequeTrackingSession.signCheque(tagTablespaceName.getValue(), tagTableName.getValue(), amount);
        tagCheque.addChild('TablespaceName', sigData.tablespaceName);
        tagCheque.addChild('TableName', sigData.tableName);
        tagCheque.addChild('ChequeSession', sigData.sessionId);
        tagCheque.addChild('ChequeNumber', sigData.nonce);
        tagCheque.addChild('ChequeCropAmount', sigData.amount);
        tagCheque.addChild('Signer', sigData.signerAddress);
        tagCheque.addChild('Signature', sigData.signature);
        tagCheque.addChild('ChequeVersion', 1);

        tagChequeList.addChild(tagCheque);
        tagEntry.addChild(tagChequeList);
    }
}

module.exports = Context;