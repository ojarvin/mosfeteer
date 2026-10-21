/**
 * Timing diagram: one clock waveform per switch phase, drawn under the
 * drawing as annotations -- each phase's name (its own spelling, TeX drawn
 * as math) and its wave, two cells tall with vertical edges. Rows may also
 * be signals of the diagram's own (a clock, an enable, a drawing with no
 * switches at all): added and removed by name, and kept by the drawn
 * diagram (`timing.signal`). They are drawn like phases but play no part
 * in beats.
 *
 * A wave is typed as slots, one character each: `1` high, `0` low. A short
 * wave holds its last level. The waves repeat, so each row
 * shows a little of its last slot before the start and of its first after
 * the end, where its transitions are.
 *
 * Non-overlap is kept between the pairs of phases asked for: none in a new
 * diagram; 'auto' picks every two that are never high in the same slot (and
 * a diagram saved before the setting was its own keeps that). Where one of a pair falls and the other
 * rises, a one-cell gap opens in every row; in it the pair's fall comes early
 * and its rise late, so the two are never high at once. Other phases change
 * at the start of the gap.
 *
 * A signal row may instead be analog: a value from -1 to 1 at the start of
 * each slot (`values`), joined by straight lines or held through the slot
 * (`hold`), from 0 at the bottom to 1 at the top -- or, with any value below
 * 0, about a dashed zero line through the middle. It is drawn as one box
 * annotation with its curve inside (`timing.analog`), so the curve's points
 * need not be on the grid while the box is. Its points take arrows, marks
 * and spans as a digital row's edges do; a mark on a point between the
 * extremes is a threshold, a dashed line at its level from the row's start.
 * Any row may be taller than two cells (`height`, even cells).
 *
 * A break leaves time out: two S curves down the middle of a slot, on
 * paper that hides the waves between them -- through every row at once, or
 * through each row on its own (`rows`). It belongs to its slot, not to an
 * edge, so it is drawn wherever that slot is.
 *
 * A row's wave is, first to last: the one given for it; the one it had in
 * the diagram already; for a complement (a barred phase), its phase drawn
 * inverted, gaps included; one slot per beat, high where the phase's
 * switches are closed; else low throughout.
 *
 * The design keeps its diagram (`Circuit#timing`): the clock the analyses
 * and beats read, which the timing window edits (setTimingDiagram). It is
 * drawn only when annotated (addTimingDiagram, annotateTimingDiagram, the
 * `timing` command), and the drawn annotations remember their waves
 * (`LabelInstance#timing`), so drawing the diagram again replaces it where
 * it stands. A design from before keeps only the drawn diagram, read as
 * its own until it is set.
 */

import { GRID, ceilGrid, floorGrid, snap } from './grid.js';
import { complementKey, isComplementPhase, isTexSource, phaseKey, samePhase, switchPhases, switchStateAt, switchesOf } from './beats.js';
import { plainTexText } from './render.js';
import { LabelInstance, normalizeTimingSpec } from './model.js';

const WAVE_HEIGHT = 2 * GRID;
/** Between one row and the next. */
const ROW_GAP = GRID;
/** The tallest row, in cells. */
export const MAX_ROW_CELLS = 16;
// The diagram keeps three cells from what is drawn, so it reads as its own
// figure rather than part of the circuit.
const CLEARANCE = 3 * GRID;
const LABEL_GAP = GRID;
/** A slot's default width, in cells. */
export const DEFAULT_SLOT_CELLS = 4;
/** Slots a diagram with no wave at all shows. */
const EMPTY_SLOTS = 4;

/** A wave as typed: 1 and 0 kept (H and L too), anything else rejected;
 *  spaces ignored. */
export function parseTimingBits(text) {
  const bits = String(text ?? '').replace(/\s+/g, '').replace(/[lL]/g, '0').replace(/[hH]/g, '1');
  const bad = bits.match(/[^01]/);
  if (bad) throw new Error(`a timing wave is made of 1 (high) and 0 (low), one per slot, not "${bad[0]}"`);
  return bits;
}

/** A row's height as given or saved: even cells from 2, in drawing units. */
export function rowHeight(cells) {
  const n = Math.round(Number(cells));
  return Number.isFinite(n) && n >= 2 ? Math.min(MAX_ROW_CELLS, n - (n % 2)) * GRID : WAVE_HEIGHT;
}

/** An analog value as typed: a number from -1 to 1 (`.5`, `-0.25`). */
export function parseTimingValue(text) {
  const source = String(text ?? '').trim();
  const value = Number(/^[+-]?\./.test(source) ? source.replace('.', '0.') : source);
  if (source === '' || !Number.isFinite(value)) throw new Error(`an analog value is a number from -1 to 1, not "${source}"`);
  if (value < -1 || value > 1) throw new Error(`an analog value is from -1 to 1 (the row's full height), not ${value}`);
  return Math.round(value * 1e4) / 1e4;
}

/** A row's wave as given: digital bits (`0101`), or analog values -- a list,
 *  or text with commas or a value that is not 0 or 1 (`0,.5,1`, `.3`).
 *  Returns { bits } or { values }. */
export function parseTimingWave(wave) {
  if (Array.isArray(wave)) return { values: wave.map(parseTimingValue) };
  const text = String(wave ?? '').trim();
  if (/[,.\-]/.test(text)) {
    return { values: text.split(/[\s,]+/).filter(Boolean).map(parseTimingValue) };
  }
  return { bits: parseTimingBits(text) };
}

/** A level the other way up. */
const invert = (level) => (level === '0' ? '1' : '0');

/** A phase's wave from the beats: one slot per beat, high where its switches
 *  are closed. Empty without beats. */
export function beatTimingBits(circuit, key) {
  const [first] = switchesOf(circuit, key);
  if (!first) return '';
  return (circuit.beats || []).map((_, index) => (switchStateAt(circuit, first.refdes, index) === 'closed' ? '1' : '0')).join('');
}

/** The rows a diagram has, in drawing order: every switch phase, then the
 *  diagram's own signals (`signal: true`) -- those drawn already, plus
 *  `add`, minus `remove` (names as typed). A signal named like a switch
 *  phase is that phase. `drawing` reads the drawn diagram's rows rather
 *  than the design's (they differ until it is annotated again). */
export function timingPhases(circuit, { add = [], remove = [], drawing = false } = {}) {
  const phases = switchPhases(circuit);
  const known = (key, list) => list.some((phase) => samePhase(phase.key, key));
  const signals = [];
  for (const signal of [...(existingTimingDiagram(circuit, { drawing })?.signals || []), ...add.map((source) => ({ key: phaseKey(source), source: String(source).trim() }))]) {
    if (known(signal.key, phases) || known(signal.key, signals)) continue;
    if (remove.some((name) => samePhase(phaseKey(name), signal.key))) continue;
    signals.push({ ...signal, signal: true });
  }
  return timingOrder([...phases, ...signals]);
}

/** The level in a gap between `before` and `after`: high only where both
 *  are, so a fall comes early and a rise late. */
const gapLevel = (before, after) => (before === '1' && after === '1' ? '1' : '0');

/** Each row's slots, `count` long: a short wave holds its last level, no
 *  wave is low. */
function slotLevels(waves) {
  const count = Math.max(0, ...waves.map((bits) => bits.length)) || EMPTY_SLOTS;
  return waves.map((bits) => Array.from({ length: count }, (_, i) => bits[i] ?? bits.at(-1) ?? '0'));
}

