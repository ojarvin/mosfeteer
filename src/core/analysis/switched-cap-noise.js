/**
 * kT/C noise of a switched-capacitor circuit (switched-cap.js), in symbols.
 *
 * Each phase, settled, freezes the switches' thermal noise on the
 * capacitors they touch as it ends; settled, the phases' noise is
 * independent from phase to phase and from period to period.
 *
 * - **Sampling** (equipartition): with the op-amps' terminals held, the other
 *   nodes that touch a capacitor move as their closed switches let them --
 *   those switched to something held freely, a group switched to nothing
 *   held keeping its charge. Every independent way the capacitor voltages can
 *   move holds kT of energy: their covariance is kT B (B^T D B)^-1 B^T, B a
 *   basis of the moves and D the capacitances. Nodes that interact neither
 *   by a capacitor nor by a switch are independent contributors.
 * - **The op-amps** then move the sampled charge on as they move signal
 *   charge: a virtual ground keeps its group's charge, so what a switch drew
 *   from it is made up through the feedback capacitor.
 * - **To the output**: a contributor left at the end of phase j reaches the
 *   output read at the end of phase m by the same phase maps as the signal:
 *   N_j(z). Its output noise per sample is N_j(z) Sigma N_j(1/z)^T, and
 *   input-referred that over H(z) H(1/z) -- with the kT taken out, as the
 *   small-signal noise table takes out its 4kT.
 *
 * Op-amps are taken as ideal for the sampling (their inputs held still);
 * their own noise is not modelled. The result is the noise table's rows:
 * one per contributor, named by its phase and the switches it samples
 * through, and their total.
 */

import { add, multiply as times, polynomialCoefficients, power, rationalFunction, substituteRational, symbol } from './rational.js';
import { solveLinearSystem } from './solve.js';
import { cancelCommonPolynomialFactor } from './polynomial-gcd.js';

/** Gaussian elimination to reduced row echelon form, exact over `ops`:
 *  `{ rows, pivots }` (pivot column per kept row). */
function reduce(matrix, ops) {
  const rows = matrix.map((row) => [...row]);
  const width = rows[0]?.length || 0;
  const pivots = [];
  let r = 0;
  for (let c = 0; c < width && r < rows.length; c += 1) {
    const p = rows.findIndex((row, i) => i >= r && !ops.isZero(row[c]));
    if (p < 0) continue;
    [rows[r], rows[p]] = [rows[p], rows[r]];
    const pivot = rows[r][c];
    rows[r] = rows[r].map((value) => ops.div(value, pivot));
    for (let i = 0; i < rows.length; i += 1) {
      if (i === r || ops.isZero(rows[i][c])) continue;
      const factor = rows[i][c];
      rows[i] = rows[i].map((value, j) => ops.sub(value, ops.mul(factor, rows[r][j])));
    }
    pivots.push(c);
    r += 1;
  }
  return { rows: rows.slice(0, r), pivots };
}

/**
 * f(1/z) for a rational f(z), as polynomials in z again: N(1/z) / D(1/z)
 * with both multiplied by z to the highest power either has.
 */
function mirrored(value, variable) {
  if (value?.kind !== 'rational') return value;
  const numerator = polynomialCoefficients(value.numerator, variable);
  const denominator = polynomialCoefficients(value.denominator, variable);
  if (!numerator || !denominator) return substituteRational(value, new Map([[variable, power(symbol(variable), -1)]]), { variable });
  const top = Math.max(...[...numerator, ...denominator].map((term) => term.power));
  const flip = (terms) => add(...terms.map((term) => times(term.coefficient, power(symbol(variable), top - term.power))));
  return rationalFunction(flip(numerator), flip(denominator), { variable });
}

/** How many nodes an expression has, counted up to `limit`. */
function sizeOf(value, limit) {
  let count = 0;
  const stack = [value];
  while (stack.length && count <= limit) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    count += 1;
    for (const key of ['terms', 'factors']) if (node[key]) stack.push(...node[key]);
    for (const key of ['base', 'numerator', 'denominator', 'coefficient']) if (node[key]) stack.push(node[key]);
  }
  return count;
}

/** A basis of { x : A x = 0 } (columns), A with `width` columns. */
function nullSpace(A, width, ops) {
  if (!A.length) return Array.from({ length: width }, (_, i) => Array.from({ length: width }, (_, j) => (i === j ? ops.one : ops.zero)));
  const { rows, pivots } = reduce(A, ops);
  const free = Array.from({ length: width }, (_, c) => c).filter((c) => !pivots.includes(c));
  // Columns of the basis, as an n x d matrix.
  const basis = Array.from({ length: width }, () => Array(free.length).fill(ops.zero));
  free.forEach((f, k) => {
    basis[f][k] = ops.one;
    pivots.forEach((p, row) => { basis[p][k] = ops.neg(rows[row][f]); });
  });
  return basis;
}

