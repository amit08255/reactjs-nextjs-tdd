/* eslint-disable */
/**
 * XMLHttpRequest override class.
 * Inspired by https://github.com/marvinhagemeister/xhr-mocklet.
 */
import { until } from '@open-draft/until';
import { flattenHeadersObject, reduceHeadersObject, } from 'headers-utils';
import { createEvent } from './createEvent';
const createDebug = require('debug');
export const createXMLHttpRequestOverride = (middleware, XMLHttpRequestPristine) => {
    let debug = createDebug('XHR');
    return class XMLHttpRequestOverride {
        constructor() {
            this.requestHeaders = {};
            this.responseHeaders = {};
            // Collection of events modified by `addEventListener`/`removeEventListener` calls.
            this._events = [];
            /* Request state */
            this.UNSENT = 0;
            this.OPENED = 1;
            this.HEADERS_RECEIVED = 2;
            this.LOADING = 3;
            this.DONE = 4;
            this.onreadystatechange = null;
            /* Events */
            this.onabort = null;
            this.onerror = null;
            this.onload = null;
            this.onloadend = null;
            this.onloadstart = null;
            this.onprogress = null;
            this.ontimeout = null;
            this.url = '';
            this.method = 'GET';
            this.readyState = this.UNSENT;
            this.withCredentials = false;
            this.status = 200;
            this.statusText = 'OK';
            this.user = '';
            this.password = '';
            this.data = '';
            this.async = true;
            this.response = '';
            this.responseType = 'text';
            this.responseText = '';
            this.responseXML = null;
            this.responseURL = '';
            this.upload = null;
            this.timeout = 0;
        }
        triggerReadyStateChange(options) {
            if (this.onreadystatechange) {
                this.onreadystatechange.call(this, createEvent(options, this, 'readystatechange'));
            }
        }
        trigger(eventName, options) {
            debug('trigger', eventName);
            this.triggerReadyStateChange(options);
            const loadendEvent = this._events.find((event) => event.name === 'loadend');
            if (this.readyState === this.DONE && (this.onloadend || loadendEvent)) {
                const listener = this.onloadend || (loadendEvent === null || loadendEvent === void 0 ? void 0 : loadendEvent.listener);
                listener === null || listener === void 0 ? void 0 : listener.call(this, createEvent(options, this, 'loadend'));
            }
            // Call the direct callback, if present.
            const directCallback = this[`on${eventName}`];
            directCallback === null || directCallback === void 0 ? void 0 : directCallback.call(this, createEvent(options, this, eventName));
            // Check in the list of events attached via `addEventListener`.
            for (const event of this._events) {
                if (event.name === eventName) {
                    event.listener.call(this, createEvent(options, this, eventName));
                }
            }
            return this;
        }
        reset() {
            debug('reset');
            this.readyState = this.UNSENT;
            this.status = 200;
            this.statusText = '';
            this.requestHeaders = {};
            this.responseHeaders = {};
            this.data = '';
            this.response = null;
            this.responseText = null;
            this.responseXML = null;
        }
        async open(method, url, async, user, password) {
            debug = createDebug(`XHR ${method} ${url}`);
            debug('open', { method, url, async, user, password });
            this.reset();
            this.readyState = this.OPENED;
            if (typeof url === 'undefined') {
                this.url = method;
                this.method = 'GET';
            }
            else {
                this.url = url;
                this.method = method;
                this.async = !!async;
                this.user = user || '';
                this.password = password || '';
            }
        }
        send(data) {
            debug('send %s %s', this.method, this.url);
            this.readyState = this.LOADING;
            this.data = data || '';
            let url;
            try {
                url = new URL(this.url);
            }
            catch (error) {
                // Assume a relative URL, if construction of a new `URL` instance fails.
                // Since `XMLHttpRequest` always executed in a DOM-like environment,
                // resolve the relative request URL against the current window location.
                url = new URL(this.url, window.location.href);
            }
            const requestHeaders = reduceHeadersObject(this.requestHeaders, (headers, name, value) => {
                headers[name.toLowerCase()] = value;
                return headers;
            }, {});
            debug('request headers', requestHeaders);
            // Create an intercepted request instance exposed to the request intercepting middleware.
            const req = {
                url,
                method: this.method,
                body: this.data,
                headers: requestHeaders,
            };
            debug('awaiting mocked response...');
            Promise.resolve(until(async () => middleware(req, this))).then(([middlewareException, mockedResponse]) => {
                // When the request middleware throws an exception, error the request.
                // This cancels the request and is similar to a network error.
                if (middlewareException) {
                    debug('middleware function threw an exception!');
                    this.abort();
                    // No way to propagate the actual error message.
                    this.trigger('error');
                    return;
                }
                // Return a mocked response, if provided in the middleware.
                if (mockedResponse) {
                    debug('recieved mocked response', mockedResponse);
                    this.status = mockedResponse.status || 200;
                    this.statusText = mockedResponse.statusText || 'OK';
                    this.responseHeaders = mockedResponse.headers
                        ? flattenHeadersObject(mockedResponse.headers)
                        : {};
                    // Mark that response headers has been received
                    // and trigger a ready state event to reflect received headers
                    // in a custom `onreadystatechange` callback.
                    this.readyState = this.HEADERS_RECEIVED;
                    this.triggerReadyStateChange();
                    this.response = mockedResponse.body || '';
                    this.responseText = mockedResponse.body || '';
                    // Trigger a progress event based on the mocked response body.
                    this.trigger('progress', {
                        loaded: this.response.length,
                        total: this.response.length,
                    });
                    // Explicitly mark the request as done, so its response never hangs.
                    // @see https://github.com/mswjs/node-request-interceptor/issues/13
                    this.readyState = this.DONE;
                    this.trigger('loadstart');
                    this.trigger('load');
                    this.trigger('loadend');
                }
                else {
                    debug('no mocked response received');
                    // Perform an original request, when the request middleware returned no mocked response.
                    const originalRequest = new XMLHttpRequestPristine();
                    debug('opening an original request %s %s', this.method, this.url);
                    originalRequest.open(this.method, this.url, this.async, this.user, this.password);
                    // Reflect a successful state of the original request
                    // on the patched instance.
                    originalRequest.onload = () => {
                        debug('original onload');
                        this.status = originalRequest.status;
                        this.statusText = originalRequest.statusText;
                        this.responseURL = originalRequest.responseURL;
                        this.responseType = originalRequest.responseType;
                        this.response = originalRequest.response;
                        this.responseText = originalRequest.responseText;
                        this.responseXML = originalRequest.responseXML;
                        debug('received original response status:', this.status, this.statusText);
                        debug('received original response body:', this.response);
                        this.trigger('loadstart');
                        this.trigger('load');
                    };
                    // Map callbacks given to the patched instance to the original request instance.
                    originalRequest.onabort = this.abort;
                    originalRequest.onerror = this.onerror;
                    originalRequest.ontimeout = this.ontimeout;
                    originalRequest.onreadystatechange = this.onreadystatechange;
                    debug('send', this.data);
                    originalRequest.send(this.data);
                }
            });
        }
        abort() {
            debug('abort');
            if (this.readyState > this.UNSENT && this.readyState < this.DONE) {
                this.readyState = this.UNSENT;
                this.trigger('abort');
            }
        }
        dispatchEvent() {
            return false;
        }
        setRequestHeader(name, value) {
            debug('set request header', name, value);
            this.requestHeaders[name] = value;
        }
        getResponseHeader(name) {
            debug('get response header', name);
            if (this.readyState < this.HEADERS_RECEIVED) {
                debug('cannot return a header: headers not received (state: %s)', this.readyState);
                return null;
            }
            return this.responseHeaders[name.toLowerCase()] || null;
        }
        getAllResponseHeaders() {
            debug('get all response headers');
            if (this.readyState < this.HEADERS_RECEIVED) {
                debug('cannot return headers: headers not received (state: %s)', this.readyState);
                return '';
            }
            return Object.entries(this.responseHeaders)
                .map(([name, value]) => `${name}: ${value} \r\n`)
                .join('');
        }
        addEventListener(name, listener) {
            debug('addEventListener', name, listener);
            this._events.push({
                name,
                listener,
            });
        }
        removeEventListener(name, listener) {
            debug('removeEventListener', name, listener);
            this._events = this._events.filter((storedEvent) => {
                return storedEvent.name !== name && storedEvent.listener !== listener;
            });
        }
        overrideMimeType() { }
    };
};