import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, ComponentInstance, Net, parseTermRef, LabelInstance } from '../src/core/model.js';
import { GRID, snap, onGrid } from '../src/core/grid.js';

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
  assert.equal(c.addComponent('input').refdes, 'I1');
  assert.equal(c.addComponent('output').refdes, 'O1');
  assert.equal(c.addComponent('inputoutput').refdes, 'IO1');
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
  assert.equal(c.addComponent('supply').value, '');
  assert.equal(c.addComponent('output').value, '');
});

test('terminalWorld applies transform and stays on grid', () => {
  const c = new Circuit();
  const r = c.addComponent('resistor', { x: 400, y: 0 });
  assert.deepEqual(r.terminalWorld('a'), { x: 400, y: 0 });
  assert.deepEqual(r.terminalWorld('b'), { x: 560, y: 0 });
});

test('terminalWorld with rotation 90', () => {
  const c = new Circuit();
  const r = c.addComponent('resistor', { x: 400, y: 0, rotation: 90 });
  // local a=(0,0)->(0,0); b=(160,0) rotate 90: (-y,x) -> (0,160) -> translate (400,160)
  assert.deepEqual(r.terminalWorld('a'), { x: 400, y: 0 });
  assert.deepEqual(r.terminalWorld('b'), { x: 400, y: 160 });
});

test('worldTerminals and bboxWorld', () => {
  const c = new Circuit();
  const r = c.addComponent('resistor', { x: 400, y: 0 });
  assert.deepEqual(r.worldTerminals(), [
    { name: 'a', x: 400, y: 0 },
    { name: 'b', x: 560, y: 0 },
  ]);
  assert.deepEqual(r.bboxWorld(), { x: 400, y: -40, w: 160, h: 80 });
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
  const r1 = c.addComponent('resistor', { x: 0, y: 0 });
  const r2 = c.addComponent('resistor', { x: 400, y: 0 });
  const net = c.connect(`${r1.refdes}.a`, `${r2.refdes}.a`);
  assert.ok(net.id.startsWith('N'));
  assert.equal(net.terminalCount(), 2);
  assert.equal(c.nets.size, 1);
});

test('connect merges existing nets into one', () => {
  const c = new Circuit();
  const r1 = c.addComponent('resistor', { x: 0, y: 0 });
  const r2 = c.addComponent('resistor', { x: 400, y: 0 });
  const r3 = c.addComponent('resistor', { x: 800, y: 0 });
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
  const r1 = c.addComponent('resistor', { x: 0, y: 0 });
  const r2 = c.addComponent('resistor', { x: 400, y: 0 });
  const net = c.connect(`${r1.refdes}.a`, `${r2.refdes}.a`);
  const r = net; // remove R1 first so R2 is last
  c.disconnect(`${r1.refdes}.a`);
  const back = c.disconnect(`${r2.refdes}.a`);
  assert.equal(back, net);
  assert.equal(c.nets.size, 0);
});