/** The pairs of rows kept apart by default: both high somewhere, never high
 *  in the same slot. Rows in `skip` (drawn
 *  as another inverted) take no part. Pairs are [a, b] row indices, a < b. */
export function defaultTimingPairs(waves, skip = new Set()) {
  const slots = slotLevels(waves);
  const pairs = [];
  for (let a = 0; a < slots.length; a += 1) {
    for (let b = a + 1; b < slots.length; b += 1) {
      if (skip.has(a) || skip.has(b)) continue;
      const high = (row) => slots[row].some((level) => level === '1');
      if (high(a) && high(b) && !slots[a].some((level, i) => level === '1' && slots[b][i] === '1')) pairs.push([a, b]);
    }
  }
  return pairs;
}

/**
 * The columns every row shares, and each row's level in each: [{ w, kind:
 * 'lead'|'slot'|'gap', at }] and, per row, ['0'|'1', ...]. A column's `at`
 * is the slot boundary a change of level there belongs to: 0 before the
 * first slot, `count` after the last (-1 for the lead-in). `waves` are the
 * rows' own waves ('' for low throughout); `inverted[row]` draws a row as
 * that other row's levels inverted (a complement); `pairs` ([a, b] row
 * indices) are the rows kept from overlapping. The waves repeat: a lead
 * column before the first slot holds the last slot's level, one after the
 * end the first slot's.
 */
export function timingColumns(waves, { slotCells = DEFAULT_SLOT_CELLS, pairs = [], inverted = [] } = {}) {
  const slots = slotLevels(waves);
  const count = slots[0]?.length || EMPTY_SLOTS;
  // The repeating sequence, with the lead-in and lead-out.
  const sequence = slots.map((row) => [row.at(-1), ...row, row[0]]);
  const lead = Math.max(1, Math.floor(slotCells / 2)) * GRID;
  const columns = [];
  const levels = waves.map(() => []);
  sequence[0]?.forEach((_, index) => {
    const falls = (row) => sequence[row][index - 1] === '1' && sequence[row][index] === '0';
    const rises = (row) => sequence[row][index - 1] === '0' && sequence[row][index] === '1';
    const apart = index > 0 ? pairs.filter(([a, b]) => (falls(a) && rises(b)) || (rises(a) && falls(b))) : [];
    if (apart.length) {
      const kept = new Set(apart.flat());
      columns.push({ w: GRID, kind: 'gap', at: index - 1 });
      // The pair falls early and rises late; the rest change as the gap opens.
      sequence.forEach((row, r) => levels[r].push(kept.has(r) ? gapLevel(row[index - 1], row[index]) : row[index]));
    }
    const edge = index === 0 || index === sequence[0].length - 1;
    columns.push({ w: edge ? lead : slotCells * GRID, kind: edge ? 'lead' : 'slot', at: index - 1 });
    sequence.forEach((row, r) => levels[r].push(row[index]));
  });
  const drawn = levels.map((row, r) => (inverted[r] !== undefined && inverted[r] !== null ? levels[inverted[r]].map(invert) : row));
  return { columns, levels: drawn, count };
}

/** How far an edge may shift, in cells, either way. */
export const MAX_EDGE_SHIFT = 8;

/**
 * The points of one row's wave: its `levels` over `columns`, from `x`, top
 * at `top`, with vertical edges. `shift` moves the row's falling and rising
 * edges by whole cells ({ fall, rise }, negative earlier): a bottom plate's
 * switch opening a cell before its top plate's. An edge stays inside the
 * columns on either side of it and after the edge before it.
 */
export function timingRowGeometry(levels, columns, x, top, shift = {}, height = WAVE_HEIGHT) {
  return traceRow(levels, columns, x, top, shift, height).points;
}

/** The edges one row draws (as timingRowGeometry): [{ at, x, rise }], `at`
 *  the slot boundary each belongs to (see timingColumns). An edge canceled
 *  by its neighbor shifted onto it is not drawn. */
export function timingRowEdges(levels, columns, x, top, shift = {}, height = WAVE_HEIGHT) {
  return traceRow(levels, columns, x, top, shift, height).edges;
}

/** Where each slot starts, from the waves' left edge: [x of slot 0, ...,
 *  x where the lead-out begins]. Gap columns come before the slot they open. */
function slotStarts(columns) {
  const starts = [];
  let x = 0;
  for (const column of columns) {
    if (column.kind !== 'gap' && column.at >= 0) starts[column.at] = x;
    x += column.w;
  }
  return starts;
}

/**
 * An analog row's curve, from the waves' top-left corner: its `values` at
 * the start of each slot, joined straight or (`hold`) held through the
 * slot; the first held before it, the last after. Points are { x, v }, v
 * the value (-1..1). Also each slot boundary's point (`points`, by slot
 * index, through the start of the lead-out), where arrows, marks and spans
 * attach, and the whole width.
 */
export function analogRowGeometry(values, columns, { hold = false } = {}) {
  const starts = slotStarts(columns);
  const end = columns.reduce((sum, column) => sum + column.w, 0);
  const count = starts.length - 1;
  const valueAt = (slot) => (values.length ? values[Math.min(slot, values.length - 1)] : 0);
  const curve = [{ x: 0, v: valueAt(0) }];
  for (let slot = 0; slot <= count; slot += 1) {
    const x = starts[slot];
    if (hold && slot > 0) curve.push({ x, v: valueAt(slot - 1) });
    curve.push({ x, v: valueAt(slot) });
  }
  curve.push({ x: end, v: valueAt(count) });
  // Straight runs are one segment.
  const trace = curve.filter((point, i) => i === 0 || point.x !== curve[i - 1].x || point.v !== curve[i - 1].v);
  for (let i = trace.length - 2; i > 0; i -= 1) {
    const [a, b, c] = [trace[i - 1], trace[i], trace[i + 1]];
    if ((a.v === b.v && b.v === c.v) || (a.x === b.x && b.x === c.x)) trace.splice(i, 1);
  }
  const points = starts.map((x, slot) => ({ at: slot, x, v: valueAt(slot) }));
  return { trace, points, width: end };
}

/** Whether an analog row reaches below zero: drawn about a middle zero line. */
export const bipolar = (values) => values.some((value) => value < 0);

/** Each row's top and height, from the first row's top. */
function rowLayout(rows) {
  const heights = rows.map((row) => rowHeight(row.height));
  const tops = [];
  heights.reduce((top, height, index) => { tops[index] = top; return top + height + ROW_GAP; }, 0);
  return { tops, heights, bottom: rows.length ? tops.at(-1) + heights.at(-1) : 0 };
}

