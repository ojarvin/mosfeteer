import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { beamShape, netBeams } from '../src/core/net-beams.js';

/** Three wires named OUT, apart: R1–R2 at y 0, R3–R4 at y 800, R5–R6 at y 1600. */
function threeOuts() {
  const circuit = new Circuit();
  for (const line of [
    'add resistor R1 --at 0 0', 'add resistor R2 --at 400 0', 'connect R1.b R2.a --name OUT',
    'add resistor R3 --at 0 800', 'add resistor R4 --at 400 800', 'connect R3.b R4.a --name OUT',
    'add resistor R5 --at 0 1600', 'add resistor R6 --at 400 1600', 'connect R5.b R6.a --name OUT',
  ]) runCommand(circuit, line);
  return circuit;
}

test('a beam goes from the pointer to each other net of the name, landing on its wire', () => {
  const circuit = threeOuts();
  const [a, b, c] = ['R1', 'R3', 'R5'].map((comp) => circuit.netOfTerminal({ comp, term: 'b' }));
  assert.equal(new Set([a.id, b.id, c.id]).size, 3);
  const from = { x: 200, y: 0 };
  const beams = netBeams(circuit, [a.id, b.id, c.id], a.id, from);
  // None to the net under the pointer; the nearest first.
  assert.deepEqual(beams.map((beam) => beam.netId), [b.id, c.id]);
  assert.deepEqual(beams[0].to, { x: 200, y: 800 });
  assert.deepEqual(beams[1].to, { x: 200, y: 1600 });
});

test('a net with a ground on it is reached at the ground\'s terminal', () => {
  const circuit = new Circuit();
  for (const line of [
    'add resistor R1 --at 0 0 --rot 90', 'add ground G1 --at 0 400', 'connect R1.b G1.gnd',
    'add resistor R2 --at 800 0 --rot 90', 'add ground G2 --at 800 400', 'connect R2.b G2.gnd',
  ]) runCommand(circuit, line);
  const [a, b] = ['G1', 'G2'].map((comp) => circuit.netOfTerminal({ comp, term: 'gnd' }));
  const from = circuit.components.get('G1').terminalWorld('gnd');
  const [beam] = netBeams(circuit, [a.id, b.id], a.id, from);
  assert.deepEqual(beam.to, circuit.components.get('G2').terminalWorld('gnd'));
});

test('a net without wires is reached at its nearest terminal', () => {
  const circuit = threeOuts();
  const b = circuit.netOfTerminal({ comp: 'R3', term: 'b' });
  const net = { paths: () => [], terminalWorlds: () => [{ x: 120, y: 800 }, { x: 280, y: 800 }] };
  const fake = { nets: new Map([[b.id, net]]) };
  assert.deepEqual(netBeams(fake, [b.id], 'other', { x: 300, y: 0 })[0].to, { x: 280, y: 800 });
});

test('a beam arches over the top, either way and straight up, the same at both ends', () => {
  const points = (d) => [...d.matchAll(/[ML] (-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({ x: +m[1], y: +m[2] }));
  for (const [from, to] of [[{ x: 0, y: 0 }, { x: 1000, y: 0 }], [{ x: 1000, y: 0 }, { x: 0, y: 400 }], [{ x: 0, y: 800 }, { x: 0, y: 0 }]]) {
    const shape = beamShape(from, to, { narrow: 2, wide: 20, steps: 8 });
    const core = points(shape.core);
    assert.deepEqual(core[0], from);
    assert.deepEqual(core.at(-1), to);
    assert.ok(core.slice(1, -1).every((p) => p.y < Math.max(from.y, to.y)));
    assert.ok(Math.min(...core.map((p) => p.y)) < Math.min(from.y, to.y));
    // Never doubling back: it keeps going one way across.
    if (from.x === to.x) assert.ok(new Set(core.slice(1, -1).map((p) => Math.sign(p.x - from.x))).size === 1);
    const outline = points(shape.outline);
    const width = (i) => Math.hypot(outline[i].x - outline[outline.length - 1 - i].x, outline[i].y - outline[outline.length - 1 - i].y);
    assert.ok(Math.abs(width(0) - 2) < 0.2 && Math.abs(width(8) - 2) < 0.2);
    assert.ok(Math.abs(width(4) - 20) < 0.2);
  }
  // One too short to draw is left out.
  assert.equal(beamShape({ x: 0, y: 0 }, { x: 10, y: 0 }, { narrow: 2, wide: 20 }), null);
});
