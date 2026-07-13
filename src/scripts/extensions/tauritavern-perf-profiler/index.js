import { eventSource, event_types } from '../../../script.js';
import { invoke, isTauri } from '../../../tauri-bridge.js';
import { serializeSlowInteraction } from '../../tauri/perf/interaction-timing.js';
import { createRuntimeDiagnostics } from '../../tauri/perf/runtime-diagnostics.js';

const GLOBAL_KEY = '__TAURITAVERN_PERF_PROFILER__';
const MAX_RECORDS = 20;
const MAX_FRAME_SAMPLES = 600;
const MAX_CHAT_LOADS = 20;
const MAX_SLOW_INTERACTIONS = 100;
const MAX_OPERATIONS = 100;
const MAX_UNATTRIBUTED_TRACES = 50;
const MAX_AUTOMATION_SAMPLES = 300;
const MAX_STREAM_FORMAT_SAMPLES = 300;
const MAX_HISTORY_PREPEND_SAMPLES = 200;
const MAX_SLOW_LISTENERS = 100;
const SLOW_LISTENER_THRESHOLD_MS = 8;

const runtimeDiagnostics = createRuntimeDiagnostics({
    nativeSampler: isTauri() ? () => invoke('get_perf_runtime_sample') : undefined,
});

const state = {
    capturing: false,
    current: null,
    records: [],
    nextId: 1,
    observer: null,
    measureObserver: null,
    interactionObserver: null,
    chatLoads: [],
    slowInteractions: [],
    operations: [],
    unattributedTraces: [],
    automationSamples: [],
    automationObserved: 0,
    automationDropped: 0,
    streamFormatSamples: [],
    streamFormatObserved: 0,
    streamFormatDropped: 0,
    historyPrependSamples: [],
    historyPrependObserved: 0,
    historyPrependDropped: 0,
    slowListeners: [],
    slowListenerObserved: 0,
    slowListenerDropped: 0,
    listenerAggregates: new Map(),
    rafId: null,
    lastFrameAt: null,
    panel: null,
    status: null,
    toggleButton: null,
};

function now() {
    return globalThis.performance?.now?.() ?? Date.now();
}

function finiteRound(value, digits = 1) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return null;
    }

    const factor = 10 ** digits;
    return Math.round(number * factor) / factor;
}

function getCollectionSize(value) {
    if (value instanceof Map || value instanceof Set) {
        return value.size;
    }
    if (Array.isArray(value)) {
        return value.length;
    }
    return 0;
}

function createRecord(type, dryRun, { startedAt = now(), generationTraceRunId = null } = {}) {
    return {
        id: state.nextId++,
        type: String(type ?? 'unknown'),
        dryRun: Boolean(dryRun),
        startedAt,
        startedAtIso: new Date().toISOString(),
        endedAt: null,
        durationMs: null,
        finishReason: null,
        generation: {
            traceRunId: generationTraceRunId,
            trace: null,
        },
        worldInfo: {
            entriesLoadedAtMs: null,
            globalEntries: 0,
            characterEntries: 0,
            chatEntries: 0,
            personaEntries: 0,
            scanLoops: 0,
            sortedEntries: 0,
            activatedEntries: 0,
            successfulEntries: 0,
            budgetOverflowed: false,
            finalScanAtMs: null,
            trace: null,
        },
        stream: {
            chunks: 0,
            chars: 0,
            firstChunkAtMs: null,
            lastChunkAtMs: null,
            renderedAtMs: null,
            trace: null,
        },
        responsiveness: {
            frames: 0,
            averageFrameMs: null,
            maxFrameMs: 0,
            longFrames: 0,
            longTasks: 0,
            longTaskTotalMs: 0,
            maxLongTaskMs: 0,
        },
        memory: readHeapSample(),
        _frameSamples: [],
    };
}

function readHeapSample() {
    const memory = globalThis.performance?.memory;
    if (!memory) {
        return null;
    }

    return {
        usedHeapBytes: Number(memory.usedJSHeapSize) || null,
        totalHeapBytes: Number(memory.totalJSHeapSize) || null,
        heapLimitBytes: Number(memory.jsHeapSizeLimit) || null,
    };
}

