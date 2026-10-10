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
 *   net's peak under its limit (dBFS) -- and a limit aimed at (`targets`)
 *   is a goal as well: the net brought up to it, each dB under it a dB of
 *   goal lost.
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
import { evaluateCoefficientExpression, parseCoefficientLink, resolveCoefficients } from './coefficient-links.js';
import { createCmaes, seededRandom } from './cmaes.js';
import { POLE_MEASURES, normalizeOptimizeSetup } from './optimize-setup.js';

const LOWEST_F = 1e-4;
const NYQUIST = 0.5;
// A miss of the stability or the analysis outweighs any spec's.
const UNSTABLE = 100;
const BROKEN = 1000;
// Feasible scores are goals in dB; infeasible ones sit above them all.
const INFEASIBLE = 1e6;
export const INFEASIBLE_SCORE = INFEASIBLE;
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
 * range (`penalty` how far outside it y went, in internal units), then
 * given to `snap` when the coefficients are kept to fractions
 * (rounding.js fractionSnapper), linked ones resolved. Returns `{ own,
 * values, penalty, fractions? }`.
 */
export function pointValues(parameters, y, { values = {}, links = {}, snap = null } = {}) {
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
  if (snap) {
    const snapped = snap(own);
    return { own: snapped.own, values: resolveCoefficients(snapped.own, links), penalty, fractions: snapped.fractions };
  }
  return { own, values: resolveCoefficients(own, links), penalty };
}

const RELATIONS = ['>=', '<=', '>', '<'];

/**
 * The constraints typed for the coefficients, `c_1 >= c_2, c_2 >= 2*c_3`
 * (commas, semicolons, or lines between them; >= <= > <, each side an
 * expression of coefficients as a link is): `[{ text, left, relation,
 * right }]`. Throws, naming the one that does not read.
 */
export function parseConstraints(text) {
  return String(text || '').split(/[,;\n]/).map((part) => part.trim()).filter(Boolean).map((part) => {
    const relation = RELATIONS.find((op) => part.includes(op));
    const [leftText, rightText, extra] = relation ? part.split(relation) : [];
    if (!relation || extra !== undefined || !leftText.trim() || !rightText.trim()) throw new Error(`the constraint "${part}" is not of the form a >= b (or <=, >, <)`);
    try {
      return { text: part, left: parseCoefficientLink(leftText).ast, relation, right: parseCoefficientLink(rightText).ast };
    } catch (error) {
      throw new Error(`the constraint "${part}": ${error.message}`);
    }
  });
}