function traceRow(levels, columns, x, top, shift, height = WAVE_HEIGHT) {
  const y = (level) => (level === '1' ? top : top + height);
  const starts = [];
  columns.reduce((at, column) => { starts.push(at); return at + column.w; }, x);
  const end = x + columns.reduce((sum, column) => sum + column.w, 0);
  const points = [{ x, y: y(levels[0]) }];
  const edges = [];
  let last = x;
  for (let index = 1; index < columns.length; index += 1) {
    if (levels[index] === levels[index - 1]) continue;
    const cells = levels[index] === '1' ? shift.rise || 0 : shift.fall || 0;
    const lo = Math.max(starts[index - 1], last);
    const hi = starts[index] + columns[index].w;
    const at = Math.max(lo, Math.min(hi, starts[index] + cells * GRID));
    points.push({ x: at, y: y(levels[index - 1]) }, { x: at, y: y(levels[index]) });
    edges.push({ at: columns[index].at, x: at, rise: levels[index] === '1' });
    last = at;
  }
  points.push({ x: end, y: y(levels.at(-1)) });
  // A level held over several columns is one segment; an edge pushed onto
  // the next one cancels out.
  for (let i = points.length - 2; i > 0; i -= 1) {
    const [a, b, c] = [points[i - 1], points[i], points[i + 1]];
    if ((a.y === b.y && b.y === c.y) || (a.x === b.x && b.x === c.x)) points.splice(i, 1);
  }
  const drawn = points.filter((point, i) => i === 0 || point.x !== points[i - 1].x || point.y !== points[i - 1].y);
  const vertical = new Set(drawn.flatMap((point, i) => (i && point.x === drawn[i - 1].x ? [point.x] : [])));
  return { points: drawn, edges: edges.filter((edge) => vertical.has(edge.x)) };
}

/** A row's edge shift as saved or given: whole cells within the limit. */
function normalizeEdgeShift(shift) {
  const cells = (value) => Math.max(-MAX_EDGE_SHIFT, Math.min(MAX_EDGE_SHIFT, Math.round(Number(value)) || 0));
  return { fall: cells(shift?.fall), rise: cells(shift?.rise) };
}

/** The top of the highest spot, from the drawing's top down, where a diagram
 *  `area` wide ({ x, w, h }) clears everything drawn by CLEARANCE; below the
 *  drawing when nothing higher is free. */
