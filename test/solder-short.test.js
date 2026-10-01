import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';

/** A horizontal and a vertical two-terminal net crossing at (400,200). */
function crossing({ horizontal = '', vertical = '' } = {}) {
  const c = new Circuit();
  c.addComponent('resistor', { x: 0, y: 200 });
  c.addComponent('resistor', { x: 800, y: 200 });
  c.addComponent('resistor', { x: 400, y: -160, rotation: 90 });
  c.addComponent('resistor', { x: 400, y: 560, rotation: 90 });
  const h = c.connect('R1.b', 'R2.a');
  const v = c.connect('R3.b', 'R4.a');
  v.branches = [[{ x: 400, y: -80 }, { x: 400, y: 480 }]];
  v.route = v.branches[0];
  v.junctions = [];
  if (horizontal) c.renameNet(h, horizontal);
  if (vertical) c.renameNet(v, vertical);
  return { c, h, v };
}

test('shortNetsAt joins two crossing auto-named nets with a junction dot', () => {
  const { c, h } = crossing();
  const net = c.shortNetsAt({ x: 400, y: 200 });
  assert.equal(c.nets.size, 1);
  assert.equal(net, h, 'the first net keeps its identity');
  assert.equal(net.terminals.length, 4);
  assert.deepEqual(net.junctions, [{ x: 400, y: 200 }]);
  const solders = [...c.components.values()].filter((comp) => comp.type === 'solder');
  assert.deepEqual(solders.map((comp) => [comp.transform.x, comp.transform.y]), [[400, 200]]);
  const reloaded = Circuit.fromJSON(JSON.parse(JSON.stringify(c.toJSON())));
  assert.equal(reloaded.nets.size, 1, 'the short survives save and load');
});

test('shortNetsAt keeps the one given name', () => {
  const { c, v } = crossing({ vertical: 'V_{B}' });
  const net = c.shortNetsAt({ x: 400, y: 200 });
  assert.equal(net, v);
  assert.equal(net.name, 'V_{B}');
});

test('shortNetsAt asks for a choice between given names and changes nothing until chosen', () => {
  const { c } = crossing({ horizontal: 'V_{A}', vertical: 'V_{B}' });
  assert.throws(() => c.shortNetsAt({ x: 400, y: 200 }), (err) => err.code === 'net-name-choice' && err.names.join() === 'V_{A},V_{B}');
  assert.equal(c.nets.size, 2);
  const net = c.shortNetsAt({ x: 400, y: 200 }, { name: 'V_{B}' });
  assert.equal(net.name, 'V_{B}');
  assert.equal(c.nets.size, 1);
  assert.throws(() => crossing({ horizontal: 'A', vertical: 'B' }).c.shortNetsAt({ x: 400, y: 200 }, { name: 'C' }), /not one of/);
});

test('shortNetsAt does nothing where fewer than three wire arms meet', () => {
  const { c } = crossing();
  assert.equal(c.shortNetsAt({ x: 200, y: 200 }), null, 'a dot on a plain straight wire');
  assert.equal(c.shortNetsAt({ x: 2000, y: 2000 }), null, 'a dot on empty canvas');
  assert.equal(c.nets.size, 2);
});

test('shortNetsAt also joins a fixed (literal) net, keeping every path literal', () => {
  const { c, h, v } = crossing();
  // A fixed diagonal-free literal path for the vertical net.
  c._setFixedPaths(v, [{ points: [{ x: 400, y: -80 }, { x: 400, y: 480 }], start: { comp: 'R3', term: 'b' }, end: { comp: 'R4', term: 'a' } }], []);
  const net = c.shortNetsAt({ x: 400, y: 200 });
  assert.ok(net);
  assert.equal(c.nets.size, 1);
  assert.equal(net.routingMode, 'fixed');
  assert.equal(net.terminals.length, 4);
  assert.ok(net.fixedPaths.every((entry) => entry.points.length >= 2));
  assert.ok(net.junctions.some((p) => p.x === 400 && p.y === 200));
  assert.ok([...c.components.values()].some((comp) => comp.type === 'solder' && comp.transform.x === 400 && comp.transform.y === 200));
  const reloaded = Circuit.fromJSON(JSON.parse(JSON.stringify(c.toJSON())));
  assert.equal(reloaded.nets.size, 1);
  assert.ok(h);
});

test('a gate bus drawn straight through MOS gates puts no dot on the gates it passes', () => {
  const c = new Circuit();
  for (const line of ['add nmos M1 --at 400 400', 'add nmos M2 --at 800 400', 'add nmos M3 --at 1200 400',
    'add resistor R1 --at 0 400', 'add resistor R2 --at 1080 160 --rot 90', 'connect R1.b M1.g M2.g M3.g R2.b']) runCommand(c, line);
  const net = c.netOfTerminal({ comp: 'M1', term: 'g' });
  // One straight line through every gate, then up from M3's gate to R2.
  net.branches = [[{ x: 80, y: 400 }, { x: 1080, y: 400 }], [{ x: 1080, y: 400 }, { x: 1080, y: 240 }]];
  net.route = net.branches[0];
  net.junctions = [];
  c.syncJunctionSolders();
  const dots = [...c.components.values()].filter((part) => part.type === 'solder').map((part) => [part.transform.x, part.transform.y]);
  // M1 and M2 are passed straight through; M3's gate is a real tee.
  assert.deepEqual(dots, [[1080, 400]]);
});
