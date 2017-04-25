const ClientExecution = require('./src/client-execution');
const request = require('request');
const WebSocket = require('ws');
const makeSure = require('msjs');
const debug = require('debug')('chrome-remote-js');
const shortid = {
    generate: () => {
        this.id = this.id || 0;
        return this.id++;
    }
};

module.exports = class Chrome {
    constructor(options) {
        this.options = options || { debuggerUrl: 'http://localhost:9222' };

        makeSure(this.options).has('debuggerUrl');

        this.events = new (require('events').EventEmitter);
    }

    async spawn() {
        const spawn = require('child_process').spawn;
        const ls = spawn('chromium-browser', ['--incognito', `-remote-debugging-port=${this.options.debuggerUrl.split(':')[2]}`]);

        ls.stdout.pipe(process.stdout)

        ls.stderr.pipe(process.stderr);

        ls.on('close', (code) => {
            debug(`child process exited with code ${code}`);
        });

        process.once('SIGHUP', () => {
            ls.kill('SIGHUP');
        });
        process.once('exit', () => {
            ls.kill('SIGHUP');
        });
        process.once('SIGINT', () => {
            ls.kill('SIGHUP');
        });

        return await new Promise((resolve, reject) => {
            const assertOnline = () => {
                debug('Waiting for debugger to come online.')
                request.get(this.options.debuggerUrl, err => {
                    if (err) {
                        process.nextTick(() => {
                            assertOnline();
                        })
                        return;
                    }
                    resolve();
                });
            }

            assertOnline();
        });
    }
    async _send(payload, customEventHandler) {
        return await new Promise((resolve, reject) => {
            payload.id = shortid.generate();

            if (customEventHandler) {
                customEventHandler(resolve, reject);
            } else {
                this.events.once(payload.id, data => {
                    if (data.error) {
                        throw new Error(JSON.stringify(data));
                    }
                    //debug(data);
                    if (data.result.frameId) {
                        //debug(`waiting for [frameId:${data.result.frameId}]`)
                        this.events.once(`frameId:${data.result.frameId}`, request => {
                            //debug(`waiting for [requestId:${request.requestId}]`)
                            this.events.once(`requestId:${request.requestId}`, resolve);
                        });
                    } else {
                        resolve(data)
                    }
                });
            }

            this.connection.send(JSON.stringify(payload));
        })
    }
    async connect() {
        return await new Promise((resolve, reject) => {
            request.get(`${this.options.debuggerUrl}/json`, (err, res, body) => {
                const data = JSON.parse(body);
                debug(data)
                this.connection = new WebSocket(data[0].webSocketDebuggerUrl);

                this.connection.on('message', message => {
                    debug(`${message}\n`);
                    const data = JSON.parse(message);

                    if (data.method) {
                        this.events.emit(data.method, data);
                        return;
                    }

                    this.events.emit(data.id, data);
                });

                this.connection.on('open', () => {
                    Promise.all([
                        this._send({ method: 'Network.enable' }),
                        this._send({ method: 'Page.enable' }),
                        this._send({ method: 'DOM.enable' }),
                        //this._send({ method: `DOM.getDocument` }),
                    ]).then(resolve);
                })
            })
        })
    }

    async waitForPage(method, params, eventKey, condition) {
        new ClientExecution(this.events);
        return await this._send({
            method,
            params
        }, done => {
            const listener = finished => {
                if (condition) {
                    if (!condition(finished)) {
                        debug('condition not met');
                        return;
                    }
                }

                this.events.removeListener(eventKey, listener);
                done(finished);
            };

            this.events.on(eventKey, listener);
        });
    }

    async onchange(elementId) {
        return await this._send({ method: '' })
    }

    async open(url, eventKey, condition) {
        return await this.waitForPage('Page.navigate', { url: url }, eventKey, condition);
    }

    async eval(code, eventKey, condition, awaitPromise) {
        const payload = {
            expression: code
        }

        if (awaitPromise === true) {
            payload.awaitPromise = awaitPromise
        }

        if (eventKey) {
            return await this.waitForPage('Runtime.evaluate', payload, eventKey, condition);
        }
        return await this._send({ method: 'Runtime.evaluate', params: payload })
    }

    element(selector) {
        return {
            get: () => {
                return this
                    ._send({
                        method: `DOM.getDocument`
                    })
                    .then(doc => this._send({
                        method: `DOM.querySelector`,
                        params: {
                            nodeId: doc.result.root.nodeId,
                            selector: selector
                        }
                    }))
            },
            waitRemoved: () => {
                return this
                    ._send({
                        method: `DOM.getDocument`
                    })
                    .then(doc => this._send({
                        method: `DOM.querySelector`,
                        params: {
                            nodeId: doc.result.root.nodeId,
                            selector: selector
                        }
                    }))
                    .then(x => {
                        return new Promise(resolve => {
                            const listener = evt => {
                                if (evt.params.nodeId === x.result.nodeId) {
                                    this.events.removeListener('DOM.childNodeRemoved', listener);
                                    resolve(evt);
                                }
                            }
                            this.events.on('DOM.childNodeRemoved', listener);
                        });
                    })
            }
        }
    }

    type(text) {
        return this._send({
            method: 'Input.dispatchKeyEvent',
            params: {
                type: 'char',
                text: text[0]
            }
        })
    }
}