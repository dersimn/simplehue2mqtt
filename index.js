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
    .demandOption([
        'bridge-address',
        'bridge-username'
    ])
    .version()
    .help('help')
    .argv;
const MqttSmarthome = require('mqtt-smarthome-connect');
const Yatl = require('yetanothertimerlibrary');
const rp = require('request-promise-native');
const {default: PQueue} = require('p-queue');
const queue = new PQueue({concurrency: 5}); // Hue Bridge 1: everything >5 results in Error: read ECONNRESET
const delay = require('delay');

log.setLevel(config.verbosity);
log.info(pkg.name + ' ' + pkg.version + ' starting');
log.debug('loaded config: ', config);

log.info('mqtt trying to connect', config.mqttUrl);
const mqtt = new MqttSmarthome(config.mqttUrl, {
    logger: log,
    will: {topic: config.name + '/maintenance/_bridge/online', payload: 'false', retain: true}
});
mqtt.connect();

mqtt.on('connect', () => {
    log.info('mqtt connected', config.mqttUrl);
    mqtt.publish(config.name + '/maintenance/_bridge/online', true, {retain: true});
});

const polling = new Yatl.Timer(() => {
    if (!queue.pending) {
        queue.add(pollLightsOnce);
    }
}).start(config.pollingInterval);

mqtt.subscribe(config.name + '/set/+', (topic, message, wildcard) => {
    const id = wildcard[0];

    // State
    const state = {};

    // Extract value
    if (typeof message === 'object') {
        if ('transitiontime' in message) {
            state.transitiontime = Math.trunc(message.transitiontime / 100);
        }

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
                state.on = message.val !== 0;
                if (message.val !== 0) {
                    state.bri = Math.trunc(message.val * 254);
                }
            } else {
                if (message.val === true) {
                    state.on = true;
                }

                if (message.val === false) {
                    state.on = false;
                }
            }
        }
    } else if (typeof message === 'number') {
        state.on = message !== 0;
        if (message !== 0) {
            state.bri = Math.trunc(message * 254);
        }
    } else {
        if (message === true) {
            state.on = true;
        }

        if (message === false) {
            state.on = false;
        }
    }

    queue.add(() => setLights(id, state).then(() => {
        log.debug(id, '>', state);
    }).catch(error => {
        log.error(error.name, error.message);
        log.debug(error);
    }));
    queue.add(async () => {
        await delay(100);
        pollLightsOnce();
    });
});

function pollLightsOnce() {
    getLights().then(lights => {
        Object.keys(lights).forEach(id => {
            const light = lights[id].state;

            if (light.reachable) {
                mqtt.publish(config.name + '/maintenance/' + id + '/online', true);
                if ('bri' in light) {
                    if ('colormode' in light) {
                        switch (light.colormode) {
                            case 'hs':
                                mqtt.publish(config.name + '/status/' + id, {
                                    val: light.on ? light.bri / 254 : 0,
                                    hue: light.hue / 65535,
                                    sat: light.sat / 254
                                });
                                break;
                            case 'ct':
                                mqtt.publish(config.name + '/status/' + id, {
                                    val: light.on ? light.bri / 254 : 0,
                                    ct: light.ct
                                });
                                break;
                            case 'xy':
                                //
                                break;
                            default:
                                break;
                        }
                    }
                } else {
                    mqtt.publish(config.name + '/status/' + id, {val: light.on});
                }
            } else {
                mqtt.publish(config.name + '/maintenance/' + id + '/online', false);
            }
        });
    }).catch(error => {
        log.error(error.name, error.message);
        log.debug(error);
    });
}

function getLights() {
    return new Promise(((resolve, reject) => {
        rp({
            uri: 'http://' + config.bridgeAddress + '/api/' + config.bridgeUsername + '/lights',
            json: true,
            timeout: config.pollingInterval / 2
        }).then(response => {
            if (typeof response === 'object') {
                resolve(response);
            } else if (Array.isArray(response)) {
                reject(response[0].error);
            } else {
                reject();
            }
        }).catch(error => {
            reject(error);
        });
    }));
}

function setLights(id, state) {
    return new Promise(((resolve, reject) => {
        rp({
            method: 'PUT',
            uri: 'http://' + config.bridgeAddress + '/api/' + config.bridgeUsername + '/lights/' + id + '/state',
            body: state,
            json: true,
            timeout: config.pollingInterval / 2
        }).then(response => {
            let allSuccess = true;
            response.forEach(dataset => {
                if ('success' in dataset) {
                    allSuccess &= true;
                } else {
                    allSuccess = false;
                }
            });

            if (allSuccess) {
                resolve(true);
            } else {
                reject(response);
            }
        }).catch(error => {
            reject(error);
        });
    }));
}
