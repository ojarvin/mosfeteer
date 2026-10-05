/**
 * After a coefficient search (optimize.js): how sensitive the result is to
 * each coefficient, and which coefficients barely matter and can be zero.
 *
 * Sensitivity: each free coefficient nudged by +-1% of itself, the others
 * held, and the specs measured again (the transfer functions alone: the
 * swing test's runs are too noisy to difference). A coefficient's
 * sensitivity is the largest change of any spec, in dB per 1%; a nudge
 * that loses the loop's stability is flagged, and one that misses a limit
 * noted (a best on its limit misses it at any nudge). A design that
 * hangs on one coefficient to a fraction of a percent will not survive the
 * spread of the parts that realize it.
 *
 * Pruning: a free coefficient that is small beside the others into its
 * block (coefficientGroups; a lone one beside the largest free one) costs a
 * part for little. Smallest first, each is tried at zero with the long
 * test; it stays zero if every limit still holds and the goals lose at
 * most `cost` dB. Zero is another diagram -- one path fewer -- so it is
 * offered, never forced: the editor applies it and fixes it at zero.
 *
 * Both are generators of batches to score, as the rounding search is:
 * they yield `{ batch }` (each item a request scoreRequest takes) and take
 * the scores back, so the editor can score them in worker threads.
 */

import { INFEASIBLE_SCORE, fitnessOf } from './optimize.js';
import { resolveCoefficients } from './coefficient-links.js';

export const SENSITIVITY_STEP = 0.01;
// A spec moving this much (dB) per 1% of a coefficient: a fragile design.
export const SENSITIVE_DB = 1;
// A coefficient under this fraction of its block's largest is a candidate for zero.
export const PRUNE_RATIO = 0.05;
// The most the goals may lose (dB, summed) to a coefficient set to zero.
export const PRUNE_COST = 0.5;

/** A spec's value as dB: a magnitude already is; a pole Q as 20 log Q, a
 *  radius by its distance to the unit circle (as the search ranks them). */
function specDb(spec, value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (spec.measure === 'q') return 20 * Math.log10(Math.max(value, 1e-12));
  if (spec.measure === 'radius') return -20 * Math.log10(Math.max(1 - value, 1e-12));
  return value;
}

/**
 * Each free coefficient's sensitivity at `own` (every coefficient's own
 * number). `specs`: the objective's. Yields one batch: the specs at `own`,
 * then at each nudge. Returns `[{ name, value, perPercent (dB per 1%, the
 * worst spec), spec (its index), breaks (a nudge misses a limit the start
 * met), unstable (a nudge makes a transfer function unstable) }]`, the most
 * sensitive first; a coefficient at zero is left out.
 */
export function* sensitivitySearch(parameters, specs, { own, links = {}, step = SENSITIVITY_STEP } = {}) {
  const nudges = [];
  for (const p of parameters.free) {
    const value = own[p.name];
    if (!value) continue;
    for (const sign of [1, -1]) nudges.push({ name: p.name, value, numbers: resolveCoefficients({ ...own, [p.name]: value * (1 + sign * step) }, links) });
  }
  if (!nudges.length) return [];
  const scores = yield { batch: [{ specsOnly: resolveCoefficients(own, links) }, ...nudges.map((n) => ({ specsOnly: n.numbers }))] };
  const [base, ...rest] = scores;
  const byName = new Map();
  nudges.forEach((nudge, i) => {
    const score = rest[i];
    const entry = byName.get(nudge.name) || { name: nudge.name, value: nudge.value, perPercent: 0, spec: null, breaks: false, unstable: false };
    if (score.unstable !== null && score.unstable !== undefined && (base.unstable === null || base.unstable === undefined)) entry.unstable = true;
    if (score.violation > base.violation + 0.01) entry.breaks = true;
    specs.forEach((spec, k) => {
      const before = specDb(spec, base.specs?.[k]);
      const after = specDb(spec, score.specs?.[k]);
      if (before === null || after === null) return;
      const change = Math.abs(after - before) / (step * 100);
      if (change > entry.perPercent) { entry.perPercent = change; entry.spec = k; }
    });
    byName.set(nudge.name, entry);
  });
  return [...byName.values()].sort((a, b) => Number(b.unstable) - Number(a.unstable) || b.perPercent - a.perPercent);
}

/** Whether an entry from sensitivitySearch is one to worry about: a large
 *  change, or stability lost. A limit missed at 1% off is not by itself --
 *  a best on its limit (as a search's best often is) misses it at any nudge. */
export const isSensitive = (entry) => entry.unstable || entry.perPercent >= SENSITIVE_DB;

/**
 * The free coefficients small enough to try at zero, smallest (relative)
 * first: under `ratio` of the largest in their group (`groups`, lists of
 * names; one alone is compared with the largest free coefficient).
 */
export function pruneCandidates(names, own, groups = [], ratio = PRUNE_RATIO) {
  const size = (name) => Math.abs(own[name] ?? 0);
  const largest = Math.max(0, ...names.map(size));
  const groupOf = new Map();
  for (const group of groups) for (const name of group) groupOf.set(name, group);
  const out = [];
  for (const name of names) {
    if (!size(name)) continue;
    const mates = (groupOf.get(name) || [name]).filter((other) => names.includes(other));
    const reference = mates.length > 1 ? Math.max(...mates.map(size)) : largest;
    const relative = reference > 0 ? size(name) / reference : 1;
    if (relative < ratio) out.push({ name, relative });
  }
  return out.sort((a, b) => a.relative - b.relative).map((c) => c.name);
}

/**
 * Try the candidates at zero, one at a time, from `own` whose verified
 * score is `start`. Yields `{ batch: [{ verify }] }` per candidate. Returns
 * `{ own, score, zeroed: [names] }` -- the start's when nothing could go.
 * A start that misses a limit is left as it is.
 */
export function* pruneSearch(candidates, { own, start, links = {}, cost = PRUNE_COST } = {}) {
  let current = { own: { ...own }, score: start };
  const zeroed = [];
  if (!start || fitnessOf(start) >= INFEASIBLE_SCORE) return { ...current, zeroed };
  for (const name of candidates) {
    const trial = { ...current.own, [name]: 0 };
    const [score] = yield { batch: [{ verify: resolveCoefficients(trial, links) }], name };
    if (fitnessOf(score) < INFEASIBLE_SCORE && score.goal - current.score.goal <= cost) {
      current = { own: trial, score };
      zeroed.push(name);
    }
  }
  return { ...current, zeroed };
}

/** Drive a refine generator in this thread, scoring with `objective`. */
export function runRefine(objective, search, scoreRequest) {
  let step = search.next();
  while (!step.done) step = search.next(step.value.batch.map((request) => scoreRequest(objective, request)));
  return step.value;
}
