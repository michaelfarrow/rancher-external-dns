
var request = require('request');
var Promise = require('promise');

var cattle = function(){
	
	if(!process.env.CATTLE_URL)
		throw new Error('Cattle url not supplied');

	if(!process.env.CATTLE_ACCESS_KEY)
		throw new Error('Cattle access key not supplied');

	if(!process.env.CATTLE_SECRET_KEY)
		throw new Error('Cattle secret key not supplied');
};

cattle.prototype = {

	makeRequest: function(type, url, data) {
		return new Promise(function (resolve, reject) {
			request({
				method: type.toUpperCase(),
				url: process.env.CATTLE_URL + '/' + url
			}, function (error, response, body) {
				if (!error && (response.statusCode == 200 || response.statusCode == 201)) {
					resolve(JSON.parse(body));
				} else {
					reject('Cattle - ' + error);
				}
			})
			.auth(process.env.CATTLE_ACCESS_KEY, process.env.CATTLE_SECRET_KEY, false)
			.form(data);
		});
	},

	createExternalDnsEvent: function(stack, service, fqdn) {
		return this.makeRequest('post', 'externaldnsevents', {
			eventType: 'dns.update',
			externalId: fqdn,
			stackName: stack,
			serviceName: service,
			fqdn: fqdn
		});
	},

	testConnect: function() {
		return this.makeRequest('get', 'externaldnsevents', {});
	}

}

module.exports = new cattle();
