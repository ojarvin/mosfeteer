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
 * Non-overlap is kept between pairs of phases: by default every two that
 * are never high in the same slot. Where one of a pair falls and the other
 * rises, a one-cell gap opens in every row; in it the pair's fall comes early
 * and its rise late, so the two are never high at once. Other phases change
 * at the start of the gap.
 *
 * A row's wave is, first to last: the one given for it; the one it had in
 * the diagram already; for a complement (a barred phase), its phase drawn
 * inverted, gaps included; one slot per beat, high where the phase's
 * switches are closed; else low throughout. The drawn annotations remember
 * their waves (`LabelInstance#timing`), so drawing the diagram again
 * replaces it where it stands.
 */

import { GRID, ceilGrid, snap } from './grid.js';
import { complementKey, isComplementPhase, isTexSource, phaseKey, samePhase, switchPhases, switchStateAt, switchesOf } from './beats.js';
import { plainTexText } from './render.js';

const WAVE_HEIGHT = 2 * GRID;
const ROW_PITCH = 3 * GRID;
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
 *  phase is that phase. */
export function timingPhases(circuit, { add = [], remove = [] } = {}) {
  const phases = switchPhases(circuit);
  const known = (key, list) => list.some((phase) => samePhase(phase.key, key));
  const signals = [];
  for (const signal of [...(existingTimingDiagram(circuit)?.signals || []), ...add.map((source) => ({ key: phaseKey(source), source: String(source).trim() }))]) {
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
 * 'lead'|'slot'|'gap' }] and, per row, ['0'|'1', ...]. `waves` are the
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
      columns.push({ w: GRID, kind: 'gap' });
      // The pair falls early and rises late; the rest change as the gap opens.
      sequence.forEach((row, r) => levels[r].push(kept.has(r) ? gapLevel(row[index - 1], row[index]) : row[index]));
    }
    const edge = index === 0 || index === sequence[0].length - 1;
    columns.push({ w: edge ? lead : slotCells * GRID, kind: edge ? 'lead' : 'slot' });
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
export function timingRowGeometry(levels, columns, x, top, shift = {}) {
  const y = (level) => (level === '1' ? top : top + WAVE_HEIGHT);
  const starts = [];
  columns.reduce((at, column) => { starts.push(at); return at + column.w; }, x);
  const end = x + columns.reduce((sum, column) => sum + column.w, 0);
  const points = [{ x, y: y(levels[0]) }];
  let last = x;
  for (let index = 1; index < columns.length; index += 1) {
    if (levels[index] === levels[index - 1]) continue;
    const cells = levels[index] === '1' ? shift.rise || 0 : shift.fall || 0;
    const lo = Math.max(starts[index - 1], last);
    const hi = starts[index] + columns[index].w;
    const at = Math.max(lo, Math.min(hi, starts[index] + cells * GRID));
    points.push({ x: at, y: y(levels[index - 1]) }, { x: at, y: y(levels[index]) });
    last = at;
  }
  points.push({ x: end, y: y(levels.at(-1)) });
  // A level held over several columns is one segment; an edge pushed onto
  // the next one cancels out.
  for (let i = points.length - 2; i > 0; i -= 1) {
    const [a, b, c] = [points[i - 1], points[i], points[i + 1]];
    if ((a.y === b.y && b.y === c.y) || (a.x === b.x && b.x === c.x)) points.splice(i, 1);
  }
  return points.filter((point, i) => i === 0 || point.x !== points[i - 1].x || point.y !== points[i - 1].y);
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
  if (!existingTimingDiagram(circuit)) return null;
  // The diagram's own signals switch nothing.
  const rows = timingRowSources(circuit).filter((row) => !row.signal);
  if (!rows.length) return null;
  const count = Math.max(1, ...rows.map((row) => row.bits.length));
  const level = (row, slot) => (row.bits.length ? row.bits[Math.min(slot, row.bits.length - 1)] : '0');
  const high = (row, slot) => (row.complementOf !== undefined ? level(rows[row.complementOf], slot) === '0' : level(row, slot) === '1');
  const states = [];
  for (let slot = 0; slot < count; slot += 1) {
    const closed = rows.filter((row) => high(row, slot));
    const key = closed.map((row) => row.key).join('|');
    if (states.at(-1)?.key === key) continue;
    states.push({ key, name: closed.length ? stateName(closed.map((row) => row.source)) : 'all open', closed: new Set(closed.map((row) => row.key)) });
  }
  // A wave that ends as it starts goes round: its last state is its first.
  if (states.length > 1 && states[0].key === states.at(-1).key) states.pop();
  return states.map(({ name, closed }) => ({ name, closed }));
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

/** The diagram already drawn: its annotations' ids, each phase's own wave
 *  and edge shift, its slot width and non-overlap setting, and where it stands ({ x, y }:
 *  its waves' left edge and first row's top). Null when there is none. */
export function existingTimingDiagram(circuit) {
  const parts = [...circuit.labels.values()].filter((label) => label.timing);
  if (!parts.length) return null;
  const bits = new Map();
  const shifts = new Map();
  for (const label of parts) {
    if (typeof label.timing.bits === 'string') bits.set(label.timing.phase, label.timing.bits);
    if (label.timing.shift) shifts.set(label.timing.phase, normalizeEdgeShift(label.timing.shift));
  }
  const waves = parts.filter((label) => label.kind !== 'label');
  const names = parts.filter((label) => label.kind === 'label');
  // Where it stands, from its names: they keep one place beside the waves,
  // while a wave's own extent moves with its edges (one shifted early at
  // the start reaches left) and its levels (a top row low throughout).
  const x = names.length ? Math.max(...names.map((label) => label.bbox().x + label.bbox().w)) + LABEL_GAP : Math.min(...waves.map((label) => label.bbox().x));
  const y = names.length ? Math.min(...names.map((label) => label.anchorWorld().y - WAVE_HEIGHT / 2)) : Math.min(...waves.map((label) => label.bbox().y));
  const first = parts.find((label) => label.timing.slot) || parts[0];
  // The rows' order, top to bottom, as the names stand.
  const sorted = [...names].sort((a, b) => a.anchorWorld().y - b.anchorWorld().y);
  const order = sorted.map((label) => label.timing.phase);
  // The diagram's own signals, spelled as their names are.
  const signals = sorted.filter((label) => label.timing.signal).map((label) => ({ key: label.timing.phase, source: label.text }));
  return { ids: parts.map((label) => label.id), bits, shifts, order, signals, x, y, slot: first.timing.slot, gaps: first.timing.gaps ?? 'auto' };
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
    const index = (key) => rows.findIndex((row) => samePhase(row.key, key));
    return setting.map(([a, b]) => [index(a), index(b)]).filter(([a, b]) => a >= 0 && b >= 0 && a !== b).map(([a, b]) => [Math.min(a, b), Math.max(a, b)]);
  }
  // A complement follows its phase; a signal of the diagram's own is kept
  // apart only when asked.
  const skip = new Set(rows.flatMap((row, index) => (row.complementOf !== undefined || row.signal ? [index] : [])));
  return defaultTimingPairs(rows.map((row) => row.bits), skip);
}