function finalizeRecord(reason) {
    const record = state.current;
    if (!record) {
        return;
    }

    const endedAt = now();
    record.endedAt = endedAt;
    record.durationMs = finiteRound(endedAt - record.startedAt);
    record.finishReason = reason;
    record.memory = readHeapSample() ?? record.memory;

    const samples = record._frameSamples;
    if (samples.length > 0) {
        const total = samples.reduce((sum, value) => sum + value, 0);
        record.responsiveness.frames = samples.length;
        record.responsiveness.averageFrameMs = finiteRound(total / samples.length);
        record.responsiveness.maxFrameMs = finiteRound(Math.max(...samples));
        record.responsiveness.longFrames = samples.filter(value => value >= 50).length;
    }
    delete record._frameSamples;

    state.records.push(record);
    if (state.records.length > MAX_RECORDS) {
        state.records.splice(0, state.records.length - MAX_RECORDS);
    }

    state.current = null;
    renderStatus();
}

function onGenerationStarted(type, _options, dryRun) {
    if (!state.capturing) {
        return;
    }

    if (state.current?.generation?.traceRunId) {
        return;
    }

    finalizeRecord('superseded');
    state.current = createRecord(type, dryRun);
    renderStatus();
}

function installTraceStartProfiler() {
    globalThis.__TAURITAVERN_PERF_TRACE_STARTED__ = ({ prefix, runId, startedAt, detail } = {}) => {
        if (!state.capturing || prefix !== 'tt:generation' || !runId) {
            return;
        }

        finalizeRecord('superseded');
        state.current = createRecord(detail?.type, detail?.dryRun, {
            startedAt: Number(startedAt) || now(),
            generationTraceRunId: String(runId),
        });
        renderStatus();
    };
}

function storeUnattributedTrace(name, entry, trace, reason) {
    state.unattributedTraces.push({
        name,
        startedAt: finiteRound(entry.startTime),
        reason,
        ...trace,
    });
    if (state.unattributedTraces.length > MAX_UNATTRIBUTED_TRACES) {
        state.unattributedTraces.splice(0, state.unattributedTraces.length - MAX_UNATTRIBUTED_TRACES);
    }
}

function onWorldInfoEntriesLoaded({ globalLore, characterLore, chatLore, personaLore } = {}) {
    const record = state.current;
    if (!record) {
        return;
    }

    record.worldInfo.entriesLoadedAtMs = finiteRound(now() - record.startedAt);
    record.worldInfo.globalEntries = getCollectionSize(globalLore);
    record.worldInfo.characterEntries = getCollectionSize(characterLore);
    record.worldInfo.chatEntries = getCollectionSize(chatLore);
    record.worldInfo.personaEntries = getCollectionSize(personaLore);
}

function onWorldInfoScanDone(args = {}) {
    const record = state.current;
    if (!record) {
        return;
    }

    record.worldInfo.scanLoops = Math.max(record.worldInfo.scanLoops, Number(args.state?.loopCount) || 0);
    record.worldInfo.sortedEntries = getCollectionSize(args.sortedEntries);
    record.worldInfo.activatedEntries = getCollectionSize(args.activated?.entries);
    record.worldInfo.successfulEntries = getCollectionSize(args.new?.successful);
    record.worldInfo.budgetOverflowed ||= Boolean(args.budget?.overflowed);

    if (args.isFinal) {
        record.worldInfo.finalScanAtMs = finiteRound(now() - record.startedAt);
    }
}

function onStreamTokenReceived(text) {
    const record = state.current;
    if (!record) {
        return;
    }

    const elapsed = now() - record.startedAt;
    record.stream.chunks += 1;
    record.stream.chars = typeof text === 'string' ? text.length : record.stream.chars;
    record.stream.firstChunkAtMs ??= finiteRound(elapsed);
    record.stream.lastChunkAtMs = finiteRound(elapsed);
}

function onMessageRendered() {
    const record = state.current;
    if (record) {
        record.stream.renderedAtMs = finiteRound(now() - record.startedAt);
    }
}

