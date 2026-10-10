/**
 * The coefficient optimizer's setup, as a document keeps it
 * (`analysisValues.flow.optimize`, model.js): which coefficients are free
 * and their ranges, the specs, the swing test, the budget. Normalizing only:
 * no imports, so the model can read it without the analysis.
 */

const SPEC_ACTIONS = Object.freeze(['minimize', 'maximize', 'below', 'above']);
// A band's average, peak, or lowest |H| (dB); or its poles: the highest Q of
// a complex pair, or the largest radius (optimize.js poleMeasures).
const SPEC_MEASURES = Object.freeze(['average', 'peak', 'lowest', 'q', 'radius']);
export const POLE_MEASURES = Object.freeze(['q', 'radius']);
const SPEC_BANDS = Object.freeze(['signal', 'outside', 'all', 'custom']);
const DEFAULT_EVALUATIONS = 3000;
const MAX_DENOMINATOR = 1024;
const SWING_LEVELS = Object.freeze(['sigma3', 'sigma4', 'peak']);

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** A frequency as typed, f/fs: a number (0.004) or a fraction (1/256); NaN otherwise. */
export function frequencyNumber(text) {
  const raw = String(text ?? '').trim();
  const match = raw.match(/^(\d*\.?\d+)\s*\/\s*(\d*\.?\d+)$/);
  return match ? Number(match[1]) / Number(match[2]) : raw === '' ? NaN : Number(raw);
}

/** The text to keep beside a frequency's number: a fraction as typed
 *  (`1/256`), so a field shows it again; none for a plain number. */
function frequencyText(text) {
  const raw = String(text ?? '').trim().replace(/\s+/g, '');
  return /^\d*\.?\d+\/\d*\.?\d+$/.test(raw) && raw.length <= 40 ? raw : null;
}

/** The signal band, `{ f0, bw }` in f/fs, each with its typed fraction
 *  (`text: { bw: '1/128' }`) when it was one; null without a bandwidth. */
export function normalizeBand(raw) {
  const bw = Number(raw?.bw);
  if (!(bw > 0)) return null;
  const text = {};
  for (const key of ['f0', 'bw']) {
    const typed = frequencyText(raw?.text?.[key]);
    if (typed && Math.abs(frequencyNumber(typed) - (key === 'bw' ? bw : Number(raw.f0) || 0)) < 1e-12) text[key] = typed;
  }
  return { f0: Math.max(0, Number(raw.f0) || 0), bw, ...(Object.keys(text).length ? { text } : {}) };
}
const number = (value) => (value === '' || value === null || value === undefined ? null : Number(value));
const short = (value, length = 200) => (typeof value === 'string' ? value.slice(0, length) : '');

function normalizeSpec(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const action = SPEC_ACTIONS.includes(raw.action) ? raw.action : 'minimize';
  const measure = SPEC_MEASURES.includes(raw.measure) ? raw.measure : 'average';
  const band = SPEC_BANDS.includes(raw.band) ? raw.band : 'signal';
  // A band end typed as a fraction keeps its text (f1Text) beside its number.
  const f1 = typeof raw.f1 === 'string' ? frequencyNumber(raw.f1) : number(raw.f1);
  const f2 = typeof raw.f2 === 'string' ? frequencyNumber(raw.f2) : number(raw.f2);
  const f1Text = frequencyText(typeof raw.f1 === 'string' ? raw.f1 : raw.f1Text);
  const f2Text = frequencyText(typeof raw.f2 === 'string' ? raw.f2 : raw.f2Text);
  const value = number(raw.value);
  return {
    action,
    measure,
    input: short(raw.input),
    band,
    ...(band === 'custom' && finite(f1) ? { f1, ...(f1Text && Math.abs(frequencyNumber(f1Text) - f1) < 1e-12 ? { f1Text } : {}) } : {}),
    ...(band === 'custom' && finite(f2) ? { f2, ...(f2Text && Math.abs(frequencyNumber(f2Text) - f2) < 1e-12 ? { f2Text } : {}) } : {}),
    ...((action === 'below' || action === 'above') && finite(value) ? { value } : {}),
  };
}

/** A saved setup, or a fresh one, in its normal form. */
export function normalizeOptimizeSetup(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const coefficients = {};
  for (const [name, entry] of Object.entries(value.coefficients || {}).slice(0, 200)) {
    if (!entry || typeof entry !== 'object') continue;
    const min = number(entry.min);
    const max = number(entry.max);
    const denominator = Math.round(number(entry.denominator));
    const out = {
      ...(entry.fixed === true ? { fixed: true } : entry.fixed === false ? { fixed: false } : {}),
      ...(finite(min) ? { min } : {}),
      ...(finite(max) ? { max } : {}),
      // Its block's n when made a fraction (rounding.js), over the setup's:
      // the largest (n <= it), or with `denominatorFixed` exactly it.
      ...(denominator >= 1 && denominator <= MAX_DENOMINATOR ? { denominator, ...(entry.denominatorFixed === true ? { denominatorFixed: true } : {}) } : {}),
    };
    if (Object.keys(out).length) coefficients[short(name, 80)] = out;
  }
  const specs = (Array.isArray(value.specs) ? value.specs : []).slice(0, 40).map(normalizeSpec).filter(Boolean);
  const rawSwing = value.swing && typeof value.swing === 'object' ? value.swing : {};
  const limits = {};
  for (const [key, limit] of Object.entries(rawSwing.limits || {}).slice(0, 200)) {
    const db = number(limit);
    if (finite(db)) limits[short(key)] = db;
  }
  // Limits aimed at: the net brought up to its limit, not only kept under it.
  const targets = {};
  for (const [key, on] of Object.entries(rawSwing.targets || {})) if (on === true && Object.hasOwn(limits, short(key))) targets[short(key)] = true;
  const amplitude = number(rawSwing.amplitude);
  const evaluations = Math.round(number(value.evaluations));
  const rawRounding = value.rounding && typeof value.rounding === 'object' ? value.rounding : {};
  const denominator = Math.round(number(rawRounding.denominator));
  return {
    coefficients,
    specs,
    swing: {
      on: rawSwing.on === true,
      amplitude: finite(amplitude) ? amplitude : -6,
      input: short(rawSwing.input),
      frequency: short(rawSwing.frequency, 40),
      limits,
      targets,
      // What a limit compares with: the 3-sigma or 4-sigma level, or the highest peak.
      measure: SWING_LEVELS.includes(rawSwing.measure) ? rawSwing.measure : 'sigma3',
    },
    evaluations: evaluations >= 50 && evaluations <= 1e6 ? evaluations : DEFAULT_EVALUATIONS,
    // After a search, try the coefficients that barely matter at zero (refine.js).
    prune: value.prune !== false,
    // Relations the coefficients must keep, as typed: `c_1 >= c_2, c_2 >= 2*c_3`.
    constraints: short(value.constraints, 400),
    // The free coefficients made fractions m/n as part of a run (`on`): n up
    // to `denominator` (exactly it with `fixed`), powers of two only, one n
    // per block.
    rounding: {
      on: rawRounding.on === true,
      denominator: denominator >= 1 && denominator <= MAX_DENOMINATOR ? denominator : 32,
      fixed: rawRounding.fixed === true,
      powersOfTwo: rawRounding.powersOfTwo === true,
      shared: rawRounding.shared !== false,
    },
  };
}
