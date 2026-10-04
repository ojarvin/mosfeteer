/**
 * Coefficient rounding for the optimizer (optimize.js): each free
 * coefficient made a simple fraction m/n, n at most a chosen denominator
 * (or a power of two), at the least cost to the specs. Whatever realizes
 * the coefficient -- a ratio of unit elements of any kind, or a digital
 * multiplier -- it reads as "m units over n": the larger n may be, the finer
 * the rounding and the more units it costs.
 *
 * Sequential rounding with re-optimization: the gains into one block share
 * its n (coefficientGroups), so a block's coefficients read as m_1/n,
 * m_2/n, ...; one group is rounded and fixed,
 * the rest re-optimized briefly to win back what it cost, and so on until
 * every one is a fraction; then each is moved by one unit while that helps.
 * Each block takes the n (up to the largest allowed) that rounds its gains
 * most accurately, and the block rounded worst goes first, so the
 * coefficients still free can make up for it. Candidates are ranked as the optimizer ranks
 * them (fitnessOf: every limit met first, then the goals). The search is a
 * generator of batches to score, so the editor can score them in worker
 * threads: it yields `{ batch, phase, step, steps }` and takes the batch's
 * scores back -- a batch item is the numbers (the quick test) or
 * `{ verify: numbers }` (the long one: the start and the result).
 */

import { createOptimizer, fitnessOf, pointValues, scoreRequest } from './optimize.js';
import { coefficientValue, signalFlowGraph } from './signal-flow.js';
import { expressionSymbols } from './bode.js';
import { parseGain } from '../transfer-function.js';

/** Fractions m/n (n up to `maxDenominator`, or its powers of two) from
 *  `low` to `high` (both >= 0), with 0, sorted. */
export function fractionGrid(low, high, maxDenominator, { powersOfTwo = false } = {}) {
  const found = new Map([[0, { m: 0, n: 1, value: 0 }]]);
  for (let n = 1; n <= maxDenominator; n = powersOfTwo ? n * 2 : n + 1) {
    for (let m = Math.max(0, Math.floor(low * n)); m <= Math.ceil(high * n); m++) {
      const value = m / n;
      if (value < low || value > high) continue;
      // Each value in its lowest terms: the first (smallest) n reaching it.
      if (!found.has(value)) found.set(value, { m, n, value });
    }
  }
  return [...found.values()].sort((a, b) => a.value - b.value);
}

/** The fractions around a value: its grid (signed like it) and where the
 *  value sits in it -- `below`/`above` the fractions either side. */
export function fractionsAround(value, maxDenominator, options = {}) {
  const size = Math.abs(value);
  const sign = value < 0 ? -1 : 1;
  const grid = fractionGrid(size / 4, Math.max(size * 4, 2 / maxDenominator), maxDenominator, options)
    .map((f) => ({ ...f, m: sign * f.m, value: sign * f.value }));
  // Sorted by size, then by the signed value's side.
  const bySize = grid.slice().sort((a, b) => Math.abs(a.value) - Math.abs(b.value));
  let below = bySize[0];
  let above = bySize[bySize.length - 1];
  for (const f of bySize) {
    if (Math.abs(f.value) <= size) below = f;
    if (Math.abs(f.value) >= size) { above = f; break; }
  }
  return { grid: bySize, below, above };
}

/** A value as a fraction "m/n" when it is one with n up to `maxDenominator`
 *  (and not an integer), else null. */
export function fractionText(value, maxDenominator = 1024) {
  if (!Number.isFinite(value) || Number.isInteger(value)) return null;
  for (let n = 2; n <= maxDenominator; n++) {
    const m = Math.round(value * n);
    if (Math.abs(m / n - value) < 1e-12 * Math.max(1, Math.abs(value))) return `${m}/${n}`;
  }
  return null;
}

/**
 * Which coefficients share a denominator: the gains into one block. Each
 * gain's output is followed through sum junctions to the first part that is
 * not one -- an integrator, a quantizer, an output -- and the gains reaching
 * the same part form a group (that part's one reference element sets their
 * n). A coefficient elsewhere (inside a transfer function, or in gains
 * reaching different parts) groups with whatever it shares a gain with.
 * Returns `[{ into (refdes or null), names }]` over `names`.
 */
