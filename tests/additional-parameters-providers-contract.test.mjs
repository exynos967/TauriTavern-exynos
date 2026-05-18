import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readProjectFile(relativePath) {
    return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

const supportedProviderValues = [
    'openai',
    'openrouter',
    'custom',
    'claude',
    'makersuite',
    'vertexai',
    'deepseek',
    'cohere',
    'groq',
    'moonshot',
    'nanogpt',
    'chutes',
    'siliconflow',
    'zai',
];

const supportedProviderConstants = [
    'OPENAI',
    'OPENROUTER',
    'CUSTOM',
    'CLAUDE',
    'MAKERSUITE',
    'VERTEXAI',
    'DEEPSEEK',
    'COHERE',
    'GROQ',
    'MOONSHOT',
    'NANOGPT',
    'CHUTES',
    'SILICONFLOW',
    'ZAI',
];

test('additional parameters button is visible for all supported native providers', async () => {
    const indexHtml = await readProjectFile('src/index.html');
    const buttonMatch = indexHtml.match(/<div[^>]+id="customize_additional_parameters"[^>]*>/);
    assert.ok(buttonMatch, 'additional parameters button should exist');

    const sourceMatch = buttonMatch[0].match(/data-source="([^"]+)"/);
    assert.ok(sourceMatch, 'button should declare provider data-source values');

    const sources = new Set(sourceMatch[1].split(',').map(value => value.trim()).filter(Boolean));
    for (const provider of supportedProviderValues) {
        assert.ok(sources.has(provider), `missing additional parameters button for ${provider}`);
    }
});

test('additional parameters are attached to request payloads and status headers for supported providers', async () => {
    const openaiSource = await readProjectFile('src/scripts/openai.js');

    for (const provider of supportedProviderConstants) {
        assert.match(
            openaiSource,
            new RegExp(`additionalParameterSources[\\s\\S]*chat_completion_sources\\.${provider}`),
            `missing ${provider} in additionalParameterSources`,
        );
    }

    assert.match(openaiSource, /additionalParameterSources\.includes\(settings\.chat_completion_source\)[\s\S]*generate_data\.custom_include_body/);
    assert.match(openaiSource, /additionalParameterSources\.includes\(settings\.chat_completion_source\)[\s\S]*generate_data\.custom_exclude_body/);
    assert.match(openaiSource, /additionalParameterSources\.includes\(settings\.chat_completion_source\)[\s\S]*generate_data\.custom_include_headers/);
    assert.match(openaiSource, /additionalParameterSources\.includes\(oai_settings\.chat_completion_source\)[\s\S]*data\.custom_include_headers/);
});
