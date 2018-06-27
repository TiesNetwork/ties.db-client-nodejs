let ebml = require('@tiesdb/ebml');
let schema = require('./schema.js');
let etu = require('ethereumjs-util');
const createKeccakHash = require('keccak');

let encoder = new ebml.Encoder(null, schema);
let encodedData;

class Tag {
    constructor(propertiesOrName) {
        if(typeof propertiesOrName === 'string') {
            this.name = propertiesOrName;
        } else if(propertiesOrName) {
            for (let p in propertiesOrName)
                this[p] = propertiesOrName[p];
        }
        if(!this.type && this.name)
            this.type = schema.findTagByName(this.name).type;
        Object.defineProperty(this, '__childrenMap', {enumerable: false, configurable: true, writable: true});
    }

    /**
     *
     * @param name
     * @returns Tag
     */
    getChild(name) {
        if(!this.children)
            return;
        if(typeof name === 'number')
            return this.children[name];
        let c = this.__childrenMap[name];
        return c && c[0];
    }

    /**
     *
     * @param name
     * @returns [Tag]
     */
    getChildren(name) {
        if(!this.children)
            return;
        if(name)
            return this.__childrenMap[name];
        return this.children;
    }

    addChild(tag, value) {
        if(typeof tag === 'string') {
            if(typeof value !== undefined) {
                if(Buffer.isBuffer(value))
                    tag = new Tag({name: tag, data: value});
                else
                    tag = new Tag({name: tag, value: value});
            } else {
                tag = new Tag(tag);
            }
        }else if(!(tag instanceof Tag)){
            throw new Error('Only Tag object can be child of Tag');
        }

        let item = this, item1 = tag;
        if(!item.children)
            item.children = [];

        if(!item.__childrenMap)
            item.__childrenMap = {};
        if(!item.__childrenMap[item1.name])
            item.__childrenMap[item1.name] = [];
        item.__childrenMap[item1.name].push(item1);

        item.children.push(item1);
    }

    ensureData() {
        if(!this.data && this.type !== 'm') {
            ebml.tools.writeDataToTag(this, this.value);
        }
    }

    getValue() {
        if(this.value !== undefined)
            return this.value;
        if(this.type === 'm')
            return this.children;
        if(this.data)
            this.value = tools.convertDataToType(this.data, this.type);

        return this.value;
    }
}

encoder.on('data', function(chunk) {
    encodedData = chunk;
});

function decode(/*Buffer*/ data, myAddress) {
    let decoder = new ebml.Decoder(null, schema);
    let stack = [new Tag()];

    decoder.on('data', function(chunk) {
        if(chunk[0] === 'start') {
            let item = stack[stack.length - 1];

            let data = chunk[1];
            let item1 = new Tag({
                name: data.name,
                type: data.type
            });

            item.addChild(item1);
            stack.push(item1);
        }else if(chunk[0] === 'tag') {
            let item = stack[stack.length - 1];

            let data = chunk[1];
            let item1 = new Tag({
                name: data.name,
                type: data.type,
                data: data.data,
                value: data.value
            });

            item.addChild(item1);
        }else{ //chunk[0] === 'end'
            stack.pop();
        }
    });

    decoder.write(data);

    if(decoder._tag_stack.length)
        throw new Error('Failed to parse: ' + data.toString('hex'));

    let obj = stack[0].children[0];
    check(obj, myAddress);
    return obj;
}

function encode(raw) {
    function encodeInner(node){
        let info = encoder._schema.findTagByName(node.name);
        if(info.type === 'm'){
            encoder.write(['start', node]);
            for(let i=0; i<node.children.length; ++i){
                encodeInner(node.children[i]);
            }
            encoder.write(['end', node]);
        }else{
            node.ensureData();
            encoder.write(['tag', node]);
        }
    }

    encodeInner(raw);
    return encodedData;
}

function check(obj, myAddress) {
    switch (obj.name) {
        case 'ModificationRequest':
            checkModificationRequest(obj, myAddress);
            break;
    }
}

