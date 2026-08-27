import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, ComponentInstance, Net, parseTermRef } from '../src/core/model.js';
import { GRID, onGrid } from '../src/core/grid.js';

test('parseTermRef parses REFDES.TERM and rejects malformed', () => {
  assert.deepEqual(parseTermRef('R1.a'), { comp: 'R1', term: 'a' });
  assert.deepEqual(parseTermRef('GROUND1.gnd'), { comp: 'GROUND1', term: 'gnd' });
  assert.throws(() => parseTermRef('R1'), /invalid terminal ref/);
  assert.throws(() => parseTermRef('.a'), /invalid terminal ref/);
  assert.throws(() => parseTermRef('R1.'), /invalid terminal ref/);
});

test('addComponent assigns refdes from prefix', () => {
  const c = new Circuit();
  assert.equal(c.addComponent('resistor').refdes, 'R1');
  assert.equal(c.addComponent('resistor').refdes, 'R2');
  assert.equal(c.addComponent('capacitor').refdes, 'C1');
  assert.equal(c.addComponent('inductor').refdes, 'L1');
  assert.equal(c.addComponent('diode').refdes, 'D1');
  assert.equal(c.addComponent('nmos').refdes, 'M1');
  assert.equal(c.addComponent('npn').refdes, 'Q1');
  assert.equal(c.addComponent('ground').refdes, 'GROUND1');
  assert.equal(c.addComponent('supply').refdes, 'SUPPLY1');
  assert.equal(c.addComponent('input').refdes, 'INPUT1');
  assert.equal(c.addComponent('output').refdes, 'OUTPUT1');
  assert.equal(c.addComponent('inputoutput').refdes, 'INPUTOUTPUT1');
});

test('addComponent snaps position and sets defaults', () => {
  const c = new Circuit();
  const r = c.addComponent('resistor', { x: 23, y: 97 });
  assert.equal(r.transform.x, 40);
  assert.equal(r.transform.y, 80);
  assert.equal(r.transform.rotation, 0);
  assert.equal(r.transform.mirrorX, false);
  assert.equal(r.transform.mirrorY, false);
});

test('addComponent rejects duplicate refdes', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R9' });
  assert.throws(() => c.addComponent('resistor', { refdes: 'R9' }), /already in use/);
});

test('getComponent returns and throws for unknown', () => {
  const c = new Circuit();
  const r = c.addComponent('resistor');
  assert.equal(c.getComponent(r.refdes), r);
  assert.throws(() => c.getComponent('NOPE'), /unknown component/);
});

test('moveComponent snaps to grid', () => {
  const c = new Circuit();
  const r = c.addComponent('resistor');
  c.moveComponent(r.refdes, 123, 456);
  assert.equal(r.transform.x, 120);
  assert.equal(r.transform.y, 440);
});

test('setTransform normalizes rotation into 0/90/180/270', () => {
  const c = new Circuit();
  const r = c.addComponent('resistor');
  c.setTransform(r.refdes, { rotation: 90 });
  assert.equal(r.transform.rotation, 90);
  c.setTransform(r.refdes, { rotation: 270 });
  assert.equal(r.transform.rotation, 270);
  c.setTransform(r.refdes, { rotation: 360 });
  assert.equal(r.transform.rotation, 0);
  c.setTransform(r.refdes, { rotation: -90 });
  assert.equal(r.transform.rotation, 270);
  c.setTransform(r.refdes, { rotation: 920 });
  assert.ok([0, 90, 180, 270].includes(r.transform.rotation));
});

test('setTransform sets mirror flags', () => {
  const c = new Circuit();
  const r = c.addComponent('resistor');
  c.setTransform(r.refdes, { mirrorX: true });
  assert.equal(r.transform.mirrorX, true);
  c.setTransform(r.refdes, { mirrorY: true });
  assert.equal(r.transform.mirrorY, true);
  c.setTransform(r.refdes, { mirrorX: false });
  assert.equal(r.transform.mirrorX, false);
});

test('setValue coerces to string', () => {
  const c = new Circuit();
  const r = c.addComponent('resistor');
  c.setValue(r.refdes, '1k');
  assert.equal(r.value, '1k');
  c.setValue(r.refdes, 420);
  assert.equal(r.value, '420');
});

test('default value from symbol', () => {
  const c = new Circuit();
  assert.equal(c.addComponent('resistor').value, '');
  assert.equal(c.addComponent('supply').value, 'VCC');
  assert.equal(c.addComponent('output').value, 'OUT');
});

