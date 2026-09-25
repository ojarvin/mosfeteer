import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { svgString } from '../src/core/render.js';

test('labels preserve multiline text and render each line', () => {
  const circuit = new Circuit();
  const label = circuit.addLabel({ id: 'L1', text: 'first\nsecond', x: 0, y: 0 });

  assert.equal(label.text, 'first\nsecond');
  assert.ok(label.rowHeight() >= 2);
  const svg = svgString(circuit);
  assert.match(svg, /<tspan x="0" dy="0">first<\/tspan><tspan x="0" dy="46">second<\/tspan>/);
});
