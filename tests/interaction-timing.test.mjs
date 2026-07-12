import test from 'node:test';
import assert from 'node:assert/strict';

class TestElement {
    constructor() {
        this.tagName = 'BUTTON';
        this.id = 'send_but';
        this.classList = ['menu_button', 'interactable'];
    }

    getAttribute(name) {
        return name === 'aria-label' ? 'Send' : null;
    }
}

globalThis.Element = TestElement;

const { serializeSlowInteraction } = await import('../src/scripts/tauri/perf/interaction-timing.js');

test('slow interaction timing separates input, processing, and presentation delays', () => {
    const result = serializeSlowInteraction({
        name: 'click',
        startTime: 100,
        processingStart: 130,
        processingEnd: 190,
        duration: 160,
        interactionId: 42,
        target: new TestElement(),
    });

    assert.deepEqual(result, {
        name: 'click',
        startTime: 100,
        durationMs: 160,
        inputDelayMs: 30,
        processingMs: 60,
        presentationDelayMs: 70,
        interactionId: 42,
        target: {
            tag: 'button',
            id: 'send_but',
            classes: ['menu_button', 'interactable'],
            name: 'Send',
        },
    });
});

test('fast interactions are omitted', () => {
    assert.equal(serializeSlowInteraction({ duration: 99 }), null);
});
