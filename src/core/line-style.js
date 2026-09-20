/** The one filled triangular arrowhead offered by the shared style menu. */
export const ARROWHEAD_VALUES = Object.freeze(['none', 'start', 'end', 'both']);

export function normalizeArrowhead(value, fallback = 'none') {
  return ARROWHEAD_VALUES.includes(value) ? value : fallback;
}

export function defaultArrowhead(kind) {
  return kind === 'arrow' || kind === 'connector' ? 'end' : 'none';
}

export function arrowheadEnds(value, fallback = 'none') {
  const normalized = normalizeArrowhead(typeof value === 'object' ? value?.arrowhead : value, fallback);
  return {
    start: normalized === 'start' || normalized === 'both',
    end: normalized === 'end' || normalized === 'both',
  };
}

const samePoint = (a, b) => a?.x === b?.x && a?.y === b?.y;

/** Filled arrowhead geometry for a segment whose tip is `b`. */
export function arrowheadGeometry(a, b, length = 32, halfWidth = 18) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy);
  if (!distance) return null;
  const ux = dx / distance;
  const uy = dy / distance;
  const base = { x: b.x - length * ux, y: b.y - length * uy };
  const normal = { x: uy, y: -ux };
  return {
    shaft: base,
    tip: { x: b.x, y: b.y },
    left: { x: base.x + halfWidth * normal.x, y: base.y + halfWidth * normal.y },
    right: { x: base.x - halfWidth * normal.x, y: base.y - halfWidth * normal.y },
  };
}

/**
 * Return a polyline shortened at the decorated endpoints plus the filled
 * heads. The input is never mutated. Endpoint decoration works for straight,
 * diagonal, and orthogonal multi-point paths.
 */
export function polylineArrowheads(points = [], value = 'none', options = {}) {
  const route = [];
  for (const point of points || []) {
    const next = { x: point.x, y: point.y };
    if (!route.length || !samePoint(route.at(-1), next)) route.push(next);
  }
  if (route.length < 2) return { shaftPoints: route, heads: [] };
  const ends = arrowheadEnds(value, options.fallback || 'none');
  let first = -1;
  let last = -1;
  for (let i = 1; i < route.length; i++) {
    if (samePoint(route[i - 1], route[i])) continue;
    if (first < 0) first = i;
    last = i;
  }
  if (first < 0) return { shaftPoints: route, heads: [] };
  const sameSegment = first === last;
  const fullLength = options.length ?? 32;
  const halfWidth = options.halfWidth ?? 18;
  const segmentLength = Math.hypot(route[last].x - route[last - 1].x, route[last].y - route[last - 1].y);
  const length = sameSegment && ends.start && ends.end
    ? Math.min(fullLength, segmentLength / 2)
    : fullLength;
  const heads = [];
  const shaftPoints = route.map((point) => ({ ...point }));
  if (ends.start) {
    const head = arrowheadGeometry(route[first], route[first - 1], length, halfWidth);
    if (head) {
      heads.push({ ...head, placement: 'start' });
      shaftPoints[0] = head.shaft;
    }
  }
  if (ends.end) {
    const head = arrowheadGeometry(route[last - 1], route[last], length, halfWidth);
    if (head) {
      heads.push({ ...head, placement: 'end' });
      shaftPoints[shaftPoints.length - 1] = head.shaft;
    }
  }
  return { shaftPoints, heads };
}
