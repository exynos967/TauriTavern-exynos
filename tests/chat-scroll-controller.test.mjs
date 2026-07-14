import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createChatScrollController,
    isChatViewportAtBottom,
    scrollViewportToBottom,
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

test('bottom scrolling writes a clamped target without reading scroll height', () => {
    let assignedScrollTop = null;
    const viewport = {
        get scrollHeight() {
            throw new Error('scrollHeight must not be read');
        },
        set scrollTop(value) {
            assignedScrollTop = value;
        },
    };

    scrollViewportToBottom(viewport);

    assert.equal(assignedScrollTop, Number.MAX_SAFE_INTEGER);
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

test('precomputed viewport state avoids a duplicate viewport read', () => {
    let viewportReads = 0;
    const controller = createChatScrollController({
        readViewport: () => {
            viewportReads += 1;
            return { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 };
        },
        scrollToBottom: () => {},
        requestFrame: () => 1,
        cancelFrame: () => {},
    });

    controller.onViewportChanged(false);
    assert.equal(viewportReads, 0);
    assert.equal(controller.shouldFollowOutput(), false);

    controller.onViewportChanged();
    assert.equal(viewportReads, 1);
    assert.equal(controller.shouldFollowOutput(), true);
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
