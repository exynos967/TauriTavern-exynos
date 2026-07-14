import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('theme application skips DOM and action work for unchanged fields', async () => {
    const source = await readFile(path.join(REPO_ROOT, 'src/scripts/power-user.js'), 'utf8');
    const applyTheme = source.match(/function applyTheme\(name\) \{[\s\S]*?\n}\n\nasync function applyMovingUIPreset/)?.[0] ?? '';

    const unchangedGuard = applyTheme.indexOf('if (Object.is(oldValue, newValue))');
    const stateAssignment = applyTheme.indexOf('power_user[key] = newValue;');
    const selectorUpdate = applyTheme.indexOf("if (selector) $(selector).attr('color', newValue);");
    const colorUpdate = applyTheme.indexOf('if (type) applyThemeColor(type);');
    const actionCall = applyTheme.indexOf('if (action) action(oldValue, newValue);');

    assert.ok(unchangedGuard >= 0);
    assert.ok(unchangedGuard < stateAssignment);
    assert.ok(unchangedGuard < selectorUpdate);
    assert.ok(unchangedGuard < colorUpdate);
    assert.ok(unchangedGuard < actionCall);
});

test('startup still force-applies complete power-user visual state', async () => {
    const source = await readFile(path.join(REPO_ROOT, 'src/scripts/power-user.js'), 'utf8');
    const startupApply = source.match(/export function applyPowerUserSettings\(\) \{[\s\S]*?\n}/)?.[0] ?? '';

    assert.match(startupApply, /applyThemeColor\(\);/);
    assert.match(startupApply, /applyFontScale\('forced'\);/);
    assert.match(startupApply, /applyChatWidth\('forced'\);/);
    assert.match(startupApply, /applyCustomCSS\(\);/);
});
