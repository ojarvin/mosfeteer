import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRID, onGrid } from '../src/core/grid.js';
import { defineSymbol, validateSymbol } from '../src/core/components/defineSymbol.js';
import { symbolTypes, symbolTypeNames, getSymbol } from '../src/core/components/index.js';
import { SOLDER_DOT_RADIUS } from '../src/core/components/solder.js';

test('every registered symbol validates clean (grid contract)', () => {
  for (const type of symbolTypeNames) {
    const def = getSymbol(type);
    assert.doesNotThrow(() => validateSymbol(def), `symbol "${type}" should validate`);

    // Annotations (no terminals, e.g. solder dots) may use a dot-sized bbox.
    if (def.terminals.length > 0) {
      for (const k of ['x', 'y', 'w', 'h']) {
        assert.ok(Number.isInteger(def.bbox[k] / GRID), `${type} bbox ${k} on grid (${def.bbox[k]})`);
      }
    }
  }
});

test('getSymbol returns known defs and throws on unknown', () => {
  assert.equal(getSymbol('resistor').type, 'resistor');
  assert.equal(getSymbol('ground').type, 'ground');
  assert.equal(getSymbol('output').type, 'output');
  assert.throws(() => getSymbol('nonsense'), /unknown component type/);
});

test('symbolTypeNames lists all keys of symbolTypes', () => {
  assert.deepEqual(symbolTypeNames.sort(), Object.keys(symbolTypes).sort());
  for (const name of symbolTypeNames) assert.ok(symbolTypes[name], `entry ${name}`);
});

test('defineSymbol freezes the returned definition', () => {
  const def = defineSymbol({
    type: 'test',
    refPrefix: 'T',
    terminals: [{ name: 'a', x: 0, y: 0 }],
    bbox: { x: 0, y: 0, w: 40, h: 40 },
    graphics: [],
    textPos: null,
    refPos: null,
    defaultValue: '',
  });
  assert.ok(Object.isFrozen(def));
  assert.ok(Object.isFrozen(def.terminals));
  assert.ok(Object.isFrozen(def.terminals[0]));
});

test('validateSymbol rejects off-grid terminals', () => {
  assert.throws(
    () =>
      validateSymbol({
        type: 'x',
        terminals: [{ name: 'a', x: 20, y: 0 }],
        bbox: { x: 0, y: 0, w: 40, h: 40 },
      }),
    /NOT on the 40-unit grid/
  );
});

test('validateSymbol rejects off-grid bbox extents', () => {
  assert.throws(
    () =>
      validateSymbol({
        type: 'x',
        terminals: [{ name: 'a', x: 0, y: 0 }],
        bbox: { x: 0, y: 0, w: 30, h: 40 },
      }),
    /bounding box/
  );
});

test('validateSymbol rejects duplicate terminal names', () => {
  assert.throws(
    () =>
      validateSymbol({
        type: 'x',
        terminals: [
          { name: 'a', x: 0, y: 0 },
          { name: 'a', x: 40, y: 0 },
        ],
        bbox: { x: 0, y: 0, w: 40, h: 40 },
      }),
    /unique/
  );
});

test('empty terminal lists are allowed (annotations like solder)', () => {
  const def = validateSymbol({
    type: 'x',
    terminals: [],
    bbox: { x: 0, y: 0, w: 40, h: 40 },
  });
  assert.equal(def, undefined);
});

test('validateSymbol rejects a non-array terminals field', () => {
  assert.throws(
    () =>
      validateSymbol({
        type: 'x',
        terminals: 'nope',
        bbox: { x: 0, y: 0, w: 40, h: 40 },
      }),
    /terminals array/
  );
});

test('solder dot is a validated zero-terminal annotation symbol', () => {
  const def = getSymbol('solder');
  assert.equal(def.type, 'solder');
  assert.equal(def.refPrefix, 'J');
  assert.deepEqual(def.terminals, []);
  // The bbox is exactly the drawn dot (r=SOLDER_DOT_RADIUS), not a whole grid
  // cell — solder is placed on and selected at the junction grid point.
  assert.deepEqual(def.bbox, { x: -12, y: -12, w: 24, h: 24 });
  assert.equal(def.bbox.w, 2 * SOLDER_DOT_RADIUS);
  assert.equal(def.graphics.length, 1);
  assert.equal(def.graphics[0].kind, 'dot');
  assert.doesNotThrow(() => validateSymbol(def));
});

test('refdes prefixes by component type', () => {
  const expected = {
    resistor: 'R',
    capacitor: 'C',
    inductor: 'L',
    diode: 'D',
    nmos: 'M',
    pmos: 'M',
    npn: 'Q',
    pnp: 'Q',
    ground: '',
    supply: '',
    input: 'I',
    output: 'O',
    inputoutput: 'IO',
  };
  for (const [type, prefix] of Object.entries(expected)) {
    assert.equal(getSymbol(type).refPrefix, prefix, `${type} refPrefix`);
  }
});
