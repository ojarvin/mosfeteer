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
  c.addComponent('resistor', { refdes: 'R1', x: 320, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 720, y: 0 });
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

test('CLI adds VCM and connects its vcm terminal', () => {
  const c = fresh();
  const added = runCommand(c, 'add vcm --at 400 0');
  assert.equal(added.mutated, true);
  assert.equal(added.json.refdes, 'VCM1');
  assert.deepEqual(added.json.terminals, [{ name: 'vcm', x: 400, y: 0 }]);

  // R1.a lands on VCM's attachment point, exercising touching-pin
  // connectivity without depending on a particular clearance route.
  runCommand(c, 'add resistor --at 480 0');
  const connected = runCommand(c, 'connect VCM1.vcm R1.a');
  assert.equal(connected.mutated, true);
  assert.equal(connected.json.terminals.length, 2);
  assert.ok(connected.json.terminals.some((t) => t.comp === 'VCM1' && t.term === 'vcm'));
  assert.ok(connected.json.terminals.some((t) => t.comp === 'R1' && t.term === 'a'));
  assert.equal(c.netOfTerminal('VCM1.vcm').id, c.netOfTerminal('R1.a').id);
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
  runCommand(c, 'add resistor --at 0 0'); // R1 (b at 80,0)
  runCommand(c, 'add resistor --at 400 0'); // R2 (a at 320,0)
  runCommand(c, 'connect R1.b R2.a');
  const net = [...c.nets.values()][0];
  assert.equal(net.route[net.route.length - 1].x, 320);
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

test('mirror command uses world axes after rotation', () => {
  const c = fresh();
  runCommand(c, 'add nmos M1 --at 120 80 --rot 90');
  const comp = c.getComponent('M1');
  const before = Object.fromEntries(comp.worldTerminals().map((t) => [
    t.name,
    { x: t.x - comp.transform.x, y: t.y - comp.transform.y },
  ]));

  runCommand(c, 'mirror M1 x');
  for (const t of comp.worldTerminals()) {
    const actual = { x: t.x - comp.transform.x, y: t.y - comp.transform.y };
    const expected = { x: -before[t.name].x, y: before[t.name].y };
    assert.ok(Math.abs(actual.x - expected.x) < 1e-9, `${t.name} reflects x in world space`);
    assert.equal(actual.y, expected.y, `${t.name} keeps y in world space`);
  }
  runCommand(c, 'mirror M1 x');
  for (const t of comp.worldTerminals()) {
    assert.equal(t.x - comp.transform.x, before[t.name].x, `${t.name} returns to its original x`);
    assert.equal(t.y - comp.transform.y, before[t.name].y, `${t.name} returns to its original y`);
  }
});


test('move, rotate, and mirror report forced reroute failure instead of success', () => {
  for (const command of ['move R2 400 400', 'rotate R2', 'mirror R2 x']) {
    const c = fresh();
    runCommand(c, 'add resistor --at 0 0');
    runCommand(c, 'add resistor --at 400 0');
    runCommand(c, 'connect R1.b R2.a');
    const net = [...c.nets.values()][0];
    const beforeRoute = net.route.map((p) => ({ ...p }));
    const beforeTransform = { ...c.getComponent('R2').transform };
    const baseEnv = c._netEnv();
    c._netEnv = () => ({
      ...baseEnv,
      rects: [...baseEnv.rects, { x: 120, y: -2000, w: 320, h: 4000 }],
    });

    assert.throws(() => runCommand(c, command), /unable to route wire safely/);
    assert.deepEqual(c.getComponent('R2').transform, beforeTransform, `${command} rolls back the component`);
    assert.deepEqual(net.route, beforeRoute, `${command} preserves the prior route`);
  }
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

function crossCircuit() {
  const c = fresh();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: -160 });
  c.addComponent('resistor', { refdes: 'R2', x: 320, y: 160 });
  c.addComponent('resistor', { refdes: 'R3', x: 320, y: -160 });
  c.addComponent('resistor', { refdes: 'R4', x: 80, y: 160 });
  return c;
}

test('cross creates two fixed matched routes with one unsoldered central crossing', () => {
  const c = crossCircuit();
  const res = runCommand(c, 'cross R1.a R2.a R3.a R4.a');
  assert.equal(res.mutated, true);
  assert.equal(res.json.nets.length, 2);
  assert.equal(c.nets.size, 2);
  const nets = [...c.nets.values()];
  assert.ok(nets.every((net) => net.routingMode === 'fixed'));
  assert.deepEqual(nets[0].fixedPaths[0].start, { comp: 'R1', term: 'a' });
  assert.deepEqual(nets[0].fixedPaths[0].end, { comp: 'R2', term: 'a' });
  assert.deepEqual(nets[1].fixedPaths[0].start, { comp: 'R3', term: 'a' });
  assert.deepEqual(nets[1].fixedPaths[0].end, { comp: 'R4', term: 'a' });
  assert.equal(nets[0].fixedPaths[0].points.length, 2);
  assert.equal(nets[1].fixedPaths[0].points.length, 2);
  assert.notEqual(nets[0].fixedPaths[0].points[0].y, nets[0].fixedPaths[0].points[1].y);
  assert.notEqual(nets[1].fixedPaths[0].points[0].y, nets[1].fixedPaths[0].points[1].y);
  assert.equal([...c.components.values()].filter((x) => x.type === 'solder').length, 0);
  const reloaded = Circuit.fromJSON(JSON.parse(JSON.stringify(c.toJSON())));
  assert.equal(reloaded.nets.size, 2);
  assert.ok([...reloaded.nets.values()].every((net) => net.routingMode === 'fixed'));
  assert.deepEqual([...reloaded.nets.values()].map((net) => net.paths()), nets.map((net) => net.paths()));
});

test('cross is idempotent for the same fixed pair and refuses connected endpoints', () => {
  const c = crossCircuit();
  const first = runCommand(c, 'cross R1.a R2.a R3.a R4.a');
  const second = runCommand(c, 'cross R1.a R2.a R3.a R4.a');
  assert.equal(second.mutated, false);
  assert.match(second.text, /already exists/);
  assert.deepEqual(second.json.nets.map((net) => net.id), first.json.nets.map((net) => net.id));

  const other = crossCircuit();
  other.connect('R1.a', 'R2.a');
  assert.throws(() => runCommand(other, 'cross R1.a R2.a R3.a R4.a'), /already belong to a net/);
});

test('cross rejects non-rectangular or non-diagonal endpoint pairings', () => {
  const c = crossCircuit();
  assert.throws(() => runCommand(c, 'cross R1.a R3.a R2.a R4.a'), /invalid cross-coupling endpoints/);
  assert.equal(c.nets.size, 0);
});

test('fixed geometry commands edit paths without converting them to managed wires', () => {
  const c = crossCircuit();
  runCommand(c, 'cross R1.a R2.a R3.a R4.a');
  const net = [...c.nets.values()][0];
  const start = net.fixedPaths[0].start;
  const end = net.fixedPaths[0].end;
  runCommand(c, `net ${net.id} path 0 0 -160 80 0 240 160`);
  runCommand(c, `net ${net.id} vertex 0 1 120 0`);
  assert.equal(net.routingMode, 'fixed');
  assert.deepEqual(net.fixedPaths[0].start, start);
  assert.deepEqual(net.fixedPaths[0].end, end);
  assert.deepEqual(net.fixedPaths[0].points, [
    { x: 0, y: -160 }, { x: 120, y: 0 }, { x: 240, y: 160 },
  ]);
});

test('fixed diagonal paths cumulatively re-anchor and restore through moves', () => {
  const c = crossCircuit();
  runCommand(c, 'cross R1.a R2.a R3.a R4.a');
  const before = [...c.nets.values()].map((n) => n.paths());
  runCommand(c, 'move R1 80 -120');
  runCommand(c, 'move R1 80 -160');
  assert.deepEqual([...c.nets.values()].map((n) => n.paths()), before);
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

test('netlabel commands add, rename, list, and remove physical net labels', () => {
  const c = fresh();
  runCommand(c, 'add resistor R1 --at 320 0');
  runCommand(c, 'add resistor R2 --at 720 0');
  const connected = runCommand(c, 'connect R1.b R2.a --name SIG');
  const netId = connected.json.netId;
  const added = runCommand(c, `netlabel add ${netId} SIG_LABEL SIG 520 0`);
  assert.equal(added.json.netId, netId);
  assert.equal(c.labels.get('SIG_LABEL').text, 'SIG');
  runCommand(c, `netlabel rename SIG_LABEL OUT`);
  assert.equal(c.nets.get(netId).name, 'OUT');
  assert.throws(() => runCommand(c, `net ${netId} name "   "`), /cannot clear name/);
  assert.match(runCommand(c, `netlabel list ${netId}`).text, /SIG_LABEL.*OUT/);
  runCommand(c, 'netlabel rm SIG_LABEL');
  assert.equal(c.labels.has('SIG_LABEL'), false);
  runCommand(c, `netlabel add ${netId} DROP_LABEL OUT 520 0`);
  runCommand(c, `net ${netId} drop R1.b`);
  runCommand(c, `net ${netId} drop R2.a`);
  assert.equal(c.nets.has(netId), false);
  assert.equal(c.labels.has('DROP_LABEL'), false);
});

test('netlabel aliases and annotation commands are cohesive and require coordinates', () => {
  const c = fresh();
  runCommand(c, 'add resistor R1 --at 320 0');
  runCommand(c, 'add resistor R2 --at 720 0');
  const connected = runCommand(c, 'connect R1.b R2.a --name SIG');
  assert.throws(() => runCommand(c, `net-label add ${connected.json.netId} BAD`), /usage: netlabel add/);
  runCommand(c, `wire-label add ${connected.json.netId} L1 SIG 520 0`);
  runCommand(c, `net ${connected.json.netId} label add L2 SIG 520 0`);
  assert.equal(c.labels.get('L2').netId, connected.json.netId);
  runCommand(c, 'annotate add NOTE "free note" 80 80');
  assert.equal(c.labels.get('NOTE').text, 'free note');
  runCommand(c, 'label rename NOTE changed');
  runCommand(c, 'annotation move NOTE 120 120');
  assert.deepEqual(c.labels.get('NOTE').anchor, { x: 120, y: 120 });
  runCommand(c, 'label rm NOTE');
  assert.equal(c.labels.has('NOTE'), false);
});

test('evaluation reports only live structured malformed net labels', () => {
  const c = fresh();
  const net = c.createWireNet({ name: 'SIG', route: [{ x: 0, y: 0 }, { x: 80, y: 0 }] });
  const label = c.addNetLabel(net, { id: 'SIG_LABEL', x: 40, y: 0 });
  label.setNetId('N404');
  const rep = evaluate(c);
  assert.equal(rep.netLabelIssues.length, 1);
  assert.deepEqual(rep.netLabelIssues[0], {
    labelId: 'SIG_LABEL', netId: 'N404', message: 'net label SIG_LABEL targets missing net N404',
  });
  assert.equal(rep.issues.find((issue) => issue.kind === 'malformed-net-label').labelId, 'SIG_LABEL');
  const loaded = Circuit.fromJSON({
    version: 2, grid: 40, components: [], nets: [],
    labels: [{ id: 'ORPHAN', text: 'SIG', netId: 'N404', owner: null, anchor: { x: 0, y: 0 } }],
  });
  assert.deepEqual(evaluate(loaded).netLabelIssues, []);
});

test('managed VCM-to-VCM routes escape upward and clear both bodies', () => {
  const c = fresh();
  runCommand(c, 'add vcm --at 0 0');
  runCommand(c, 'add vcm --at 240 0');
  const result = runCommand(c, 'connect VCM1.vcm VCM2.vcm');
  const net = c.nets.get(result.json.netId);
  const path = net.paths()[0];
  const first = c.getComponent('VCM1').terminalWorld('vcm');
  const last = c.getComponent('VCM2').terminalWorld('vcm');

  assert.deepEqual(path[0], first);
  assert.deepEqual(path[path.length - 1], last);
  assert.equal(path[1].x, first.x);
  assert.ok(path[1].y < first.y, 'source terminal leg escapes upward');
  assert.equal(path[path.length - 2].x, last.x);
  assert.ok(path[path.length - 2].y < last.y, 'target terminal leg escapes upward');
  assert.deepEqual(evaluate(c).wireThroughBBoxes, []);
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
  c.addComponent('resistor', { refdes: 'R1', x: 320, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 720, y: 0 });
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

test('evaluate allows fixed diagonals but reports diagonal body drills', () => {
  const c = fresh();
  c.addComponent('resistor', { refdes: 'R1', x: 320, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 720, y: 400 });
  c.wireDirectTo('R1.a', 'R2.a');
  const rep = evaluate(c);
  assert.deepEqual(rep.diagonalWireSegments, []);
  assert.ok(rep.wireThroughBBoxes.some((x) => x.includes('through R1(resistor) bbox')));
});

test('automatic routing rejects blocked paths while explicit orthogonal waypoints remain reportable', () => {
  const auto = fresh();
  auto.addComponent('resistor', { refdes: 'R1', x: 320, y: 0 });
  auto.addComponent('resistor', { refdes: 'R2', x: 720, y: 0 });
  auto._netEnv = () => ({
    rects: [{ x: -10000, y: -10000, w: 20000, h: 20000 }],
    pins: new Map(), wires: [], labelRects: [],
  });
  assert.throws(() => auto.wireTo('R1.a', auto.getComponent('R2').terminalWorld('a')), /unable to route wire safely/);

  const explicit = fresh();
  explicit.addComponent('resistor', { refdes: 'R1', x: 320, y: 0 });
  explicit.addComponent('resistor', { refdes: 'R2', x: 720, y: 0 });
  const net = explicit.wireTo(
    'R1.a', explicit.getComponent('R2').terminalWorld('a'),
    [{ x: 320, y: 0 }], { routeStyle: 'orthogonal' },
  );
  assert.equal(net.routingMode, 'managed');
  assert.equal(net.allowDiagonal, false);
  assert.ok(evaluate(explicit).wireThroughBBoxes.some((x) => x.includes('through R1(resistor) bbox')));
});

test('explicit diagonal waypoints preserve body drills for Check to report', () => {
  const c = fresh();
  c.addComponent('resistor', { refdes: 'R1', x: 320, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 720, y: 400 });
  const net = c.wireTo(
    'R1.a', c.getComponent('R2').terminalWorld('a'),
    [{ x: 320, y: 80 }], { routeStyle: 'diagonal' },
  );
  assert.equal(net.routingMode, 'managed');
  assert.equal(net.allowDiagonal, true);
  assert.ok(net.paths().some((path) => path.some((p, i) => i > 0 && p.x !== path[i - 1].x && p.y !== path[i - 1].y)));
  assert.ok(evaluate(c).wireThroughBBoxes.some((x) => x.includes('through R1(resistor) bbox')));
});

test('evaluate reports positive-span diagonal overlap between distinct nets', () => {
  const c = fresh();
  c.createWireNet({ allowDiagonal: true, branches: [[{ x: 0, y: 0 }, { x: 400, y: 400 }]] });
  c.createWireNet({ allowDiagonal: true, branches: [[{ x: 200, y: 200 }, { x: 600, y: 600 }]] });
  const rep = evaluate(c);
  assert.equal(rep.diagonalWireSegments.length, 0);
  assert.equal(rep.crossNetOverlaps.length, 1);
  assert.deepEqual(rep.crossNetOverlaps[0], {
    key: 'N1:0:1',
    otherKey: 'N2:0:1',
    x0: 200,
    y0: 200,
    x1: 400,
    y1: 400,
  });
  assert.ok(rep.issues.some((issue) => issue.kind === 'cross-net-overlap'));
});

test('renaming and dropping terminals update fixed path anchors', () => {
  const c = fresh();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 400 });
  const n = c.wireDirectTo('R1.b', 'R2.a');
  runCommand(c, 'rename R1 R9');
  assert.deepEqual(n.fixedPaths[0].start, { comp: 'R9', term: 'b' });
  runCommand(c, `net ${n.id} drop R9.b`);
  assert.equal(n.fixedPaths[0].start, null);
});

test('evaluate() emits machine-usable issues for component overlap and dangling pins', () => {
  const c = fresh();
  c.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 40, y: 0 });

  const rep = evaluate(c);
  const overlap = rep.issues.find((issue) => issue.kind === 'component-overlap');
  const dangling = rep.issues.find((issue) => issue.kind === 'unconnected-terminal');
  assert.equal(rep.ok, false);
  assert.deepEqual(overlap.refs, ['R1', 'R2']);
  assert.equal(overlap.severity, 'error');
  assert.ok(overlap.points.length === 2);
  assert.deepEqual(dangling.refs, ['R1.a']);
  assert.deepEqual(dangling.points, [{ x: -80, y: 0 }]);
});

test('eval does not pass a managed wire through a component bbox', () => {
  const c = fresh();
  c.addComponent('resistor', { refdes: 'R1', x: 320, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 720, y: 0 });
  const net = c.connect('R1.a', 'R2.b');
  net.route = [{ x: 240, y: 0 }, { x: 800, y: 0 }];

  const res = runCommand(c, 'eval');
  assert.equal(res.json.ok, false);
  assert.ok(res.json.issues.some((issue) => issue.kind === 'wire-through-body'));
  assert.match(res.text, /wires through bboxes/);
  assert.doesNotMatch(res.text, /no dangling terminals, no bbox overlaps, all on grid/);
});

test('eval does not pass a managed diagonal wire', () => {
  const c = fresh();
  c.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 400, y: 400 });
  const net = c.connect('R1.b', 'R2.a');
  net.route = [{ x: 80, y: 0 }, { x: 320, y: 400 }];

  const res = runCommand(c, 'eval');
  const diagonal = res.json.issues.find((issue) => issue.kind === 'managed-diagonal');
  assert.equal(res.json.ok, false);
  assert.equal(diagonal.severity, 'error');
  assert.deepEqual(diagonal.points, [{ x: 80, y: 0 }, { x: 320, y: 400 }]);
  assert.match(res.text, /managed diagonal wires/);
  assert.doesNotMatch(res.text, /no dangling terminals, no bbox overlaps, all on grid/);
});