/** The columns of M that span its range (a column basis). */
function columnBasis(M, ops) {
  if (!M.length || !M[0].length) return M.map(() => []);
  const { pivots } = reduce(M, ops);
  return M.map((row) => pivots.map((c) => row[c]));
}

const transpose = (M) => (M.length ? M[0].map((_, j) => M.map((row) => row[j])) : []);

function multiply(A, B, ops) {
  return A.map((row) => (B[0] || []).map((_, j) => row.reduce((sum, value, k) => ops.add(sum, ops.mul(value, B[k][j])), ops.zero)));
}

/**
 * The noise rows. `context`: { states, layouts, capacitors, switches, opamps, nodes:
 * { ground, input, output }, ops, lift, phaseMaps, Phi, readout, transfer,
 * variable }. Returns `{ ok, contributors: [{ label, phase, switches,
 * capacitors, output, input }], total: { output, input } }`, each a value
 * over kT; or `{ ok: false, error }`.
 */
export function switchedCapNoise(context) {
  const { states, layouts, capacitors, switches, opamps, nodes, ops, lift, phaseMaps, Phi, readout, transfer, variable } = context;
  const n = capacitors.length;
  if (!n) return { ok: false, error: 'There are no capacitors to sample noise on.' };
  const values = capacitors.map((cap) => lift(cap.value));
  const zInverse = ops.div(ops.one, lift(symbol(variable)));
  const identity = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? ops.one : ops.zero)));
  const held = new Set([nodes.ground, nodes.input]);
  const opampNodes = new Set(opamps.flatMap((o) => (o.type === 'opamp' ? [o.ip, o.im, o.o] : [o.ip, o.im, o.op, o.om])).filter((node) => !held.has(node)));
  const capNodes = new Set(capacitors.flatMap((cap) => [cap.a, cap.b]));
  const free = [...capNodes].filter((node) => !held.has(node) && !opampNodes.has(node));

  // The paths to the output, as rows over the capacitors. Read at the end
  // of phase m, the output is c (M_(m-1) ... M_0) s_(n-1) + c (M_(m-1) ...
  // M_(j+1)) e for what phase j < m left this period, and s around the period
  // is L^-1 (M_(K-1) ... M_(j+1)) e, L = I - z^-1 Phi -- so one row,
  // y = z^-1 c (M_(m-1) ... M_0) L^-1, solved once, serves every phase.
  const K = phaseMaps.length;
  const rowTimes = (row, M) => M[0].map((_, c) => row.reduce((sum, value, i) => ops.add(sum, ops.mul(value, M[i][c])), ops.zero));
  const outputRow = phaseMaps[readout].output.slice(1);
  let w = outputRow;
  for (let k = readout - 1; k >= 0; k -= 1) w = rowTimes(w, phaseMaps[k].M);
  const loop = identity.map((row, i) => row.map((value, j) => ops.sub(value, ops.mul(zInverse, Phi[i][j]))));
  const settled = solveLinearSystem(transpose(loop), w.map((value) => [ops.mul(zInverse, value)]), { ops });
  if (!settled.ok) return { ok: false, error: 'The noise\'s path to the output has no single solution.' };
  const paths = Array(K);
  let around = settled.values.map((row) => row[0]); // y M_(K-1) ... M_(j+1)
  let direct = outputRow; // c M_(m-1) ... M_(j+1), for j < m
  for (let j = K - 1; j >= 0; j -= 1) {
    paths[j] = j < readout ? around.map((value, c) => ops.add(value, direct[c])) : around;
    around = rowTimes(around, phaseMaps[j].M);
    if (j < readout) direct = rowTimes(direct, phaseMaps[j].M);
  }
  const mirror = (value) => mirrored(value, variable);
  const tidy = (value) => cancelCommonPolynomialFactor(value, { variable, maxWork: 400_000 });

  const contributors = [];
  for (const [k, layout] of layouts.entries()) {
    const closed = switches.filter((s) => layout.state.closed.has(s.refdes));
    // Nodes joined by closed switches (all nodes), and whether a group
    // reaches anything held (the true held nodes, or an op-amp's terminal).
    const parent = new Map();
    const find = (x) => { if (!parent.has(x)) parent.set(x, x); while (parent.get(x) !== x) x = parent.get(x); return x; };
    for (const s of closed) parent.set(find(s.a), find(s.b));
    const anchored = new Set();
    for (const node of [...held, ...opampNodes]) anchored.add(find(node));
    // Independent blocks of free nodes: joined by a capacitor, or by closed
    // switches into a group nothing holds (switched to a held node, each
    // moves alone).
    const blockParent = new Map(free.map((node) => [node, node]));
    const blockFind = (x) => { while (blockParent.get(x) !== x) x = blockParent.get(x); return x; };
    for (let i = 0; i < free.length; i += 1) {
      for (let j = i + 1; j < free.length; j += 1) {
        const a = free[i];
        const b = free[j];
        const coupled = (find(a) === find(b) && !anchored.has(find(a))) || capacitors.some((cap) => (cap.a === a && cap.b === b) || (cap.a === b && cap.b === a));
        if (coupled) blockParent.set(blockFind(a), blockFind(b));
      }
    }
    const blocks = new Map();
    for (const node of free) {
      const root = blockFind(node);
      if (!blocks.has(root)) blocks.set(root, []);
      blocks.get(root).push(node);
    }
    // The op-amps' answer (stage B), the same for every block: the full
    // capacitor voltages from the sampled ones, delta = (I + E R) u.
    const stageB = opampResponse({ layout, capacitors, opamps, held, opampNodes, ops, lift, values });
    if (!stageB) return { ok: false, error: `In ${layout.state.name} the op-amps' answer to the sampled noise has no single solution.` };
    const path = paths[k];
    for (const blockNodes of blocks.values()) {
      const index = new Map(blockNodes.map((node, i) => [node, i]));
      const touching = capacitors.map((cap, i) => ({ cap, i })).filter(({ cap }) => index.has(cap.a) || index.has(cap.b));
      // A block nothing switches stays put: no noise sampled there.
      const switched = closed.some((s) => index.has(s.a) || index.has(s.b) || blockNodes.some((node) => find(node) === find(s.a)));
      if (!touching.length || !switched) continue;
      // Its charge constraints: each group of it reaching nothing held.
      const C = blockNodes.map(() => Array(blockNodes.length).fill(ops.zero));
      for (const { cap, i } of touching) {
        const a = index.get(cap.a);
        const b = index.get(cap.b);
        if (a !== undefined) C[a][a] = ops.add(C[a][a], values[i]);
        if (b !== undefined) C[b][b] = ops.add(C[b][b], values[i]);
        if (a !== undefined && b !== undefined) {
          C[a][b] = ops.sub(C[a][b], values[i]);
          C[b][a] = ops.sub(C[b][a], values[i]);
        }
      }
      const floatingGroups = new Map();
      for (const node of blockNodes) {
        const root = find(node);
        if (anchored.has(root)) continue;
        if (!floatingGroups.has(root)) floatingGroups.set(root, []);
        floatingGroups.get(root).push(index.get(node));
      }
      const constraints = [...floatingGroups.values()].map((members) => blockNodes.map((_, c) => members.reduce((sum, r) => ops.add(sum, C[r][c]), ops.zero)));
      const P = nullSpace(constraints, blockNodes.length, ops);
      // The capacitor voltages those moves give (op-amp nodes held): W = M P.
      const M = capacitors.map((cap) => blockNodes.map((node) => (cap.a === node ? ops.one : cap.b === node ? ops.neg(ops.one) : ops.zero)));
      const W = multiply(M, P, ops);
      const B = columnBasis(W, ops);
      if (!B[0]?.length) continue;
      const D = capacitors.map((_, i) => capacitors.map((__, j) => (i === j ? values[i] : ops.zero)));
      const gram = multiply(multiply(transpose(B), D, ops), B, ops);
      const inverse = solveLinearSystem(gram, gram.map((_, i) => gram.map((__, j) => (i === j ? ops.one : ops.zero))), { ops });
      if (!inverse.ok) return { ok: false, error: `In ${layout.state.name} the sampled noise has no single covariance.` };
      // Sampled covariance over kT, B G^-1 B^T, moved on by the op-amps:
      // V = stageB B. Output noise per sample over kT: N(z) Sigma N(1/z)^T
      // = Q G^-1 Q(1/z)^T, Q = N V.
      // Input-referred: each path over H(z) first -- they share H's
      // denominator, which cancels -- then R G^-1 R(1/z)^T, R = Q / H.
      const R = rowTimes(path, multiply(stageB, B, ops)).map((value) => (ops.isZero(value) ? value : tidy(ops.div(value, transfer))));
      // Past reading in symbols (unmatched halves): refused, at once.
      if (context.maxTerms && R.some((value) => sizeOf(value, context.maxTerms) > context.maxTerms)) return { ok: false, tooLarge: true, error: 'The noise is too large to show in symbols.' };
      const back = R.map(mirror);
      let input = ops.zero;
      for (let a = 0; a < R.length; a += 1) {
        if (ops.isZero(R[a])) continue;
        for (let c = 0; c < R.length; c += 1) {
          if (ops.isZero(inverse.values[a][c]) || ops.isZero(back[c])) continue;
          input = ops.add(input, ops.mul(ops.mul(R[a], inverse.values[a][c]), back[c]));
        }
      }
      input = tidy(input);
      if (ops.isZero(input)) continue;
      const switches = closed.filter((s) => index.has(s.a) || index.has(s.b) || blockNodes.some((node) => !anchored.has(find(node)) && find(node) === find(s.a))).map((s) => s.refdes);
      contributors.push({
        phase: k,
        phaseName: states[k].name,
        switches: [...new Set(switches)].sort((x, y) => x.localeCompare(y, undefined, { numeric: true })),
        capacitors: touching.map(({ cap }) => cap.refdes),
        input,
      });
    }
  }
  const total = tidy(contributors.reduce((sum, contributor) => ops.add(sum, contributor.input), ops.zero));
  return { ok: true, contributors, total: { input: total } };
}

