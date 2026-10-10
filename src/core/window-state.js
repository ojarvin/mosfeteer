/**
 * What the editor's windows show for one design, saved with it
 * (`Circuit#windows`), so another design opens with its own and this one
 * comes back as it was left: the reference windows (designs by path and
 * name, or pasted pictures), the calculator's past results, the oscilloscope's
 * nets, and the small-signal analysis form.
 *
 * It is window state, not drawing: an undo or redo keeps it as it is
 * (main.js `applyJson`), and changing it is a settings change that marks the
 * design unsaved but leaves what was derived current.
 */

/** Past results the calculator keeps. */
export const CALCULATOR_HISTORY = 50;
/** A pasted picture larger than this (as a data URL) is shown but not saved. */
export const MAX_WINDOW_PICTURE = 4_000_000;

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
  // The oscilloscope: the nets it shows (signal keys) and its stimulus --
  // the source the sine drives, its amplitude (dBFS) and frequency (f/fs)
  // as typed, and how many samples it runs.
  const scope = object(source.scope);
  if (scope) {
    const nets = (Array.isArray(scope.nets) ? scope.nets : []).filter((net) => typeof net === 'string' && net).map((net) => net.slice(0, 200)).slice(0, 16);
    const samples = Math.round(Number(scope.samples));
    windows.scope = {
      nets,
      ...(samples > 0 ? { samples: Math.max(64, Math.min(samples, 1 << 16)) } : {}),
      ...(text(scope.input) ? { input: text(scope.input) } : {}),
      ...(text(scope.amplitude, 40) ? { amplitude: text(scope.amplitude, 40) } : {}),
      ...(text(scope.frequency, 40) ? { frequency: text(scope.frequency, 40) } : {}),
    };
  }
  // The small-signal form: analysis-options.js reads (and migrates) it.
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
