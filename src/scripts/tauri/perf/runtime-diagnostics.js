import { describeInteractionTarget } from './interaction-timing.js';

const MAX_INTERACTIONS = 200;
const MAX_NETWORK_REQUESTS = 200;
const MAX_INVOKES = 200;
const MAX_HEALTH_SAMPLES = 900;
const MAX_LONG_ANIMATION_FRAMES = 200;
const MAX_SCRIPTS_PER_LONG_ANIMATION_FRAME = 20;
const HEALTH_SAMPLE_INTERVAL_MS = 1000;
const EVENT_LOOP_PROBE_INTERVAL_MS = 250;
const LONG_FRAME_THRESHOLD_MS = 50;

function now() {
    return globalThis.performance?.now?.() ?? Date.now();
}

function round(value, digits = 1) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return null;
    }

    const factor = 10 ** digits;
    return Math.round(number * factor) / factor;
}

function pushBounded(collection, value, limit) {
    collection.push(value);
    if (collection.length > limit) {
        collection.splice(0, collection.length - limit);
    }
}

function boundedString(value, limit = 300) {
    return String(value ?? '').slice(0, limit);
}

function sanitizeSourceUrl(value) {
    const sourceUrl = boundedString(value);
    if (!sourceUrl) {
        return '';
    }

    try {
        const url = new URL(sourceUrl, globalThis.location?.href);
        return url.origin === globalThis.location?.origin
            ? url.pathname
            : `${url.origin}${url.pathname}`;
    } catch {
        return sourceUrl.split(/[?#]/, 1)[0];
    }
}

function serializeLongAnimationFrameScript(script) {
    return {
        startTime: round(script?.startTime),
        durationMs: round(script?.duration),
        executionStart: round(script?.executionStart),
        forcedStyleAndLayoutDurationMs: round(script?.forcedStyleAndLayoutDuration),
        pauseDurationMs: round(script?.pauseDuration),
        invoker: boundedString(script?.invoker || script?.name),
        invokerType: boundedString(script?.invokerType || script?.type, 100),
        sourceUrl: sanitizeSourceUrl(script?.sourceURL),
        sourceFunctionName: boundedString(script?.sourceFunctionName),
        sourceCharPosition: Number.isFinite(Number(script?.sourceCharPosition))
            ? Number(script.sourceCharPosition)
            : null,
    };
}

export function serializeLongAnimationFrame(entry, { id = null, context = null } = {}) {
    const startTime = Number(entry?.startTime) || 0;
    const durationMs = Math.max(0, Number(entry?.duration) || 0);
    const endedAt = startTime + durationMs;
    const renderStart = Number(entry?.renderStart) || 0;
    const styleAndLayoutStart = Number(entry?.styleAndLayoutStart) || 0;
    const allScripts = Array.from(entry?.scripts ?? [], serializeLongAnimationFrameScript);
    const forcedStyleAndLayoutDurationMs = allScripts.reduce(
        (total, script) => total + (Number(script.forcedStyleAndLayoutDurationMs) || 0),
        0,
    );
    const scripts = allScripts
        .sort((left, right) => (right.durationMs ?? 0) - (left.durationMs ?? 0))
        .slice(0, MAX_SCRIPTS_PER_LONG_ANIMATION_FRAME);

    return {
        id,
        startTime: round(startTime),
        durationMs: round(durationMs),
        blockingDurationMs: round(entry?.blockingDuration),
        firstUIEventTimestamp: round(entry?.firstUIEventTimestamp),
        renderStart: renderStart > 0 ? round(renderStart) : null,
        renderDurationMs: renderStart > 0 ? round(Math.max(0, endedAt - renderStart)) : 0,
        styleAndLayoutStart: styleAndLayoutStart > 0 ? round(styleAndLayoutStart) : null,
        styleAndLayoutDurationMs: styleAndLayoutStart > 0
            ? round(Math.max(0, endedAt - styleAndLayoutStart))
            : 0,
        forcedStyleAndLayoutDurationMs: round(forcedStyleAndLayoutDurationMs),
        scriptCount: allScripts.length,
        droppedScripts: Math.max(0, allScripts.length - scripts.length),
        scripts,
        context: context && typeof context === 'object' ? structuredClone(context) : null,
    };
}

function describeRequest(input, init) {
    let rawUrl = '';
    let method = init?.method;
    try {
        if (typeof Request === 'function' && input instanceof Request) {
            rawUrl = input.url;
            method ??= input.method;
        } else {
            rawUrl = String(input ?? '');
        }

        const url = new URL(rawUrl, globalThis.location?.href);
        return {
            method: String(method || 'GET').toUpperCase(),
            origin: url.origin === globalThis.location?.origin ? 'same-origin' : url.origin,
            path: url.pathname,
        };
    } catch {
        return {
            method: String(method || 'GET').toUpperCase(),
            origin: null,
            path: rawUrl.split('?')[0].slice(0, 200),
        };
    }
}

function readRuntimeSample() {
    const memory = globalThis.performance?.memory;
    return {
        domNodes: globalThis.document?.getElementsByTagName?.('*')?.length ?? null,
        messageNodes: globalThis.document?.querySelectorAll?.('#chat .mes')?.length ?? null,
        usedHeapBytes: Number(memory?.usedJSHeapSize) || null,
        totalHeapBytes: Number(memory?.totalJSHeapSize) || null,
    };
}

export function computeProcessCpuPercent(sample, previous) {
    const processDelta = Number(sample?.processCpuTicks) - Number(previous?.processCpuTicks);
    if (!(processDelta >= 0)) {
        return null;
    }

    const systemDelta = Number(sample?.systemCpuTicks) - Number(previous?.systemCpuTicks);
    const cores = Number(sample?.logicalCpuCount);
    if (systemDelta > 0 && cores > 0) {
        return round((processDelta / systemDelta) * cores * 100);
    }

    const wallDeltaMs = Number(sample?.sampledAtUnixMs) - Number(previous?.sampledAtUnixMs);
    const clockTicksPerSecond = Number(sample?.clockTicksPerSecond);
    if (!(wallDeltaMs > 0) || !(clockTicksPerSecond > 0)) {
        return null;
    }

    return round((processDelta / clockTicksPerSecond) / (wallDeltaMs / 1000) * 100);
}

export function computeThreadCpuSamples(sample, previous) {
    if (!Array.isArray(sample?.threads)) {
        return null;
    }

    const previousThreads = new Map((previous?.threads ?? []).map(thread => [Number(thread.tid), thread]));
    return sample.threads.map(thread => {
        const previousThread = previousThreads.get(Number(thread.tid));
        const cpuPercent = previousThread && previousThread.name === thread.name
            ? computeProcessCpuPercent(
                { ...sample, processCpuTicks: thread.cpuTicks },
                { ...previous, processCpuTicks: previousThread.cpuTicks },
            )
            : null;
        return {
            tid: Number(thread.tid),
            name: String(thread.name ?? 'unknown'),
            cpuTicks: Number(thread.cpuTicks) || 0,
            cpuPercent,
        };
    });
}

export function createRuntimeDiagnostics({ nativeSampler, contextProvider, frameSampleCallback } = {}) {
    const state = {
        running: false,
        sessionId: 0,
        startedAt: null,
        interactions: [],
        networkRequests: [],
        invokes: [],
        healthSamples: [],
        longAnimationFrames: [],
        capabilities: {
            eventTiming: Array.isArray(globalThis.PerformanceObserver?.supportedEntryTypes)
                && globalThis.PerformanceObserver.supportedEntryTypes.includes('event'),
            longTask: false,
            longAnimationFrame: Array.isArray(globalThis.PerformanceObserver?.supportedEntryTypes)
                && globalThis.PerformanceObserver.supportedEntryTypes.includes('long-animation-frame'),
            memory: Boolean(globalThis.performance?.memory),
            nativeSample: typeof nativeSampler === 'function',
        },
        interactionId: 1,
        requestId: 1,
        networkInFlight: 0,
        networkInFlightMax: 0,
        invokeInFlight: 0,
        invokeInFlightMax: 0,
        frameCount: 0,
        longFrames: 0,
        maxFrameMs: 0,
        frameDelayMs: 0,
        longTaskCount: 0,
        longTaskMs: 0,
        maxLongTaskMs: 0,
        eventLoopLagMs: 0,
        maxEventLoopLagMs: 0,
        lastFrameAt: null,
        lastHealthAt: null,
        nativeSample: null,
        nativeThreadSample: null,
        rafId: null,
        healthTimer: null,
        eventLoopTimer: null,
        nextEventLoopProbeAt: null,
        nativeSamplePending: false,
        longTaskObserver: null,
        longAnimationFrameObserver: null,
        longAnimationFrameObserved: 0,
        longAnimationFrameDropped: 0,
        nextLongAnimationFrameId: 1,
        frameSamplerCallbackCount: 0,
        frameSamplerSampleCount: 0,
        frameSamplerOverheadMs: 0,
        originalFetch: null,
        wrappedFetch: null,
        invokeOwner: null,
        originalInvoke: null,
        wrappedInvoke: null,
    };

    function resetWindow() {
        state.frameCount = 0;
        state.longFrames = 0;
        state.maxFrameMs = 0;
        state.frameDelayMs = 0;
        state.longTaskCount = 0;
        state.longTaskMs = 0;
        state.maxLongTaskMs = 0;
        state.eventLoopLagMs = 0;
        state.maxEventLoopLagMs = 0;
    }

    function computeNativeCpuPercent(sample) {
        return computeProcessCpuPercent(sample, state.nativeSample);
    }

    async function sampleNativeRuntime() {
        if (state.nativeSamplePending || typeof nativeSampler !== 'function') {
            return;
        }

        state.nativeSamplePending = true;
        try {
            const sample = await nativeSampler();
            if (sample && typeof sample === 'object') {
                sample.processCpuPercent = computeNativeCpuPercent(sample);
                if (Array.isArray(sample.threads)) {
                    const rawThreadSample = structuredClone(sample);
                    sample.threads = computeThreadCpuSamples(sample, state.nativeThreadSample);
                    state.nativeThreadSample = rawThreadSample;
                }
                state.nativeSample = sample;
            }
        } catch {
            state.capabilities.nativeSample = false;
        } finally {
            state.nativeSamplePending = false;
        }
    }

    function readContext() {
        if (typeof contextProvider !== 'function') {
            return null;
        }

        try {
            const context = contextProvider();
            return context && typeof context === 'object' ? structuredClone(context) : null;
        } catch {
            return null;
        }
    }

    function flushHealthSample() {
        if (!state.running) {
            return;
        }

        const sampledAt = now();
        const elapsedMs = Math.max(1, sampledAt - state.lastHealthAt);
        const runtime = readRuntimeSample();
        const longTaskBusyRatio = Math.min(1, state.longTaskMs / elapsedMs);
        const frameDelayBusyRatio = Math.min(1, state.frameDelayMs / elapsedMs);
        pushBounded(state.healthSamples, {
            sampledAt: round(sampledAt),
            elapsedMs: round(elapsedMs),
            visible: globalThis.document?.visibilityState === 'visible',
            frames: state.frameCount,
            longFrames: state.longFrames,
            maxFrameMs: round(state.maxFrameMs),
            frameDelayMs: round(state.frameDelayMs),
            longTasks: state.longTaskCount,
            longTaskMs: round(state.longTaskMs),
            maxLongTaskMs: round(state.maxLongTaskMs),
            eventLoopLagMs: round(state.eventLoopLagMs),
            maxEventLoopLagMs: round(state.maxEventLoopLagMs),
            mainThreadBusyRatio: round(Math.max(longTaskBusyRatio, frameDelayBusyRatio), 3),
            networkInFlight: state.networkInFlight,
            invokeInFlight: state.invokeInFlight,
            context: readContext(),
            ...runtime,
            native: state.nativeSample ? structuredClone(state.nativeSample) : null,
        }, MAX_HEALTH_SAMPLES);
        state.lastHealthAt = sampledAt;
        resetWindow();
        void sampleNativeRuntime();
    }

    function frameStep(timestamp) {
        if (!state.running) {
            state.rafId = null;
            return;
        }

        const callbackStartedAt = now();
        try {
            if (state.lastFrameAt !== null) {
                const delta = timestamp - state.lastFrameAt;
                state.frameCount += 1;
                state.frameSamplerSampleCount += 1;
                state.maxFrameMs = Math.max(state.maxFrameMs, delta);
                state.frameDelayMs += Math.max(0, delta - (1000 / 60));
                if (delta >= LONG_FRAME_THRESHOLD_MS) {
                    state.longFrames += 1;
                }

                if (typeof frameSampleCallback === 'function') {
                    try {
                        frameSampleCallback(delta);
                    } catch {
                        // Diagnostics consumers must never affect frame sampling.
                    }
                }
            }
            state.lastFrameAt = timestamp;
        } finally {
            state.frameSamplerCallbackCount += 1;
            state.frameSamplerOverheadMs += Math.max(0, now() - callbackStartedAt);
            state.rafId = state.running ? requestAnimationFrame(frameStep) : null;
        }
    }

    function onClick(event) {
        if (!state.running) {
            return;
        }

        const startedAt = now();
        const sessionId = state.sessionId;
        const eventTimestamp = Number(event.timeStamp);
        const interaction = {
            id: state.interactionId++,
            type: event.type,
            startedAt: round(startedAt),
            eventDispatchDelayMs: Number.isFinite(eventTimestamp) && eventTimestamp <= startedAt
                ? round(Math.max(0, startedAt - eventTimestamp))
                : null,
            handlerDurationMs: null,
            firstFrameMs: null,
            secondFrameMs: null,
            totalMs: null,
            target: describeInteractionTarget(event.target),
            context: readContext(),
        };

        queueMicrotask(() => {
            if (!state.running || state.sessionId !== sessionId) {
                return;
            }
            interaction.handlerDurationMs = round(now() - startedAt);
            requestAnimationFrame(() => {
                if (!state.running || state.sessionId !== sessionId) {
                    return;
                }
                interaction.firstFrameMs = round(now() - startedAt);
                requestAnimationFrame(() => {
                    if (!state.running || state.sessionId !== sessionId) {
                        return;
                    }
                    interaction.secondFrameMs = round(now() - startedAt);
                    interaction.totalMs = interaction.secondFrameMs;
                    pushBounded(state.interactions, interaction, MAX_INTERACTIONS);
                });
            });
        });
    }

    function installLongTaskObserver() {
        if (typeof PerformanceObserver !== 'function') {
            return;
        }

        try {
            state.longTaskObserver = new PerformanceObserver(list => {
                for (const entry of list.getEntries()) {
                    const duration = Number(entry.duration) || 0;
                    state.longTaskCount += 1;
                    state.longTaskMs += duration;
                    state.maxLongTaskMs = Math.max(state.maxLongTaskMs, duration);
                }
            });
            state.longTaskObserver.observe({ type: 'longtask', buffered: false });
            state.capabilities.longTask = true;
        } catch {
            state.longTaskObserver = null;
        }
    }

    function installLongAnimationFrameObserver() {
        if (!state.capabilities.longAnimationFrame || typeof PerformanceObserver !== 'function') {
            return;
        }

        try {
            state.longAnimationFrameObserver = new PerformanceObserver(list => {
                for (const entry of list.getEntries()) {
                    state.longAnimationFrameObserved += 1;
                    const previousLength = state.longAnimationFrames.length;
                    pushBounded(state.longAnimationFrames, serializeLongAnimationFrame(entry, {
                        id: state.nextLongAnimationFrameId++,
                        context: readContext(),
                    }), MAX_LONG_ANIMATION_FRAMES);
                    if (previousLength === MAX_LONG_ANIMATION_FRAMES) {
                        state.longAnimationFrameDropped += 1;
                    }
                }
            });
            state.longAnimationFrameObserver.observe({ type: 'long-animation-frame', buffered: false });
        } catch {
            state.longAnimationFrameObserver = null;
            state.capabilities.longAnimationFrame = false;
        }
    }

    function installFetchProfiler() {
        if (typeof globalThis.fetch !== 'function') {
            return;
        }

        state.originalFetch = globalThis.fetch;
        state.wrappedFetch = async function profiledFetch(input, init) {
            if (!state.running) {
                return state.originalFetch.call(this, input, init);
            }

            const startedAt = now();
            const request = {
                id: state.requestId++,
                startedAt: round(startedAt),
                ...describeRequest(input, init),
                durationMs: null,
                status: null,
                ok: null,
                error: null,
                context: readContext(),
            };
            state.networkInFlight += 1;
            state.networkInFlightMax = Math.max(state.networkInFlightMax, state.networkInFlight);
            try {
                const response = await state.originalFetch.call(this, input, init);
                request.durationMs = round(now() - startedAt);
                request.status = Number(response?.status) || null;
                request.ok = Boolean(response?.ok);
                return response;
            } catch (error) {
                request.durationMs = round(now() - startedAt);
                request.ok = false;
                request.error = String(error?.name || error?.message || error);
                throw error;
            } finally {
                state.networkInFlight = Math.max(0, state.networkInFlight - 1);
                pushBounded(state.networkRequests, request, MAX_NETWORK_REQUESTS);
            }
        };
        globalThis.fetch = state.wrappedFetch;
    }

    function restoreFetch() {
        if (state.wrappedFetch && globalThis.fetch === state.wrappedFetch) {
            try {
                globalThis.fetch = state.originalFetch;
            } catch {
                // Leave a host-owned replacement untouched.
            }
        }
        state.originalFetch = null;
        state.wrappedFetch = null;
    }

    function installInvokeProfiler() {
        const owner = globalThis.__TAURI__?.core;
        if (!owner || typeof owner.invoke !== 'function') {
            return;
        }

        state.invokeOwner = owner;
        state.originalInvoke = owner.invoke;
        state.wrappedInvoke = async function profiledInvoke(command, ...args) {
            if (!state.running || command === 'get_perf_runtime_sample') {
                return state.originalInvoke.call(this, command, ...args);
            }

            const startedAt = now();
            const item = {
                command: String(command ?? 'unknown'),
                startedAt: round(startedAt),
                durationMs: null,
                ok: null,
                error: null,
                context: readContext(),
            };
            state.invokeInFlight += 1;
            state.invokeInFlightMax = Math.max(state.invokeInFlightMax, state.invokeInFlight);
            try {
                const result = await state.originalInvoke.call(this, command, ...args);
                item.durationMs = round(now() - startedAt);
                item.ok = true;
                return result;
            } catch (error) {
                item.durationMs = round(now() - startedAt);
                item.ok = false;
                item.error = String(error?.name || error?.message || error);
                throw error;
            } finally {
                state.invokeInFlight = Math.max(0, state.invokeInFlight - 1);
                pushBounded(state.invokes, item, MAX_INVOKES);
            }
        };

        try {
            owner.invoke = state.wrappedInvoke;
        } catch {
            state.invokeOwner = null;
            state.originalInvoke = null;
            state.wrappedInvoke = null;
        }
    }

    function restoreInvoke() {
        if (state.invokeOwner?.invoke === state.wrappedInvoke) {
            try {
                state.invokeOwner.invoke = state.originalInvoke;
            } catch {
                // Leave a host-owned replacement untouched.
            }
        }
        state.invokeOwner = null;
        state.originalInvoke = null;
        state.wrappedInvoke = null;
    }

    function start() {
        if (state.running) {
            return;
        }

        state.running = true;
        state.sessionId += 1;
        state.startedAt = now();
        state.lastHealthAt = state.startedAt;
        state.lastFrameAt = null;
        state.nativeThreadSample = null;
        state.frameSamplerCallbackCount = 0;
        state.frameSamplerSampleCount = 0;
        state.frameSamplerOverheadMs = 0;
        state.nextEventLoopProbeAt = now() + EVENT_LOOP_PROBE_INTERVAL_MS;
        resetWindow();
        globalThis.document?.addEventListener('click', onClick, true);
        installLongTaskObserver();
        installLongAnimationFrameObserver();
        installFetchProfiler();
        installInvokeProfiler();
        state.eventLoopTimer = globalThis.setInterval(() => {
            const sampledAt = now();
            const lag = Math.max(0, sampledAt - state.nextEventLoopProbeAt);
            state.eventLoopLagMs += lag;
            state.maxEventLoopLagMs = Math.max(state.maxEventLoopLagMs, lag);
            state.nextEventLoopProbeAt = sampledAt + EVENT_LOOP_PROBE_INTERVAL_MS;
        }, EVENT_LOOP_PROBE_INTERVAL_MS);
        state.healthTimer = globalThis.setInterval(flushHealthSample, HEALTH_SAMPLE_INTERVAL_MS);
        state.rafId = requestAnimationFrame(frameStep);
        void sampleNativeRuntime();
    }

    function stop() {
        if (!state.running) {
            return;
        }

        flushHealthSample();
        state.running = false;
        state.sessionId += 1;
        globalThis.document?.removeEventListener('click', onClick, true);
        state.longTaskObserver?.disconnect();
        state.longTaskObserver = null;
        state.longAnimationFrameObserver?.disconnect();
        state.longAnimationFrameObserver = null;
        globalThis.clearInterval(state.healthTimer);
        globalThis.clearInterval(state.eventLoopTimer);
        state.healthTimer = null;
        state.eventLoopTimer = null;
        if (state.rafId !== null) {
            cancelAnimationFrame(state.rafId);
            state.rafId = null;
        }
        restoreFetch();
        restoreInvoke();
    }

    function clear() {
        state.interactions = [];
        state.networkRequests = [];
        state.invokes = [];
        state.healthSamples = [];
        state.longAnimationFrames = [];
        state.longAnimationFrameObserved = 0;
        state.longAnimationFrameDropped = 0;
        state.nextLongAnimationFrameId = 1;
        state.nativeThreadSample = null;
        state.networkInFlightMax = state.networkInFlight;
        state.invokeInFlightMax = state.invokeInFlight;
    }

    function snapshot() {
        return {
            capabilities: { ...state.capabilities },
            startedAt: round(state.startedAt),
            frameSampler: {
                sharedConsumer: typeof frameSampleCallback === 'function',
                callbackCount: state.frameSamplerCallbackCount,
                sampleCount: state.frameSamplerSampleCount,
                callbackOverheadMs: round(state.frameSamplerOverheadMs),
            },
            interactions: structuredClone(state.interactions),
            longAnimationFrames: {
                observed: state.longAnimationFrameObserved,
                stored: state.longAnimationFrames.length,
                dropped: state.longAnimationFrameDropped,
                maxScriptsPerFrame: MAX_SCRIPTS_PER_LONG_ANIMATION_FRAME,
                samples: structuredClone(state.longAnimationFrames),
            },
            network: {
                inFlight: state.networkInFlight,
                inFlightMax: state.networkInFlightMax,
                requests: structuredClone(state.networkRequests),
            },
            invokes: {
                inFlight: state.invokeInFlight,
                inFlightMax: state.invokeInFlightMax,
                recent: structuredClone(state.invokes),
            },
            healthSamples: structuredClone(state.healthSamples),
        };
    }

    function summary() {
        return {
            lastInteraction: state.interactions.at(-1) ?? null,
            lastHealthSample: state.healthSamples.at(-1) ?? null,
            networkInFlight: state.networkInFlight,
            networkInFlightMax: state.networkInFlightMax,
            invokeInFlight: state.invokeInFlight,
            invokeInFlightMax: state.invokeInFlightMax,
        };
    }

    return Object.freeze({ start, stop, clear, snapshot, summary });
}
