export function getHistoryPrependProfiler() {
    return typeof globalThis.__TAURITAVERN_PERF_HISTORY_PREPEND__ === 'function'
        ? globalThis.__TAURITAVERN_PERF_HISTORY_PREPEND__
        : null;
}

export function reportHistoryPrependBatch(profiler, sample) {
    if (typeof profiler !== 'function') {
        return;
    }

    try {
        profiler(sample);
    } catch {
        // Diagnostics must never affect chat history rendering.
    }
}
