import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { evaluate } from '../src/core/commands.js';
import { editorOverlay, svgString } from '../src/core/render.js';
import { moveAnnotationEndpoint } from '../src/web/interaction.js';

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
  assert.match(svgString(circuit), /font-size="38"[^>]*>FVF<\/text>/);
  assert.doesNotMatch(svgString(circuit, { terminals: false, junctions: false }), /<circle/);
  const wireOverlay = editorOverlay(circuit, { wireMode: true });
  assert.equal((wireOverlay.match(/cx="0" cy="-80"/g) || []).length, 1);
});

test('schematic block captions preserve block-style multiline text', () => {
  const circuit = new Circuit();
  circuit.addComponent('block', { refdes: 'B1', value: 'Gain\nstage', x: 0, y: 0 });
  const svg = svgString(circuit);
  assert.match(svg, /<tspan x="0" dy="-19">Gain<\/tspan>/);
  assert.match(svg, /<tspan x="0" dy="38">stage<\/tspan>/);
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

  circuit.resizeBlock('B1', { x: 0, y: -80, w: 80, h: 160 });
  assert.deepEqual(block.bboxWorld(), { x: -40, y: -80, w: 120, h: 160 });
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
