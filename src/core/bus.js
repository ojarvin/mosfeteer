/**
 * Multi-bit nets, by the Virtuoso convention: a net named with a bit range,
 * `D[7:0]` or `D<7:0>`, stands for the parallel nets `D[7]` ... `D[0]`, and a
 * net named for one bit (`D[3]`, `D<3>`) anywhere else is virtually connected
 * to that bit. Square and angle brackets mean the same. The bus is still
 * drawn and listed as one net, marked with a short slash across its wire; it
 * belongs to the net, not to the parts on it (the ADC and DAC draw none of
 * their own), and it is drawn in world space: a `/` whichever way the wire
 * runs or the parts are turned.
 *
 * The slash sits at each part pin on the bus (busTerminalMarks): on the
 * pin's own outward line, at least one grid cell from where the conductor
 * meets the drawn part, in whole cells -- at the terminal when the symbol's
 * lead is that long already (an ADC's), one cell out along the wire when the
 * pin sits on or near the body's edge (a port, a block). A bus net with no pins marks each branch
 * mid-way instead (busMarkPoints).
 */

import { GRID } from './grid.js';
import { pointOnPath } from './wiring.js';

const BUS_NAME = /^(.*?)[[<]\s*(\d+)\s*(?::\s*(\d+)\s*)?[\]>]$/;

/** A bus or bus-bit name as { base, bits: [indices, first to last], range }
 *  (`D[3:0]` -> D, [3, 2, 1, 0], range), or null for any other name. */
export function busBits(name) {
  const match = BUS_NAME.exec(String(name ?? '').trim());
  if (!match || !match[1].trim()) return null;
  const from = Number(match[2]);
  const to = match[3] === undefined ? from : Number(match[3]);
  const step = from <= to ? 1 : -1;
  const bits = [];
  for (let bit = from; bit !== to + step; bit += step) bits.push(bit);
  return { base: match[1].trim(), bits, range: match[3] !== undefined };
}

/** Bits in a bus name (`D[7:0]` -> 8), or 0 for a single bit or any other name. */
export function busWidth(name) {
  const bus = busBits(name);
  return bus?.range ? bus.bits.length : 0;
}

/** One spelling for a bus or bit name, so square and angle brackets name
 *  the same group (`D[3:0]` and `D<3:0>` -> `D<3:0>`); null for a plain name. */
export function busGroupName(name) {
  const bus = busBits(name);
  if (!bus) return null;
  return bus.range ? `${bus.base}<${bus.bits[0]}:${bus.bits.at(-1)}>` : `${bus.base}<${bus.bits[0]}>`;
}

/** The highlight a bus-named net shows from `colors` (group name -> color,
 *  in the order the probes were made): the latest probe on any name it
 *  connects to (netNamesConnect). A bus shows the bit probed last, a bit
 *  shows a bus probed after it, and a probe on one bit never reaches
 *  another. */
export function latestBusColor(name, colors) {
  if (!busBits(name)) return null;
  let latest = null;
  for (const [group, color] of colors) if (color && netNamesConnect(name, group)) latest = color;
  return latest;
}

/** The groups among `names` that a probe on bus range `name` recolors: its
 *  bits and part ranges, all inside it (not itself). */
export function busGroupsWithin(name, names) {
  const bus = busBits(name);
  if (!bus?.range) return [];
  const own = busGroupName(name);
  return names.filter((other) => {
    const inner = busBits(other);
    return inner && busGroupName(other) !== own && inner.base === bus.base && inner.bits.every((bit) => bus.bits.includes(bit));
  });
}

/** Whether two net names are virtually connected: the same name, or two
 *  names of one bus that share a bit (`D[3:0]` and `D<1>`). */
export function netNamesConnect(a, b) {
  const left = String(a ?? '').trim();
  const right = String(b ?? '').trim();
  if (!left || !right) return false;
  if (left === right) return true;
  const x = busBits(left);
  const y = busBits(right);
  return !!x && !!y && x.base === y.base && x.bits.some((bit) => y.bits.includes(bit));
}

