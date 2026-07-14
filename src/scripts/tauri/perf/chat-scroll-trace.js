const GLOBAL_KEY = '__TAURITAVERN_PERF_CHAT_SCROLL__';
const MAX_STACK_LINES = 8;
const MAX_STRING_LENGTH = 240;

function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number * 10) / 10 : null;
}

function boundString(value) {
    return String(value ?? '').slice(0, MAX_STRING_LENGTH);
}

export function sanitizeChatScrollStack(stack, origin = globalThis.location?.origin) {
    if (!stack) {
        return null;
    }

    const originPrefix = origin ? `${origin}/` : null;
    const lines = String(stack)
        .split('\n')
        .slice(1, MAX_STACK_LINES + 1)
        .map(line => {
            let sanitized = line.trim();
            if (originPrefix) {
                sanitized = sanitized.replaceAll(originPrefix, '');
            }
            sanitized = sanitized.replace(/https?:\/\/[^/\s)]+\//g, '');
            sanitized = sanitized.replace(/([\w./-]+)(?:\?[^\s):]+|#[^\s):]+)(?=:\d|\)|$)/g, '$1');
            return boundString(sanitized);
        })
        .filter(Boolean);

    return lines.length > 0 ? lines : null;
}

export function readChatScrollGeometry(element) {
    const scrollHeight = finiteNumber(element?.scrollHeight);
    const clientHeight = finiteNumber(element?.clientHeight);
    const scrollTop = finiteNumber(element?.scrollTop);
    const bottomGap = scrollHeight === null || clientHeight === null || scrollTop === null
        ? null
        : finiteNumber(scrollHeight - clientHeight - scrollTop);

    return {
        scrollTop,
        scrollHeight,
        clientHeight,
        bottomGap,
        atBottom: bottomGap !== null ? Math.abs(bottomGap) < 5 : null,
        messageCount: Number(element?.childElementCount) || 0,
    };
}

export function reportChatScrollSample(kind, detail = {}) {
    const profiler = globalThis[GLOBAL_KEY];
    if (typeof profiler !== 'function') {
        return false;
    }

    try {
        profiler({
            kind: boundString(kind),
            ...detail,
        });
        return true;
    } catch {
        return false;
    }
}

function findPropertyDescriptor(target, property) {
    let owner = target;
    while (owner) {
        const descriptor = Object.getOwnPropertyDescriptor(owner, property);
        if (descriptor) {
            return { descriptor, owner };
        }
        owner = Object.getPrototypeOf(owner);
    }
    return null;
}

function readScrollToRequest(args) {
    const [first, second] = args;
    if (first && typeof first === 'object') {
        return {
            left: finiteNumber(first.left),
            top: finiteNumber(first.top),
            behavior: first.behavior ? boundString(first.behavior) : null,
        };
    }

    return {
        left: finiteNumber(first),
        top: finiteNumber(second),
        behavior: null,
    };
}

export function installChatScrollTrace(element, {
    report = reportChatScrollSample,
    isEnabled = () => typeof globalThis[GLOBAL_KEY] === 'function',
    createStack = () => new Error().stack,
    MutationObserverClass = globalThis.MutationObserver,
    requestFrame = callback => globalThis.requestAnimationFrame(callback),
    cancelFrame = id => globalThis.cancelAnimationFrame(id),
} = {}) {
    if (!element) {
        return () => {};
    }

    const originalOwnScrollTop = Object.getOwnPropertyDescriptor(element, 'scrollTop');
    const scrollTopProperty = findPropertyDescriptor(element, 'scrollTop');
    const originalOwnScrollTo = Object.getOwnPropertyDescriptor(element, 'scrollTo');
    const originalScrollTo = element.scrollTo;
    let frameId = null;
    let lastGeometry = readChatScrollGeometry(element);
    let installedScrollTop = false;
    let installedScrollTo = false;

    const traceEnabled = () => {
        try {
            return Boolean(isEnabled());
        } catch {
            return false;
        }
    };

    const safeReport = (kind, detail) => {
        try {
            return Boolean(report(kind, detail));
        } catch {
            return false;
        }
    };

    const reportWrite = (kind, detail) => {
        if (!traceEnabled()) {
            return { before: null, enabled: false };
        }
        const before = readChatScrollGeometry(element);
        let stack = null;
        try {
            stack = sanitizeChatScrollStack(createStack());
        } catch {
            stack = null;
        }
        const enabled = safeReport(kind, {
            phase: 'before',
            ...detail,
            geometry: before,
            stack,
        });
        return { before, enabled };
    };

    if (scrollTopProperty?.descriptor?.get && scrollTopProperty.descriptor.set) {
        const { descriptor } = scrollTopProperty;
        try {
            Object.defineProperty(element, 'scrollTop', {
                configurable: true,
                enumerable: descriptor.enumerable,
                get() {
                    return descriptor.get.call(this);
                },
                set(value) {
                    const requestedTop = finiteNumber(value);
                    const { before, enabled } = reportWrite('scrollTop-write', { requestedTop });
                    descriptor.set.call(this, value);
                    if (enabled) {
                        safeReport('scrollTop-write', {
                            phase: 'after',
                            requestedTop,
                            before,
                            geometry: readChatScrollGeometry(this),
                        });
                    }
                },
            });
            installedScrollTop = true;
        } catch {
            installedScrollTop = false;
        }
    }

    if (typeof originalScrollTo === 'function') {
        try {
            Object.defineProperty(element, 'scrollTo', {
                configurable: true,
                writable: true,
                value(...args) {
                    const request = readScrollToRequest(args);
                    const { before, enabled } = reportWrite('scrollTo-call', { request });
                    const result = originalScrollTo.apply(this, args);
                    if (enabled) {
                        safeReport('scrollTo-call', {
                            phase: 'after',
                            request,
                            before,
                            geometry: readChatScrollGeometry(this),
                        });
                    }
                    return result;
                },
            });
            installedScrollTo = true;
        } catch {
            installedScrollTo = false;
        }
    }

    let observer = null;
    if (typeof MutationObserverClass === 'function') {
        try {
            observer = new MutationObserverClass(() => {
                if (!traceEnabled() || frameId !== null) {
                    return;
                }
                frameId = requestFrame(() => {
                    frameId = null;
                    const geometry = readChatScrollGeometry(element);
                    if (JSON.stringify(geometry) === JSON.stringify(lastGeometry)) {
                        return;
                    }
                    const previousGeometry = lastGeometry;
                    lastGeometry = geometry;
                    safeReport('dom-geometry-change', { previousGeometry, geometry });
                });
            });
            observer.observe(element, { childList: true, subtree: true });
        } catch {
            observer = null;
        }
    }

    return () => {
        observer?.disconnect();
        if (frameId !== null) {
            cancelFrame(frameId);
            frameId = null;
        }

        if (installedScrollTop) {
            if (originalOwnScrollTop) {
                Object.defineProperty(element, 'scrollTop', originalOwnScrollTop);
            } else {
                delete element.scrollTop;
            }
        }
        if (installedScrollTo) {
            if (originalOwnScrollTo) {
                Object.defineProperty(element, 'scrollTo', originalOwnScrollTo);
            } else {
                delete element.scrollTo;
            }
        }
    };
}
