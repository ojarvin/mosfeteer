import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { StrokeWiring, applyStrokePlan } from '../src/core/stroke-wiring.js';

/** The tutorial's 5T OTA, unwired: tail M5, pair M1/M2, loads M3/M4. */
function ota() {
  const circuit = new Circuit();
  for (const line of [
    'add nmos M5 --at 0 320', 'add nmos M1 --at -240 0', 'add nmos M2 --at 240 0 --mirrorX',
    'add pmos M3 --at -240 -320 --mirrorX', 'add pmos M4 --at 240 -320',
  ]) runCommand(circuit, line);
  return circuit;
}

// Tail drain, up through M1, M3, across the top, down through M4, M2, and
// back to the tail drain, a little off each pin.
const LOOP = [[4, 236], [-236, 84], [-244, -80], [-240, -244], [-238, -404], [242, -400], [240, -240], [236, -80], [240, 84], [2, 240]];

function stroke(circuit, ...runs) {
  const s = new StrokeWiring(circuit);
  for (const run of runs) {
    for (const [x, y] of run) s.add({ x, y });
    s.lift();
  }
  return s;
}

const netSets = (circuit) => [...circuit.nets.values()]
  .map((net) => net.terminals.map((t) => `${t.comp}.${t.term}`).sort().join(' '))
  .sort();

test('one loop wires a 5T OTA; passing through a part never joins its pins', () => {
  const circuit = ota();
  const plan = stroke(circuit, LOOP).plan();
  assert.deepEqual(plan.links.filter((l) => !l.ok).map((l) => `${l.from.comp}.${l.from.term}-${l.to.term}:${l.reason}`),
    ['M1.s-d:part', 'M3.d-s:part', 'M4.s-d:part', 'M2.d-s:part']);
  applyStrokePlan(circuit, plan);
  assert.deepEqual(netSets(circuit), ['M1.d M3.d', 'M1.s M2.s M5.d', 'M2.d M4.d', 'M3.s M4.s']);
});

test('returning to a wired net does not short it; a lifted pen then adds the diode', () => {
  const circuit = ota();
  // After the loop, up the middle to M3's drain: a return, not a wire.
  const plan = stroke(circuit, [...LOOP, [0, 0], [0, -240], [-240, -240]], [[-240, -240], [-120, -320], [120, -320]]).plan();
  assert.equal(plan.links.find((l) => l.from.comp === 'M5' && l.to.comp === 'M3').reason, 'return');
  applyStrokePlan(circuit, plan);
  assert.deepEqual(netSets(circuit), ['M1.d M3.d M3.g M4.g', 'M1.s M2.s M5.d', 'M2.d M4.d', 'M3.s M4.s']);
});

test('drain to gate makes a diode only as a run\'s first link', () => {
  const circuit = ota();
  // Through M2 from source to drain, then on to its gate: no diode.
  const plan = stroke(circuit, [[240, 80], [240, -80], [360, 0]]).plan();
  assert.deepEqual(plan.links.map((l) => l.reason), ['part', 'part']);
  assert.deepEqual(plan.wires, []);
});

test('a stroke from a drain to its gate joins their wired nets: a diode added afterwards', () => {
  const circuit = ota();
  applyStrokePlan(circuit, stroke(circuit, LOOP).plan());
  runCommand(circuit, 'connect M3.g M4.g');
  applyStrokePlan(circuit, stroke(circuit, [[-236, -236], [-124, -316]]).plan());
  assert.deepEqual(netSets(circuit), ['M1.d M3.d M3.g M4.g', 'M1.s M2.s M5.d', 'M2.d M4.d', 'M3.s M4.s']);
});

test('a lifted pen links nothing across the lift', () => {
  const circuit = ota();
  applyStrokePlan(circuit, stroke(circuit, [[0, 240], [-240, 80]], [[240, 80], [240, -80]]).plan());
  assert.deepEqual(netSets(circuit), ['M1.s M5.d']);
});

test('past its first link a stroke never shorts two wired nets', () => {
  const circuit = ota();
  runCommand(circuit, 'connect M1.d M3.d');
  runCommand(circuit, 'connect M2.d M4.d');
  const plan = stroke(circuit, [[0, 240], [-240, -80], [240, -80]]).plan();
  assert.deepEqual(plan.links.map((l) => l.reason || 'ok'), ['ok', 'short']);
  applyStrokePlan(circuit, plan);
  assert.deepEqual(netSets(circuit), ['M1.d M3.d M5.d', 'M2.d M4.d']);
});

test('a first link joins two wired nets unless their names differ', () => {
  const wired = () => {
    const circuit = ota();
    runCommand(circuit, 'connect M1.d M3.d');
    runCommand(circuit, 'connect M2.d M4.d');
    return circuit;
  };
  const named = wired();
  named.renameNet(named.netOfTerminal('M1.d').id, 'outn');
  named.renameNet(named.netOfTerminal('M2.d').id, 'outp');
  assert.equal(stroke(named, [[-240, -80], [240, -80]]).plan().links[0].reason, 'short');
  const circuit = wired();
  applyStrokePlan(circuit, stroke(circuit, [[-240, -80], [240, -80]]).plan());
  assert.deepEqual(netSets(circuit), ['M1.d M2.d M3.d M4.d']);
});

test('pins are caught within 1.75 cells, the nearest first', () => {
  const circuit = ota();
  const s = stroke(circuit, [[-45, 195], [-195, 35]]);
  assert.deepEqual(s.visits.map(refOfVisit), ['M5.d', 'M1.s']);
  assert.deepEqual(stroke(circuit, [[-100, 200], [-300, 200]]).visits, []);
});

const refOfVisit = (v) => `${v.comp}.${v.term}`;

test('a stroke joins an unwired pin to an existing net', () => {
  const circuit = ota();
  runCommand(circuit, 'connect M1.d M3.d');
  applyStrokePlan(circuit, stroke(circuit, [[-120, -320], [-240, -240]]).plan());
  assert.deepEqual(netSets(circuit), ['M1.d M3.d M3.g']);
});
