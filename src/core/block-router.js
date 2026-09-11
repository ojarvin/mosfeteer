import { GRID, onGrid } from './grid.js';

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

function compress(points) {
  const out = [];
  for (const point of points) {
    const p = { x: point.x, y: point.y };
    if (out.length && samePoint(out[out.length - 1], p)) continue;
    out.push(p);
  }
  for (let i = out.length - 2; i > 0; i--) {
    const a = out[i - 1];
    const b = out[i];
    const c = out[i + 1];
    const horizontal = a.y === b.y && b.y === c.y;
    const vertical = a.x === b.x && b.x === c.x;
    const between = (value, left, right) => value >= Math.min(left, right) && value <= Math.max(left, right);
    if ((horizontal && between(b.x, a.x, c.x)) || (vertical && between(b.y, a.y, c.y))) out.splice(i, 1);
  }
  return out;
}

function segmentDirection(a, b) {
  return { x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) };
}

function orthogonal(points) {
  return points.every((point, i) => i === 0 || point.x === points[i - 1].x || point.y === points[i - 1].y);
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
  return compress(moved);
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
      if (next.x < minX || next.x > maxX || next.y < minY || next.y > maxY || blocked(next)) continue;
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
  const escape = add(source, sourceDir, GRID);
  const approach = add(target, targetDir, GRID);
  const rects = blocksOf(diagram).map((block) => expandedRect(block, clearance));
  // Adjacent facing terminals reserve the same one-cell gap in opposite
  // directions. Do not emit a backtracking route for that degenerate search.
  if (samePoint(escape, target) && samePoint(approach, source) && arrow.from.block !== arrow.to.block) return [source, target];
  // Prefer a simple L route when it is safe. For diagonal layouts, compare
  // both elbows by how evenly they split the route length; this is only a
  // fresh-layout preference, not a fixed-route constraint.
  const elbows = [
    { x: approach.x, y: escape.y },
    { x: escape.x, y: approach.y },
  ];
  const simple = elbows.map((elbow) => compress([escape, elbow, approach]))
    .filter((path) => path.length >= 2 && path.every((point, i) => i === 0 || segmentClear(path[i - 1], point, rects)));
  if (simple.length) {
    const length = (a, b) => Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    simple.sort((a, b) => {
      const balance = (path) => path.length < 3 ? 0 : Math.abs(length(path[0], path[1]) - length(path[1], path[2]));
      return balance(a) - balance(b) || pointKey(a[1]).localeCompare(pointKey(b[1]));
    });
    const route = compress([source, ...simple[0], target]);
    if (route.length >= 2 && orthogonal(route)) return route;
  }
  // The source and target body are still obstacles. Their boundary points are
  // legal, while the reserved one-cell escape puts the search outside.
  const middle = routeGrid(escape, approach, { rects, clearance, diagram });
  if (!middle) return null;
  const route = compress([source, escape, ...middle.slice(1, -1), approach, target]);
  if (route.length < 2 || !orthogonal(route)) return null;
  if (!samePoint(route[0], source) || !samePoint(route[route.length - 1], target)) return null;
  return route;
}

/** Return routes for all automatic arrows without changing the input. */
export function routeBlockDiagram(diagram, options = {}) {
  const arrows = diagram?.arrows instanceof Map ? [...diagram.arrows.values()] : (diagram?.arrows || []);
  const routes = new Map();
  for (const arrow of arrows) {
    if (arrow.detached || arrow.routingMode === 'fixed') continue;
    const points = routeBlockArrow(diagram, arrow, options);
    if (!points) return null;
    routes.set(arrow.id, points);
  }
  return routes;
}

/** Apply all automatic routes at one explicit commit boundary. */
export function rerouteBlockDiagram(diagram, options = {}) {
  const routes = routeBlockDiagram(diagram, options);
  if (!routes) return false;
  for (const [id, points] of routes) {
    const arrow = diagram.arrows instanceof Map ? diagram.arrows.get(id) : diagram.arrows.find((item) => item.id === id);
    arrow.points = points.map((point) => ({ ...point }));
  }
  return true;
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
    shaftPoints: compress(shaftPoints),
    tip: { ...tip },
    left,
    right,
  };
}

export function routeIsOrthogonal(points) {
  return Array.isArray(points) && points.length >= 2 && orthogonal(points);
}

