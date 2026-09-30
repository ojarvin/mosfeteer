/**
 * Timing diagram: one clock waveform per switch phase, drawn under the
 * drawing as annotations -- each phase's name (its own spelling, TeX drawn
 * as math) and its wave, two cells tall with vertical edges.
 *
 * A wave is a string of slots, one character each:
 *
 *   1   high for a slot          0   low for a slot
 *   _   a short low gap, one cell wide in every row (non-overlap)
 *   ^   a short high gap, the same width (a complement's side of a gap)
 *   x   don't care: both levels, crossed
 *
 * A row's string is, first to last: the one given for it; the one it had in
 * the diagram already; for a complement (a barred phase), its phase's string
 * inverted; one slot per beat, high where the phase's switches are closed;
 * else the template (4 cells low, 8 high, 8 low, 4 high) to edit by hand.
 * The drawn annotations remember their strings (`LabelInstance#timing`), so
 * drawing the diagram again replaces it where it stands.
 */

import { GRID, ceilGrid, floorGrid } from './grid.js';
import { complementKey, isComplementPhase, isTexSource, phaseKey, samePhase, switchPhases, switchStateAt, switchesOf } from './beats.js';
import { plainTexText } from './render.js';

/** Template waveform levels by run, in cells: [length, high?]. */
const WAVE = [[4, false], [8, true], [8, false], [4, true]];
const WAVE_HEIGHT = 2 * GRID;
const ROW_PITCH = 3 * GRID;
const GAP_BELOW_DRAWING = 2 * GRID;
const LABEL_GAP = GRID;
/** A slot's default width, in cells. */
export const DEFAULT_SLOT_CELLS = 4;

/** Points of one template waveform starting at (x, top); `inverted` for a
 *  complementary phase. */
export function timingWavePoints(x, top, { inverted = false } = {}) {
  const level = (high) => (high !== inverted ? top : top + WAVE_HEIGHT);
  const points = [{ x, y: level(WAVE[0][1]) }];
  for (const [cells, high] of WAVE) {
    const last = points.at(-1);
    if (last.y !== level(high)) points.push({ x: last.x, y: level(high) });
    points.push({ x: last.x + cells * GRID, y: level(high) });
  }
  return points;
}

/** A wave string as typed: 0, 1, _, ^ and x kept (L/H and - too),
 *  anything else rejected; spaces ignored. */
export function parseTimingBits(text) {
  const bits = String(text ?? '').replace(/\s+/g, '')
    .replace(/[lL]/g, '0').replace(/[hH]/g, '1').replace(/-/g, '_').replace(/X/g, 'x');
  const bad = bits.match(/[^01_^x]/);
  if (bad) throw new Error(`a timing wave is made of 0, 1, _ and ^ (a short low or high gap) and x (don't care), not "${bad[0]}"`);
  return bits;
}

const INVERSE = { 0: '1', 1: '0', _: '^', '^': '_', x: 'x' };

/** A wave the other way up: highs and lows swap, gaps included. */
export function invertTimingBits(bits) {
  return [...bits].map((ch) => INVERSE[ch] ?? ch).join('');
}

/** A phase's wave from the beats: one slot per beat, high where its switches
 *  are closed. Empty without beats. */
export function beatTimingBits(circuit, key) {
  const [first] = switchesOf(circuit, key);
  if (!first) return '';
  return (circuit.beats || []).map((_, index) => (switchStateAt(circuit, first.refdes, index) === 'closed' ? '1' : '0')).join('');
}

/** The columns of a diagram: one per slot, a gap column (any row has `_`
 *  or `^` there) one cell wide in every row. */
export function timingColumns(strings, x, slotCells = DEFAULT_SLOT_CELLS) {
  const count = Math.max(0, ...strings.map((bits) => bits.length));
  const columns = [];
  let at = x;
  for (let index = 0; index < count; index += 1) {
    const gap = strings.some((bits) => bits[index] === '_' || bits[index] === '^');
    const w = (gap ? 1 : slotCells) * GRID;
    columns.push({ x: at, w, gap });
    at += w;
  }
  return columns;
}

/**
 * The points of one row's wave: `bits` over `columns` ([{ x, w }]), top at
 * `top`; a short string holds its last level to the end. Returns { lines,
 * crosses }, point lists: the wave breaks at a don't-care, which is drawn as
 * its own crossed band.
 */
export function timingRowGeometry(bits, columns, top) {
  const high = top;
  const low = top + WAVE_HEIGHT;
  const lines = [];
  const crosses = [];
  let current = null;
  columns.forEach((column, index) => {
    const ch = bits[index] ?? bits.at(-1) ?? '0';
    const x0 = column.x;
    const x1 = column.x + column.w;
    if (ch === 'x') {
      if (current) lines.push(current);
      current = null;
      crosses.push([{ x: x0, y: high }, { x: x1, y: high }], [{ x: x0, y: low }, { x: x1, y: low }],
        [{ x: x0, y: high }, { x: x1, y: low }], [{ x: x0, y: low }, { x: x1, y: high }]);
      return;
    }
    const y = ch === '1' || ch === '^' ? high : low;
    if (!current) current = [{ x: x0, y }];
    else if (current.at(-1).y !== y) current.push({ x: x0, y });
    current.push({ x: x1, y });
  });
  if (current) lines.push(current);
  // A level held over several slots is one segment.
  for (const line of lines) {
    for (let i = line.length - 2; i > 0; i -= 1) {
      if (line[i - 1].y === line[i].y && line[i].y === line[i + 1].y) line.splice(i, 1);
    }
  }
  return { lines, crosses };
}

