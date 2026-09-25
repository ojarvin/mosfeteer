import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { evaluate } from '../src/core/commands.js';
import { editorOverlay, svgString } from '../src/core/render.js';
import { moveAnnotationEndpoint } from '../src/web/interaction.js';
import { GRID } from '../src/core/grid.js';

test('schematic block exposes perimeter pins, centered value text, and no dangling-pin error', () => {
  const circuit = new Circuit();
  const block = circuit.addComponent('block', { refdes: 'B1', value: 'FVF', x: 0, y: 0 });
  assert.equal(block.def.terminals.length, 12);
  assert.deepEqual(block.worldTerminals().map(({ x, y }) => `${x},${y}`), [
    '-40,-80', '40,-80', '80,-40', '80,40', '40,80', '-40,80', '-80,40', '-80,-40',
    '0,-80', '80,0', '0,80', '-80,0',
  ]);
  const report = evaluate(circuit);
  assert.equal(report.ok, true);
  assert.deepEqual(report.unconnectedTerminals, []);
  assert.match(svgString(circuit), /font-size="46"[^>]*>FVF<\/text>/);
  assert.doesNotMatch(svgString(circuit, { terminals: false, junctions: false }), /<circle/);
  const wireOverlay = editorOverlay(circuit, { wireMode: true });
  assert.equal((wireOverlay.match(/cx="0" cy="-80"/g) || []).length, 1);
});

test('schematic block captions preserve block-style multiline text', () => {
  const circuit = new Circuit();
  circuit.addComponent('block', { refdes: 'B1', value: 'Gain\nstage', x: 0, y: 0 });
  const svg = svgString(circuit);
  assert.match(svg, /<tspan x="0" dy="-23">Gain<\/tspan>/);
  assert.match(svg, /<tspan x="0" dy="46">stage<\/tspan>/);
});

test('schematic blocks remain part of component overlap checks', () => {
  const circuit = new Circuit();
  circuit.addComponent('block', { refdes: 'B1', x: 0, y: 0 });
  circuit.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  circuit.addLabel({ text: 'overlap', x: 0, y: 0 });
  const report = evaluate(circuit);
  assert.equal(report.overlappingBBoxes.length, 1);
  assert.ok(report.labelComponentOverlaps.some((message) => /B1\(block\)/.test(message)));
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((issue) => issue.kind === 'component-overlap'));
});

test('schematic block terminals connect with ordinary outward-routed wires', () => {
  const circuit = new Circuit();
  const block = circuit.addComponent('block', { refdes: 'B1', x: 0, y: 0 });
  const resistor = circuit.addComponent('resistor', { refdes: 'R1', x: 320, y: 0 });
  // The path leaves the perimeter pin in its outward direction. It has no
  // connector arrowhead and does not cross the block body.
  circuit.wireDirectTo(`${block.refdes}.T3`, `${resistor.refdes}.a`, [{ x: 160, y: -40 }]);
  const report = evaluate(circuit);
  assert.deepEqual(report.wireThroughBBoxes, []);
  assert.doesNotMatch(svgString(circuit), /<polygon/);
});

test('schematic block edge midpoint terminals are wireable', () => {
  const circuit = new Circuit();
  const block = circuit.addComponent('block', { refdes: 'B1', x: 0, y: 0 });
  const resistor = circuit.addComponent('resistor', { refdes: 'R1', x: 0, y: -320 });
  circuit.connect('B1.T9', 'R1.a');
  assert.deepEqual(block.terminalWorld('T9'), { x: 0, y: -80 });
  assert.equal(circuit.netOfTerminal('B1.T9')?.terminals.some((t) => t.comp === 'B1' && t.term === 'T9'), true);
});

test('resizing a schematic block materializes new perimeter terminals', () => {
  const circuit = new Circuit();
  const block = circuit.addComponent('block', { refdes: 'B1', x: 0, y: 0 });
  assert.equal(block.worldTerminals().length, 12);
  block.setBlockSize({ w: 240, h: 240 });
  assert.equal(block.worldTerminals().length, 20);
  assert.ok(block.worldTerminals().some(({ name, x, y }) => name === 'T13' && x === 0 && y === 120));
});

