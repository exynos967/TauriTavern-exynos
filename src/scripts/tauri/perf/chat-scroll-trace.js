const GLOBAL_KEY = '__TAURITAVERN_PERF_CHAT_SCROLL__';
const MAX_STACK_LINES = 8;
const MAX_STRING_LENGTH = 240;
const MAX_NODE_SUMMARIES = 6;
const SIGNIFICANT_SCROLL_DELTA = 80;
const SIGNIFICANT_HEIGHT_DELTA = 80;

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

export function isSignificantChatScrollChange(previous, current) {
    if (!previous || !current) {
        return true;
    }

    return previous.messageCount !== current.messageCount
        || previous.atBottom !== current.atBottom
        || previous.clientHeight !== current.clientHeight
        || Math.abs(Number(current.scrollTop) - Number(previous.scrollTop)) >= SIGNIFICANT_SCROLL_DELTA
        || Math.abs(Number(current.scrollHeight) - Number(previous.scrollHeight)) >= SIGNIFICANT_HEIGHT_DELTA;
}

function describeNode(node) {
    if (!node || typeof node !== 'object') {
        return null;
    }

    const classNames = typeof node.className === 'string'
        ? node.className.split(/\s+/).filter(Boolean).slice(0, 6).map(boundString)
        : [];
    return {
        nodeType: Number(node.nodeType) || null,
        tagName: node.tagName ? boundString(node.tagName).toLowerCase() : null,
        id: node.id ? boundString(node.id) : null,
        classNames,
        childElementCount: Number(node.childElementCount) || 0,
    };
}

function summarizeMutations(records, element) {
    const summary = {
        records: 0,
        directRecords: 0,
        added: 0,
        removed: 0,
        addedNodes: [],
        removedNodes: [],
    };

    for (const record of records ?? []) {
        summary.records += 1;
        summary.directRecords += record.target === element ? 1 : 0;
        for (const node of record.addedNodes ?? []) {
            summary.added += 1;
            if (summary.addedNodes.length < MAX_NODE_SUMMARIES) {
                summary.addedNodes.push(describeNode(node));
            }
        }
        for (const node of record.removedNodes ?? []) {
            summary.removed += 1;
            if (summary.removedNodes.length < MAX_NODE_SUMMARIES) {
                summary.removedNodes.push(describeNode(node));
            }
        }
    }

    return summary;
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
    const installedMethods = new Map();
    const installedContentProperties = new Map();
    let frameId = null;
    let lastGeometry = readChatScrollGeometry(element);
    let installedScrollTop = false;
    let installedScrollTo = false;
    let pendingMutationRecords = [];

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

    const installMethodTrace = methodName => {
        const originalOwnDescriptor = Object.getOwnPropertyDescriptor(element, methodName);
        const originalMethod = element[methodName];
        if (typeof originalMethod !== 'function') {
            return;
        }

        try {
            Object.defineProperty(element, methodName, {
                configurable: true,
                writable: true,
                value(...args) {
                    const { before, enabled } = reportWrite('dom-method-call', {
                        operation: methodName,
                        node: describeNode(args[0]),
                        referenceNode: describeNode(args[1]),
                    });
                    const result = originalMethod.apply(this, args);
                    if (enabled) {
                        safeReport('dom-method-call', {
                            phase: 'after',
                            operation: methodName,
                            before,
                            geometry: readChatScrollGeometry(this),
                        });
                    }
                    return result;
                },
            });
            installedMethods.set(methodName, originalOwnDescriptor);
        } catch {
            // The native method remains untouched when the instance cannot be extended.
        }
    };

    const installContentPropertyTrace = propertyName => {
        const originalOwnDescriptor = Object.getOwnPropertyDescriptor(element, propertyName);
        const property = findPropertyDescriptor(element, propertyName);
        if (!property?.descriptor?.get || !property.descriptor.set) {
            return;
        }

        const { descriptor } = property;
        try {
            Object.defineProperty(element, propertyName, {
                configurable: true,
                enumerable: descriptor.enumerable,
                get() {
                    return descriptor.get.call(this);
                },
                set(value) {
                    const { before, enabled } = reportWrite('dom-content-write', {
                        operation: propertyName,
                        valueLength: typeof value === 'string' ? value.length : null,
                    });
                    descriptor.set.call(this, value);
                    if (enabled) {
                        safeReport('dom-content-write', {
                            phase: 'after',
                            operation: propertyName,
                            before,
                            geometry: readChatScrollGeometry(this),
                        });
                    }
                },
            });
            installedContentProperties.set(propertyName, originalOwnDescriptor);
        } catch {
            // The native property remains untouched when the instance cannot be extended.
        }
    };

    for (const methodName of ['appendChild', 'insertBefore', 'removeChild', 'replaceChild', 'replaceChildren', 'append', 'prepend']) {
        installMethodTrace(methodName);
    }
    for (const propertyName of ['textContent', 'innerHTML']) {
        installContentPropertyTrace(propertyName);
    }

    let observer = null;
    if (typeof MutationObserverClass === 'function') {
        try {
            observer = new MutationObserverClass(records => {
                if (!traceEnabled()) {
                    return;
                }
                pendingMutationRecords.push(...records);
                if (frameId !== null) {
                    return;
                }
                frameId = requestFrame(() => {
                    frameId = null;
                    if (!traceEnabled()) {
                        pendingMutationRecords = [];
                        return;
                    }
                    const mutation = summarizeMutations(pendingMutationRecords, element);
                    pendingMutationRecords = [];
                    const geometry = readChatScrollGeometry(element);
                    if (!isSignificantChatScrollChange(lastGeometry, geometry) && mutation.directRecords === 0) {
                        return;
                    }
                    const previousGeometry = lastGeometry;
                    lastGeometry = geometry;
                    safeReport('dom-geometry-change', { previousGeometry, geometry, mutation });
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
        pendingMutationRecords = [];

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
        for (const [methodName, originalOwnDescriptor] of installedMethods) {
            if (originalOwnDescriptor) {
                Object.defineProperty(element, methodName, originalOwnDescriptor);
            } else {
                delete element[methodName];
            }
        }
        for (const [propertyName, originalOwnDescriptor] of installedContentProperties) {
            if (originalOwnDescriptor) {
                Object.defineProperty(element, propertyName, originalOwnDescriptor);
            } else {
                delete element[propertyName];
            }
        }
    };
}
