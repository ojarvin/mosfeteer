import { GRID, onGrid, snap } from './grid.js';

export const BLOCK_ARROWHEAD_LENGTH = 32;
export const BLOCK_ARROWHEAD_HALF_WIDTH = 18;
const DIRECTIONS = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];

const pointKey = (p) => `${p.x},${p.y}`;
const samePoint = (a, b) => a.x === b.x && a.y === b.y;

function blocksOf(diagram) {
  return diagram?.blocks instanceof Map ? [...diagram.blocks.values()] : (diagram?.blocks || []);
}

function blockOf(diagram, id) {
  if (typeof diagram?.getBlock === 'function') return diagram.getBlock(id);
  return blocksOf(diagram).find((block) => block.id === id);
}

function terminalOf(diagram, ref) {
  if (!ref || !ref.block || !ref.terminal) return null;
  const block = blockOf(diagram, ref.block);
  if (!block) return null;
  if (typeof block.getTerminal === 'function') return block.getTerminal(ref.terminal);
  return block.terminals instanceof Map
    ? block.terminals.get(ref.terminal)
    : (block.terminals || []).find((terminal) => terminal.id === ref.terminal);
}

function terminalPoint(diagram, ref) {
  const block = blockOf(diagram, ref.block);
  const terminal = terminalOf(diagram, ref);
  if (!block || !terminal) return null;
  if (typeof terminal.point === 'function') return terminal.point(block.rect);
  const { x, y, w, h } = block.rect;
  switch (terminal.side) {
    case 'top': return { x: x + terminal.offset, y };
    case 'right': return { x: x + w, y: y + terminal.offset };
    case 'bottom': return { x: x + terminal.offset, y: y + h };
    case 'left': return { x, y: y + terminal.offset };
    default: return null;
  }
}

function terminalDirection(terminal) {
  if (typeof terminal?.direction === 'function') return terminal.direction();
  return {
    top: { x: 0, y: -1 },
    right: { x: 1, y: 0 },
    bottom: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
  }[terminal?.side] || null;
}

function add(a, b, scale = 1) {
  return { x: a.x + b.x * scale, y: a.y + b.y * scale };
}

function expandedRect(block, clearance) {
  const r = block.rect;
  return { x: r.x - clearance, y: r.y - clearance, w: r.w + clearance * 2, h: r.h + clearance * 2 };
}

function strictlyInside(point, rect) {
  return point.x > rect.x && point.x < rect.x + rect.w && point.y > rect.y && point.y < rect.y + rect.h;
}

function segmentDirection(a, b) {
  return { x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) };
}

function orthogonal(points) {
  return points.every((point, i) => i === 0 || point.x === points[i - 1].x || point.y === points[i - 1].y);
}

/** Compact a block-arrow path without importing electrical wire geometry.
 * Collinear middles are removed in either direction: block connectors never
 * retain a 180-degree fold or the dangling stick it creates. */
function compactPath(path = []) {
  const out = [];
  for (const raw of path) {
    const point = { x: raw.x, y: raw.y };
    if (out.length && samePoint(out.at(-1), point)) continue;
    out.push(point);
    while (out.length >= 3) {
      const a = out.at(-3); const b = out.at(-2); const c = out.at(-1);
      if (!((a.y === b.y && b.y === c.y) || (a.x === b.x && b.x === c.x))) break;
      out.splice(out.length - 2, 1);
      if (out.length >= 2 && samePoint(out.at(-1), out.at(-2))) out.pop();
    }
  }
  return out;
}

function pruneStartEscapeLoop(points) {
  if (points.length < 6) return points;
  const [pin, escape, sideA, sideB, returned, continuation] = points;
  const horizontal = pin.y === escape.y;
  const outward = horizontal ? escape.x !== pin.x : escape.y !== pin.y;
  const rectangle = outward &&
    (horizontal
      ? escape.x === sideA.x && sideA.y === sideB.y && sideB.x === returned.x && returned.y === pin.y && continuation.x === returned.x
      : escape.y === sideA.y && sideA.x === sideB.x && sideB.y === returned.y && returned.x === pin.x && continuation.y === returned.y);
  if (!rectangle) return points;
  const shiftedContinuation = horizontal
    ? { x: escape.x, y: continuation.y }
    : { x: continuation.x, y: escape.y };
  return compactPath([pin, escape, shiftedContinuation, ...points.slice(6)]);
}

