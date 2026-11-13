/**
 * A part drawn thin or thick keeps its proportions: its strokes scale by
 * role (style.js widthFactor), and so do its filled shapes -- the bars of a
 * MOSFET's gate and channel, a supply's slab, the arrowheads. Each shape
 * scales about where its strokes meet it, so no lead comes loose: a bar
 * keeps the long edge its leads reach, an arrowhead its tip on the line it
 * rides (or its base, where a stroke ends there, as the sampler's arc does).
 * A ring keeps its outer edge, its radius taking up what its stroke gives,
 * so what touches it from outside (a switch's arm at its pivot and on its
 * contact) still does, and a lead ending on its line still reaches it. A
 * dot (a solder dot) scales its radius as an arrowhead its size.
 */

import { roleWidth, widthFactor } from './style.js';

// A bar's thickness grows less than its strokes when thick, so a gate's
// gap between its two bars stays open; an arrowhead's size goes as the
// square root, readable thin and not heavy thick.
const BAR_FACTOR = { thin: 0.5, thick: 1.25 };
const arrowFactor = (width) => Math.sqrt(widthFactor(width));

/** Every point a symbol's strokes reach: their paths' vertices and ends. */
function strokePoints(graphics) {
  const points = [];
  for (const g of graphics) {
    if (g.kind !== 'path' || typeof g.d !== 'string') continue;
    for (const [, command, args] of g.d.matchAll(/([MLA])([^MLAZz]*)/gi)) {
      const numbers = (args.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
      const step = command.toUpperCase() === 'A' ? 7 : 2;
      for (let i = step - 2; i + 1 < numbers.length; i += step) points.push({ x: numbers[i], y: numbers[i + 1] });
    }
  }
  return points;
}

// How near a stroke's end is to a point for it to meet it there.
const TOUCH = 5;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const nearest = (point, points) => Math.min(Infinity, ...points.map((p) => distance(point, p)));
const scaleAbout = (p, about, k) => ({ x: about.x + (p.x - about.x) * k, y: about.y + (p.y - about.y) * k });

/** An axis-aligned bar's thickness scaled by `k`, keeping its long edge
 *  nearer the strokes. */
function scaledBar(points, reach, k) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const across = x1 - x0 < y1 - y0 ? 'x' : 'y';
  const [low, high] = across === 'x' ? [x0, x1] : [y0, y1];
  // The long edge a stroke reaches stays; the other moves. A lead meets an
  // edge anywhere along it (a channel's drain and source near its ends).
  const [from, to] = across === 'x' ? [y0, y1] : [x0, x1];
  const toEdge = (value) => Math.min(Infinity, ...reach.map((p) => {
    const [a, b] = across === 'x' ? [p.x, p.y] : [p.y, p.x];
    return Math.hypot(a - value, Math.max(from - b, 0, b - to));
  }));
  const keepLow = toEdge(low) <= toEdge(high);
  const thickness = (high - low) * k;
  const [a, b] = keepLow ? [low, low + thickness] : [high - thickness, high];
  return points.map((p) => (across === 'x' ? { x: p.x === low ? a : b, y: p.y } : { x: p.x, y: p.y === low ? a : b }));
}

/** An arrowhead scaled by `k`: about its tip where a stroke ends there,
 *  about its base's middle where one ends there instead (the sampler's
 *  arc), and narrowed across alone, its tip and base kept, where strokes
 *  end at both (a BJT's emitter: the lead at its tip, the diagonal at its
 *  base). A stroke ends at a point within a cell's eighth of it. */
function scaledArrow(points, reach, k) {
  const edges = points.map((p, i) => ({ i, length: distance(points[(i + 1) % 3], points[(i + 2) % 3]) }));
  const tip = points[edges.reduce((a, b) => (b.length < a.length ? b : a)).i];
  const base = points.filter((p) => p !== tip);
  const middle = { x: (base[0].x + base[1].x) / 2, y: (base[0].y + base[1].y) / 2 };
  const meets = (point) => nearest(point, reach) <= TOUCH;
  if (meets(tip) && meets(middle)) return points.map((p) => (p === tip ? p : scaleAbout(p, middle, k)));
  const about = !meets(tip) && meets(middle) ? middle : nearest(tip, reach) <= nearest(middle, reach) ? tip : middle;
  return points.map((p) => scaleAbout(p, about, k));
}

const cache = new WeakMap();

/** `graphics` as a part of line width `width` ('thin', 'thick', or
 *  normal) draws them: the filled shapes scaled; the rest as they are. */
export function weightedGraphics(graphics, width) {
  if (width !== 'thin' && width !== 'thick') return graphics;
  let byWidth = cache.get(graphics);
  if (!byWidth) cache.set(graphics, (byWidth = {}));
  if (byWidth[width]) return byWidth[width];
  const reach = strokePoints(graphics);
  const factor = widthFactor(width);
  byWidth[width] = graphics.map((g) => {
    if (g.kind === 'circle' && Number.isFinite(g.r)) {
      const stroke = roleWidth(g.style || 'symbol');
      return { ...g, r: g.r + (stroke - stroke * factor) / 2 };
    }
    // A dot marks a junction: it keeps more of its weight thin, as an arrowhead does.
    if (g.kind === 'dot' && Number.isFinite(g.r)) return { ...g, r: g.r * arrowFactor(width) };
    if (g.kind !== 'polygon' || g.fill !== 'foreground' || !Array.isArray(g.points)) return g;
    if (g.points.length === 4) {
      const xs = new Set(g.points.map((p) => p.x));
      const ys = new Set(g.points.map((p) => p.y));
      if (xs.size === 2 && ys.size === 2) return { ...g, points: scaledBar(g.points, reach, BAR_FACTOR[width]) };
    }
    if (g.points.length === 3) return { ...g, points: scaledArrow(g.points, reach, arrowFactor(width)) };
    return g;
  });
  return byWidth[width];
}