function checkModificationRequest(obj, myAddress){
    let entries = obj.getChildren('Entry');
    for(let i=0; i<entries.length; ++i){
        checkEntry(entries[i], myAddress);
    }
}

function checkEntry(entry, myAddress) {
    let header = entry.getChild('EntryHeader');
    let hash = getTagHash(header);
    let addr = getSigner(header, hash);
    let signer = header.getChild('Signer').data;
    if(Buffer.compare(addr, signer) != 0)
        throw new Error('Entry signature check is failed! Sig: ' + header.getChild('Signature').data.toString('hex').substr(0, 20) + '...');

    checkFields(entry.getChild('FieldList'), header.getChild('EntryFldHash'));
    if(myAddress)
        checkCheques(entry, myAddress);

    return hash;
}

function getTagHash(obj){
    let children = obj.getChildren();
    let keccak = createKeccakHash('keccak256');
    for(let i=0; i<children.length; ++i){
        let child = children[i];
        if(child.name != 'Signature')
            computeHashOnData(child, keccak);
    }

    let hash = keccak.digest();
    console.log("Hash of data: " + hash.toString('hex'))
    return hash;
}

function getSigner(obj, hash) {
    let signature = obj.getChild('Signature').data;
    if(!hash)
        hash = getTagHash(obj);

    let v = signature[64];
    if(v > 28)
        v -= 10; //ethereumjs-util supports only v in [27, 28] (EIP-155)
    v = v > 28 ? v - 10 : v;
    let pubk = etu.ecrecover(hash, v, signature.slice(0, 32), signature.slice(32, 64));
    let addr = etu.pubToAddress(pubk);
    return addr;
}

function computeHashOnData(obj, hash) {
    if(obj.type == 'm') {
        let children = obj.getChildren();
        for(let i=0; i<children.length; ++i) {
            hash = computeHashOnData(children[i], hash);
        }
    }else{
        if(!hash)
            hash = createKeccakHash('keccak256');
        obj.ensureData();
        console.log('Hashing ' + obj.name + ': ' + obj.data.toString('hex'));
        hash.update(obj.data);
    }
    return hash;
}

function computeFieldsHash(list) {
    let fields = list.getChildren('Field');
    if(!fields)
        return;
    let keccakAllFields = createKeccakHash('keccak256');
    for(let i=0; i<fields.length; ++i) {
        let field = fields[i];
        let fldhash = field.getChild('FieldHash');
        if(fldhash){
            fldhash.ensureData();
            keccakAllFields.update(fldhash.data);
        }else {
            let keccakField = createKeccakHash('keccak256');

            let name = field.getChild('FieldName');
            name.ensureData();
            let value = field.getChild('FieldValue');
            field.ensureData();

            keccakField.update(name.data);
            keccakField.update(value.data);
            keccakAllFields.update(keccakField.digest());
        }
    }

    return keccakAllFields.digest();
}

function checkFields(list, hash){
    let computed = computeFieldsHash(list);

    hash = hash.data;
    if(Buffer.compare(hash, computed) != 0)
        throw new Error('Fields hash does not match! Hash: ' + hash.toString('hex'));
}

function checkCheques(entry, myAddress) {
    let list = entry.getChild('ChequeList');
    if(!list)
        return;
    let cheques = list.getChildren('Cheque');
    for(let i=0; i<cheques.length; ++i) {
        let cheque = cheques[i];
        let addr = getSigner(cheque);

        if(Buffer.compare(addr, myAddress) != 0)
            throw new Error(`Cheque is not mine: ${cheque.getChild('ChequeRange').data.toString('hex')}-${cheque.getChild('ChequeRange').value}`);
    }
}

function sign(msgHash, pk) {
    let sig = etu.secp256k1.sign(msgHash, pk);
    let sigBuf = Buffer.allocUnsafe(65);
    sig.signature.copy(sigBuf, 0, 0, 64);
    sigBuf[64] = sig.recovery + 37; //we need [37, 38] (EIP-155)
    return sigBuf;
}

module.exports = {
    decode,
    encode,
    checkEntry,
    Tag,
    computeHashOnData,
    computeFieldsHash,
    sign,
};