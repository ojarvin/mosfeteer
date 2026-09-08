import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const packager = process.env.ELECTRON_PACKAGER || join(ROOT, 'node_modules', '.bin', 'electron-packager');
const packageDir = join(ROOT, 'dist', `SchematicSpawner-${process.platform}-${process.arch}`);
const packagedApp = process.platform === 'darwin'
  ? join(packageDir, 'SchematicSpawner.app', 'Contents', 'MacOS', 'SchematicSpawner')
  : process.platform === 'win32'
    ? join(packageDir, 'SchematicSpawner.exe')
    : join(packageDir, 'SchematicSpawner');

test('packaged desktop app launches its entry point', {
  skip: process.platform === 'win32' || !existsSync(packager), timeout: 30_000,
}, async (t) => {
  const packaging = spawn(packager, [
    ROOT, 'SchematicSpawner', '--out=dist', '--overwrite', '--prune=true',
    "--ignore=(^|/)(test|docs|guidelines|data)(/|$)",
  ], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let packagingOutput = '';
  packaging.stdout.on('data', (chunk) => { packagingOutput += chunk; });
  packaging.stderr.on('data', (chunk) => { packagingOutput += chunk; });
  const [packagingCode] = await once(packaging, 'exit');
  assert.equal(packagingCode, 0, packagingOutput);
  assert.ok(existsSync(packagedApp), `packaged executable is missing: ${packagedApp}`);

  const profile = await mkdtemp(join(tmpdir(), 'schematic-spawner-electron-'));
  const child = spawn(packagedApp, [
    '--headless', '--no-sandbox', '--disable-gpu', `--user-data-dir=${profile}`,
  ], {
    cwd: ROOT,
    env: { ...process.env, SCHEMATIC_SPAWNER_SMOKE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await once(child, 'exit').catch(() => {});
    }
    await rm(profile, { recursive: true, force: true });
  });

  let output = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`desktop launch timed out: ${output}`)), 15_000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes('SCHEMATIC_SPAWNER_READY')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => {
      if (!output.includes('SCHEMATIC_SPAWNER_READY')) {
        clearTimeout(timer);
        reject(new Error(`desktop exited (${code ?? signal}): ${output}`));
      }
    });
  });
  assert.match(output, /SCHEMATIC_SPAWNER_READY/);
});
