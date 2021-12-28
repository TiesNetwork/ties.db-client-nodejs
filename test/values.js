const TiesDB = require('../index'),
    uuidv4 = require('uuid/v4'),
    codec = require('../request/codec'),
    assert = require('assert');

describe('request', function () {

    let pk = Buffer.from('e0a61e5ad74fc154927e8412c7f03528134f755e7eb45554eb7a99c2744ac34e', 'hex');

    describe('ChequeSigner', function () {
        //debugger;

        let args = [
            "01234567890abcdef01234567890abcdef012345",
            "01234567890abcdef01234567890abcd",
            "someTablespaceName",
            "someTableName",
            110,
            1,
        ];

        const chequeFactory = codec.cheque.newChequeFactory(pk);
        const refSig1 = '0fe79bd6071edbfeb1a7afb669d2092bd1e35902b488dd212d3f7c2e0550a2fb183485b6d406906be1d358ce5f26936ca1c3b2df646a463f3c1c1f57e290d02d1c';
        const refSig2 = 'bc977e70cc9f7d6b2d7d0513d21459e5c7436f21df42450751b12412f0b35f864099b530dbcf0986d9351695dcad42cf3cd59486faef5d42b03927ecfbea4aaa1c';

        it('should sign cheque data', function () {
            let sig1 = chequeFactory.signCheque(...args).signature;
            assert.strictEqual(sig1.toString('hex'), refSig1, 'Signature missmatch');

            let session = chequeFactory.openSession(args[0], args[1]);
            let sig2 = session.signCheque(args[2], args[3], args[4], args[5]).signature;
            assert.strictEqual(sig2.toString('hex'), refSig1, 'Signature missmatch');

            let tracking = session.trackingSession();
            let sig3 = tracking.signCheque(args[2], args[3], args[4]).signature;
            assert.strictEqual(sig3.toString('hex'), refSig1, 'Signature missmatch');

            let sig2_1 = session.signCheque(args[2], args[3], args[4] * 2, args[5] + 1).signature;
            assert.strictEqual(sig2_1.toString('hex'), refSig2, 'Signature missmatch');

            let sig3_1 = tracking.signCheque(args[2], args[3], args[4]).signature;
            assert.strictEqual(sig3_1.toString('hex'), refSig2, 'Signature missmatch');
        });
    });

    describe('Encoder', function () {
        //debugger;

        let types = {
            Id: 'uuid',
            fBinary: 'binary',
            fBoolean: 'boolean',
            fDecimal: 'decimal',
            fDouble: 'double',
            fDuration: 'duration',
            fFloat: 'float',
            fInteger: 'integer',
            fLong: 'long',
            fString: 'string',
            fTime: 'time'
        };

        let record = new TiesDB.Record('client-dev.test', 'all_types');
        let uuid = uuidv4();
        let entry;

        let values = {
            Id: uuid,
            fBinary: Buffer.from("e0a61e5ad74f", 'hex'),
            fBoolean: false,
            fDecimal: new TiesDB.BD.BigDecimal("-1.235e-2318"),
            fDouble: 158.234e200,
            fDuration: 20 * 86400,
            fFloat: -42803.234e-8,
            fInteger: 423424432,
            fLong: -278374928374,
            fString: "This is UTF-8 строка",
            fTime: new Date('2018-06-27T10:01:25')
        };

        it('should create record of values', function () {
            record.putFields(values, types);
        });

        it('should create entry of a record', function () {
            entry = record.getEntry(pk);

            assert(entry.getChild('EntryHeader').getChild('EntryVersion').getValue(), 1, 'Insert entry should have version=1');
        });

        it('should fields in entry be properly hashed', function () {
            let fields = entry.getChild('FieldList');
            let hash = codec.computeFieldsHash(fields);
            let computedHash = entry.getChild('EntryHeader').getChild('EntryFldHash').getValue()

            assert.ok(Buffer.compare(computedHash, hash) == 0);
        });

        it('should entry be properly signed', function () {
            let signer = entry.getChild('EntryHeader').getChild('Signer').getValue();
            let computedSigner = codec.getSigner(entry.getChild('EntryHeader'));

            assert.ok(Buffer.compare(computedSigner, signer) == 0);
        });

        it('should record be correctly restored from entry', function () {
            let rec = new TiesDB.Record();
            rec.fillFromEntry(entry);

            assert.equal(rec.table, record.table, 'Tables should be the same');
            assert.equal(rec.tablespace, record.tablespace, 'Tablespaces should be the same');

            assert.equal(rec.getValue('Id'), uuid.toString());
            assert.ok(Buffer.compare(rec.getValue('fBinary'), values.fBinary) == 0);
            assert.equal(rec.getValue('fBoolean'), values.fBoolean);
            assert.ok(rec.getValue('fDecimal').compareTo(values.fDecimal) == 0);
            assert.equal(rec.getValue('fDouble'), values.fDouble);
            assert.equal(rec.getValue('fFloat'), values.fFloat);
            assert.equal(rec.getValue('fInteger'), values.fInteger);
            assert.equal(rec.getValue('fLong'), values.fLong);
            assert.equal(rec.getValue('fString'), values.fString);
            assert.equal(rec.getValue('fTime').getTime(), values.fTime.getTime());
            assert.equal(rec.getValue('fDuration').doubleValue(), values.fDuration);
        });

    });
});
