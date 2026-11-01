import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { svgString } from '../src/core/render.js';
import { fanStacks, joinSegments, stackOutline, wireEchoes } from '../src/core/box-stack.js';

const run = (circuit, ...lines) => lines.map((line) => runCommand(circuit, line));
const key = (s) => `${s.a.x},${s.a.y}-${s.b.x},${s.b.y}`;

/** Two gains, each in a box, A1.out wired to A2.in. */
function pair() {
  const circuit = new Circuit();
  run(circuit, 'add gain A1 --at 0 0', 'add gain A2 --at 480 0', 'connect A1.out A2.in');
  const [one, two] = run(circuit, 'box A1', 'box A2').map((out) => circuit.labels.get(out.json.id));
  return { circuit, one, two, net: circuit.netOfTerminal({ comp: 'A1', term: 'out' }) };
}

test('a stacked box draws each copy where the nearer ones leave it showing', () => {
  const rect = { x: 0, y: 0, w: 200, h: 100 };
  const one = stackOutline(rect, { copies: 1, dx: 20, dy: -20 }).map(key).sort();
  assert.deepEqual(one, ['20,-20-220,-20', '220,-20-220,80', '220,80-200,80', '20,0-20,-20'].sort());
  // Each copy's pieces lie outside every copy in front of it.
  const copies = [0, 1, 2, 3].map((k) => ({ x: 20 * k, y: -20 * k, w: 200, h: 100 }));
  const onEdge = (p, r) => (p.x === r.x || p.x === r.x + r.w) ? p.y >= r.y && p.y <= r.y + r.h : (p.y === r.y || p.y === r.y + r.h) && p.x >= r.x && p.x <= r.x + r.w;
  const strictlyIn = (p, r) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
  const three = stackOutline(rect, { copies: 3, dx: 20, dy: -20 });
  assert.equal(three.length, 12);
  // Drawn as one stroke per copy, so its corners join.
  const lines = joinSegments(three);
  assert.equal(lines.length, 3);
  for (const line of lines) assert.equal(line.length, 5);
  for (const s of three) {
    const mid = { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 };
    const k = copies.findIndex((r, i) => i > 0 && onEdge(s.a, r) && onEdge(s.b, r));
    assert.ok(k > 0, `${key(s)} on a copy`);
    for (const r of copies.slice(0, k)) assert.ok(!strictlyIn(mid, r), `${key(s)} under a nearer copy`);
  }
});

test('annotation stack stacks a plain box, saves it, frames it, and takes it off', () => {
  const { circuit, one } = pair();
  const before = circuit.inkBounds();
  const [out] = run(circuit, `annotation stack ${one.id} 3`);
  assert.equal(out.mutated, true);
  assert.match(out.text, /stacked, 3 copies 20,-20 apart/);
  assert.deepEqual(one.stack, { copies: 3, dx: 20, dy: -20 });
  const after = circuit.inkBounds();
  assert.equal(after.y, before.y - 60, 'the copies reach three steps up');
  assert.deepEqual(Circuit.fromJSON(circuit.toJSON()).labels.get(one.id).stack, one.stack);
  assert.match(svgString(circuit, {}), /class="box-stack"/);
  // The step stays when the count changes.
  run(circuit, `annotation stack ${one.id} 2 --offset 40,40`, `annotation stack ${one.id} 4`);
  assert.deepEqual(one.stack, { copies: 4, dx: 40, dy: 40 });
  assert.equal(run(circuit, `annotation stack ${one.id} 4`)[0].mutated, false);
  run(circuit, `annotation stack ${one.id} off`);
  assert.equal(one.stack, null);
  assert.equal('stack' in circuit.labels.get(one.id).toJSON(), false);
});

