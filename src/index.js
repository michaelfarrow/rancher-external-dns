
var Promise = require('promise');
var moment = require('moment');
var metadata = require('./metadata');
var cattle = require('./cattle');
var request = require('request');
var http = require('http');

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

	for(var i in domainRecords){
		var domainRecord = domainRecords[i];
		var remove = true;

		for(var j in rancherRecords) {
			var rancherRecord = rancherRecords[j];

			if( domainRecord.name == rancherRecord.name
				&& domainRecord.data == rancherRecord.ip
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
		console.log('adding ' + rancherRecord.name + ': ' + rancherRecord.ip);
		tasks.push(provider.createDomainRecord(
			rancherRecord.name,
			rancherRecord.ip
		));
		tasks.push(cattle.createExternalDnsEvent(
			rancherRecord.stack,
			rancherRecord.service,
			rancherRecord.name + '.' + process.env.ROOT_DOMAIN
		));
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

	for(var i in containers){
		var container = containers[i];

		if(!container.service_name)
			continue;

		if(container.ports.length == 0)
			continue;

		for(var j in hosts){
			var host = hosts[j];

			if(host.uuid == container.host_uuid){
				var subdomain = process.env.DOMAIN_PREFIX
					+ '.' + stack.environment_name
					+ '.' + container.stack_name
					+ '.' + container.service_name;

				rancherRecords.push({
					name: subdomain.toLowerCase(),
					ip: host.agent_ip,
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
	}, function(error, something, somethingelse){
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