test('terminalWorld applies transform and stays on grid', () => {
  const c = new Circuit();
  const r = c.addComponent('resistor', { x: 400, y: 0 });
  assert.deepEqual(r.terminalWorld('a'), { x: 400, y: 0 });
  assert.deepEqual(r.terminalWorld('b'), { x: 520, y: 0 });
});

test('terminalWorld with rotation 90', () => {
  const c = new Circuit();
  const r = c.addComponent('resistor', { x: 400, y: 0, rotation: 90 });
  // local a=(0,0)->(0,0); b=(120,0) rotate 90: (-y,x) -> (0,120) -> translate (400,120)
  assert.deepEqual(r.terminalWorld('a'), { x: 400, y: 0 });
  assert.deepEqual(r.terminalWorld('b'), { x: 400, y: 120 });
});

test('worldTerminals and bboxWorld', () => {
  const c = new Circuit();
  const r = c.addComponent('resistor', { x: 400, y: 0 });
  assert.deepEqual(r.worldTerminals(), [
    { name: 'a', x: 400, y: 0 },
    { name: 'b', x: 520, y: 0 },
  ]);
  assert.deepEqual(r.bboxWorld(), { x: 400, y: -40, w: 120, h: 80 });
});

test('countTerminals counts all symbol terminals', () => {
  const c = new Circuit();
  c.addComponent('resistor');
  c.addComponent('nmos');
  c.addComponent('ground');
  assert.equal(c.countTerminals(), 2 + 3 + 1);
});

test('connect creates a net and adds terminals', () => {
  const c = new Circuit();
  const r1 = c.addComponent('resistor');
  const r2 = c.addComponent('resistor');
  const net = c.connect(`${r1.refdes}.a`, `${r2.refdes}.a`);
  assert.ok(net.id.startsWith('N'));
  assert.equal(net.terminalCount(), 2);
  assert.equal(c.nets.size, 1);
});

test('connect merges existing nets into one', () => {
  const c = new Circuit();
  const r1 = c.addComponent('resistor');
  const r2 = c.addComponent('resistor');
  const r3 = c.addComponent('resistor');
  const n1 = c.connect(`${r1.refdes}.a`, `${r2.refdes}.a`);
  const n2 = c.connect(`${r2.refdes}.b`, `${r3.refdes}.b`);
  assert.equal(c.nets.size, 2);
  const merged = c.connect(`${r1.refdes}.a`, `${r3.refdes}.b`);
  assert.equal(c.nets.size, 1);
  assert.equal([...c.nets.values()][0].terminalCount(), 4);
  assert.equal(merged, n1);
  assert.equal(c.netOfTerminal(`${r2.refdes}.b`), merged);
});

test('connect throws on self-connection', () => {
  const c = new Circuit();
  const r1 = c.addComponent('resistor');
  assert.throws(() => c.connect(`${r1.refdes}.a`, `${r1.refdes}.a`), /cannot connect a terminal to itself/);
});

test('netOfTerminal returns null when unconnected', () => {
  const c = new Circuit();
  const r1 = c.addComponent('resistor');
  assert.equal(c.netOfTerminal(`${r1.refdes}.a`), null);
});

test('disconnect removes just that terminal and drops empty nets', () => {
  const c = new Circuit();
  const r1 = c.addComponent('resistor');
  const r2 = c.addComponent('resistor');
  const net = c.connect(`${r1.refdes}.a`, `${r2.refdes}.a`);
  const back = c.disconnect(`${r1.refdes}.a`);
  assert.equal(back, net);
  assert.equal(net.terminalCount(), 1);
  assert.equal(c.netOfTerminal(`${r1.refdes}.a`), null);
  assert.equal(c.netOfTerminal(`${r2.refdes}.a`), net);
});

test('disconnect of the last terminal succeeds and drops the empty net', () => {
  const c = new Circuit();
  const r1 = c.addComponent('resistor');
  const r2 = c.addComponent('resistor');
  const net = c.connect(`${r1.refdes}.a`, `${r2.refdes}.a`);
  const r = net; // remove R1 first so R2 is last
  c.disconnect(`${r1.refdes}.a`);
  const back = c.disconnect(`${r2.refdes}.a`);
  assert.equal(back, net);
  assert.equal(c.nets.size, 0);
});

