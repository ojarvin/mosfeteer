import test from 'node:test';
import assert from 'node:assert/strict';
import { GRID } from '../src/core/grid.js';
import { BUBBLE_GAP, bubbleAt, layoutBubbles, nearestSide } from '../src/core/link-bubble.js';

const drawing = { x: 0, y: 0, w: 1600, h: 800 };

test('a bubble opens on the side of the drawing nearest its part', () => {
  assert.equal(nearestSide(drawing, { x: 1400, y: 360, w: 80, h: 80 }), 'right');
  assert.equal(nearestSide(drawing, { x: 100, y: 360, w: 80, h: 80 }), 'left');
  assert.equal(nearestSide(drawing, { x: 760, y: 700, w: 80, h: 80 }), 'bottom');
  const [bubble] = layoutBubbles(drawing, [{ id: 'OA1', part: { x: 1400, y: 360, w: 80, h: 80 }, size: { w: 600, h: 400 } }]);
  assert.equal(bubble.side, 'right');
  assert.ok(bubble.frame.x >= drawing.x + drawing.w + BUBBLE_GAP - GRID / 2);
  // It is centred on the part, holds the child whole, and the connector
  // runs from the part's face to the frame.
  assert.ok(Math.abs(bubble.frame.y + bubble.frame.h / 2 - 400) <= GRID);
  assert.ok(bubble.image.x >= bubble.frame.x && bubble.image.x + bubble.image.w <= bubble.frame.x + bubble.frame.w);
  assert.ok(bubble.image.y + bubble.image.h <= bubble.frame.y + bubble.frame.h);
  assert.deepEqual(bubble.connector[0], { x: 1480, y: 400 });
  assert.equal(bubble.connector[1].x, bubble.frame.x);
  assert.equal(bubbleAt([bubble], { x: bubble.frame.x + 10, y: bubble.frame.y + 10 }), bubble);
  assert.equal(bubbleAt([bubble], { x: 0, y: 0 }), null);
});

test('bubbles on one side slide apart instead of overlapping', () => {
  const bubbles = layoutBubbles(drawing, [
    { id: 'A', part: { x: 1400, y: 360, w: 80, h: 80 }, size: { w: 400, h: 400 } },
    { id: 'B', part: { x: 1400, y: 440, w: 80, h: 80 }, size: { w: 400, h: 400 } },
  ]);
  const [a, b] = bubbles.map((bubble) => bubble.frame);
  assert.ok(a.y + a.h <= b.y || b.y + b.h <= a.y);
});
