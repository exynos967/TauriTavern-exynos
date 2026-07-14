import assert from 'node:assert/strict';
import test from 'node:test';

import { computeProcessCpuPercent, computeThreadCpuSamples } from '../src/scripts/tauri/perf/runtime-diagnostics.js';

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
