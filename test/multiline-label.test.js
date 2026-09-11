import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { svgString } from '../src/core/render.js';
import { BlockDiagram } from '../src/core/block-model.js';
import { renderDocument } from '../src/core/document.js';

test('labels preserve multiline text and render each line', () => {
  const circuit = new Circuit();
  const label = circuit.addLabel({ id: 'L1', text: 'first\nsecond', x: 0, y: 0 });

  assert.equal(label.text, 'first\nsecond');
  assert.ok(label.rowHeight() >= 2);
  const svg = svgString(circuit);
  assert.match(svg, /<tspan x="0" dy="0">first<\/tspan><tspan x="0" dy="38">second<\/tspan>/);
});

test('block text also accepts and renders Shift+Enter-style line breaks', () => {
  const diagram = new BlockDiagram();
  diagram.addBlock({ id: 'B1', text: 'first\nsecond', rect: { x: 0, y: 0, w: 240, h: 120 } });
  const svg = renderDocument(diagram);
  assert.match(svg, /<tspan x="120" dy="0">first<\/tspan><tspan x="120" dy="38">second<\/tspan>/);
});