/** Remove the rectangular one-cell escape-and-return artifact at either end
 * while retaining every bend beyond the adjacent perpendicular run. */
export function pruneBlockArrowEndpointLoops(points = []) {
  let route = pruneStartEscapeLoop(points.map((point) => ({ ...point })));
  route = compactPath(route);
  route = pruneStartEscapeLoop([...route].reverse()).reverse();
  return compactPath(route);
}

/** Junction dots appear only where connectors share a trunk and then branch.
 * Ordinary geometric crossings have no repeated incident direction and stay
 * visually unconnected. */
export function blockConnectorJunctions(diagram) {
  const arrows = diagram?.arrows instanceof Map ? [...diagram.arrows.values()] : diagram?.arrows || [];
  const vertices = new Map();
  for (const arrow of arrows) for (const p of arrow.points || []) {
    const key = pointKey(p);
    if (!vertices.has(key)) vertices.set(key, { point: { ...p }, arrows: new Set() });
    vertices.get(key).arrows.add(arrow.id);
  }
  const result = [];
  for (const { point: p } of vertices.values()) {
    const directions = new Map();
    const touchingArrows = new Set();
    for (const arrow of arrows) {
      for (let i = 1; i < (arrow.points || []).length; i++) {
        const a = arrow.points[i - 1]; const b = arrow.points[i];
        if (samePoint(a, b)) continue;
        const onSegment = (a.x === b.x && p.x === a.x && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y)) ||
          (a.y === b.y && p.y === a.y && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x));
        if (!onSegment) continue;
        touchingArrows.add(arrow.id);
        for (const end of [a, b]) {
          if (samePoint(p, end)) continue;
          const d = segmentDirection(p, end); const key = `${d.x},${d.y}`;
          directions.set(key, (directions.get(key) || 0) + 1);
        }
      }
    }
    if (touchingArrows.size >= 2 && directions.size >= 3 && Math.max(...directions.values()) >= 2) result.push(p);
  }
  return result;
}

/** Preserve fixed route bodies while restoring the mandatory outward source
 * leg and inward target leg after a segment drag or endpoint mutation. */
export function conformBlockArrowEndpoints(diagram, arrow, points = arrow?.points || []) {
  let route = pruneBlockArrowEndpointLoops(points);
  if (route.length < 2) return route;
  const source = arrow.from ? terminalPoint(diagram, arrow.from) : null;
  const target = arrow.to ? terminalPoint(diagram, arrow.to) : null;
  const sourceDir = arrow.from ? terminalDirection(terminalOf(diagram, arrow.from)) : null;
  const targetDir = arrow.to ? terminalDirection(terminalOf(diagram, arrow.to)) : null;
  const directionMatches = (a, b, dir) => {
    const actual = segmentDirection(a, b);
    return actual.x === dir.x && actual.y === dir.y;
  };
  const outwardBridge = (pin, escape, next, dir) => {
    // When a moved block overtakes the authored route body, returning directly
    // from the escape point would create a 180-degree fold. Leave the pin,
    // step sideways, and only then travel back toward the retained body.
    const forward = (next.x - pin.x) * dir.x + (next.y - pin.y) * dir.y;
    if (forward <= 0) {
      const normal = { x: -dir.y, y: dir.x };
      const channel = add(escape, normal, GRID);
      const besideNext = dir.x ? { x: next.x, y: channel.y } : { x: channel.x, y: next.y };
      return [escape, channel, besideNext, next];
    }
    if (escape.x === next.x || escape.y === next.y) return [escape];
    // The first turn after the mandatory escape must be perpendicular to it.
    return [escape, dir.x ? { x: escape.x, y: next.y } : { x: next.x, y: escape.y }];
  };
  if (source && sourceDir && !directionMatches(source, route[1], sourceDir)) {
    const escape = add(source, sourceDir, GRID);
    const next = route[1];
    const following = route[2];
    const overtaken = (next.x - source.x) * sourceDir.x + (next.y - source.y) * sourceDir.y <= 0;
    if (overtaken && following && (sourceDir.x ? following.x === next.x : following.y === next.y)) {
      // Push only the first bend and its perpendicular run. Every later bend
      // keeps its authored coordinate, so moving a block does not redraw the
      // rest of a valid connector.
      const shiftedFollowing = sourceDir.x
        ? { x: escape.x, y: following.y }
        : { x: following.x, y: escape.y };
      route = compactPath([source, escape, shiftedFollowing, ...route.slice(3)]);
    } else {
      const bridge = outwardBridge(source, escape, next, sourceDir);
      route = compactPath([source, ...bridge, ...route.slice(1)]);
    }
  }
  if (target && targetDir && !directionMatches(target, route.at(-2), targetDir)) {
    const approach = add(target, targetDir, GRID);
    const previous = route.at(-2);
    const preceding = route.at(-3);
    const overtaken = (previous.x - target.x) * targetDir.x + (previous.y - target.y) * targetDir.y <= 0;
    if (overtaken && preceding && (targetDir.x ? preceding.x === previous.x : preceding.y === previous.y)) {
      const shiftedPreceding = targetDir.x
        ? { x: approach.x, y: preceding.y }
        : { x: preceding.x, y: approach.y };
      route = compactPath([...route.slice(0, -3), shiftedPreceding, approach, target]);
    } else {
      const bridge = outwardBridge(target, approach, previous, targetDir).reverse();
      route = compactPath([...route.slice(0, -1), ...bridge, target]);
    }
  }
  return route;
}

