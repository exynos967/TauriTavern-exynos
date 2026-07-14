const DEFAULT_BOTTOM_THRESHOLD = 5;
const DEFAULT_USER_SCROLL_INTENT_TIMEOUT_MS = 1000;

export function isChatViewportAtBottom({ scrollHeight, clientHeight, scrollTop }, threshold = DEFAULT_BOTTOM_THRESHOLD) {
    return Math.abs(Number(scrollHeight) - Number(clientHeight) - Number(scrollTop)) < threshold;
}

export function createChatScrollIntentTracker({
    now = () => performance.now(),
    timeoutMs = DEFAULT_USER_SCROLL_INTENT_TIMEOUT_MS,
} = {}) {
    let activeUntil = Number.NEGATIVE_INFINITY;

    return Object.freeze({
        mark() {
            activeUntil = Number(now()) + timeoutMs;
        },
        clear() {
            activeUntil = Number.NEGATIVE_INFINITY;
        },
        isActive() {
            return Number(now()) < activeUntil;
        },
    });
}

export function createChatScrollController({
    readViewport,
    scrollToBottom,
    requestFrame,
    cancelFrame,
    canAutoScroll = () => true,
    bottomThreshold = DEFAULT_BOTTOM_THRESHOLD,
    trace = () => {},
}) {
    let generationDepth = 0;
    let generationFollowsOutput = true;
    let pendingGenerationFollowsOutput = null;
    let pendingFrame = null;

    const report = (event, detail = {}) => {
        try {
            trace({
                event,
                generationDepth,
                generationFollowsOutput,
                hasPendingGenerationIntent: typeof pendingGenerationFollowsOutput === 'boolean',
                hasPendingFrame: pendingFrame !== null,
                ...detail,
            });
        } catch {
            // Diagnostics must never affect chat scrolling.
        }
    };

    const cancelPending = () => {
        if (pendingFrame === null) {
            return;
        }
        cancelFrame(pendingFrame);
        pendingFrame = null;
        report('pending-cancelled');
    };

    const isAtBottom = () => isChatViewportAtBottom(readViewport(), bottomThreshold);

    return Object.freeze({
        captureGenerationIntent() {
            pendingGenerationFollowsOutput = isAtBottom();
            report('generation-intent-captured', { atBottom: pendingGenerationFollowsOutput });
            return pendingGenerationFollowsOutput;
        },
        clearGenerationIntent() {
            pendingGenerationFollowsOutput = null;
            report('generation-intent-cleared');
        },
        beginGeneration() {
            if (generationDepth === 0) {
                generationFollowsOutput = typeof pendingGenerationFollowsOutput === 'boolean'
                    ? pendingGenerationFollowsOutput
                    : isAtBottom();
                pendingGenerationFollowsOutput = null;
                if (!generationFollowsOutput) {
                    cancelPending();
                }
            }
            generationDepth += 1;
            report('generation-began');
        },
        endGeneration() {
            generationDepth = Math.max(0, generationDepth - 1);
            report('generation-ended');
        },
        onViewportChanged({ userInitiated = true } = {}) {
            const atBottom = isAtBottom();
            if (generationDepth === 0) {
                generationFollowsOutput = atBottom;
            } else if (!atBottom && userInitiated) {
                generationFollowsOutput = false;
                cancelPending();
            }
            report('viewport-changed', { atBottom, userInitiated: Boolean(userInitiated) });
        },
        requestScroll({ waitForFrame = false, force = false } = {}) {
            const autoScrollEnabled = canAutoScroll();
            if (!autoScrollEnabled || (!force && !generationFollowsOutput)) {
                cancelPending();
                report('scroll-rejected', {
                    autoScrollEnabled,
                    force: Boolean(force),
                    waitForFrame: Boolean(waitForFrame),
                });
                return false;
            }

            cancelPending();
            if (!waitForFrame) {
                report('scroll-executing', { force: Boolean(force), waitForFrame: false });
                scrollToBottom();
                report('scroll-executed', { force: Boolean(force), waitForFrame: false });
                return true;
            }

            pendingFrame = requestFrame(() => {
                pendingFrame = null;
                const frameAutoScrollEnabled = canAutoScroll();
                if (frameAutoScrollEnabled && (force || generationFollowsOutput)) {
                    report('scroll-executing', { force: Boolean(force), waitForFrame: true });
                    scrollToBottom();
                    report('scroll-executed', { force: Boolean(force), waitForFrame: true });
                } else {
                    report('scroll-frame-rejected', {
                        autoScrollEnabled: frameAutoScrollEnabled,
                        force: Boolean(force),
                    });
                }
            });
            report('scroll-scheduled', { force: Boolean(force), waitForFrame: true });
            return true;
        },
        cancelPending,
        shouldFollowOutput() {
            return generationFollowsOutput;
        },
    });
}
