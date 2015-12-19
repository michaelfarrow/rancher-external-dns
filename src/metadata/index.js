
var request = require('request');
var Promise = require('promise');

var metadata = function(){
	
};

metadata.prototype = {

	makeRequest: function(url) {
		var req = {
			url: 'http://rancher-metadata/latest/' + url,
			headers: {
				'Accept': 'application/json'
			}
		};

		return new Promise(function (resolve, reject) {
			request(req, function (error, response, body) {
				if (!error && response.statusCode == 200) {
					resolve(JSON.parse(body));
				} else {
					reject('Metadata - ' + error);
				}
			});
		});
	},

	getVersion: function() {
		return this.makeRequest('version');
	},

	getHosts: function() {
		return this.makeRequest('hosts');
	},

	getContainers: function() {
		return this.makeRequest('containers');
	},

	getStack: function() {
		return this.makeRequest('self/stack');
	}

}

module.exports = new metadata();