test('annotation stack refuses what is not a plain box or a stack', () => {
  const { circuit, one } = pair();
  run(circuit, 'annotation add N1 note 0 400');
  assert.throws(() => run(circuit, 'annotation stack N1 3'), /"N1" is not a plain box/);
  assert.throws(() => run(circuit, 'annotation stack nope 3'), /usage: annotation stack BOX N\|off/);
  assert.throws(() => run(circuit, `annotation stack ${one.id} 0`), /1 to 8 copies/);
  assert.throws(() => run(circuit, `annotation stack ${one.id} 3 --offset 0,0`), /step is not zero/);
  assert.throws(() => run(circuit, `annotation stack ${one.id} 3 --offset 200,0`), /at most 80/);
  assert.equal(one.stack, null, 'a refused stack changes nothing');
});

test('a wire between stacks of one step is repeated per copy, up to the nearer copies', () => {
  const { circuit, one, two, net } = pair();
  run(circuit, `annotation stack ${one.id} 3`, `annotation stack ${two.id} 3`);
  const echoes = wireEchoes(circuit, net.paths());
  assert.equal(echoes.length, 3);
  const right = one.anchor.x < one.end.x ? one.end.x : one.anchor.x;
  const left = Math.min(two.anchor.x, two.end.x);
  echoes.forEach((echo, i) => {
    const k = i + 1;
    assert.equal(echo.points[0].x, right + 20 * k, 'from its own copy\'s edge');
    assert.equal(echo.points.at(-1).x, left, 'to the front box, which covers the rest');
    assert.equal(echo.points[0].y, -20 * k);
  });
  assert.equal((svgString(circuit, {}).match(/class="wire-echo"/g) || []).length, 3);
  // Stacks of other steps, or one stack alone, repeat nothing.
  run(circuit, `annotation stack ${two.id} 2`);
  assert.equal(wireEchoes(circuit, net.paths()).length, 0);
  run(circuit, `annotation stack ${two.id} off`);
  assert.equal(wireEchoes(circuit, net.paths()).length, 0, 'a wire into a part is not repeated');
});

test('a wire from a stack to a free end is repeated to its end', () => {
  const { circuit, two } = pair();
  run(circuit, `annotation stack ${two.id} 2`, 'stubs A2');
  const stub = circuit.netOfTerminal({ comp: 'A2', term: 'out' });
  const echoes = wireEchoes(circuit, stub.paths());
  assert.equal(echoes.length, 2);
  const end = stub.paths()[0].at(-1);
  echoes.forEach((echo, i) => {
    assert.deepEqual(echo.points.at(-1), { x: end.x + 20 * (i + 1), y: end.y - 20 * (i + 1) });
    assert.equal(echo.end, true, 'it keeps the end\'s arrowhead');
  });
  assert.ok(circuit.inkBounds().x + circuit.inkBounds().w >= end.x + 40, 'the repeats are framed');
});

/** A gain turned to take its input from above, in a box, fed by VIN. */
function fedFromAbove() {
  const circuit = new Circuit();
  run(circuit, 'add gain A1 --at 0 0 --rot 90', 'add port VIN --at 0 -440', 'connect VIN.p A1.in', 'add gain A2 --at 480 0', 'connect A1.out A2.in');
  const box = circuit.labels.get(run(circuit, 'box A1 --text "8x Sub-ADC"')[0].json.id);
  return { circuit, box, input: circuit.netOfTerminal({ comp: 'A1', term: 'in' }), output: circuit.netOfTerminal({ comp: 'A1', term: 'out' }) };
}

test('stacking turns a dashed box solid and keeps its caption above the stack', () => {
  const { circuit, box } = fedFromAbove();
  const caption = [...circuit.labels.values()].find((label) => label.parent === box.id);
  const under = (top) => caption.bbox().y + caption.bbox().h <= top;
  assert.equal(box.style.lineStyle, 'dashed');
  run(circuit, `annotation stack ${box.id} 3`);
  assert.equal(box.style.lineStyle, 'solid');
  assert.ok(under(box.bbox().y - 60), 'above the third copy');
  run(circuit, `annotation stack ${box.id} off`);
  assert.equal(box.style.lineStyle, 'solid', 'unstacking leaves the style');
  assert.ok(under(box.bbox().y) && !under(box.bbox().y - 40), 'back against the box');
});

