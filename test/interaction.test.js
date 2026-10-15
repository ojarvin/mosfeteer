import test from 'node:test';
import assert from 'node:assert/strict';
import { GRID } from '../src/core/grid.js';
import { alignedAnchorShift, attachedEdgeShift, compatibilityMoveFilter, constrainAxis, isKeyboardSurfaceTarget, isPrimaryPointerEvent, isSelectionModifier, moveAnnotationEndpoint, nearestPoint, resizeRect, shouldForwardCanvasMove, shouldPanTouch, symmetryOperation, viewFollowingCursor, worldAndCursorFromClient } from '../src/web/interaction.js';

const rect = { left: 10, top: 20, width: 100, height: 100 };
const view = { x: -80, y: -80, w: 400, h: 400 };

test('insert categories keep switches and macros separate and include vccs with sources', async () => {
  const { symbolCategories } = await import('../src/core/components/categories.js');
  const groups = Object.fromEntries(symbolCategories().map(({ title, types }) => [title, types]));
  assert.deepEqual(groups.Switches, ['switch_open', 'switch_closed']);
  assert.deepEqual([...groups['Sources & power']].sort(), ['current_source', 'ground', 'supply', 'vccs', 'vcm', 'vcvs', 'voltage_source']);
  assert.deepEqual([...groups.Macros].sort(), ['adc', 'adc_diff', 'comparator', 'comparator_clocked', 'dac', 'dac_diff', 'gm', 'opamp', 'opamp_diff']);
  assert.ok(groups.Logic.includes('mux2') && groups.Logic.includes('tristate_buffer') && groups.Logic.includes('xnor3_gate'));
  assert.ok(groups.Sequential.includes('dff') && groups.Sequential.includes('latch_enb_rstb_qb'));
  assert.deepEqual(groups['Signal flow'], ['signal_sum', 'signal_multiply', 'tf_s', 'tf_z', 'tf_dac', 'tf_dac_rz', 'tf_delay', 'tf_zdelay', 'gain', 'sampler', 'quantizer', 'dither']);
  // Filters draw block diagrams; the signal-flow analysis does not read them.
  assert.deepEqual(groups['Block diagram'], ['block', 'filter_lpf', 'filter_hpf', 'filter_bpf', 'filter_notch', 'oscillator']);
  assert.equal(groups.Other, undefined, 'every registered symbol has a category');
});

test('an aligned label keeps its own edge when its measured box changes', () => {
  // The anchor is the box center, so half of a width change moves with it.
  assert.equal(alignedAnchorShift('left', 560, 640), 40);
  assert.equal(alignedAnchorShift('right', 560, 640), -40);
  assert.equal(alignedAnchorShift('left', 640, 560), -40);
  // A centered label stays centered, and an unchanged box never moves.
  assert.equal(alignedAnchorShift('center', 560, 640), 0);
  assert.equal(alignedAnchorShift('left', 560, 560), 0);
  assert.equal(alignedAnchorShift('left', 560, Number.NaN), 0);
});

test('the view follows the cursor out of frame, minimally and with a margin', () => {
  const view = { x: 0, y: 0, w: 400, h: 400 };
  assert.equal(viewFollowingCursor(view, { x: 200, y: 200 }, 40), null, 'no scroll while inside');
  assert.equal(viewFollowingCursor(view, { x: 360, y: 40 }, 40), null, 'the margin edge is still inside');
  // Scrolling stops as soon as the cursor is one margin inside the frame.
  assert.deepEqual(viewFollowingCursor(view, { x: 420, y: 200 }, 40), { x: 60, y: 0 });
  assert.deepEqual(viewFollowingCursor(view, { x: 200, y: -80 }, 40), { x: 0, y: -120 });
  assert.deepEqual(viewFollowingCursor(view, { x: -40, y: 440 }, 40), { x: -80, y: 80 });
  // A margin wider than the view cannot pin the cursor mid-screen.
  assert.deepEqual(viewFollowingCursor({ x: 0, y: 0, w: 80, h: 80 }, { x: 120, y: 40 }, 400), { x: 60, y: 0 });
  assert.equal(viewFollowingCursor(null, { x: 0, y: 0 }, 40), null);
});

test('selection extension uses one cross-platform modifier policy', () => {
  assert.equal(isSelectionModifier({ shiftKey: true }), true);
  assert.equal(isSelectionModifier({ ctrlKey: true }), true);
  assert.equal(isSelectionModifier({ metaKey: true }), true);
  assert.equal(isSelectionModifier({ altKey: true }), false);
});

test('axis constraint follows the dominant pointer direction', () => {
  const start = { x: 40, y: 80 };
  assert.deepEqual(constrainAxis(start, { x: 200, y: 160 }), { x: 200, y: 80 });
  assert.deepEqual(constrainAxis(start, { x: 120, y: 280 }), { x: 40, y: 280 });
  assert.deepEqual(constrainAxis(start, { x: 200, y: 240 }), { x: 200, y: 80 });
  assert.deepEqual(constrainAxis(start, { x: 200, y: 240 }, false), { x: 200, y: 240 });
});

