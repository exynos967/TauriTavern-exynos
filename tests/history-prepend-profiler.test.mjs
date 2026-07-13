import assert from 'node:assert/strict';
import test from 'node:test';

import {
    getHistoryPrependProfiler,
    reportHistoryPrependBatch,
} from '../src/scripts/tauri/perf/history-prepend-profiler.js';

test('history prepend profiler is inert without capture and isolates hook errors', () => {
    assert.equal(getHistoryPrependProfiler(), null);
    assert.doesNotThrow(() => reportHistoryPrependBatch(null, { batchIndex: 0 }));

    globalThis.__TAURITAVERN_PERF_HISTORY_PREPEND__ = () => {
        throw new Error('diagnostics failure');
    };
    try {
        assert.equal(typeof getHistoryPrependProfiler(), 'function');
        assert.doesNotThrow(() => reportHistoryPrependBatch(getHistoryPrependProfiler(), { batchIndex: 0 }));
    } finally {
        delete globalThis.__TAURITAVERN_PERF_HISTORY_PREPEND__;
    }
});