/** How far `values` miss a constraint, relative to the sides' size: 0 when kept. */
export function constraintMiss(constraint, values) {
  const left = evaluateCoefficientExpression(constraint.left, values);
  const right = evaluateCoefficientExpression(constraint.right, values);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return 1;
  const short = constraint.relation[0] === '>' ? right - left : left - right;
  const scale = Math.max(Math.abs(left), Math.abs(right), 1e-12);
  // A strict relation also misses at equality, by a hair.
  if (constraint.relation.length === 1 && short >= 0) return Math.max(short / scale, 1e-6);
  return short > 1e-12 * scale ? short / scale : 0;
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

/**
 * A transfer function's poles as numbers: `q`, the highest Q of a complex
 * pair (0.5 with none: a real pole is no resonance), and `radius`, the
 * largest |z| (null in s). A z-plane pole maps to s = ln z (per sample), so
 * Q = |s| / (2 |Re s|) -- the same measure in both planes, independent of
 * the pole's frequency, where a radius means less damping the higher the
 * frequency.
 */
export function poleMeasures(poles, z) {
  let q = 0.5;
  let radius = 0;
  for (const p of poles) {
    const r = Math.hypot(p.re, p.im);
    if (z) radius = Math.max(radius, r);
    const [sigma, omega] = z ? [Math.log(Math.max(r, 1e-300)), Math.atan2(p.im, p.re)] : [p.re, p.im];
    if (Math.abs(omega) < 1e-9 || !(sigma < 0)) continue;
    q = Math.max(q, Math.hypot(sigma, omega) / (2 * Math.abs(sigma)));
  }
  return { q, radius: z ? radius : null };
}

// The swing test: runs of this many samples at this many in-band
// frequencies, each from these phases of the sine, the worst taken. A loop
// near overload makes rare large excursions, so one finite run's peaks are
// chaotic in the coefficients' last digits; a search fits them to the runs
// it sees, and the more it sees the less it can.
const SWING_RUNS = 2;
const SWING_SAMPLES = 4096;
const SWING_PHASES = [0, 2.1];
// The search keeps each net this far (dB) under its limit (more for the
// highest peak, the noisiest measure): the best point sits on its limit.
const SWING_GUARD = { sigma3: 0.25, sigma4: 0.5, peak: 0.5 };
// ... and the loop must also hold this far (dB) above the target amplitude.
const SWING_MARGIN = 1;
// A new best is verified at length: a loop runs away rarely and slowly near
// its limit, which a short run does not live long enough to show. These
// runs (16384 samples, four phases at each frequency, two more above the
// amplitude) must all hold, and their levels are the ones reported.
const VERIFY_SAMPLES = 16384;
const VERIFY_PHASES = [0, 1.6, 3.1, 4.7];
const VERIFY_MARGIN_PHASES = [0, 3.1];
// What a limit compares with: the level |x| exceeds as rarely as a Gaussian
// exceeds +-3 sigma (0.27% of samples) or +-4 sigma (0.0063%), or the
// highest peak. The signals are not Gaussian: sigma names the rarity.
export const SWING_MEASURES = Object.freeze({ sigma3: 0.0027, sigma4: 6.334e-5, peak: 0 });

/** The level a set of magnitudes exceeds in a fraction `rarity` of them
 *  (the highest at 0). */
function levelOf(arrays, rarity) {
  let n = 0;
  for (const a of arrays) n += a.length;
  if (!n) return 0;
  if (!rarity) {
    let top = 0;
    for (const a of arrays) for (let i = 0; i < a.length; i++) if (a[i] > top) top = a[i];
    return top;
  }
  const all = new Float64Array(n);
  let at = 0;
  for (const a of arrays) { all.set(a, at); at += a.length; }
  all.sort();
  return all[Math.max(0, n - 1 - Math.floor(rarity * n))];
}

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
 * and for the swing
 * test `swingRuns` (frequencies, 2), `swingPhases` (phases of the sine at
 * each, 2), `swingSamples` (4096), `swingGuard` (dB kept under each limit,
 * by the measure), `swingMargin` (dB above the amplitude it must hold at
 * too, 1), `verifySamples` (the long test's runs, 16384).
 * Returns `{ ok, evaluate(values), verify(values) }`, each giving
 * `{ violation, goal, specs (each spec's measure, dB), swing, unstable,
 * error }`: `evaluate` the quick test a search ranks by, `verify` the long
 * one (more runs, longer, and against the limits themselves).
 */
export function prepareObjective(circuit, problem = {}) {
  const setup = normalizeOptimizeSetup(problem.setup);
  const specs = setup.specs.filter((spec) => spec.input);
  const goals = specs.filter((spec) => spec.action === 'minimize' || spec.action === 'maximize');
  if (!specs.length && !setup.swing.on) return failure('add a spec or the swing test: there is nothing to optimize for');
  let constraints;
  try { constraints = parseConstraints(setup.constraints); } catch (error) { return failure(error.message); }
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
    if (POLE_MEASURES.includes(spec.measure)) {
      if ((spec.action === 'below' || spec.action === 'above') && !Number.isFinite(spec.value)) return failure(`a limit on the poles needs its ${spec.measure === 'q' ? 'Q' : 'radius'}`);
      if (spec.measure === 'radius' && variable !== 'z') return failure('a pole radius is for a sampled result (|z|); use the pole Q for a continuous one');
      grids.push(null);
      continue;
    }
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
    targets: setup.swing.targets,
    measure: setup.swing.measure,
    rarity: SWING_MEASURES[setup.swing.measure],
    guard: problem.swingGuard ?? SWING_GUARD[setup.swing.measure],
    margin: problem.swingMargin ?? SWING_MARGIN,
  } : null;
  if (swing && !swing.input) return failure('pick the source the swing test\'s sine drives');

  /**
   * The swing test at `values`: runs at each frequency from each phase, the
   * worst taken; each limited net's level (by the measure) against its
   * limit less `guard`; the loop must hold at the amplitude, and at the
   * margin above it in the runs from `marginPhases`. Returns `{ violation,
   * swing: { overloaded, stableAt?, peaks (highest, dBFS), levels (by the
   * measure, the limited nets), runs, held, marginRuns, marginHeld }, error }`.
   */
  const swingTest = (values, { samples, phases, marginPhases, guard }) => {
    const sims = swing.frequencies.map((frequency) => prepareSimulation(circuit, { values, sources: problem.sources, input: swing.input, output: problem.output, frequency, samples, warmup: samples / 4 }));
    const broken = sims.find((sim) => !sim.ok);
    if (broken) return { error: broken.error };
    const [sim] = sims;
    const keys = Object.keys(swing.limits);
    const indices = keys.map((key) => sim.signals.findIndex((signal) => signal.key === key)).filter((i) => i >= 0);
    const runs = [];
    for (const each of sims) {
      for (const phase of phases) {
        const run = each.run(swing.amplitude, { phase, levels: indices });
        runs.push(run);
        // A run that runs away settles it: no need for the rest.
        if (run.overloaded) break;
      }
      if (runs.at(-1).overloaded) break;
    }
    const held = runs.filter((r) => !r.overloaded).length;
    const total = sims.length * phases.length;
    if (held < runs.length) {
      // How far below the target it holds: a slope toward stability.
      let stableAt = null;
      for (const drop of [3, 6, 12, 24, 48]) {
        if (!sim.run(swing.amplitude - drop).overloaded) { stableAt = swing.amplitude - drop; break; }
      }
      return { violation: stableAt === null ? 70 : 10 + (swing.amplitude - stableAt), swing: { overloaded: true, stableAt, runs: total, held } };
    }
    let violation = 0;
    let marginHeld = 0;
    for (const phase of marginPhases) if (!sim.run(swing.amplitude + swing.margin, { phase }).overloaded) marginHeld += 1;
    const margin = marginHeld === marginPhases.length;
    if (!margin) violation += 5;
    const db = (v) => (v > 0 ? 20 * Math.log10(v / sim.fullScale) : -300);
    const peaks = {};
    sim.signals.forEach((signal, i) => { peaks[signal.key] = db(Math.max(...runs.map((r) => r.peaks[i]))); });
    const levels = {};
    let goal = 0;
    for (const i of indices) {
      const key = sim.signals[i].key;
      levels[key] = db(levelOf(runs.map((r) => r.magnitudes[i]), swing.rarity));
      violation += miss(levels[key] - (swing.limits[key] - guard));
      // A limit aimed at: each dB the net stays under it is a dB of goal
      // lost (a swing scaled down for nothing costs a circuit its noise).
      if (swing.targets[key]) goal += Math.max(0, swing.limits[key] - guard - levels[key]);
    }
    return { violation, goal, margin, swing: { overloaded: false, peaks, levels, runs: total, held, marginRuns: marginPhases.length, marginHeld } };
  };

  const score = (values, long, withSwing = true) => {
    let violation = 0;
    let goal = 0;
    const out = { specs: specs.map(() => null), swing: null, unstable: null, error: null };
    // The coefficients' own relations first: a candidate breaking one is
    // infeasible, by how far it misses (1% short counts as 1 dB).
    out.broken = 0;
    for (const constraint of constraints) {
      const short = constraintMiss(constraint, values);
      if (short > 0) { violation += 1 + 100 * short; out.broken += 1; }
    }
    const numbers = new Map();
    const polesOf = new Map();
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
      polesOf.set(input, { poles: roots.poles, z });
    }
    specs.forEach((spec, i) => {
      if (POLE_MEASURES.includes(spec.measure)) {
        // The highest Q, or the largest radius, as dB of the goal or the
        // limit (radius by its distance to the unit circle, 1 - r).
        const found = polesOf.get(spec.input);
        const measures = found?.poles ? poleMeasures(found.poles, found.z) : null;
        const value = measures ? measures[spec.measure] : null;
        out.specs[i] = value;
        if (value === null) { violation += BROKEN; return; }
        const db = spec.measure === 'q' ? 20 * Math.log10(value) : -20 * Math.log10(Math.max(1 - value, 1e-12));
        const limitDb = Number.isFinite(spec.value) ? (spec.measure === 'q' ? 20 * Math.log10(spec.value) : -20 * Math.log10(Math.max(1 - spec.value, 1e-12))) : 0;
        if (spec.action === 'minimize') goal += db;
        else if (spec.action === 'maximize') goal -= db;
        else if (spec.action === 'below') violation += miss(db - limitDb);
        else violation += miss(limitDb - db);
        return;
      }
      const db = measureOf(numbers.get(spec.input), variable, grids[i], spec.measure);
      out.specs[i] = db;
      if (db === null) { violation += BROKEN; return; }
      if (spec.action === 'minimize') goal += db;
      else if (spec.action === 'maximize') goal -= db;
      else if (spec.action === 'below') violation += miss(db - spec.value);
      else violation += miss(spec.value - db);
    });
    if (swing && withSwing) {
      const tested = swingTest(values, long ? {
        samples: problem.verifySamples ?? VERIFY_SAMPLES, phases: VERIFY_PHASES, marginPhases: VERIFY_MARGIN_PHASES, guard: 0,
      } : { samples: swing.samples, phases: swing.phases, marginPhases: [0], guard: swing.guard });
      if (tested.error) return { ...out, violation: violation + BROKEN, goal, error: tested.error };
      violation += tested.violation;
      goal += tested.goal || 0;
      out.swing = tested.swing;
      if (tested.margin === false) out.margin = false;
    }
    return { ...out, violation, goal, ...(long ? { verified: true } : {}) };
  };
  // The quick test ranks a search's candidates; the long one verifies a
  // new best and is what is reported.
  // `measure`: the specs alone, no swing test -- deterministic, for sensitivities.
  return { ok: true, evaluate: (values) => score(values, false), verify: (values) => score(values, true), measure: (values) => score(values, false, false), goals: goals.length + (swing ? Object.keys(swing.targets).length : 0), specs, swing };
}

