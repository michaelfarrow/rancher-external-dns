
var doApi = require('digio-api');
var Promise = require('promise');
var _s = require('underscore.string');

var digitalocean = function(){
	if(!process.env.DO_ACCESS_TOKEN)
		throw new Error('DigitalOcean API key not supplied');

	this.api = new doApi(process.env.DO_ACCESS_TOKEN);
	this.domain = process.env.ROOT_DOMAIN;
}

digitalocean.prototype = {
	api: null,

	checkDomainExists: function() {
		var api = this.api;
		var domain = this.domain;

		return new Promise(function (resolve, reject) {
			api.domains.get(domain)
				.do(function (err, data) {
					if(err) {
						reject(err);
					} else {
						resolve(data);
					}
				});
		});
	},

	getDomainRecordsPage: function(subdomain, page) {
		var api = this.api;
		var domain = this.domain;
		var that = this;

		return new Promise(function (resolve, reject) {
			api.domains.list_records(domain)
				.page(page)
				.do(function (err, data) {
					if(err) {
						reject(err);
					} else {
						if(data.domain_records.length != 0){
							that.getDomainRecordsPage(subdomain, page + 1)
								.then(function(records){
									resolve(data.domain_records.concat(records));
								}, function(err){
									reject(err);
								});
						}else{
							resolve([]);
						}
					}
				});
		});
	},

	testConnect: function() {
		var api = this.api;

		return new Promise(function (resolve, reject) {
			api.domains.list()
				.do(function (err, data) {
					if(err) {
						reject('Provider DigitalOcean - ' + err.message);
					} else {
						resolve('OK');
					}
				});
		});
	},

	filterDomainRecords: function(records) {
		return new Promise(function (resolve, reject) {
			for(var i in records) {
				var record = records[i];
				var ip_pattern = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
				var domain = process.env.ROOT_DOMAIN;

				switch(record.type) {
					case 'CNAME':
					case 'SRV':
						if( !record.data.match(ip_pattern)
							&& !_s.endsWith(record.name, domain))
							record.data += '.' + domain;
						break;
					}
			}

			resolve(records);
		});
	},

	getDomainRecords: function(subdomain) {
		return this.getDomainRecordsPage(subdomain, 1)
		.then(this.filterDomainRecords);
	},

	createDomainRecord: function(type, subdomain, data) {
		var api = this.api;
		var domain = this.domain;

		if(type == 'CNAME')
			data += '.'

		return new Promise(function (resolve, reject) {
			api.domains.create_record(domain, type)
				.name(subdomain)
				.data(data)
				.do(function (err, data) {
					if(err) {
						reject(err);
					} else {
						resolve(data);
					}
				});
		});
	},

	createDomainSrvRecord: function(subdomain, data, port) {
		var api = this.api;
		var domain = this.domain;

		return new Promise(function (resolve, reject) {
			api.domains.create_record(domain, 'SRV')
				.name(subdomain)
				.data(data + '.')
				.priority(0)
				.port(port)
				.weight(0)
				.do(function (err, data) {
					if(err) {
						reject(err);
					} else {
						resolve(data);
					}
				});
		});
	},

	removeDomainRecord: function(id) {
		var api = this.api;
		var domain = this.domain;

		return new Promise(function (resolve, reject) {
			api.domains.delete_record(domain, id)
				.do(function (err, data) {
					if(err) {
						reject(err);
					} else {
						resolve(data);
					}
				});
		});
	}

}

module.exports = new digitalocean();
