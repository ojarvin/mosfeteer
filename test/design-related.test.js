import test from 'node:test';
import assert from 'node:assert/strict';
import { nameWords, relatedness, relatednessOf, relatednessProfile } from '../src/core/design-related.js';
import { layoutAtlas } from '../src/web/atlas-layout.js';
import { GRID } from '../src/core/grid.js';

const profile = (name, extra = {}) => relatednessProfile({ id: name, name, ...extra });
const parts = (...types) => ({ items: types.map((type, i) => ({ kind: 'part', id: `X${i}`, type })) });

test('a design name splits into the words that say what it is', () => {
  assert.deepEqual(nameWords('ota-folded_cascode'), ['ota', 'folded', 'cascode']);
  assert.deepEqual(nameWords('sarAdc12bit v2 final'), ['sar', 'adc', 'bit']);
  assert.deepEqual(nameWords('OTA5T.json'), ['ota']);
});

test('names, tags, links, folders, parts, and nets each make designs kin', () => {
  const lone = relatedness(profile('bandgap'), profile('comparator'));
  assert.ok(lone < 0.1, `unrelated names (${lone})`);
  assert.ok(relatedness(profile('ota-folded'), profile('ota_telescopic')) >= 0.5);
  assert.ok(relatedness(profile('otafolded'), profile('ota5t')) >= 0.3, 'a shared stem');
  assert.ok(relatedness(profile('a', { tags: ['adc'] }), profile('b', { tags: ['ADC'] })) >= 0.9);
  assert.ok(relatedness(profile('top', { links: ['amp'] }), profile('amp')) >= 0.9);
  assert.ok(relatedness(profile('x', { dir: 'pll' }), profile('y', { dir: 'pll' })) > 0.2);
  const mos = parts('nmos', 'nmos', 'pmos', 'pmos', 'capacitor', 'ground');
  assert.ok(relatedness(profile('one', { index: mos }), profile('two', { index: mos })) > 0.3);
  assert.equal(relatedness(profile('one', { index: parts('resistor') }), profile('two', { index: parts('nmos') })), 0);
});

test('the desk packs designs of one family next to each other', () => {
  const names = ['ota-folded', 'bandgap-core', 'ota-telescopic', 'bandgap-trim', 'ota-5t', 'bandgap-startup'];
  const items = names.map((name) => ({ id: name, name, w: 8 * GRID, h: 6 * GRID }));
  const { tiles } = layoutAtlas(items, { related: relatednessOf(items) });
  const centre = (id) => { const t = tiles.find((tile) => tile.id === id); return { x: t.x + t.w / 2, y: t.y + t.h / 2 }; };
  const d = (a, b) => Math.hypot(centre(a).x - centre(b).x, centre(a).y - centre(b).y);
  const within = (family) => { const f = names.filter((n) => n.startsWith(family)); return Math.max(...f.flatMap((a) => f.map((b) => d(a, b)))); };
  const across = Math.min(...names.filter((n) => n.startsWith('ota')).flatMap((a) => names.filter((n) => n.startsWith('bandgap')).map((b) => d(a, b))));
  // Each family's own spread is no wider than two tiles; kin sit together.
  assert.ok(within('ota') <= 2 * (10 * GRID) + 1, `ota spread ${within('ota')}`);
  assert.ok(within('bandgap') <= 2 * (10 * GRID) + 1, `bandgap spread ${within('bandgap')}`);
  assert.ok(across > 0);
});
