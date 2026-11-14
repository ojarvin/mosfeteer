import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { loadDocument } from '../src/core/document.js';
import { runCommand } from '../src/core/commands.js';
import { svgString } from '../src/core/render.js';
import { SKETCH_WIDTH, eraseStrokes, normalizeSketch, simplifyStroke, sketchBounds, sketchSvg, strokePath } from '../src/core/sketch.js';

const stroke = (points, color = 'red') => ({ color, width: SKETCH_WIDTH, points: points.map(([x, y]) => ({ x, y })) });

test('a sketch is saved with the design as flat points, left out when empty, and read back', () => {
  const circuit = new Circuit();
  assert.equal('sketch' in circuit.toJSON(), false);
  circuit.sketch.strokes.push(stroke([[0, 0], [10.04, 20.06], [30, 5]], 'blue'));
  const saved = circuit.toJSON().sketch;
  assert.deepEqual(saved, { strokes: [{ color: 'blue', width: SKETCH_WIDTH, points: [0, 0, 10, 20.1, 30, 5] }] });
  const loaded = loadDocument(JSON.parse(JSON.stringify(circuit.toJSON())));
  assert.deepEqual(loaded.sketch.strokes[0].points, [{ x: 0, y: 0 }, { x: 10, y: 20.1 }, { x: 30, y: 5 }]);
});

test('a malformed sketch is read as far as it makes sense, never guessed', () => {
  assert.deepEqual(normalizeSketch(null), { strokes: [] });
  assert.deepEqual(normalizeSketch({ strokes: [null, { points: [] }, { points: ['a', 1] }] }), { strokes: [] });
  const [kept] = normalizeSketch({ strokes: [{ points: [1, 2, 3] }] }).strokes;
  assert.deepEqual(kept, { color: 'red', width: SKETCH_WIDTH, points: [{ x: 1, y: 2 }] });
});

test('a drawn stroke loses its jitter but keeps its corners', () => {
  const wobbly = [];
  for (let x = 0; x <= 100; x += 2) wobbly.push({ x, y: (x % 4 ? 0.4 : -0.4) });
  wobbly.push({ x: 100, y: 100 });
  assert.deepEqual(simplifyStroke(wobbly), [{ x: 0, y: -0.4 }, { x: 100, y: -0.4 }, { x: 100, y: 100 }]);
});

test('a stroke is a smooth marker path; one point is a dot', () => {
  assert.match(strokePath([{ x: 0, y: 0 }]), /^M 0 0 l 0 0$/);
  assert.match(strokePath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 10 }]), /^M 0 0 Q 10 0 15 5 L 20 10$/);
  const layer = sketchSvg({ strokes: [stroke([[0, 0], [40, 0]])] });
  assert.match(layer, /class="sketch-layer" opacity="0.8"/);
  assert.match(layer, /stroke-linecap="round"/);
  assert.equal(sketchSvg({ strokes: [] }), '');
});

test('the eraser removes the strokes its path touches, and only those', () => {
  const sketch = { strokes: [stroke([[0, 0], [100, 0]]), stroke([[0, 200], [100, 200]]), stroke([[300, 300]])] };
  assert.equal(eraseStrokes(sketch, { x: 50, y: -50 }, { x: 50, y: 50 }, 4), 1);
  assert.equal(sketch.strokes.length, 2);
  assert.equal(eraseStrokes(sketch, { x: 300, y: 292 }, { x: 300, y: 292 }, 4), 1);
  assert.equal(eraseStrokes(sketch, { x: 500, y: 500 }, { x: 600, y: 600 }, 4), 0);
  assert.deepEqual(sketch.strokes.map((s) => s.points[0].y), [200]);
});

test('drawn with the sketch, a figure shows its strokes above everything and frames their ink', () => {
  const circuit = new Circuit();
  runCommand(circuit, 'add resistor R1 --at 0 0');
  circuit.sketch.strokes.push(stroke([[0, 0], [600, 400]]));
  const plain = svgString(circuit);
  const sketched = svgString(circuit, { sketch: true });
  assert.ok(!plain.includes('sketch-layer'));
  // Last in the picture: above the parts and labels.
  assert.ok(sketched.indexOf('sketch-layer') > sketched.lastIndexOf('R1'));
  assert.ok(sketched.indexOf('sketch-layer') > sketched.lastIndexOf('data-label-id'));
  const viewBox = (svg) => svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
  const [x, y, w, h] = viewBox(sketched);
  const b = sketchBounds(circuit.sketch);
  assert.ok(x <= b.x && y <= b.y && x + w >= b.x + b.w && y + h >= b.y + b.h, `${viewBox(sketched)} holds ${JSON.stringify(b)}`);
  assert.ok(viewBox(plain)[2] < w);
});

test('sketch counts the strokes and sketch clear removes them; anything else is refused', () => {
  const circuit = new Circuit();
  assert.equal(runCommand(circuit, 'sketch').text, 'the sketch is empty');
  circuit.sketch.strokes.push(stroke([[0, 0]]), stroke([[1, 1]]));
  assert.equal(runCommand(circuit, 'sketch list').text, '2 sketch strokes');
  const cleared = runCommand(circuit, 'sketch clear');
  assert.equal(cleared.text, 'cleared 2 sketch strokes');
  assert.equal(cleared.mutated, true);
  assert.equal(circuit.sketch.strokes.length, 0);
  assert.equal(runCommand(circuit, 'sketch clear').mutated, false);
  assert.throws(() => runCommand(circuit, 'sketch erase'), /unknown sketch command "erase"/);
});