/** Phases in drawing order, each complement right after its phase; a pair
 *  goes where the first of the two was drawn. */
export function timingOrder(phases) {
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

/** The diagram already drawn: its annotations' ids, each phase's string,
 *  its slot width, and where it starts ({ x, y }: its names' left edge and
 *  its first row's top). Null when there is none. */
export function existingTimingDiagram(circuit) {
  const parts = [...circuit.labels.values()].filter((label) => label.timing);
  if (!parts.length) return null;
  const bits = new Map();
  for (const label of parts) if (typeof label.timing.bits === 'string') bits.set(label.timing.phase, label.timing.bits);
  const names = parts.filter((label) => label.kind === 'label');
  const waves = parts.filter((label) => label.kind !== 'label');
  const x = Math.min(...(names.length ? names : parts).map((label) => label.bbox().x));
  const y = Math.min(...waves.map((label) => label.bbox().y), ...names.map((label) => label.anchorWorld().y - WAVE_HEIGHT / 2));
  const slot = parts.find((label) => label.timing.slot)?.timing.slot || DEFAULT_SLOT_CELLS;
  return { ids: parts.map((label) => label.id), bits, x, y, slot };
}

/** Every phase's string as the diagram would draw it now (see the header),
 *  for a form to start from: [{ key, source, bits, from }], `from` one of
 *  'diagram', 'complement', 'beats', or 'template' (bits empty). */
export function timingRowSources(circuit, { fromBeats = false, typed = new Map() } = {}) {
  const phases = timingOrder(switchPhases(circuit));
  const before = fromBeats ? null : existingTimingDiagram(circuit);
  const own = (key) => typed.get(key) ?? before?.bits.get(key) ?? null;
  return phases.map(({ key, source }) => {
    if (typed.has(key)) return { key, source, bits: typed.get(key), from: 'typed' };
    if (before?.bits.has(key)) return { key, source, bits: before.bits.get(key), from: 'diagram' };
    const base = isComplementPhase(key) ? phases.find((other) => samePhase(other.key, complementKey(key))) : null;
    if (base && own(base.key)) return { key, source, bits: invertTimingBits(own(base.key)), from: 'complement' };
    const beats = beatTimingBits(circuit, key);
    return beats ? { key, source, bits: beats, from: 'beats' } : { key, source, bits: '', from: 'template' };
  });
}

/**
 * Draw the diagram, replacing one already drawn where it stands, else under
 * everything drawn so far. `bits` gives strings by phase name (see
 * timingPhaseNamed); `fromBeats` takes the strings not given from the beats
 * rather than the diagram already drawn; `slot` is a slot's width in cells.
 * Returns the rows: [{ phase, bits, label, line, lines }], `bits` empty for a
 * template row.
 */
export function addTimingDiagram(circuit, { bits: given = {}, fromBeats = false, slot = null } = {}) {
  const phases = timingOrder(switchPhases(circuit));
  if (!phases.length) throw new Error('no switch has a phase yet: label switches with the signal that controls them');
  const typed = new Map();
  for (const [name, text] of Object.entries(given)) {
    const phase = timingPhaseNamed(phases, name);
    if (!phase) throw new Error(`no switch phase "${name}"; phases: ${phases.map((p, i) => `${i + 1} ${plainTexText(p.source)}`).join(', ')}`);
    typed.set(phase.key, parseTimingBits(text));
  }
  const rows = timingRowSources(circuit, { fromBeats, typed });
  const before = existingTimingDiagram(circuit);
  const slotCells = Math.max(1, Math.round(Number(slot) || before?.slot || DEFAULT_SLOT_CELLS));

  if (before) for (const id of before.ids) circuit.removeLabel(id);
  const drawn = circuit.bounds();
  const left = before ? before.x : floorGrid(drawn.x);
  const top = before ? before.y : ceilGrid(drawn.y + drawn.h) + GAP_BELOW_DRAWING;
  // A complement drawn as its phase inverted keeps following it: its wave is
  // not remembered as its own.
  const labels = rows.map(({ key, source, bits, from }, row) => circuit.addLabel({
    text: source,
    math: isTexSource(source),
    align: 'right',
    x: left,
    y: top + row * ROW_PITCH + WAVE_HEIGHT / 2,
    timing: { phase: key, ...(from === 'complement' ? {} : { bits }), slot: slotCells },
  }));
  // Right-align the phase names in one column flush with the diagram's left
  // edge; the waves start one cell after the widest.
  const column = Math.max(...labels.map((label) => label.bbox().w));
  const edge = left + column;
  for (const label of labels) label.moveTo(edge - label.bbox().w / 2, label.anchor.y);
  const columns = timingColumns(rows.map((row) => row.bits).filter(Boolean), edge + LABEL_GAP, slotCells);
  return labels.map((label, row) => {
    const { key, bits } = rows[row];
    const rowTop = top + row * ROW_PITCH;
    const timing = { phase: key, slot: slotCells };
    const paths = bits && columns.length
      ? Object.values(timingRowGeometry(bits, columns, rowTop)).flat()
      : [timingWavePoints(edge + LABEL_GAP, rowTop, { inverted: isComplementPhase(key) })];
    const lines = paths.map((points) => circuit.addAnnotation('line', { points, timing }).id);
    return { phase: key, bits, label: label.id, line: lines[0], lines };
  });
}
