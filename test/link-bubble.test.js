import test from 'node:test';
import assert from 'node:assert/strict';
import { GRID } from '../src/core/grid.js';
import { bubbleAt, bubbleOffset, layoutBubbles } from '../src/core/link-bubble.js';

const drawing = { x: 0, y: 0, w: 1600, h: 800 };
const disjoint = (a, b) => a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
const slope = ([a, b]) => Math.abs(Math.sin(2 * Math.atan2(b.y - a.y, b.x - a.x)));

test('a bubble sits on a ring outside the drawing, its connector running diagonally', () => {
  const part = { x: 1400, y: 360, w: 80, h: 80 };
  const [bubble] = layoutBubbles(drawing, [{ id: 'OA1', part, size: { w: 600, h: 400 } }]);
  assert.ok(disjoint(bubble.frame, drawing), 'clear of the drawing');
  assert.ok(slope(bubble.connector) > 0.6, `diagonal enough (${slope(bubble.connector)})`);
  // The connector leaves the part's outline and ends on the frame.
  const [from, to] = bubble.connector;
  assert.ok(from.x >= part.x && from.x <= part.x + part.w && from.y >= part.y && from.y <= part.y + part.h);
  const f = bubble.frame;
  assert.ok(to.x === f.x || to.x === f.x + f.w || to.y === f.y || to.y === f.y + f.h);
  assert.ok(bubble.image.x >= f.x && bubble.image.x + bubble.image.w <= f.x + f.w && bubble.image.y + bubble.image.h <= f.y + f.h);
  assert.equal(bubbleAt([bubble], { x: f.x + 10, y: f.y + 10 }), bubble);
  assert.equal(bubbleAt([bubble], { x: 0, y: 0 }), null);
});

test('a connector keeps off the wires and parts it could run along', () => {
  const part = { x: 760, y: 360, w: 80, h: 80 };
  // Wires fanning out from the part along both axes and both diagonals'
  // neighbours: the chosen connector runs along none of them.
  const segments = [
    [{ x: 840, y: 400 }, { x: 1600, y: 400 }], [{ x: 0, y: 400 }, { x: 760, y: 400 }],
    [{ x: 800, y: 0 }, { x: 800, y: 360 }], [{ x: 800, y: 440 }, { x: 800, y: 800 }],
  ];
  const rects = [{ x: 1000, y: 100, w: 200, h: 200 }];
  const [bubble] = layoutBubbles(drawing, [{ id: 'X', part, size: { w: 400, h: 300 } }], { obstacles: { rects, segments } });
  const [from, to] = bubble.connector;
  assert.ok(slope(bubble.connector) > 0.5);
  for (const [a, b] of segments) {
    const horizontal = a.y === b.y;
    assert.ok(!(horizontal ? from.y === a.y && to.y === a.y : from.x === a.x && to.x === a.x), 'not along a wire');
  }
});

test('bubbles never overlap each other, and keep their angle while it is about as good', () => {
  const requests = [
    { id: 'A', part: { x: 1400, y: 360, w: 80, h: 80 }, size: { w: 400, h: 400 } },
    { id: 'B', part: { x: 1400, y: 440, w: 80, h: 80 }, size: { w: 400, h: 400 } },
    { id: 'C', part: { x: 100, y: 100, w: 80, h: 80 }, size: { w: 400, h: 400 } },
  ];
  const bubbles = layoutBubbles(drawing, requests);
  for (const a of bubbles) for (const b of bubbles) if (a !== b) assert.ok(disjoint(a.frame, b.frame));
  for (const bubble of bubbles) assert.ok(disjoint(bubble.frame, drawing));
  const again = layoutBubbles(drawing, requests.map((r) => (r.id === 'A' ? { ...r, part: { ...r.part, x: r.part.x + GRID } } : r)),
    { previous: new Map(bubbles.map((b) => [b.id, b.angle])) });
  assert.equal(again.find((b) => b.id === 'A').angle, bubbles.find((b) => b.id === 'A').angle);
});

test('a connector does not run through another bubble', () => {
  const requests = [
    { id: 'A', part: { x: 1200, y: 600, w: 80, h: 80 }, size: { w: 800, h: 600 } },
    { id: 'B', part: { x: 400, y: 600, w: 80, h: 80 }, size: { w: 200, h: 200 } },
  ];
  const bubbles = layoutBubbles(drawing, requests);
  const cut = (seg, r) => {
    const [a, b] = seg;
    for (let t = 0.02; t < 0.98; t += 0.02) {
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h) return true;
    }
    return false;
  };
  for (const a of bubbles) for (const b of bubbles) if (a !== b) assert.ok(!cut(a.connector, b.frame), `${a.id} runs through ${b.id}`);
});

