import test from 'node:test';
import assert from 'node:assert/strict';
import { setReduceMotionSetting } from '../src/web/motion.js';
import { opensOnAtlas } from '../src/web/startup.js';
import { bakeTiles } from '../src/web/atlas-cache.js';

test('startup cover fades once, stays until the fade finishes, and respects reduced motion', async () => {
  for (const reduced of [false, true]) {
    setReduceMotionSetting(reduced);
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
    globalThis.document = { getElementById: () => cover };
    // A fresh module each time: a page reveals its cover once.
    const { revealStartup } = await import(`../src/web/startup.js?reduced=${reduced}`);
    const first = revealStartup();
    assert.equal(revealStartup(), first);
    assert.equal(removed, false);
    assert.deepEqual(durations, [reduced ? 0 : 700]);
    finish();
    await first;
    assert.equal(removed, true);
  }
  setReduceMotionSetting(false);
  delete globalThis.document;
});

test('startup opens onto the Atlas for several designs and no file asked for, or browser-only with none', () => {
  const designs = (count) => [...Array.from({ length: count }, () => ({ kind: 'circuit' })), { kind: 'other' }];
  for (const browserOnly of [false, true]) {
    for (const count of [0, 1, 2, 3]) {
      assert.equal(opensOnAtlas({ documents: designs(count), browserOnly }), count > 1 || (browserOnly && count === 0), `${count} designs, browser-only ${browserOnly}`);
      assert.equal(opensOnAtlas({ openPath: '/workspace/requested.json', documents: designs(count), browserOnly }), false, 'a file asked for opens itself');
    }
  }
  // A design waiting for the browser's permission again is not one to choose.
  assert.equal(opensOnAtlas({ documents: [{ kind: 'circuit' }, { kind: 'circuit', locked: true }] }), false);
  assert.equal(opensOnAtlas({ openPath: null, documents: undefined, browserOnly: true }), true);
});

test('the Atlas bakes every tile before it shows, going on past a drawing that fails', async () => {
  const tiles = [{ id: 'small', size: 10 }, { id: 'large', size: 500 }];
  const baked = [];
  const kept = new Map();
  const failed = new Set();
  await bakeTiles(tiles, {
    levels: (tile) => (tile.size > 320 ? ['small', 'large'] : ['small']),
    bake: async (tile, level) => {
      baked.push(`${tile.id}-${level}`);
      if (tile.id === 'small') throw new Error('invalid preview');
      return { tile: tile.id, level };
    },
    keep: (tile, level, bitmap) => kept.set(`${tile.id}-${level}`, bitmap),
    failed: (tile, level) => failed.add(`${tile.id}-${level}`),
    stale: () => false,
  });
  assert.deepEqual(baked, ['small-small', 'large-small', 'large-large']);
  assert.deepEqual([...failed], ['small-small']);
  assert.equal(kept.size, 2);
});

test('a newer opening of the Atlas stops the bake and lets go of what it baked', async () => {
  let opening = 1;
  let closed = 0;
  const kept = [];
  await bakeTiles([{ id: 'a' }, { id: 'b' }], {
    levels: () => ['small'],
    bake: async (tile) => { if (tile.id === 'a') opening = 2; return { close: () => { closed += 1; } }; },
    keep: (tile) => kept.push(tile.id),
    failed: () => assert.fail('nothing fails'),
    stale: () => opening !== 1,
  });
  assert.deepEqual(kept, []);
  assert.equal(closed, 1);
});
