import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { editorOverlay, svgString } from '../src/core/render.js';

function sampleCircuit() {
  const c = new Circuit();
  const a = c.addComponent('resistor', { x: 0, y: 0 });
  const b = c.addComponent('resistor', { x: 320, y: 0 });
  c.connect(`${a.refdes}.a`, `${b.refdes}.b`);
  return c;
}

test('interaction overlays render without rebuilding committed markup', () => {
  const circuit = sampleCircuit();
  const committed = svgString(circuit, { viewport: { x: -400, y: -200, w: 800, h: 400 } });
  const before = committed;
  for (let i = 0; i < 100; i++) {
    const overlay = editorOverlay(circuit, { cursor: { x: i, y: i } });
    assert.match(overlay, /<circle/);
  }
  assert.equal(committed, before);
});

test('cursor crosshair belongs to the interaction overlay', () => {
  const overlay = editorOverlay(sampleCircuit(), {
    cursor: { x: 0, y: 40 },
    cursorCrosshair: { x: -100, y: -100, w: 200, h: 200 },
  });
  assert.match(overlay, /editor-cursor-crosshair/);
});

test('overlay benchmark completes for a typical interaction burst', () => {
  const circuit = sampleCircuit();
  const start = performance.now();
  for (let i = 0; i < 500; i++) editorOverlay(circuit, { cursor: { x: i % 40, y: 0 } });
  assert.ok(performance.now() - start < 2000);
});
