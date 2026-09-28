import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { evaluate, runCommand } from '../src/core/commands.js';
import { issueFix, placeLabelClear, snapComponentToGrid, tidySelection } from '../src/core/tidy.js';

const run = (circuit, ...lines) => lines.forEach((line) => runCommand(circuit, line));
const kinds = (circuit) => evaluate(circuit).issues.map((issue) => issue.kind).filter((kind) => kind !== 'unconnected-terminal');
const fixAll = (circuit) => evaluate(circuit).issues.map((issue) => issueFix(circuit, issue)).filter(Boolean).map((fix) => fix.apply(circuit));

// R1 and R2 wired, with C1 then moved onto their wire.
function wireThroughBody() {
  const circuit = new Circuit();
  run(circuit, 'add resistor R1 --at 0 0', 'add resistor R2 --at 480 0', 'connect R1.b R2.a', 'add capacitor C1 --at 240 400', 'move C1 240 0');
  return circuit;
}

test('a wire through a body is rerouted clear of it', () => {
  const circuit = wireThroughBody();
  assert.deepEqual(kinds(circuit), ['wire-through-body']);
  const [issue] = evaluate(circuit).issues.filter((i) => i.kind === 'wire-through-body');
  assert.equal(issueFix(circuit, issue).label, 'Reroute');
  assert.equal(issueFix(circuit, issue).apply(circuit), true);
  assert.deepEqual(kinds(circuit), []);
  assert.equal(circuit.netOfTerminal({ comp: 'R1', term: 'b' }), circuit.netOfTerminal({ comp: 'R2', term: 'a' }));
});

test('a part\'s label on a neighbour goes back beside its own part', () => {
  const circuit = new Circuit();
  run(circuit, 'add nmos M1 --at 0 0', 'add nmos M2 --at 240 0');
  circuit.labelOf('M1').moveTo(200, 0);
  assert.deepEqual(kinds(circuit), ['label-component-overlap']);
  fixAll(circuit);
  assert.deepEqual(kinds(circuit), []);
  assert.deepEqual(circuit.labelOf('M1').offset, { x: 40, y: 0 });
  // A clear label stays where it is.
  assert.equal(placeLabelClear(circuit, circuit.labelOf('M2')), false);
});

test('a net label moves along its own wire', () => {
  const circuit = new Circuit();
  run(circuit, 'add resistor R1 --at 0 0', 'add resistor R2 --at 640 0', 'connect R1.b R2.a --name OUT');
  const netId = circuit.netOfTerminal({ comp: 'R1', term: 'b' }).id;
  run(circuit, `netlabel add ${netId} L1 OUT 160 0`,
    'add capacitor C1 --at 160 -80 --rot 90');
  const label = circuit.labels.get('L1');
  assert.ok(kinds(circuit).includes('label-component-overlap'));
  assert.equal(placeLabelClear(circuit, label), true);
  assert.equal(label.anchorWorld().y, 0);
  assert.equal(label.netId, circuit.netOfTerminal({ comp: 'R1', term: 'b' }).id);
  assert.ok(!kinds(circuit).includes('label-component-overlap'));
});

test('an off-grid part snaps back, and decisions are never guessed', () => {
  const circuit = new Circuit();
  run(circuit, 'add resistor R1 --at 0 0', 'add resistor R2 --at 400 0');
  circuit.components.get('R2').transform.x = 413;
  assert.equal(snapComponentToGrid(circuit, 'R2'), true);
  assert.equal(circuit.components.get('R2').transform.x, 400);
  run(circuit, 'move R2 40 0');
  const overlap = evaluate(circuit).issues.find((issue) => issue.kind === 'component-overlap');
  assert.ok(overlap);
  assert.equal(issueFix(circuit, overlap), null);
  const dangling = evaluate(circuit).issues.find((issue) => issue.kind === 'unconnected-terminal');
  assert.equal(issueFix(circuit, dangling), null);
});

test('tidy re-lays a selection\'s nets and clears its labels', () => {
  const circuit = wireThroughBody();
  circuit.labelOf('R1').moveTo(240, 0);
  const result = tidySelection(circuit, { refs: ['R1', 'R2'] });
  assert.deepEqual(result.rerouted.length, 1);
  assert.deepEqual(result.moved.length, 1);
  assert.deepEqual(kinds(circuit), []);
});

test('the tidy and fix commands', () => {
  const circuit = wireThroughBody();
  assert.match(runCommand(circuit, 'fix').text, /fixed 1/);
  assert.deepEqual(kinds(circuit), []);
  const again = wireThroughBody();
  assert.equal(runCommand(again, 'tidy R1').mutated, true);
  assert.deepEqual(kinds(again), []);
  assert.throws(() => runCommand(again, 'tidy'), /usage: tidy/);
});

test('tidy keeps authored diagonal wire and re-lays only the orthogonal branches', () => {
  const circuit = new Circuit();
  run(circuit, 'add resistor R1 --at 0 0', 'add resistor R2 --at 800 400', 'add resistor R3 --at 800 800');
  const diagonal = [{ x: 80, y: 0 }, { x: 400, y: 320 }];
  const wiggle = [{ x: 400, y: 320 }, { x: 400, y: 400 }, { x: 560, y: 400 }, { x: 560, y: 480 }, { x: 640, y: 480 }, { x: 640, y: 400 }, { x: 720, y: 400 }];
  const net = circuit.createWireNet({ allowDiagonal: true, branches: [diagonal, wiggle, [{ x: 400, y: 320 }, { x: 400, y: 800 }, { x: 720, y: 800 }]] });
  net.terminals.push({ comp: 'R1', term: 'b' }, { comp: 'R2', term: 'a' }, { comp: 'R3', term: 'a' });
  const { rerouted } = tidySelection(circuit, { netIds: [net.id] });
  assert.deepEqual(rerouted, [net.id]);
  const paths = net.paths();
  assert.ok(paths.some((path) => JSON.stringify(path) === JSON.stringify(diagonal)), 'the diagonal branch is untouched');
  const toR2 = paths.find((path) => path.some((p) => p.x === 720 && p.y === 400));
  assert.ok(toR2.length < wiggle.length, 'the wiggle is re-laid');
  // An accidental diagonal in a net that does not allow them is still re-laid.
  const plain = new Circuit();
  run(plain, 'add resistor R1 --at 0 0', 'add resistor R2 --at 800 400');
  const straight = plain.createWireNet({ branches: [[{ x: 80, y: 0 }, { x: 400, y: 320 }, { x: 720, y: 400 }]] });
  straight.terminals.push({ comp: 'R1', term: 'b' }, { comp: 'R2', term: 'a' });
  tidySelection(plain, { netIds: [straight.id] });
  assert.ok(straight.paths().every((path) => path.every((p, i) => i === 0 || p.x === path[i - 1].x || p.y === path[i - 1].y)));
});
