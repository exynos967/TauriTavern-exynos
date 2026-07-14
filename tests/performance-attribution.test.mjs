import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createLongTaskSample,
    groupSlowInteractions,
    linkLongTaskPhase,
} from '../src/scripts/tauri/perf/performance-attribution.js';

test('long task attribution keeps overlapping slow phases', () => {
    const longTask = createLongTaskSample({ startTime: 100, duration: 250 }, {
        recordId: 7,
        generationTraceRunId: 'generation-7',
    });

    assert.equal(linkLongTaskPhase(longTask, {
        name: 'generation:prompt-assembly',
        startTime: 150,
        durationMs: 120,
        runId: 'generation-7',
    }), true);
    assert.equal(linkLongTaskPhase(longTask, {
        name: 'chat-load:payload-read',
        startTime: 400,
        durationMs: 20,
        runId: 'chat-1',
    }), false);
    assert.deepEqual(longTask.phases, [{
        name: 'generation:prompt-assembly',
        startTime: 150,
        durationMs: 120,
        runId: 'generation-7',
    }]);
});

test('slow interaction groups collapse browser event duplicates and link long tasks', () => {
    const interactions = [
        {
            name: 'pointerdown',
            startTime: 100,
            durationMs: 160,
            inputDelayMs: 30,
            processingMs: 60,
            presentationDelayMs: 70,
            interactionId: 42,
            target: { tag: 'button', id: 'send_but', classes: ['menu_button'], name: 'Send' },
        },
        {
            name: 'click',
            startTime: 120,
            durationMs: 180,
            inputDelayMs: 40,
            processingMs: 50,
            presentationDelayMs: 90,
            interactionId: 42,
            target: { tag: 'button', id: 'send_but', classes: ['menu_button'], name: 'Send' },
        },
    ];
    const groups = groupSlowInteractions(interactions, [{
        startTime: 130,
        durationMs: 100,
        generationTraceRunId: 'generation-1',
    }]);

    assert.equal(groups.length, 1);
    assert.equal(groups[0].eventCount, 2);
    assert.deepEqual(groups[0].events, ['pointerdown', 'click']);
    assert.equal(groups[0].durationMs, 200);
    assert.equal(groups[0].longTaskCount, 1);
    assert.equal(groups[0].maxLongTaskMs, 100);
    assert.deepEqual(groups[0].generationTraceRunIds, ['generation-1']);
});

test('slow interaction fallback does not merge different targets at the same time', () => {
    const groups = groupSlowInteractions([
        {
            name: 'pointerenter',
            startTime: 100,
            durationMs: 120,
            interactionId: null,
            target: { tag: 'button', id: 'left', classes: [], name: null },
        },
        {
            name: 'pointerenter',
            startTime: 100,
            durationMs: 120,
            interactionId: null,
            target: { tag: 'button', id: 'right', classes: [], name: null },
        },
    ]);

    assert.equal(groups.length, 2);
});

test('slow interaction groups link long animation frames and aggregate script attribution', () => {
    const groups = groupSlowInteractions([{
        name: 'click',
        startTime: 100,
        durationMs: 180,
        inputDelayMs: 20,
        processingMs: 5,
        presentationDelayMs: 155,
        interactionId: 9,
        target: { tag: 'button', id: 'send_but', classes: [], name: 'Send' },
    }], [], [{
        id: 3,
        startTime: 120,
        durationMs: 100,
        blockingDurationMs: 45,
        renderDurationMs: 35,
        forcedStyleAndLayoutDurationMs: 12,
        scripts: [{
            durationMs: 70,
            forcedStyleAndLayoutDurationMs: 12,
            invokerType: 'event-listener',
            invoker: 'click',
            sourceUrl: '/script.js',
            sourceFunctionName: 'onSendClick',
            sourceCharPosition: 42,
        }],
    }]);

    assert.equal(groups.length, 1);
    assert.equal(groups[0].longAnimationFrameCount, 1);
    assert.equal(groups[0].maxLongAnimationFrameMs, 100);
    assert.equal(groups[0].blockingDurationMs, 45);
    assert.equal(groups[0].renderDurationMs, 35);
    assert.equal(groups[0].forcedStyleAndLayoutDurationMs, 12);
    assert.deepEqual(groups[0].longAnimationFrameIds, [3]);
    assert.equal(groups[0].scripts[0].sourceFunctionName, 'onSendClick');
    assert.equal(groups[0].scripts[0].totalDurationMs, 70);
});
