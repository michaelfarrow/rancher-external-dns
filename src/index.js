
var Promise = require('promise');
var moment = require('moment');
var metadata = require('./metadata');
var cattle = require('./cattle');
var request = require('request');
var http = require('http');
var _s = require('underscore.string');

console.log('Starting external DNS service');

if(!process.env.ROOT_DOMAIN)
	throw new Error('Root domain not supplied');

if(!process.env.DOMAIN_PREFIX)
	process.env.DOMAIN_PREFIX = 'rancher';

var interval = process.env.UPDATE_INTERVAL || 10;
var forceUpdateInterval = process.env.FORCE_UPDATE_INTERVAL || 60;
var envProvider = process.env.PROVIDER || 'digitalocean';
var version = 'init';
var lastUpdated = moment();
var healthCheckPort = 1000;

var provider = require('./providers/' + envProvider);

var queueNextRun = function() {
	setTimeout(run, interval * 1000);
};

var addRemoveProviderRecords = function(domainRecords, rancherRecords) {
	var tasks = [];

	var finalRecords = [];
	var allowed = ['A', 'SRV', 'CNAME'];

	for(i in domainRecords){
		var record = domainRecords[i];

		if(allowed.indexOf(record.type) == -1)
			continue;

		switch(record.type) {
			case 'A':
			case 'CNAME':
				if(_s.startsWith(record.name, process.env.DOMAIN_PREFIX + '.'))
					finalRecords.push(record);
				break;
			case 'SRV':
				if(_s.startsWith(record.name, '_' + process.env.DOMAIN_PREFIX + '_'))
					finalRecords.push(record);
				break;
		}
	}

	for(var i in finalRecords){
		var domainRecord = finalRecords[i];
		var remove = true;

		for(var j in rancherRecords) {
			var rancherRecord = rancherRecords[j];

			if( domainRecord.type == rancherRecord.type
				&& domainRecord.name == rancherRecord.name
				&& domainRecord.data == rancherRecord.data
				&& domainRecord.port == rancherRecord.port
			) {
				remove = false;
				rancherRecords.splice(j, 1);
				break;
			}
		}

		if(remove) {
			console.log('removing #' + domainRecord.id);
			tasks.push(provider.removeDomainRecord(domainRecord.id));
		}

	}

	for(var i in rancherRecords) {
		var rancherRecord = rancherRecords[i];

		switch(rancherRecord.type) {
			case 'A':
			case 'CNAME':
				console.log('adding %s %s: %s', rancherRecord.type, rancherRecord.name, rancherRecord.data);
				tasks.push(provider.createDomainRecord(
					rancherRecord.type,
					rancherRecord.name,
					rancherRecord.data
				));
				if(rancherRecord.stack && rancherRecord.service) {
					tasks.push(cattle.createExternalDnsEvent(
						rancherRecord.stack,
						rancherRecord.service,
						rancherRecord.name + '.' + process.env.ROOT_DOMAIN
					));
				}
				break;
			case 'SRV':
				console.log('adding %s %s:%s %s', rancherRecord.type, rancherRecord.name, rancherRecord.port, rancherRecord.data);
				tasks.push(provider.createDomainSrvRecord(
					rancherRecord.name,
					rancherRecord.data,
					rancherRecord.port
				));
				break;
		}
	}

	return Promise.all(tasks);
};

var updateProvider = function(rancherRecords) {
	return Promise.all([
		provider.checkDomainExists(),
		provider.getDomainRecords()
	]).then(function(res){
		var domainRecords = res[1];
		return addRemoveProviderRecords(domainRecords, rancherRecords);
	}).then(function(){
		lastUpdated = moment();
	}, function(error){
		console.log('Failed to update DNS records:', error);
	});
};

var compareHostsWithContainers = function(res) {
	var hosts = res[0];
	var containers = res[1];
	var stack = res[2];
	var rancherRecords = [];
	var port_pattern = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}\:([0-9]{1,5})\:[0-9]{1,5}\/(tcp|udp)$/;

	for(var i in hosts) {
		var host = hosts[i];

		var host_info_parts = [
			process.env.DOMAIN_PREFIX,
			stack.environment_name,
			'host',
			host.name
		];

		var subdomain = host_info_parts.join('.').toLowerCase();

		host.data = subdomain + '.' + process.env.ROOT_DOMAIN;

		rancherRecords.push({
			type: 'A',
			name: subdomain.toLowerCase(),
			data: host.agent_ip,
			port: null,
			stack: null,
			service: null
		});

	}

	for(var i in containers) {
		var container = containers[i];

		if(!container.service_name)
			continue;

		if(container.ports.length == 0)
			continue;

		for(var j in hosts){
			var host = hosts[j];

			if(host.uuid == container.host_uuid){
				var service_info_parts = [
					process.env.DOMAIN_PREFIX,
					stack.environment_name,
					container.stack_name,
					container.service_name
				];

				var subdomain = service_info_parts.join('.').toLowerCase();
				var srv_prefix = '_' + service_info_parts.join('_').toLowerCase();

				for(var k in container.ports) {
					var port_info = container.ports[k];
					var match = port_pattern.exec(port_info);

					if(match) {
						rancherRecords.push({
							type: 'SRV',
							name: srv_prefix + '._' + match[2],
							data: host.data,
							port: match[1],
							stack: null,
							service: null
						});
					}
				}

				rancherRecords.push({
					type: 'CNAME',
					name: subdomain.toLowerCase(),
					data: host.data,
					port: null,
					stack: container.stack_name,
					service: container.service_name
				});
			}
		}
	}

	return new Promise(function (resolve, reject) {
		resolve(rancherRecords);
	});
};

var doUpdate = function() {
	return Promise.all([
		metadata.getHosts(),
		metadata.getContainers(),
		metadata.getStack()
	]).then(compareHostsWithContainers)
	.then(updateProvider);
};

var checkUpdate = function(newVersion){
	var update = false;

	if(version != newVersion){
		console.log('Version has been changed. Old version: ' + version + '. New version: ' + newVersion + '.');
		version = newVersion;
		update = true;
	} else if (moment().diff(lastUpdated, 'seconds') > forceUpdateInterval){
		console.log('Executing force update as version hasn\'t been changed in: ' + forceUpdateInterval + ' seconds');
		update = true;
	}

	return new Promise(function (resolve, reject) {
		if(update) {
			resolve();
		}else{
			reject("No update needed");
		}
	});
}

var healthCheck = function(request, response) {
	var head = {'Content-Type': 'text/plain'};

	Promise.all([
		metadata.getStack(),
		provider.testConnect(),
		cattle.testConnect()
	]).then(function() {
		response.writeHead(200, head);
		response.end('OK');
	}, function(error){
		response.writeHead(500, head);
		response.end('FAIL');
	});
}

var run = function() {
	metadata.getVersion()
		.then(checkUpdate)
		.then(doUpdate)
		.finally(queueNextRun);
}

run();

var server = http.createServer(healthCheck);

server.listen(healthCheckPort, function(){
    console.log("Healthcheck handler is listening on: %s", healthCheckPort);
});

