import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { svgString } from '../src/core/render.js';
import { hiddenSupplyBarLabels, supplyBarJoins, supplyBarRow, supplyBars } from '../src/core/supply-bars.js';
import { evaluate } from '../src/core/commands.js';

const run = (circuit, ...lines) => lines.map((line) => runCommand(circuit, line));
const row = () => {
  const circuit = new Circuit();
  run(circuit, 'add supply V1 --at 0 0', 'add supply V2 --at 240 0', 'add supply V3 --at 480 0');
  return circuit;
};

test('joined supplies fill the gap between their slabs, and only between joined ones', () => {
  const circuit = row();
  assert.deepEqual(supplyBarJoins(circuit), []);
  run(circuit, 'supplybar on V1 V2');
  const joins = supplyBarJoins(circuit);
  assert.equal(joins.length, 1);
  assert.deepEqual({ from: joins[0].from, to: joins[0].to }, { from: 'V1', to: 'V2' });
  assert.equal(joins[0].rect.x, 40);
  assert.equal(joins[0].rect.w, 160);
  assert.ok(joins[0].rect.y < -30 && joins[0].rect.y > -44, 'the join sits on the slab band');
  assert.match(svgString(circuit), /class="supply-bar-join"/);
  run(circuit, 'supplybar on V3');
  assert.equal(supplyBarJoins(circuit).length, 2);
  // Drawn as one bar over all three slabs, so no seam shows at a slab edge.
  const bars = supplyBars(circuit);
  assert.equal(bars.length, 1);
  assert.deepEqual(bars[0].refs, ['V1', 'V2', 'V3']);
  assert.equal(bars[0].rect.x, -40);
  assert.equal(bars[0].rect.w, 560);
  assert.equal((svgString(circuit).match(/class="supply-bar-join"/g) || []).length, 1);
  // The bar replaces the slabs it covers rather than doubling their edges.
  assert.equal((svgString(circuit).match(/<polygon/g) || []).length, 0);
  assert.equal((svgString(row()).match(/<polygon/g) || []).length, 3);
  run(circuit, 'supplybar off V2');
  assert.deepEqual(supplyBarJoins(circuit), []);
});

test('a differently named supply breaks the bar instead of shorting through it', () => {
  const circuit = row();
  run(circuit, 'value V2 AVDD', 'supplybar on V1 V2 V3');
  assert.deepEqual(supplyBarJoins(circuit), []);
  // The unnamed V1 and V3 are one rail, but V2 stands between them.
  assert.deepEqual(supplyBarRow(circuit, 'V1'), ['V1', 'V3']);
  // Nothing about connectivity changed.
  assert.equal(circuit.nets.size, 0);
});

test('a bar is not drawn across another part or a crossing wire, or between rows', () => {
  const circuit = row();
  run(circuit, 'supplybar on V1 V2 V3', 'add resistor R1 --at 360 -40 --rot 90');
  assert.deepEqual(supplyBarJoins(circuit).map((join) => join.from), ['V1']);

  const wired = row();
  run(wired, 'supplybar on V1 V2', 'add resistor R1 --at 120 -240 --rot 90', 'add resistor R2 --at 120 240 --rot 90');
  assert.equal(supplyBarJoins(wired).length, 1);
  // A wire running straight down between the two supplies crosses the bar.
  run(wired, 'connect R1.b R2.a');
  const path = [...wired.nets.values()][0].paths()[0];
  assert.ok(path.every((p) => p.x === 120), 'the wire runs through the gap');
  assert.deepEqual(supplyBarJoins(wired), []);

  const offset = new Circuit();
  run(offset, 'add supply V1 --at 0 0', 'add supply V2 --at 240 40', 'supplybar on V1 V2');
  assert.deepEqual(supplyBarJoins(offset), []);
});

test('the join survives saving and is refused for anything but a supply', () => {
  const circuit = row();
  run(circuit, 'supplybar on V1 V2', 'add ground G1 --at 0 400');
  const saved = circuit.toJSON();
  assert.equal(saved.components.find((c) => c.refdes === 'V1').joinBar, true);
  assert.equal('joinBar' in saved.components.find((c) => c.refdes === 'V3'), false);
  assert.equal(supplyBarJoins(Circuit.fromJSON(saved)).length, 1);
  const before = JSON.stringify(circuit.toJSON());
  assert.throws(() => runCommand(circuit, 'supplybar on V3 G1'), /not a supply/);
  assert.throws(() => runCommand(circuit, 'supplybar maybe V3'), /usage/);
  assert.equal(JSON.stringify(circuit.toJSON()), before, 'a rejected command changes nothing');
});

test('naming a bar names every supply on it, and the bar shows one label', () => {
  const circuit = row();
  run(circuit, 'supplybar on V1 V2 V3', 'supplybar name AVDD V1 V2 V3');
  // Every supply carries the name itself, so the rail never depends on the
  // drawing, and the bar stays joined.
  for (const ref of ['V1', 'V2', 'V3']) assert.equal(circuit.labelOf(ref).text, 'AVDD');
  assert.equal(supplyBars(circuit).length, 1);
  const hidden = hiddenSupplyBarLabels(circuit);
  assert.deepEqual([...hidden].sort(), [circuit.labelOf('V2').id, circuit.labelOf('V3').id].sort());
  assert.equal((svgString(circuit).match(/>AVDD</g) || []).length, 1);
  // Hidden labels are not drawn, so Design Check does not measure them.
  assert.equal(evaluate(circuit).labelOverlaps.length, 0);
  // Splitting the bar shows every supply's own label again.
  run(circuit, 'supplybar off V2');
  assert.equal(hiddenSupplyBarLabels(circuit).size, 0);
  assert.equal((svgString(circuit).match(/>AVDD</g) || []).length, 3);
  // Clearing the name returns the supplies to the global rail.
  run(circuit, 'supplybar on V2', 'supplybar name - V1 V2 V3');
  assert.equal(['V1', 'V2', 'V3'].some((ref) => circuit.labelOf(ref)), false);
  assert.equal(supplyBars(circuit).length, 1);
  assert.throws(() => runCommand(circuit, 'supplybar name X V1 NOPE'), /unknown component/);
  assert.equal(circuit.labelOf('V1'), null, 'a rejected name changes nothing');
});

test('joining a mixed selection joins each rail with its own neighbours', () => {
  const circuit = new Circuit();
  run(circuit,
    'add supply A1 --at 0 0', 'add supply A2 --at 240 0', 'add supply B1 --at 480 0', 'add supply B2 --at 720 0',
    'add supply C1 --at 0 400', 'add supply C2 --at 240 400',
    'supplybar name VDD2 B1 B2 C1 C2',
    'supplybar on A1 A2 B1 B2 C1 C2');
  assert.deepEqual(supplyBars(circuit).map((bar) => bar.refs), [['A1', 'A2'], ['B1', 'B2'], ['C1', 'C2']]);
  // The row from one VDD2 supply is its own rail's supplies on that line.
  assert.deepEqual(supplyBarRow(circuit, 'B2'), ['B1', 'B2']);
});
