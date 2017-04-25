const debug = require('debug')('chrome-remote-js:client-execution');

module.exports = class ClientExecution {
    constructor(events) {
        this.events = events;
        this.requests = {};
        this.timeouts = new WeakMap();
        this.first;
        this.cookies = [];

        this.networkRequestWillBeSent = this.networkRequestWillBeSent.bind(this);
        this.networkLoadingFinished = this.networkLoadingFinished.bind(this);
        this.networkResponseReceived = this.networkResponseReceived.bind(this);

        this.events.on('Network.requestWillBeSent', this.networkRequestWillBeSent);
        this.events.on('Network.loadingFailed', this.networkLoadingFinished);
        this.events.on('Network.loadingFinished', this.networkLoadingFinished)
        this.events.on('Network.responseReceived', this.networkResponseReceived)
    }

    slide() {
        if (this.timeout) {
            clearTimeout(this.timeout);
        }

        this.timeout = setTimeout(() => {
            this.cleanUp();
            //throw new Error('Timed out!');
            process.exit(1);
        }, 5000);
    }

    cleanUp() {
        clearTimeout(this.timeout);

        this.events.removeListener('Network.requestWillBeSent', this.networkRequestWillBeSent);
        this.events.removeListener('Network.loadingFailed', this.networkLoadingFinished);
        this.events.removeListener('Network.loadingFinished', this.networkLoadingFinished);
        this.events.removeListener('Network.responseReceived', this.networkResponseReceived);
    }

    firePageLoaded(url) {
        debug('Wait a sec to make sure no more request are going to be executed.')
        this.timeout = setTimeout(() => {
            const payload = {
                url: url,
                initialRequest: this.first,
                cookies: Array.from(new Set(this.cookies))
            };

            //console.error('emitting: finitus', JSON.stringify(payload));

            this.events.emit('finitus', payload);

            this.cleanUp();
        }, 2000);

    }

    networkRequestWillBeSent(data) {
        this.first || (this.first = data);

        if(data.params.frameId !== this.first.params.frameId) {
            return;
        }

        // Add this request to the collection
        this.requests[data.params.requestId] = data;

        debug(`Request [${data.params.requestId}] will be sent`)
    }

    networkResponseReceived(data) {
        try {
            if (data.params.response.requestHeaders.Cookie)
                this.cookies.push(data.params.response.requestHeaders.Cookie);
        } catch (e) {
            // ok
        }
    }

    networkLoadingFinished(data) {
        this.slide();

        clearTimeout(this.timeout); // Clears timeout that waits for additional requests
        debug(`Request [${data.params.requestId}] finished`);
        const request = this.requests[data.params.requestId];
        clearTimeout(this.timeouts.get(request)); // Clears timeout for request
        this.timeouts.delete(request);
        delete this.requests[data.params.requestId]; // Deletes reference to request

        const requestsLeft = Object.keys(this.requests).length; // Gets current count of requests that are still pending

        if (requestsLeft === 0) { // If no requests are pending, set timeout to make sure others have time to start.
            this.firePageLoaded(request && request.params.documentURL);
        } else {

        }
    }
}