test('schematic blocks resize from a world rectangle and preserve connected terminal identity', () => {
  const circuit = new Circuit();
  const block = circuit.addComponent('block', { refdes: 'B1', x: 0, y: 0 });
  const resistor = circuit.addComponent('resistor', { refdes: 'R1', x: 320, y: 0 });
  circuit.connect('B1.T3', 'R1.a');
  const net = circuit.netOfTerminal('B1.T3');
  circuit.resizeBlock('B1', { x: -80, y: -80, w: 240, h: 240 });
  assert.deepEqual(block.bboxWorld(), { x: -80, y: -80, w: 240, h: 240 });
  assert.ok(block.localTerminal('T3'));
  assert.equal(circuit.netOfTerminal('B1.T3').id, net.id);
  assert.deepEqual(evaluate(circuit).wireThroughBBoxes, []);
  const restored = Circuit.fromJSON(circuit.toJSON());
  assert.deepEqual(restored.components.get('B1').bboxWorld(), { x: -80, y: -80, w: 240, h: 240 });
  assert.ok(restored.components.get('B1').localTerminal('T3'));
  assert.match(svgString(restored), /<rect x="-120" y="-120" width="240" height="240"/);
});

test('schematic block resize preserves occupied perimeter positions and clamps shrinking edges', () => {
  const circuit = new Circuit();
  const block = circuit.addComponent('block', { refdes: 'B1', x: 0, y: 0 });
  const resistor = circuit.addComponent('resistor', { refdes: 'R1', x: 80, y: -320 });
  const net = circuit.connect('B1.T9', 'R1.a');

  assert.deepEqual(block.terminalWorld('T9'), { x: 0, y: -80 });
  circuit.resizeBlock('B1', { x: -160, y: -80, w: 240, h: 160 });
  assert.deepEqual(block.bboxWorld(), { x: -160, y: -80, w: 240, h: 160 });
  assert.deepEqual(block.terminalWorld('T9'), { x: 0, y: -80 });
  assert.deepEqual(net.paths()[0][0], { x: 0, y: -80 });

  // The clamp stops the left edge one cell short of the pin at x=0; the odd
  // span that leaves grows back out to an even one on the moved side.
  circuit.resizeBlock('B1', { x: 0, y: -80, w: 80, h: 160 });
  assert.deepEqual(block.bboxWorld(), { x: -80, y: -80, w: 160, h: 160 });
  assert.deepEqual(block.terminalWorld('T9'), { x: 0, y: -80 });
  assert.deepEqual(net.paths()[0][0], { x: 0, y: -80 });
});

test('arrow annotations preserve authored intermediate vertices and render the head on the final leg', () => {
  const circuit = new Circuit();
  const arrow = circuit.addAnnotation('arrow', {
    points: [{ x: 0, y: 0 }, { x: 0, y: 160 }, { x: 240, y: 160 }],
    text: 'loop',
  });
  assert.deepEqual(arrow.points, [{ x: 0, y: 0 }, { x: 0, y: 160 }, { x: 240, y: 160 }]);
  const restored = Circuit.fromJSON(circuit.toJSON());
  assert.deepEqual(restored.labels.get(arrow.id).points, arrow.points);
  const svg = svgString(restored);
  assert.match(svg, /M 0 0 L 0 160 L 208 160/);
  const child = [...restored.labels.values()].find((label) => label.parent === arrow.id);
  assert.deepEqual(child.anchor, { x: 0, y: -40 });
});

test('arrow vertices move and edit as a path, including intermediate corners', () => {
  const circuit = new Circuit();
  const arrow = circuit.addAnnotation('arrow', {
    points: [{ x: 0, y: 0 }, { x: 0, y: 160 }, { x: 240, y: 160 }],
  });
  arrow.moveTo(80, 80);
  assert.deepEqual(arrow.points, [{ x: 80, y: 80 }, { x: 80, y: 240 }, { x: 320, y: 240 }]);
  assert.equal(moveAnnotationEndpoint(arrow, 'vertex:1', { x: 160, y: 240 }), true);
  assert.deepEqual(arrow.points[1], { x: 160, y: 240 });
  assert.deepEqual(arrow.anchor, arrow.points[0]);
  assert.deepEqual(arrow.end, arrow.points.at(-1));
});

