import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRID, onGrid } from '../src/core/grid.js';
import { defineSymbol, validateSymbol } from '../src/core/components/defineSymbol.js';
import { symbolTypes, symbolTypeNames, getSymbol } from '../src/core/components/index.js';
import { SOLDER_DOT_RADIUS } from '../src/core/components/solder.js';
import { buildCommands } from '../scripts/build_symbols.mjs';

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
  assert.deepEqual(getSymbol('diode').labelOffset, { x: 0, y: -80 });
  assert.deepEqual(getSymbol('switch_open').labelOffset, { x: 0, y: -80 });
});

test('passive, macro, and logic labels default above their bodies', () => {
  for (const type of ['resistor', 'capacitor', 'inductor', 'diode', 'variable_resistor', 'variable_capacitor', 'variable_inductor']) {
    assert.deepEqual(getSymbol(type).labelOffset, { x: 0, y: -80 }, `${type} label offset`);
  }
  for (const type of ['opamp', 'opamp_diff', 'adc', 'dac']) {
    assert.deepEqual(getSymbol(type).labelOffset, { x: 0, y: -160 }, `${type} label offset`);
  }
  for (const type of ['inverter', 'buffer', 'and2_gate', 'nand2_gate', 'or2_gate', 'nor2_gate', 'xor2_gate', 'xnor2_gate']) {
    assert.equal(getSymbol(type).labelOffset.y, -120, `${type} label offset`);
  }
});

test('symbols generator covers every reference-sheet component and category', () => {
  const commands = buildCommands();
  const adds = commands.filter((command) => command.startsWith('add '));
  const annotations = commands.filter((command) => command.startsWith('annotation add '));
  assert.equal(commands[0], 'clear');
  assert.equal(adds.length, 73);
  assert.equal(annotations.length, 11);
  assert.ok(annotations.every((command) => command.includes('--align right --right-edge -320')));
  assert.ok(adds.filter((command) => command.startsWith('add switch_')).every((command) => !command.includes('--rot')));
  assert.equal(annotations.filter((command) => command.includes(' Sequential ')).length, 1);
  assert.deepEqual(annotations.filter((command) => command.includes(' Sequential ')).map((command) => Number(command.match(/ Sequential 0 (-?\d+)/)?.[1])), [2400]);
  assert.equal(annotations.filter((command) => command.includes(' Logic ')).length, 1);
  assert.deepEqual(adds.slice(0, 7).map((command) => command.split(' ')[1]), [
    'resistor', 'variable_resistor', 'capacitor', 'variable_capacitor',
    'inductor', 'variable_inductor', 'diode',
  ]);
  assert.deepEqual(adds.filter((command) => command.split(' ')[2]?.startsWith('U')).map((command) => command.split(' ')[2]),
    Array.from({ length: 45 }, (_, index) => `U${index + 1}`));
  for (const type of ['vccs', 'tristate_inverter', 'tristate_buffer', 'mux2', 'dff', 'dff_qb', 'dff_rst', 'dff_clkb_rstb_qb', 'latch', 'latch_rst', 'latch_enb_rstb_qb', 'and3_gate', 'xnor3_gate', 'block']) {
    assert.ok(adds.some((command) => command.startsWith(`add ${type} `)), `${type} is present`);
  }
  assert.match(commands.at(-1), /^annotation add category_signal_flow Signal flow /);
});

test('resistor zigzag is centered and symmetric', () => {
  const path = getSymbol('resistor').graphics.find((graphic) => graphic.kind === 'path');
  assert.equal(path.d, 'M -80 0 L -30 0 L -25 20 L -15 -20 L -5 20 L 5 -20 L 15 20 L 25 -20 L 30 0 L 80 0');

  const points = [...path.d.matchAll(/(?:M|L) (-?\d+) (-?\d+)/g)]
    .map(([, x, y]) => ({ x: Number(x), y: Number(y) }));
  assert.deepEqual(points, points.slice().reverse().map(({ x, y }) => ({ x: -x, y: -y || 0 })));

  const diagonals = points.slice(1).map((point, index) => ({
    dx: point.x - points[index].x,
    dy: point.y - points[index].y,
  }));
  assert.deepEqual(diagonals.map(({ dx, dy }) => [Math.abs(dx), Math.abs(dy)]), [
    [50, 0], [5, 20], [10, 40], [10, 40], [10, 40], [10, 40], [10, 40], [5, 20], [50, 0],
  ]);
  assert.ok(diagonals.slice(1, -1).every(({ dx, dy }) => Math.abs(dy / dx) === 4));
  assert.ok(Math.abs(diagonals[1].dy / diagonals[1].dx) === 4);
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
    const bulkPath = def.graphics.find((g) => g.kind === 'path' && g.d === 'M -56.98 0 L 0 0');
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

  for (const type of ['and2_gate', 'nand2_gate', 'or2_gate', 'nor2_gate', 'xor2_gate', 'xnor2_gate']) {
    const body = getSymbol(type).graphics.find((graphic) => graphic.style === 'emph' && graphic.kind === 'path');
    assert.match(body.d, /Z$/, `${type} body is closed`);
    assert.doesNotMatch(body.d, /-60\.94|59\.69|0\.01|-1\.75/, `${type} body has no old offset`);
  }
});

