#!/usr/bin/env node

const pkg = require('./package.json');
const log = require('yalm');
const config = require('yargs')
    .env('SIMPLEHUE2MQTT')
    .usage(pkg.name + ' ' + pkg.version + '\n' + pkg.description + '\n\nUsage: $0 [options]')
    .describe('verbosity', 'possible values: "error", "warn", "info", "debug"')
    .describe('name', 'instance name. used as mqtt client id and as prefix for connected topic')
    .describe('mqtt-url', 'mqtt broker url. See https://github.com/mqttjs/MQTT.js#connect-using-a-url')
    .describe('polling-interval', 'polling interval (in ms) for status updates')
    .describe('bridge-address', 'Hue bridge address')
    .describe('bridge-username', 'Hue bridge username')
    .alias({
        h: 'help',
        m: 'mqtt-url',
        b: 'bridge-address',
        u: 'bridge-username',
        v: 'verbosity'
    })
    .default({
        name: 'hue',
        'mqtt-url': 'mqtt://127.0.0.1',
        'polling-interval': 3000
    })
    .version()
    .help('help')
    .argv;
const MqttSmarthome = require('mqtt-smarthome-connect');
const Timer = require('yetanothertimerlibrary');
const rp = require('request-promise');

log.setLevel(config.verbosity);
log.info(pkg.name + ' ' + pkg.version + ' starting');
log.debug("loaded config: ", config);

log.info('mqtt trying to connect', config.mqttUrl);
const mqtt = new MqttSmarthome(config.mqttUrl, {
    logger: log,
    will: {topic: config.name + '/maintenance/_bridge/online', payload: 'false', retain: true}
});
mqtt.connect();

mqtt.on('connect', () => {
    log.info('mqtt connected', config.mqttUrl);
    mqtt.publish(config.name + '/maintenance/_bridge/online', 'true', {retain: true});
});

var polling = new Timer(() => {
	getLights().then(lights => {
		Object.keys(lights).forEach(id => {
			let light = lights[id].state;

			if ( light.reachable ) {
				mqtt.publish(config.name + "/maintenance/" + id + "/online", true);
				if ( 'bri' in light ) {
					if ( 'colormode' in light ) {
						switch (light.colormode) {
							case 'hs':
								mqtt.publish(config.name + "/status/" + id, {
									'val':light.on ? light.bri/254 : 0,
									'hue':light.hue / 65535,
									'sat':light.sat / 254
								});
								break;
							case 'ct':
								mqtt.publish(config.name + "/status/" + id, {
									'val':light.on ? light.bri/254 : 0,
									'ct':light.ct
								});
								break;
							case 'xy':
								//
								break;
						}
					}
				} else {
					mqtt.publish(config.name + "/status/" + id, {'val': light.on});
				}
			} else {
				mqtt.publish(config.name + "/maintenance/" + id + "/online", false);
			}
		});
	}).catch(error => {
		log.error( error );
	});
}).start(config.pollingInterval);

mqtt.subscribe(config.name + "/set/+", (topic, message, wildcard) => {
	let id = wildcard[0];

	// State 
	let state = {};

	// Extract value
	if (typeof message === 'object') {
		if ('hue' in message) {
			state.on = true;
			state.hue = Math.trunc(message.hue * 65535);
		}
		if ('sat' in message) {
			state.on = true;
			state.sat = Math.trunc(message.sat * 254);
		}
		if ('ct' in message) {
			state.on = true;
			state.ct = message.ct;
		}
		if ('val' in message) {
			if (typeof message.val === 'number') {
				state.on = message.val != false;
				state.bri = Math.trunc(message.val * 254);
			} else {
				if (message.val == true) state.on = true;
				if (message.val == false) state.on = false;
			}
		}
	} else {
		if (typeof message === 'number') {
			state.on = message != false;
			state.bri = Math.trunc(message * 254);
		} else {
			if (message == true) state.on = true;
			if (message == false) state.on = false;
		}
	}

	log.debug(state);
	setLights(id,state).then().catch();
	polling.exec();
});

function getLights() {
	return new Promise(function(resolve, reject) {
		rp({
			uri: "http://" + config.bridgeAddress + "/api/" + config.bridgeUsername + "/lights",
			json: true
		}).then(function (response) {
			if ( typeof response === "object" ) {
				resolve(response);
			} else if ( typeof response === "array" ) {
				reject(response[0].error);
			} else {
				reject();
			}
		}).catch(function (err) {
			reject(err);
		});
	});
}
function setLights(id, state) {
	return new Promise(function(resolve, reject) {
		rp({
			method: "PUT",
			uri: "http://" + config.bridgeAddress + "/api/" + config.bridgeUsername + "/lights/" + id + "/state",
			body: state,
			json: true
		}).then(function (response) {
			var allSuccess = true;
			response.forEach( (dataset) => {
				if ( typeof dataset["success"] !== "undefined" ) {
					allSuccess &= true;
				} else {
					allSuccess = false;
				}
			});

			if (allSuccess) {
				resolve("success");
			} else {
				reject(response);
			}
		}).catch(function (err) {
			reject(err);
		});
	});
}
