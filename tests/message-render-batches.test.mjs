import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    getMessageRenderBatches,
    shouldFollowStreamingOutput,
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

test('streaming follows output only when the user has not locked scrolling', () => {
    assert.equal(shouldFollowStreamingOutput(false), true);
    assert.equal(shouldFollowStreamingOutput(true), false);
});

test('message insertion and streaming startup preserve an active scroll lock', async () => {
    const source = await readFile(path.join(REPO_ROOT, 'src/script.js'), 'utf8');
    const generateStart = source.indexOf('async generate()');

    assert.ok(generateStart >= 0);
    assert.match(source, /addOneMessage\(message, \{ scroll: !scrollLock \}\)/);
    assert.match(source, /this\.onStartStreaming\(this\.firstMessageText, followStreamingOutput\)/);
    assert.doesNotMatch(source.slice(generateStart, generateStart + 700), /scrollLock\s*=\s*false/);
});
