import { snap, GRID } from '../core/grid.js';

export function moveAnnotationEndpoint(label, endpoint, p) {
  const oldAnchor = { ...label.anchor };
  const oldEnd = { ...label.end };
  const oldPoints = label.points?.map((point) => ({ ...point }));
  if (label.kind === 'line' && endpoint.startsWith('vertex:')) {
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
  } else if (endpoint === 'start') label.anchor = p;
  else if (endpoint === 'end') label.end = p;
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

export function isCloseWindowShortcut({ key, ctrlKey = false, metaKey = false, altKey = false } = {}) {
  return (ctrlKey || metaKey) && !altKey && ['q', 'w'].includes(String(key).toLowerCase());
}

export function shouldConfirmBeforeUnload({ dirty, desktop } = {}) {
  return !!dirty && !desktop;
}

/** Platform-neutral modifier policy shared by every selectable editor role. */
export function isSelectionModifier({ shiftKey = false, ctrlKey = false, metaKey = false } = {}) {
  return !!(shiftKey || ctrlKey || metaKey);
}

export function worldAndCursorFromClient(clientX, clientY, rect, view) {
  const world = {
    x: view.x + ((clientX - rect.left) / rect.width) * view.w,
    y: view.y + ((clientY - rect.top) / rect.height) * view.h,
  };
  return { world, cursor: { x: snap(world.x), y: snap(world.y) } };
}