test('removeComponent sweeps terminals and drops empty nets', () => {
  const c = new Circuit();
  const r1 = c.addComponent('resistor');
  const r2 = c.addComponent('resistor');
  const r3 = c.addComponent('resistor');
  // netA = [R1.a, R2.a]; netB = [R2.b, R3.b]
  c.connect(`${r1.refdes}.a`, `${r2.refdes}.a`);
  const netB = c.connect(`${r2.refdes}.b`, `${r3.refdes}.b`);
  // Reduce netB to only R2.b so removing R2 empties (and drops) it.
  c.disconnect(`${r3.refdes}.b`);
  assert.equal(netB.terminalCount(), 1);

  c.removeComponent(r2.refdes);
  assert.equal(c.components.has(r2.refdes), false);
  // netA keeps R1.a; netB was emptied and dropped
  assert.equal(c.nets.size, 1);
  const remaining = [...c.nets.values()][0];
  assert.equal(remaining.terminalCount(), 1);
  assert.equal(remaining.terminals[0].comp, r1.refdes);
});

test('net.points routes between terminals', () => {
  const c = new Circuit();
  const r1 = c.addComponent('resistor', { x: 400, y: 0 });
  const r2 = c.addComponent('resistor', { x: 400, y: 120 });
  const net = c.connect(`${r1.refdes}.b`, `${r2.refdes}.a`);
  const pts = net.points();
  assert.ok(pts.length >= 2, 'has points');
  assert.deepEqual(pts[0], { x: 520, y: 0 });
  assert.deepEqual(pts[pts.length - 1], { x: 400, y: 120 });
  for (const p of pts) {
    assert.ok(onGrid(p.x) && onGrid(p.y), `point on grid (${p.x},${p.y})`);
  }
});

test('net.length is manhattan length', () => {
  const c = new Circuit();
  const r1 = c.addComponent('resistor');
  const r2 = c.addComponent('resistor', { x: 0, y: 120 });
  const net = c.connect(`${r1.refdes}.b`, `${r2.refdes}.a`);
  const len = net.length();
  const manhattan = (r1.terminalWorld('b').x - r2.terminalWorld('a').x) +
    (r2.terminalWorld('a').y - r1.terminalWorld('b').y);
  assert.equal(len, manhattan);
  assert.ok(len > 0);
});

test('empty circuit bounds is zero', () => {
  const c = new Circuit();
  assert.deepEqual(c.bounds(), { x: 0, y: 0, w: 0, h: 0 });
});

test('bounds covers components and nets with margin', () => {
  const c = new Circuit();
  c.addComponent('resistor', { x: 400, y: 0 });
  const b = c.bounds(40);
  assert.equal(b.x, 400 - 40);
  assert.ok(b.w > 0);
  assert.ok(b.h > 0);
});

test('toJSON / fromJSON round-trips refs, positions, transforms, net membership, length', () => {
  const c = new Circuit();
  const vcc = c.addComponent('supply', { x: 400, y: 0, value: '5V' });
  const r1 = c.addComponent('resistor', { x: 400, y: 80, rotation: 90, mirrorX: false, value: '1k' });
  const gnd = c.addComponent('ground', { x: 400, y: 200 });
  const n = c.connect(`${vcc.refdes}.p`, `${r1.refdes}.a`);
  n.name = 'rail';
  c.connect(`${r1.refdes}.b`, `${gnd.refdes}.gnd`);

  const data = JSON.parse(JSON.stringify(c.toJSON()));
  const c2 = Circuit.fromJSON(data);

  // same refs
  assert.deepEqual(
    [...c2.components.keys()].sort(),
    [...c.components.keys()].sort()
  );
  // same net count and lengths
  assert.equal(c2.nets.size, c.nets.size);
  for (const orig of c.nets.values()) {
    const round = [...c2.nets.values()].find((net) => net.id === orig.id);
    assert.ok(round, `net ${orig.id} exists after round-trip`);
    assert.equal(round.length(), orig.length());
    assert.equal(round.name, orig.name);
    assert.deepEqual(
      round.terminals.map((t) => `${t.comp}.${t.term}`).sort(),
      orig.terminals.map((t) => `${t.comp}.${t.term}`).sort()
    );
  }
  // same positions & transforms
  for (const comp of c.components.values()) {
    const rr = c2.getComponent(comp.refdes);
    assert.equal(rr.type, comp.type);
    assert.equal(rr.value, comp.value);
    assert.deepEqual(rr.transform, comp.transform);
    assert.deepEqual(rr.bboxWorld(), comp.bboxWorld());
  }
});

test('fromJSON rejects bad version', () => {
  assert.throws(() => Circuit.fromJSON({ version: 99 }), /unsupported state/);
});
