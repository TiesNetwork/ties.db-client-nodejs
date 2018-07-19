var fs = require('fs');
var util = require('util');

var codec = require('./request/codec');
var Client = require('./index');

var Connection = Client.Connection;
var uuidv4 = require('uuid/v4');
var bigdecimal = require("bigdecimal");
var Record = Client.Record;

(async function() {
//   var data = Buffer.from("1254494542F0EC8102A142EAE14279E140A5808F636C69656E742D6465762E746573748289616C6C5F747970657386860080E1C5C3FD8881018CA01F037296AE497930FC80A84CB2F16765657A355A9BF6E972B4256B21676104F48E813CFC94AE65BAF610BAD3F0D71AA3C3A8110C2D62CBEB19FEC142B38B21FD479E8AAB0B5C509E3B9497E8F215CBA01A87064A689C5D13246EF642E5D7D05BBC093589715C1F26861865CE3C015832FF297B0182566BED7164D525D141CED19C808249648284757569648690964E84C1E4674FD5A9781395FD84DD79D1B380876642696E617279828662696E61727984A0A6E44F0EC03E1CAE0EC12257C1E3F138414AE15D8411CAB181CD675BE2D3086AD1B5808866426F6F6C65616E8287626F6F6C65616E84A0A73F698893FE67E40289D00C99086452B0A1C6DDA37D32AAC7EE578759883614D1B5808866446563696D616C8287646563696D616C84A03A8BC920C149D7267404C5E843CC0BD72E20D4CCEEC7C47CBD5BBA428AD76F82D1B3808766446F75626C658286646F75626C6584A0F9F8EB9596B70AD4E8BB06B82935BA3255A30A1A336AB04A563232125C92132BD1B78089664475726174696F6E82886475726174696F6E84A08BBC6444B06C9BD50FD55B47AE2FB508494A8CCE89F85E86BEA9D287EFD7F8BED1B1808666466C6F61748285666C6F617484A0865BC28E072CC92C200F7793CF4A9ACC990719E2CB85572EA2CA2850FDBDA8DBD1B5808866496E74656765728287696E746567657284A0219D33E0C6D763DE1970B197181C1AE549A5115513634CFF4E7F00365374D194D1B3808766537472696E678286737472696E6784A0D296D9102A76B612328202BBDF151287DB390C94142DF56E5A1FBA0D4C73C492C1ECC19980895465737456616C7565828662696E61727986840000030CC19980895465737456616C7565828662696E61727986840000030CC19980895465737456616C7565828662696E61727986840000030CC19980895465737456616C7565828662696E61727986840000030C", 'hex');
    
    
//     var req = codec.decode(data, new Buffer("fafe9c9e7845f446d091c12c74d44c61a0923c00", "hex"));
//     console.log(req.toString('xml'));
    
    
 //    console.log(util.inspect(req, {showHidden: false, depth: null}));
//     return;
    //data = codec.encode(req);
    //console.log(data.toString('hex'));


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

    let record = new Record('client-dev.test', 'all_types');
    let uuid = uuidv4();
    record.putFields({
        Id: uuid,
        fBinary: new Buffer("e0a61e5ad74f", 'hex'),
        fBoolean: false,
        fDecimal: new bigdecimal.BigDecimal("-1.235e-8"),
        fDouble: 158.234e200,
        fDuration: 20*86400,
        fFloat: -42803.234e-8,
        fInteger: 423424432,
        fLong: -278374928374,
        fString: "This is UTF-8 строка",
        fTime: new Date()
    }, types);

    //0xe0a61e5ad74fc154927e8412c7f03528134f755e7eb45554eb7a99c2744ac34e
    //0xAe65bAf610Bad3F0d71Aa3C3a8110c2d62cbEb19

    let c = new Connection();
    await c.connect('ws://192.168.1.45:8080/websocket');

/*    const Builder = require('./request/builder');
    let builder = new Builder([record]);
    let tag = builder.buildModification(Buffer.from('e0a61e5ad74fc154927e8412c7f03528134f755e7eb45554eb7a99c2744ac34e', 'hex'), ++c.requestId);
    console.log(tag.toString('xml'));
return;
*/
    let response = await c.modify([record], Buffer.from('e0a61e5ad74fc154927e8412c7f03528134f755e7eb45554eb7a99c2744ac34e', 'hex'));

    let records = await c.recollect(
        `SELECT 
            Id,
            CAST(fDuration as duration),
            CAST(writeTime(/*fsdf*/fTime) as date)::time as wtime,
            CAST(writeTime(fTime) AS date),
            fLong,
            bigIntAsBlob(toUnixTimestamp(CAST(writeTime(fTime) AS date))) AS WriteTime, 
            intAsBlob(0x309) AS TestValue 
        FROM "client-dev.test"."all_types"
        WHERE
            Id IN (${uuid.toString()})`
    );

    console.log(util.inspect(records, {showHidden: false, depth: null}));

    records[0].putValue("fLong", "123", types.fLong);

    response = await c.modify(records, Buffer.from('e0a61e5ad74fc154927e8412c7f03528134f755e7eb45554eb7a99c2744ac34e', 'hex'));

    console.log(util.inspect(response, {showHidden: false, depth: null}));

    c.close();
    
})();