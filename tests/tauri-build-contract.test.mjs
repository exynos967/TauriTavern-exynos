import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Tauri builds generate ignored frontend bundles before packaging', async () => {
    const configPath = path.join(
        REPO_ROOT,
        'src-tauri/crates/tauritavern/tauri.conf.json',
    );
    const packagePath = path.join(REPO_ROOT, 'package.json');
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));

    assert.deepEqual(config.build.beforeBuildCommand, {
        script: 'pnpm run web:build',
        cwd: '../../..',
    });
    assert.equal(packageJson.scripts['web:build'], 'rspack build --config rspack.config.js');
});

test('Android buildSrc compiles only the current application plugin sources', async () => {
    const buildSrcRoot = path.join(
        REPO_ROOT,
        'src-tauri/crates/tauritavern/gen/android/buildSrc',
    );
    const buildScript = await readFile(path.join(buildSrcRoot, 'build.gradle.kts'), 'utf8');
    const buildTask = await readFile(
        path.join(buildSrcRoot, 'src/main/java/com/tauritavern/client/kotlin/BuildTask.kt'),
        'utf8',
    );

    assert.match(buildScript, /kotlin\.setSrcDirs\(listOf\("src\/main\/java\/com\/tauritavern\/client\/kotlin"\)\)/);
    assert.match(buildTask, /val executable = "pnpm"/);
});
