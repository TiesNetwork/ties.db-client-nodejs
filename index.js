﻿let ebml = require('@tiesdb/ebml');
ebml.tools.DATE_SCALE = 1; //Use milliseconds for time tags

class TiesDBClient {
	get Connection() {
		return require('./net/connection');
	}

	get Record() {
		return require('./request/record');
	}

	get Field() {
		return require('./request/field');
	}

	get Constants() {
		return require('./request/constants');
	}

}

module.exports = new TiesDBClient();