/** Shift one orthogonal run while keeping attached endpoints fixed. */
export function moveBlockArrowRun(points, run, delta) {
  if (!Array.isArray(points) || points.length < 2 || !run) return points;
  const lo = Math.max(0, Math.min(points.length - 1, run.lo));
  const hi = Math.max(lo, Math.min(points.length - 1, run.hi));
  const offset = run.orient === 'h' ? { x: 0, y: delta } : { x: delta, y: 0 };
  const shifted = (point) => ({ x: point.x + offset.x, y: point.y + offset.y });
  const moved = [];
  if (lo === 0) moved.push({ ...points[0] });
  else moved.push(...points.slice(0, lo).map((point) => ({ ...point })));
  moved.push(...points.slice(lo, hi + 1).map(shifted));
  if (hi === points.length - 1) moved.push({ ...points.at(-1) });
  else moved.push(...points.slice(hi + 1).map((point) => ({ ...point })));
  return compactPath(moved);
}

function segmentClear(a, b, rects) {
  for (const rect of rects) {
    if (a.x === b.x && a.x > rect.x && a.x < rect.x + rect.w &&
        Math.max(a.y, b.y) > rect.y && Math.min(a.y, b.y) < rect.y + rect.h) return false;
    if (a.y === b.y && a.y > rect.y && a.y < rect.y + rect.h &&
        Math.max(a.x, b.x) > rect.x && Math.min(a.x, b.x) < rect.x + rect.w) return false;
  }
  return true;
}

// Two connector runs may cross, but they must not occupy the same positive
// length collinear span.  Keeping this check in the block router (instead of
// electrical wiring) is intentional: block connectors are visual arrows.
function segmentOverlaps(a, b, c, d) {
  if (a.y === b.y && c.y === d.y && a.y === c.y) {
    return Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) >
      Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x));
  }
  if (a.x === b.x && c.x === d.x && a.x === c.x) {
    return Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) >
      Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y));
  }
  return false;
}

const occupiedPoints = (entry) => Array.isArray(entry) ? entry : entry?.points || [];
const sameRef = (a, b) => a?.block === b?.block && a?.terminal === b?.terminal;

function pathOverlaps(path, occupied = []) {
  for (let i = 1; i < path.length; i++) {
    for (const entry of occupied) {
      const other = occupiedPoints(entry);
      for (let j = 1; j < other.length; j++) {
        if (segmentOverlaps(path[i - 1], path[i], other[j - 1], other[j])) return true;
      }
    }
  }
  return false;
}

