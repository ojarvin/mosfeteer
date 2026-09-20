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

test('selection center guides are distinct from the cursor crosshair', () => {
  const overlay = editorOverlay(sampleCircuit(), {
    centerGuides: { x: -80, y: -40, w: 160, h: 80 },
    cursor: { x: 0, y: 40 },
    cursorCrosshair: { x: -100, y: -100, w: 200, h: 200 },
  });
  assert.match(overlay, /selection-center-guides/);
  assert.match(overlay, /stroke="#0ea5e9"/);
  assert.match(overlay, /stroke-dasharray="9 6"/);
  assert.match(overlay, /M 0 -80 L 0 -40 M 0 40 L 0 80 M -120 0 L -80 0 M 80 0 L 120 0/);
});

test('direct and target spacing guides use separate dimension lanes', () => {
  const overlay = editorOverlay(sampleCircuit(), {
    placementGuide: {
      moving: { bbox: { x: 0, y: 0, w: 80, h: 80 } },
      guides: [
        {
          kind: 'spacing', axis: 'x', cells: 8, exact: true,
          points: [
            { id: 'A', x: 0, y: 0, moving: false },
            { id: 'B', x: 320, y: 0, moving: false },
            { id: '__ghost__', x: 640, y: 0, moving: true },
          ],
        },
        {
          kind: 'spacing', direct: true, axis: 'x', cells: 3, exact: true,
          points: [
            { id: 'B', x: 320, y: 0, moving: false },
            { id: '__ghost__', x: 440, y: 0, moving: true },
          ],
        },
      ],
    },
  });
  assert.match(overlay, /M 0 -40 H 320/);
  assert.match(overlay, /M 320 120 H 440/);
});

test('overlay benchmark completes for a typical interaction burst', () => {
  const circuit = sampleCircuit();
  const start = performance.now();
  for (let i = 0; i < 500; i++) editorOverlay(circuit, { cursor: { x: i % 40, y: 0 } });
  assert.ok(performance.now() - start < 2000);
});
