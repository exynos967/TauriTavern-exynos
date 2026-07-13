const PROFILED_PHASES = [
    'cleanup',
    'reasoning-update',
    'format-total',
    'format-regex',
    'format-markdown-fix',
    'format-markdown',
    'format-sanitize',
    'dom-commit',
];

export function diffStreamingPhases(before = {}, after = {}) {
    return Object.fromEntries(PROFILED_PHASES.flatMap(name => {
        const count = Math.max(0, Number(after[name]?.count || 0) - Number(before[name]?.count || 0));
        const durationMs = Math.max(0, Number(after[name]?.durationMs || 0) - Number(before[name]?.durationMs || 0));
        return count > 0 || durationMs > 0
            ? [[name, { count, durationMs: Math.round(durationMs * 10) / 10 }]]
            : [];
    }));
}

export function isStreamingFormatProfilingEnabled() {
    return typeof globalThis.__TAURITAVERN_PERF_STREAM_FORMAT__ === 'function';
}

export function reportStreamingFormatSample(sample) {
    const profiler = globalThis.__TAURITAVERN_PERF_STREAM_FORMAT__;
    if (typeof profiler !== 'function') {
        return;
    }

    try {
        profiler(sample);
    } catch {
        // Diagnostics must never affect streamed output.
    }
}
