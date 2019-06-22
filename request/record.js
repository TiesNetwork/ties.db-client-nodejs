const Field = require('./field');
const codec = require('./codec');
const Tag = codec.Tag;
const C = require('./constants');
const etu = require('ethereumjs-util');


class Record {
    constructor(tablespace, table) {
        this.clearFields();
        this.prevVersion = 0;
        this.prevHash = null;
        this.signer = null;
        this.tablespace = tablespace;
        this.table = table;
    }

    putField(field, _idx) {
        let flds = this.fieldsByName[field.name];
        if(!flds)
            flds = this.fieldsByName[field.name] = field;
        else if(Array.isArray(flds))
            flds.push(field);
        else
            flds = [flds, field];

        if(!Number.isInteger(_idx))
            _idx = this.fields.length;
        if(_idx < 0) //If negative, add the field to the tail above index -idx
            _idx = Math.max(-_idx, this.fields.length);

        this.fields[_idx] = field;
    }

    putBinaryValue(name, value, type) {
        let fld = this.getField(name);
        if(fld && !fld.computed) {
            fld.setValue(value || fld.getBinaryValue());
        }else {
            this.putField(new Field(name, type, {binaryValue: value}));
        }
    }

    putValue(name, value, type) {
        let fld = this.getField(name);
        if(fld && !fld.computed) {
            fld.setValue(value || fld.getValue());
        }else {
            this.putField(new Field(name, type, {value: value}));
        }
    }

    putHash(name, hash, type) {
        let fld = this.getField(name);
        if(fld && !fld.computed) {
            fld.setHash(value || fld.getHash());
        }else {
            this.putField(new Field(name, type, {hash: hash}));
        }
    }

    getField(name) {
        let fld = this.fieldsByName[name];
        if(Array.isArray(fld))
            return fld[0];
        return fld;
    }

    getFields(name) {
        if(name) {
            let flds = this.fieldsByName[name];
            if (!Array.isArray(flds))
                return [flds];
            return flds;
        }

        return this.fields;
    }

    getValue(name) {
        let fld = this.getField(name);
        return fld && fld.getValue();
    }

    getSigner() {
        return '0x'+this.signer.toString('hex');
    }

    getSortedFieldNames() {
        let names = this.fields.reduce((names, fld) => {
            if(!fld.computed)
                names.push(fld.name);
            return names;
        }, []);
        return names.sort();
    }

    getFieldList(fieldNames) {
        let fl = new codec.Tag('FieldList');
        if(!fieldNames)
            fieldNames = this.getSortedFieldNames();
        for(let name of fieldNames) {
            let field = this.getField(name);
            let f = field.toTag();
            fl.addChild(f);
        }
        return fl;
    }

    getEntry(pk) {
        let entry = new Tag('Entry');
        let entryHeader = new Tag('EntryHeader');
        entry.addChild(entryHeader);

        let fieldNames = this.getSortedFieldNames();
        let fl = this.getFieldList(fieldNames);
        let fldhash = codec.computeFieldsHash(fl);

        entryHeader.addChild('EntryTablespaceName', this.tablespace);
        entryHeader.addChild('EntryTableName', this.table);
        entryHeader.addChild('EntryTimestamp', new Date());
        entryHeader.addChild('EntryVersion', this.prevVersion + 1);
        entryHeader.addChild('EntryFldHash', fldhash);
        if(this.prevHash)
            entryHeader.addChild('EntryOldHash', this.prevHash);
        entryHeader.addChild('EntryNetwork', C.Network.ETHEREUM);
        entryHeader.addChild('Signer', etu.privateToAddress(pk));

        let hash = codec.computeHashOnData(entryHeader).digest();
        console.log("Hash of insert data: " + hash.toString('hex'))

        let sig = codec.sign(hash, pk);
        entryHeader.addChild('Signature', sig);

        entry.addChild(fl);

        return entry;
    }

    fillFromEntry(tagEntry, columnsOrder) {
        let hash = codec.checkEntry(tagEntry);

        let header = tagEntry.getChild("EntryHeader");
        this.table = header.getChild("EntryTableName").getValue();
        this.tablespace = header.getChild("EntryTablespaceName").getValue();
        this.prevHash = hash;
        this.prevVersion = header.getChild("EntryVersion").getValue();
        this.signer = header.getChild("Signer").getValue();

        let flds = tagEntry.getChild("FieldList").getChildren("Field");
        for(let tag of flds) {
            let field = Field.fromTag(tag);
            let idx;
            if(columnsOrder) {
                idx = columnsOrder.fields[field.name];
                if (idx === undefined)
                    idx = -columnsOrder.total;
            }
            this.putField(field, idx);
        }
    }

    fillFromComputed(tagComputed, columnsOrder){
        let flds = tagComputed.getChildren("ComputeField");
        if(flds) {
            for (let i = 0; i < flds.length; ++i) {
                let field = Field.fromTag(flds[i]);
                let idx;
                if (columnsOrder) {
                    idx = columnsOrder.computed[i];
                    if (idx === undefined)
                        idx = -columnsOrder.total;
                }
                this.putField(field, idx);
            }
        }
    }

    static fromRecollectionResult(tagResult, columnsOrder) {
        let record = new Record();
        record.fillFromEntry(tagResult.getChild('Entry'), columnsOrder);
        let computed = tagResult.getChild('RecollectionCompute');
        if(computed)
            record.fillFromComputed(computed, columnsOrder);
        return record;
    }

    putFields(fields, types) {
        for (let f in fields) {
            let type = types[f];
            if(!type)
                throw new Error('No type for field ' + f);
            this.putValue(f, fields[f], type);
        }
    }

    clearFields(){
        this.fieldsByName = {};
        this.fields = [];
    }

    delete(keyFieldNames){
        this.prevVersion = -1;
        for (let i = 0; i < this.fields.length; i++) { 
            let f = this.fields[i];
            if(!keyFieldNames.includes(f.name)) {
                delete this.fields[i];
                delete this.fieldsByName[f.name];
            }
        }
    }

}

module.exports = Record;
