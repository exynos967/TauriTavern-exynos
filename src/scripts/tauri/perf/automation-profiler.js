export const QUICK_REPLY_PERF_IDENTITY = Symbol.for('tauritavern.quick-reply-perf-identity');

export function createPrivacySafeId(value) {
    const text = String(value ?? '');
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function getAutomationProfiler() {
    return typeof globalThis.__TAURITAVERN_PERF_AUTOMATION__ === 'function'
        ? globalThis.__TAURITAVERN_PERF_AUTOMATION__
        : null;
}

export function reportAutomationSample(profiler, sample) {
    if (typeof profiler !== 'function') {
        return;
    }

    try {
        profiler(sample);
    } catch {
        // Diagnostics must never affect automation execution.
    }
}
