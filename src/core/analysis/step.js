/**
 * Step responses of signal-flow results, from the same transfer functions
 * the graph plots: a z result by its difference equation (samples n), an s
 * result exactly through a state-space realization and matrix exponentials
 * (time in the coefficients' units, or in sample periods on f/fs, so s and z
 * results share an axis), an s result with delays as its delayed terms'
 * step responses shifted. A result whose loop holds a delay, or a
 * continuous input through a sampler, has none here.
 */

import { delayTermsOf, denseCoefficients, hasDelays, numericRootsOf } from './signal-flow.js';
import { realize } from './simulate.js';
import { expm } from './sampling.js';

const MAX_SAMPLES = 4000;

/** How long a response takes to settle, from its poles: in samples (z) or
 *  time (s); null when it never settles (a pole on or past the boundary). */
function settlingSpan(value) {
  const { poles } = numericRootsOf(value);
  if (!poles?.length) return null;
  if (value.variable === 'z') {
    const radius = Math.max(...poles.map((p) => Math.hypot(p.re, p.im)));
    if (radius >= 1 - 1e-9) return null;
    return radius < 1e-6 ? 4 : Math.log(1e-3) / Math.log(radius);
  }
  const slowest = Math.max(...poles.map((p) => p.re));
  if (slowest >= -1e-12) return null;
  return Math.log(1e3) / -slowest;
}

/** A z result's step response: y[n] for n = 0 .. count - 1. */
function zStep(value, count) {
  const num = denseCoefficients(value.numerator, 'z');
  const den = denseCoefficients(value.denominator, 'z');
  if (!num || !den || num.length > den.length) return null;
  // In powers of z^-1: H = sum b_k z^-k / sum a_k z^-k.
  const order = den.length - 1;
  const a = den.slice().reverse();
  const b = Array.from({ length: order + 1 }, (_, k) => num[order - k] || 0);
  const y = [];
  for (let n = 0; n < count; n++) {
    let acc = 0;
    for (let k = 0; k <= order; k++) if (n - k >= 0) acc += b[k];
    for (let k = 1; k <= order; k++) if (n - k >= 0) acc -= a[k] * y[n - k];
    y.push(acc / a[0]);
  }
  return y;
}

/** An s rational's step response at times 0, h, 2h, ... (count samples),
 *  exact: the state stepped with e^{[A B; 0 0] h}. */
function sStep(num, den, h, count) {
  const model = realize(num, den);
  const n = model.n;
  if (!n) return Array(count).fill(model.D);
  const aug = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => {
    if (i === n) return 0;
    if (j === n) return i === n - 1 ? 1 : 0;
    return model.A[i][j] * 1;
  })).map((row) => row.map((v) => v * h));
  const phi = expm(aug);
  let x = new Array(n).fill(0);
  const y = [];
  for (let k = 0; k < count; k++) {
    y.push(model.C.reduce((sum, c, j) => sum + c * x[j], 0) + model.D);
    const next = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let v = phi[i][n];
      for (let j = 0; j < n; j++) v += phi[i][j] * x[j];
      next[i] = v;
    }
    x = next;
  }
  return y;
}

/**
 * A number-valued result's step response: `{ unit: 'n' | 't', points:
 * [{ t, y }], stairs }` (stairs for a sampled one), over about the time it
 * takes to settle (`span` overrides). `sAxis: 'normalized'` reads s in
 * units of 1/Ts, so its time is in sample periods. Null when it has none.
 */
export function stepResponse(value, { span = null } = {}) {
  if (!value || value.kind === 'mixed' || !value.numerator) return null;
  if (value.variable === 'z') {
    const settle = settlingSpan(value);
    const count = Math.min(MAX_SAMPLES, Math.max(32, Math.ceil(span ?? (settle === null ? 64 : 1.5 * settle))));
    const y = zStep(value, count);
    return y && { unit: 'n', stairs: true, points: y.map((v, n) => ({ t: n, y: v })) };
  }
  let terms;
  let den;
  if (hasDelays(value)) {
    const split = delayTermsOf(value);
    if (!split.ok) return null;
    den = split.den;
    terms = split.terms;
  } else {
    den = denseCoefficients(value.denominator, 's');
    const num = denseCoefficients(value.numerator, 's');
    if (!den || !num) return null;
    terms = [{ delay: 0, num }];
  }
  if (terms.some((term) => term.num.length > den.length)) return null;
  const settle = settlingSpan({ ...value, numerator: value.denominator });
  const longest = Math.max(0, ...terms.map((term) => term.delay));
  const end = span ?? (settle === null ? 10 * Math.max(1, longest) : 1.5 * settle + longest);
  const count = 600;
  const h = end / (count - 1);
  const total = new Array(count).fill(0);
  for (const term of terms) {
    const y = sStep(term.num, den, h, count);
    const shift = Math.round(term.delay / h);
    for (let k = shift; k < count; k++) total[k] += y[k - shift];
  }
  return { unit: 't', stairs: false, points: total.map((v, k) => ({ t: k * h, y: v })) };
}

/**
 * Several results' step responses on one pair of axes, as a plot annotation
 * keeps it: `traces` `{ label, color, value }`. Their time spans are made
 * one: the longest any of them needs. Null when none has a step response.
 */
export function stepPlot(traces) {
  const first = traces.map((trace) => ({ trace, step: stepResponse(trace.value) })).filter(({ step }) => step && step.points.length > 1);
  if (!first.length) return null;
  const end = Math.max(...first.map(({ step }) => step.points.at(-1).t));
  const steps = first.map(({ trace, step }) => ({ trace, step: step.points.at(-1).t < end ? stepResponse(trace.value, { span: end }) : step }));
  return {
    kind: 'step',
    unit: steps.some(({ step }) => step.unit === 'n') ? 'n' : 't',
    range: { low: 0, high: end },
    traces: steps.map(({ trace, step }) => ({
      label: trace.label,
      color: trace.color,
      ...(step.stairs ? { stairs: true } : {}),
      points: step.points.map(({ t, y }) => ({ t, y })),
    })),
  };
}
