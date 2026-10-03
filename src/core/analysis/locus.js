/**
 * Root locus against one coefficient: a result's poles as that coefficient
 * sweeps (logarithmically, its sign kept), the rest at their numbers -- "at
 * what k_1 does this loop go unstable?". In z the stability boundary is the
 * unit circle, in s the j omega axis.
 */

import { numericRootsOf } from './signal-flow.js';

const unstable = (variable, poles) => poles.some((p) => (variable === 'z' ? Math.hypot(p.re, p.im) > 1 + 1e-9 : p.re > 1e-9));

/**
 * `evaluate(k)` gives the number-valued result with the coefficient at k.
 * Returns `{ variable, steps: [{ k, poles }], current: { k, poles },
 * crossings: [{ k, becomes: 'unstable' | 'stable' }] }`, or null when the
 * result has no numeric poles.
 */
/** The values a sweep from `from` to `to` takes: logarithmic, the sign kept. */
export function locusSteps(from, to, steps = 120) {
  const sign = Math.sign(from || to || 1) || 1;
  const a = Math.log(Math.abs(from));
  const b = Math.log(Math.abs(to));
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return [];
  return Array.from({ length: steps + 1 }, (_, i) => sign * Math.exp(a + ((b - a) * i) / steps));
}

export function rootLocus(evaluate, { from, to, current, steps = 120, ks = locusSteps(from, to, steps) } = {}) {
  if (!ks.length) return null;
  const out = [];
  let variable = null;
  for (const k of ks) {
    const value = evaluate(k);
    const roots = value && value.kind !== 'mixed' ? numericRootsOf(value) : null;
    if (!roots?.poles) continue;
    variable = value.variable;
    out.push({ k, poles: roots.poles });
  }
  if (!out.length) return null;
  const currentValue = current !== undefined ? evaluate(current) : null;
  const currentPoles = currentValue && currentValue.kind !== 'mixed' ? numericRootsOf(currentValue).poles : null;
  const crossings = [];
  for (let i = 1; i < out.length; i++) {
    const before = unstable(variable, out[i - 1].poles);
    const after = unstable(variable, out[i].poles);
    if (before !== after) crossings.push({ k: out[i].k, becomes: after ? 'unstable' : 'stable' });
  }
  return { variable, steps: out, current: currentPoles ? { k: current, poles: currentPoles } : null, crossings };
}

/** The locus as a plot annotation keeps it: points coloured by their k. */
export function locusPlot(locus, { parameter, label, color = '#3b74e0' } = {}) {
  if (!locus) return null;
  const n = locus.steps.length;
  return {
    kind: 'locus',
    variable: locus.variable,
    parameter: parameter || 'k',
    label: label || '',
    color,
    from: locus.steps[0].k,
    to: locus.steps[n - 1].k,
    points: locus.steps.flatMap((step, i) => step.poles.map((p) => ({ re: p.re, im: p.im, t: n > 1 ? i / (n - 1) : 0 }))),
    current: locus.current ? locus.current.poles.map((p) => ({ re: p.re, im: p.im })) : [],
    crossings: locus.crossings,
  };
}
