/* Polyfill indexOf. */
var indexOf;
var nextListenerRegistrationId = 1;
var listenerRegistrations = new WeakMap();

function sanitizeRegistrationSource(stack) {
    if (typeof stack !== 'string') {
        return null;
    }

    const lines = stack.split('\n');
    for (const line of lines) {
        if (line.includes('/lib/eventemitter.js') || line.includes('\\lib\\eventemitter.js')) {
            continue;
        }

        const match = line.match(/((?:https?|tauri|file):\/\/[^\s)]+?):(\d+):(\d+)/);
        if (!match) {
            continue;
        }

        try {
            const url = new URL(match[1]);
            const pathname = decodeURIComponent(url.pathname).replaceAll('\\', '/');
            const sourceMarker = pathname.lastIndexOf('/src/');
            const testMarker = pathname.lastIndexOf('/tests/');
            const modulePath = sourceMarker >= 0
                ? pathname.slice(sourceMarker + 5)
                : testMarker >= 0
                    ? pathname.slice(testMarker + 1)
                    : pathname.replace(/^\/+/, '');
            const extensionMatch = modulePath.match(/^scripts\/extensions\/(third-party\/[^/]+|[^/]+)/);
            return {
                modulePath,
                extensionId: extensionMatch?.[1] ?? null,
                line: Number(match[2]),
                column: Number(match[3]),
            };
        } catch {
            return null;
        }
    }

    return null;
}

function registerListener(event, listener, method, originalListener = listener) {
    if (typeof listener !== 'function') {
        return;
    }

    const registrationId = nextListenerRegistrationId++;
    const source = sanitizeRegistrationSource(new Error().stack);
    const listenerName = originalListener?.name || listener.name || '(anonymous)';
    const stableKey = source
        ? [event, method, source.modulePath, source.line, source.column, listenerName].join('|')
        : null;
    let eventRegistrations = listenerRegistrations.get(listener);
    if (!eventRegistrations) {
        eventRegistrations = new Map();
        listenerRegistrations.set(listener, eventRegistrations);
    }
    eventRegistrations.set(event, {
        id: `listener-${registrationId}`,
        stableKey,
        method,
        sequence: registrationId,
        listenerName,
        source,
    });
}

function getListenerRegistration(event, listener) {
    return listenerRegistrations.get(listener)?.get(event) ?? {
        id: null,
        stableKey: null,
        method: 'preexisting',
        sequence: null,
        listenerName: listener?.name || '(anonymous)',
        source: null,
    };
}

if (typeof Array.prototype.indexOf === 'function') {
    indexOf = function (haystack, needle) {
        return haystack.indexOf(needle);
    };
} else {
    indexOf = function (haystack, needle) {
        var i = 0, length = haystack.length, idx = -1, found = false;

        while (i < length && !found) {
            if (haystack[i] === needle) {
                idx = i;
                found = true;
            }

            i++;
        }

        return idx;
    };
};


/* Polyfill EventEmitter. */
/**
 * Creates an event emitter.
 * @param {string[]} autoFireAfterEmit Auto-fire event names
 */
var EventEmitter = function (autoFireAfterEmit = []) {
    this.events = {};
    this.autoFireLastArgs = new Map();
    this.autoFireAfterEmit = new Set(autoFireAfterEmit);
};

/**
 * Adds a listener to an event.
 * @param {string} event Event name
 * @param {function} listener Event listener
 * @returns
 */
EventEmitter.prototype.on = function (event, listener) {
    // Unknown event used by external libraries?
    if (event === undefined) {
        console.trace('EventEmitter: Cannot listen to undefined event');
        return;
    }

    if (typeof this.events[event] !== 'object') {
        this.events[event] = [];
    }

    this.events[event].push(listener);
    registerListener(event, listener, 'on');

    if (this.autoFireAfterEmit.has(event) && this.autoFireLastArgs.has(event)) {
        listener.apply(this, this.autoFireLastArgs.get(event));
    }
};

/**
 * Makes the listener the last to be called when the event is emitted
 * @param {string} event Event name
 * @param {function} listener Event listener
 */