export function coefficientGroups(circuit, names) {
  const wanted = new Set(names);
  const { signals } = signalFlowGraph(circuit);
  const readersOf = new Map();
  for (const signal of signals.values()) {
    if (!signal.driver || signal.driver.source) continue;
    readersOf.set(signal.driver.comp, signal.readers.map((r) => r.comp));
  }
  // Where a part's output ends up, past sums.
  const destination = (refdes) => {
    const seen = new Set();
    let frontier = readersOf.get(refdes) || [];
    while (frontier.length) {
      const next = [];
      for (const comp of frontier) {
        if (seen.has(comp)) continue;
        seen.add(comp);
        if (circuit.components.get(comp)?.type === 'signal_sum') next.push(...(readersOf.get(comp) || []));
        else return comp;
      }
      frontier = next;
    }
    return null;
  };
  const parent = new Map(names.map((name) => [name, name]));
  const find = (name) => (parent.get(name) === name ? name : find(parent.get(name)));
  const into = new Map();
  for (const component of circuit.components.values()) {
    if (component.type !== 'gain') continue;
    const read = new Set();
    try { expressionSymbols(coefficientValue(parseGain(component.value)), 's', read); } catch { continue; }
    const mine = [...read].filter((name) => wanted.has(name));
    if (!mine.length) continue;
    const target = destination(component.refdes);
    if (!target) continue;
    const key = `into:${target}`;
    if (!parent.has(key)) { parent.set(key, key); into.set(key, target); }
    for (const name of mine) parent.set(find(name), find(key));
  }
  const groups = new Map();
  for (const name of names) {
    const root = find(name);
    if (!groups.has(root)) groups.set(root, { into: into.get(root) || null, names: [] });
    groups.get(root).names.push(name);
  }
  return [...groups.values()];
}

/** m for a value over n: the nearest, but never zero for a value that is
 *  not (a path rounded away is a different diagram), its sign kept. */
const unitsOf = (v, n) => {
  const m = Math.round(v * n);
  return m === 0 && v !== 0 ? Math.sign(v) : m;
};

/** A group's most accurate n up to its largest (or its powers of two): the
 *  least average relative error over its members, the smaller n on a tie. */
function bestDenominator(numbers, maxDenominator, powersOfTwo) {
  let best = { n: 1, error: Infinity };
  for (let n = 1; n <= maxDenominator; n = powersOfTwo ? n * 2 : n + 1) {
    const error = numbers.reduce((sum, v) => sum + (v ? Math.abs(unitsOf(v, n) / n - v) / Math.abs(v) : 0), 0) / numbers.length;
    if (error < best.error - 1e-12) best = { n, error };
  }
  return best;
}

/**
 * The rounding search over `parameters` (optimizationParameters), from the
 * numbers `values` (every coefficient's own), `links` resolved. `options`:
 * `denominator` (the largest n), `denominators` (per coefficient: its
 * group's is the smallest of its members'), `powersOfTwo`, `groups`
 * (coefficientGroups; each coefficient alone when omitted), `seed`.
 *
 * A group is rounded at once: every member m/n over one n, the n (up to its
 * largest) that rounds it most accurately; the group rounded worst goes
 * first, then the rest are re-optimized; at the end each member is moved by
 * one unit, 1/n, while that helps. Returns, when done, `{ own, values, score,
 * fitness, fractions: { name: { m, n } }, groups, start (the unrounded score) }`.
 */
