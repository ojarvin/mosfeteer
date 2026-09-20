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

/**
 * Map one shared arrowhead choice onto the individual segments of a
 * polyline.  A bent route is still one drawable wire, so its heads belong at
 * the route endpoints rather than at its corner vertices.  On a single
 * segment both heads can share that segment; otherwise the two heads occupy
 * the first and last segments independently.
 */
export function polylineArrowheadValues(points = [], value = 'none') {
  const route = [];
  for (const point of points || []) {
    const next = { x: point.x, y: point.y };
    if (!route.length || !samePoint(route.at(-1), next)) route.push(next);
  }
  if (route.length < 2) return [];
  const ends = arrowheadEnds(value);
  let first = -1;
  let last = -1;
  for (let i = 1; i < route.length; i++) {
    if (samePoint(route[i - 1], route[i])) continue;
    if (first < 0) first = i;
    last = i;
  }
  if (first < 0) return route.slice(1).map(() => 'none');
  const values = route.slice(1).map(() => 'none');
  if (ends.start) values[first - 1] = first === last && ends.end ? 'both' : 'start';
  if (ends.end) values[last - 1] = ['start', 'both'].includes(values[last - 1]) ? 'both' : 'end';
  return values;
}

/** Resolve segment-local arrowhead styles to the logical endpoints of a
 * polyline. This also repairs older documents where an end head was left on
 * an interior segment after a route gained a bend. */
export function polylineArrowheadValue(wireStyles = {}, branch = 0, points = [], inherited = 'none') {
  const values = [];
  for (let index = 1; index < points.length; index++) {
    const value = wireStyles?.[`${branch}:${index}`]?.arrowhead;
    if (value !== undefined) values.push(normalizeArrowhead(value));
  }
  if (!values.length) return normalizeArrowhead(inherited);
  const start = values.some((value) => arrowheadEnds(value).start);
  const end = values.some((value) => arrowheadEnds(value).end);
  return start && end ? 'both' : start ? 'start' : end ? 'end' : 'none';
}

/** Return wireStyles with one shared arrowhead choice distributed across a
 * path's endpoint segments. Existing per-segment appearance is preserved. */
export function polylineArrowheadStyles(wireStyles = {}, branch = 0, points = [], value = 'none') {
  const next = { ...wireStyles };
  for (const [index, arrowhead] of polylineArrowheadValues(points, value).entries()) {
    const key = `${branch}:${index + 1}`;
    next[key] = { ...(next[key] || {}), arrowhead };
  }
  return next;
}

const samePoint = (a, b) => a?.x === b?.x && a?.y === b?.y;

/** Filled arrowhead geometry for a segment whose tip is `b`. */
export function arrowheadGeometry(a, b, length = 32, halfWidth = 18, tipInset = 0) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy);
  if (!distance) return null;
  const ux = dx / distance;
  const uy = dy / distance;
  const tip = { x: b.x - Math.max(0, tipInset) * ux, y: b.y - Math.max(0, tipInset) * uy };
  const base = { x: tip.x - length * ux, y: tip.y - length * uy };
  const normal = { x: uy, y: -ux };
  return {
    shaft: base,
    tip,
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
  const startInset = Math.max(0, options.startInset ?? options.tipInset ?? 0);
  const endInset = Math.max(0, options.endInset ?? options.tipInset ?? 0);
  const segmentLength = Math.hypot(route[last].x - route[last - 1].x, route[last].y - route[last - 1].y);
  const length = sameSegment && ends.start && ends.end
    ? Math.min(fullLength, Math.max(0, segmentLength - startInset - endInset) / 2)
    : fullLength;
  const heads = [];
  const shaftPoints = route.map((point) => ({ ...point }));
  if (ends.start) {
    const head = arrowheadGeometry(route[first], route[first - 1], length, halfWidth, startInset);
    if (head) {
      heads.push({ ...head, placement: 'start' });
      shaftPoints[0] = head.shaft;
    }
  }
  if (ends.end) {
    const head = arrowheadGeometry(route[last - 1], route[last], length, halfWidth, endInset);
    if (head) {
      heads.push({ ...head, placement: 'end' });
      shaftPoints[shaftPoints.length - 1] = head.shaft;
    }
  }
  return { shaftPoints, heads };
}