function startFrameSampler() {
    if (state.rafId !== null) {
        return;
    }

    const step = timestamp => {
        if (state.capturing) {
            if (state.current && state.lastFrameAt !== null) {
                const delta = timestamp - state.lastFrameAt;
                const samples = state.current._frameSamples;
                if (samples.length < MAX_FRAME_SAMPLES) {
                    samples.push(delta);
                }
            }
            state.lastFrameAt = timestamp;
            state.rafId = requestAnimationFrame(step);
        } else {
            state.lastFrameAt = null;
            state.rafId = null;
        }
    };

    state.rafId = requestAnimationFrame(step);
}

function installLongTaskObserver() {
    if (state.observer || typeof PerformanceObserver !== 'function') {
        return;
    }

    try {
        state.observer = new PerformanceObserver(list => {
            for (const entry of list.getEntries()) {
                const record = state.current;
                if (!record || entry.startTime < record.startedAt) {
                    continue;
                }

                const duration = Number(entry.duration) || 0;
                record.responsiveness.longTasks += 1;
                record.responsiveness.longTaskTotalMs = finiteRound(record.responsiveness.longTaskTotalMs + duration);
                record.responsiveness.maxLongTaskMs = finiteRound(Math.max(record.responsiveness.maxLongTaskMs, duration));
            }
        });
        state.observer.observe({ type: 'longtask', buffered: false });
    } catch {
        state.observer = null;
    }
}

function installMeasureObserver() {
    if (state.measureObserver || typeof PerformanceObserver !== 'function') {
        return;
    }

    try {
        state.measureObserver = new PerformanceObserver(list => {
            for (const entry of list.getEntries()) {
                if (!entry.name.startsWith('tt:') || !entry.name.endsWith(':total')) {
                    continue;
                }

                const trace = {
                    durationMs: finiteRound(entry.duration),
                    ...(entry.detail && typeof entry.detail === 'object' ? structuredClone(entry.detail) : {}),
                };

                if (entry.name === 'tt:chat-load:total') {
                    state.chatLoads.push({
                        startedAt: finiteRound(entry.startTime),
                        ...trace,
                    });
                    if (state.chatLoads.length > MAX_CHAT_LOADS) {
                        state.chatLoads.splice(0, state.chatLoads.length - MAX_CHAT_LOADS);
                    }
                    renderStatus();
                    continue;
                }

                if (!['tt:generation:total', 'tt:world-info:total', 'tt:stream:total'].includes(entry.name)) {
                    state.operations.push({
                        name: entry.name.slice(3, -6),
                        startedAt: finiteRound(entry.startTime),
                        ...trace,
                    });
                    if (state.operations.length > MAX_OPERATIONS) {
                        state.operations.splice(0, state.operations.length - MAX_OPERATIONS);
                    }
                    renderStatus();
                    continue;
                }

                const expectedGenerationRunId = entry.name === 'tt:generation:total'
                    ? trace.runId
                    : trace.parentRunId;
                const record = expectedGenerationRunId
                    ? [state.current, ...state.records.slice().reverse()]
                        .find(candidate => candidate?.generation?.traceRunId === expectedGenerationRunId)
                    : null;
                if (!record) {
                    storeUnattributedTrace(
                        entry.name.slice(3, -6),
                        entry,
                        trace,
                        expectedGenerationRunId ? 'generation-record-not-found' : 'missing-parent-run-id',
                    );
                    continue;
                }

                if (entry.name === 'tt:generation:total') {
                    record.generation.trace = trace;
                } else if (entry.name === 'tt:world-info:total') {
                    record.worldInfo.trace = trace;
                } else {
                    record.stream.trace = trace;
                }
                renderStatus();
            }
        });
        state.measureObserver.observe({ type: 'measure', buffered: false });
    } catch {
        state.measureObserver = null;
    }
}

