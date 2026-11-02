import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { smartRoute } from '../src/core/router.js';
import { tidySelection } from '../src/core/tidy.js';

/** A pair's sources on one row, the tail drain four cells below, centred. */
function pair() {
  const circuit = new Circuit();
  for (const line of ['add nmos M2 --at 0 -80', 'add nmos M3 --at 480 -80 --mirrorX', 'add nmos M1 --at 240 240']) runCommand(circuit, line);
  return circuit;
}

const pin = (circuit, ref) => {
  const [comp, term] = ref.split('.');
  return circuit.components.get(comp).terminalWorld(term);
};

/** The drawing as a sorted list of its grid edges, however it is split into branches. */
function drawing(circuit, ref) {
  const edges = new Set();
  for (const path of circuit.netOfTerminal(ref).paths()) {
    for (let i = 1; i < path.length; i++) {
      const [a, b] = [path[i - 1], path[i]];
      const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / 40;
      for (let k = 0; k < n; k++) {
        const p = [a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n];
        const q = [a.x + ((b.x - a.x) * (k + 1)) / n, a.y + ((b.y - a.y) * (k + 1)) / n];
        edges.add([p, q].map(String).sort().join('|'));
      }
    }
  }
  return [...edges].sort();
}

/** A click on one pin and then the other, as the editor commits it. */
function click(circuit, from, to) {
  const a = pin(circuit, from);
  const b = pin(circuit, to);
  const nets = new Set([circuit.netOfTerminal(from)?.id, circuit.netOfTerminal(to)?.id].filter(Boolean));
  const leg = smartRoute(a, b, { ...circuit._netEnv(nets), allowDiagonal: false, preferMidpoint: true });
  circuit.wireTo(from, b, leg.slice(1, -1), { routeStyle: 'orthogonal', allowDiagonal: false, freshJoin: true });
}

function tee() {
  const circuit = pair();
  runCommand(circuit, 'connect M2.s M3.s M1.d');
  return circuit;
}

test('a tail node is laid out as a tee with its bar halfway between the pair and the tail', () => {
  const circuit = tee();
  const net = circuit.netOfTerminal('M1.d');
  assert.deepEqual(net.junctions, [{ x: 240, y: 80 }]);
  assert.ok(net.paths().some((path) => JSON.stringify(path) === JSON.stringify([{ x: 240, y: 160 }, { x: 240, y: 80 }])));
  assert.ok(net.paths().some((path) => path.some((p) => p.x === 0 && p.y === 80)));
});

test('clicks on the tail\'s pins in any order draw the same tee', () => {
  const want = drawing(tee(), 'M1.d');
  for (const order of [
    [['M2.s', 'M3.s'], ['M3.s', 'M1.d']],
    [['M2.s', 'M3.s'], ['M1.d', 'M3.s']],
    [['M2.s', 'M1.d'], ['M1.d', 'M3.s']],
    [['M1.d', 'M2.s'], ['M1.d', 'M3.s']],
    [['M2.s', 'M1.d'], ['M3.s', 'M1.d']],
  ]) {
    const circuit = pair();
    for (const [from, to] of order) click(circuit, from, to);
    assert.deepEqual(drawing(circuit, 'M1.d'), want, order.map((pair) => pair.join('>')).join(', '));
  }
});

test('a pin joining a hand-shaped net, or a net by a scripted wire, keeps the drawing', () => {
  // The pair's bar dragged two cells down: no longer the router's own.
  const shaped = pair();
  shaped.wireTo('M2.s', pin(shaped, 'M3.s'), [{ x: 0, y: 120 }, { x: 480, y: 120 }], { freshJoin: true });
  const before = drawing(shaped, 'M2.s');
  click(shaped, 'M3.s', 'M1.d');
  assert.ok(before.every((edge) => drawing(shaped, 'M1.d').includes(edge)));
  // Without freshJoin a wire is appended, as before.
  const scripted = pair();
  scripted.wireTo('M2.s', pin(scripted, 'M3.s'));
  const bar = drawing(scripted, 'M2.s');
  scripted.wireTo('M3.s', pin(scripted, 'M1.d'));
  assert.ok(bar.every((edge) => drawing(scripted, 'M1.d').includes(edge)));
});

test('Tidy lays a tail node hung off one source out as the centred tee', () => {
  const circuit = pair();
  // The pair's bar under its sources, the tail wired on from M3's corner.
  circuit.wireTo('M2.s', pin(circuit, 'M3.s'));
  circuit.wireTo('M3.s', pin(circuit, 'M1.d'), [{ x: 480, y: 80 }, { x: 240, y: 80 }]);
  const net = circuit.netOfTerminal('M1.d');
  assert.notDeepEqual(drawing(circuit, 'M1.d'), drawing(tee(), 'M1.d'));
  tidySelection(circuit, { netIds: [net.id] });
  assert.deepEqual(net.junctions, [{ x: 240, y: 80 }]);
  assert.deepEqual(drawing(circuit, 'M1.d'), drawing(tee(), 'M1.d'));
});
