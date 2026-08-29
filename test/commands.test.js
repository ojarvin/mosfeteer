import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCommand, commandHelp, evaluate, splitArgs, parseArgs } from '../src/core/commands.js';
import { Circuit } from '../src/core/model.js';

function fresh() {
  return new Circuit();
}

/** A tiny wired circuit for report-shape / svg tests. */
function smallCircuit() {
  const c = fresh();
  c.addComponent('resistor', { refdes: 'R1', x: 240, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 640, y: 0 });
  c.connect('R1.b', 'R2.a');
  return c;
}

test('splitArgs honors double-quoted strings', () => {
  assert.deepEqual(splitArgs('value R1 "10 kilohm"'), ['value', 'R1', '10 kilohm']);
  assert.deepEqual(splitArgs('add resistor --at 400 0'), ['add', 'resistor', '--at', '400', '0']);
});

test('parseArgs splits positionals and flags by arity', () => {
  assert.deepEqual(parseArgs(['add', 'resistor', '--at', '400', '0', '--mirrorX']), {
    pos: ['add', 'resistor'],
    flags: { at: ['400', '0'], mirrorX: true },
  });
  assert.throws(() => parseArgs(['x', '--nope']), /unknown flag/);
});

test('help returns help text', () => {
  const res = runCommand(fresh(), 'help');
  assert.equal(res.mutated, false);
  assert.ok(res.text.includes('add <type>'));
  assert.ok(res.text.includes('move <refdes>'));
  assert.ok(commandHelp().includes('eval'));
});

test('add component with --at snaps to grid', () => {
  const c = fresh();
  const res = runCommand(c, 'add resistor --at 413 19');
  assert.equal(res.mutated, true);
  assert.equal(res.json.refdes, 'R1');
  assert.equal(res.json.at.x, 400);
  assert.equal(res.json.at.y, 0);
  assert.equal(c.components.get('R1').type, 'resistor');
});

test('add component with explicit refdes', () => {
  const c = fresh();
  const res = runCommand(c, 'add resistor R7 --at 400 0');
  assert.equal(res.json.refdes, 'R7');
  assert.ok(c.components.has('R7'));
});

test('add component with --rot and --value', () => {
  const c = fresh();
  const res = runCommand(c, 'add resistor --at 400 0 --rot 90 --value 1k');
  assert.equal(res.json.rotation, 90);
  assert.equal(c.getComponent('R1').value, '1k');
});

test('add unknown type throws', () => {
  assert.throws(() => runCommand(fresh(), 'add bogus'), /unknown component type/);
});

test('move uses positional X Y (not --to flag)', () => {
  const c = fresh();
  runCommand(c, 'add resistor --at 400 0');
  const res = runCommand(c, 'move R1 400 80');
  assert.equal(res.mutated, true);
  assert.deepEqual(res.json, { refdes: 'R1', x: 400, y: 80 });
  assert.equal(c.getComponent('R1').transform.y, 80);
});

test('move --to is not a supported flag (throws)', () => {
  const c = fresh();
  runCommand(c, 'add resistor --at 400 0');
  assert.throws(() => runCommand(c, 'move R1 --to 400 80'), /unknown flag --to/);
});

test('move snaps to grid', () => {
  const c = fresh();
  runCommand(c, 'add resistor --at 400 0');
  runCommand(c, 'move R1 433 127');
  assert.equal(c.getComponent('R1').transform.x, 440);
  assert.equal(c.getComponent('R1').transform.y, 120);
});

test('rotate defaults to +90 and wraps', () => {
  const c = fresh();
  runCommand(c, 'add resistor --at 400 0');
  runCommand(c, 'rotate R1');
  assert.equal(c.getComponent('R1').transform.rotation, 90);
  runCommand(c, 'rotate R1 270');
  assert.equal(c.getComponent('R1').transform.rotation, 0);
});

