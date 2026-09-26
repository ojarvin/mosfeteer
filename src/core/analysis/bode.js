/**
 * Relative Bode sketches of an exact transfer function.
 *
 * A linear small-signal circuit's response depends only on dimensionless
 * ratios once units are chosen. Here every transconductance starts at one
 * unit g, every capacitance at one unit C, and every output resistance at
 * A0/g, where A0 = g_m r_o is the one intrinsic ratio a design has. Frequency
 * is then in units of g/C and impedance in units of 1/g: absolute values only
 * slide the plot along its axis, so the shape -- pole spacing, phase, DC gain
 * -- is exact. The user moves ratios (this g_m ten times that one, this load
 * ten times the internal capacitances), never plugs in design values.
 *
 * Pure: numbers in, numbers out. The expressions are rational.js's.
 */

import { symbolText } from './present.js';

export const DEFAULT_INTRINSIC_GAIN = 30;
/** A capacitor on the output node starts this many units: loads dominate. */
export const OUTPUT_CAPACITANCE = 10;
/** MOS parasitic capacitances start at this fraction of a unit. */
export const DEFAULT_PARASITIC_RATIO = 0.1;
/** A body-effect transconductance starts at this fraction of a unit g_m. */
const BODY_EFFECT_RATIO = 0.2;

const PARASITIC_ROLES = new Set(['cgs', 'cgd']);

/**
 * The sketch's parameters: one per symbol of the transfer function, with its
 * starting value in units of g and C, its display TeX, and what it is.
 * `provenance` is the report's symbolProvenance; `outputComponents` names the
 * parts touching the output node (their capacitors start as loads).
 */
export function sketchParameters(symbols, provenance = {}, { outputComponents = new Set() } = {}) {
  return [...symbols].sort().map((name) => {
    const source = provenance[name] || {};
    const role = source.role || source.kind || '';
    const kind = role === 'gm' || role === 'gmb' ? 'transconductance'
      : role === 'ro' || role === 'rds' || role === 'resistor' ? 'resistance'
        : role === 'capacitor' || PARASITIC_ROLES.has(role) ? 'capacitance'
          : role === 'inductor' ? 'inductance' : 'other';
    return {
      name,
      tex: symbolText(name),
      role,
      kind,
      component: source.component || null,
      parasitic: PARASITIC_ROLES.has(role),
      load: role === 'capacitor' && outputComponents.has(source.component),
    };
  });
}

/** Every parameter's value: its starting value times its multiplier. */
export function sketchValues(parameters, { intrinsicGain = DEFAULT_INTRINSIC_GAIN, parasiticRatio = DEFAULT_PARASITIC_RATIO, multipliers = {} } = {}) {
  const values = {};
  for (const parameter of parameters) {
    let base = 1;
    if (parameter.role === 'gmb') base = BODY_EFFECT_RATIO;
    else if (parameter.role === 'ro' || parameter.role === 'resistor') base = intrinsicGain;
    else if (parameter.parasitic) base = parasiticRatio;
    else if (parameter.load) base = OUTPUT_CAPACITANCE;
    values[parameter.name] = base * (multipliers[parameter.name] ?? 1);
  }
  return values;
}

/** The symbols an expression uses, `s` aside. */
export function expressionSymbols(value, variable = 's', out = new Set()) {
  if (!value || typeof value !== 'object') return out;
  if (value.kind === 'symbol') {
    if (value.name !== variable) out.add(value.name);
    return out;
  }
  for (const key of ['terms', 'factors']) for (const item of value[key] || []) expressionSymbols(item, variable, out);
  for (const key of ['base', 'numerator', 'denominator', 'coefficient']) expressionSymbols(value[key], variable, out);
  return out;
}

/** An expression's value with every symbol given a number. */
export function evaluateExpression(value, values) {
  switch (value?.kind) {
    case 'number': return Number(value.numerator) / Number(value.denominator);
    case 'symbol': {
      const number = values[value.name];
      if (!Number.isFinite(number)) throw new Error(`no value for ${value.name}`);
      return number;
    }
    case 'add': return value.terms.reduce((sum, term) => sum + evaluateExpression(term, values), 0);
    case 'multiply': return value.factors.reduce((product, factor) => product * evaluateExpression(factor, values), 1);
    case 'power': return evaluateExpression(value.base, values) ** Number(value.exponent);
    case 'rational': return evaluateExpression(value.numerator, values) / evaluateExpression(value.denominator, values);
    case 'infinity': return (value.sign ?? 1) * Infinity;
    default: throw new Error(`cannot evaluate ${value?.kind}`);
  }
}

/** Dense coefficients [c0, c1, ...] of a coefficient list `[{power, coefficient}]`. */
export function numericCoefficients(list, values) {
  const out = [];
  for (const { power, coefficient } of list || []) {
    while (out.length <= power) out.push(0);
    out[power] += evaluateExpression(coefficient, values);
  }
  return out;
}