test('tri-state logic gates add a bottom enable pin without changing their body', () => {
  for (const [tri, base, output, width] of [
    ['tristate_inverter', 'inverter', 120, 240],
    ['tristate_buffer', 'buffer', 80, 200],
  ]) {
    const triDef = getSymbol(tri);
    const baseDef = getSymbol(base);
    assert.deepEqual(triDef.terminals, [
      ...baseDef.terminals,
      { name: 'en', x: 0, y: 80, direction: 'input', dir: { x: 0, y: 1 } },
    ], `${tri} terminals`);
    assert.deepEqual(triDef.bbox, { x: -120, y: -80, w: width, h: 160 }, `${tri} bbox`);
    assert.equal(triDef.graphics[1].d, baseDef.graphics[1].d, `${tri} body`);
    assert.ok(triDef.graphics.some((graphic) => graphic.d === 'M 0 22.79 L 0 80'), `${tri} enable lead`);
    assert.equal(triDef.labelOffset.y, -120, `${tri} label offset`);
    assert.equal(triDef.terminals.find(({ name }) => name === 'y').x, output);
  }
});

test('mux2 uses a tapered two-square body with labelled inputs and select', () => {
  const def = getSymbol('mux2');
  assert.deepEqual(def.terminals.map(({ name, x, y }) => ({ name, x, y })), [
    { name: 'a', x: -80, y: -40 },
    { name: 'b', x: -80, y: 40 },
    { name: 'y', x: 80, y: 0 },
    { name: 's', x: 0, y: 160 },
  ]);
  assert.deepEqual(def.bbox, { x: -80, y: -120, w: 160, h: 280 });
  assert.ok(def.graphics.some((graphic) => graphic.d === 'M -40 -120 L 40 -80 L 40 80 L -40 120 Z'));
  assert.deepEqual(def.graphics.filter((graphic) => graphic.kind === 'text').map(({ text, x, y, keepUpright }) => ({ text, x, y, keepUpright })), [
    { text: '0', x: 0, y: -40, keepUpright: true },
    { text: '1', x: 0, y: 40, keepUpright: true },
  ]);
});

test('three-input logic gates preserve their two-input bodies and order pins a, b, c', () => {
  for (const [three, two, middleLead] of [
    ['and3_gate', 'and2_gate', '-76.88'], ['nand3_gate', 'nand2_gate', '-76.88'],
    ['or3_gate', 'or2_gate', '-67.66'], ['nor3_gate', 'nor2_gate', '-67.66'],
    ['xor3_gate', 'xor2_gate', '-67'], ['xnor3_gate', 'xnor2_gate', '-67'],
  ]) {
    const threeDef = getSymbol(three);
    const twoDef = getSymbol(two);
    assert.deepEqual(threeDef.terminals.map(({ name, x, y }) => ({ name, x, y })), [
      { name: 'a', x: -120, y: -40 },
      { name: 'b', x: -120, y: 0 },
      { name: 'c', x: -120, y: 40 },
      { name: 'y', x: twoDef.terminals.at(-1).x, y: 0 },
    ], `${three} terminals`);
    assert.equal(threeDef.graphics.filter((graphic) => graphic.style === 'emph' && graphic.kind === 'path')[0].d,
      twoDef.graphics.find((graphic) => graphic.style === 'emph' && graphic.kind === 'path').d, `${three} body`);
    assert.deepEqual(threeDef.graphics.filter((graphic) => graphic.kind === 'path').slice(0, 3).map((graphic) => graphic.d), [
      'M -120 -40 L -76.88 -40', `M -120 0 L ${middleLead} 0`, 'M -120 40 L -76.88 40',
    ], `${three} input leads`);
  }
});