test('rotating a routed-in component re-routes the net to the new terminal', () => {
  const c = fresh();
  runCommand(c, 'add resistor --at 0 0'); // R1 (a at 0,0)
  runCommand(c, 'add resistor --at 400 0'); // R2 (a at 400,0)
  runCommand(c, 'connect R1.b R2.a'); // R1.b at (160,0) -> R2.a at (400,0)
  const net = [...c.nets.values()][0];
  assert.equal(net.route[net.route.length - 1].x, 400);
  runCommand(c, 'rotate R2');
  assert.deepEqual(net.route[net.route.length - 1], c.getComponent('R2').terminalWorld('a'));
});

test('mirroring a routed-in component re-routes the net to the new terminal', () => {
  const c = fresh();
  runCommand(c, 'add resistor --at 0 0'); // R1 (b at 160,0)
  runCommand(c, 'add resistor --at 400 0'); // R2 (a at 400,0)
  runCommand(c, 'connect R1.b R2.a');
  const net = [...c.nets.values()][0];
  runCommand(c, 'mirror R2 x'); // a flips from (400,0) to (280,0)
  assert.deepEqual(net.route[net.route.length - 1], c.getComponent('R2').terminalWorld('a'));
});

test('connect joins terminals into a net and names it', () => {
  const c = fresh();
  runCommand(c, 'add resistor --at 400 0'); // R1
  runCommand(c, 'add resistor --at 400 120'); // R2
  const res = runCommand(c, 'connect R1.a R2.a --name rail');
  assert.equal(res.mutated, true);
  assert.equal(res.json.name, 'rail');
  assert.equal(res.json.terminals.length, 2);
  assert.equal(c.nets.size, 1);
});

test('adding a terminal to an existing net draws a real wire to it', () => {
  // Regression for the "phantom connected" bug: connecting R1.b and R2.a creates
  // a 2-terminal wire; then connecting R1.b and R3.a used to add R3.a to the
  // net's terminal list but leave `net.branches` carrying the old 2-terminal
  // polyline. After save/reload, `fromJSON`'s repair loop normalised that
  // branch back into `net.route`, dropping the new wire — `eval` still
  // reported R3.a as connected (it's in the net) but no branch reached it.
  const c = fresh();
  runCommand(c, 'add resistor --at 0 0');    // R1: a=(0,0)   b=(160,0)
  runCommand(c, 'add resistor --at 200 0');  // R2: a=(200,0) b=(360,0)
  runCommand(c, 'add resistor --at 400 0');  // R3: a=(400,0) b=(560,0)
  runCommand(c, 'connect R1.b R2.a --name N1');

  const n1 = c.nets.get('N1');
  assert.equal(n1.terminals.length, 2);
  assert.equal(n1.length(), 40);

  runCommand(c, 'connect R1.b R3.a --name N1');

  assert.equal(n1.terminals.length, 3, 'R3.a should be in the net');
  assert.ok(n1.length() >= 240, `net length should grow to cover R3.a's wire (got ${n1.length()})`);

  // After a save/reload, the new terminal must still be reachable by a real
  // wire — this is where the bug used to silently revert.
  const reloaded = Circuit.fromJSON(c.toJSON());
  const nets = [...reloaded.nets.values()].filter((net) => net.terminals.length === 3);
  assert.equal(nets.length, 1, 'reloaded circuit must still have the merged 3-terminal net');
  const r3 = nets[0];
  const r3a = reloaded.getComponent('R3').terminalWorld('a');
  const pathPoints = r3.pathPoints();
  const r3aReachable = pathPoints.some((p) => p.x === r3a.x && p.y === r3a.y);
  assert.ok(r3aReachable, 'R3.a must appear in some branch polyline after reload');
  // The full net length on reload must still cover all three terminals.
  assert.ok(r3.length() >= 240, `reloaded net length should still cover R3.a (got ${r3.length()})`);
});

test('connect with too few refs throws', () => {
  assert.throws(() => runCommand(fresh(), 'connect R1.a'), /usage: connect/);
});

test('net segment-rm deletes wire geometry through the agent command', () => {
  const c = smallCircuit();
  const net = [...c.nets.values()][0];
  net.branches = [[{ x: 0, y: 0 }, { x: 0, y: 80 }, { x: 160, y: 80 }, { x: 160, y: 0 }]];
  net.route = net.branches[0];
  const out = runCommand(c, 'net N1 segment-rm 0 2');
  assert.equal(out.mutated, true);
  assert.equal(c.nets.size, 2);
});

