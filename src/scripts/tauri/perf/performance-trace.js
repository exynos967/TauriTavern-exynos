const PROFILER_GLOBAL_KEY = '__TAURITAVERN_PERF_PROFILER__';

function isPerformanceTracingEnabled() {
    return globalThis.__TAURITAVERN_PERF_ENABLED__ === true
        || globalThis[PROFILER_GLOBAL_KEY]?.capturing === true;
}

function createDisabledTrace() {
    return {
        start: () => 0,
        end: () => {},
        measure: (_name, action) => action(),
        measureAsync: (_name, action) => action(),
        finish: () => {},
    };
}

/**
 * Creates an opt-in performance trace that publishes phase and total measures.
 * @param {string} prefix Performance entry prefix, for example `tt:world-info`
 * @param {object} [detail] Metadata attached to the total measure
 */
export function createPerformanceTrace(prefix, detail = {}) {
    const perf = globalThis.performance;
    if (!isPerformanceTracingEnabled() || typeof perf?.now !== 'function') {
        return createDisabledTrace();
    }

    const runId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    const startedAt = perf.now();
    const phases = {};

    const record = (name, phaseStartedAt) => {
        const durationMs = perf.now() - phaseStartedAt;
        const current = phases[name] ?? { count: 0, durationMs: 0 };
        current.count += 1;
        current.durationMs += durationMs;
        phases[name] = current;

        try {
            perf.measure(`${prefix}:${name}`, {
                start: phaseStartedAt,
                duration: durationMs,
                detail: { runId },
            });
        } catch {
            // PerformanceMeasureOptions is not available in every WebView.
        }
    };

    return {
        start() {
            return perf.now();
        },
        end(name, phaseStartedAt) {
            record(name, phaseStartedAt);
        },
        measure(name, action) {
            const phaseStartedAt = perf.now();
            try {
                return action();
            } finally {
                record(name, phaseStartedAt);
            }
        },
        async measureAsync(name, action) {
            const phaseStartedAt = perf.now();
            try {
                return await action();
            } finally {
                record(name, phaseStartedAt);
            }
        },
        finish(result = {}) {
            const durationMs = perf.now() - startedAt;
            const normalizedPhases = Object.fromEntries(Object.entries(phases).map(([name, phase]) => [name, {
                count: phase.count,
                durationMs: Math.round(phase.durationMs * 10) / 10,
            }]));

            try {
                perf.measure(`${prefix}:total`, {
                    start: startedAt,
                    duration: durationMs,
                    detail: {
                        runId,
                        ...detail,
                        ...result,
                        phases: normalizedPhases,
                    },
                });
            } catch {
                // PerformanceMeasureOptions is not available in every WebView.
            }
        },
    };
}