// ----- complex arithmetic -------------------------------------------------------

const c = (re, im = 0) => ({ re, im });
const cadd = (a, b) => c(a.re + b.re, a.im + b.im);
const csub = (a, b) => c(a.re - b.re, a.im - b.im);
const cmul = (a, b) => c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const cdiv = (a, b) => {
  const d = b.re * b.re + b.im * b.im;
  return c((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
};
const cabs = (a) => Math.hypot(a.re, a.im);

/** p(z) and p'(z) by Horner, coefficients low power first. */
function horner(coefficients, z) {
  let value = c(0);
  let derivative = c(0);
  for (let i = coefficients.length - 1; i >= 0; i--) {
    derivative = cadd(cmul(derivative, z), value);
    value = cadd(cmul(value, z), c(coefficients[i]));
  }
  return { value, derivative };
}

/** Coefficients with numerical noise at the top dropped (relative to the rest). */
function trimmed(coefficients) {
  const scale = Math.max(...coefficients.map(Math.abs), 0);
  const out = [...coefficients];
  while (out.length > 1 && Math.abs(out.at(-1)) <= scale * 1e-13) out.pop();
  return out;
}

/**
 * Every root of a real polynomial (coefficients low power first), by the
 * Aberth-Ehrlich iteration. Roots at the origin are split off exactly first;
 * the rest are found on a variable scaled to their geometric mean, so roots
 * decades apart converge alike.
 */
export function polynomialRoots(coefficients) {
  let a = trimmed(coefficients);
  const roots = [];
  while (a.length > 1 && a[0] === 0) {
    roots.push(c(0));
    a = a.slice(1);
  }
  const n = a.length - 1;
  if (n < 1) return roots;
  // Scale s = k t so the scaled roots sit around the unit circle.
  const k = Math.abs(a[0] / a[n]) ** (1 / n) || 1;
  const b = a.map((value, i) => value * k ** i);
  const lead = b[n];
  const monic = b.map((value) => value / lead);
  let z = Array.from({ length: n }, (_, i) => {
    const angle = (2 * Math.PI * i) / n + 0.4;
    return c(Math.cos(angle), Math.sin(angle));
  });
  for (let iteration = 0; iteration < 500; iteration++) {
    let moved = 0;
    const next = z.map((zi, i) => {
      const { value, derivative } = horner(monic, zi);
      if (cabs(value) === 0) return zi;
      const ratio = cdiv(value, derivative);
      let sum = c(0);
      for (let j = 0; j < n; j++) if (j !== i) sum = cadd(sum, cdiv(c(1), csub(zi, z[j])));
      const step = cdiv(ratio, csub(c(1), cmul(ratio, sum)));
      moved = Math.max(moved, cabs(step) / Math.max(1, cabs(zi)));
      return csub(zi, step);
    });
    z = next;
    if (moved < 1e-14) break;
  }
  for (const root of z) {
    // A conjugate pair's imaginary dust on a real root is noise.
    const real = Math.abs(root.im) <= 1e-9 * Math.max(1, Math.abs(root.re));
    roots.push(c(root.re * k, real ? 0 : root.im * k));
  }
  return roots;
}

/** H(jω) from dense numerator and denominator coefficients. */
export function responseAt(numerator, denominator, omega) {
  const s = c(0, omega);
  return cdiv(horner(numerator, s).value, horner(denominator, s).value);
}

const log10 = Math.log10;
const decibels = (h) => 20 * log10(cabs(h));

/** Roots with positive imaginary part stand for their pair; the rest once. */
function distinctCorners(roots) {
  return roots.filter((root) => root.im >= 0);
}

/**
 * The sketch of `N(s)/D(s)` (dense coefficient arrays): the exact magnitude
 * and phase over a frequency range around its corners, the poles and zeros,
 * the straight-line magnitude asymptote, and the unity-gain crossing.
 * Frequencies are in the units the coefficients were evaluated in.
 */
export function bodeSketch(numerator, denominator, { pointsPerDecade = 40 } = {}) {
  const num = trimmed(numerator);
  const den = trimmed(denominator);
  // The exact solve can leave a factor common to both sides (a symmetric
  // half-circuit's, say): a pole standing exactly on a zero cancels in the
  // function itself. Leave such pairs out of the corners and the asymptote;
  // the curve, evaluated from the coefficients, is the same either way.
  const { zeros, poles, cancelled } = cancelCommonRoots(polynomialRoots(num), polynomialRoots(den));
  const corners = [...zeros, ...poles].map(cabs).filter((w) => w > 0 && Number.isFinite(w));
  const low = corners.length ? Math.floor(log10(Math.min(...corners))) - 1 : -2;
  let high = corners.length ? Math.ceil(log10(Math.max(...corners))) + 1 : 2;
  // A falling gain is shown on down to unity: where the straight line
  // crosses 0 dB, and a decade past it.
  const reach = magnitudeAsymptote(num, den, zeros, poles, low, high);
  const end = reach.at(-1);
  const before = reach.at(-2);
  if (end && before && end.db > -20) {
    const slope = (end.db - before.db) / log10(end.w / before.w);
    if (slope < 0) high = Math.max(high, Math.min(low + 12, Math.ceil(log10(end.w) + end.db / -slope) + 1));
  }
  const points = [];
  let previousPhase = null;
  for (let i = 0; i <= (high - low) * pointsPerDecade; i++) {
    const w = 10 ** (low + i / pointsPerDecade);
    const h = responseAt(num, den, w);
    let phase = (Math.atan2(h.im, h.re) * 180) / Math.PI;
    // Unwrap, so a phase running past -180 keeps going instead of jumping.
    if (previousPhase !== null) {
      while (phase - previousPhase > 180) phase -= 360;
      while (phase - previousPhase < -180) phase += 360;
    }
    previousPhase = phase;
    points.push({ w, db: decibels(h), phase });
  }
  // Start the phase near its low-frequency value (0 or ±180 for an
  // inverting stage, not an arbitrary multiple of 360).
  if (points.length) {
    const shift = Math.round(points[0].phase / 360) * 360;
    for (const point of points) point.phase -= shift;
  }
  return {
    range: { low, high },
    points,
    zeros,
    poles,
    cancelled,
    asymptote: magnitudeAsymptote(num, den, zeros, poles, low, high),
    unityGain: unityCrossing(points),
  };
}

/** Pair every zero with a pole at the same point (to a part in 10^7 of its
 *  size) and drop both; returns what is left and how many pairs went. */
export function cancelCommonRoots(zeros, poles, tolerance = 1e-7) {
  const leftPoles = [...poles];
  const leftZeros = [];
  let cancelled = 0;
  for (const zero of zeros) {
    const size = Math.max(cabs(zero), Number.MIN_VALUE);
    const index = leftPoles.findIndex((pole) => cabs(csub(pole, zero)) <= tolerance * Math.max(size, cabs(pole)));
    if (index >= 0) {
      leftPoles.splice(index, 1);
      cancelled += 1;
    } else {
      leftZeros.push(zero);
    }
  }
  return { zeros: leftZeros, poles: leftPoles, cancelled };
}

/** The textbook straight-line magnitude: the low-frequency behavior k ω^m,
 *  bending ±20 dB/decade at every zero and pole (a complex pair bends twice). */
function magnitudeAsymptote(num, den, zeros, poles, low, high) {
  const valuation = (a) => a.findIndex((value) => value !== 0);
  const vn = valuation(num);
  const vd = valuation(den);
  if (vn < 0 || vd < 0) return [];
  // Low-frequency asymptote from the lowest nonzero coefficients, after the
  // roots at the origin (which it already accounts for).
  const k = Math.abs(num[vn] / den[vd]);
  let slope = vn - vd; // in decades of |H| per decade of ω
  const breaks = [
    ...zeros.filter((z) => cabs(z) > 0).map((z) => ({ w: cabs(z), step: 1 })),
    ...poles.filter((p) => cabs(p) > 0).map((p) => ({ w: cabs(p), step: -1 })),
  ].sort((a, b) => a.w - b.w);
  const at = (logW) => 20 * (log10(k) + slope * logW);
  // Corners below the plotted range have already bent the line.
  for (const corner of breaks) if (log10(corner.w) <= low) slope += corner.step;
  const k0 = at(low);
  const out = [{ w: 10 ** low, db: k0 }];
  let base = { logW: low, db: k0 };
  for (const corner of breaks) {
    const logW = log10(corner.w);
    if (logW <= low || logW >= high) continue;
    const db = base.db + 20 * slope * (logW - base.logW);
    out.push({ w: corner.w, db });
    slope += corner.step;
    base = { logW, db };
  }
  out.push({ w: 10 ** high, db: base.db + 20 * slope * (high - base.logW) });
  return out;
}

/** Where the magnitude first falls through 0 dB, or null. */
function unityCrossing(points) {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a.db >= 0 && b.db < 0) {
      const t = a.db / (a.db - b.db);
      const logW = log10(a.w) + t * (log10(b.w) - log10(a.w));
      return { w: 10 ** logW, phase: a.phase + t * (b.phase - a.phase) };
    }
  }
  return null;
}

/** Corners for labelling: each real root, and each complex pair once. */
export function sketchCorners(sketch) {
  return {
    zeros: distinctCorners(sketch.zeros),
    poles: distinctCorners(sketch.poles),
  };
}
