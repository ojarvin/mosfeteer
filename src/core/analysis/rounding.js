/**
 * Fractions for the optimizer (optimize.js): each free coefficient a
 * simple fraction m/n, n at most a chosen denominator (or a power of two),
 * or exactly a chosen n. Whatever realizes the coefficient -- a ratio of
 * unit elements of any kind, or a digital multiplier -- it reads as "m
 * units over n": the larger n may be, the finer the steps and the more
 * units it costs.
 *
 * The fractions are kept during the search, not made after it: every
 * candidate the search proposes is snapped to the nearest fractions
 * (`fractionSnapper`) before it is scored, so the search only ever weighs
 * numbers that can be built, and the best it finds is one. The gains into
 * one block share its n (coefficientGroups), so a block's coefficients read
 * m_1/n, m_2/n, ...; a block's n is the one (up to its largest) that its
 * gains snap to most accurately, or the n set for it exactly. After the
 * search, `polishSearch` moves each by one unit while that helps.
 */

import { fitnessOf } from './optimize.js';
import { resolveCoefficients } from './coefficient-links.js';
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

/** How far a group's numbers move over n: their average relative error. */
const errorAt = (numbers, n) => numbers.reduce((sum, v) => sum + (v ? Math.abs(unitsOf(v, n) / n - v) / Math.abs(v) : 0), 0) / numbers.length;

/** A group's most accurate n up to its largest (or its powers of two): the
 *  least average relative error over its members, the smaller n on a tie. */
function bestDenominator(numbers, maxDenominator, powersOfTwo) {
  let best = { n: 1, error: Infinity };
  for (let n = 1; n <= maxDenominator; n = powersOfTwo ? n * 2 : n + 1) {
    const error = errorAt(numbers, n);
    if (error < best.error - 1e-12) best = { n, error };
  }
  return best;
}

/**
 * The snapping of free numbers to fractions, for `parameters`
 * (optimizationParameters). `options`: `denominator` (the largest n; with
 * `fixed`, the n), `denominators` (per coefficient: its group's largest is
 * the smallest of its members'), `exact` (per coefficient, an n its group
 * must have: the largest of its members'), `powersOfTwo`, `groups`
 * (coefficientGroups; each coefficient alone when omitted). Returns
 * `snap(own)` giving `{ own (the free ones snapped, the rest as they were),
 * fractions: { name: { m, n } }, groups: [{ into, names, n }] }`. A number
 * that is not zero never snaps to zero (that is another diagram), nor
 * across it, and stays within its range where a neighbouring m allows.
 */
export function fractionSnapper(parameters, { denominator = 32, fixed = false, denominators = {}, exact = {}, powersOfTwo = false, groups: rawGroups = null } = {}) {
  const byName = new Map(parameters.free.map((p) => [p.name, p]));
  const groups = (rawGroups || parameters.free.map((p) => ({ into: null, names: [p.name] })))
    .map((g) => ({ into: g.into, names: g.names.filter((name) => byName.has(name)) }))
    .filter((g) => g.names.length);
  const maxOf = (group) => Math.min(...group.names.map((name) => denominators[name] || denominator));
  const exactOf = (group) => {
    const set = group.names.map((name) => exact[name]).filter((n) => n >= 1);
    return set.length ? Math.max(...set) : fixed ? maxOf(group) : null;
  };
  const inRange = (p, v) => (p.min === null || v >= p.min - 1e-12) && (p.max === null || v <= p.max + 1e-12);
  return (values) => {
    const own = { ...values };
    const fractions = {};
    const out = groups.map((group) => {
      const numbers = group.names.map((name) => own[name]);
      const n = exactOf(group) || bestDenominator(numbers, maxOf(group), powersOfTwo).n;
      for (const name of group.names) {
        const p = byName.get(name);
        let m = unitsOf(own[name], n);
        if (!inRange(p, m / n) && own[name] !== 0) m = inRange(p, (m + 1) / n) && m + 1 !== 0 ? m + 1 : inRange(p, (m - 1) / n) && m - 1 !== 0 ? m - 1 : m;
        own[name] = m / n;
        fractions[name] = { m, n };
      }
      return { into: group.into, names: group.names, n };
    });
    return { own, fractions, groups: out };
  };
}

/**
 * After a search on fractions: each coefficient moved by one unit (1/n)
 * up or down while that helps, never to zero nor across it. A generator of
 * batches to score, as the optimizer's: it yields `{ batch, phase, step,
 * steps }` and takes the scores back -- a batch item is the numbers (the
 * quick test) or `{ verify: numbers }` (the long one: the start and the
 * result). `own` are the numbers found (on fractions), `snapped` the
 * snapper's `{ fractions, groups }` for them. Returns `{ own, values, score,
 * fitness, fractions, groups, start }`.
 */
export function* polishSearch(parameters, { own: found, snapped, links = {}, passes = 4 } = {}) {
  const byName = new Map(parameters.free.map((p) => [p.name, p]));
  const inRange = (p, v) => (p.min === null || v >= p.min - 1e-12) && (p.max === null || v <= p.max + 1e-12);
  const own = { ...found };
  const fractions = { ...snapped.fractions };
  const resolvedOf = (numbers) => resolveCoefficients(numbers, links);
  const [startScore] = yield { batch: [{ verify: resolvedOf(own) }], phase: 'start', step: 0, steps: passes };
  let current = { score: startScore, fitness: fitnessOf(startScore) };
  for (let pass = 0; pass < passes; pass++) {
    const trials = [];
    for (const group of snapped.groups) {
      for (const name of group.names) {
        const f = fractions[name];
        if (!f || f.m === 0) continue;
        for (const dm of [-1, 1]) {
          const m = f.m + dm;
          if (m === 0 || Math.sign(m) !== Math.sign(f.m)) continue;
          if (inRange(byName.get(name), m / f.n)) trials.push({ name, m, n: f.n });
        }
      }
    }
    if (!trials.length) break;
    const scores = yield { batch: trials.map((t) => resolvedOf({ ...own, [t.name]: t.m / t.n })), phase: 'polish', step: pass + 1, steps: passes };
    let best = -1;
    for (let i = 0; i < trials.length; i++) if (fitnessOf(scores[i]) < (best < 0 ? current.fitness - 1e-9 : fitnessOf(scores[best]))) best = i;
    if (best < 0) break;
    const t = trials[best];
    own[t.name] = t.m / t.n;
    fractions[t.name] = { m: t.m, n: t.n };
    current = { score: scores[best], fitness: fitnessOf(scores[best]) };
  }
  const [finalScore] = yield { batch: [{ verify: resolvedOf(own) }], phase: 'verify', step: passes, steps: passes };
  return { own, values: resolvedOf(own), score: finalScore, fitness: fitnessOf(finalScore), fractions, groups: snapped.groups, start: startScore };
}
