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
  assert.equal(getSymbol('vcm').type, 'vcm');
  assert.equal(getSymbol('output').type, 'output');
  assert.throws(() => getSymbol('nonsense'), /unknown component type/);
});

test('VCM is a validated upward-escaping common-potential marker', () => {
  const def = getSymbol('vcm');
  assert.deepEqual(def.terminals, [
    { name: 'vcm', x: 0, y: 0, direction: 'up', dir: { x: 0, y: -1 } },
  ]);
  assert.deepEqual(def.bbox, { x: -40, y: 0, w: 80, h: 80 });
});

test('VCM uses a 56-wide, 32-deep open outline with no filled primitive', () => {
  const def = getSymbol('vcm');
  const triangle = def.graphics.find((g) => g.d === 'M -28 24 L 28 24 L 0 56 Z');
  assert.ok(triangle, 'triangle outline geometry is present');
  assert.equal(triangle.kind, 'path');
  assert.equal(triangle.fill, 'none');
  assert.equal(triangle.d, 'M -28 24 L 28 24 L 0 56 Z');
  assert.ok(def.graphics.every((g) => g.kind !== 'polygon' && g.fill !== 'foreground'));
});

test('passive symbols use a centered local origin', () => {
  for (const type of [
    'resistor', 'capacitor', 'inductor', 'diode',
    'switch_open', 'switch_closed',
    'variable_resistor', 'variable_capacitor', 'variable_inductor',
  ]) {
    const def = getSymbol(type);
    assert.deepEqual(def.terminals.map(({ name, x, y }) => ({ name, x, y })), [
      { name: 'a', x: -80, y: 0 },
      { name: 'b', x: 80, y: 0 },
    ], `${type} terminals`);
    assert.deepEqual(def.bbox, { x: -80, y: -40, w: 160, h: 80 }, `${type} bbox`);
  }
  assert.deepEqual(getSymbol('diode').labelOffset, { x: 0, y: 80 });
  assert.deepEqual(getSymbol('switch_open').labelOffset, { x: 0, y: 40 });
});

test('independent source circles use the compact 35-unit body and adjacent labels', () => {
  for (const type of ['current_source', 'voltage_source']) {
    const def = getSymbol(type);
    assert.deepEqual(def.bbox, { x: -40, y: -80, w: 80, h: 160 }, `${type} bbox`);
    assert.equal(def.graphics[0].kind, 'circle');
    assert.equal(def.graphics[0].r, 35, `${type} circle radius`);
    assert.deepEqual(def.labelOffset, { x: -80, y: 0 }, `${type} label center offset`);
    assert.ok(def.graphics.some((g) => g.kind === 'path' && g.d === 'M 0 -35 L 0 -80'));
    assert.ok(def.graphics.some((g) => g.kind === 'path' && g.d === 'M 0 35 L 0 80'));
  }
});
test('current source arrow is smaller than the compact circle body', () => {
  const arrow = getSymbol('current_source').graphics[2];
  assert.deepEqual(arrow.points, [
    { x: 0, y: 24 },
    { x: -16, y: -8 },
    { x: 16, y: -8 },
  ]);
});


test('MOS symbols expose channel geometry and bulk variants', () => {
  for (const type of ['nmos', 'pmos', 'nmosb', 'pmosb']) {
    const def = getSymbol(type);
    const bulk = type.endsWith('b');
    assert.deepEqual(def.terminals.map(({ name, x, y, direction, dir }) => ({ name, x, y, direction, dir })), [
      { name: 'g', x: -120, y: 0, direction: 'gate', dir: { x: -1, y: 0 } },
      { name: 'd', x: 0, y: -80, direction: 'drain', dir: { x: 0, y: -1 } },
      { name: 's', x: 0, y: 80, direction: 'source', dir: { x: 0, y: 1 } },
      ...(bulk ? [{ name: 'b', x: 0, y: 0, direction: 'bulk', dir: { x: 1, y: 0 } }] : []),
    ], `${type} terminals`);
    assert.deepEqual(def.bbox, { x: -120, y: -80, w: 120, h: 160 }, `${type} bbox`);
    assert.deepEqual(def.labelOffset, bulk ? { x: 40, y: -40 } : { x: 40, y: 0 }, `${type} label offset`);
    assert.equal(def.refPrefix, 'M', `${type} refPrefix`);
    assert.equal(def.defaultMirrorY, type.startsWith('pmos') ? true : undefined, `${type} default mirror`);
    const sourceLead = def.graphics.find((g) => g.kind === 'path' && g.d.endsWith('L 0 80'));
    assert.ok(sourceLead, `${type} source lead reaches its terminal`);
    const bulkPath = def.graphics.find((g) => g.kind === 'path' && g.d === 'M -54.65 0 L 0 0');
    assert.equal(Boolean(bulkPath), bulk, `${type} bulk path reaches its terminal`);
  }
});