test('inversion bubbles are centered and clear of gate bodies', () => {
  const nandBubble = getSymbol('nand2_gate').graphics.find((graphic) => graphic.kind === 'circle');
  const norBubble = getSymbol('nor2_gate').graphics.find((graphic) => graphic.kind === 'circle');
  assert.deepEqual({ cx: nandBubble.cx, cy: nandBubble.cy }, { cx: 75, cy: 0 });
  assert.deepEqual({ cx: norBubble.cx, cy: norBubble.cy }, { cx: 62.47, cy: 0 });
  assert.equal(getSymbol('nand2_gate').graphics.at(-1).d, 'M 88.5 0 L 120 0');
  assert.equal(getSymbol('nor2_gate').graphics.at(-1).d, 'M 75.97 0 L 120 0');
  assert.equal(getSymbol('xnor2_gate').graphics.at(-1).d, 'M 102.87 0 L 160 0');
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

test('D flip-flop variants expose optional reset, clock polarity, and outputs', () => {
  const variants = [
    ['dff', ['D', 'CLK', 'Q'], false, false],
    ['dff_qb', ['D', 'CLK', 'Q', 'QB'], false, true],
    ['dff_clkb', ['D', 'CLKB', 'Q'], true, false],
    ['dff_clkb_qb', ['D', 'CLKB', 'Q', 'QB'], true, true],
    ['dff_rst', ['D', 'CLK', 'Q', 'RST'], false, false],
    ['dff_rst_qb', ['D', 'CLK', 'Q', 'QB', 'RST'], false, true],
    ['dff_clkb_rst', ['D', 'CLKB', 'Q', 'RST'], true, false],
    ['dff_clkb_rst_qb', ['D', 'CLKB', 'Q', 'QB', 'RST'], true, true],
    ['dff_rstb', ['D', 'CLK', 'Q', 'RSTB'], false, false],
    ['dff_rstb_qb', ['D', 'CLK', 'Q', 'QB', 'RSTB'], false, true],
    ['dff_clkb_rstb', ['D', 'CLKB', 'Q', 'RSTB'], true, false],
    ['dff_clkb_rstb_qb', ['D', 'CLKB', 'Q', 'QB', 'RSTB'], true, true],
  ];
  for (const [type, names, invertedClock, complementaryOutput] of variants) {
    const def = getSymbol(type);
    assert.deepEqual(def.terminals.map(({ name }) => name), names, `${type} terminal names`);
    assert.deepEqual(def.terminals.find(({ name }) => name === 'D'), { name: 'D', x: -80, y: -40, direction: 'input', dir: { x: -1, y: 0 } });
    assert.deepEqual(def.terminals.find(({ name }) => name === 'Q'), { name: 'Q', x: 80, y: -40, direction: 'output', dir: { x: 1, y: 0 } });
    if (complementaryOutput) assert.deepEqual(def.terminals.find(({ name }) => name === 'QB'), { name: 'QB', x: 80, y: 40, direction: 'output', dir: { x: 1, y: 0 } });
    const hasReset = names.includes('RST') || names.includes('RSTB');
    assert.equal(def.graphics.some((graphic) => graphic.d === 'M 0 80 L 0 120'), hasReset, `${type} reset lead`);
    if (hasReset) assert.deepEqual(def.terminals.at(-1), { name: names.at(-1), x: 0, y: 120, direction: 'input', dir: { x: 0, y: 1 } });
    assert.deepEqual(def.bbox, { x: -80, y: -80, w: 160, h: hasReset ? 200 : 160 });
    assert.deepEqual(def.labelOffset, { x: 0, y: -120 });
    assert.deepEqual(def.graphics.find((graphic) => graphic.kind === 'rect'), {
      kind: 'rect', x: -40, y: -80, w: 80, h: 160, style: 'emph',
    });
    assert.deepEqual(def.graphics.find((graphic) => graphic.kind === 'text'), {
      kind: 'text', x: 0, y: -40, text: 'D', anchor: 'middle', font: 'label', keepUpright: true,
    });
    assert.deepEqual(def.graphics.find((graphic) => graphic.kind === 'path' && graphic.d === 'M -40 24 L -8 40 L -40 56'), {
      kind: 'path', d: 'M -40 24 L -8 40 L -40 56', style: 'symbol',
    });
    assert.equal(def.graphics.filter((graphic) => graphic.kind === 'circle').length, Number(invertedClock) + Number(type.includes('rstb')) + Number(complementaryOutput));
    assert.equal(def.graphics.some((graphic) => graphic.kind === 'path' && graphic.d === 'M 40 40 L 80 40'), complementaryOutput);
  }
  assert.deepEqual(getSymbol('dff_clkb').graphics.find((graphic) => graphic.kind === 'circle'), {
    kind: 'circle', cx: -54, cy: 40, r: 13.5, style: 'emph',
  });
  assert.deepEqual(getSymbol('dff_rstb').graphics.find((graphic) => graphic.kind === 'circle'), {
    kind: 'circle', cx: 0, cy: 94, r: 13.5, style: 'emph',
  });
  assert.deepEqual(getSymbol('dff_qb').graphics.find((graphic) => graphic.kind === 'circle'), {
    kind: 'circle', cx: 54, cy: 40, r: 13.5, style: 'emph',
  });
});

test('latch variants use level-enable names, L text, and no clock marker', () => {
  const variants = [
    ['latch', ['L', 'EN', 'Q'], false, false],
    ['latch_qb', ['L', 'EN', 'Q', 'QB'], false, true],
    ['latch_enb', ['L', 'ENB', 'Q'], true, false],
    ['latch_enb_qb', ['L', 'ENB', 'Q', 'QB'], true, true],
    ['latch_rst', ['L', 'EN', 'Q', 'RST'], false, false],
    ['latch_rst_qb', ['L', 'EN', 'Q', 'QB', 'RST'], false, true],
    ['latch_enb_rst', ['L', 'ENB', 'Q', 'RST'], true, false],
    ['latch_enb_rst_qb', ['L', 'ENB', 'Q', 'QB', 'RST'], true, true],
    ['latch_rstb', ['L', 'EN', 'Q', 'RSTB'], false, false],
    ['latch_rstb_qb', ['L', 'EN', 'Q', 'QB', 'RSTB'], false, true],
    ['latch_enb_rstb', ['L', 'ENB', 'Q', 'RSTB'], true, false],
    ['latch_enb_rstb_qb', ['L', 'ENB', 'Q', 'QB', 'RSTB'], true, true],
  ];
  for (const [type, names, invertedEnable, complementaryOutput] of variants) {
    const def = getSymbol(type);
    assert.deepEqual(def.terminals.map(({ name }) => name), names, `${type} terminal names`);
    assert.deepEqual(def.graphics.find((graphic) => graphic.kind === 'text'), {
      kind: 'text', x: 0, y: -40, text: 'L', anchor: 'middle', font: 'label', keepUpright: true,
    });
    assert.equal(def.graphics.some((graphic) => graphic.d === 'M -40 24 L -8 40 L -40 56'), false);
    const hasReset = names.includes('RST') || names.includes('RSTB');
    assert.equal(def.graphics.some((graphic) => graphic.d === 'M 0 80 L 0 120'), hasReset, `${type} reset lead`);
    assert.deepEqual(def.bbox, { x: -80, y: -80, w: 160, h: hasReset ? 200 : 160 });
    assert.equal(def.graphics.filter((graphic) => graphic.kind === 'circle').length, Number(invertedEnable) + Number(type.includes('rstb')) + Number(complementaryOutput));
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
    mux2: 'U',
    adc: 'U',
    dac: 'U',
    dff: 'U',
    dff_qb: 'U',
    dff_clkb: 'U',
    dff_clkb_qb: 'U',
    dff_rst: 'U',
    dff_rst_qb: 'U',
    dff_clkb_rst: 'U',
    dff_clkb_rst_qb: 'U',
    dff_rstb: 'U',
    dff_rstb_qb: 'U',
    dff_clkb_rstb: 'U',
    dff_clkb_rstb_qb: 'U',
    latch: 'U',
    latch_qb: 'U',
    latch_enb: 'U',
    latch_enb_qb: 'U',
    latch_rst: 'U',
    latch_rst_qb: 'U',
    latch_enb_rst: 'U',
    latch_enb_rst_qb: 'U',
    latch_rstb: 'U',
    latch_rstb_qb: 'U',
    latch_enb_rstb: 'U',
    latch_enb_rstb_qb: 'U',
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
