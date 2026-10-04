/**
 * The coefficient optimizer's setup, as a document keeps it
 * (`analysisValues.flow.optimize`, model.js): which coefficients are free
 * and their ranges, the specs, the swing test, the budget. Normalizing only:
 * no imports, so the model can read it without the analysis.
 */

export const SPEC_ACTIONS = Object.freeze(['minimize', 'maximize', 'below', 'above']);
// A band's average, peak, or lowest |H| (dB); or its poles: the highest Q of
// a complex pair, or the largest radius (optimize.js poleMeasures).
export const SPEC_MEASURES = Object.freeze(['average', 'peak', 'lowest', 'q', 'radius']);
export const POLE_MEASURES = Object.freeze(['q', 'radius']);
export const SPEC_BANDS = Object.freeze(['signal', 'outside', 'all', 'custom']);
export const DEFAULT_EVALUATIONS = 3000;
export const MAX_DENOMINATOR = 1024;
export const SWING_LEVELS = Object.freeze(['sigma3', 'sigma4', 'peak']);

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const number = (value) => (value === '' || value === null || value === undefined ? null : Number(value));
const short = (value, length = 200) => (typeof value === 'string' ? value.slice(0, length) : '');

function normalizeSpec(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const action = SPEC_ACTIONS.includes(raw.action) ? raw.action : 'minimize';
  const measure = SPEC_MEASURES.includes(raw.measure) ? raw.measure : 'average';
  const band = SPEC_BANDS.includes(raw.band) ? raw.band : 'signal';
  const f1 = number(raw.f1);
  const f2 = number(raw.f2);
  const value = number(raw.value);
  return {
    action,
    measure,
    input: short(raw.input),
    band,
    ...(band === 'custom' && finite(f1) ? { f1 } : {}),
    ...(band === 'custom' && finite(f2) ? { f2 } : {}),
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
      // Its block's largest n when rounding (rounding.js), over the setup's.
      ...(denominator >= 1 && denominator <= MAX_DENOMINATOR ? { denominator } : {}),
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
      // What a limit compares with: the 3-sigma or 4-sigma level, or the highest peak.
      measure: SWING_LEVELS.includes(rawSwing.measure) ? rawSwing.measure : 'sigma3',
    },
    evaluations: evaluations >= 50 && evaluations <= 1e6 ? evaluations : DEFAULT_EVALUATIONS,
    // Rounding to fractions m/n: the largest n, powers of two only, one n per block.
    rounding: {
      denominator: denominator >= 1 && denominator <= MAX_DENOMINATOR ? denominator : 32,
      powersOfTwo: rawRounding.powersOfTwo === true,
      shared: rawRounding.shared !== false,
    },
  };
}
