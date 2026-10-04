/**
 * Coefficient optimization for a signal-flow diagram: the free
 * coefficients searched (CMA-ES, cmaes.js) for the best goal that meets
 * every limit. Topology-free -- any diagram the analysis solves -- so the
 * same specs serve a delta-sigma loop filter and an ordinary filter:
 *
 * - band specs: a transfer function's magnitude over a band (the signal
 *   band, outside it, every frequency, or f1 to f2 in f/fs), measured as
 *   its average power, its peak, or its lowest point, in dB, either as a
 *   goal (minimize, maximize) or a limit (keep below, keep above);
 * - the swing test: the diagram simulated (simulate.js) with a sine of a
 *   given amplitude into one source, which must not run away, each limited
 *   net's peak under its limit (dBFS).
 *
 * Every transfer function a spec reads must be stable (poles inside the
 * unit circle, or in the left half plane). Candidates are ranked by
 * feasibility first: one that meets every limit beats any that misses one,
 * among those that miss the smaller total miss wins, and only feasible ones
 * are ranked by their goals (the sum of each goal in dB, signed). Fixed
 * coefficients keep their numbers and linked ones follow their links.
 *
 * `prepareObjective` scores a set of numbers and runs anywhere (the editor
 * hands it to worker threads); `createOptimizer` is the search, asked for
 * candidates and told their scores; `runOptimization` puts the two together
 * in one thread.
 */

import { analyzeSignalFlow, bandEdges, diagramSymbols, numericRootsOf, responseAt, timingSymbols, withCoefficients } from './signal-flow.js';
import { prepareSimulation } from './simulate.js';
import { resolveCoefficients } from './coefficient-links.js';
import { createCmaes, seededRandom } from './cmaes.js';
import { normalizeOptimizeSetup } from './optimize-setup.js';

const LOWEST_F = 1e-4;
const NYQUIST = 0.5;
// A miss of the stability or the analysis outweighs any spec's.
const UNSTABLE = 100;
const BROKEN = 1000;
// Feasible scores are goals in dB; infeasible ones sit above them all.
const INFEASIBLE = 1e6;
// A limit missed by less than this (dB) is met: a best point on its limit
// stays feasible when its numbers are written to four digits.
const SLACK = 0.01;
const miss = (excess) => (excess > SLACK ? excess : 0);

function failure(error) {
  return { ok: false, error };
}

/**
 * The coefficients the search moves: every one the diagram names that is
 * neither linked nor fixed (the timing -- samplers' periods, delays -- is
 * fixed unless set free). Each is `{ name, start, log, min, max, scale }`:
 * a coefficient that is not zero moves on a log scale, keeping its sign
 * (0.01 and 1 are as easy to reach from 0.1), a zero one linearly.
 */
export function optimizationParameters(circuit, { values = {}, links = {}, setup: rawSetup } = {}) {
  const setup = normalizeOptimizeSetup(rawSetup);
  const timing = new Set(timingSymbols(circuit));
  const free = [];
  const fixed = [];
  const linked = [];
  for (const name of diagramSymbols(circuit)) {
    if (Object.hasOwn(links, name)) { linked.push(name); continue; }
    const entry = setup.coefficients[name] || {};
    const isFixed = entry.fixed ?? timing.has(name);
    if (isFixed) { fixed.push(name); continue; }
    const start = Number.isFinite(values[name]) ? values[name] : 1;
    const min = entry.min ?? null;
    const max = entry.max ?? null;
    // A range across zero, or a start at zero, is searched linearly.
    const log = start !== 0 && !(min !== null && max !== null && min < 0 && max > 0) && !(start > 0 && max !== null && max <= 0) && !(start < 0 && min !== null && min >= 0);
    const scale = log ? 1 : min !== null && max !== null && max > min ? (max - min) / 4 : Math.max(Math.abs(start), 0.1);
    free.push({ name, start, log, min, max, scale });
  }
  return { free, fixed, linked };
}

/** A parameter's number at internal coordinate y. */
const valueAt = (p, y) => (p.log ? Math.sign(p.start) * Math.abs(p.start) * Math.exp(y) : p.start + y * p.scale);
const coordinateOf = (p, v) => (p.log ? Math.log(Math.abs(v) / Math.abs(p.start)) : (v - p.start) / p.scale);