function routeGrid(start, goal, obstacles) {
  if (samePoint(start, goal)) return [start];
  const coords = [start, goal];
  for (const block of blocksOf(obstacles.diagram)) {
    coords.push(
      { x: block.rect.x - obstacles.clearance, y: block.rect.y - obstacles.clearance },
      { x: block.rect.x + block.rect.w + obstacles.clearance, y: block.rect.y + block.rect.h + obstacles.clearance },
    );
  }
  const minX = Math.floor(Math.min(...coords.map((p) => p.x)) / GRID) * GRID - GRID * 2;
  const maxX = Math.ceil(Math.max(...coords.map((p) => p.x)) / GRID) * GRID + GRID * 2;
  const minY = Math.floor(Math.min(...coords.map((p) => p.y)) / GRID) * GRID - GRID * 2;
  const maxY = Math.ceil(Math.max(...coords.map((p) => p.y)) / GRID) * GRID + GRID * 2;
  const blocked = (point) => obstacles.rects.some((rect) => strictlyInside(point, rect)) && !samePoint(point, start) && !samePoint(point, goal);
  if (blocked(start) || blocked(goal)) return null;

  // Dijkstra with a lexicographic (turns, length) cost keeps routes stable and
  // prefers readable elbows before shaving a grid cell off the path.
  const states = new Map();
  const queue = [{ point: start, dir: -1, turns: 0, steps: 0, key: `${pointKey(start)}|-1` }];
  states.set(queue[0].key, queue[0]);
  const previous = new Map();
  const compare = (a, b) => a.turns - b.turns || a.steps - b.steps || a.key.localeCompare(b.key);
  while (queue.length) {
    queue.sort(compare);
    const current = queue.shift();
    if (current.point.x === goal.x && current.point.y === goal.y) {
      const path = [];
      let state = current;
      while (state) {
        path.push(state.point);
        state = previous.get(state.key);
      }
      return path.reverse();
    }
    for (let dir = 0; dir < DIRECTIONS.length; dir++) {
      const next = add(current.point, DIRECTIONS[dir], GRID);
      if (next.x < minX || next.x > maxX || next.y < minY || next.y > maxY || blocked(next) ||
          obstacles.occupied?.some((entry) => occupiedPoints(entry).some((point, i, path) => i > 0 && segmentOverlaps(current.point, next, path[i - 1], point)))) continue;
      const turns = current.turns + (current.dir !== -1 && current.dir !== dir ? 1 : 0);
      const steps = current.steps + 1;
      const key = `${pointKey(next)}|${dir}`;
      const old = states.get(key);
      if (old && compare(old, { turns, steps, key }) <= 0) continue;
      const state = { point: next, dir, turns, steps, key };
      states.set(key, state);
      previous.set(key, current);
      queue.push(state);
    }
  }
  return null;
}

/**
 * Route one block arrow without mutating the diagram. The first and last
 * segments are reserved terminal escape legs; crossings with other arrows are
 * intentionally ignored because they are visual, not electrical, topology.
 */
