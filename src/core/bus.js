/**
 * Multi-bit nets, by the Virtuoso convention: a net named with a bit range,
 * `D[7:0]` or `D<7:0>`, stands for the parallel nets `D[7]` ... `D[0]`, and a
 * net named for one bit (`D[3]`, `D<3>`) anywhere else is virtually connected
 * to that bit. Square and angle brackets mean the same. A comma-separated
 * name lists parallel nets the same way: `A,B,C` stands for A, B, and C, and
 * `D<1>,D<0>` is the bus `D<1:0>`; a comma is that separator and nothing
 * else (inside braces, `V_{a,b}`, it belongs to the name). The bus is still
 * drawn and listed as one net, marked with a short slash across its wire; it
 * belongs to the net, not to the parts on it (the ADC and DAC draw none of
 * their own), and it is drawn in world space: a `/` whichever way the wire
 * runs or the parts are turned.
 *
 * The slash sits at each part pin on the bus (busTerminalMarks): on the
 * pin's own outward line, at least one grid cell from where the conductor
 * meets the drawn part, in whole cells -- at the terminal when the symbol's
 * lead is that long already (an ADC's), one cell out along the wire from a
 * port's short lead, and two from a pin right on the body's edge (a sum, a
 * block), leaving room for an arrowhead. Two pins joined by a short plain
 * wire share one slash, mid-way between them. A bus net with no pins marks
 * each branch mid-way instead (busMarkPoints).
 */

import { railNameKey } from './rail-names.js';
import { GRID } from './grid.js';
import { pointOnPath } from './wiring.js';

const BUS_NAME = /^(.*?)[[<]\s*(\d+)\s*(?::\s*(\d+)\s*)?[\]>]$/;

/** A bus or bus-bit name as { base, bits: [indices, first to last], range }
 *  (`D[3:0]` -> D, [3, 2, 1, 0], range), or null for any other name. A
 *  comma-separated name is a list of these (netNameParts). */
export function busBits(name) {
  const match = BUS_NAME.exec(String(name ?? '').trim());
  if (!match || !match[1].trim() || hasListComma(match[1])) return null;
  const from = Number(match[2]);
  const to = match[3] === undefined ? from : Number(match[3]);
  const step = from <= to ? 1 : -1;
  const bits = [];
  for (let bit = from; bit !== to + step; bit += step) bits.push(bit);
  return { base: match[1].trim(), bits, range: match[3] !== undefined };
}

/** Whether `text` has a comma outside braces: a list of names. */
function hasListComma(text) {
  let depth = 0;
  for (const ch of text) {
    if (ch === '{') depth += 1;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    else if (ch === ',' && !depth) return true;
  }
  return false;
}

/** The names a comma-separated name lists, each trimmed (`A, B` -> A, B);
 *  any other name alone. Commas inside braces belong to the name. */
export function netNameParts(name) {
  const text = String(name ?? '').trim();
  if (!text.includes(',') || !hasListComma(text)) return [text];
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '{') depth += 1;
    if (ch === '}') depth = Math.max(0, depth - 1);
    if (ch === ',' && !depth) {
      parts.push(current.trim());
      current = '';
    } else current += ch;
  }
  parts.push(current.trim());
  return parts;
}

/** The one spelling of a name: a list's commas without the spaces around
 *  them (`A, B` -> `A,B`); any other name trimmed. */
export function netNameSpelling(name) {
  return netNameParts(name).join(',');
}

const memberCache = new Map();

/** The single nets a name stands for, each by one spelling: a bit as
 *  `base<bit>`, a rail by its rail key, any other name as written.
 *  `A,D[1:0]` -> A, D<1>, D<0>; a plain name -> itself. */
export function netNameMembers(name) {
  const text = String(name ?? '').trim();
  let members = memberCache.get(text);
  if (!members) {
    // Every net is keyed on every redraw, from a handful of distinct names.
    if (memberCache.size >= 4096) memberCache.clear();
    members = text ? netNameParts(text).flatMap((part) => {
      const bus = busBits(part);
      return bus ? bus.bits.map((bit) => `${bus.base}<${bit}>`) : [railNameKey(part)];
    }) : [];
    memberCache.set(text, members);
  }
  return members;
}

/** Whether a name takes part in bus naming: a bit, a range, or a list. */
export function isBusName(name) {
  return netNameMembers(name).length > 1 || !!busBits(name);
}

/**
 * The net labels a typed name places, in order: names separated by spaces
 * (a comma between them reads as a space, `CLK, DOUT`), each bus range
 * spelled out bit by bit as written (`DOUT[3:0]` -> `DOUT[3]` ... `DOUT[0]`,
 * angle brackets kept). `CLK DOUT<1:0>` -> CLK, DOUT<1>, DOUT<0>. A name
 * with a comma inside it (`A,B`) is one label for its parallel nets. Spaces
 * inside braces belong to the name.
 */
export function expandLabelNames(text) {
  const names = [];
  let depth = 0;
  let current = '';
  for (const ch of String(text ?? '')) {
    if (ch === '{') depth += 1;
    if (ch === '}') depth = Math.max(0, depth - 1);
    if (!depth && /\s/.test(ch)) {
      if (current) names.push(current);
      current = '';
    } else current += ch;
  }
  if (current) names.push(current);
  return names.map((name) => name.replace(/^,+|,+$/g, '')).filter(Boolean).flatMap((name) => {
    if (hasListComma(name)) return [name];
    const bus = busBits(name);
    if (!bus?.range) return [name];
    const [open, close] = name.trimEnd().endsWith('>') ? ['<', '>'] : ['[', ']'];
    const base = name.slice(0, name.search(/[[<]\s*\d+\s*(?::\s*\d+\s*)?[\]>]\s*$/));
    return bus.bits.map((bit) => `${base}${open}${bit}${close}`);
  });
}

