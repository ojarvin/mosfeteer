/**
 * Timing diagram: one clock waveform per switch phase, drawn under the
 * drawing as annotations -- each phase's name (its own spelling, TeX drawn
 * as math) and its wave, two cells tall with vertical edges.
 *
 * A wave is typed as slots, one character each: `1` high, `0` low, `x`
 * don't care (a crossed band). A short wave holds its last level. The waves
 * repeat, so each row shows a little of its last slot before the start and
 * of its first after the end, where its transitions are. With non-overlap
 * gaps, every slot boundary where some phase changes gets a one-cell gap in
 * every row: a phase falling there has already fallen and one rising has not
 * yet risen, so no two phases are high at once.
 *
 * A row's wave is, first to last: the one given for it; the one it had in
 * the diagram already; for a complement (a barred phase), its phase drawn
 * inverted, gaps included; one slot per beat, high where the phase's
 * switches are closed; else low throughout. The drawn annotations remember
 * their waves (`LabelInstance#timing`), so drawing the diagram again
 * replaces it where it stands.
 */

import { GRID, ceilGrid, floorGrid } from './grid.js';
import { complementKey, isComplementPhase, isTexSource, phaseKey, samePhase, switchPhases, switchStateAt, switchesOf } from './beats.js';
import { plainTexText } from './render.js';

const WAVE_HEIGHT = 2 * GRID;
const ROW_PITCH = 3 * GRID;
const GAP_BELOW_DRAWING = 2 * GRID;
const LABEL_GAP = GRID;
/** A slot's default width, in cells. */
export const DEFAULT_SLOT_CELLS = 4;
/** Slots a diagram with no wave at all shows. */
const EMPTY_SLOTS = 4;

/** A wave as typed: 1, 0 and x kept (H, L and X too), anything else
 *  rejected; spaces ignored. */
export function parseTimingBits(text) {
  const bits = String(text ?? '').replace(/\s+/g, '')
    .replace(/[lL]/g, '0').replace(/[hH]/g, '1').replace(/X/g, 'x');
  const bad = bits.match(/[^01x]/);
  if (bad) throw new Error(`a timing wave is made of 1 (high), 0 (low) and x (don't care), one per slot, not "${bad[0]}"`);
  return bits;
}

/** A level the other way up; don't care stays. */
const invert = (level) => (level === '0' ? '1' : level === '1' ? '0' : level);

/** A phase's wave from the beats: one slot per beat, high where its switches
 *  are closed. Empty without beats. */
export function beatTimingBits(circuit, key) {
  const [first] = switchesOf(circuit, key);
  if (!first) return '';
  return (circuit.beats || []).map((_, index) => (switchStateAt(circuit, first.refdes, index) === 'closed' ? '1' : '0')).join('');
}

/** The level in a gap between `before` and `after`: high only where both
 *  are, so a fall comes early and a rise late. */
const gapLevel = (before, after) => (before === 'x' || after === 'x' ? 'x' : before === '1' && after === '1' ? '1' : '0');

/**
 * The columns every row shares, and each row's level in each: [{ w, kind:
 * 'lead'|'slot'|'gap' }] and, per row, ['0'|'1'|'x', ...]. `waves` are the
 * rows' own waves ('' for low throughout); `inverted[row]` draws a row as
 * that other row's levels inverted (a complement). The waves repeat: a lead
 * column before the first slot holds the last slot's level, one after the
 * end the first slot's.
 */
export function timingColumns(waves, { slotCells = DEFAULT_SLOT_CELLS, gaps = true, inverted = [] } = {}) {
  const count = Math.max(0, ...waves.map((bits) => bits.length)) || EMPTY_SLOTS;
  const slots = waves.map((bits) => Array.from({ length: count }, (_, i) => bits[i] ?? bits.at(-1) ?? '0'));
  // The repeating sequence, with the lead-in and lead-out.
  const sequence = slots.map((row) => [row.at(-1), ...row, row[0]]);
  const lead = Math.max(1, Math.floor(slotCells / 2)) * GRID;
  const columns = [];
  const levels = waves.map(() => []);
  sequence[0]?.forEach((_, index) => {
    if (index > 0 && gaps && sequence.some((row) => row[index - 1] !== row[index])) {
      columns.push({ w: GRID, kind: 'gap' });
      sequence.forEach((row, r) => levels[r].push(gapLevel(row[index - 1], row[index])));
    }
    const edge = index === 0 || index === sequence[0].length - 1;
    columns.push({ w: edge ? lead : slotCells * GRID, kind: edge ? 'lead' : 'slot' });
    sequence.forEach((row, r) => levels[r].push(row[index]));
  });
  const drawn = levels.map((row, r) => (inverted[r] !== undefined && inverted[r] !== null ? levels[inverted[r]].map(invert) : row));
  return { columns, levels: drawn, count };
}

/**
 * The points of one row's wave: its `levels` over `columns`, from `x`, top
 * at `top`. Returns { lines, crosses }, point lists: the wave breaks at a
 * don't care, which is drawn as its own crossed band.
 */
