import assert from 'node:assert/strict';
import test from 'node:test';

import {
    computeProcessCpuPercent,
    computeThreadCpuSamples,
    createRuntimeDiagnostics,
    serializeLongAnimationFrame,
} from '../src/scripts/tauri/perf/runtime-diagnostics.js';

function replaceGlobals(values) {
    const originals = new Map();
    for (const [key, value] of Object.entries(values)) {
        originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
        Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    return () => {
        for (const [key, descriptor] of originals) {
            if (descriptor) {
                Object.defineProperty(globalThis, key, descriptor);
            } else {
                delete globalThis[key];
            }
        }
    };
}

test('runtime diagnostics computes CPU percent from system ticks when available', () => {
    assert.equal(computeProcessCpuPercent(
        { processCpuTicks: 140, systemCpuTicks: 1800, logicalCpuCount: 8 },
        { processCpuTicks: 100, systemCpuTicks: 1000, logicalCpuCount: 8 },
    ), 40);
});

test('runtime diagnostics falls back to wall time when Android hides system ticks', () => {
    assert.equal(computeProcessCpuPercent(
        {
            processCpuTicks: 175,
            systemCpuTicks: null,
            sampledAtUnixMs: 2500,
            clockTicksPerSecond: 100,
        },
        {
            processCpuTicks: 100,
            systemCpuTicks: null,
            sampledAtUnixMs: 1000,
            clockTicksPerSecond: 100,
        },
    ), 50);
});

test('runtime diagnostics leaves CPU percent unavailable without a valid clock', () => {
    assert.equal(computeProcessCpuPercent(
        { processCpuTicks: 120, systemCpuTicks: null, sampledAtUnixMs: 2000 },
        { processCpuTicks: 100, systemCpuTicks: null, sampledAtUnixMs: 1000 },
    ), null);
});

test('runtime diagnostics computes per-thread CPU without mixing reused thread ids', () => {
    const previous = {
        sampledAtUnixMs: 1000,
        systemCpuTicks: null,
        clockTicksPerSecond: 100,
        threads: [
            { tid: 10, name: 'main', cpuTicks: 100 },
            { tid: 11, name: 'old-worker', cpuTicks: 50 },
        ],
    };
    const current = {
        sampledAtUnixMs: 6000,
        systemCpuTicks: null,
        clockTicksPerSecond: 100,
        threads: [
            { tid: 10, name: 'main', cpuTicks: 250 },
            { tid: 11, name: 'new-worker', cpuTicks: 80 },
        ],
    };

    assert.deepEqual(computeThreadCpuSamples(current, previous), [
        { tid: 10, name: 'main', cpuTicks: 250, cpuPercent: 30 },
        { tid: 11, name: 'new-worker', cpuTicks: 80, cpuPercent: null },
    ]);
});

test('runtime diagnostics shares its frame sampler with the profiler consumer', () => {
    let clock = 0;
    let nextRafId = 1;
    const rafCallbacks = new Map();
    const frameSamples = [];
    const restoreGlobals = replaceGlobals({
        performance: {
            now: () => clock,
            memory: null,
        },
        requestAnimationFrame: callback => {
            const id = nextRafId++;
            rafCallbacks.set(id, callback);
            return id;
        },
        cancelAnimationFrame: id => rafCallbacks.delete(id),
        setInterval: () => 1,
        clearInterval: () => {},
        document: {
            visibilityState: 'visible',
            addEventListener: () => {},
            removeEventListener: () => {},
            getElementsByTagName: () => ({ length: 0 }),
            querySelectorAll: () => ({ length: 0 }),
        },
        PerformanceObserver: undefined,
    });

    try {
        const diagnostics = createRuntimeDiagnostics({
            frameSampleCallback: delta => frameSamples.push(delta),
        });
        diagnostics.start();

        const first = rafCallbacks.get(1);
        rafCallbacks.delete(1);
        clock = 10;
        first(10);

        const second = rafCallbacks.get(2);
        rafCallbacks.delete(2);
        clock = 30;
        second(30);

        const snapshot = diagnostics.snapshot();
        assert.deepEqual(frameSamples, [20]);
        assert.equal(snapshot.frameSampler.sharedConsumer, true);
        assert.equal(snapshot.frameSampler.callbackCount, 2);
        assert.equal(snapshot.frameSampler.sampleCount, 1);
        diagnostics.stop();
    } finally {
        restoreGlobals();
    }
});

test('runtime diagnostics capability-gates and bounds long animation frames', () => {
    const observers = new Map();
    class MockPerformanceObserver {
        static supportedEntryTypes = ['long-animation-frame'];

        constructor(callback) {
            this.callback = callback;
        }

        observe(options) {
            observers.set(options.type, this);
        }

        disconnect() {}

        emit(entries) {
            this.callback({ getEntries: () => entries });
        }
    }

    const restoreGlobals = replaceGlobals({
        performance: { now: () => 0, memory: null },
        requestAnimationFrame: () => 1,
        cancelAnimationFrame: () => {},
        setInterval: () => 1,
        clearInterval: () => {},
        document: {
            visibilityState: 'visible',
            addEventListener: () => {},
            removeEventListener: () => {},
            getElementsByTagName: () => ({ length: 0 }),
            querySelectorAll: () => ({ length: 0 }),
        },
        PerformanceObserver: MockPerformanceObserver,
    });

    try {
        const diagnostics = createRuntimeDiagnostics({ contextProvider: () => ({ stage: 'idle' }) });
        diagnostics.start();
        const entries = Array.from({ length: 201 }, (_, index) => ({
            startTime: index * 100,
            duration: 60,
            blockingDuration: 10,
            scripts: [],
        }));
        observers.get('long-animation-frame').emit(entries);

        const snapshot = diagnostics.snapshot();
        assert.equal(snapshot.capabilities.longAnimationFrame, true);
        assert.equal(snapshot.longAnimationFrames.observed, 201);
        assert.equal(snapshot.longAnimationFrames.stored, 200);
        assert.equal(snapshot.longAnimationFrames.dropped, 1);
        assert.equal(snapshot.longAnimationFrames.samples[0].id, 2);
        assert.deepEqual(snapshot.longAnimationFrames.samples.at(-1).context, { stage: 'idle' });
        diagnostics.stop();
    } finally {
        restoreGlobals();
    }
});

test('long animation frame serialization bounds scripts and omits URL queries', () => {
    const scripts = Array.from({ length: 25 }, (_, index) => ({
        startTime: 110 + index,
        duration: index + 1,
        forcedStyleAndLayoutDuration: index === 24 ? 5 : 0,
        invoker: `listener-${index}`,
        invokerType: 'event-listener',
        sourceURL: `https://example.com/scripts/app.js?token=secret-${index}`,
        sourceFunctionName: `handler${index}`,
        sourceCharPosition: index,
    }));
    const sample = serializeLongAnimationFrame({
        startTime: 100,
        duration: 80,
        blockingDuration: 30,
        renderStart: 150,
        styleAndLayoutStart: 160,
        scripts,
    }, { id: 7, context: { stage: 'pre-stream' } });

    assert.equal(sample.id, 7);
    assert.equal(sample.renderDurationMs, 30);
    assert.equal(sample.styleAndLayoutDurationMs, 20);
    assert.equal(sample.forcedStyleAndLayoutDurationMs, 5);
    assert.equal(sample.scriptCount, 25);
    assert.equal(sample.scripts.length, 20);
    assert.equal(sample.droppedScripts, 5);
    assert.equal(sample.scripts[0].sourceFunctionName, 'handler24');
    assert.equal(sample.scripts[0].sourceUrl, 'https://example.com/scripts/app.js');
    assert.deepEqual(sample.context, { stage: 'pre-stream' });
});