/**
 * The search point y as numbers: each free coefficient clamped to its
 * range (`penalty` how far outside it y went, in internal units), linked
 * ones resolved. Returns `{ own, values, penalty }`.
 */
export function pointValues(parameters, y, { values = {}, links = {} } = {}) {
  const own = { ...values };
  let penalty = 0;
  parameters.free.forEach((p, i) => {
    let v = valueAt(p, y[i]);
    // A log coefficient keeps its sign, so only a bound on its side holds.
    const lower = p.min !== null && (!p.log || Math.sign(p.min) === Math.sign(p.start)) ? p.min : null;
    const upper = p.max !== null && (!p.log || Math.sign(p.max) === Math.sign(p.start)) ? p.max : null;
    const clamped = Math.min(upper ?? Infinity, Math.max(lower ?? -Infinity, v));
    if (clamped !== v) {
      penalty += Math.abs(coordinateOf(p, clamped) - y[i]);
      v = clamped;
    }
    own[p.name] = v;
  });
  return { own, values: resolveCoefficients(own, links), penalty };
}

/** A candidate's rank: feasible ones by their goal, the rest above them all. */
export function fitnessOf(score, penalty = 0) {
  const miss = score.violation + 10 * penalty;
  return miss > 0 ? INFEASIBLE + miss : score.goal;
}

/** A band spec's intervals in f/fs, or null when it has none. */
export function specIntervals(spec, band) {
  const edges = bandEdges(band);
  const signal = edges.length === 2 ? [edges[0], edges[1]] : edges.length === 1 ? [0, edges[0]] : null;
  switch (spec.band) {
    case 'signal': return signal ? [signal] : null;
    case 'outside': {
      if (!signal) return null;
      return [[LOWEST_F, signal[0]], [signal[1], NYQUIST]].filter(([a, b]) => b > a);
    }
    case 'all': return [[LOWEST_F, NYQUIST]];
    case 'custom': {
      const f1 = Number(spec.f1);
      const f2 = Number(spec.f2);
      return f2 > f1 && f1 >= 0 ? [[f1, f2]] : null;
    }
    default: return null;
  }
}

/** Frequencies to read a band at: midpoints of an even grid (for the
 *  average, which integrates over f), and for the extremes a log grid as
 *  well, so a narrow notch or peak near DC is not missed. */
function bandGrid(intervals, measure) {
  const even = [];
  const all = [];
  for (const [a, b] of intervals) {
    const count = 256;
    const h = (b - a) / count;
    for (let i = 0; i < count; i++) even.push(a + (i + 0.5) * h);
    if (measure !== 'average') {
      const low = Math.max(a, LOWEST_F);
      if (b > low) {
        const steps = Math.max(8, Math.ceil(Math.log10(b / low) * 60));
        for (let i = 0; i <= steps; i++) all.push(low * (b / low) ** (i / steps));
      }
    }
  }
  return measure === 'average' ? even : [...even, ...all];
}

/** A spec's measure of |H| over its grid, in dB. */
function measureOf(value, variable, grid, measure) {
  let sum = 0;
  let peak = 0;
  let lowest = Infinity;
  for (const f of grid) {
    const h = responseAt(value, variable, f);
    if (!h || !h.every(Number.isFinite)) return null;
    const power = h[0] * h[0] + h[1] * h[1];
    sum += power;
    if (power > peak) peak = power;
    if (power < lowest) lowest = power;
  }
  const power = measure === 'average' ? sum / grid.length : measure === 'peak' ? peak : lowest;
  return 10 * Math.log10(Math.max(power, 1e-30));
}

