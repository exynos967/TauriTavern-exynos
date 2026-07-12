import assert from 'node:assert/strict';
import test from 'node:test';

import { createPerformanceTrace } from '../src/scripts/tauri/perf/performance-trace.js';

test('performance trace aggregates repeated phases into the total measure', async () => {
    globalThis.__TAURITAVERN_PERF_PROFILER__ = { capturing: true };
    performance.clearMeasures();

    try {
        const trace = createPerformanceTrace('tt:test-trace', { source: 'test' });
        assert.equal(trace.measure('work', () => 42), 42);
        await trace.measureAsync('work', async () => Promise.resolve());
        trace.finish({ success: true });

        const total = performance.getEntriesByName('tt:test-trace:total', 'measure').at(-1);
        assert.ok(total);
        assert.equal(total.detail.source, 'test');
        assert.equal(total.detail.success, true);
        assert.equal(total.detail.phases.work.count, 2);
        assert.ok(total.detail.phases.work.durationMs >= 0);
    } finally {
        delete globalThis.__TAURITAVERN_PERF_PROFILER__;
        performance.clearMeasures();
    }
});