/**
 * Stage B: how the op-amps move a sampled set of capacitor voltages u on.
 * Their terminals' groups (in this phase) take voltages that keep each such
 * group's charge (one with no output on it) and the op-amps' own equations;
 * the full capacitor voltages are u plus what those voltages add. Returns
 * the n x n map, or null when it has no single solution.
 */
function opampResponse({ layout, capacitors, opamps, held, opampNodes, ops, lift, values }) {
  const n = capacitors.length;
  const identity = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? ops.one : ops.zero)));
  if (!opamps.length) return identity;
  // One unknown per joined group holding an op-amp terminal, unless held.
  const groups = new Map();
  for (const node of opampNodes) {
    const group = layout.groupOf(node);
    if (group.kind === 'ground' || group.kind === 'input') continue;
    if (!groups.has(group)) groups.set(group, groups.size);
  }
  const size = groups.size;
  if (!size) return identity;
  // A node's share of the response: its group's unknown, when that holds an
  // op-amp terminal; else nothing (the free nodes' own moves are in u).
  const unknownOf = (node) => groups.get(layout.groupOf(node)) ?? null;
  const A = [];
  const B = []; // right-hand side over u (n columns)
  const row = () => { A.push(Array(size).fill(ops.zero)); B.push(Array(n).fill(ops.zero)); return A.length - 1; };
  for (const [group, g] of groups) {
    if (group.kind === 'driven') continue;
    // Its charge kept: sum over plates on it of +-C_i (u_i + Dpart_i) = 0.
    const r = row();
    let any = false;
    for (const [i, cap] of capacitors.entries()) {
      if (layout.groupOf(cap.a) === layout.groupOf(cap.b)) continue; // shorted: holds nothing
      for (const [plate, sign] of [[cap.a, 1], [cap.b, -1]]) {
        if (layout.groupOf(plate) !== group) continue;
        any = true;
        const C = sign > 0 ? values[i] : ops.neg(values[i]);
        B[r][i] = ops.sub(B[r][i], C);
        const ua = unknownOf(cap.a);
        const ub = unknownOf(cap.b);
        if (ua !== null) A[r][ua] = ops.add(A[r][ua], C);
        if (ub !== null) A[r][ub] = ops.sub(A[r][ub], C);
      }
    }
    if (!any) { A.pop(); B.pop(); }
  }
  for (const opamp of opamps) {
    const r = row();
    const at = (node, value) => { const u = unknownOf(node); if (u !== null) A[r][u] = ops.add(A[r][u], value); };
    at(opamp.ip, ops.one);
    at(opamp.im, ops.neg(ops.one));
    if (opamp.gain) {
      const inverse = ops.div(ops.one, lift(symbol(opamp.gain)));
      if (opamp.type === 'opamp') at(opamp.o, ops.neg(inverse));
      else { at(opamp.op, ops.neg(inverse)); at(opamp.om, inverse); }
    }
    if (opamp.type === 'opamp_diff') {
      const cm = row();
      const atCm = (node) => { const u = unknownOf(node); if (u !== null) A[cm][u] = ops.add(A[cm][u], ops.one); };
      atCm(opamp.op);
      atCm(opamp.om);
    }
  }
  if (A.length !== size) return null;
  const solved = solveLinearSystem(A, B, { ops });
  if (!solved.ok) return null;
  // delta_i = u_i + [a in op-amp groups] v_a - [b ...] v_b.
  const R = solved.values; // size x n
  return capacitors.map((cap, i) => identity[i].map((value, c) => {
    let total = value;
    const ua = unknownOf(cap.a);
    const ub = unknownOf(cap.b);
    if (ua !== null) total = ops.add(total, R[ua][c]);
    if (ub !== null) total = ops.sub(total, R[ub][c]);
    return total;
  }));
}
