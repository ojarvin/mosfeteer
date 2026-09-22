import { snap, GRID } from '../core/grid.js';

export function moveAnnotationEndpoint(label, endpoint, p) {
  const oldAnchor = { ...label.anchor };
  const oldEnd = { ...label.end };
  const oldPoints = label.points?.map((point) => ({ ...point }));
  if (['arrow', 'line'].includes(label.kind) && endpoint.startsWith('vertex:')) {
    label.moveVertex(Number(endpoint.slice(7)), p.x, p.y);
  } else if (endpoint.startsWith('corner:')) {
    const corner = endpoint.slice(7);
    const x0 = Math.min(label.anchor.x, label.end.x);
    const x1 = Math.max(label.anchor.x, label.end.x);
    const y0 = Math.min(label.anchor.y, label.end.y);
    const y1 = Math.max(label.anchor.y, label.end.y);
    const fixed = {
      'top-left': { x: x1, y: y1 },
      'top-right': { x: x0, y: y1 },
      'bottom-right': { x: x0, y: y0 },
      'bottom-left': { x: x1, y: y0 },
    }[corner];
    label.anchor = p;
    label.end = fixed;
  } else if (endpoint === 'start') {
    label.anchor = p;
    if (label.points?.length) label.points[0] = { ...p };
  } else if (endpoint === 'end') {
    label.end = p;
    if (label.points?.length) label.points[label.points.length - 1] = { ...p };
  }
  else if (endpoint === 'left' || endpoint === 'right') {
    const left = endpoint === 'left';
    if ((label.anchor.x < label.end.x) === left) label.anchor.x = p.x;
    else label.end.x = p.x;
  } else {
    const top = endpoint === 'top';
    if ((label.anchor.y < label.end.y) === top) label.anchor.y = p.y;
    else label.end.y = p.y;
  }
  const invalid = label.kind === 'arrow'
    ? Math.hypot(label.anchor.x - label.end.x, label.anchor.y - label.end.y) < GRID * 2
    : label.kind === 'box' && (label.anchor.x === label.end.x || label.anchor.y === label.end.y);
  if (invalid) {
    label.anchor = oldAnchor;
    label.end = oldEnd;
    if (oldPoints) label.points = oldPoints;
  }
  return !invalid;
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