/**
 * The search over `parameters` (optimizationParameters): `ask()` gives the
 * next candidates `[{ y, own, values, penalty, request }]` (the start point
 * first), `tell(scores)` takes the scores of their `request`s in order -- a
 * request is the numbers, for the quick test, or `{ verify: numbers }`, for
 * the long one. CMA-ES, restarted from the best point with twice the
 * population whenever a run settles, until `evaluations` are spent; with
 * `verify`, each candidate that beats every one before it in the quick test
 * is verified before it can be the best, so `best` is always verified (a
 * short run's luck cannot win). `stopEarly` (a run with no goals) ends it at
 * the first best that meets every limit. `best`: `{ y, own, values, score,
 * fitness, quick (its quick score) }`; `start` the start's score. With
 * `snap` (rounding.js fractionSnapper) every candidate is snapped to
 * fractions before it is scored, so the search weighs only those.
 */
export function createOptimizer(parameters, { values = {}, links = {}, evaluations = 3000, seed = 1, sigma = 0.4, stopEarly = false, verify = false, snap = null } = {}) {
  const n = parameters.free.length;
  const random = seededRandom(seed);
  let lambda = 4 + Math.floor(3 * Math.log(Math.max(n, 1)));
  let cma = n ? createCmaes({ mean: new Array(n).fill(0), sigma, lambda, random }) : null;
  let spent = 0;
  let restarts = 0;
  let best = null;
  let leader = null; // the best candidate by the quick test
  let start = null;
  let pending = null;
  let started = false;
  let exhausted = !n;
  let done = !n;
  let verified = 0;
  const queue = [];
  const point = (y) => ({ y, ...pointValues(parameters, y, { values, links, snap }) });

  const ask = () => {
    if (done) return [];
    if (queue.length) {
      const list = queue.splice(0, 2);
      pending = { verify: list };
      return list.map((c) => ({ ...c, request: { verify: c.values } }));
    }
    const ys = cma.ask();
    pending = { ys, start: !started };
    const list = ys.map(point);
    if (!started) list.unshift({ ...point(new Array(n).fill(0)), isStart: true });
    started = true;
    return list.map((c) => ({ ...c, request: c.values }));
  };

  const finish = () => {
    if (spent >= evaluations) exhausted = true;
    if (stopEarly && best && best.fitness < INFEASIBLE) { exhausted = true; queue.length = 0; }
    done = exhausted && !queue.length;
  };

  const tell = (scores) => {
    if (!pending) return;
    if (pending.verify) {
      pending.verify.forEach((c, i) => {
        verified += 1;
        if (c.isStart) start = scores[i];
        const fitness = fitnessOf(scores[i], c.penalty);
        if (!best || fitness < best.fitness) best = { ...c, score: scores[i], fitness };
      });
      pending = null;
      finish();
      return;
    }
    let list = scores;
    const candidates = pending.ys.map(point);
    const entrants = [];
    if (pending.start) {
      entrants.push({ candidate: { ...point(new Array(n).fill(0)), isStart: true }, score: scores[0] });
      if (!verify) start = scores[0];
      list = scores.slice(1);
    }
    spent += scores.length;
    const fitness = candidates.map((c, i) => fitnessOf(list[i], c.penalty));
    candidates.forEach((c, i) => entrants.push({ candidate: c, score: list[i], fitness: fitness[i] }));
    cma.tell(pending.ys, fitness);
    pending = null;
    // Without verifying, the best by the quick test; with it, the start is
    // verified (it is what a result is compared with), and the generation's
    // leader when it beats every candidate before it.
    let leading = null;
    for (const entry of entrants) {
      const f = entry.fitness ?? fitnessOf(entry.score, entry.candidate.penalty);
      if (!verify) {
        if (!best || f < best.fitness) best = { ...entry.candidate, score: entry.score, fitness: f };
        continue;
      }
      if (entry.candidate.isStart) queue.push({ ...entry.candidate, quick: entry.score });
      if (!leading || f < leading.fitness) leading = { ...entry.candidate, quick: entry.score, fitness: f };
    }
    if (verify && leading && (!leader || leading.fitness < leader.fitness)) {
      leader = leading;
      if (!leading.isStart) queue.push(leading);
    }
    if (cma.stopReason()) {
      // A settled run: again from the best point, with a wider population.
      restarts += 1;
      lambda *= 2;
      const from = best || leader;
      cma = createCmaes({ mean: from ? [...from.y] : new Array(n).fill(0), sigma, lambda, random });
    }
    finish();
  };

  return {
    ask,
    tell,
    get best() { return best; },
    get start() { return start; },
    get done() { return done; },
    stop() { done = true; },
    get evaluations() { return spent; },
    get verified() { return verified; },
    get budget() { return evaluations; },
    get restarts() { return restarts; },
    get generation() { return cma?.generation ?? 0; },
  };
}

/** A request's score: the quick test, the long one for `{ verify }`, or
 *  the specs alone for `{ specsOnly }`. */
export const scoreRequest = (objective, request) => (request && request.verify ? objective.verify(request.verify)
  : request && request.specsOnly ? objective.measure(request.specsOnly) : objective.evaluate(request));

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
    verify: options.verify ?? !!objective.swing,
    snap: options.snap,
  });
  while (!optimizer.done) {
    const batch = optimizer.ask();
    optimizer.tell(batch.map((candidate) => scoreRequest(objective, candidate.request)));
    options.onGeneration?.(optimizer);
  }
  return { ok: true, best: optimizer.best, feasible: isFeasible(optimizer.best), parameters, objective, evaluations: optimizer.evaluations };
}
