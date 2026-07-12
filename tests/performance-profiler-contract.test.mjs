import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('performance report exports generic operations and slow event listeners', async () => {
    const source = await readFile(path.join(REPO_ROOT, 'src/scripts/extensions/tauritavern-perf-profiler/index.js'), 'utf8');

    assert.match(source, /schemaVersion:\s*3/);
    assert.match(source, /operations:\s*structuredClone\(state\.operations\)/);
    assert.match(source, /slowListeners:\s*structuredClone\(state\.slowListeners\)/);
    assert.match(source, /__TAURITAVERN_PERF_EVENT_LISTENER__/);
});

test('performance traces cover history prepend and message redisplay operations', async () => {
    const source = await readFile(path.join(REPO_ROOT, 'src/script.js'), 'utf8');

    assert.match(source, /createPerformanceTrace\('tt:history-prepend'/);
    assert.match(source, /createPerformanceTrace\('tt:messages-redisplay'/);
    assert.match(source, /perfTrace\.end\('context-preparation'/);
    assert.match(source, /perfTrace\.end\('history-preparation'/);
    assert.match(source, /perfTrace\.end\('prompt-finalization'/);
});