test('bubbles export as vector drawing: the design nested whole, the frame widening the export', async () => {
  const { bubbleExtras } = await import('../src/core/link-bubble.js');
  const { Circuit } = await import('../src/core/model.js');
  const { svgString } = await import('../src/core/render.js');
  const child = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-40 -40 400 200"><path d="M 0 0 L 80 0" data-child="yes"/></svg>';
  const [bubble] = layoutBubbles(drawing, [{ id: 'OA1', part: { x: 1400, y: 360, w: 80, h: 80 }, size: { w: 400, h: 200 } }]);
  const extras = bubbleExtras([{ ...bubble, name: 'amp & co', svg: child, box: { x: -40, y: -40, w: 400, h: 200 } }]);
  assert.deepEqual(extras.bounds, [bubble.frame]);
  assert.match(extras.svg, /<svg x="[\d.-]+" y="[\d.-]+" width="400" height="200" viewBox="-40 -40 400 200" overflow="visible"><path d="M 0 0 L 80 0" data-child="yes"\/><\/svg>/);
  assert.match(extras.svg, /stroke-width="6" stroke-dasharray="12 12"/);
  assert.match(extras.svg, /amp &amp; co/);
  // The export's frame takes the bubble in.
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  const svg = svgString(c, { background: true, padding: 40, extras });
  const [, x, y, w, h] = svg.match(/viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/).map(Number);
  const f = bubble.frame;
  assert.ok(x <= f.x && y <= f.y && x + w >= f.x + f.w && y + h >= f.y + f.h);
  assert.ok(svg.includes('data-child="yes"'));
});

test('a dragged bubble stays where it was put beside its part, and others keep clear', () => {
  const part = { x: 760, y: 360, w: 80, h: 80 };
  const offset = bubbleOffset(part, { x: 1010, y: 350 });
  assert.deepEqual(offset, { dx: 200, dy: -40 });
  const [pinned, free] = layoutBubbles(drawing, [
    { id: 'B', part: { x: 200, y: 360, w: 80, h: 80 }, size: { w: 400, h: 300 } },
    { id: 'A', part, size: { w: 400, h: 300 }, offset },
  ]);
  assert.equal(pinned.id, 'A');
  // Inside the drawing's extent too: the user put it there.
  assert.deepEqual({ x: pinned.frame.x, y: pinned.frame.y }, { x: 1000, y: 360 });
  assert.deepEqual(pinned.connector[1], { x: 1000, y: 400 });
  assert.ok(disjoint(pinned.frame, free.frame));
  // It follows its part when the part moves.
  const [moved] = layoutBubbles(drawing, [{ id: 'A', part: { ...part, x: part.x + GRID }, size: { w: 400, h: 300 }, offset }]);
  assert.equal(moved.frame.x, 1000 + GRID);
});

test('a renamed design\'s links follow it in a saved document', async () => {
  const { Circuit } = await import('../src/core/model.js');
  const { relinkDocumentState } = await import('../src/core/document.js');
  const c = new Circuit();
  c.addComponent('block', { refdes: 'X1', x: 0, y: 0 });
  c.addComponent('block', { refdes: 'X2', x: 400, y: 0 });
  c.addComponent('block', { refdes: 'X3', x: 800, y: 0 });
  c.setLink('X1', 'amp');
  c.setLink('X2', 'amp.json');
  c.setLink('X3', 'bias');
  const state = c.toJSON();
  assert.equal(relinkDocumentState(state, 'amp', 'ota'), 2);
  assert.deepEqual(state.components.map((part) => part.link ?? null), ['ota', 'ota', 'bias']);
  assert.equal(relinkDocumentState(state, 'missing', 'x'), 0);
  assert.equal(relinkDocumentState(state, 'ota', 'ota'), 0);
});

test('parts linked to one design share a bubble, a connector from each', async () => {
  const { bubbleExtras } = await import('../src/core/link-bubble.js');
  const parts = [{ x: 200, y: 360, w: 80, h: 80 }, { x: 1320, y: 360, w: 80, h: 80 }];
  const [shared, ...rest] = layoutBubbles(drawing, [{ id: 'X1', ids: ['X1', 'X2'], parts, size: { w: 400, h: 300 } }]);
  assert.equal(rest.length, 0);
  assert.deepEqual(shared.ids, ['X1', 'X2']);
  assert.equal(shared.connectors.length, 2);
  assert.deepEqual(shared.connector, shared.connectors[0]);
  shared.connectors.forEach(([from, to], index) => {
    const part = parts[index];
    assert.ok(from.x >= part.x && from.x <= part.x + part.w && from.y >= part.y && from.y <= part.y + part.h, 'leaves its own part');
    const f = shared.frame;
    assert.ok(to.x === f.x || to.x === f.x + f.w || to.y === f.y || to.y === f.y + f.h, 'ends on the frame');
  });
  const extras = bubbleExtras([{ ...shared, name: 'amp', svg: '<svg viewBox="0 0 400 300"></svg>', box: { x: 0, y: 0, w: 400, h: 300 } }]);
  assert.equal((extras.svg.match(/<circle/g) || []).length, 2, 'a dot at each part');
  assert.equal((extras.svg.match(/ L /g) || []).length, 2, 'a line to each part');
});
