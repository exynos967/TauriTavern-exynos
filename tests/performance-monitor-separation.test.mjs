import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const removedMonitorPaths = [
    'src/scripts/extensions/tauritavern-perf-profiler',
    'src/tauri/main/perf/perf-hud.js',
    'src/tauri/main/brokers/invoke-observation.js',
    'src-tauri/crates/tauritavern/src/presentation/commands/perf_commands.rs',
    'src/scripts/tauri/perf/automation-profiler.js',
    'src/scripts/tauri/perf/history-prepend-profiler.js',
    'src/scripts/tauri/perf/interaction-timing.js',
    'src/scripts/tauri/perf/performance-attribution.js',
    'src/scripts/tauri/perf/performance-trace.js',
    'src/scripts/tauri/perf/runtime-diagnostics.js',
    'src/scripts/tauri/perf/streaming-format-profiler.js',
];

const retainedOptimizationPaths = [
    'src/scripts/tauri/perf/chat-scroll-controller.js',
    'src/scripts/tauri/perf/code-highlight-coordinator.js',
    'src/scripts/tauri/perf/inline-drawer-motion.js',
    'src/scripts/tauri/perf/message-render-batches.js',
    'src/scripts/tauri/perf/regex-refresh-coordinator.js',
    'src/scripts/tauri/perf/streaming-render-policy.js',
];

test('optimization branch excludes monitor-only modules', () => {
    for (const relativePath of removedMonitorPaths) {
        assert.equal(existsSync(`${root}/${relativePath}`), false, relativePath);
    }
});

test('optimization branch retains runtime optimizations', () => {
    for (const relativePath of retainedOptimizationPaths) {
        assert.equal(existsSync(`${root}/${relativePath}`), true, relativePath);
    }
});

test('runtime entry points do not register performance monitoring', () => {
    const entryPoints = [
        'src/init.js',
        'src/script.js',
        'src/scripts/world-info.js',
        'src/tauri/main/bootstrap.js',
        'src/tauri/main/bootstrap/initialize-tauri-integration.js',
        'src-tauri/crates/tauritavern/src/presentation/commands/registry.rs',
    ];
    const forbidden = [
        '__TAURITAVERN_PERF',
        'tauritavern-perf-profiler',
        'get_perf_runtime_sample',
        'installPerfHud',
        'createPerformanceTrace',
    ];

    for (const relativePath of entryPoints) {
        const source = readFileSync(`${root}/${relativePath}`, 'utf8');
        for (const token of forbidden) {
            assert.equal(source.includes(token), false, `${relativePath}: ${token}`);
        }
    }
});
