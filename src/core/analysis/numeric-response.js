/**
 * The small-signal port quantities in numbers, for the Bode tab: the same
 * model the equations come from, every parameter a number, only s free.
 *
 * The MNA matrix of an R, L, C, controlled-source, and opamp model is affine
 * in s, A(s) = A0 + s A1 (a capacitor stamps sC, an inductor sL, a one-pole
 * opamp s/omega_t), and its excitations do not depend on s. So the curve is a
 * complex solve of A0 + jω A1 at each frequency -- exact, at any size -- and
 * each quantity, a ratio of two unknowns, is by Cramer's rule a ratio of two
 * determinants of matrices affine in s, whose roots (eigen.js) are its zeros
 * and poles. Nothing symbolic is solved, so no circuit is too large to plot.
 */

import { pencilRoots } from './eigen.js';

const c = (re, im = 0) => ({ re, im });
const cadd = (a, b) => c(a.re + b.re, a.im + b.im);
const csub = (a, b) => c(a.re - b.re, a.im - b.im);
const cmul = (a, b) => c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const cdiv = (a, b) => {
  const d = b.re * b.re + b.im * b.im;
  return c((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
};
const cabs = (a) => Math.hypot(a.re, a.im);

/** X with (A0 + s A1) X = B at a complex s, every column; null if singular. */
export function solveAt(A0, A1, B, s) {
  const n = A0.length;
  const a = A0.map((row, i) => row.map((value, j) => cadd(c(value), cmul(s, c(A1[i][j])))));
  const m = B[0]?.length || 0;
  const b = B.map((row) => row.map((value) => c(value)));
  const scale = Math.max(0, ...a.flat().map(cabs)) || 1;
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++) if (cabs(a[i][k]) > cabs(a[pivot][k])) pivot = i;
    if (cabs(a[pivot][k]) <= scale * 1e-15) return null;
    [a[k], a[pivot]] = [a[pivot], a[k]];
    [b[k], b[pivot]] = [b[pivot], b[k]];
    for (let i = k + 1; i < n; i++) {
      const f = cdiv(a[i][k], a[k][k]);
      if (f.re === 0 && f.im === 0) continue;
      for (let j = k; j < n; j++) a[i][j] = csub(a[i][j], cmul(f, a[k][j]));
      for (let j = 0; j < m; j++) b[i][j] = csub(b[i][j], cmul(f, b[k][j]));
    }
  }
  for (let k = n - 1; k >= 0; k--) {
    for (let j = 0; j < m; j++) {
      let sum = b[k][j];
      for (let i = k + 1; i < n; i++) sum = csub(sum, cmul(a[k][i], b[i][j]));
      b[k][j] = cdiv(sum, a[k][k]);
    }
  }
  return b;
}

/** The pencil whose determinant is unknown `index`'s numerator in column
 *  `column` (Cramer): that unknown's column replaced by the excitation. */
function cramerPencil(A0, A1, B, index, column) {
  return {
    A0: A0.map((row, i) => row.map((value, j) => (j === index ? B[i][column] : value))),
    A1: A1.map((row) => row.map((value, j) => (j === index ? 0 : value))),
  };
}

/** Expand prod (s - r) into real coefficients, low power first. */
function polynomialOf(roots) {
  let p = [c(1)];
  for (const r of roots) {
    const next = Array.from({ length: p.length + 1 }, () => c(0));
    for (let i = 0; i < p.length; i++) {
      next[i + 1] = cadd(next[i + 1], p[i]);
      next[i] = csub(next[i], cmul(r, p[i]));
    }
    p = next;
  }
  return p.map((value) => value.re);
}

function evaluateRoots(roots, s) {
  return roots.reduce((product, root) => cmul(product, csub(s, root)), c(1));
}

/**
 * One quantity, `sign * x_num / x_den` of the solution's unknowns (`den`
 * null: divided by one, as Z_out's unit test current), as the Bode tab
 * plots it: `response(ω)` the exact complex value, `zeros` and `poles` its
 * roots, and dense real `numerator`/`denominator` coefficients built from
 * them with the gain that matches the response.
 */
function quantityOf(system, { num, den = null, sign = 1 }) {
  const { A0, A1, B } = system;
  const pick = (solution, ref) => (ref.index === null ? c(0) : solution[ref.index][ref.column]);
  const value = (s) => {
    const solution = solveAt(A0, A1, B, s);
    if (!solution) return null;
    const top = pick(solution, num);
    const bottom = den ? pick(solution, den) : c(1);
    return cmul(c(sign), cdiv(top, bottom));
  };
  // det(A) itself when there is no denominator unknown: Cramer's x = det(A_k)/det(A).
  const rootsOf = (ref) => (ref ? (ref.index === null ? null : pencilRoots(...Object.values(cramerPencil(A0, A1, B, ref.index, ref.column))))
    : pencilRoots(A0, A1));
  if (num.index === null) return { zero: true };
  const zeros = rootsOf(num);
  const poles = rootsOf(den);
  if (!zeros || !poles) return null;
  // The gain: the exact value at a frequency clear of every root, divided
  // by the roots' product there.
  const corners = [...zeros, ...poles].map(cabs).filter((w) => w > 0);
  const probe = c(0, corners.length ? Math.sqrt(Math.min(...corners) * Math.max(...corners)) * 1.37 : 1);
  const at = value(probe);
  if (!at) return null;
  if (cabs(at) === 0) return { zero: true };
  const gain = cdiv(cmul(at, evaluateRoots(poles, probe)), evaluateRoots(zeros, probe));
  return {
    zeros,
    poles,
    numerator: polynomialOf(zeros).map((coefficient) => coefficient * gain.re),
    denominator: polynomialOf(poles),
    response: (omega) => value(c(0, omega)) || c(Number.NaN, Number.NaN),
  };
}

/**
 * The port quantities of an MNA system affine in s: `transfer` (A_v,
 * V(out)/V(in) under the input excitation, column 0), `input` (Z_in,
 * V(in) over the current into the input), and `output` (Z_out, V(out)
 * under the unit output test current, column 1). `unknowns` names the
 * system's columns; `aliases` maps a folded voltage to the unknown it
 * equals, or null for AC ground (an ideal opamp's nullor reduction).
 */
export function numericQuantities({ A0, A1, B, unknowns, aliases = new Map(), inputNode, outputNode, inputSource }) {
  const indexOf = (name) => {
    let current = name;
    for (let guard = 0; guard < 64; guard++) {
      const index = unknowns.indexOf(current);
      if (index >= 0) return index;
      if (!aliases.has(current)) return undefined;
      current = aliases.get(current);
      if (current === null) return null;
    }
    return undefined;
  };
  const ref = (name, column) => {
    const index = indexOf(name);
    return index === undefined ? undefined : { index, column };
  };
  const system = { A0, A1, B };
  const vin = ref(`V(${inputNode})`, 0);
  const vout = ref(`V(${outputNode})`, 0);
  const vtest = ref(`V(${outputNode})`, 1);
  const iin = ref(`I(${inputSource})`, 0);
  const out = {};
  if (vin && vout) out.transfer = quantityOf(system, { num: vout, den: vin });
  if (vin && iin) out.input = quantityOf(system, { num: vin, den: iin, sign: -1 });
  if (vtest) out.output = quantityOf(system, { num: vtest });
  return out;
}
