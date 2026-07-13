import assert from 'node:assert/strict';
import test from 'node:test';

import {
    diffStreamingPhases,
    isStreamingFormatProfilingEnabled,
    reportStreamingFormatSample,
} from '../src/scripts/tauri/perf/streaming-format-profiler.js';

test('stream format profiler computes per-render phase deltas', () => {
    assert.deepEqual(diffStreamingPhases(
        {
            'format-total': { count: 4, durationMs: 12.3 },
            'format-regex': { count: 3, durationMs: 4.1 },
        },
        {
            'format-total': { count: 5, durationMs: 18.8 },
            'format-regex': { count: 4, durationMs: 6.6 },
            'dom-commit': { count: 1, durationMs: 0.4 },
        },
    ), {
        'format-total': { count: 1, durationMs: 6.5 },
        'format-regex': { count: 1, durationMs: 2.5 },
        'dom-commit': { count: 1, durationMs: 0.4 },
    });
});

test('stream format profiler is inert without capture and isolates hook errors', () => {
    assert.equal(isStreamingFormatProfilingEnabled(), false);
    assert.doesNotThrow(() => reportStreamingFormatSample({ inputChars: 10 }));
    globalThis.__TAURITAVERN_PERF_STREAM_FORMAT__ = () => {
        throw new Error('diagnostics failure');
    };
    try {
        assert.equal(isStreamingFormatProfilingEnabled(), true);
        assert.doesNotThrow(() => reportStreamingFormatSample({ inputChars: 10 }));
    } finally {
        delete globalThis.__TAURITAVERN_PERF_STREAM_FORMAT__;
    }
});