test('transistor arrows and gate leads are centered and clear of the gate gap', () => {
  for (const type of ['nmos', 'pmos', 'nmosb', 'pmosb']) {
    const graphics = getSymbol(type).graphics;
    assert.equal(graphics[0].d, 'M -120 0 L -76.88 0', `${type} gate lead`);
    const arrow = graphics.findLast((g) => g.kind === 'polygon' && g.points.some((p) => p.y === 27.91));
    assert.ok(arrow, `${type} source arrow`);
    assert.equal(arrow.points[0].y, 27.91, `${type} arrow tip row`);
    assert.equal((arrow.points[1].y + arrow.points[2].y) / 2, 27.91, `${type} arrow base row`);
    assert.equal(arrow.points[0].x, type.startsWith('pmos') ? -54.65 : 0, `${type} arrow polarity`);
  }
});
test('logic bodies use origin-symmetric triangle and curved outlines', () => {
  const inverter = getSymbol('inverter').graphics[1].d;
  const buffer = getSymbol('buffer').graphics[1].d;
  assert.equal(inverter, 'M 36.09 0 L -58.91 -60 L -58.91 60 Z');
  assert.equal(buffer, 'M 36.09 0 L -58.91 60 L -58.91 -60 Z');

  for (const type of ['and_gate', 'nand_gate', 'or_gate', 'nor_gate', 'xor_gate', 'xnor_gate']) {
    const body = getSymbol(type).graphics.find((graphic) => graphic.style === 'emph' && graphic.kind === 'path');
    assert.match(body.d, /Z$/, `${type} body is closed`);
    assert.doesNotMatch(body.d, /-60\.94|59\.69|0\.01|-1\.75/, `${type} body has no old offset`);
  }
});

test('inversion bubbles are centered and clear of gate bodies', () => {
  const nandBubble = getSymbol('nand_gate').graphics.find((graphic) => graphic.kind === 'circle');
  const norBubble = getSymbol('nor_gate').graphics.find((graphic) => graphic.kind === 'circle');
  assert.deepEqual({ cx: nandBubble.cx, cy: nandBubble.cy }, { cx: 75, cy: 0 });
  assert.deepEqual({ cx: norBubble.cx, cy: norBubble.cy }, { cx: 62.47, cy: 0 });
  assert.equal(getSymbol('nand_gate').graphics.at(-1).d, 'M 88.5 0 L 120 0');
  assert.equal(getSymbol('nor_gate').graphics.at(-1).d, 'M 75.97 0 L 120 0');
  assert.equal(getSymbol('xnor_gate').graphics.at(-1).d, 'M 102.87 0 L 160 0');
  assert.ok(nandBubble.cx - nandBubble.r > 60, 'NAND bubble clears the AND front edge');
});

test('ADC and DAC symbols expose single-bit-bus terminals and centered labels', () => {
  const adc = getSymbol('adc');
  const dac = getSymbol('dac');
  assert.deepEqual(adc.terminals.map(({ name, x, y }) => ({ name, x, y })), [
    { name: 'ain', x: -200, y: 0 },
    { name: 'd', x: 200, y: 0 },
  ]);
  assert.deepEqual(dac.terminals.map(({ name, x, y }) => ({ name, x, y })), [
    { name: 'd', x: -200, y: 0 },
    { name: 'aout', x: 200, y: 0 },
  ]);
  for (const [type, text, body, mark] of [
    ['adc', 'ADC', 'M 120 -100 L -40 -100 L -120 0 L -40 100 L 120 100 Z', 'M 154 -8 L 166 8'],
    ['dac', 'DAC', 'M -120 -100 L 40 -100 L 120 0 L 40 100 L -120 100 Z', 'M -166 8 L -154 -8'],
  ]) {
    const def = getSymbol(type);
    assert.deepEqual(def.bbox, { x: -200, y: -120, w: 400, h: 240 });
    assert.equal(def.graphics.at(-3).d, body);
    assert.equal(def.graphics.at(-2).d, mark);
    assert.deepEqual(def.graphics.at(-1), { kind: 'text', x: type === 'adc' ? 20 : -20, y: 0, text, anchor: 'middle', font: 'label', keepUpright: true });
  }
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

test('refdes prefixes by component type', () => {
  const expected = {
    resistor: 'R',
    capacitor: 'C',
    inductor: 'L',
    diode: 'D',
    nmos: 'M',
    pmos: 'M',
    nmosb: 'M',
    pmosb: 'M',
    npn: 'Q',
    pnp: 'Q',
    ground: '',
    supply: '',
    input: 'VI',
    output: 'VO',
    inputoutput: 'VIO',
    adc: 'U',
    dac: 'U',
  };
  for (const [type, prefix] of Object.entries(expected)) {
    assert.equal(getSymbol(type).refPrefix, prefix, `${type} refPrefix`);
  }
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
    input: 'VI',
    output: 'VO',
    inputoutput: 'VIO',
  };
  for (const [type, prefix] of Object.entries(expected)) {
    assert.equal(getSymbol(type).refPrefix, prefix, `${type} refPrefix`);
  }
});