test('evaluate reports free and owned label/component overlaps', () => {
  const c = fresh();
  c.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  c.addLabel({ id: 'Lfree', text: 'VIN', x: 0, y: 0 });
  c.addComponent('nmos', { refdes: 'M1', x: 400, y: 0 });
  const owned = c.labelOf('M1');
  owned.offset = { x: 0, y: 0 }; // deliberately overlap the parent component

  const res = runCommand(c, 'eval');
  const rep = res.json;
  const issues = rep.issues.filter((entry) => entry.kind === 'label-component-overlap');
  assert.equal(rep.ok, false);
  assert.deepEqual(rep.labelComponentOverlaps.length, 2);
  assert.deepEqual(issues.map((entry) => entry.refs), [['Lfree', 'R1'], [owned.id, 'M1']]);
  assert.ok(issues.every((entry) => entry.severity === 'error'));
  assert.ok(issues.every((entry) => entry.points.length === 2));
  assert.match(res.text, /label-component overlaps/);
});

test('evaluate reports overlapping distinct label bboxes', () => {
  const c = fresh();
  c.addLabel({ id: 'L1', text: 'A', x: 0, y: 0 });
  c.addLabel({ id: 'L2', text: 'B', x: 40, y: 0 });

  const res = runCommand(c, 'eval');
  const rep = res.json;
  const issue = rep.issues.find((entry) => entry.kind === 'label-overlap');
  assert.equal(rep.ok, false);
  assert.equal(rep.labelOverlaps.length, 1);
  assert.deepEqual(issue.refs, ['L1', 'L2']);
  assert.equal(issue.severity, 'error');
  assert.deepEqual(issue.points, [{ x: 0, y: -40 }, { x: 40, y: 40 }]);
  assert.match(res.text, /label overlaps/);
});