test('pointer policy accepts pen/touch primary presses and pans blank touch space', () => {
  assert.equal(isPrimaryPointerEvent({ pointerType: 'mouse', button: 0 }), true);
  assert.equal(isPrimaryPointerEvent({ pointerType: 'pen', button: 0 }), true);
  assert.equal(isPrimaryPointerEvent({ pointerType: 'touch', button: 0 }), true);
  assert.equal(isPrimaryPointerEvent({ pointerType: 'touch', button: 1 }), false);
  assert.equal(shouldPanTouch({ pointerType: 'touch', hasHit: false }), true);
  assert.equal(shouldPanTouch({ pointerType: 'touch', hasHit: true }), false);
  assert.equal(shouldPanTouch({ pointerType: 'pen', hasHit: false }), false);
});

test('window pointer forwarding ignores the insert menu overlay', () => {
  const canvas = {};
  const canvasTarget = {};
  canvas.contains = (target) => target === canvasTarget;
  const insertMenuTarget = { closest: (selector) => selector.includes('#insert-menu') ? {} : null };
  const windowTarget = { closest: (selector) => selector.includes('.floating-window') ? {} : null };
  const otherOverlayTarget = { closest: () => null };
  assert.equal(shouldForwardCanvasMove(canvasTarget, canvas), false, 'canvas events are already handled directly');
  assert.equal(shouldForwardCanvasMove(insertMenuTarget, canvas), false, 'insert-menu events stay in the menu');
  assert.equal(shouldForwardCanvasMove(windowTarget, canvas), false, 'a floating window keeps its moves (dragging it does not repaint the drawing)');
  assert.equal(shouldForwardCanvasMove(otherOverlayTarget, canvas), true, 'other pane overlays still forward moves');
});

test('global shortcuts yield to interactive controls', () => {
  assert.equal(isKeyboardSurfaceTarget({ tagName: 'BUTTON' }), true);
  assert.equal(isKeyboardSurfaceTarget({ tagName: 'div', closest: (selector) => selector.includes('option') }), true);
  assert.equal(isKeyboardSurfaceTarget({ tagName: 'div' }), false);
});

test('annotation endpoints move and reject invalid shapes', () => {
  const arrow = { kind: 'arrow', anchor: { x: 0, y: 0 }, end: { x: 160, y: 0 } };
  assert.equal(moveAnnotationEndpoint(arrow, 'end', { x: 240, y: 80 }), true);
  assert.deepEqual(arrow.end, { x: 240, y: 80 });
  const before = { ...arrow.end };
  assert.equal(moveAnnotationEndpoint(arrow, 'end', { x: 40, y: 0 }), false);
  assert.deepEqual(arrow.end, before);

  const line = { kind: 'line', anchor: { x: 0, y: 0 }, end: { x: 160, y: 0 }, points: [{ x: 0, y: 0 }, { x: 160, y: 0 }] };
  line.moveVertex = (index, x, y) => { line.points[index] = { x, y }; };
  assert.equal(moveAnnotationEndpoint(line, 'vertex:1', { x: 160, y: 80 }), true);
  assert.deepEqual(line.points[1], { x: 160, y: 80 });
});


test('resize handles move their edges, and Ctrl mirrors them about the center', () => {
  const rect = { x: 0, y: 0, w: 160, h: 80 };
  assert.deepEqual(resizeRect(rect, 'e', { x: 238, y: 999 }), { x: 0, y: 0, w: 240, h: 80 });
  assert.deepEqual(resizeRect(rect, 'nw', { x: -40, y: -40 }), { x: -40, y: -40, w: 200, h: 120 });
  // An edge never passes the minimum size, however far it is pulled.
  assert.deepEqual(resizeRect(rect, 'w', { x: 400, y: 0 }), { x: 80, y: 0, w: 80, h: 80 });
  assert.deepEqual(resizeRect(rect, 'w', { x: 400, y: 0 }, { min: GRID }), { x: 120, y: 0, w: 40, h: 80 });

  // Blocks step two cells at a time so their center stays on the grid.
  assert.deepEqual(resizeRect(rect, 's', { x: 0, y: 120 }, { step: 2 * GRID }), { x: 0, y: 0, w: 160, h: 160 });
  assert.deepEqual(resizeRect(rect, 'e', { x: 200, y: 0 }, { step: 2 * GRID }), { x: 0, y: 0, w: 240, h: 80 });

  assert.deepEqual(resizeRect(rect, 'e', { x: 200, y: 0 }, { symmetric: true }), { x: -40, y: 0, w: 240, h: 80 });
  assert.deepEqual(resizeRect(rect, 'se', { x: 200, y: 120 }, { symmetric: true }), { x: -40, y: -40, w: 240, h: 160 });
  // Dragging past the center mirrors back out instead of inverting.
  assert.deepEqual(resizeRect(rect, 'e', { x: -40, y: 0 }, { symmetric: true }), { x: -40, y: 0, w: 240, h: 80 });
  // A half-cell center keeps mirrored edges on the grid, down to the minimum.
  const odd = { x: 0, y: 0, w: 120, h: 120 };
  assert.deepEqual(resizeRect(odd, 's', { x: 0, y: 200 }, { symmetric: true }), { x: 0, y: -80, w: 120, h: 280 });
  assert.deepEqual(resizeRect(odd, 'e', { x: 60, y: 0 }, { symmetric: true }), { x: 0, y: 0, w: 120, h: 120 });
  assert.deepEqual(resizeRect(odd, 'e', { x: 60, y: 0 }, { symmetric: true, min: GRID }), { x: 40, y: 0, w: 40, h: 120 });
});