export function timingRowGeometry(levels, columns, x, top) {
  const high = top;
  const low = top + WAVE_HEIGHT;
  const lines = [];
  const crosses = [];
  let current = null;
  let x0 = x;
  let band = null; // the don't-care run being drawn: [from, to]
  const endBand = () => {
    if (!band) return;
    const [b0, b1] = band;
    crosses.push([{ x: b0, y: high }, { x: b1, y: high }], [{ x: b0, y: low }, { x: b1, y: low }],
      [{ x: b0, y: high }, { x: b1, y: low }], [{ x: b0, y: low }, { x: b1, y: high }]);
    band = null;
  };
  columns.forEach((column, index) => {
    const level = levels[index];
    const x1 = x0 + column.w;
    if (level === 'x') {
      // Neighbouring don't-care columns (a gap beside one) are one band.
      if (current) lines.push(current);
      current = null;
      band = band ? [band[0], x1] : [x0, x1];
    } else {
      endBand();
      const y = level === '1' ? high : low;
      if (!current) current = [{ x: x0, y }];
      else if (current.at(-1).y !== y) current.push({ x: x0, y });
      current.push({ x: x1, y });
    }
    x0 = x1;
  });
  endBand();
  if (current) lines.push(current);
  // A level held over several columns is one segment.
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

/** The diagram already drawn: its annotations' ids, each phase's own wave,
 *  its slot width and gaps, and where its waves start ({ x, y }: the first
 *  column's left edge and the first row's top). Null when there is none. */
export function existingTimingDiagram(circuit) {
  const parts = [...circuit.labels.values()].filter((label) => label.timing);
  if (!parts.length) return null;
  const bits = new Map();
  for (const label of parts) if (typeof label.timing.bits === 'string') bits.set(label.timing.phase, label.timing.bits);
  const waves = parts.filter((label) => label.kind !== 'label');
  const names = parts.filter((label) => label.kind === 'label');
  const x = waves.length ? Math.min(...waves.map((label) => label.bbox().x)) : Math.max(...names.map((label) => label.bbox().x + label.bbox().w)) + LABEL_GAP;
  const y = waves.length ? Math.min(...waves.map((label) => label.bbox().y)) : Math.min(...names.map((label) => label.anchorWorld().y - WAVE_HEIGHT / 2));
  const first = parts.find((label) => label.timing.slot) || parts[0];
  return { ids: parts.map((label) => label.id), bits, x, y, slot: first.timing.slot, gaps: first.timing.gaps !== false };
}

/** Every phase's wave as the diagram would draw it now (see the header):
 *  [{ key, source, bits, from, complementOf }], `from` one of 'typed',
 *  'diagram', 'complement' (drawn as row `complementOf` inverted), 'beats',
 *  or 'low' (bits empty). */
export function timingRowSources(circuit, { fromBeats = false, typed = new Map() } = {}) {
  const phases = timingOrder(switchPhases(circuit));
  const before = fromBeats ? null : existingTimingDiagram(circuit);
  return phases.map(({ key, source }) => {
    if (typed.has(key)) return { key, source, bits: typed.get(key), from: 'typed' };
    if (before?.bits.has(key)) return { key, source, bits: before.bits.get(key), from: 'diagram' };
    const base = isComplementPhase(key) ? phases.findIndex((other) => samePhase(other.key, complementKey(key))) : -1;
    if (base >= 0) return { key, source, bits: '', from: 'complement', complementOf: base };
    const beats = beatTimingBits(circuit, key);
    return beats ? { key, source, bits: beats, from: 'beats' } : { key, source, bits: '', from: 'low' };
  });
}

/**
 * Draw the diagram, replacing one already drawn where it stands, else under
 * everything drawn so far. `bits` gives waves by phase name (see
 * timingPhaseNamed); `fromBeats` takes the waves not given from the beats
 * rather than the diagram already drawn; `slot` is a slot's width in cells
 * and `gaps` turns the non-overlap gaps on or off (both kept from the diagram
 * drawn before when not given). Returns the rows: [{ phase, bits, from,
 * label, line, lines }].
 */
export function addTimingDiagram(circuit, { bits: given = {}, fromBeats = false, slot = null, gaps = null } = {}) {
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
  const withGaps = gaps ?? before?.gaps ?? true;
  const { columns, levels } = timingColumns(rows.map((row) => row.bits), {
    slotCells, gaps: withGaps, inverted: rows.map((row) => row.complementOf ?? null),
  });

  if (before) for (const id of before.ids) circuit.removeLabel(id);
  const drawn = circuit.bounds();
  const top = before ? before.y : ceilGrid(drawn.y + drawn.h) + GAP_BELOW_DRAWING;
  // A complement drawn as its phase inverted keeps following it: its wave is
  // not remembered as its own.
  const settings = { slot: slotCells, ...(withGaps ? {} : { gaps: false }) };
  const labels = rows.map(({ key, source, bits, from }, row) => circuit.addLabel({
    text: source,
    math: isTexSource(source),
    align: 'right',
    x: 0,
    y: top + row * ROW_PITCH + WAVE_HEIGHT / 2,
    timing: { phase: key, ...(from === 'complement' || from === 'low' ? {} : { bits }), ...settings },
  }));
  // The waves stay where they started; a first diagram puts its names in a
  // column flush with the drawing's left edge, the waves a cell after them.
  const column = Math.max(...labels.map((label) => label.bbox().w));
  const waveX = before ? before.x : floorGrid(drawn.x) + column + LABEL_GAP;
  for (const label of labels) label.moveTo(waveX - LABEL_GAP - label.bbox().w / 2, label.anchor.y);
  return labels.map((label, row) => {
    const { key, bits, from } = rows[row];
    const { lines, crosses } = timingRowGeometry(levels[row], columns, waveX, top + row * ROW_PITCH);
    const ids = [...lines, ...crosses].map((points) => circuit.addAnnotation('line', { points, timing: { phase: key, ...settings } }).id);
    return { phase: key, bits, from, label: label.id, line: ids[0], lines: ids };
  });
}
