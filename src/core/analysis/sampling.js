/**
 * Sampling a continuous path: the z-domain transfer function a sampler sees
 * through an H(s) path driven by a sampled signal (a DAC and a loop filter,
 * say). Each sample x[k] enters the path as an impulse at t = kT -- the
 * path's H(s) includes the DAC's pulse, e.g. (1 - e^{-sT})/s -- and the
 * sampler reads the response just before each t = nT, so a pulse edge
 * landing on a sample counts from the next one (an NRZ DAC with no excess
 * delay gives its natural z^-1). This is exact, not a transform choice:
 *
 *   F(s) = sum over delays tau of e^{-s tau} R_tau(s),  R_tau = N_tau / D
 *   F_d(z) = sum_n f(nT^-) z^-n
 *
 * Each R_tau is put in controllable canonical form (A, B, C_tau); its
 * samples are C_tau e^{A delta} (e^{AT})^j B after the first sample past
 * tau, so the sum is a rational in z with the denominator det(zI - e^{AT})
 * shared by every delay -- repeated poles (integrators) need no special
 * case. Numbers only: the path's coefficients must have values.
 */

import { polynomialRoots } from './bode.js';

/** n x n identity. */
const identity = (n) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));

function matMul(a, b) {
  const n = a.length;
  const m = b[0].length;
  const out = Array.from({ length: n }, () => Array(m).fill(0));
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < b.length; k++) {
      const v = a[i][k];
      if (!v) continue;
      for (let j = 0; j < m; j++) out[i][j] += v * b[k][j];
    }
  }
  return out;
}

/** e^{M}: scaling and squaring around a Taylor series. */
export function expm(m) {
  const n = m.length;
  if (!n) return [];
  const norm = Math.max(...m.map((row) => row.reduce((sum, v) => sum + Math.abs(v), 0)));
  const squarings = norm > 0.5 ? Math.ceil(Math.log2(norm / 0.5)) : 0;
  const scaled = m.map((row) => row.map((v) => v / 2 ** squarings));
  let term = identity(n);
  let sum = identity(n);
  for (let k = 1; k <= 24; k++) {
    term = matMul(term, scaled).map((row) => row.map((v) => v / k));
    sum = sum.map((row, i) => row.map((v, j) => v + term[i][j]));
  }
  for (let i = 0; i < squarings; i++) sum = matMul(sum, sum);
  return sum;
}

/**
 * Sample `{ den, terms }` with period `T`: `den` the path's denominator in
 * s, coefficients low power first; `terms` `[{ delay, num }]`, each
 * numerator low power first, strictly proper over `den`. Returns `{ num,
 * den }` in ascending powers of z^-1, `den[0] = 1`.
 */
export function samplePath({ den, terms }, T) {
  const lead = den[den.length - 1];
  const d = den.map((v) => v / lead);
  const n = d.length - 1;
  if (n < 1) throw new Error('impulses reach the sampler: the path from the sampled signal needs a pulse (a DAC such as (1 - exp(-s*T))/s)');
  // Companion form of 1/D: x' = A x + B u, the state the derivatives of y.
  const A = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i < n - 1 ? (j === i + 1 ? 1 : 0) : -d[j])));
  const Bcol = Array.from({ length: n }, (_, i) => [i === n - 1 ? 1 : 0]);
  const phi = expm(A.map((row) => row.map((v) => v * T)));
  // Faddeev-LeVerrier: det(zI - phi) and the adjugate's matrix coefficients.
  const p = [1];
  const Ms = [identity(n)];
  for (let k = 1; k <= n; k++) {
    const am = matMul(phi, Ms[k - 1]);
    const trace = am.reduce((sum, row, i) => sum + row[i], 0);
    p.push(-trace / k);
    if (k < n) Ms.push(am.map((row, i) => row.map((v, j) => v + (i === j ? p[k] : 0))));
  }
  const MB = Ms.map((M) => matMul(M, Bcol).map((row) => row[0]));
  // num in z^-1: each delay's samples start N0 periods in, offset delta.
  const num = [];
  for (const { delay, num: c } of terms) {
    if (delay < -1e-12) throw new Error('a path runs ahead of its input (a negative delay) and cannot be sampled');
    if (c.length > n || (c.length === n + 1 && Math.abs(c[n]) > 0)) throw new Error('impulses reach the sampler: the path from the sampled signal needs a pulse (a DAC such as (1 - exp(-s*T))/s)');
    const k = Math.floor(delay / T + 1e-9);
    const start = k + 1;
    const delta = Math.min(T, Math.max(0, start * T - delay));
    const ead = expm(A.map((row) => row.map((v) => v * delta)));
    const C = Array.from({ length: n }, (_, j) => (c[j] || 0) / lead);
    const h = Array.from({ length: n }, (_, j) => C.reduce((sum, ci, i) => sum + ci * ead[i][j], 0));
    // G = z^-start * sum_k (h M_k B) z^-k / (1 + p1 z^-1 + ... + pn z^-n).
    for (let i = 0; i < n; i++) {
      const q = h.reduce((sum, hj, j) => sum + hj * MB[i][j], 0);
      const at = start + i;
      while (num.length <= at) num.push(0);
      num[at] += q;
    }
  }
  return cancelCommonRoots(clean(num), clean(p));
}

