const WebSocketClient = require('websocket').client;
const Builder = require('../request/builder');
const codec = require('../request/codec');
const sqlConverter = require('./sqlconverter');
const Tag = codec.Tag;
const C = require('../request/constants');
const Record = require('../request/record');
const Context = require('../request/context');

class Connection {

    constructor(contractAddress, url){
        this.socket = new WebSocketClient({
        	fragmentOutgoingMessages: false,
        	maxReceivedFrameSize: 4*1024*1024*1024,
        	maxReceivedMessageSize: 4*1024*1024*1024,
        });

        this.contractAddress = contractAddress;

        this.requestId = 0;
        this.requests = {};
        this.contexts = {};
        this.connecting = false;
        this.header = Buffer.from('C001BA5E1225EFFF0000000000000001', 'hex');
        this.consistency = C.Consistency.QUORUM;

        if(url)
            this.connect(url);
    }

    connect(url) {
        if(this.connecting)
            throw new Error('Already connecting...');

        this.connecting = true;
        const self = this;

        this.waitForConnection = new Promise(((resolve, reject) => {
            self.socket.on('connect', (connection) => {
                self.connection = connection;

                console.log('connected!');

                connection.on('close', () => { console.log('closed!') });
                connection.on('error', (error) => { console.log('Connection error: ' + error) });
                connection.on('message', (data) => {
                    if(data.type != 'binary')
                        throw new Error('Wrong message format from server: ' + data.type);
                    console.log('Data: ' + data.binaryData.toString('hex'));
                    let header = data.binaryData.slice(0, 16);
                    if(Buffer.compare(header, this.header) != 0)
                        throw new Error('Wrong message header from server: ' + header.toString('hex'));
                    let body = data.binaryData.slice(16);
                    let response = codec.decode(body);
                    console.log(response.toString('xml'));
                    let msgId = response.getChild('MessageId');
                    if(!msgId) {
                        if(response.name === 'Error'){
                            let errs = response.getChildren('ErrorMessage');
                            throw new Error(errs.map(e => e.value).join('\n'));
                        }
                        throw new Error('Invalid response without MessageId: ' + response.name);
                    }

                    let requestId = msgId.value;
                    let func = this.requests[requestId];
                    if(!func)
                        throw new Error('Unknown response MessageId: ' + requestId);
                    func(response);
                    delete this.requests[requestId];
                });

                this.connecting = false;
                resolve(connection);
            });

            self.socket.on('connectFailed', (error) => {
                console.log('connect error: ' + error);
                this.connecting = false;
                reject(error);
            });
        }));

        this.socket.connect(url);
        return this.waitForConnection;
    }

    ___sendRequest(/*Tag*/ tagRoot) {
        tagRoot.addChild(new Tag({name: 'MessageId', value: ++this.requestId}));
        return this.__sendRequest(tagRoot);
    }

    __sendRequest(/*Tag*/ tagRoot) {
        let self = this;
        const requestId = self.requestId;

        if(!this.connection || !this.connection.connected)
            throw new Error('Connection is not open!');

        let data = codec.encode(tagRoot);
        console.log(tagRoot.name + ': ' + data.toString('hex'));
        console.log(tagRoot.toString('xml'));

        this.connection.sendBytes(Buffer.concat([this.header, data]));

        return new Promise((resolve, reject) => {
            self.requests[requestId] = (response, error) => {
                if (response)
                    resolve(response);
                else
                    reject(error);
            };
        });
    }

    __getContext(pk) {
        let key = pk.toString('hex');
        if (key in this.contexts) {
            return this.contexts[key];
        } else {
            return this.contexts[key] = new Context(pk,this.contractAddress);
        }
    }

    modify(records, pk) {
        let context = Buffer.isBuffer(pk) ? this.__getContext(pk) : pk;
        let builder = new Builder(records);
        let tag = builder.buildModification(context.pk, ++this.requestId);
        tag.getChildren("Entry").forEach((entry) => context.writeEntryCheque(entry));
        return this.__sendRequest(tag);
    }

    use(tablespace) {
        this.tablespace = tablespace;
    }

    close(code, error) {
        if(this.connecting)
            throw new Error('Can not close connection while it is connecting');
        if(this.connection) {
            this.connection.close(code || 1000, error || "");
            this.connection = null;
        }
    }

    async recollect(request, pk) {
        if(typeof request === 'string'){
            let tagRequest = new Tag("RecollectionRequest");
            //This is TQL select clause. Convert it to ebml
            let ast = sqlConverter.compile(request);

            tagRequest.addChild(new Tag({name: 'Consistency', value: this.consistency}));
            tagRequest.addChild(new Tag({name: 'MessageId', value: ++this.requestId}));
            sqlConverter.makeRequest(tagRequest, ast, this.tablespace);

            request = tagRequest;
        }

        //TODO: sign retrieve request
        let result = await this.__sendRequest(request);

        let order = sqlConverter.getColumnsOrder(request);
        let results = result.getChildren("RecollectionResult");
        let records = [];
        for(let r of results){
            let record = Record.fromRecollectionResult(r, order);
            records.push(record);
        }

        return records;
    }

}

module.exports = Connection;