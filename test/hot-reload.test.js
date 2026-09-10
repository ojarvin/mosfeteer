import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { startDevHotReload } from '../src/desktop/hot-reload.js';

test('development hot reload debounces source changes and can stop', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'schematic-hot-reload-'));
  const nested = join(dir, 'nested');
  await mkdir(nested);
  const calls = [];
  const stop = startDevHotReload({ directories: [dir], delay: 15, reload: () => calls.push(true) });
  try {
    await writeFile(join(nested, 'source.js'), 'changed');
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(calls.length, 1);
    await rm(nested, { recursive: true });
    await mkdir(nested);
    await new Promise((resolve) => setTimeout(resolve, 60));
    const reloadsAfterRecreate = calls.length;
    await writeFile(join(nested, 'source.js'), 'changed again');
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(calls.length, reloadsAfterRecreate + 1);
    const reloadsBeforeStop = calls.length;
    stop();
    await writeFile(join(dir, 'source.js'), 'changed again');
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(calls.length, reloadsBeforeStop);
  } finally {
    stop();
    await rm(dir, { recursive: true, force: true });
  }
});
