/**
 * What the editor's windows show for one design, saved with it
 * (`Circuit#windows`), so another design opens with its own and this one
 * comes back as it was left: the reference windows (designs by path and
 * name, or pasted pictures), the calculator's past results, the time-domain
 * plot's nets and stimulus, the sweep's settings, the analyses' held
 * traces, the small-signal analysis form, and the sizing
 * window's order (a column sorted by, and grouped by type or not).
 *
 * It is window state, not drawing: an undo or redo keeps it as it is
 * (main.js `applyJson`), and changing it is a settings change that marks the
 * design unsaved but leaves what was derived current.
 */

/** Past results the calculator keeps. */
export const CALCULATOR_HISTORY = 50;
/** A pasted picture larger than this (as a data URL) is shown but not saved. */
export const MAX_WINDOW_PICTURE = 4_000_000;

/** The sizing window's columns its rows sort by. */
export const SIZING_SORT_KEYS = ['name', 'w', 'l', 'm', 'label', 'value'];

const text = (value, max = 200) => (typeof value === 'string' ? value.slice(0, max) : '');
const object = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : null);

function referenceItem(item) {
  const value = object(item);
  if (!value) return null;
  const picture = object(value.picture);
  if (picture) {
    const src = typeof picture.src === 'string' && picture.src.length <= MAX_WINDOW_PICTURE && /^data:image\/(png|jpeg|webp);base64,/.test(picture.src) ? picture.src : '';
    const aspect = Number(picture.aspect);
    if (!src || !(aspect > 0) || !Number.isFinite(aspect)) return null;
    const width = Number(picture.width);
    return { picture: { src, aspect, ...(width > 0 && Number.isFinite(width) ? { width } : {}) } };
  }
  const path = text(value.path, 4096);
  const name = text(value.name);
  return path || name ? { path, name } : null;
}

function calculatorEntry(entry) {
  const value = object(entry);
  if (!value || typeof value.input !== 'string' || !value.input.trim()) return null;
  return {
    input: text(value.input, 500),
    result: text(value.result, 500),
    ...(value.error === true ? { error: true } : {}),
  };
}

const finiteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/** Numbers by name, as a held trace keeps the values it was held at. */
function numberMap(value, max = 200) {
  const source = object(value) || {};
  return Object.fromEntries(Object.entries(source).filter(([name, number]) => name.length <= 80 && finiteNumber(number)).slice(0, max));
}

/** One held trace as saved (`windows.holds`), or null. */
function holdRecord(entry) {
  const value = object(entry);
  if (!value || !text(value.key, 40)) return null;
  const spectrum = value.kind === 'spectrum';
  if (!spectrum && !text(value.of, 600)) return null;
  const points = spectrum ? (Array.isArray(value.points) ? value.points : []).filter((p) => finiteNumber(p?.f) && p.f > 0 && finiteNumber(p?.db)).slice(0, 4000).map((p) => ({ f: p.f, db: p.db })) : [];
  if (spectrum && points.length < 2) return null;
  const ratios = object(value.ratios);
  return {
    key: text(value.key, 40),
    ...(spectrum ? { kind: 'spectrum', points } : { of: text(value.of, 600), base: text(value.base, 400) }),
    color: /^#[0-9a-f]{6}$/i.test(value.color || '') ? value.color : '#3b74e0',
    ...(value.on === false ? { on: false } : {}),
    values: numberMap(value.values),
    ...(finiteNumber(value.offset) ? { offset: value.offset } : {}),
    ...(finiteNumber(value.amplitude) ? { amplitude: value.amplitude } : {}),
    ...(ratios ? { ratios: { intrinsicGain: finiteNumber(ratios.intrinsicGain) ? ratios.intrinsicGain : 1, parasiticRatio: finiteNumber(ratios.parasiticRatio) ? ratios.parasiticRatio : 0, multipliers: numberMap(ratios.multipliers) } } : {}),
  };
}

