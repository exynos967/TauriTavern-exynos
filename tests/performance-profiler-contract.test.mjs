import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('performance report exports generic operations and slow event listeners', async () => {
    const source = await readFile(path.join(REPO_ROOT, 'src/scripts/extensions/tauritavern-perf-profiler/index.js'), 'utf8');

    assert.match(source, /schemaVersion:\s*4/);
    assert.match(source, /operations:\s*structuredClone\(state\.operations\)/);
    assert.match(source, /slowListeners:\s*structuredClone\(state\.slowListeners\)/);
    assert.match(source, /diagnostics:\s*runtimeDiagnostics\.snapshot\(\)/);
    assert.match(source, /__TAURITAVERN_PERF_EVENT_LISTENER__/);
});

test('performance profiler captures interaction latency and heat signals only while enabled', async () => {
    const profilerSource = await readFile(path.join(REPO_ROOT, 'src/scripts/extensions/tauritavern-perf-profiler/index.js'), 'utf8');
    const diagnosticsSource = await readFile(path.join(REPO_ROOT, 'src/scripts/tauri/perf/runtime-diagnostics.js'), 'utf8');

    assert.match(profilerSource, /runtimeDiagnostics\.start\(\)/);
    assert.match(profilerSource, /runtimeDiagnostics\.stop\(\)/);
    assert.match(profilerSource, /runtimeDiagnostics\.summary\(\)/);
    const renderStatusSource = profilerSource.slice(
        profilerSource.indexOf('function renderStatus()'),
        profilerSource.indexOf('function createUi()'),
    );
    assert.doesNotMatch(renderStatusSource, /runtimeDiagnostics\.snapshot\(\)/);
    assert.match(diagnosticsSource, /addEventListener\('click', onClick, true\)/);
    assert.match(diagnosticsSource, /removeEventListener\('click', onClick, true\)/);
    assert.match(diagnosticsSource, /mainThreadBusyRatio/);
    assert.match(diagnosticsSource, /networkInFlightMax/);
    assert.match(diagnosticsSource, /restoreFetch\(\)/);
    assert.match(diagnosticsSource, /installInvokeProfiler\(\)/);
    assert.match(diagnosticsSource, /restoreInvoke\(\)/);
});

test('performance traces cover history prepend and message redisplay operations', async () => {
    const source = await readFile(path.join(REPO_ROOT, 'src/script.js'), 'utf8');

    assert.match(source, /createPerformanceTrace\('tt:history-prepend'/);
    assert.match(source, /createPerformanceTrace\('tt:messages-redisplay'/);
    assert.match(source, /perfTrace\.end\('context-preparation'/);
    assert.match(source, /perfTrace\.end\('history-preparation'/);
    assert.match(source, /perfTrace\.end\('prompt-finalization'/);
});
