const DISABLED_OBSERVATION = Object.freeze({
    startTransport: () => () => {},
    finish: () => {},
});

export function createInvokeObservation(command, getObserver, now) {
    if (typeof getObserver !== 'function') {
        return DISABLED_OBSERVATION;
    }

    let observer;
    try {
        observer = getObserver(command);
    } catch {
        return DISABLED_OBSERVATION;
    }
    if (typeof observer !== 'function') {
        return DISABLED_OBSERVATION;
    }

    const invokedAt = now();
    let transportStartedAt = null;
    let transportFinishedAt = null;

    return {
        startTransport() {
            transportStartedAt = now();
            return () => {
                transportFinishedAt = now();
            };
        },
        finish(outcome, ok) {
            const finishedAt = now();
            try {
                observer({
                    command,
                    outcome,
                    durationMs: finishedAt - invokedAt,
                    queueWaitMs: transportStartedAt === null ? 0 : Math.max(0, transportStartedAt - invokedAt),
                    transportDurationMs: transportStartedAt === null
                        ? 0
                        : Math.max(0, (transportFinishedAt ?? finishedAt) - transportStartedAt),
                    ok,
                });
            } catch {
                // Diagnostics must never affect invoke behavior.
            }
        },
    };
}
