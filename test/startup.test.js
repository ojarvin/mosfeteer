import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { functionSource } from './helpers/editor-source.js';

const startup = readFileSync(new URL('../src/web/startup.js', import.meta.url), 'utf8');
const atlas = readFileSync(new URL('../src/web/atlas.js', import.meta.url), 'utf8');

test('startup cover fades once, stays until the fade finishes, and respects reduced motion', async () => {
  for (const reduced of [false, true]) {
    let finish;
    let removed = false;
    const durations = [];
    const cover = {
      animate(_frames, options) {
        durations.push(options.duration);
        return { finished: new Promise((resolve) => { finish = resolve; }) };
      },
      remove() { removed = true; },
    };
    const reveal = vm.runInNewContext(`${startup.replace('export function', 'function')}\nrevealStartup`, {
      document: { getElementById: () => cover },
      window: { matchMedia: () => ({ matches: reduced }) },
    });
    const first = reveal();
    assert.equal(reveal(), first);
    assert.equal(removed, false);
    assert.deepEqual(durations, [reduced ? 0 : 700]);
    finish();
    await first;
    assert.equal(removed, true);
  }
});

test('startup prepares uncached previews before reveal and continues past a failed drawing', async () => {
  const tiles = [{ id: 'small', w: 10, h: 10 }, { id: 'large', w: 500, h: 500 }];
  const state = { generation: 1, tiles, entries: new Map(tiles.map((tile) => [tile.id, tile])), bitmaps: new Map(), failed: new Set() };
  const baked = [];
  let fontsReady;
  const prepare = vm.runInNewContext(`(${functionSource('prepareStartupImages', atlas)})`, {
    state,
    document: { fonts: { ready: new Promise((resolve) => { fontsReady = resolve; }) } },
    window: { devicePixelRatio: 1 },
    paneSize: () => ({ w: 1000 }),
    tileDetail: (px) => px > 320 ? 'large' : 'small',
    bitmapKey: (entry, level) => `${entry.id}-${level}`,
    bake: async (entry, level) => {
      baked.push(`${entry.id}-${level}`);
      if (entry.id === 'small') throw new Error('invalid preview');
      return entry.id;
    },
  });
  const ready = prepare(1, { w: 1000 });
  assert.deepEqual(baked, []);
  fontsReady();
  await ready;
  assert.deepEqual(baked, ['small-small', 'large-small', 'large-large']);
  assert.equal(state.failed.has('small-small'), true);
  assert.equal(state.bitmaps.size, 2);
});
