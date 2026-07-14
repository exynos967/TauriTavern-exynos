import assert from 'node:assert/strict';
import test from 'node:test';

import {
    installChatScrollTrace,
    reportChatScrollSample,
    sanitizeChatScrollStack,
} from '../src/scripts/tauri/perf/chat-scroll-trace.js';

function createElement() {
    let scrollTop = 10;
    const prototype = {
        get scrollTop() {
            return scrollTop;
        },
        set scrollTop(value) {
            scrollTop = Number(value);
        },
        scrollTo(first, second) {
            scrollTop = typeof first === 'object' ? Number(first.top) : Number(second);
            return 'native-result';
        },
    };
    const element = Object.create(prototype);
    Object.assign(element, {
        scrollHeight: 1000,
        clientHeight: 400,
        childElementCount: 12,
    });
    return element;
}

test('chat trace delegates scrollTop writes and scrollTo calls without changing results', () => {
    const samples = [];
    const element = createElement();
    const teardown = installChatScrollTrace(element, {
        report: (kind, detail) => {
            samples.push({ kind, ...detail });
            return true;
        },
        isEnabled: () => true,
        createStack: () => 'Error\n at write (https://example.test/src/script.js?token=secret#hash:12:3)',
        MutationObserverClass: undefined,
    });

    element.scrollTop = 25;
    assert.equal(element.scrollTop, 25);
    assert.equal(element.scrollTo({ top: 50, behavior: 'instant' }), 'native-result');
    assert.equal(element.scrollTop, 50);
    assert.deepEqual(samples.map(sample => [sample.kind, sample.phase]), [
        ['scrollTop-write', 'before'],
        ['scrollTop-write', 'after'],
        ['scrollTo-call', 'before'],
        ['scrollTo-call', 'after'],
    ]);
    assert.deepEqual(samples[0].stack, ['at write (src/script.js:12:3)']);

    teardown();
    element.scrollTop = 75;
    assert.equal(element.scrollTop, 75);
    assert.equal(Object.hasOwn(element, 'scrollTop'), false);
    assert.equal(Object.hasOwn(element, 'scrollTo'), false);
});

test('diagnostic failures never block native chat scrolling', () => {
    const element = createElement();
    installChatScrollTrace(element, {
        report: () => {
            throw new Error('diagnostic failure');
        },
        isEnabled: () => true,
        MutationObserverClass: undefined,
    });

    element.scrollTop = 123;
    assert.equal(element.scrollTop, 123);
    assert.equal(element.scrollTo(0, 321), 'native-result');
    assert.equal(element.scrollTop, 321);
});

test('mutation geometry samples are coalesced and contain no DOM content', () => {
    const samples = [];
    const frames = [];
    let observerCallback;
    class FakeMutationObserver {
        constructor(callback) {
            observerCallback = callback;
        }
        observe() {}
        disconnect() {}
    }
    const element = createElement();
    installChatScrollTrace(element, {
        report: (kind, detail) => samples.push({ kind, ...detail }),
        isEnabled: () => true,
        MutationObserverClass: FakeMutationObserver,
        requestFrame: callback => frames.push(callback) - 1,
        cancelFrame: () => {},
    });

    element.scrollHeight = 1200;
    observerCallback();
    observerCallback();
    assert.equal(frames.length, 1);
    frames[0]();

    assert.equal(samples.length, 1);
    assert.equal(samples[0].kind, 'dom-geometry-change');
    assert.equal(samples[0].geometry.scrollHeight, 1200);
    assert.equal(JSON.stringify(samples[0]).includes('textContent'), false);
});

test('stack sanitizer removes origin, query, hash and bounds frames', () => {
    const stack = ['Error'];
    for (let index = 0; index < 12; index += 1) {
        stack.push(` at fn${index} (https://example.test/src/file.js?secret=${index}#fragment:${index + 1}:2)`);
    }

    const sanitized = sanitizeChatScrollStack(stack.join('\n'), 'https://example.test');
    assert.equal(sanitized.length, 8);
    assert.equal(JSON.stringify(sanitized).includes('secret'), false);
    assert.equal(JSON.stringify(sanitized).includes('fragment'), false);
    assert.equal(JSON.stringify(sanitized).includes('example.test'), false);
});

test('global report sink is optional and isolated from application behavior', () => {
    const previous = globalThis.__TAURITAVERN_PERF_CHAT_SCROLL__;
    delete globalThis.__TAURITAVERN_PERF_CHAT_SCROLL__;
    assert.equal(reportChatScrollSample('scroll-event'), false);

    globalThis.__TAURITAVERN_PERF_CHAT_SCROLL__ = () => {
        throw new Error('sink failure');
    };
    assert.equal(reportChatScrollSample('scroll-event'), false);

    if (previous) {
        globalThis.__TAURITAVERN_PERF_CHAT_SCROLL__ = previous;
    } else {
        delete globalThis.__TAURITAVERN_PERF_CHAT_SCROLL__;
    }
});