// The swing test: runs of this many samples at this many in-band
// frequencies, each from these phases of the sine, the worst taken. A loop
// near overload makes rare large excursions, so one finite run's peaks are
// chaotic in the coefficients' last digits; a search fits them to the runs
// it sees, and the more it sees the less it can.
const SWING_RUNS = 2;
const SWING_SAMPLES = 4096;
const SWING_PHASES = [0, 2.1];
// The search keeps each net this far (dB) under its limit: a simulated
// peak jitters with the coefficients' last digits, and the best point sits
// on its limit. Its peaks are reported as they are.
const SWING_GUARD = 0.5;
// ... and the loop must also hold this far (dB) above the target amplitude:
// a best point on the edge of running away falls off it with its last digits.
const SWING_MARGIN = 1;

/** The swing test's frequencies: the one set, and others in the band
 *  (halfway from it to the farther band edge, or at 1.37 times it). */
export function swingTestFrequencies(first, band, count = SWING_RUNS) {
  const out = [first];
  const edges = bandEdges(band);
  const [low, high] = edges.length === 2 ? edges : edges.length === 1 ? [0, edges[0]] : [null, null];
  while (out.length < count) {
    const last = out[out.length - 1];
    const next = low === null ? Math.min(0.49, last * 1.37) : last < (low + high) / 2 ? last + (high - last) / 2 : last - (last - low) / 2;
    out.push(next);
  }
  return out;
}

/** The swing test's sine frequency: the one set, else the band's middle. */
export function swingTestFrequency(swing, band) {
  const text = String(swing.frequency || '').trim();
  const match = text.match(/^(\d+(?:\.\d*)?)\s*\/\s*(\d+(?:\.\d*)?)$/);
  const set = match ? Number(match[1]) / Number(match[2]) : Number(text);
  if (set > 0 && set < 0.5) return set;
  const edges = bandEdges(band);
  if (edges.length === 2) return (edges[0] + edges[1]) / 2;
  if (edges.length === 1) return edges[0] / 2;
  return 1 / 256;
}

/**
 * Prepare to score sets of numbers. `problem`: `output`, `sources` (the
 * analysis's settings), `band` (`{ f0, bw }`), `values` (every coefficient's
 * number, for the sampled analysis to start from), `setup` (optimize-setup.js),
 * `dither` (the swing test's, as simulate.js takes it), and for the swing
 * test `swingRuns` (frequencies, 2), `swingPhases` (phases of the sine at
 * each, 2), `swingSamples` (4096), `swingGuard` (dB kept under each limit,
 * 0.5), `swingMargin` (dB above the amplitude it must hold at too, 1).
 * Returns `{ ok, evaluate(values) }`, `evaluate` giving `{ violation, goal,
 * specs (each spec's measure, dB), swing, unstable, error }`.
 */
