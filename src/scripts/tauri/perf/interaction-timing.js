const DEFAULT_SLOW_INTERACTION_MS = 100;

function round(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number * 10) / 10 : null;
}

export function describeInteractionTarget(target) {
    if (typeof Element !== 'function' || !(target instanceof Element)) {
        return null;
    }

    const interactive = target.closest?.('button, a, input, select, textarea, [role="button"], [tabindex]') ?? target;
    return {
        tag: interactive.tagName.toLowerCase(),
        id: interactive.id || null,
        classes: Array.from(interactive.classList).slice(0, 4),
        name: interactive.getAttribute('aria-label')
            || interactive.getAttribute('title')
            || interactive.getAttribute('name')
            || null,
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
        target: describeInteractionTarget(entry.target),
    };
}
