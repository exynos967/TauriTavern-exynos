import assert from 'node:assert/strict';
import test from 'node:test';

import { createPerformanceTrace } from '../src/scripts/tauri/perf/performance-trace.js';

test('performance trace aggregates repeated phases into the total measure', async () => {
    globalThis.__TAURITAVERN_PERF_PROFILER__ = { capturing: true };
    const started = [];
    globalThis.__TAURITAVERN_PERF_TRACE_STARTED__ = detail => started.push(detail);
    performance.clearMeasures();

    try {
        const trace = createPerformanceTrace('tt:test-trace', { source: 'test' });
        assert.equal(typeof trace.runId, 'string');
        assert.equal(started.length, 1);
        assert.equal(started[0].runId, trace.runId);
        assert.equal(started[0].detail.source, 'test');
        assert.equal(trace.measure('work', () => 42), 42);
        await trace.measureAsync('work', async () => Promise.resolve());
        assert.equal(trace.snapshotPhases().work.count, 2);
        trace.finish({ success: true });
        trace.finish({ success: false });

        const totals = performance.getEntriesByName('tt:test-trace:total', 'measure');
        assert.equal(totals.length, 1);
        const total = totals.at(-1);
        assert.ok(total);
        assert.equal(total.detail.source, 'test');
        assert.equal(total.detail.success, true);
        assert.equal(total.detail.phases.work.count, 2);
        assert.ok(total.detail.phases.work.durationMs >= 0);
        assert.ok(total.detail.runtime);
        assert.equal(typeof total.detail.runtime.started.domNodes, 'object');
        assert.equal(typeof total.detail.runtime.finished.usedHeapBytes, 'object');
    } finally {
        delete globalThis.__TAURITAVERN_PERF_PROFILER__;
        delete globalThis.__TAURITAVERN_PERF_TRACE_STARTED__;
        performance.clearMeasures();
    }
});

test('performance trace ignores diagnostics hook failures', () => {
    globalThis.__TAURITAVERN_PERF_PROFILER__ = { capturing: true };
    globalThis.__TAURITAVERN_PERF_TRACE_STARTED__ = () => {
        throw new Error('diagnostics failure');
    };

    try {
        assert.doesNotThrow(() => createPerformanceTrace('tt:test-hook-failure'));
    } finally {
        delete globalThis.__TAURITAVERN_PERF_PROFILER__;
        delete globalThis.__TAURITAVERN_PERF_TRACE_STARTED__;
        performance.clearMeasures();
    }
});