test('a child label keeps the edge that was flush against its parent when it is measured', () => {
  const start = { x0: 0, x1: 0, y0: 0, y1: 0 };
  // Caption left of a rightward arrow: estimated 80 wide, measured 160.
  assert.deepEqual(attachedEdgeShift({ x: -80, y: -40, w: 80, h: 80 }, { w: 160, h: 80 }, start), { dx: -40, dy: 0 });
  // Caption right of a leftward arrow, and one above a downward arrow.
  assert.deepEqual(attachedEdgeShift({ x: 0, y: -40, w: 80, h: 80 }, { w: 160, h: 80 }, start), { dx: 40, dy: 0 });
  assert.deepEqual(attachedEdgeShift({ x: -40, y: -80, w: 80, h: 80 }, { w: 80, h: 160 }, start), { dx: 0, dy: -40 });
  // A title above a box keeps its bottom edge on the box top.
  const box = { x0: -200, x1: 200, y0: 0, y1: 160 };
  assert.deepEqual(attachedEdgeShift({ x: -40, y: -80, w: 80, h: 80 }, { w: 160, h: 160 }, box), { dx: 0, dy: -40 });
  // A reloaded caption re-measured against its estimate is not flush: no drift.
  assert.deepEqual(attachedEdgeShift({ x: -120, y: -40, w: 80, h: 80 }, { w: 160, h: 80 }, start), { dx: 0, dy: 0 });
});

test('pointer paths use snapped cursor conversion', () => {
  assert.deepEqual(worldAndCursorFromClient(50, 70, rect, view), {
    world: { x: 80, y: 120 }, cursor: { x: 80, y: 120 },
  });
});

test('nearest-point selection provides the terminal target for Alt snapping', () => {
  const nearest = nearestPoint({ x: 75, y: 5 }, [
    { refdes: 'R1', term: 'a', x: 0, y: 0 },
    { refdes: 'R2', term: 'a', x: 80, y: 0 },
  ]);
  assert.equal(nearest.refdes, 'R2');
  assert.equal(nearest.term, 'a');
  assert.equal(nearest.distance, Math.hypot(5, 5));
});

test('symmetric placement mirrors across one axis, chosen by the cursor', () => {
  const pin = { x: 0, y: 0 };
  // Mostly sideways reflects across a vertical line, mostly up or down across
  // a horizontal one -- one at a time, like the Shift constraint.
  assert.equal(symmetryOperation(pin, { x: -160, y: 40 }), 'mirrorX');
  assert.equal(symmetryOperation(pin, { x: 40, y: 240 }), 'mirrorY');
  // Still on the pin there is no direction yet, and nothing flickers: whatever
  // was chosen last is kept.
  assert.equal(symmetryOperation(pin, { x: 0, y: 0 }), null);
  assert.equal(symmetryOperation(pin, { x: 0, y: 0 }, 'mirrorY'), 'mirrorY');
  // Copy ghosts may arm from an offset click, so the direction reference can
  // be anywhere in the drawing without making the selection arrangement pick
  // the axis.
  assert.equal(symmetryOperation({ x: 400, y: 400 }, { x: 560, y: 440 }), 'mirrorX');
  assert.equal(symmetryOperation({ x: 400, y: 400 }, { x: 440, y: 640 }), 'mirrorY');
});

test('a compatibility mousemove after the same mouse pointermove is skipped', () => {
  const skip = compatibilityMoveFilter();
  const pointer = { type: 'pointermove', pointerType: 'mouse', clientX: 10, clientY: 20, buttons: 1 };
  const mouse = { type: 'mousemove', clientX: 10, clientY: 20, buttons: 1 };
  assert.equal(skip(pointer), false);
  assert.equal(skip(mouse), true);
  // Automation that sends only mouse events is handled every time.
  assert.equal(skip(mouse), false);
  assert.equal(skip(mouse), false);
  // A different position or button state is new motion, not the echo.
  skip(pointer);
  assert.equal(skip({ ...mouse, clientX: 11 }), false);
  skip(pointer);
  assert.equal(skip({ ...mouse, buttons: 0 }), false);
  // Touch and pen have no compatibility echo to drop.
  skip({ ...pointer, pointerType: 'touch' });
  assert.equal(skip(mouse), false);
});