test('connect with too few refs throws', () => {
  assert.throws(() => runCommand(fresh(), 'connect R1.a'), /usage: connect/);
});

test('list renders component rows', () => {
  const c = fresh();
  runCommand(c, 'add resistor --at 400 0');
  const res = runCommand(c, 'list');
  assert.ok(res.text.includes('R1'));
});

test('eval reports quality of a small circuit', () => {
  const c = fresh();
  runCommand(c, 'add supply SUPPLY1 --at 400 0');
  runCommand(c, 'add resistor R1 --at 400 80');
  runCommand(c, 'add ground GROUND1 --at 400 200');
  runCommand(c, 'connect SUPPLY1.p R1.a');
  runCommand(c, 'connect R1.b GROUND1.gnd');
  const res = runCommand(c, 'eval');
  const rep = res.json;
  assert.equal(rep.unconnectedTerminals.length, 0, JSON.stringify(rep.unconnectedTerminals));
  assert.equal(rep.overlappingBBoxes.length, 0);
  assert.equal(rep.gridViolations.length, 0);
  assert.equal(rep.terminalCount, 4);
  assert.equal(rep.nets.length, 2);
});

test('unknown command throws', () => {
  assert.throws(() => runCommand(fresh(), 'frobnicate'), /unknown command/);
});

test('command result includes json and mutated flags', () => {
  const c = fresh();
  const res = runCommand(c, 'add resistor --at 400 0');
  assert.equal(res.mutated, true);
  assert.ok(res.json);
  assert.strictEqual(typeof res.text, 'string');
});

test('evaluate() returns structured report keys', () => {
  const rep = evaluate(smallCircuit());
  for (const k of [
    'components',
    'terminalCount',
    'unconnectedTerminals',
    'nets',
    'overlappingBBoxes',
    'wireThroughBBoxes',
    'gridViolations',
    'bounds',
  ]) {
    assert.ok(k in rep, `report has key ${k}`);
  }
  assert.ok(Array.isArray(rep.nets));
  for (const n of rep.nets) {
    assert.ok('id' in n && 'name' in n && 'n' in n && 'length' in n);
  }
});

test('evaluate() reports a clean wired circuit with expected metrics', () => {
  const rep = evaluate(smallCircuit());
  assert.equal(rep.components.length, 2);
  assert.equal(rep.terminalCount, 4);
  assert.equal(rep.unconnectedTerminals.length, 2);
  assert.equal(rep.nets.length, 1);
  assert.deepEqual(rep.overlappingBBoxes, []);
  assert.deepEqual(rep.wireThroughBBoxes, []);
  assert.deepEqual(rep.gridViolations, []);
});

test('svg command returns SVG via json when no file I/O', () => {
  const c = smallCircuit();
  const res = runCommand(c, 'svg');
  assert.ok(res.json.svg.startsWith('<svg'));
});

test('evaluate flags a wire drilling through its own source body', () => {
  const c = fresh();
  c.addComponent('resistor', { refdes: 'R1', x: 240, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 640, y: 0 });
  const net = c.connect('R1.a', 'R2.b');
  // straight line leaving pin "a" right through R1's body
  net.route = [{ x: 240, y: 0 }, { x: 800, y: 0 }];
  const rep = evaluate(c);
  assert.ok(rep.wireThroughBBoxes.length >= 1, 'through-own-pin drill is a violation');
  assert.match(rep.wireThroughBBoxes.join('\n'), /through R1\(resistor\) bbox/);
  // same pins but routed over the top boundary hugs exactly y=-40 (legal)
  c.nets.get(net.id).route = [{ x: 240, y: 0 }, { x: 240, y: -40 }, { x: 800, y: -40 }, { x: 800, y: 0 }];
  const rep2 = evaluate(c);
  assert.deepEqual(rep2.wireThroughBBoxes, [], 'boundary-hugging route is clean');
});