test('a wire into a stack fans into it', () => {
  const { circuit, box, input, output } = fedFromAbove();
  run(circuit, `annotation stack ${box.id} 3`);
  assert.deepEqual(fanStacks(circuit, input.paths()), [box]);
  assert.deepEqual(fanStacks(circuit, output.paths()), [box]);
  run(circuit, 'add port P8 --at 800 800', 'add port P9 --at 1200 800', 'connect P8.p P9.p');
  assert.throws(() => run(circuit, `net ${circuit.netOfTerminal({ comp: 'P9', term: 'p' }).id} fan ${box.id} on`), /does not enter/);
  assert.throws(() => run(circuit, `net ${input.id} fan nope on`), /usage: net <id> fan BOX on\|off/);
  const [out] = run(circuit, `net ${input.id} fan ${box.id} on`);
  assert.equal(out.mutated, true);
  const top = box.bbox().y;
  const x = input.paths()[0].find((p) => p.y === top)?.x ?? 0;
  const fan = wireEchoes(circuit, input.paths(), undefined, input.fans);
  // A wire into each copy from the diagonal a cell past the third, the
  // last turning one corner into it.
  assert.equal(fan.length, 3);
  for (let k = 1; k <= 2; k++) assert.deepEqual(fan[k - 1].points, [{ x: x + 20 * k, y: top - 100 - 20 * k }, { x: x + 20 * k, y: top - 20 * k }]);
  assert.deepEqual(fan[2].points, [{ x: x + 60, y: top - 60 }, { x: x + 60, y: top - 160 }, { x, y: top - 100 }]);
  assert.ok(fan.every((line) => line.fan));
  assert.match(svgString(circuit, {}), /class="wire-echo"/);
  // Saved with the net; the caption keeps clear of it.
  assert.deepEqual(Circuit.fromJSON(circuit.toJSON()).netOfTerminal({ comp: 'A1', term: 'in' }).fans, [box.id]);
  const caption = [...circuit.labels.values()].find((label) => label.parent === box.id).inkRect();
  for (const { points: [a, b] } of fan) assert.ok(Math.max(a.x, b.x) < caption.x || Math.min(a.x, b.x) > caption.x + caption.w || Math.max(a.y, b.y) < caption.y || Math.min(a.y, b.y) > caption.y + caption.h, 'the caption clears the fan');
  run(circuit, `net ${input.id} fan ${box.id} off`);
  assert.deepEqual(input.fans, []);
});

test('a wire out of the side the copies hide behind fans from the front box', () => {
  const circuit = new Circuit();
  run(circuit, 'add gain A1 --at 0 0 --rot 90', 'add port OUT --at -40 480', 'connect A1.out OUT.p');
  const box = circuit.labels.get(run(circuit, 'box A1')[0].json.id);
  const output = circuit.netOfTerminal({ comp: 'A1', term: 'out' });
  run(circuit, `annotation stack ${box.id} 3`, `net ${output.id} fan ${box.id} on`);
  const bottom = box.bbox().y + box.bbox().h;
  const x = 0;
  const run_ = 100;
  const fan = wireEchoes(circuit, output.paths(), undefined, output.fans);
  assert.equal(fan.length, 3);
  // Each copy's wire shows down from the front box, which covers the rest.
  for (let k = 1; k <= 2; k++) assert.deepEqual(fan[k - 1].points, [{ x: x + 20 * k, y: bottom + run_ - 20 * k }, { x: x + 20 * k, y: bottom }]);
  // The diagonal runs back toward the box, its far end still a cell clear.
  assert.deepEqual(fan[2].points, [{ x: x + 60, y: bottom }, { x: x + 60, y: bottom + run_ - 60 }, { x, y: bottom + run_ }]);
  assert.equal(bottom + run_ - 60, bottom + 40);
});
