const DEFAULT_SLOW_INTERACTION_MS = 100;

function round(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number * 10) / 10 : null;
}

function describeTarget(target) {
    if (typeof Element !== 'function' || !(target instanceof Element)) {
        return null;
    }

    return {
        tag: target.tagName.toLowerCase(),
        id: target.id || null,
        classes: Array.from(target.classList).slice(0, 4),
        name: target.getAttribute('aria-label') || target.getAttribute('title') || null,
    };
}

export function serializeSlowInteraction(entry, thresholdMs = DEFAULT_SLOW_INTERACTION_MS) {
    const durationMs = Number(entry?.duration);
    if (!Number.isFinite(durationMs) || durationMs < thresholdMs) {
        return null;
    }

    const startTime = Number(entry.startTime) || 0;
    const processingStart = Number(entry.processingStart) || startTime;
    const processingEnd = Number(entry.processingEnd) || processingStart;

    return {
        name: String(entry.name || 'unknown'),
        startTime: round(startTime),
        durationMs: round(durationMs),
        inputDelayMs: round(Math.max(0, processingStart - startTime)),
        processingMs: round(Math.max(0, processingEnd - processingStart)),
        presentationDelayMs: round(Math.max(0, startTime + durationMs - processingEnd)),
        interactionId: Number(entry.interactionId) || null,
        target: describeTarget(entry.target),
    };
}
