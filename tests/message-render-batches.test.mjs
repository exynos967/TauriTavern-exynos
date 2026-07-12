import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    getMessageRenderBatches,
    isChatViewportAtBottom,
} from '../src/scripts/tauri/perf/message-render-batches.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('message prepend rendering is split into stable contiguous batches', () => {
    assert.deepEqual(getMessageRenderBatches(12, 5), [
        { start: 0, end: 5 },
        { start: 5, end: 10 },
        { start: 10, end: 12 },
    ]);
    assert.deepEqual(getMessageRenderBatches(0), []);
});

test('chat viewport bottom detection tolerates only a small rounding gap', () => {
    assert.equal(isChatViewportAtBottom({ scrollHeight: 1000, clientHeight: 400, scrollTop: 598 }), true);
    assert.equal(isChatViewportAtBottom({ scrollHeight: 1000, clientHeight: 400, scrollTop: 590 }), false);
});

test('message insertion and generation preserve the send-time viewport intent', async () => {
    const source = await readFile(path.join(REPO_ROOT, 'src/script.js'), 'utf8');

    assert.match(source, /const followStreamingOutput = isChatViewportAtBottom\(chatElement\[0\]\)/);
    assert.match(source, /Generate\(generateType, \{ \.\.\.agentOptions, followStreamingOutput \}\)/);
    assert.match(source, /if \(!followStreamingOutput\) \{\s*cancelPendingChatScroll\(\)/);
    assert.match(source, /new StreamingProcessor\([^;]+followStreamingOutput\)/);
    assert.match(source, /saveReply\(\{[^}]+scroll: followStreamingOutput/s);
    assert.match(source, /addOneMessage\(message, \{ scroll \}\)/);
    assert.doesNotMatch(source, /shouldFollowStreamingOutput/);
    assert.match(source, /scrollLock = true;\s*cancelPendingChatScroll\(\)/);
});