/** Window state as saved: only what each window keeps, bounded. */
export function normalizeWindows(value) {
  const source = object(value) || {};
  const windows = {};
  const references = object(source.references);
  if (references) {
    const items = (Array.isArray(references.items) ? references.items : []).slice(0, 12).map(referenceItem).filter(Boolean);
    if (items.length || references.hidden) windows.references = { items, ...(references.hidden ? { hidden: true } : {}) };
  }
  const calculator = object(source.calculator);
  if (calculator) {
    const history = (Array.isArray(calculator.history) ? calculator.history : []).map(calculatorEntry).filter(Boolean).slice(-CALCULATOR_HISTORY);
    if (history.length) windows.calculator = { history };
  }
  // The time-domain plot (kept as `scope`): the nets it shows (signal keys) and its stimulus --
  // the source the sine drives, its amplitude (dBFS) and frequency (f/fs)
  // as typed, and how many samples it runs.
  const scope = object(source.scope);
  if (scope) {
    const nets = (Array.isArray(scope.nets) ? scope.nets : []).filter((net) => typeof net === 'string' && net).map((net) => net.slice(0, 200)).slice(0, 16);
    const samples = Math.round(Number(scope.samples));
    windows.scope = {
      nets,
      // The nets were picked (none, too); without it the plot picks its own.
      ...(scope.chosen === true ? { chosen: true } : {}),
      ...(samples > 0 ? { samples: Math.max(64, Math.min(samples, 1 << 16)) } : {}),
      ...(text(scope.input) ? { input: text(scope.input) } : {}),
      ...(text(scope.amplitude, 40) ? { amplitude: text(scope.amplitude, 40) } : {}),
      ...(text(scope.frequency, 40) ? { frequency: text(scope.frequency, 40) } : {}),
    };
  }
  // The sweep: the coefficient it sweeps, from, to, how many points, on a
  // linear or log scale; its stimulus as the time plot's (the source, the
  // amplitude and f/fs as typed, the samples a segment); the measures shown.
  const sweep = object(source.sweep);
  if (sweep) {
    const points = Math.round(Number(sweep.points));
    const samples = Math.round(Number(sweep.samples));
    const measures = (Array.isArray(sweep.measures) ? sweep.measures : []).filter((m) => typeof m === 'string' && m).map((m) => m.slice(0, 200)).slice(0, 24);
    windows.sweep = {
      measures,
      ...(sweep.chosen === true ? { chosen: true } : {}),
      ...(text(sweep.name, 80) ? { name: text(sweep.name, 80) } : {}),
      ...(text(sweep.from, 40) ? { from: text(sweep.from, 40) } : {}),
      ...(text(sweep.to, 40) ? { to: text(sweep.to, 40) } : {}),
      ...(points > 1 ? { points: Math.min(points, 201) } : {}),
      ...(sweep.scale === 'log' ? { scale: 'log' } : {}),
      ...(text(sweep.input) ? { input: text(sweep.input) } : {}),
      ...(text(sweep.amplitude, 40) ? { amplitude: text(sweep.amplitude, 40) } : {}),
      ...(text(sweep.frequency, 40) ? { frequency: text(sweep.frequency, 40) } : {}),
      ...(samples > 0 ? { samples: Math.max(1024, Math.min(samples, 1 << 16)) } : {}),
    };
  }
  // Held traces, by analysis ('signal-flow', 'switched-cap', 'small-signal'):
  // each the trace it was held from (`of`), its name, color, shown or not,
  // and the numbers it was held at -- remade when a Derive brings that
  // trace back. A held spectrum keeps its points.
  const holds = object(source.holds);
  if (holds) {
    const kept = {};
    for (const mode of ['signal-flow', 'switched-cap', 'small-signal']) {
      const list = (Array.isArray(holds[mode]) ? holds[mode] : []).map(holdRecord).filter(Boolean).slice(0, 16);
      if (list.length) kept[mode] = list;
    }
    if (Object.keys(kept).length) windows.holds = kept;
  }
  // The sizing window: the column its rows are sorted by, and whether
  // they are grouped by type.
  const sizing = object(source.sizing);
  if (sizing) {
    const sort = object(sizing.sort);
    const key = SIZING_SORT_KEYS.includes(sort?.key) ? sort.key : null;
    if (key || sizing.group === true) {
      windows.sizing = {
        ...(key ? { sort: { key, ...(sort.reverse === true ? { reverse: true } : {}) } } : {}),
        ...(sizing.group === true ? { group: true } : {}),
      };
    }
  }
  // The small-signal form: analysis-options.js reads it.
  const analysis = object(source.analysis);
  if (analysis && JSON.stringify(analysis).length <= 100_000) windows.analysis = JSON.parse(JSON.stringify(analysis));
  return windows;
}

/** The document field for the window state: `{ windows }`, or nothing
 *  when there is none. */
export function windowsJSON(windows) {
  const value = normalizeWindows(windows);
  return Object.keys(value).length ? { windows: value } : {};
}