test('removeComponent sweeps terminals and drops empty nets', () => {
  const c = new Circuit();
  const r1 = c.addComponent('resistor', { x: 0, y: 0 });
  const r2 = c.addComponent('resistor', { x: 400, y: 0 });
  const r3 = c.addComponent('resistor', { x: 800, y: 0 });
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

test('touching pins auto-connect and stay connected when dragged apart', () => {
  const c = new Circuit();
  const m = c.addComponent('nmos', { x: 0, y: 0 }); // s at (120,80)
  const g = c.addComponent('ground', { x: 120, y: 80 }); // gnd lands on M1.s
  const net = c.netOfTerminal(`${g.refdes}.gnd`);
  assert.ok(net, 'dropping a ground on a source connects them');
  assert.equal(net.terminalCount(), 2);
  // dragging the ground apart keeps the net; a wire is routed between the pins
  c.moveComponent(g.refdes, 120, 160);
  assert.equal(c.netOfTerminal(`${g.refdes}.gnd`), net, 'net survives the move');
  assert.ok(net.points().length >= 2, 'wire is drawn between the separated pins');
});

test('net.points routes between terminals', () => {
  const c = new Circuit();
  const r1 = c.addComponent('resistor', { x: 400, y: 0 });
  const r2 = c.addComponent('resistor', { x: 400, y: 120 });
  const net = c.connect(`${r1.refdes}.b`, `${r2.refdes}.a`);
  const pts = net.points();
  assert.ok(pts.length >= 2, 'has points');
  assert.deepEqual(pts[0], { x: 560, y: 0 });
  assert.deepEqual(pts[pts.length - 1], { x: 400, y: 120 });
  for (const p of pts) {
    assert.ok(onGrid(p.x) && onGrid(p.y), `point on grid (${p.x},${p.y})`);
  }
});

test('net.length is the manhattan length of its routed polyline', () => {
  const c = new Circuit();
  const r1 = c.addComponent('resistor', { x: 0, y: 0 });
  const r2 = c.addComponent('resistor', { x: 0, y: 120 });
  const net = c.connect(`${r1.refdes}.b`, `${r2.refdes}.a`);
  const pts = net.points();
  assert.deepEqual(pts[0], { x: 160, y: 0 });
  assert.deepEqual(pts[pts.length - 1], { x: 0, y: 120 });
  let sum = 0;
  for (let i = 1; i < pts.length; i++) sum += Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y);
  assert.equal(net.length(), sum);
  assert.ok(net.length() > 0);
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

// ----- labels -------------------------------------------------

test('addLabel places a standalone label with a grid-aligned anchor', () => {
  const c = new Circuit();
  const l = c.addLabel({ text: 'hello', x: 123, y: 57 });
  assert.ok(l.id);
  assert.equal(l.owner, null);
  assert.deepEqual(l.anchor, { x: 120, y: 40 }, 'anchor snaps to grid');
  const b = l.bbox();
  assert.equal(b.h, 2 * GRID, 'box height is an even (2-cell) grid multiple');
  assert.ok(Number.isInteger(b.w / GRID), `bbox width ${b.w} is a grid multiple`);
  assert.ok(Number.isInteger(b.w / GRID) && b.w / GRID % 2 === 0, `bbox width ${b.w} is an even grid multiple`);
  assert.ok(Number.isInteger(b.x / GRID), `bbox x ${b.x} on grid`);
  // center alignment: the box is centered on the anchor (a grid point)
  assert.equal(b.x + b.w / 2, l.anchor.x);
  assert.equal(b.y + b.h / 2, l.anchor.y);
});

test('label align keeps the box centered and aligns the text inside it', () => {
  const c = new Circuit();
  const l = c.addLabel({ text: 'M1', x: 400, y: 0 });
  // box is always centered on the anchor regardless of align
  const center = l.bbox();
  assert.equal(center.x + center.w / 2, 400, 'center: box centered on anchor');
  assert.equal(center.y + center.h / 2, 0);
  let t = l.textPos();
  assert.equal(t.anchor, 'middle');
  assert.equal(t.x, 400);
  l.setAlign('left');
  const left = l.bbox();
  assert.equal(left.x + left.w / 2, 400, 'left: box still centered on anchor');
  t = l.textPos();
  assert.equal(t.anchor, 'start');
  assert.equal(t.x, left.x, 'left: text starts at the box left edge');
  l.setAlign('right');
  const right = l.bbox();
  assert.equal(right.x + right.w / 2, 400, 'right: box still centered on anchor');
  t = l.textPos();
  assert.equal(t.anchor, 'end');
  assert.equal(t.x, right.x + right.w, 'right: text ends at the box right edge');
});

test('setText resizes the bbox but keeps the anchor fixed', () => {
  const c = new Circuit();
  const l = c.addLabel({ text: 'R', x: 400, y: 0 });
  const w1 = l.bbox().w;
  l.setText('longer');
  const w2 = l.bbox().w;
  assert.ok(w2 >= w1, 'longer text widens the box');
  assert.equal(l.bbox().x + l.bbox().w / 2, 400);
});

test('owned label anchorWorld follows the component transform', () => {
  const c = new Circuit();
  const m1 = c.addComponent('nmos', { x: 400, y: 0 });
  const lab = c.labelOf(m1.refdes);
  assert.ok(lab, 'nmos gets a dedicated instance label');
  assert.equal(lab.text, 'M1');
  assert.equal(lab.owner, m1.refdes);
  // default offset (160,0) transforms to (560,0) at the origin (bulk side, gate height)
  assert.deepEqual(lab.anchorWorld(), { x: 560, y: 0 });
  c.moveComponent(m1.refdes, 560, 80);
  assert.deepEqual(lab.anchorWorld(), { x: 720, y: 80 });
});

test('owned label moveTo translates its local offset, keeping it on grid', () => {
  const c = new Circuit();
  const m1 = c.addComponent('nmos', { x: 400, y: 0 });
  const lab = c.labelOf(m1.refdes);
  lab.moveTo(440, 160);
  assert.deepEqual(lab.anchorWorld(), { x: 440, y: 160 });
  lab.moveTo(95, 82);
  assert.deepEqual(lab.anchorWorld(), { x: 80, y: 80 }, 'offset snaps to grid');
});

test('all component types auto-create an owned instance label for their id', () => {
  const c = new Circuit();
  const r = c.addComponent('resistor', { x: 400, y: 0 });
  assert.equal(c.labels.size, 1);
  const lab = c.labelOf(r.refdes);
  assert.ok(lab, 'resistor gets an owned instance label like every other symbol');
  assert.equal(lab.owner, r.refdes);
  assert.equal(lab.text, r.refdes);
});

test('nextRefdes reuses the smallest available index', () => {
  const c = new Circuit();
  const r1 = c.addComponent('resistor');
  const r2 = c.addComponent('resistor');
  const r3 = c.addComponent('resistor');
  c.removeComponent(r2.refdes);
  assert.equal(c.addComponent('resistor').refdes, 'R2', 'R2 freed, reused next');
  assert.equal(c.addComponent('resistor').refdes, 'R4', 'R3 still in use, so skip to R4');
});

test('removeComponent removes its owned instance label', () => {
  const c = new Circuit();
  const m1 = c.addComponent('nmos', { x: 400, y: 0 });
  assert.equal(c.labels.size, 1);
  const m2 = c.addComponent('pmos', { x: 600, y: 0 });
  assert.equal(c.labels.size, 2);
  c.removeComponent(m1.refdes);
  assert.equal(c.labels.size, 1);
  assert.equal(c.labelOf(m2.refdes)?.owner, m2.refdes);
});

test('labels round-trip through toJSON/fromJSON (standalone and owned)', () => {
  const c = new Circuit();
  const m1 = c.addComponent('nmos', { x: 400, y: 0 });
  c.addLabel({ text: 'test point', x: 280, y: 240, align: 'left' });
  const lab = c.labelOf(m1.refdes);
  lab.moveTo(440, 160); // custom offset

  const c2 = Circuit.fromJSON(JSON.parse(JSON.stringify(c.toJSON())));
  assert.equal(c2.labels.size, 2);
  const owned = [...c2.labels.values()].find((l) => l.owner);
  assert.equal(owned.owner, 'M1');
  assert.equal(owned.text, 'M1');
  assert.deepEqual(owned.anchorWorld(), { x: 440, y: 160 });
  const free = [...c2.labels.values()].find((l) => !l.owner);
  assert.equal(free.text, 'test point');
  assert.equal(free.align, 'left');
  assert.deepEqual(free.anchor, { x: 280, y: 240 });
});

test('fromJSON drops orphaned owned labels (owner missing)', () => {
  const c = new Circuit();
  const m1 = c.addComponent('nmos', { x: 400, y: 0 });
  const data = c.toJSON();
  data.labels[0].owner = 'M99';
  const c2 = Circuit.fromJSON(data);
  assert.equal(c2.labels.size, 0);
});