export function prepareObjective(circuit, problem = {}) {
  const setup = normalizeOptimizeSetup(problem.setup);
  const specs = setup.specs.filter((spec) => spec.input);
  const goals = specs.filter((spec) => spec.action === 'minimize' || spec.action === 'maximize');
  if (!specs.length && !setup.swing.on) return failure('add a spec or the swing test: there is nothing to optimize for');
  const inputs = [...new Set(specs.map((spec) => spec.input))];
  let entries = new Map();
  let variable = 'z';
  if (inputs.length) {
    const sources = { ...(problem.sources || {}) };
    for (const input of inputs) sources[input] = 'input';
    const result = analyzeSignalFlow(circuit, { output: problem.output, sources, values: problem.values || {} });
    if (!result.ok) return failure(result.error);
    variable = result.variable;
    entries = new Map(result.entries.map((entry) => [entry.input, entry]));
    const missing = inputs.find((input) => !entries.has(input));
    if (missing) return failure(`no transfer function from ${missing} to the output`);
  }
  const grids = [];
  for (const spec of specs) {
    const intervals = specIntervals(spec, problem.band);
    if (!intervals?.length) return failure(spec.band === 'custom' ? 'a spec\'s band needs f1 < f2' : 'set the signal band (bw, and f0 for a band-pass signal) on the graph for the specs that read it');
    if ((spec.action === 'below' || spec.action === 'above') && !Number.isFinite(spec.value)) return failure('a limit spec needs its value in dB');
    grids.push(bandGrid(intervals, spec.measure));
  }
  const swing = setup.swing.on ? {
    amplitude: setup.swing.amplitude,
    input: setup.swing.input,
    frequencies: swingTestFrequencies(swingTestFrequency(setup.swing, problem.band), problem.band, problem.swingRuns ?? SWING_RUNS),
    samples: problem.swingSamples ?? SWING_SAMPLES,
    phases: SWING_PHASES.slice(0, problem.swingPhases ?? SWING_PHASES.length),
    limits: setup.swing.limits,
  } : null;
  if (swing && !swing.input) return failure('pick the source the swing test\'s sine drives');

  const evaluate = (values) => {
    let violation = 0;
    let goal = 0;
    const out = { specs: specs.map(() => null), swing: null, unstable: null, error: null };
    const numbers = new Map();
    for (const input of inputs) {
      let numeric = null;
      try { numeric = withCoefficients(entries.get(input).value, values); } catch { numeric = null; }
      if (!numeric) return { ...out, violation: BROKEN, goal: 0, error: `no numbers for the transfer function from ${input}` };
      // The loop must be stable: a magnitude means nothing otherwise.
      const roots = numericRootsOf(numeric.kind === 'mixed' ? numeric.terms[0]?.z : numeric);
      const z = numeric.kind === 'mixed' || variable === 'z';
      const worst = roots.poles?.length ? Math.max(...roots.poles.map((p) => (z ? Math.hypot(p.re, p.im) - 1 : p.re))) : -Infinity;
      if (worst >= -1e-9) {
        out.unstable = z ? worst + 1 : worst;
        return { ...out, violation: UNSTABLE + 100 * Math.max(worst, 0), goal: 0 };
      }
      numbers.set(input, numeric);
    }
    specs.forEach((spec, i) => {
      const db = measureOf(numbers.get(spec.input), variable, grids[i], spec.measure);
      out.specs[i] = db;
      if (db === null) { violation += BROKEN; return; }
      if (spec.action === 'minimize') goal += db;
      else if (spec.action === 'maximize') goal -= db;
      else if (spec.action === 'below') violation += miss(db - spec.value);
      else violation += miss(spec.value - db);
    });
    if (swing) {
      // The worst of a few runs: one run's peaks are chaotic in the
      // coefficients, and a search would fit them to it.
      const sims = swing.frequencies.map((frequency) => prepareSimulation(circuit, { values, sources: problem.sources, input: swing.input, output: problem.output, frequency, samples: swing.samples, warmup: swing.samples / 4, dither: problem.dither }));
      const broken = sims.find((sim) => !sim.ok);
      if (broken) return { ...out, violation: violation + BROKEN, goal, error: broken.error };
      const [sim] = sims;
      const runs = sims.flatMap((each) => swing.phases.map((phase) => each.run(swing.amplitude, { phase })));
      const run = runs.find((r) => r.overloaded) || { overloaded: false, peaks: runs[0].peaks.map((_, i) => Math.max(...runs.map((r) => r.peaks[i]))) };
      const margin = problem.swingMargin ?? SWING_MARGIN;
      // Holding at the target, it must hold a little above it too.
      if (!run.overloaded && margin > 0 && sim.run(swing.amplitude + margin).overloaded) {
        out.margin = false;
        violation += 5;
      }
      if (run.overloaded) {
        // How far below the target it holds: a slope toward stability.
        let stableAt = null;
        for (const drop of [3, 6, 12, 24, 48]) {
          if (!sim.run(swing.amplitude - drop).overloaded) { stableAt = swing.amplitude - drop; break; }
        }
        out.swing = { overloaded: true, stableAt };
        violation += stableAt === null ? 70 : 10 + (swing.amplitude - stableAt);
      } else {
        const peaks = {};
        sim.signals.forEach((signal, i) => { peaks[signal.key] = run.peaks[i] > 0 ? 20 * Math.log10(run.peaks[i] / sim.fullScale) : -300; });
        for (const [key, limit] of Object.entries(swing.limits)) {
          if (Object.hasOwn(peaks, key)) violation += miss(peaks[key] - (limit - (problem.swingGuard ?? SWING_GUARD)));
        }
        out.swing = { overloaded: false, peaks };
      }
    }
    return { ...out, violation, goal };
  };
  return { ok: true, evaluate, goals: goals.length, specs, swing };
}

