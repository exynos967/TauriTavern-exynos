const MAX_LINKED_PHASES = 8;

function round(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number * 10) / 10 : null;
}

function intervalEnd(startTime, durationMs) {
    return Number(startTime) + Math.max(0, Number(durationMs) || 0);
}

function overlaps(left, right) {
    const leftStart = Number(left?.startTime);
    const rightStart = Number(right?.startTime);
    if (!Number.isFinite(leftStart) || !Number.isFinite(rightStart)) {
        return false;
    }

    return leftStart < intervalEnd(rightStart, right?.durationMs)
        && rightStart < intervalEnd(leftStart, left?.durationMs);
}

function targetKey(target) {
    if (!target) {
        return null;
    }

    return [target.tag, target.id, ...(target.classes ?? [])].filter(Boolean).join('.');
}

export function createLongTaskSample(entry, { recordId = null, generationTraceRunId = null } = {}) {
    return {
        startTime: round(entry?.startTime),
        durationMs: round(entry?.duration),
        recordId,
        generationTraceRunId,
        phases: [],
    };
}

export function linkLongTaskPhase(longTask, phase) {
    if (!longTask || !phase || !overlaps(longTask, phase)) {
        return false;
    }

    const normalized = {
        name: String(phase.name ?? 'unknown'),
        startTime: round(phase.startTime),
        durationMs: round(phase.durationMs),
        runId: phase.runId ? String(phase.runId) : null,
    };
    if (longTask.phases.some(item => item.name === normalized.name && item.startTime === normalized.startTime)) {
        return false;
    }

    longTask.phases.push(normalized);
    longTask.phases.sort((left, right) => (right.durationMs ?? 0) - (left.durationMs ?? 0));
    if (longTask.phases.length > MAX_LINKED_PHASES) {
        longTask.phases.length = MAX_LINKED_PHASES;
    }
    return true;
}

