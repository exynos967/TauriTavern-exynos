import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createPrivacySafeId,
    getAutomationProfiler,
    reportAutomationSample,
} from '../src/scripts/tauri/perf/automation-profiler.js';

test('automation profiler creates deterministic non-plaintext identifiers', () => {
    const first = createPrivacySafeId('private quick reply name');
    const second = createPrivacySafeId('private quick reply name');

    assert.equal(first, second);
    assert.match(first, /^fnv1a-[0-9a-f]{8}$/);
    assert.doesNotMatch(first, /private|quick|reply/);
});

test('automation profiler is inert without a capture hook and isolates hook errors', () => {
    assert.equal(getAutomationProfiler(), null);
    assert.doesNotThrow(() => reportAutomationSample(null, { kind: 'test' }));

    globalThis.__TAURITAVERN_PERF_AUTOMATION__ = () => {
        throw new Error('diagnostics failure');
    };
    try {
        assert.doesNotThrow(() => reportAutomationSample(getAutomationProfiler(), { kind: 'test' }));
    } finally {
        delete globalThis.__TAURITAVERN_PERF_AUTOMATION__;
    }
});