/** `poly / factor` (both low power first): `{ quotient, exact }`, exact
 *  when the remainder is round-off next to the polynomial's size. */
function divide(poly, factor) {
  if (factor.length > poly.length) return { quotient: poly, exact: false };
  const rem = [...poly];
  const out = Array(poly.length - factor.length + 1).fill(0);
  const lead = factor[factor.length - 1];
  for (let i = poly.length - factor.length; i >= 0; i--) {
    const q = rem[i + factor.length - 1] / lead;
    out[i] = q;
    for (let j = 0; j < factor.length; j++) rem[i + j] -= q * factor[j];
  }
  const scale = Math.max(...poly.map(Math.abs), 1e-300);
  const exact = rem.slice(0, factor.length - 1).every((r) => Math.abs(r) <= 1e-7 * scale);
  return { quotient: out, exact };
}

/**
 * Cancel the roots numerator and denominator share in floating point: a
 * DAC's 1/s against its (1 - e^{-sT}) leaves a pole and a zero at z = 1
 * that round-off keeps from cancelling exactly.
 */
function cancelCommonRoots(num, den) {
  let n = trim(num);
  let d = trim(den);
  const tryFactor = (factor) => {
    const top = divide(n, factor);
    const bottom = divide(d, factor);
    if (!top.exact || !bottom.exact) return false;
    n = trim(top.quotient);
    d = trim(bottom.quotient);
    return true;
  };
  for (const root of polynomialRoots(d)) {
    // A repeated real root comes back scattered round its value (by about
    // the m-th root of round-off): try it as real, and rounded (an
    // integrator chain's z = 1), before as a complex pair.
    const near = Math.abs(root.im) <= 1e-3 * Math.max(1, Math.hypot(root.re, root.im));
    if (near) {
      // The exact-division check keeps a rounding from cancelling a root
      // the numerator does not have.
      const candidates = [1e3, 1e4, 1e6].map((k) => Math.round(root.re * k) / k);
      if ([...new Set([...candidates, root.re])].some((r) => tryFactor([-r, 1]))) continue;
    }
    if (root.im <= 0) continue;
    tryFactor([root.re ** 2 + root.im ** 2, -2 * root.re, 1]);
  }
  // Keep den[0] = 1.
  const lead = d[0] || 1;
  return { num: clean(n.map((v) => v / lead)), den: clean(d.map((v) => v / lead)) };
}

function trim(poly) {
  const out = [...poly];
  while (out.length > 1 && out[out.length - 1] === 0) out.pop();
  return out;
}

/** Round-off zeros: a coefficient a trillionth of the largest is none. */
function clean(list) {
  const scale = Math.max(...list.map(Math.abs), 0);
  return list.map((v) => (Math.abs(v) <= scale * 1e-12 ? 0 : v));
}