function installEventListenerProfiler() {
    globalThis.__TAURITAVERN_PERF_EVENT_LISTENER__ = ({
        event,
        listener,
        registration,
        index,
        durationMs,
        synchronousDurationMs,
        waitDurationMs,
    }) => {
        if (!state.capturing || durationMs < SLOW_LISTENER_THRESHOLD_MS) {
            return;
        }

        state.slowListenerObserved += 1;
        const identity = registration?.stableKey
            ?? registration?.id
            ?? `${String(event)}:${registration?.source?.modulePath ?? listener?.name ?? '(anonymous)'}:${Number(index)}`;
        const aggregate = state.listenerAggregates.get(identity) ?? {
            identity,
            event: String(event),
            registration: registration ? structuredClone(registration) : null,
            count: 0,
            totalDurationMs: 0,
            totalSynchronousMs: 0,
            totalWaitMs: 0,
            maxDurationMs: 0,
        };
        aggregate.count += 1;
        aggregate.totalDurationMs += Number(durationMs) || 0;
        aggregate.totalSynchronousMs += Number(synchronousDurationMs) || 0;
        aggregate.totalWaitMs += Number(waitDurationMs) || 0;
        aggregate.maxDurationMs = Math.max(aggregate.maxDurationMs, Number(durationMs) || 0);
        state.listenerAggregates.set(identity, aggregate);

        state.slowListeners.push({
            event: String(event),
            listener: registration?.listenerName || listener?.name || '(anonymous)',
            identity,
            registration: registration ? structuredClone(registration) : null,
            index: Number(index),
            durationMs: finiteRound(durationMs),
            synchronousDurationMs: finiteRound(synchronousDurationMs),
            waitDurationMs: finiteRound(waitDurationMs),
            observedAt: finiteRound(now()),
        });
        if (state.slowListeners.length > MAX_SLOW_LISTENERS) {
            const dropped = state.slowListeners.length - MAX_SLOW_LISTENERS;
            state.slowListeners.splice(0, dropped);
            state.slowListenerDropped += dropped;
        }
    };
}

function installAutomationProfiler() {
    globalThis.__TAURITAVERN_PERF_AUTOMATION__ = sample => {
        if (!state.capturing || !sample || typeof sample !== 'object') {
            return;
        }

        state.automationObserved += 1;
        state.automationSamples.push({
            ...structuredClone(sample),
            durationMs: finiteRound(sample.durationMs),
            observedAt: finiteRound(now()),
        });
        if (state.automationSamples.length > MAX_AUTOMATION_SAMPLES) {
            const dropped = state.automationSamples.length - MAX_AUTOMATION_SAMPLES;
            state.automationSamples.splice(0, dropped);
            state.automationDropped += dropped;
        }
    };
}

function getAutomationProfilerSnapshot() {
    return {
        observed: state.automationObserved,
        stored: state.automationSamples.length,
        dropped: state.automationDropped,
        samples: structuredClone(state.automationSamples),
    };
}

function installStreamFormatProfiler() {
    globalThis.__TAURITAVERN_PERF_STREAM_FORMAT__ = sample => {
        if (!state.capturing || !sample || typeof sample !== 'object') {
            return;
        }

        state.streamFormatObserved += 1;
        state.streamFormatSamples.push({
            ...structuredClone(sample),
            durationMs: finiteRound(sample.durationMs),
            observedAt: finiteRound(now()),
        });
        if (state.streamFormatSamples.length > MAX_STREAM_FORMAT_SAMPLES) {
            const dropped = state.streamFormatSamples.length - MAX_STREAM_FORMAT_SAMPLES;
            state.streamFormatSamples.splice(0, dropped);
            state.streamFormatDropped += dropped;
        }
    };
}

function getStreamFormatProfilerSnapshot() {
    return {
        observed: state.streamFormatObserved,
        stored: state.streamFormatSamples.length,
        dropped: state.streamFormatDropped,
        samples: structuredClone(state.streamFormatSamples),
    };
}

