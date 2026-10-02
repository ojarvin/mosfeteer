import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { addBoxAround, boxAroundRect } from '../src/core/wrap-box.js';

const run = (circuit, ...lines) => lines.map((line) => runCommand(circuit, line));

test('a box frames what the parts, their labels, and nets draw', () => {
  const circuit = new Circuit();
  run(circuit, 'add resistor R1 --at 0 0', 'add resistor R2 --at 400 0', 'connect R1.b R2.a');
  // R1 alone: its strokes and its label's text, at least half a cell clear.
  const ink = [circuit.components.get('R1').inkRectWorld(), circuit.labelOf('R1').inkRect()];
  const rect = boxAroundRect(circuit, { refs: ['R1'] });
  for (const v of Object.values(rect)) assert.ok(v % 40 === 0, `${v} on the grid`);
  const x0 = Math.min(...ink.map((r) => r.x));
  const y0 = Math.min(...ink.map((r) => r.y));
  const x1 = Math.max(...ink.map((r) => r.x + r.w));
  const y1 = Math.max(...ink.map((r) => r.y + r.h));
  for (const gap of [x0 - rect.x, y0 - rect.y, rect.x + rect.w - x1, rect.y + rect.h - y1]) assert.ok(gap >= 20 && gap < 60, `gap ${gap}`);
  // Not the label's grid box: that would reach further than its text.
  assert.ok(rect.y > circuit.labelOf('R1').bbox().y - 40);
  // Both parts and their wire.
  const net = circuit.netOfTerminal({ comp: 'R1', term: 'b' });
  const both = boxAroundRect(circuit, { refs: ['R1', 'R2'], netIds: [net.id] });
  assert.ok(both.x <= rect.x && both.x + both.w > 400 + 80);
  assert.equal(boxAroundRect(circuit, {}), null);
  assert.throws(() => addBoxAround(circuit, {}), /nothing to put a box around/);
});

test('box wraps named objects in a captioned dashed box', () => {
  const circuit = new Circuit();
  run(circuit, 'add nmos M1 --at 0 0', 'add nmos M2 --at 400 0');
  const [out] = run(circuit, 'box M1 M2 --text "input pair"');
  assert.equal(out.mutated, true);
  const box = circuit.labels.get(out.json.id);
  assert.equal(box.kind, 'box');
  assert.equal(box.style.lineStyle, 'dashed');
  const caption = [...circuit.labels.values()].find((label) => label.parent === box.id);
  assert.equal(caption.text, 'input pair');
  for (const ref of ['M1', 'M2']) {
    const r = circuit.components.get(ref).bboxWorld();
    assert.ok(r.x > box.anchor.x && r.x + r.w < box.end.x && r.y > box.anchor.y && r.y + r.h < box.end.y, ref);
  }
  assert.throws(() => runCommand(circuit, 'box NOPE'), /"NOPE" is not a part, net, or label/);
  assert.throws(() => runCommand(circuit, 'box'), /usage: box/);
});

test('a selected wire segment boxes only itself, not the rest of its net', () => {
  const circuit = new Circuit();
  run(circuit, 'add resistor R1 --at 0 0', 'add resistor R2 --at 1200 1200', 'connect R1.b R2.a');
  const net = circuit.netOfTerminal({ comp: 'R1', term: 'b' });
  // The segment nearest R1, as a marquee around R1 picks it.
  const segments = net.paths().flatMap((path, branch) => path.slice(1).map((p, i) => ({ branch, segment: i + 1, a: path[i], b: p })));
  const near = segments.reduce((best, s) => (Math.max(s.a.x + s.a.y, s.b.x + s.b.y) < Math.max(best.a.x + best.a.y, best.b.x + best.b.y) ? s : best));
  const rect = boxAroundRect(circuit, { refs: ['R1'], wires: [{ netId: net.id, branch: near.branch, segment: near.segment }] });
  for (const p of [near.a, near.b]) assert.ok(p.x > rect.x && p.x < rect.x + rect.w && p.y > rect.y && p.y < rect.y + rect.h, 'frames the segment');
  assert.ok(rect.x + rect.w < 1200 && rect.y + rect.h < 1200, `not R2's end of the net (${JSON.stringify(rect)})`);
});
