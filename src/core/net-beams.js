/**
 * Net beams: while the pointer is over a net, a curved beam of light from the
 * pointer to each other physical net its name connects it to (the virtual
 * connections of equal names), the way Virtuoso shows them. Geometry only;
 * the editor draws it (src/web/net-beams.js) and nothing of it is saved.
 */

import { isReferenceMarker } from './model.js';

/** The point of segment a–b nearest p. */
function nearestOnSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/** Where a beam from `from` lands on `net`: the nearest point of its wires,
 *  or, for a net drawn without any (pin on pin), its nearest terminal. */
export function beamLanding(net, from) {
  let best = null;
  let bestDistance = Infinity;
  const consider = (q) => {
    const distance = Math.hypot(q.x - from.x, q.y - from.y);
    if (distance < bestDistance) { best = q; bestDistance = distance; }
  };
  for (const path of net.paths()) {
    if (path.length === 1) consider(path[0]);
    for (let i = 1; i < path.length; i++) consider(nearestOnSegment(from, path[i - 1], path[i]));
  }
  if (!best) for (const q of net.terminalWorlds()) if (q) consider(q);
  return best;
}

/** The terminals of the supplies, grounds, and VCMs on `net`: what a beam
 *  reaching a net that one stands for lands on. */
export function markerTerminals(circuit, net) {
  return net.terminals
    .filter(({ comp }) => isReferenceMarker(circuit.components.get(comp)))
    .map(({ comp, term }) => circuit.components.get(comp).terminalWorld(term))
    .filter(Boolean);
}

function nearest(points, from) {
  let best = null;
  for (const q of points) if (!best || Math.hypot(q.x - from.x, q.y - from.y) < Math.hypot(best.x - from.x, best.y - from.y)) best = q;
  return best;
}

/** Each beam from `from` (a world point) over the net `sourceId` to the
 *  other nets of `ids` (its named group): `{ netId, to }`, nearest first.
 *  A net with a supply, ground, or VCM on it is reached at that symbol's
 *  terminal, so a beam between two of them runs terminal to terminal. */
export function netBeams(circuit, ids, sourceId, from) {
  const beams = [];
  for (const id of ids) {
    if (id === sourceId) continue;
    const net = circuit.nets.get(id);
    const to = net ? nearest(net.terminals ? markerTerminals(circuit, net) : [], from) || beamLanding(net, from) : null;
    if (to) beams.push({ netId: id, to });
  }
  return beams.sort((a, b) => Math.hypot(a.to.x - from.x, a.to.y - from.y) - Math.hypot(b.to.x - from.x, b.to.y - from.y));
}

/**
 * A beam's outline from `from` to `to`: a band arched over the top (above
 * both ends, whichever way it runs), `narrow` at either end and fanning out
 * to `wide` in its middle, the same both ways. Returns `{ outline, core }`,
 * an SVG path for the band and one for its center line, or null for a beam
 * too short to draw.
 */
export function beamShape(from, to, { narrow, wide, steps = 32 }) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < wide) return null;
  // The arch rises above the higher end by a share of the beam's length. A
  // beam nearly straight up or down leans its arch to one side, so it bulges
  // over rather than doubling back on itself.
  const top = Math.min(from.y, to.y) - 0.2 * length;
  const side = dx < 0 ? -1 : 1;
  const middle = from.x + dx / 2 + side * Math.max(0, 0.12 * length - Math.abs(dx) / 6);
  const c1 = { x: middle - dx / 6, y: top };
  const c2 = { x: middle + dx / 6, y: top };
  const at = (t) => {
    const u = 1 - t;
    return {
      x: u * u * u * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * to.x,
      y: u * u * u * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * to.y,
    };
  };
  const heading = (t) => {
    const u = 1 - t;
    return {
      x: 3 * u * u * (c1.x - from.x) + 6 * u * t * (c2.x - c1.x) + 3 * t * t * (to.x - c2.x),
      y: 3 * u * u * (c1.y - from.y) + 6 * u * t * (c2.y - c1.y) + 3 * t * t * (to.y - c2.y),
    };
  };
  const left = [];
  const right = [];
  const center = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = at(t);
    const d = heading(t);
    const len = Math.hypot(d.x, d.y) || 1;
    const half = (narrow + (wide - narrow) * Math.sin(Math.PI * t)) / 2;
    left.push({ x: p.x - (d.y / len) * half, y: p.y + (d.x / len) * half });
    right.push({ x: p.x + (d.y / len) * half, y: p.y - (d.x / len) * half });
    center.push(p);
  }
  const f = (v) => String(Math.round(v * 10) / 10);
  const line = (points) => points.map((p, i) => `${i ? 'L' : 'M'} ${f(p.x)} ${f(p.y)}`).join(' ');
  return { outline: `${line([...left, ...right.reverse()])} Z`, core: line(center) };
}
