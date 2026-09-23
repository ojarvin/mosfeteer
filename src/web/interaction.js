import { snap, GRID } from '../core/grid.js';

export function moveAnnotationEndpoint(label, endpoint, p) {
  const oldAnchor = { ...label.anchor };
  const oldEnd = { ...label.end };
  const oldPoints = label.points?.map((point) => ({ ...point }));
  if (['arrow', 'line'].includes(label.kind) && endpoint.startsWith('vertex:')) {
    label.moveVertex(Number(endpoint.slice(7)), p.x, p.y);
  } else if (endpoint === 'start') {
    label.anchor = p;
    if (label.points?.length) label.points[0] = { ...p };
  } else if (endpoint === 'end') {
    label.end = p;
    if (label.points?.length) label.points[label.points.length - 1] = { ...p };
  }
  const invalid = label.kind === 'arrow'
    && Math.hypot(label.anchor.x - label.end.x, label.anchor.y - label.end.y) < GRID * 2;
  if (invalid) {
    label.anchor = oldAnchor;
    label.end = oldEnd;
    if (oldPoints) label.points = oldPoints;
  }
  return !invalid;
}

/** The rectangle a resize handle drag produces. `handle` names the moved
 * edges (`n`, `ne`, `e`, ... `nw`); the others stay put, or, with `symmetric`
 * (Ctrl held), mirror the moved edges about the rectangle's center. Edges snap
 * to the grid, a one-sided drag keeps the size a multiple of `step`, and no
 * side closes below `min`. The center may sit on a half cell, but twice it is
 * always on the grid, so mirrored edges stay grid-aligned. */