function installHistoryPrependProfiler() {
    globalThis.__TAURITAVERN_PERF_HISTORY_PREPEND__ = sample => {
        if (!state.capturing || !sample || typeof sample !== 'object') {
            return;
        }

        state.historyPrependObserved += 1;
        state.historyPrependSamples.push({
            ...structuredClone(sample),
            renderDurationMs: finiteRound(sample.renderDurationMs),
            domCommitDurationMs: finiteRound(sample.domCommitDurationMs),
            anchorDurationMs: finiteRound(sample.anchorDurationMs),
            totalDurationMs: finiteRound(sample.totalDurationMs),
            observedAt: finiteRound(now()),
        });
        if (state.historyPrependSamples.length > MAX_HISTORY_PREPEND_SAMPLES) {
            const dropped = state.historyPrependSamples.length - MAX_HISTORY_PREPEND_SAMPLES;
            state.historyPrependSamples.splice(0, dropped);
            state.historyPrependDropped += dropped;
        }
    };
}

function getHistoryPrependProfilerSnapshot() {
    return {
        observed: state.historyPrependObserved,
        stored: state.historyPrependSamples.length,
        dropped: state.historyPrependDropped,
        samples: structuredClone(state.historyPrependSamples),
    };
}

function getListenerProfilerSnapshot() {
    return {
        thresholdMs: SLOW_LISTENER_THRESHOLD_MS,
        observed: state.slowListenerObserved,
        stored: state.slowListeners.length,
        dropped: state.slowListenerDropped,
        aggregates: Array.from(state.listenerAggregates.values(), aggregate => ({
            ...structuredClone(aggregate),
            totalDurationMs: finiteRound(aggregate.totalDurationMs),
            totalSynchronousMs: finiteRound(aggregate.totalSynchronousMs),
            totalWaitMs: finiteRound(aggregate.totalWaitMs),
            maxDurationMs: finiteRound(aggregate.maxDurationMs),
        })),
    };
}

function installInteractionObserver() {
    if (state.interactionObserver || typeof PerformanceObserver !== 'function') {
        return;
    }

    try {
        state.interactionObserver = new PerformanceObserver(list => {
            for (const entry of list.getEntries()) {
                const interaction = serializeSlowInteraction(entry);
                if (!interaction) {
                    continue;
                }

                state.slowInteractions.push(interaction);
                if (state.slowInteractions.length > MAX_SLOW_INTERACTIONS) {
                    state.slowInteractions.splice(0, state.slowInteractions.length - MAX_SLOW_INTERACTIONS);
                }
            }
        });
        state.interactionObserver.observe({ type: 'event', buffered: false, durationThreshold: 100 });
    } catch {
        state.interactionObserver = null;
    }
}

function startCapture() {
    if (state.capturing) {
        return;
    }

    state.capturing = true;
    state.lastFrameAt = null;
    installLongTaskObserver();
    installMeasureObserver();
    installInteractionObserver();
    installEventListenerProfiler();
    installTraceStartProfiler();
    installAutomationProfiler();
    installStreamFormatProfiler();
    installHistoryPrependProfiler();
    startFrameSampler();
    runtimeDiagnostics.start();
    renderStatus();
}

function stopCapture() {
    if (!state.capturing) {
        return;
    }

    finalizeRecord('capture-stopped');
    state.capturing = false;
    delete globalThis.__TAURITAVERN_PERF_EVENT_LISTENER__;
    delete globalThis.__TAURITAVERN_PERF_TRACE_STARTED__;
    delete globalThis.__TAURITAVERN_PERF_AUTOMATION__;
    delete globalThis.__TAURITAVERN_PERF_STREAM_FORMAT__;
    delete globalThis.__TAURITAVERN_PERF_HISTORY_PREPEND__;
    runtimeDiagnostics.stop();
    renderStatus();
}

function snapshot() {
    return {
        schemaVersion: 9,
        exportedAt: new Date().toISOString(),
        userAgent: navigator.userAgent,
        viewport: {
            width: globalThis.innerWidth,
            height: globalThis.innerHeight,
            devicePixelRatio: globalThis.devicePixelRatio,
        },
        current: state.current ? structuredClone(state.current) : null,
        records: structuredClone(state.records),
        chatLoads: structuredClone(state.chatLoads),
        slowInteractions: structuredClone(state.slowInteractions),
        operations: structuredClone(state.operations),
        unattributedTraces: structuredClone(state.unattributedTraces),
        slowListeners: structuredClone(state.slowListeners),
        listenerProfiler: getListenerProfilerSnapshot(),
        automationProfiler: getAutomationProfilerSnapshot(),
        streamFormatProfiler: getStreamFormatProfilerSnapshot(),
        historyPrependProfiler: getHistoryPrependProfilerSnapshot(),
        diagnostics: runtimeDiagnostics.snapshot(),
    };
}