/** Half extents of the slash: one grid cell across the wire, leaning 3
 *  along it for every 4 across. */
const SLASH = { along: 15, across: 20 };

/**
 * Where a bus's slashes go on its drawn `paths`, keeping clear of the net
 * label anchors `avoid`: [{ x, y, horizontal }].
 */
export function busMarkPoints(paths, avoid = []) {
  const marks = [];
  for (const path of paths) {
    if (!path || path.length < 2) continue;
    let best = null;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      if (a.x !== b.x && a.y !== b.y) continue; // a diagonal keeps its own look
      const length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      if (length > 0 && (!best || length > best.length)) best = { a, b, length };
    }
    if (!best) continue;
    const { a, b, length } = best;
    const ux = Math.sign(b.x - a.x);
    const uy = Math.sign(b.y - a.y);
    const at = (t) => ({ x: a.x + ux * t, y: a.y + uy * t });
    let t = length / 2;
    const near = (p) => avoid.some((q) => Math.abs(q.x - p.x) + Math.abs(q.y - p.y) < GRID);
    if (near(at(t))) {
      const moved = [t - GRID, t + GRID].find((s) => s >= GRID / 2 && s <= length - GRID / 2 && !near(at(s)));
      if (moved !== undefined) t = moved;
    }
    marks.push({ ...at(t), horizontal: uy === 0 });
  }
  return marks;
}

/** How far a symbol's conductor runs straight in from terminal `t` (local
 *  coordinates) before it meets the drawn part: the first segment of the
 *  terminal's lead, or 0 for a pin on the body's edge. */
export function straightLeadLength(graphics, t) {
  let longest = 0;
  for (const g of graphics || []) {
    if (!g.terminalLead) continue;
    const numbers = String(g.d).match(/-?\d*\.?\d+(?:e-?\d+)?/gi)?.map(Number) || [];
    const points = [];
    for (let i = 0; i + 1 < numbers.length; i += 2) points.push({ x: numbers[i], y: numbers[i + 1] });
    for (const [end, next] of [[points[0], points[1]], [points.at(-1), points.at(-2)]]) {
      if (!end || !next || end.x !== t.x || end.y !== t.y) continue;
      if (next.x !== end.x && next.y !== end.y) continue; // a slanted lead is part of the drawing
      longest = Math.max(longest, Math.abs(next.x - end.x) + Math.abs(next.y - end.y));
    }
  }
  return longest;
}

/**
 * Where a bus net's slashes go: at each part pin on it, one grid cell clear of
 * the drawn part along the pin's outward line (at the terminal itself when
 * the lead is that long), or at the terminal when the wire turns before that.
 * A net with no pins marks each drawn branch mid-way (busMarkPoints).
 */
export function busTerminalMarks(circuit, net, paths, avoid = []) {
  const marks = [];
  for (const { comp, term } of net.terminals) {
    const component = circuit.components.get(comp);
    const def = component?.terminalDefs.find((terminal) => terminal.name === term);
    if (!def) continue;
    const at = component.terminalWorld(term);
    const dir = circuit._pinDir(component, def, at.x, at.y);
    // Whole cells out, so the slash stays on a grid point.
    const out = Math.max(0, Math.ceil((GRID - straightLeadLength(component.def.graphics, def)) / GRID) * GRID);
    const point = { x: at.x + dir.x * out, y: at.y + dir.y * out };
    const onWire = paths.some((path) => pointOnPath(point, path) && pointOnPath(at, path));
    marks.push({ ...(onWire ? point : at), horizontal: dir.y === 0 });
  }
  return marks.length ? marks : busMarkPoints(paths, avoid);
}

/** SVG path data for a slash at `mark`: a `/` across the wire. */
export function busMarkD({ x, y, horizontal }) {
  const dx = horizontal ? SLASH.along : SLASH.across;
  const dy = horizontal ? SLASH.across : SLASH.along;
  return `M ${x - dx} ${y + dy} L ${x + dx} ${y - dy}`;
}