export function routeBlockArrow(diagram, arrow, options = {}) {
  const from = terminalOf(diagram, arrow.from);
  const to = terminalOf(diagram, arrow.to);
  const source = terminalPoint(diagram, arrow.from);
  const target = terminalPoint(diagram, arrow.to);
  const sourceDir = terminalDirection(from);
  const targetDir = terminalDirection(to);
  if (!source || !target || !sourceDir || !targetDir) return null;
  if (![source, target].every((p) => onGrid(p.x) && onGrid(p.y))) return null;

  const clearance = options.clearance ?? GRID;
  const escape = add(source, sourceDir, clearance);
  const approach = add(target, targetDir, clearance);
  const rects = blocksOf(diagram).map((block) => expandedRect(block, clearance));
  // Fan-out connectors from the same source terminal may share their trunk
  // before branching. Other connectors remain overlap obstacles.
  const occupied = (options.occupied || []).filter((entry) =>
    ![entry?.from, entry?.to].some((ref) => [arrow.from, arrow.to].some((endpoint) => sameRef(ref, endpoint))));
  // Adjacent facing terminals reserve the same one-cell gap in opposite
  // directions. Do not emit a backtracking route for that degenerate search.
  if (samePoint(escape, target) && samePoint(approach, source) && arrow.from.block !== arrow.to.block) return [source, target];
  // Compare every unobstructed simple candidate lexicographically by bend
  // count and only then by length. A longer outside L is clearer than a
  // shorter staircase; the centered dogleg is only preferred among routes
  // with the same number of bends.
  const midpoint = sourceDir.x
    ? snap((escape.x + approach.x) / 2)
    : snap((escape.y + approach.y) / 2);
  const midpointPath = compactPath(sourceDir.x
    ? [escape, { x: midpoint, y: escape.y }, { x: midpoint, y: approach.y }, approach]
    : [escape, { x: escape.x, y: midpoint }, { x: approach.x, y: midpoint }, approach]);
  const elbows = [
    { x: approach.x, y: escape.y },
    { x: escape.x, y: approach.y },
  ];
  const simple = [midpointPath, ...elbows.map((elbow) => compactPath([escape, elbow, approach]))]
    .filter((path) => path.length >= 2 &&
      path.every((point, i) => i === 0 || segmentClear(path[i - 1], point, rects)) &&
      !pathOverlaps(path, occupied))
    .map((path) => compactPath([source, ...path, target]))
    .filter((path) => path.length >= 2 && orthogonal(path));
  if (simple.length) {
    const turns = (path) => path.slice(2).reduce((count, point, index) => {
      const a = path[index]; const b = path[index + 1];
      return count + ((a.x === b.x) !== (b.x === point.x) ? 1 : 0);
    }, 0);
    const length = (path) => path.slice(1).reduce((sum, point, index) =>
      sum + Math.abs(point.x - path[index].x) + Math.abs(point.y - path[index].y), 0);
    const balance = (path) => path.length < 4 ? 0 :
      Math.abs((Math.abs(path[1].x - path[0].x) + Math.abs(path[1].y - path[0].y)) -
        (Math.abs(path.at(-1).x - path.at(-2).x) + Math.abs(path.at(-1).y - path.at(-2).y)));
    simple.sort((a, b) => turns(a) - turns(b) || balance(a) - balance(b) || length(a) - length(b) ||
      a.map(pointKey).join('|').localeCompare(b.map(pointKey).join('|')));
    return simple[0];
  }
  // The source and target body are still obstacles. Their boundary points are
  // legal, while the reserved one-cell escape puts the search outside.
  const middle = routeGrid(escape, approach, { rects, clearance, diagram, occupied });
  if (!middle) return null;
  const route = compactPath([source, escape, ...middle.slice(1, -1), approach, target]);
  if (route.length < 2 || !orthogonal(route) || pathOverlaps(route, occupied)) return null;
  if (!samePoint(route[0], source) || !samePoint(route[route.length - 1], target)) return null;
  return route;
}

/** Return routes for all automatic arrows without changing the input. */
export function routeBlockDiagram(diagram, options = {}) {
  const arrows = diagram?.arrows instanceof Map ? [...diagram.arrows.values()] : (diagram?.arrows || []);
  const routes = new Map();
  const occupied = [...(options.occupied || [])];
  for (const arrow of arrows) {
    if (arrow.detached || arrow.routingMode === 'fixed') continue;
    const points = routeBlockArrow(diagram, arrow, { ...options, occupied });
    if (!points) return null;
    routes.set(arrow.id, points);
    occupied.push({ points, from: arrow.from, to: arrow.to });
  }
  return routes;
}

/**
 * Exact filled head geometry for a route whose last point is the target
 * terminal. The tip is never extended past that terminal.
 */
export function blockArrowGeometry(points, options = {}) {
  const route = points?.points || points;
  if (!Array.isArray(route) || route.length < 2) throw new Error('arrow geometry requires at least two points');
  let tip = route[route.length - 1];
  let i = route.length - 2;
  while (i >= 0 && samePoint(route[i], tip)) i--;
  if (i < 0) throw new Error('arrow geometry requires a non-zero final segment');
  const previous = route[i];
  const direction = segmentDirection(previous, tip);
  if (direction.x === 0 && direction.y === 0) throw new Error('arrow geometry requires an orthogonal final segment');
  const length = options.length ?? BLOCK_ARROWHEAD_LENGTH;
  const halfWidth = options.halfWidth ?? BLOCK_ARROWHEAD_HALF_WIDTH;
  const base = add(tip, direction, -length);
  const normal = { x: direction.y, y: -direction.x };
  const left = add(base, normal, halfWidth);
  const right = add(base, normal, -halfWidth);
  const shaftPoints = route.slice(0, i + 1).map((point) => ({ ...point }));
  shaftPoints.push(base);
  return {
    shaftPoints: compactPath(shaftPoints),
    tip: { ...tip },
    left,
    right,
  };
}

export function routeIsOrthogonal(points) {
  return Array.isArray(points) && points.length >= 2 && orthogonal(points);
}