/** Nets in a bus name (`D[7:0]` -> 8, `A,B,C` -> 3), or 0 for a single
 *  bit or any other name. */
export function busWidth(name) {
  const parts = netNameParts(name);
  if (parts.length === 1) {
    const bus = busBits(name);
    return bus?.range ? bus.bits.length : 0;
  }
  return netNameMembers(name).length;
}

/** One spelling for a bus, bit, or list name, so square and angle brackets
 *  name the same group and a list of bits is the range they run
 *  (`D[3:0]`, `D<3:0>`, and `D<3>,D<2:0>` -> `D<3:0>`; `A, B` -> `A,B`);
 *  null for a plain name. */
export function busGroupName(name) {
  if (!isBusName(name)) return null;
  const runs = [];
  for (const member of netNameMembers(name)) {
    const bit = busBits(member);
    const run = runs.at(-1);
    if (bit && run?.base === bit.base && Math.abs(bit.bits[0] - run.to) === 1
      && (run.from === run.to || Math.sign(bit.bits[0] - run.to) === Math.sign(run.to - run.from))) run.to = bit.bits[0];
    else runs.push(bit ? { base: bit.base, from: bit.bits[0], to: bit.bits[0] } : { name: member });
  }
  return runs.map((run) => (run.name !== undefined ? run.name : run.from === run.to ? `${run.base}<${run.from}>` : `${run.base}<${run.from}:${run.to}>`)).join(',');
}

/** The groups among `names` that a probe on bus `name` recolors: its bits,
 *  part ranges, and listed names, all inside it (not itself). */
export function busGroupsWithin(name, names) {
  const members = netNameMembers(name);
  if (members.length < 2) return [];
  const own = busGroupName(name);
  return names.filter((other) => {
    const inner = netNameMembers(other);
    return inner.length && (busGroupName(other) ?? other) !== own && inner.every((member) => members.includes(member));
  });
}

/** Whether two net names are virtually connected: the same name (a rail in
 *  either spelling, `VSS` or `V_{SS}`), or two bus names that share a net
 *  (`D[3:0]` and `D<1>`, `A,B` and `B`). */
export function netNamesConnect(a, b) {
  const left = netNameMembers(a);
  const right = netNameMembers(b);
  if (!left.length || !right.length) return false;
  if (left.length === 1 && right.length === 1) return left[0] === right[0];
  return left.some((member) => right.includes(member));
}

/** Half extent of the slash: a 45-degree `/` one grid cell tall and wide,
 *  the same on a horizontal and a vertical wire. */
const SLASH = GRID / 2;

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
 * Where a bus net's slashes go: at each part pin on it, along the pin's
 * outward line (see the module note), stepping back toward the terminal a
 * cell at a time where the wire turns sooner.
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
    // Whole cells out, so the slash stays on a grid point; a pin right on the
    // body's edge (a sum, a block) leaves a second cell for an arrowhead.
    const lead = straightLeadLength(component.def.graphics, def);
    const cells = lead === 0 ? 2 : Math.max(0, Math.ceil((GRID - lead) / GRID));
    // Nearer, a cell at a time, where the wire turns sooner.
    const point = [...Array(cells + 1).keys()].reverse()
      .map((k) => ({ x: at.x + dir.x * k * GRID, y: at.y + dir.y * k * GRID }))
      .find((p) => paths.some((path) => pointOnPath(p, path) && pointOnPath(at, path))) || at;
    marks.push({ ...point, horizontal: dir.y === 0, key: `${comp}.${term}` });
  }
  // Two pins close together on one plain wire need one slash, between them;
  // a junction, or a longer run, keeps one at each pin.
  if (marks.length === 2 && paths.length === 1 && !(net.junctions || []).length
    && Math.abs(marks[0].x - marks[1].x) + Math.abs(marks[0].y - marks[1].y) <= CLOSE_PINS) {
    const [middle] = busMarkPoints(paths, avoid);
    if (middle) return [{ ...middle, key: marks.map((mark) => mark.key).join('|') }];
  }
  return marks.length ? marks : busMarkPoints(paths, avoid).map((mark, i) => ({ ...mark, key: `branch:${i}` }));
}

/** How near two pins' slashes come before they are drawn as one. */
const CLOSE_PINS = 4 * GRID;

/** Text size of a bit count: smaller than a label, like a pin annotation. */
export const BUS_COUNT_SIZE = 30;

/** Where a slash's bit count sits by default, from the slash: above the
 *  slash on a horizontal wire, beside it on a vertical one. */
function defaultBusCountOffset(mark) {
  return mark.horizontal ? { x: 0, y: -2 * SLASH } : { x: 2 * SLASH, y: 0 };
}

/** The bit-count labels a bus net shows (net.busCount): one per slash, its
 *  text the bus's width, at the slash plus the saved or default offset, with
 *  the text box the editor picks it by. */
export function busCountLabels(net, marks) {
  const width = busWidth(net?.name);
  if (!width || !net.busCount) return [];
  const text = String(width);
  const w = text.length * BUS_COUNT_SIZE * 0.62;
  return marks.map((mark) => {
    const offset = net.busCount.offsets?.[mark.key] || defaultBusCountOffset(mark);
    const x = mark.x + offset.x;
    const y = mark.y + offset.y;
    return { key: mark.key, text, x, y, slash: { x: mark.x, y: mark.y }, box: { x: x - w / 2, y: y - BUS_COUNT_SIZE / 2, w, h: BUS_COUNT_SIZE } };
  });
}

/** SVG path data for a slash at `mark`: a `/` across the wire. */
export function busMarkD({ x, y }) {
  return `M ${x - SLASH} ${y + SLASH} L ${x + SLASH} ${y - SLASH}`;
}