EventEmitter.prototype.makeLast = function (event, listener) {
    if (typeof this.events[event] !== 'object') {
        this.events[event] = [];
    }

    const events = this.events[event];
    const idx = events.indexOf(listener);

    if (idx > -1) {
        events.splice(idx, 1);
    }

    events.push(listener);
    registerListener(event, listener, 'makeLast');

    if (this.autoFireAfterEmit.has(event) && this.autoFireLastArgs.has(event)) {
        listener.apply(this, this.autoFireLastArgs.get(event));
    }
}

/**
 * Makes the listener the first to be called when the event is emitted
 * @param {string} event Event name
 * @param {function} listener Event listener
 */
EventEmitter.prototype.makeFirst = function (event, listener) {
    if (typeof this.events[event] !== 'object') {
        this.events[event] = [];
    }

    const events = this.events[event];
    const idx = events.indexOf(listener);

    if (idx > -1) {
        events.splice(idx, 1);
    }

    events.unshift(listener);
    registerListener(event, listener, 'makeFirst');

    if (this.autoFireAfterEmit.has(event) && this.autoFireLastArgs.has(event)) {
        listener.apply(this, this.autoFireLastArgs.get(event));
    }
}

/**
 * Removes a listener from an event.
 * @param {string} event Event name
 * @param {function} listener Event listener
 */
EventEmitter.prototype.removeListener = function (event, listener) {
    var idx;

    if (typeof this.events[event] === 'object') {
        idx = indexOf(this.events[event], listener);

        if (idx > -1) {
            this.events[event].splice(idx, 1);
        }
    }
};

/**
 * Emits an event with optional arguments.
 * @param {string} event Event name
 */
EventEmitter.prototype.emit = async function (event) {
    let args = [].slice.call(arguments, 1);
    if (localStorage.getItem('eventTracing') === 'true') {
        console.trace('Event emitted: ' + event, args);
    } else {
        console.debug('Event emitted: ' + event);
    }

    let i, listeners, length;

    if (typeof this.events[event] === 'object') {
        listeners = this.events[event].slice();
        length = listeners.length;

        for (i = 0; i < length; i++) {
            const listener = listeners[i];
            const profiler = globalThis.__TAURITAVERN_PERF_EVENT_LISTENER__;
            const startedAt = profiler ? performance.now() : 0;
            let synchronousDurationMs = null;
            try {
                const result = listener.apply(this, args);
                synchronousDurationMs = profiler ? performance.now() - startedAt : null;
                await result;
            }
            catch (err) {
                synchronousDurationMs ??= profiler ? performance.now() - startedAt : null;
                console.error(err);
                console.trace('Error in event listener');
            }
            finally {
                const durationMs = profiler ? performance.now() - startedAt : 0;
                profiler?.({
                    event,
                    listener,
                    registration: getListenerRegistration(event, listener),
                    index: i,
                    durationMs,
                    synchronousDurationMs,
                    waitDurationMs: Math.max(0, durationMs - (synchronousDurationMs ?? durationMs)),
                });
            }
        }
    }

    if (this.autoFireAfterEmit.has(event)) {
        this.autoFireLastArgs.set(event, args);
    }
};

EventEmitter.prototype.emitAndWait = function (event) {
    let args = [].slice.call(arguments, 1);
    if (localStorage.getItem('eventTracing') === 'true') {
        console.trace('Event emitted: ' + event, args);
    } else {
        console.debug('Event emitted: ' + event);
    }

    let i, listeners, length;

    if (typeof this.events[event] === 'object') {
        listeners = this.events[event].slice();
        length = listeners.length;

        for (i = 0; i < length; i++) {
            try {
                listeners[i].apply(this, args);
            }
            catch (err) {
                console.error(err);
                console.trace('Error in event listener');
            }
        }
    }

    if (this.autoFireAfterEmit.has(event)) {
        this.autoFireLastArgs.set(event, args);
    }
};

EventEmitter.prototype.once = function (event, listener) {
    const wrapper = function g() {
        this.removeListener(event, g);
        listener.apply(this, arguments);
    };

    if (typeof this.events[event] !== 'object') {
        this.events[event] = [];
    }
    this.events[event].push(wrapper);
    registerListener(event, wrapper, 'once', listener);

    if (this.autoFireAfterEmit.has(event) && this.autoFireLastArgs.has(event)) {
        wrapper.apply(this, this.autoFireLastArgs.get(event));
    }
};

export { EventEmitter }