/** Every row's wave as the diagram would draw it now (see the header):
 *  [{ key, source, bits, from, complementOf, signal }], `from` one of
 *  'typed', 'diagram', 'complement' (drawn as row `complementOf` inverted),
 *  'beats', or 'low' (bits empty); `signal` marks the diagram's own signals.
 *  `phases` defaults to timingPhases. */
export function timingRowSources(circuit, { fromBeats = false, typed = new Map(), order = null, phases: given = null } = {}) {
  const drawnBefore = existingTimingDiagram(circuit);
  const phases = arranged(given || timingPhases(circuit), order || drawnBefore?.order);
  const before = fromBeats ? null : drawnBefore;
  return phases.map(({ key, source, signal }) => {
    const own = signal ? { signal: true } : {};
    if (typed.has(key)) return { key, source, bits: typed.get(key), from: 'typed', ...own };
    if (before?.bits.has(key)) return { key, source, bits: before.bits.get(key), from: 'diagram', ...own };
    const base = isComplementPhase(key) ? phases.findIndex((other) => samePhase(other.key, complementKey(key))) : -1;
    if (base >= 0) return { key, source, bits: '', from: 'complement', complementOf: base, ...own };
    const beats = signal ? '' : beatTimingBits(circuit, key);
    return beats ? { key, source, bits: beats, from: 'beats' } : { key, source, bits: '', from: 'low', ...own };
  });
}

/** Take the drawn diagram away; returns whether there was one. */
export function removeTimingDiagram(circuit) {
  const before = existingTimingDiagram(circuit);
  if (!before) return false;
  for (const id of before.ids) circuit.removeLabel(id);
  return true;
}

