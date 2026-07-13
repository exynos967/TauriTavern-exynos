import assert from 'node:assert/strict';
import test from 'node:test';

import { EventEmitter } from '../src/lib/eventemitter.js';

test('event emitter reports listener duration only when profiler hook is installed', async () => {
    const emitter = new EventEmitter();
    const samples = [];
    const listener = async function measuredListener() {};
    emitter.on('character_message_rendered', listener);
    globalThis.localStorage = { getItem: () => null };
    globalThis.__TAURITAVERN_PERF_EVENT_LISTENER__ = sample => samples.push(sample);

    try {
        await emitter.emit('character_message_rendered');
        assert.equal(samples.length, 1);
        assert.equal(samples[0].event, 'character_message_rendered');
        assert.equal(samples[0].listener, listener);
        assert.equal(samples[0].index, 0);
        assert.ok(samples[0].durationMs >= 0);
        assert.ok(samples[0].synchronousDurationMs >= 0);
        assert.ok(samples[0].waitDurationMs >= 0);
        assert.match(samples[0].registration.id, /^listener-\d+$/);
        assert.match(samples[0].registration.stableKey, /^character_message_rendered\|on\|tests\/eventemitter-performance\.test\.mjs\|\d+\|\d+\|measuredListener$/);
        assert.equal(samples[0].registration.method, 'on');
        assert.equal(samples[0].registration.listenerName, 'measuredListener');
        assert.match(samples[0].registration.source.modulePath, /tests\/eventemitter-performance\.test\.mjs$/);
    } finally {
        delete globalThis.__TAURITAVERN_PERF_EVENT_LISTENER__;
        delete globalThis.localStorage;
    }
});

test('event emitter avoids stack capture for non-critical events', async () => {
    const emitter = new EventEmitter();
    const samples = [];
    globalThis.localStorage = { getItem: () => null };
    globalThis.__TAURITAVERN_PERF_EVENT_LISTENER__ = sample => samples.push(sample);
    emitter.on('low_frequency_test_event', function lowFrequencyListener() {});

    try {
        await emitter.emit('low_frequency_test_event');
        assert.equal(samples[0].registration.source, null);
        assert.equal(samples[0].registration.stableKey, null);
        assert.equal(samples[0].registration.method, 'on');
    } finally {
        delete globalThis.__TAURITAVERN_PERF_EVENT_LISTENER__;
        delete globalThis.localStorage;
    }
});

test('event emitter preserves registration modes and listener order', async () => {
    const emitter = new EventEmitter();
    const samples = [];
    const calls = [];
    globalThis.localStorage = { getItem: () => null };
    globalThis.__TAURITAVERN_PERF_EVENT_LISTENER__ = sample => samples.push(sample);

    try {
        emitter.on('ordered', function middle() { calls.push('middle'); });
        emitter.makeFirst('ordered', function first() { calls.push('first'); });
        emitter.makeLast('ordered', function last() { calls.push('last'); });
        emitter.once('ordered', function onceOnly() { calls.push('once'); });

        await emitter.emit('ordered');
        await emitter.emit('ordered');

        assert.deepEqual(calls, ['first', 'middle', 'last', 'once', 'first', 'middle', 'last']);
        assert.deepEqual(samples.slice(0, 4).map(sample => sample.registration.method), [
            'makeFirst',
            'on',
            'makeLast',
            'once',
        ]);
        assert.equal(samples[3].registration.listenerName, 'onceOnly');
    } finally {
        delete globalThis.__TAURITAVERN_PERF_EVENT_LISTENER__;
        delete globalThis.localStorage;
    }
});