export function groupSlowInteractions(interactions, longTasks = [], longAnimationFrames = []) {
    const groups = new Map();
    for (const interaction of interactions ?? []) {
        const startTime = Number(interaction?.startTime);
        const durationMs = Number(interaction?.durationMs);
        if (!Number.isFinite(startTime) || !Number.isFinite(durationMs)) {
            continue;
        }

        const key = interaction.interactionId
            ? `interaction:${interaction.interactionId}`
            : `event:${round(startTime)}:${round(durationMs)}:${targetKey(interaction.target) ?? interaction.name}`;
        const group = groups.get(key) ?? {
            key,
            interactionId: interaction.interactionId ?? null,
            startTime: round(startTime),
            _endedAt: intervalEnd(startTime, durationMs),
            durationMs: 0,
            inputDelayMs: 0,
            processingMs: 0,
            presentationDelayMs: 0,
            eventCount: 0,
            events: [],
            targets: [],
            longTaskCount: 0,
            longTaskTotalMs: 0,
            maxLongTaskMs: 0,
            longAnimationFrameCount: 0,
            longAnimationFrameTotalMs: 0,
            maxLongAnimationFrameMs: 0,
            blockingDurationMs: 0,
            renderDurationMs: 0,
            forcedStyleAndLayoutDurationMs: 0,
            longAnimationFrameIds: [],
            scripts: [],
            generationTraceRunIds: [],
            stages: [],
        };

        group.startTime = round(Math.min(group.startTime, startTime));
        group._endedAt = Math.max(group._endedAt, intervalEnd(startTime, durationMs));
        group.durationMs = round(group._endedAt - group.startTime);
        group.inputDelayMs = round(Math.max(group.inputDelayMs, Number(interaction.inputDelayMs) || 0));
        group.processingMs = round(Math.max(group.processingMs, Number(interaction.processingMs) || 0));
        group.presentationDelayMs = round(Math.max(group.presentationDelayMs, Number(interaction.presentationDelayMs) || 0));
        group.eventCount += 1;
        if (!group.events.includes(interaction.name)) {
            group.events.push(interaction.name);
        }

        const normalizedTargetKey = targetKey(interaction.target);
        if (normalizedTargetKey && !group.targets.some(item => item.key === normalizedTargetKey)) {
            group.targets.push({ key: normalizedTargetKey, ...structuredClone(interaction.target) });
        }
        if (interaction.context?.generationTraceRunId
            && !group.generationTraceRunIds.includes(interaction.context.generationTraceRunId)) {
            group.generationTraceRunIds.push(interaction.context.generationTraceRunId);
        }
        if (interaction.context?.stage && !group.stages.includes(interaction.context.stage)) {
            group.stages.push(interaction.context.stage);
        }
        groups.set(key, group);
    }

    const result = Array.from(groups.values()).sort((left, right) => left.startTime - right.startTime);
    for (const group of result) {
        for (const longTask of longTasks ?? []) {
            if (!overlaps(group, longTask)) {
                continue;
            }
            group.longTaskCount += 1;
            group.longTaskTotalMs = round(group.longTaskTotalMs + (Number(longTask.durationMs) || 0));
            group.maxLongTaskMs = round(Math.max(group.maxLongTaskMs, Number(longTask.durationMs) || 0));
            if (longTask.generationTraceRunId && !group.generationTraceRunIds.includes(longTask.generationTraceRunId)) {
                group.generationTraceRunIds.push(longTask.generationTraceRunId);
            }
        }
        const scripts = new Map();
        for (const frame of longAnimationFrames ?? []) {
            if (!overlaps(group, frame)) {
                continue;
            }
            group.longAnimationFrameCount += 1;
            group.longAnimationFrameTotalMs = round(group.longAnimationFrameTotalMs + (Number(frame.durationMs) || 0));
            group.maxLongAnimationFrameMs = round(Math.max(group.maxLongAnimationFrameMs, Number(frame.durationMs) || 0));
            group.blockingDurationMs = round(group.blockingDurationMs + (Number(frame.blockingDurationMs) || 0));
            group.renderDurationMs = round(group.renderDurationMs + (Number(frame.renderDurationMs) || 0));
            group.forcedStyleAndLayoutDurationMs = round(
                group.forcedStyleAndLayoutDurationMs + (Number(frame.forcedStyleAndLayoutDurationMs) || 0),
            );
            if (frame.id !== null && frame.id !== undefined && !group.longAnimationFrameIds.includes(frame.id)) {
                group.longAnimationFrameIds.push(frame.id);
            }
            for (const script of frame.scripts ?? []) {
                const key = [
                    script.invokerType,
                    script.invoker,
                    script.sourceUrl,
                    script.sourceFunctionName,
                    script.sourceCharPosition,
                ].join('|');
                const aggregate = scripts.get(key) ?? {
                    key,
                    invokerType: script.invokerType || null,
                    invoker: script.invoker || null,
                    sourceUrl: script.sourceUrl || null,
                    sourceFunctionName: script.sourceFunctionName || null,
                    sourceCharPosition: script.sourceCharPosition ?? null,
                    count: 0,
                    totalDurationMs: 0,
                    maxDurationMs: 0,
                    forcedStyleAndLayoutDurationMs: 0,
                };
                aggregate.count += 1;
                aggregate.totalDurationMs = round(aggregate.totalDurationMs + (Number(script.durationMs) || 0));
                aggregate.maxDurationMs = round(Math.max(aggregate.maxDurationMs, Number(script.durationMs) || 0));
                aggregate.forcedStyleAndLayoutDurationMs = round(
                    aggregate.forcedStyleAndLayoutDurationMs + (Number(script.forcedStyleAndLayoutDurationMs) || 0),
                );
                scripts.set(key, aggregate);
            }
        }
        group.scripts = Array.from(scripts.values())
            .sort((left, right) => right.totalDurationMs - left.totalDurationMs)
            .slice(0, MAX_LINKED_PHASES);
        delete group._endedAt;
    }
    return result;
}