test('blocks and box annotations share the eight resize handles; arrow vertices show drag points', () => {
  const circuit = new Circuit();
  circuit.addComponent('block', { refdes: 'B1', x: 0, y: 0 });
  const box = circuit.addAnnotation('box', { x: 200, y: 0, end: { x: 360, y: 120 } });
  const arrow = circuit.addAnnotation('arrow', { points: [{ x: 0, y: 200 }, { x: 0, y: 280 }, { x: 160, y: 280 }] });
  const overlay = editorOverlay(circuit, { resizeBlocks: ['B1'], resizeBoxes: [box.id], selLabels: [box.id, arrow.id] });
  assert.match(overlay, /data-resize-kind="component" data-resize-id="B1"/);
  assert.match(overlay, new RegExp(`data-resize-kind="annotation" data-resize-id="${box.id}"`));
  assert.equal((overlay.match(/data-resize-handle=/g) || []).length, 16);
  assert.match(overlay, /data-resize-handle="e"[^>]*><rect x="346" y="46" width="28" height="28"/);
  // Handles keep their screen size: at 2 world units per pixel they double.
  const zoomedOut = editorOverlay(circuit, { resizeBoxes: [box.id], handleScale: 2 });
  assert.match(zoomedOut, /data-resize-handle="e"[^>]*><rect x="332" y="32" width="56" height="56"/);
  assert.equal((overlay.match(/class="annotation-vertex-handle"/g) || []).length, 3);

  const hovered = editorOverlay(circuit, { hoverAnnotation: arrow.id });
  assert.equal((hovered.match(/class="annotation-vertex-handle"[^>]*fill="var\(--paper/g) || []).length, 3);
});

test('resizing a box keeps its child labels in place relative to the box', () => {
  const circuit = new Circuit();
  const box = circuit.addAnnotation('box', { x: 0, y: 0, end: { x: 400, y: 200 }, text: 'Bias' });
  const title = [...circuit.labels.values()].find((label) => label.parent === box.id);
  const title0 = { ...title.anchor };
  const centered = circuit.addLabel({ text: 'mid', parent: box.id, x: 200, y: 80 });
  const corner = circuit.addLabel({ text: 'c', parent: box.id, x: 360, y: 160 });

  assert.equal(box.resizeBox({ x: -80, y: 0, w: 640, h: 360 }), true);
  assert.deepEqual([box.anchor, box.end], [{ x: -80, y: 0 }, { x: 560, y: 360 }]);
  // The title above the top edge keeps its offset from the top center.
  assert.deepEqual(title.anchor, { x: title0.x + 40, y: title0.y });
  // Near-center text stays near the center; corner text keeps its corner gap.
  assert.deepEqual(centered.anchor, { x: 240, y: 160 });
  assert.deepEqual(corner.anchor, { x: 520, y: 320 });

  // Shrinking never pushes an inside label out of the box.
  box.resizeBox({ x: 0, y: 0, w: 40, h: 40 });
  assert.ok(corner.anchor.x <= 40 && corner.anchor.y <= 40);
  assert.equal(box.resizeBox({ x: 0, y: 0, w: 0, h: 40 }), false);
});

test('block sizes are even cell counts, keeping the center and every pin on the grid', () => {
  const circuit = new Circuit();
  const block = circuit.addComponent('block', { refdes: 'B1', x: 0, y: 0, width: 120, height: 200 });
  assert.deepEqual(block.blockSize, { w: 160, h: 240 });
  circuit.resizeBlock('B1', { x: -80, y: -80, w: 160, h: 120 });
  assert.deepEqual(block.bboxWorld(), { x: -80, y: -120, w: 160, h: 160 });
  circuit.resizeBlock('B1', { x: -120, y: -80, w: 200, h: 160 });
  assert.deepEqual(block.bboxWorld(), { x: -160, y: -80, w: 240, h: 160 });
  const onGrid = (v) => v % GRID === 0;
  assert.ok(onGrid(block.transform.x) && onGrid(block.transform.y));
  assert.ok(block.worldTerminals().every(({ x, y }) => onGrid(x) && onGrid(y)));

  // A saved odd size loads as authored rather than moving its edges.
  const legacy = circuit.toJSON();
  legacy.components.find((c) => c.refdes === 'B1').blockSize = { w: 240, h: 120 };
  assert.deepEqual(Circuit.fromJSON(legacy).components.get('B1').blockSize, { w: 240, h: 120 });
});