export function resizeRect(rect, handle, world, { symmetric = false, min = 2 * GRID, step = GRID } = {}) {
  const p = { x: snap(world.x), y: snap(world.y) };
  let x0 = rect.x; let y0 = rect.y; let x1 = rect.x + rect.w; let y1 = rect.y + rect.h;
  if (symmetric) {
    // Mirroring a grid point through a center whose double is on the grid
    // lands on the grid, so only the minimum-size clamp needs rounding.
    const mirrored = (moved, sum) => {
      const c = sum / 2;
      const far = Math.max(c + Math.abs(moved - c), Math.ceil((c + min / 2) / GRID) * GRID);
      return [sum - far, far];
    };
    if (/[we]/.test(handle)) [x0, x1] = mirrored(p.x, x0 + x1);
    if (/[ns]/.test(handle)) [y0, y1] = mirrored(p.y, y0 + y1);
  } else {
    const span = (d) => Math.max(min, Math.round(d / step) * step);
    if (handle.includes('w')) x0 = x1 - span(x1 - p.x);
    if (handle.includes('e')) x1 = x0 + span(p.x - x0);
    if (handle.includes('n')) y0 = y1 - span(y1 - p.y);
    if (handle.includes('s')) y1 = y0 + span(p.y - y0);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** How far a child label's anchor must move after its box changes size
 * (`before` to `after`, both centered on the anchor) to keep the edge that was
 * flush against its parent. `reach` is the parent's extent: an arrow's start
 * point or a box's rectangle. A caption left of an arrow's start keeps its
 * right edge on the start; a title above a box keeps its bottom edge on the
 * top. An edge that was not flush grows symmetrically, as before. */
export function attachedEdgeShift(before, after, reach) {
  const axis = (lo, size, nextSize, reachLo, reachHi) => {
    const half = (nextSize - size) / 2;
    if (lo + size === reachLo) return -half;
    if (lo === reachHi) return half;
    return 0;
  };
  return {
    dx: axis(before.x, before.w, after.w, reach.x0, reach.x1),
    dy: axis(before.y, before.h, after.h, reach.y0, reach.y1),
  };
}

/** A label's anchor is the center of its box, so re-measuring its text moves
 * both edges by half the change. An aligned label's meaning is its own edge —
 * an analysis annotation is placed flush with the figure's left edge — so
 * return how far the anchor must move to leave that edge where it was. */
export function alignedAnchorShift(align, beforeWidth, afterWidth) {
  const delta = (Number(afterWidth) - Number(beforeWidth)) / 2;
  if (!Number.isFinite(delta) || delta === 0) return 0;
  if (align === 'left') return delta;
  if (align === 'right') return -delta;
  return 0;
}

/** Scroll the view just far enough to keep the keyboard cursor inside it,
 * leaving a margin so the cursor never rides the frame. Returns the new view
 * origin, or null when the cursor is already inside that margin. The scroll is
 * minimal, so holding an arrow key walks the drawing past the edge steadily
 * instead of jumping a page at a time. */
export function viewFollowingCursor(view, cursor, margin = 0) {
  if (!view || !cursor) return null;
  const gap = Math.max(0, Math.min(margin, view.w / 4, view.h / 4));
  const shift = (position, start, size) => {
    if (position < start + gap) return position - gap - start;
    if (position > start + size - gap) return position - (start + size - gap);
    return 0;
  };
  const dx = shift(cursor.x, view.x, view.w);
  const dy = shift(cursor.y, view.y, view.h);
  return dx || dy ? { x: view.x + dx, y: view.y + dy } : null;
}

/** Platform-neutral modifier policy shared by every selectable editor role. */
export function isSelectionModifier({ shiftKey = false, ctrlKey = false, metaKey = false } = {}) {
  return !!(shiftKey || ctrlKey || metaKey);
}

/** Pointer events are the canonical canvas gesture source.  Mouse events are
 * retained as a compatibility fallback for older automation and browsers. */
export function isPrimaryPointerEvent({ pointerType = '', button = 0 } = {}) {
  return button === 0 && (pointerType === 'mouse' || pointerType === 'pen' || pointerType === 'touch');
}

/** Whether a window-level pointer move should be forwarded to the canvas.
 * Overlay controls which sit above the canvas own their pointer events; in
 * particular, the insert menu must not cause a canvas repaint while it is
 * being browsed, since repainting rebuilds its scrolling contents. */
export function shouldForwardCanvasMove(target, canvasElement) {
  if (canvasElement?.contains?.(target)) return false;
  return !target?.closest?.('#insert-menu');
}

/** Browsers follow each mouse `pointermove` with a compatibility `mousemove`
 * for the same motion. Both are listened to (automation may send either), so
 * the returned predicate flags the second of such a pair — same position and
 * buttons right after a pointermove — letting one motion do one update. */
export function compatibilityMoveFilter() {
  let pending = null;
  return (ev) => {
    if (ev.type === 'pointermove') {
      pending = ev.pointerType === 'mouse' ? { x: ev.clientX, y: ev.clientY, buttons: ev.buttons } : null;
      return false;
    }
    const duplicate = ev.type === 'mousemove' && !!pending &&
      pending.x === ev.clientX && pending.y === ev.clientY && pending.buttons === ev.buttons;
    pending = null;
    return duplicate;
  };
}

/** A blank touch press pans the canvas; a press on an object remains an edit
 * gesture.  Keeping this policy pure makes touch behavior testable without a
 * browser surface. */
export function shouldPanTouch({ pointerType = '', hasHit = false, mode = 'normal' } = {}) {
  return pointerType === 'touch' && mode === 'normal' && !hasHit;
}

export function isKeyboardSurfaceTarget(target) {
  const tag = String(target?.tagName || '').toUpperCase();
  return ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'OPTION'].includes(tag) ||
    !!target?.isContentEditable || !!target?.closest?.('[role="menuitem"],[role="option"],[role="separator"]');
}

export function worldAndCursorFromClient(clientX, clientY, rect, view) {
  const world = {
    x: view.x + ((clientX - rect.left) / rect.width) * view.w,
    y: view.y + ((clientY - rect.top) / rect.height) * view.h,
  };
  return { world, cursor: { x: snap(world.x), y: snap(world.y) } };
}

/** Return the nearest candidate to a world point, preserving its fields and
 * adding the measured distance. The editor uses this for terminal snapping;
 * keeping it pure makes the "always snap to the nearest terminal" behavior
 * testable without a browser surface. */
export function nearestPoint(point, candidates = []) {
  let best = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate?.x) || !Number.isFinite(candidate?.y)) continue;
    const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { ...candidate };
    }
  }
  return best ? { ...best, distance: bestDistance } : null;
}

/** Lock a pointer displacement to its dominant axis. */
/** The mirror a symmetric placement takes, read from the cursor's own
 *  displacement out of the point symmetry was armed at: moving mostly sideways
 *  reflects across a vertical line ('mirrorX'), mostly up or down across a
 *  horizontal one. One at a time, and a cursor still sitting on the pin keeps
 *  whatever was chosen last rather than flickering between the two. */
export function symmetryOperation(pin, current, previous = null) {
  const dx = current.x - pin.x;
  const dy = current.y - pin.y;
  if (dx === 0 && dy === 0) return previous;
  return Math.abs(dx) >= Math.abs(dy) ? 'mirrorX' : 'mirrorY';
}

export function constrainAxis(start, current, enabled = true) {
  if (!enabled) return { ...current };
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  return Math.abs(dx) >= Math.abs(dy)
    ? { x: current.x, y: start.y }
    : { x: start.x, y: current.y };
}