/**
 * The search over `parameters` (optimizationParameters): `ask()` gives the
 * next candidates `[{ y, own, values, penalty }]` (the start point first),
 * `tell(scores)` takes their scores in order. CMA-ES, restarted from the
 * best point with twice the population whenever a run settles, until
 * `evaluations` are spent; `stopEarly` (a run with no goals) ends it at
 * the first candidate that meets every limit. `best` is the best so far:
 * `{ y, own, values, score, fitness }`.
 */
export function createOptimizer(parameters, { values = {}, links = {}, evaluations = 3000, seed = 1, sigma = 0.4, stopEarly = false } = {}) {
  const n = parameters.free.length;
  const random = seededRandom(seed);
  let lambda = 4 + Math.floor(3 * Math.log(Math.max(n, 1)));
  let cma = n ? createCmaes({ mean: new Array(n).fill(0), sigma, lambda, random }) : null;
  let spent = 0;
  let restarts = 0;
  let best = null;
  let pending = null;
  let started = false;
  let done = !n;
  const point = (y) => ({ y, ...pointValues(parameters, y, { values, links }) });

  const ask = () => {
    if (done) return [];
    const ys = cma.ask();
    pending = { ys, start: !started };
    const list = ys.map(point);
    if (!started) list.unshift(point(new Array(n).fill(0)));
    started = true;
    return list;
  };

  const tell = (scores) => {
    if (!pending) return;
    let list = scores;
    const candidates = pending.ys.map(point);
    if (pending.start) {
      consider(point(new Array(n).fill(0)), scores[0]);
      list = scores.slice(1);
    }
    spent += scores.length;
    const fitness = candidates.map((c, i) => fitnessOf(list[i], c.penalty));
    candidates.forEach((c, i) => consider(c, list[i], fitness[i]));
    cma.tell(pending.ys, fitness);
    pending = null;
    if (spent >= evaluations || (stopEarly && best && best.fitness < INFEASIBLE)) { done = true; return; }
    if (cma.stopReason()) {
      // A settled run: again from the best point, with a wider population.
      restarts += 1;
      lambda *= 2;
      cma = createCmaes({ mean: best ? [...best.y] : new Array(n).fill(0), sigma, lambda, random });
    }
  };

  function consider(candidate, score, fitness = fitnessOf(score, candidate.penalty)) {
    if (!best || fitness < best.fitness) best = { ...candidate, score, fitness };
  }

  return {
    ask,
    tell,
    get best() { return best; },
    get done() { return done; },
    stop() { done = true; },
    get evaluations() { return spent; },
    get budget() { return evaluations; },
    get restarts() { return restarts; },
    get generation() { return cma?.generation ?? 0; },
  };
}

/** Whether a best candidate meets every limit. */
export const isFeasible = (best) => !!best && best.fitness < INFEASIBLE;

/**
 * The whole search in this thread: `problem` as for prepareObjective plus
 * `links`, `options` as for createOptimizer (and `onGeneration(optimizer)`).
 * Returns `{ ok, best, parameters, objective, evaluations }`.
 */
export function runOptimization(circuit, problem, options = {}) {
  const parameters = optimizationParameters(circuit, { values: problem.ownValues || problem.values, links: problem.links, setup: problem.setup });
  if (!parameters.free.length) return failure('no coefficient is free to optimize: every one is fixed or linked');
  const objective = prepareObjective(circuit, problem);
  if (!objective.ok) return objective;
  const setup = normalizeOptimizeSetup(problem.setup);
  const optimizer = createOptimizer(parameters, {
    values: problem.ownValues || problem.values,
    links: problem.links,
    evaluations: options.evaluations ?? setup.evaluations,
    seed: options.seed,
    sigma: options.sigma,
    stopEarly: !objective.goals,
  });
  while (!optimizer.done) {
    const batch = optimizer.ask();
    optimizer.tell(batch.map((candidate) => objective.evaluate(candidate.values)));
    options.onGeneration?.(optimizer);
  }
  return { ok: true, best: optimizer.best, feasible: isFeasible(optimizer.best), parameters, objective, evaluations: optimizer.evaluations };
}
