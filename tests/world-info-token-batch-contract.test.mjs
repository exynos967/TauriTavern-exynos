import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('World info batches only exact safe token-count prefixes', async () => {
    const source = await readFile(path.join(REPO_ROOT, 'src/scripts/world-info.js'), 'utf8');

    assert.match(source, /getTokenCountAsync, getTokenCountsAsync/);
    assert.match(source, /batchEntries\.length < 8/);
    assert.match(source, /getTokenCountsAsync\(batchPrefixes\)/);
    assert.match(source, /!entry\.ignoreBudget/);
    assert.match(source, /!entry\.useProbability \|\| entry\.probability === 100/);
    assert.match(source, /!String\(entry\.content \?\? ''\)\.includes\('\{'\)/);
    assert.match(source, /prefetchedTokenCounts\.has\(entry\)[\s\S]*getTokenCountAsync\(newContent\)/);
});

test('Batch token counts preserve individual OpenAI wrapper semantics', async () => {
    const source = await readFile(path.join(REPO_ROOT, 'src/scripts/tokenizers.js'), 'utf8');

    assert.match(source, /export async function getTokenCountsAsync/);
    assert.match(source, /countOpenAIMessageTokensBatchAsync\(messages\)/);
    assert.match(source, /count - 1/);
    assert.match(source, /Promise\.all\(strings\.map\(text => getTokenCountAsync\(text, padding\)\)\)/);
});