export function* roundingSearch(parameters, { values = {}, links = {}, denominator = 32, denominators = {}, powersOfTwo = false, groups: rawGroups = null, seed = 1 } = {}) {
  const own = { ...values };
  for (const p of parameters.free) own[p.name] = Number.isFinite(own[p.name]) ? own[p.name] : p.start;
  const byName = new Map(parameters.free.map((p) => [p.name, p]));
  const groups = (rawGroups || parameters.free.map((p) => ({ into: null, names: [p.name] })))
    .map((g) => ({ into: g.into, names: g.names.filter((name) => byName.has(name)) }))
    .filter((g) => g.names.length);
  const maxOf = (group) => Math.min(...group.names.map((name) => denominators[name] || denominator));
  const resolvedOf = (numbers) => pointValues({ free: [] }, [], { values: numbers, links }).values;
  const inRange = (p, v) => (p.min === null || v >= p.min - 1e-12) && (p.max === null || v <= p.max + 1e-12);
  // A group over n: each member to its nearest m/n (kept in its range).
  const roundedAt = (group, n) => Object.fromEntries(group.names.map((name) => {
    const p = byName.get(name);
    let m = unitsOf(own[name], n);
    if (!inRange(p, m / n)) m = inRange(p, (m + 1) / n) ? m + 1 : inRange(p, (m - 1) / n) ? m - 1 : m;
    return [name, m];
  }));
  const remaining = [...groups];
  const fractions = {};
  const denominatorOf = new Map();
  const steps = groups.length;

  // The start and the result are verified with the long test, the steps
  // between ranked by the quick one.
  const [startScore] = yield { batch: [{ verify: resolvedOf(own) }], phase: 'start', step: 0, steps };
  let current = { score: startScore, fitness: fitnessOf(startScore) };

  while (remaining.length) {
    // Each group at its most accurate n (up to its largest; the smaller on a
    // tie), and the group rounded worst goes first, while the rest are still
    // free to make up for it.
    let chosen = null;
    for (const group of remaining) {
      const numbers = group.names.map((name) => own[name]);
      const { n, error } = bestDenominator(numbers, maxOf(group), powersOfTwo);
      if (!chosen || error > chosen.error) chosen = { group, n, error };
    }
    const ms = roundedAt(chosen.group, chosen.n);
    for (const [name, m] of Object.entries(ms)) {
      own[name] = m / chosen.n;
      fractions[name] = { m, n: chosen.n };
    }
    denominatorOf.set(chosen.group, chosen.n);
    remaining.splice(remaining.indexOf(chosen.group), 1);
    const [score] = yield { batch: [resolvedOf(own)], phase: 'round', step: steps - remaining.length, steps };
    current = { score, fitness: fitnessOf(score) };

    // The rest re-optimized from here, briefly.
    const rest = remaining.flatMap((g) => g.names).map((name) => byName.get(name));
    if (rest.length) {
      const sub = { free: rest.map((q) => ({ ...q, start: own[q.name], log: q.log && own[q.name] !== 0 })) };
      const optimizer = createOptimizer(sub, { values: own, links, evaluations: Math.min(800, 80 * rest.length + 100), seed: seed + remaining.length, sigma: 0.15 });
      while (!optimizer.done) {
        const candidates = optimizer.ask();
        optimizer.tell(yield { batch: candidates.map((c) => c.request), phase: 'reoptimize', step: steps - remaining.length, steps });
      }
      const found = optimizer.best;
      if (found && found.fitness < current.fitness) {
        for (const q of rest) own[q.name] = found.own[q.name];
        current = { score: found.score, fitness: found.fitness };
      }
    }
  }

  // One unit (1/n) up or down on any member, while it helps.
  for (let pass = 0; pass < 4; pass++) {
    const trials = [];
    for (const group of groups) {
      const n = denominatorOf.get(group);
      for (const name of group.names) {
        for (const dm of [-1, 1]) {
          const m = fractions[name].m + dm;
          // Not to zero, nor across it.
          if (m === 0 || Math.sign(m) !== Math.sign(fractions[name].m)) continue;
          if (inRange(byName.get(name), m / n)) trials.push({ name, m, n });
        }
      }
    }
    if (!trials.length) break;
    const scores = yield { batch: trials.map((t) => resolvedOf({ ...own, [t.name]: t.m / t.n })), phase: 'polish', step: steps, steps };
    let best = -1;
    for (let i = 0; i < trials.length; i++) if (fitnessOf(scores[i]) < (best < 0 ? current.fitness - 1e-9 : fitnessOf(scores[best]))) best = i;
    if (best < 0) break;
    const t = trials[best];
    own[t.name] = t.m / t.n;
    fractions[t.name] = { m: t.m, n: t.n };
    current = { score: scores[best], fitness: fitnessOf(scores[best]) };
  }
  const [finalScore] = yield { batch: [{ verify: resolvedOf(own) }], phase: 'verify', step: steps, steps };
  return {
    own, values: resolvedOf(own), score: finalScore, fitness: fitnessOf(finalScore), fractions, start: startScore,
    groups: groups.map((g) => ({ into: g.into, names: g.names, n: denominatorOf.get(g) })),
  };
}

/** The whole rounding in this thread, scored by `objective` (prepareObjective). */
export function runRounding(objective, parameters, options) {
  const search = roundingSearch(parameters, options);
  let step = search.next();
  let evaluations = 0;
  while (!step.done) {
    evaluations += step.value.batch.length;
    step = search.next(step.value.batch.map((request) => scoreRequest(objective, request)));
  }
  return { ...step.value, evaluations };
}

/**
 * The dither's gain as a fraction of a block's n: dither of +-`steps`
 * quantizer steps, entering the quantizer's block from the reference (the
 * diagram's full scale, N - 1), is a gain k = 2 steps / fullScale; the
 * smallest m/n at or above it, so the dither is at least what was set.
 * Returns `{ m, n, gain, steps (realized) }`, or null without dither.
 */
export function ditherFraction(steps, fullScale, n) {
  if (!(steps > 0) || !(fullScale > 0) || !(n >= 1)) return null;
  const gain = (2 * steps) / fullScale;
  const m = Math.max(1, Math.ceil(gain * n - 1e-9));
  return { m, n, gain, steps: ((m / n) * fullScale) / 2 };
}
