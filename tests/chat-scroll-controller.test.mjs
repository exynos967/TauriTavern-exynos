import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createChatScrollController,
    isChatViewportAtBottom,
} from '../src/scripts/tauri/perf/chat-scroll-controller.js';

function createHarness(viewport = { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 }) {
    const frames = new Map();
    const cancelled = [];
    let nextFrameId = 1;
    let scrolls = 0;
    const controller = createChatScrollController({
        readViewport: () => viewport,
        scrollToBottom: () => { scrolls += 1; },
        requestFrame: callback => {
            const id = nextFrameId++;
            frames.set(id, callback);
            return id;
        },
        cancelFrame: id => {
            cancelled.push(id);
            frames.delete(id);
        },
    });
    return {
        controller,
        viewport,
        cancelled,
        get scrolls() { return scrolls; },
        flushFrames() {
            for (const [id, callback] of [...frames]) {
                frames.delete(id);
                callback();
            }
        },
    };
}

test('viewport bottom detection tolerates only a small rounding gap', () => {
    assert.equal(isChatViewportAtBottom({ scrollHeight: 1000, clientHeight: 400, scrollTop: 598 }), true);
    assert.equal(isChatViewportAtBottom({ scrollHeight: 1000, clientHeight: 400, scrollTop: 590 }), false);
});

test('generation started away from bottom rejects every follow request', () => {
    const harness = createHarness({ scrollHeight: 1000, clientHeight: 400, scrollTop: 200 });
    harness.controller.beginGeneration();

    assert.equal(harness.controller.requestScroll({ waitForFrame: true }), false);
    harness.flushFrames();
    assert.equal(harness.scrolls, 0);
});

test('user scroll away cancels a queued generation scroll', () => {
    const harness = createHarness();
    harness.controller.beginGeneration();
    assert.equal(harness.controller.requestScroll({ waitForFrame: true }), true);

    harness.viewport.scrollTop = 300;
    harness.controller.onViewportChanged();
    harness.flushFrames();

    assert.deepEqual(harness.cancelled, [1]);
    assert.equal(harness.scrolls, 0);
    assert.equal(harness.controller.requestScroll(), false);
});

test('viewport changes read the current controller state', () => {
    let viewportReads = 0;
    const viewport = { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 };
    const controller = createChatScrollController({
        readViewport: () => {
            viewportReads += 1;
            return viewport;
        },
        scrollToBottom: () => {},
        requestFrame: () => 1,
        cancelFrame: () => {},
    });

    controller.onViewportChanged();
    assert.equal(viewportReads, 1);
    assert.equal(controller.shouldFollowOutput(), true);

    viewport.scrollTop = 300;
    controller.onViewportChanged();
    assert.equal(viewportReads, 2);
    assert.equal(controller.shouldFollowOutput(), false);
});

test('nested generation does not reset a cancelled follow session', () => {
    const harness = createHarness();
    harness.controller.beginGeneration();
    harness.viewport.scrollTop = 300;
    harness.controller.onViewportChanged();
    harness.controller.beginGeneration();
    harness.controller.endGeneration();

    assert.equal(harness.controller.shouldFollowOutput(), false);
    assert.equal(harness.controller.requestScroll(), false);
    harness.controller.endGeneration();
    assert.equal(harness.controller.shouldFollowOutput(), false);
    harness.viewport.scrollTop = 600;
    harness.controller.onViewportChanged();
    assert.equal(harness.controller.shouldFollowOutput(), true);
});

test('explicit navigation can scroll while content following is disabled', () => {
    const harness = createHarness({ scrollHeight: 1000, clientHeight: 400, scrollTop: 200 });
    harness.controller.onViewportChanged();

    assert.equal(harness.controller.requestScroll(), false);
    assert.equal(harness.controller.requestScroll({ force: true }), true);
    assert.equal(harness.scrolls, 1);
});