function downloadReport() {
    const blob = new Blob([JSON.stringify(snapshot(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `tauritavern-perf-${new Date().toISOString().replaceAll(':', '-')}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
}

function formatMs(value) {
    return Number.isFinite(value) ? `${Math.round(value)} ms` : '-';
}

function renderStatus() {
    if (!state.status || !state.toggleButton) {
        return;
    }

    state.toggleButton.classList.toggle('is-capturing', state.capturing);
    const record = state.current ?? state.records.at(-1);
    const diagnostics = runtimeDiagnostics.summary();
    if (!record) {
        const lastHealth = diagnostics.lastHealthSample;
        const lastClick = diagnostics.lastInteraction;
        state.status.innerHTML = `
            <div>${state.capturing ? '正在采集，等待操作…' : '采集已停止'}</div>
            <div>点击可见：${formatMs(lastClick?.totalMs)} · 主线程忙：${Number.isFinite(lastHealth?.mainThreadBusyRatio) ? `${Math.round(lastHealth.mainThreadBusyRatio * 100)}%` : '-'}</div>
            <div>网络：${diagnostics.networkInFlight} 并发 / 峰值 ${diagnostics.networkInFlightMax} · Invoke：${diagnostics.invokeInFlight} / 峰值 ${diagnostics.invokeInFlightMax}</div>
        `;
        return;
    }

    const duration = state.current ? now() - record.startedAt : record.durationMs;
    const worldInfoPhases = record.worldInfo.trace?.phases ?? {};
    const streamPhases = record.stream.trace?.phases ?? {};
    const generationPhases = record.generation.trace?.phases ?? {};
    const lastChatLoad = state.chatLoads.at(-1);
    const lastOperation = state.operations.at(-1);
    const lastHealth = diagnostics.lastHealthSample;
    const lastClick = diagnostics.lastInteraction;
    state.status.innerHTML = `
        <div><b>${state.current ? '正在生成' : '最近一次'}</b> #${record.id} · ${record.type}</div>
        <div>总耗时：${formatMs(duration)}</div>
        <div>世界书：${record.worldInfo.sortedEntries} 条 / ${record.worldInfo.scanLoops} 轮 / ${record.worldInfo.activatedEntries} 激活</div>
        <div>载入：${formatMs(worldInfoPhases['entries-total']?.durationMs)} · 匹配：${formatMs(worldInfoPhases['entry-scan']?.durationMs)} · Token：${formatMs(worldInfoPhases['token-count']?.durationMs)}</div>
        <div>格式化：${formatMs(streamPhases['format-total']?.durationMs)} · DOM：${formatMs(streamPhases['dom-commit']?.durationMs)}</div>
        <div>首块：${formatMs(record.stream.firstChunkAtMs)} · 流块：${record.stream.chunks}</div>
        <div>Prompt：${formatMs(generationPhases['prompt-assembly']?.durationMs)} · 请求：${formatMs(generationPhases['request-dispatch']?.durationMs ?? generationPhases['request-response']?.durationMs)}</div>
        <div>聊天载入：${formatMs(lastChatLoad?.durationMs)} · 慢交互：${state.slowInteractions.length}</div>
        <div>点击可见：${formatMs(lastClick?.totalMs)} · 主线程忙：${Number.isFinite(lastHealth?.mainThreadBusyRatio) ? `${Math.round(lastHealth.mainThreadBusyRatio * 100)}%` : '-'}</div>
        <div>网络：${diagnostics.networkInFlight} 并发 / 峰值 ${diagnostics.networkInFlightMax} · Invoke：${diagnostics.invokeInFlight} / 峰值 ${diagnostics.invokeInFlightMax}</div>
        <div>CPU：${Number.isFinite(lastHealth?.native?.processCpuPercent) ? `${lastHealth.native.processCpuPercent}%` : '-'} · 温度：${Number.isFinite(lastHealth?.native?.batteryTemperatureC) ? `${lastHealth.native.batteryTemperatureC} °C` : '-'}</div>
        <div>最近操作：${lastOperation?.name ?? '-'} / ${formatMs(lastOperation?.durationMs)} · 慢监听：${state.slowListeners.length}</div>
        <div>长任务：${record.responsiveness.longTasks} 次 / ${formatMs(record.responsiveness.maxLongTaskMs)}</div>
    `;
}

function createUi() {
    const toggleButton = document.createElement('button');
    toggleButton.id = 'tt-perf-profiler-toggle';
    toggleButton.type = 'button';
    toggleButton.textContent = 'Perf';
    toggleButton.title = '打开性能分析器';

    const panel = document.createElement('section');
    panel.id = 'tt-perf-profiler-panel';
    panel.hidden = true;
    panel.innerHTML = `
        <header>
            <strong>性能分析器</strong>
            <button type="button" data-action="close" aria-label="关闭">×</button>
        </header>
        <div class="tt-perf-profiler-status"></div>
        <footer>
            <button type="button" data-action="capture">开始采集</button>
            <button type="button" data-action="export">导出 JSON</button>
            <button type="button" data-action="clear">清空</button>
        </footer>
    `;

    document.body.append(toggleButton, panel);
    state.panel = panel;
    state.status = panel.querySelector('.tt-perf-profiler-status');
    state.toggleButton = toggleButton;

    const captureButton = panel.querySelector('[data-action="capture"]');
    toggleButton.addEventListener('click', () => {
        panel.hidden = !panel.hidden;
        renderStatus();
    });
    panel.querySelector('[data-action="close"]').addEventListener('click', () => {
        panel.hidden = true;
    });
    captureButton.addEventListener('click', () => {
        state.capturing ? stopCapture() : startCapture();
        captureButton.textContent = state.capturing ? '停止采集' : '开始采集';
    });
    panel.querySelector('[data-action="export"]').addEventListener('click', downloadReport);
    panel.querySelector('[data-action="clear"]').addEventListener('click', () => {
        state.records = [];
        state.chatLoads = [];
        state.slowInteractions = [];
        state.operations = [];
        state.unattributedTraces = [];
        state.slowListeners = [];
        state.slowListenerObserved = 0;
        state.slowListenerDropped = 0;
        state.listenerAggregates.clear();
        state.automationSamples = [];
        state.automationObserved = 0;
        state.automationDropped = 0;
        state.streamFormatSamples = [];
        state.streamFormatObserved = 0;
        state.streamFormatDropped = 0;
        state.historyPrependSamples = [];
        state.historyPrependObserved = 0;
        state.historyPrependDropped = 0;
        runtimeDiagnostics.clear();
        renderStatus();
    });

    renderStatus();
}

function subscribeEvents() {
    eventSource.on(event_types.GENERATION_STARTED, onGenerationStarted);
    eventSource.on(event_types.WORLDINFO_ENTRIES_LOADED, onWorldInfoEntriesLoaded);
    eventSource.on(event_types.WORLDINFO_SCAN_DONE, onWorldInfoScanDone);
    eventSource.on(event_types.STREAM_TOKEN_RECEIVED, onStreamTokenReceived);
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onMessageRendered);
    eventSource.on(event_types.GENERATION_ENDED, () => finalizeRecord('generation-ended'));
    eventSource.on(event_types.GENERATION_STOPPED, () => finalizeRecord('generation-stopped'));
}

export function init() {
    if (globalThis[GLOBAL_KEY]) {
        return;
    }

    createUi();
    subscribeEvents();

    const api = Object.freeze({
        start: startCapture,
        stop: stopCapture,
        snapshot,
        downloadReport,
        get capturing() {
            return state.capturing;
        },
    });

    Object.defineProperty(globalThis, GLOBAL_KEY, {
        value: api,
        configurable: true,
        enumerable: false,
    });
}
