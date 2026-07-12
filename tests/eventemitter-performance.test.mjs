import assert from 'node:assert/strict';
import test from 'node:test';

import { EventEmitter } from '../src/lib/eventemitter.js';

test('event emitter reports listener duration only when profiler hook is installed', async () => {
    const emitter = new EventEmitter();
    const samples = [];
    const listener = async function measuredListener() {};
    emitter.on('measured', listener);
    globalThis.localStorage = { getItem: () => null };
    globalThis.__TAURITAVERN_PERF_EVENT_LISTENER__ = sample => samples.push(sample);

    try {
        await emitter.emit('measured');
        assert.equal(samples.length, 1);
        assert.equal(samples[0].event, 'measured');
        assert.equal(samples[0].listener, listener);
        assert.equal(samples[0].index, 0);
        assert.ok(samples[0].durationMs >= 0);
    } finally {
        delete globalThis.__TAURITAVERN_PERF_EVENT_LISTENER__;
        delete globalThis.localStorage;
    }
});