/**
 * Draw the diagram, replacing one already drawn, else under everything
 * drawn so far; either way with its waves centred on the drawing's width. `bits` gives waves
 * by phase name (see timingPhaseNamed); `fromBeats` takes the waves not given
 * from the beats rather than the diagram already drawn; `slot` is a slot's
 * width in cells; `gaps` is 'auto', 'none', or pairs of phase names kept from
 * overlapping (both kept from the diagram drawn before when not given);
 * `shifts` gives rows' edge shifts ({ fall, rise } cells) by phase name, the
 * rest keeping theirs. A complement following its phase takes the phase's
 * shifts the other way round -- the phase falling early, it rises early --
 * plus its own. Returns the rows: [{ phase, bits, from, shift, label, line,
 * lines }].
 */
export function addTimingDiagram(circuit, { bits: given = {}, fromBeats = false, slot = null, gaps = null, shifts: givenShifts = {}, order = null, place = false, add = [], remove = [] } = {}) {
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
    if (remove.length && removeTimingDiagram(circuit)) return [];
    throw new Error('nothing to draw yet: no switch has a phase (label switches with the signal that controls them), and the diagram has no signals (timing --add CLK)');
  }
  const named = (name) => {
    const phase = timingPhaseNamed(phases, name);
    if (!phase) throw new Error(`no row "${name}"; rows: ${phases.map((p, i) => `${i + 1} ${plainTexText(p.source)}`).join(', ')}`);
    return phase;
  };
  const typed = new Map();
  for (const [name, text] of Object.entries(given)) typed.set(named(name).key, parseTimingBits(text));
  const rows = timingRowSources(circuit, { fromBeats, typed, phases, order: order ? order.map((name) => named(name).key) : null });
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
  const setting = gaps === null || gaps === undefined ? before?.gaps ?? 'auto'
    : gaps === false ? 'none'
      : Array.isArray(gaps) ? gaps.map(([a, b]) => [named(a).key, named(b).key]) : gaps;
  const { columns, levels } = timingColumns(rows.map((row) => row.bits), {
    slotCells, pairs: timingPairs(rows, setting), inverted: rows.map((row) => row.complementOf ?? null),
  });

  if (before) for (const id of before.ids) circuit.removeLabel(id);
  const drawn = circuit.inkBounds(0, { labels: (label) => !label.timing });
  // A complement drawn as its phase inverted keeps following it: its wave is
  // not remembered as its own.
  const settings = { slot: slotCells, ...(setting === 'auto' ? {} : { gaps: setting === 'none' ? false : setting }) };
  const labels = rows.map(({ key, source, bits, from, signal }, row) => circuit.addLabel({
    text: source,
    math: isTexSource(source),
    align: 'right',
    // Placed below, once the diagram's spot is known.
    x: 0,
    y: row * ROW_PITCH,
    timing: {
      phase: key,
      ...(from === 'complement' || from === 'low' ? {} : { bits }),
      ...(own(key).fall || own(key).rise ? { shift: own(key) } : {}),
      ...(signal ? { signal: true } : {}),
      ...settings,
    },
  }));
  // A diagram stays where it stands (dragged there, or placed before); a new
  // one -- or one asked to (`place`) -- has its waves centred on the
  // drawing's width, as high as the drawing leaves room for it, else below.
  const waves = columns.reduce((sum, c) => sum + c.w, 0);
  const column = Math.max(...labels.map((label) => label.bbox().w));
  const height = (rows.length - 1) * ROW_PITCH + WAVE_HEIGHT;
  let waveX;
  let top;
  if (before && !place) {
    waveX = before.x;
    top = before.y;
  } else {
    waveX = snap(drawn.x + drawn.w / 2 - waves / 2);
    top = timingSpot(circuit, { x: waveX - LABEL_GAP - column, w: column + LABEL_GAP + waves, h: height }, drawn);
  }
  labels.forEach((label, row) => label.moveTo(waveX - LABEL_GAP - label.bbox().w / 2, top + row * ROW_PITCH + WAVE_HEIGHT / 2));
  return labels.map((label, row) => {
    const { key, bits, from, signal } = rows[row];
    const points = timingRowGeometry(levels[row], columns, waveX, top + row * ROW_PITCH, drawnShift[row]);
    const line = circuit.addAnnotation('line', { points, timing: { phase: key, ...settings } }).id;
    return { phase: key, bits, from, shift: own(key), label: label.id, line, lines: [line], ...(signal ? { signal: true } : {}) };
  });
}
