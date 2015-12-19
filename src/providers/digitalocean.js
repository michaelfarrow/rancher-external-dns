
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

	filterDomainRecords: function(records) {
		var finalRecords = [];

		for(i in records){
			var record = records[i];

			if(_s.startsWith(record.name, process.env.DOMAIN_PREFIX + '.')){
				finalRecords.push(record);
			}
		}

		return new Promise(function (resolve, reject) {
			resolve(finalRecords);
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

	getDomainRecords: function(subdomain) {
		return this.getDomainRecordsPage(subdomain, 1)
			.then(this.filterDomainRecords);
	},

	createDomainRecord: function(subdomain, ip) {
		var api = this.api;
		var domain = this.domain;

		return new Promise(function (resolve, reject) {
			api.domains.create_record(domain, 'A')
				.name(subdomain)
				.data(ip)
				.do(function (err, data) {
					if(err) {
						reject(err);
					} else {
						resolve(data);
					}
				});
		});
	},

	updateDomainRecord: function(id, ip) {
		var api = this.api;
		var domain = this.domain;

		return new Promise(function (resolve, reject) {
			api.domains.update_record(domain, id)
				.data(ip)
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
