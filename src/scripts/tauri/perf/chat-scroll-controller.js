const DEFAULT_BOTTOM_THRESHOLD = 5;

export function isChatViewportAtBottom({ scrollHeight, clientHeight, scrollTop }, threshold = DEFAULT_BOTTOM_THRESHOLD) {
    return Math.abs(Number(scrollHeight) - Number(clientHeight) - Number(scrollTop)) < threshold;
}

export function createChatScrollController({
    readViewport,
    scrollToBottom,
    requestFrame,
    cancelFrame,
    canAutoScroll = () => true,
    bottomThreshold = DEFAULT_BOTTOM_THRESHOLD,
}) {
    let generationDepth = 0;
    let generationFollowsOutput = true;
    let pendingFrame = null;

    const cancelPending = () => {
        if (pendingFrame === null) {
            return;
        }
        cancelFrame(pendingFrame);
        pendingFrame = null;
    };

    const isAtBottom = () => isChatViewportAtBottom(readViewport(), bottomThreshold);

    return Object.freeze({
        beginGeneration() {
            if (generationDepth === 0) {
                generationFollowsOutput = isAtBottom();
                if (!generationFollowsOutput) {
                    cancelPending();
                }
            }
            generationDepth += 1;
        },
        endGeneration() {
            generationDepth = Math.max(0, generationDepth - 1);
        },
        onViewportChanged() {
            const atBottom = isAtBottom();
            if (generationDepth === 0) {
                generationFollowsOutput = atBottom;
            } else if (!atBottom) {
                generationFollowsOutput = false;
                cancelPending();
            }
        },
        requestScroll({ waitForFrame = false, force = false } = {}) {
            if (!canAutoScroll() || (!force && !generationFollowsOutput)) {
                cancelPending();
                return false;
            }

            cancelPending();
            if (!waitForFrame) {
                scrollToBottom();
                return true;
            }

            pendingFrame = requestFrame(() => {
                pendingFrame = null;
                if (canAutoScroll() && (force || generationFollowsOutput)) {
                    scrollToBottom();
                }
            });
            return true;
        },
        cancelPending,
        shouldFollowOutput() {
            return generationFollowsOutput;
        },
    });
}