function timingSpot(circuit, area, drawn) {
  const obstacles = [];
  for (const c of circuit.components.values()) obstacles.push(c.bboxWorld());
  for (const label of circuit.labels.values()) if (!label.timing) obstacles.push(label.inkRect());
  for (const net of circuit.nets.values()) {
    for (const path of net.paths()) {
      for (let i = 1; i < path.length; i += 1) {
        const [a, b] = [path[i - 1], path[i]];
        obstacles.push({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
      }
    }
  }
  const clear = (top) => obstacles.every((r) => r.x + r.w + CLEARANCE <= area.x || area.x + area.w + CLEARANCE <= r.x
    || r.y + r.h + CLEARANCE <= top || top + area.h + CLEARANCE <= r.y);
  const below = ceilGrid(drawn.y + drawn.h) + CLEARANCE;
  for (let top = ceilGrid(drawn.y); top < below; top += GRID) if (clear(top)) return top;
  return below;
}

/** A state's name: its phases' names as one -- one math expression when any
 *  is TeX ($\varphi_1, \varphi_2$), plain names as text inside it. */
function stateName(sources) {
  if (!sources.some(isTexSource)) return sources.join(', ');
  const body = (source) => (isTexSource(source) ? source.replace(/^\$+|\$+$/g, '').trim() : `\\mathrm{${source}}`);
  return `$${sources.map(body).join(',\\ ')}$`;
}

/**
 * The states a drawn diagram steps through, for beats: each run of slots in
 * which the same phases are high is one state, [{ name, closed: Set of phase
 * keys }], named after the phases high in it. Null without a diagram.
 */
export function timingStates(circuit) {
  return stateRuns(circuit)?.map(({ name, closed }) => ({ name, closed })) ?? null;
}

/** timingStates, each with the slots it spans (`slots`, slot indices). */
function stateRuns(circuit, { drawing = false } = {}) {
  if (!existingTimingDiagram(circuit, { drawing })) return null;
  // The diagram's own signals switch nothing.
  const rows = timingRowSources(circuit, { drawing }).filter((row) => !row.signal);
  if (!rows.length) return null;
  const count = Math.max(1, ...rows.map((row) => row.bits.length));
  const level = (row, slot) => (row.bits.length ? row.bits[Math.min(slot, row.bits.length - 1)] : '0');
  const high = (row, slot) => (row.complementOf !== undefined ? level(rows[row.complementOf], slot) === '0' : level(row, slot) === '1');
  const states = [];
  for (let slot = 0; slot < count; slot += 1) {
    const closed = rows.filter((row) => high(row, slot));
    const key = closed.map((row) => row.key).join('|');
    if (states.at(-1)?.key === key) {
      states.at(-1).slots.push(slot);
      continue;
    }
    states.push({ key, name: closed.length ? stateName(closed.map((row) => row.source)) : 'all open', closed: new Set(closed.map((row) => row.key)), slots: [slot] });
  }
  // A wave that ends as it starts goes round: its last state is its first.
  if (states.length > 1 && states[0].key === states.at(-1).key) states[0].slots.push(...states.pop().slots);
  return states;
}

/**
 * The state of the drawn diagram each beat shows, where the beats and the
 * diagram are in step: a Map of beat index to state index, for every run of
 * consecutive beats that goes through all the diagram's states in order
 * (as Make beats makes them), each beat closing exactly the switches of the
 * phases high in its state. Beats outside such a run are not in it.
 */
export function timingBeatStates(circuit, { drawing = false } = {}) {
  const states = stateRuns(circuit, { drawing });
  const beats = circuit.beats || [];
  const found = new Map();
  if (!states?.length || beats.length < states.length) return found;
  const switched = [...new Set(timingRowSources(circuit, { drawing }).filter((row) => !row.signal).map((row) => row.key))]
    .map((key) => ({ key, first: switchesOf(circuit, key)[0] }))
    .filter((row) => row.first);
  if (!switched.length) return found;
  const shows = (beat, state) => switched.every(({ key, first }) => (switchStateAt(circuit, first.refdes, beat) === 'closed') === [...states[state].closed].some((closed) => samePhase(closed, key)));
  for (let start = 0; start + states.length <= beats.length; start += 1) {
    if (!states.every((_, state) => shows(start + state, state))) continue;
    states.forEach((_, state) => found.set(start + state, state));
  }
  return found;
}

/**
 * Where the drawn diagram shows beat `index`'s state, for shading it: world
 * rects ({ x, y, w, h }) over the waves, one per run of the state's slot
 * columns (the lead-in and lead-out included, which repeat the last and
 * first slot; the gaps between states left out). Empty when the beat is
 * not in step with the diagram (timingBeatStates).
 */
export function timingBeatBands(circuit, index) {
  // The diagram as drawn, whatever the design's is now.
  const drawing = true;
  const state = timingBeatStates(circuit, { drawing }).get(index);
  if (state === undefined) return [];
  const before = existingTimingDiagram(circuit, { drawing });
  const rows = timingRowSources(circuit, { drawing });
  const { columns, count } = timingColumns(rows.map((row) => row.bits), {
    slotCells: before.slot || DEFAULT_SLOT_CELLS, pairs: timingPairs(rows, before.gaps), inverted: rows.map((row) => row.complementOf ?? null),
  });
  const runs = stateRuns(circuit, { drawing });
  const slots = new Set(runs[state].slots);
  // A signal may run longer than the phases, which hold their last level.
  const last = Math.max(...runs.flatMap((run) => run.slots));
  const slotOf = (column) => (column.kind === 'gap' ? null : Math.min(last, column.at < 0 ? count - 1 : column.at >= count ? 0 : column.at));
  const top = before.y - GRID / 2;
  const h = rowLayout(rows).bottom + GRID;
  const bands = [];
  let x = before.x;
  let open = false;
  for (const column of columns) {
    const shaded = slots.has(slotOf(column));
    if (shaded && open) bands.at(-1).w += column.w;
    else if (shaded) bands.push({ x, y: top, w: column.w, h });
    open = shaded;
    x += column.w;
  }
  return bands;
}

/** Phases in drawing order, each complement right after its phase; a pair
 *  goes where the first of the two was drawn. */
function timingOrder(phases) {
  const baseOf = (phase) => (isComplementPhase(phase.key) ? phases.find((other) => samePhase(other.key, complementKey(phase.key))) : null) || phase;
  const ordered = [];
  for (const phase of phases) {
    const base = baseOf(phase);
    if (ordered.includes(base)) continue;
    ordered.push(base, ...phases.filter((other) => other !== base && baseOf(other) === base));
  }
  return ordered;
}

/** The phase a typed name means among `phases`: its row number (1-based),
 *  its spelling or TeX, or its plain text (φ1). A leading ~ or ! means the
 *  complement (~φ1). Null when none. */
export function timingPhaseNamed(phases, name) {
  const text = String(name ?? '').trim();
  const complement = /^[~!]/.test(text);
  const bare = complement ? text.slice(1) : text;
  const plain = (source) => plainTexText(source).replace(/\s+/g, '');
  let phase = !complement && /^\d+$/.test(bare) ? phases[Number(bare) - 1] || null
    : phases.find((candidate) => samePhase(candidate.key, phaseKey(bare)) || plain(candidate.source) === plain(bare)) || null;
  if (complement && phase) phase = phases.find((candidate) => samePhase(candidate.key, complementKey(phase.key))) || null;
  return phase;
}

/**
 * The design's timing diagram: its rows' waves, edge shifts, analog values
 * and heights (Maps by phase key), their order, its own signals, its slot
 * width and non-overlap setting ('auto', 'none', or pairs of phase keys),
 * its arrows, marks, spans and breaks -- as the design keeps them
 * (`Circuit#timing`), else (a design from before) as drawn. With them, the
 * drawn diagram, if any (`drawn`): its annotations' `ids`, where it stands
 * ({ x, y }), and which of its notes wait for an edge that has gone
 * (`missing`). `drawing` reads the drawn diagram alone. Null when there is
 * none.
 */
export function existingTimingDiagram(circuit, { drawing = false } = {}) {
  const drawn = drawnTimingDiagram(circuit);
  const spec = drawing ? null : circuit.timing;
  if (!spec) return drawn;
  if (!spec.rows.length) return null;
  const bits = new Map();
  const shifts = new Map();
  const values = new Map();
  const holds = new Set();
  const heights = new Map();
  for (const row of spec.rows) {
    if (typeof row.bits === 'string') bits.set(row.phase, row.bits);
    if (row.shift) shifts.set(row.phase, normalizeEdgeShift(row.shift));
    if (Array.isArray(row.values)) values.set(row.phase, row.values);
    if (row.hold) holds.add(row.phase);
    if (row.height) heights.set(row.phase, row.height);
  }
  return {
    ids: drawn?.ids || [], drawn: !!drawn, x: drawn?.x, y: drawn?.y, missing: drawn?.missing || [],
    bits, shifts, values, holds, heights,
    order: spec.rows.map((row) => row.phase),
    signals: spec.rows.filter((row) => row.signal).map((row) => ({ key: row.phase, source: row.source })),
    slot: spec.slot, gaps: spec.gaps === false ? 'none' : spec.gaps ?? 'auto',
    arrows: spec.arrows || [], marks: spec.marks || [], spans: spec.spans || [], breaks: spec.breaks || [],
  };
}

/** The diagram as drawn: its annotations' ids, each phase's own wave
 *  and edge shift, its slot width and non-overlap setting ('auto', 'none',
 *  or pairs of phase keys), its arrows,
 *  marks and spans (and which of them wait for an edge that has gone:
 *  `missing`, [{ kind, index }]), and where it stands ({ x, y }:
 *  its waves' left edge and first row's top). Null when there is none. */
export function drawnTimingDiagram(circuit) {
  const parts = [...circuit.labels.values()].filter((label) => label.timing);
  if (!parts.length) return null;
  const bits = new Map();
  const shifts = new Map();
  // Analog rows' values (and whether they hold), and rows drawn taller.
  const values = new Map();
  const holds = new Set();
  const heights = new Map();
  for (const label of parts) {
    if (label.timing.part || label.kind !== 'label') continue;
    if (typeof label.timing.bits === 'string') bits.set(label.timing.phase, label.timing.bits);
    if (label.timing.shift) shifts.set(label.timing.phase, normalizeEdgeShift(label.timing.shift));
    if (Array.isArray(label.timing.values)) values.set(label.timing.phase, label.timing.values);
    if (label.timing.hold) holds.add(label.timing.phase);
    if (label.timing.height) heights.set(label.timing.phase, label.timing.height);
  }
  // Its arrows, marks and spans (`timing.part`) are neither waves nor names.
  const waves = parts.filter((label) => (label.kind === 'line' || label.kind === 'box') && !label.timing.part);
  const names = parts.filter((label) => label.kind === 'label' && !label.timing.part);
  // Where it stands, from its names: they keep one place beside the waves,
  // while a wave's own extent moves with its edges (one shifted early at
  // the start reaches left) and its levels (a top row low throughout).
  const x = names.length ? Math.max(...names.map((label) => label.bbox().x + label.bbox().w)) + LABEL_GAP : Math.min(...waves.map((label) => label.bbox().x));
  const y = names.length ? Math.min(...names.map((label) => label.anchorWorld().y - rowHeight(label.timing.height) / 2)) : Math.min(...waves.map((label) => label.bbox().y));
  const first = parts.find((label) => label.timing.slot) || parts[0];
  // The rows' order, top to bottom, as the names stand.
  const sorted = [...names].sort((a, b) => a.anchorWorld().y - b.anchorWorld().y);
  const order = sorted.map((label) => label.timing.phase);
  // The diagram's own signals, spelled as their names are.
  const signals = sorted.filter((label) => label.timing.signal).map((label) => ({ key: label.timing.phase, source: label.text }));
  const { arrows = [], marks = [], spans = [], breaks = [] } = first.timing;
  // The arrows, marks and spans not drawn: their edges have gone.
  const owner = { note: 'span', 'arrow-note': 'arrow' };
  const drawn = new Set(parts.filter((label) => label.timing.part).map((label) => `${owner[label.timing.part] || label.timing.part}:${label.timing.item}`));
  const missing = Object.entries({ arrow: arrows, mark: marks, span: spans, break: breaks })
    .flatMap(([kind, list]) => list.flatMap((_, index) => (drawn.has(`${kind}:${index}`) ? [] : [{ kind, index }])));
  return { ids: parts.map((label) => label.id), drawn: true, bits, shifts, values, holds, heights, order, signals, x, y, slot: first.timing.slot, gaps: first.timing.gaps === false ? 'none' : first.timing.gaps ?? 'auto', arrows, marks, spans, breaks, missing };
}

/** `phases` in `order` (phase keys) where it names them; the rest after, in
 *  their own order. */
function arranged(phases, order) {
  if (!order?.length) return phases;
  const listed = order.map((key) => phases.find((phase) => samePhase(phase.key, key))).filter(Boolean);
  return [...new Set([...listed, ...phases])];
}

/** The pairs of rows kept from overlapping under `setting`: 'auto' (every
 *  two phases never high together, defaultTimingPairs), 'none', or pairs
 *  of phase keys. Returns [a, b] row indices. */
export function timingPairs(rows, setting = 'auto') {
  if (setting === 'none' || setting === false) return [];
  if (Array.isArray(setting)) {
    // An analog row has no edges to keep apart.
    const index = (key) => rows.findIndex((row) => samePhase(row.key, key) && !row.values);
    return setting.map(([a, b]) => [index(a), index(b)]).filter(([a, b]) => a >= 0 && b >= 0 && a !== b).map(([a, b]) => [Math.min(a, b), Math.max(a, b)]);
  }
  // A complement follows its phase; a signal of the diagram's own is kept
  // apart only when asked.
  const skip = new Set(rows.flatMap((row, index) => (row.complementOf !== undefined || row.signal || row.values ? [index] : [])));
  return defaultTimingPairs(rows.map((row) => row.bits), skip);
}

/** Every row's wave as the diagram would draw it now (see the header):
 *  [{ key, source, bits, values, hold, height, from, complementOf, signal }]
 *  (an analog row's `values`, its `bits` all low, one per value, so it
 *  counts its slots as the others do), `from` one of
 *  'typed', 'diagram', 'complement' (drawn as row `complementOf` inverted),
 *  'beats', or 'low' (bits empty); `signal` marks the diagram's own signals.
 *  `phases` defaults to timingPhases; `drawing` reads the drawn diagram. */
export function timingRowSources(circuit, { fromBeats = false, typed = new Map(), order = null, phases: given = null, drawing = false } = {}) {
  const drawnBefore = existingTimingDiagram(circuit, { drawing });
  const phases = arranged(given || timingPhases(circuit, { drawing }), order || drawnBefore?.order);
  const before = fromBeats ? null : drawnBefore;
  const analog = (values) => ({ bits: '0'.repeat(values.length), values });
  return phases.map(({ key, source, signal }) => {
    const height = drawnBefore?.heights.get(key);
    const own = { ...(signal ? { signal: true } : {}), ...(height ? { height } : {}) };
    if (typed.has(key)) {
      const wave = typed.get(key);
      return { key, source, ...(wave.values ? analog(wave.values) : { bits: wave.bits ?? wave }), ...(wave.values && (wave.hold ?? drawnBefore?.holds.has(key)) ? { hold: true } : {}), from: 'typed', ...own };
    }
    if (before?.values.has(key)) return { key, source, ...analog(before.values.get(key)), ...(before.holds.has(key) ? { hold: true } : {}), from: 'diagram', ...own };
    if (before?.bits.has(key)) return { key, source, bits: before.bits.get(key), from: 'diagram', ...own };
    const base = isComplementPhase(key) ? phases.findIndex((other) => samePhase(other.key, complementKey(key))) : -1;
    if (base >= 0) return { key, source, bits: '', from: 'complement', complementOf: base, ...own };
    const beats = signal ? '' : beatTimingBits(circuit, key);
    return beats ? { key, source, bits: beats, from: 'beats' } : { key, source, bits: '', from: 'low', ...own };
  });
}

/** Two edge references ({ row, at }) the same edge. */
const sameEdge = (a, b) => samePhase(a.row, b.row) && a.at === b.at;

/** The diagram's arrows, marks, spans and breaks as given (edge references
 *  by row key), each once -- one break a slot, the last given -- a span's
 *  text trimmed. */
function timingNotes({ arrows = [], marks = [], spans = [], breaks = [] }) {
  const edge = (ref) => ({ row: String(ref.row), at: Math.round(Number(ref.at)) });
  const unique = (list, same) => list.filter((item, i) => list.findIndex((other) => same(item, other)) === i);
  return {
    arrows: unique(arrows.map((a) => {
      const text = String(a.text ?? '').trim();
      return { from: edge(a.from), to: edge(a.to), ...(text ? { text } : {}) };
    }), (a, b) => sameEdge(a.from, b.from) && sameEdge(a.to, b.to)),
    marks: unique(marks.map(edge), sameEdge),
    spans: unique(spans.map((span) => ({ from: edge(span.from), to: edge(span.to), text: String(span.text ?? '').trim() })), (a, b) => sameEdge(a.from, b.from) && sameEdge(a.to, b.to)),
    breaks: unique(breaks.map((item) => ({ at: Math.round(Number(item.at)), ...(item.rows ? { rows: true } : {}) })).reverse(), (a, b) => a.at === b.at).reverse(),
  };
}

/**
 * Where the diagram's arrows, marks and spans go, from the waves' top-left
 * corner: `edgeOf(ref)` finds a drawn edge ({ x, row }) or null; `textAt`
 * where a span's text goes, placed one way or another (spanText). An arrow
 * runs from the middle of one edge to the middle of the other. A mark is a
 * dashed line through every row at its edge, a cell past the waves above
 * and below; a span is a dashed line
 * at each of its two edges, reaching below the waves to an arrow between
 * them -- in a lane of its own where spans or their texts would overlap --
 * with its text under that, or a narrow span's beside it. Returns the pieces, the guides ({ kind, index, x, bottom }), the items whose
 * edges are not drawn ({ kind, index }), and the height they all reach.
 */
function notesLayout(notes, edgeOf, rows, textAt = () => null) {
  const mid = (edge) => ({ x: edge.x, y: rows.tops[edge.row] + rows.heights[edge.row] / 2 });
  const wavesBottom = rows.bottom;
  const missing = [];
  const guides = [];
  const guide = (kind, index, x, bottom) => guides.push({ kind, index, x, bottom });
  const arrows = [];
  notes.arrows.forEach((item, index) => {
    const [a, b] = [edgeOf(item.from), edgeOf(item.to)];
    if (!a || !b || (a.x === b.x && a.row === b.row)) missing.push({ kind: 'arrow', index });
    else arrows.push({ index, from: mid(a), to: mid(b) });
  });
  // A mark on an analog point between its extremes is a threshold too: a
  // dashed line at its level, from the row's start (drawn by its box).
  const thresholds = [];
  notes.marks.forEach((item, index) => {
    const edge = edgeOf(item);
    if (!edge) missing.push({ kind: 'mark', index });
    else {
      guide('mark', index, edge.x, wavesBottom + GRID);
      if (edge.v !== undefined && Math.abs(edge.v) !== 1 && edge.v !== 0) thresholds.push({ row: edge.row, x: edge.x, v: edge.v });
    }
  });
  const placed = [];
  notes.spans.forEach((item, index) => {
    const [a, b] = [edgeOf(item.from), edgeOf(item.to)];
    if (!a || !b || a.x === b.x) missing.push({ kind: 'span', index });
    else placed.push({ index, text: item.text, x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x) });
  });
  // Lanes, top down: a span takes the first whose last span (its text too)
  // ends no later than it starts, so spans meeting at an edge read as one
  // line, |--|--|. A wide span's text goes under its arrow. A narrow span's
  // goes after its right arrow -- or, when the next span starts where that
  // text would be, before its left one, else under it, whichever lets the
  // two share the lane -- and where no other span's dashed line crosses it.
  const lanes = [];
  const sorted = [...placed].sort((a, b) => spanArrows(a).left - spanArrows(b).left || a.x1 - b.x1);
  const laned = sorted.map((span, i) => {
    const arrows = spanArrows(span);
    let ways = ['under'];
    if (isNarrow(span)) {
      const after = span.text ? textAt(span, 'right') : null;
      const crowded = !!after && sorted.slice(i + 1).some((next) => spanArrows(next).left >= arrows.right && spanArrows(next).left < after.right);
      ways = crowded ? ['left', 'under', 'right'] : ['right', 'left', 'under'];
    }
    // Another span's dashed lines run down to its own lane, through any
    // lane above: a text clear of them all is clean.
    const lines = sorted.filter((other) => other !== span).flatMap((other) => [other.x0, other.x1]);
    const options = ways.map((way) => {
      const text = span.text ? textAt(span, way) : null;
      const clean = !text || !lines.some((x) => x > text.left && x < text.right);
      return { text, clean, left: Math.min(arrows.left, text?.left ?? Infinity), right: Math.max(arrows.right, text?.right ?? -Infinity) };
    });
    // The highest lane a clean placement fits, else any placement (a lane
    // past the last is empty: everything fits there).
    const fits = (lane, choices) => choices.find((option) => (lanes[lane] ?? -Infinity) <= option.left);
    const clean = options.filter((option) => option.clean);
    const choices = clean.length ? clean : options;
    let lane = 0;
    while (!fits(lane, choices)) lane += 1;
    const chosen = fits(lane, choices);
    lanes[lane] = chosen.right;
    return { ...span, lane, place: chosen.text };
  });
  // Two cells clear of the waves, so the arrow and its text stand apart; a
  // lane with a text under an arrow takes three cells (the text a cell
  // under its arrow, the next lane a cell under that), one with its texts
  // all beside its arrows two.
  const under = lanes.map((_, lane) => laned.some((span) => span.lane === lane && span.place?.under));
  const laneY = [];
  under.forEach((below, lane) => { laneY[lane] = lane ? laneY[lane - 1] + (under[lane - 1] ? 3 : 2) * GRID : wavesBottom + 2 * GRID; });
  const spans = laned.map((span) => {
    const y = laneY[span.lane];
    guide('span', span.index, span.x0, y);
    guide('span', span.index, span.x1, y);
    return { ...span, y };
  });
  const height = lanes.length ? laneY.at(-1) + (under.at(-1) ? 2 : 1) * GRID : wavesBottom;
  return { arrows, guides, spans, missing, height, thresholds };
}

/** A span under three cells is narrow: pointed at from outside. */
const isNarrow = (span) => span.x1 - span.x0 < 3 * GRID;

/** Where a span's arrows reach: a narrow one's from two cells outside. */
function spanArrows(span) {
  return isNarrow(span) ? { left: span.x0 - 2 * GRID, right: span.x1 + 2 * GRID } : { left: span.x0, right: span.x1 };
}

/**
 * Where a span's text goes (from the waves' left edge), placed `way`:
 * 'under' its arrow, centered; or, beside a narrow span's arrows, 'right'
 * of its right arrow's tail or 'left' of its left one's, a quarter cell
 * off. Returns the label's center `x`, its `align`, whether it is `under`,
 * the browser's measure of the same text drawn before (`bounds`, so the
 * label is the size the layout took), and where its ink reaches (`left`,
 * `right`). `measured` maps textMetricsKey to that measure.
 */
function spanText(circuit, measured, span, way) {
  const narrow = isNarrow(span);
  const side = narrow && way !== 'under' ? way : null;
  const align = side === 'left' ? 'right' : side === 'right' ? 'left' : 'center';
  const label = new LabelInstance(circuit, { text: span.text, math: isTexSource(span.text), align, x: 0, y: 0 });
  const bounds = measured.get(label.textMetricsKey()) || null;
  if (bounds) label._renderedTextBounds = { ...bounds };
  const box = label.bbox().w;
  const inset = label.alignInset();
  const w = label.textWidth();
  // The box's center on the grid, its text as near the tail as that allows.
  const x = side === 'right' ? ceilGrid(span.x1 + 2 * GRID + GRID / 4 - inset + box / 2)
    : side === 'left' ? floorGrid(span.x0 - 2 * GRID - GRID / 4 + inset - box / 2)
      : snap((span.x0 + span.x1) / 2);
  const left = side === 'right' ? x - box / 2 + inset : side === 'left' ? x + box / 2 - inset - w : x - w / 2;
  return { x, align, under: !side, bounds, left, right: left + w };
}

/** Take the diagram away, the design's and the drawn one; returns whether
 *  there was one. With `drawing: false` the drawn diagram stays, until it
 *  is annotated again: the design has no rows. */
export function removeTimingDiagram(circuit, { drawing = true } = {}) {
  const had = !!existingTimingDiagram(circuit);
  const drawn = drawnTimingDiagram(circuit);
  if (drawing) {
    for (const id of drawn?.ids || []) circuit.removeLabel(id);
    circuit.timing = null;
  } else if (had || drawn) {
    circuit.timing = { slot: circuit.timing?.slot || DEFAULT_SLOT_CELLS, rows: [] };
  }
  return had || (drawing && !!drawn);
}

/** Draw the design's diagram as it is, replacing one drawn already (see
 *  addTimingDiagram); with no rows, take the drawn one away. `place` puts
 *  it under the drawing again. Returns the rows drawn. */
export function annotateTimingDiagram(circuit, { place = false } = {}) {
  if (!existingTimingDiagram(circuit)) {
    removeTimingDiagram(circuit);
    return [];
  }
  return addTimingDiagram(circuit, { place });
}

/**
 * The design's diagram set as addTimingDiagram sets it -- the same
 * options, the same checks -- without drawing it: the drawn diagram, if
 * any, stays as it was until annotated again. Returns { missing }: the
 * arrows, marks, spans and breaks that wait for an edge that has gone, as
 * existingTimingDiagram's.
 */
export function setTimingDiagram(circuit, options = {}) {
  return timingDiagram(circuit, options, false);
}

/** The design's arrows, marks, spans and breaks that wait for an edge that
 *  has gone ([{ kind, index }]), whether it is drawn or not. */
export function timingMissing(circuit) {
  return existingTimingDiagram(circuit) ? timingDiagram(circuit, {}, 'plan').missing : [];
}

/**
 * Set the design's diagram (`Circuit#timing`) and draw it, replacing one
 * already drawn, else under everything drawn so far; either way with its waves centered on the drawing's width. `bits` gives waves
 * by phase name (see timingPhaseNamed); `fromBeats` takes the waves not given
 * from the beats rather than the diagram already drawn; `slot` is a slot's
 * width in cells; `gaps` is 'auto', 'none', or pairs of phase names kept from
 * overlapping (both kept from the diagram drawn before when not given; a new
 * diagram has none);
 * `shifts` gives rows' edge shifts ({ fall, rise } cells) by phase name, the
 * rest keeping theirs. A complement following its phase takes the phase's
 * shifts the other way round -- the phase falling early, it rises early --
 * plus its own. Returns the rows: [{ phase, bits, from, shift, label, line,
 * lines }].
 */
export function addTimingDiagram(circuit, options = {}) {
  return timingDiagram(circuit, options, true);
}

/** A row's own part of its name label's `timing`, as the design keeps it. */
function rowTiming({ key, bits, values, hold, height, from, signal }, shift) {
  return {
    phase: key,
    ...(values ? { values, ...(hold ? { hold: true } : {}) } : from === 'complement' || from === 'low' ? {} : { bits }),
    ...(height ? { height } : {}),
    ...(shift.fall || shift.rise ? { shift } : {}),
    ...(signal ? { signal: true } : {}),
  };
}

function timingDiagram(circuit, { bits: given = {}, fromBeats = false, slot = null, gaps = null, shifts: givenShifts = {}, order = null, place = false, add = [], remove = [], arrows = null, marks = null, spans = null, breaks = null, need = [], heights: givenHeights = {}, hold: givenHold = {} } = {}, draw = true) {
  const current = timingPhases(circuit);
  for (const name of add) {
    if (!String(name).trim()) throw new Error('a signal needs a name');
    const taken = current.find((phase) => samePhase(phase.key, phaseKey(name)));
    if (taken) throw new Error(`the diagram has ${plainTexText(taken.source)} already`);
  }
  for (const name of remove) {
    const phase = timingPhaseNamed(current, name);
    if (!phase) throw new Error(`the diagram has no row "${name}"`);
    if (!phase.signal) throw new Error(`${plainTexText(phase.source)} is a switch phase: its row comes from its switches`);
  }
  const phases = timingPhases(circuit, { add, remove: remove.map((name) => timingPhaseNamed(current, name).source) });
  if (!phases.length) {
    if (remove.length && removeTimingDiagram(circuit, { drawing: draw })) return draw ? [] : { missing: [] };
    throw new Error('nothing to draw yet: no switch has a phase (label switches with the signal that controls them), and the diagram has no signals (timing --add CLK)');
  }
  const named = (name) => {
    const phase = timingPhaseNamed(phases, name);
    if (!phase) throw new Error(`no row "${name}"; rows: ${phases.map((p, i) => `${i + 1} ${plainTexText(p.source)}`).join(', ')}`);
    return phase;
  };
  const typed = new Map();
  for (const [name, text] of Object.entries(given)) {
    const phase = named(name);
    const wave = parseTimingWave(text);
    if (wave.values && !phase.signal) throw new Error(`${plainTexText(phase.source)} is a switch phase: its row is digital (1 and 0); an analog row is a signal of the diagram's own (timing --add)`);
    typed.set(phase.key, wave);
  }
  // Holding analog values through their slots, or joining them straight.
  for (const [name, on] of Object.entries(givenHold)) {
    const phase = named(name);
    const current = typed.get(phase.key) || (existingTimingDiagram(circuit)?.values.has(phase.key) ? { values: existingTimingDiagram(circuit).values.get(phase.key) } : null);
    if (!current?.values) throw new Error(`${plainTexText(phase.source)} is not analog: only an analog row holds its values`);
    typed.set(phase.key, { ...current, hold: !!on });
  }
  const rows = timingRowSources(circuit, { fromBeats, typed, phases, order: order ? order.map((name) => named(name).key) : null });
  for (const [name, cells] of Object.entries(givenHeights)) {
    const key = named(name).key;
    const n = Number(cells);
    if (!Number.isInteger(n) || n < 2 || n % 2 || n > MAX_ROW_CELLS) throw new Error(`a row is 2, 4, 6 ... ${MAX_ROW_CELLS} cells tall, not ${cells}`);
    for (const row of rows) if (samePhase(row.key, key)) { if (n === 2) delete row.height; else row.height = n; }
  }
  const before = existingTimingDiagram(circuit);
  const ownShift = new Map();
  for (const [name, shift] of Object.entries(givenShifts)) ownShift.set(named(name).key, normalizeEdgeShift(shift));
  const own = (key) => ownShift.get(key) ?? before?.shifts.get(key) ?? { fall: 0, rise: 0 };
  const drawnShift = rows.map((row) => {
    const mine = own(row.key);
    if (row.complementOf === undefined) return mine;
    const base = own(rows[row.complementOf].key);
    return normalizeEdgeShift({ fall: base.rise + mine.fall, rise: base.fall + mine.rise });
  });
  const slotCells = Math.max(1, Math.round(Number(slot) || before?.slot || DEFAULT_SLOT_CELLS));
  const setting = gaps === null || gaps === undefined ? before?.gaps ?? 'none'
    : gaps === false ? 'none'
      : Array.isArray(gaps) ? gaps.map(([a, b]) => [named(a).key, named(b).key]) : gaps;
  const { columns, levels } = timingColumns(rows.map((row) => row.bits), {
    slotCells, pairs: timingPairs(rows, setting), inverted: rows.map((row) => row.complementOf ?? null),
  });
  // The edges each row draws, from the waves' top-left corner; the arrows,
  // marks and spans placed on them.
  const geometry = rowLayout(rows);
  const analog = rows.map((row) => (row.values ? analogRowGeometry(row.values, columns, { hold: row.hold }) : null));
  const edges = rows.map((row, r) => (analog[r] ? [] : timingRowEdges(levels[r], columns, 0, 0, drawnShift[r], geometry.heights[r])));
  // An analog row's every slot start is a point to attach to.
  const edgeOf = (ref) => {
    const r = rows.findIndex((row) => samePhase(row.key, ref.row));
    if (r >= 0 && analog[r]) {
      const point = analog[r].points[ref.at];
      return point ? { x: point.x, row: r, v: point.v } : null;
    }
    const edge = r < 0 ? null : edges[r].find((candidate) => candidate.at === ref.at);
    return edge ? { x: edge.x, row: r } : null;
  };
  const notes = timingNotes({ arrows: arrows ?? before?.arrows ?? [], marks: marks ?? before?.marks ?? [], spans: spans ?? before?.spans ?? [], breaks: breaks ?? before?.breaks ?? [] });
  // A span's text placed as it will be drawn: its ink, not its box, and as
  // the browser measured the same text in the diagram drawn before.
  const measured = new Map([...circuit.labels.values()].filter((label) => label.timing?.part === 'note' && label.textMeasured())
    .map((label) => [label.textMetricsKey(), label._renderedTextBounds]));
  const layout = notesLayout(notes, edgeOf, geometry, (span, way) => spanText(circuit, measured, span, way));
  const cuts = breaksLayout(notes.breaks, columns, geometry);
  // What was just asked for must be drawn; one kept from before whose edge
  // has gone waits for it.
  const describe = (ref) => {
    const row = rows.find((candidate) => samePhase(candidate.key, ref.row));
    return `${row ? plainTexText(row.source) : ref.row} at the start of slot ${ref.at + 1}`;
  };
  for (const { kind, item } of need) {
    const list = notes[`${kind}s`];
    if (kind === 'break') {
      const count = slotStarts(columns).length - 1;
      if (item.at >= count) throw new Error(`the diagram has no slot ${item.at + 1}: it has ${count}`);
      continue;
    }
    const index = list.findIndex((other) => (kind === 'mark' ? sameEdge(other, item) : sameEdge(other.from, item.from) && sameEdge(other.to, item.to)));
    if (index < 0 || !layout.missing.some((m) => m.kind === kind && m.index === index)) continue;
    const ends = kind === 'mark' ? [item] : [item.from, item.to];
    const gone = ends.find((ref) => !edgeOf(ref));
    if (gone) throw new Error(`${describe(gone)} has no edge (an edge is where a row changes level; the one at the end of the last slot is slot ${columns.at(-1).at + 1})`);
    throw new Error(kind === 'arrow' ? 'an arrow runs between two different edges' : 'a span runs between edges at two different times');
  }

  // A complement drawn as its phase inverted keeps following it: its wave is
  // not remembered as its own.
  const settings = {
    slot: slotCells,
    ...(setting === 'auto' ? {} : { gaps: setting === 'none' ? false : setting }),
    ...(notes.arrows.length ? { arrows: notes.arrows } : {}),
    ...(notes.marks.length ? { marks: notes.marks } : {}),
    ...(notes.spans.length ? { spans: notes.spans } : {}),
    ...(notes.breaks.length ? { breaks: notes.breaks } : {}),
  };
  const missing = [...layout.missing, ...notes.breaks.flatMap((_, index) => (cuts.some((cut) => cut.index === index) ? [] : [{ kind: 'break', index }]))];
  if (draw === 'plan') return { missing };
  // The design keeps it as its name labels carry it, the settings once.
  circuit.timing = normalizeTimingSpec({ ...settings, rows: rows.map((row) => ({ source: row.source, ...rowTiming(row, own(row.key)) })) });
  if (!draw) return { missing };

  const drawnBefore = drawnTimingDiagram(circuit);
  for (const id of drawnBefore?.ids || []) circuit.removeLabel(id);
  const drawn = circuit.inkBounds(0, { labels: (label) => !label.timing });
  const labels = rows.map((row, index) => circuit.addLabel({
    text: row.source,
    math: isTexSource(row.source),
    align: 'right',
    // Placed below, once the diagram's spot is known.
    x: 0,
    y: geometry.tops[index],
    timing: { ...rowTiming(row, own(row.key)), ...settings },
  }));
  // A diagram stays where it stands (dragged there, or placed before); a new
  // one -- or one asked to (`place`) -- has its waves centered on the
  // drawing's width, as high as the drawing leaves room for it, else below.
  const waves = columns.reduce((sum, c) => sum + c.w, 0);
  const column = Math.max(...labels.map((label) => label.bbox().w));
  const height = layout.height;
  let waveX;
  let top;
  if (drawnBefore && !place) {
    waveX = drawnBefore.x;
    top = drawnBefore.y;
  } else {
    waveX = snap(drawn.x + drawn.w / 2 - waves / 2);
    top = timingSpot(circuit, { x: waveX - LABEL_GAP - column, w: column + LABEL_GAP + waves, h: height }, drawn);
  }
  labels.forEach((label, row) => label.moveTo(waveX - LABEL_GAP - label.bbox().w / 2, top + geometry.tops[row] + geometry.heights[row] / 2));
  drawNotes(circuit, notes, layout, { x: waveX, y: top }, settings);
  const drawnRows = labels.map((label, row) => {
    const { key, bits, values, hold, from, signal } = rows[row];
    const rowTop = top + geometry.tops[row];
    let line;
    if (analog[row]) {
      // The curve in a box of its own: the box on the grid, the curve not.
      const box = analog[row];
      const thresholds = layout.thresholds.filter((mark) => mark.row === row).map(({ x, v }) => [x, v]);
      line = circuit.addAnnotation('box', {
        x: waveX, y: rowTop, end: { x: waveX + box.width, y: rowTop + geometry.heights[row] },
        style: { lineStyle: 'solid' },
        timing: { phase: key, analog: { trace: box.trace.map(({ x, v }) => [x, v]), ...(bipolar(values) ? { bipolar: true } : {}), ...(thresholds.length ? { thresholds } : {}) }, ...settings },
      }).id;
    } else {
      const points = timingRowGeometry(levels[row], columns, waveX, rowTop, drawnShift[row], geometry.heights[row]);
      line = circuit.addAnnotation('line', { points, timing: { phase: key, ...settings } }).id;
    }
    return { phase: key, bits, ...(values ? { values, ...(hold ? { hold: true } : {}) } : {}), from, shift: own(key), label: label.id, line, lines: [line], ...(signal ? { signal: true } : {}) };
  });
  // Breaks over the waves, drawn above them.
  for (const { index, x0, x1, y0, y1, row } of cuts) {
    circuit.addAnnotation('box', {
      x: waveX + x0, y: top + y0, end: { x: waveX + x1, y: top + y1 },
      style: { width: 'thin', lineStyle: 'solid' }, drawOrder: 1,
      timing: { phase: rows[row].key, part: 'break', item: index, ...settings },
    });
  }
  return drawnRows;
}

/**
 * Where the breaks go, from the waves' top-left corner: a box over its
 * slot, from the first row's top to the last row's bottom, or (`rows`) one
 * per row over that row alone; the break is drawn down its middle. Returns
 * [{ index, row, x0, x1, y0, y1 }]; a break whose slot is past the end has
 * none.
 */
function breaksLayout(breaks, columns, rows) {
  const starts = slotStarts(columns);
  return breaks.flatMap((item, index) => {
    const slot = columns.find((column) => column.kind === 'slot' && column.at === item.at);
    if (!slot) return [];
    const [x0, x1] = [starts[item.at], starts[item.at] + slot.w];
    if (!item.rows) return [{ index, row: 0, x0, x1, y0: 0, y1: rows.bottom }];
    return rows.tops.map((y, row) => ({ index, row, x0, x1, y0: y, y1: y + rows.heights[row] }));
  });
}

/** Draw the arrows, marks and spans laid out by notesLayout, the waves'
 *  top-left corner at `origin`: thin ink, each remembering what it is
 *  (`timing.part`, and `item`, its place in the diagram's list). */
function drawNotes(circuit, notes, layout, origin, settings) {
  const at = (point) => ({ x: origin.x + point.x, y: origin.y + point.y });
  const timing = (part, ref, item) => ({ phase: ref.row, part, item, ...settings });
  const shape = (kind, points, part, ref, item, style) => circuit.addLabel({
    kind, text: '', x: points[0].x, y: points[0].y, end: points.at(-1), points, timing: timing(part, ref, item), style: { width: 'thin', ...style },
    ...(kind === 'arrow' ? { curve: true } : {}),
  });
  for (const { index, from, to } of layout.arrows) {
    const ref = notes.arrows[index].from;
    shape('arrow', [at(from), at(to)], 'arrow', ref, index, {});
    // Its text, if any, just after the edge it points at, in the middle of
    // that row: clear of the row's levels, and of the arrow, which comes in
    // from the left.
    const text = notes.arrows[index].text;
    if (!text) continue;
    const tip = at(to);
    const label = circuit.addLabel({ text, math: isTexSource(text), align: 'left', x: tip.x, y: tip.y, timing: timing('arrow-note', ref, index) });
    label.moveTo(ceilGrid(tip.x + label.bbox().w / 2), tip.y);
  }
  // A dashed guide at each mark and span end, from a cell above the waves.
  for (const { kind, index, x, bottom } of layout.guides) {
    shape('line', [at({ x, y: -GRID }), at({ x, y: bottom })], kind, kind === 'mark' ? notes.marks[index] : notes.spans[index].from, index, { lineStyle: 'dashed' });
  }
  for (const { index, text, x0, x1, y, place } of layout.spans) {
    const ref = notes.spans[index].from;
    // A narrow span is pointed at from outside, an arrow at each end.
    const narrow = x1 - x0 < 3 * GRID;
    if (!narrow) shape('line', [at({ x: x0, y }), at({ x: x1, y })], 'span', ref, index, { arrowhead: 'both' });
    else {
      shape('line', [at({ x: x0 - 2 * GRID, y }), at({ x: x0, y })], 'span', ref, index, { arrowhead: 'end' });
      shape('line', [at({ x: x1 + 2 * GRID, y }), at({ x: x1, y })], 'span', ref, index, { arrowhead: 'end' });
    }
    if (!text) continue;
    // Where the layout placed it (spanText), the size it took it to be.
    const label = circuit.addLabel({ text, math: isTexSource(text), align: place.align, ...at({ x: place.x, y: place.under ? y + GRID : y }), timing: timing('note', ref, index) });
    if (place.bounds) label._renderedTextBounds = { ...place.bounds };
  }
}
