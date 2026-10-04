/**
 * Time-domain simulation of a signal-flow diagram (the swing analysis): a
 * sine of a given amplitude into one source, every net's peak recorded --
 * how far each integrator swings, and where the loop overloads, as the
 * amplitude is swept. Unlike the transfer functions it rounds: a quantizer
 * takes Schreier's levels (`quantize`), full scale N - 1.
 *
 * The diagram runs at the coefficients' numbers. Its sampled side steps as
 * state-space (H(z) blocks in controllable form, junctions and gains solved
 * as one linear map each step, quantizers in the order their inputs need
 * them). Its continuous side, between samples, is integrated exactly:
 * x' = F x over an augmented state -- the H(s) blocks, the DAC blocks'
 * pulse, a sine oscillator, a constant -- so x(t + h) = e^{F h} x(t); each
 * DAC block takes each sample as impulses into one state of its own
 * (observable form, so the pulse's edges -- +1/s at its start, -1/s at its
 * end -- share it and it stays bounded), each edge at its delay (excess
 * loop delay included), the sampler reads just before
 * t = nT, and peaks are taken on a few sub-steps a period as well as at
 * every impulse.
 */

import { blockTransferFunction, coefficientValue, delayTermsOf, denseCoefficients, hasDelays, signalDomains, signalFlowGraph, withCoefficients } from './signal-flow.js';
import { expm } from './sampling.js';
import { evaluateExpression } from './bode.js';
import { TRANSFER_FUNCTION_TYPES, isBlockIn, parseGain, parseLevels } from '../transfer-function.js';
import { canonicalNetName } from '../model.js';
import { seededRandom } from './cmaes.js';

const JUNCTION_INPUTS = ['n', 's', 'w'];

/** Schreier's quantizer (ds_quantize): odd levels for even N, even levels
 *  (with 0) for odd N, limited to +-(N - 1). */
/**
 * Dither added at each quantizer's input (`{ shape, steps }`): 'rect'
 * uniform over (-A, A), 'tri' triangular over (-A, A), peaking at 0 (two
 * uniforms), A in quantizer steps (levels 2 apart, so A = 2 steps in
 * levels). The classic amounts: rectangular +-1/2 step makes the error's
 * mean independent of the signal; triangular +-1 step its power too. A
 * document from before steps gives `amplitude` in dBFS of full scale.
 * Returns `{ shape, amplitude (levels), steps, variance }` -- the variance,
 * in levels squared, the white error it adds beside the quantizer's 1/3:
 * A^2/3 or A^2/6 -- or null without dither.
 */
export function ditherSettings(dither, fullScale) {
  if (!dither || !['rect', 'tri'].includes(dither.shape)) return null;
  const steps = ditherSteps(dither, fullScale);
  if (!(steps > 0)) return null;
  const amplitude = 2 * steps;
  return { shape: dither.shape, amplitude, steps, variance: dither.shape === 'rect' ? amplitude ** 2 / 3 : amplitude ** 2 / 6 };
}

/** A dither's amplitude in quantizer steps (from dBFS for an older one). */
export function ditherSteps(dither, fullScale) {
  const steps = Number(dither?.steps);
  if (dither?.steps !== undefined && dither.steps !== '' && Number.isFinite(steps)) return steps;
  const db = Number(dither?.amplitude);
  return Number.isFinite(db) ? (fullScale * 10 ** (db / 20)) / 2 : NaN;
}

export function quantize(y, levels) {
  const v = levels % 2 === 0 ? 2 * Math.floor(0.5 * y) + 1 : 2 * Math.floor(0.5 * (y + 1));
  const limit = levels - 1;
  return Math.max(-limit, Math.min(limit, v));
}

function failure(code, error) {
  return { ok: false, code, error };
}

/** num/den (low power first) in controllable canonical form `{ A, B, C, D, n }`
 *  (B the last unit vector); throws when not proper. */
export function realize(num, den) {
  const trim = (list) => { const out = [...list]; while (out.length > 1 && out[out.length - 1] === 0) out.pop(); return out; };
  const d0 = trim(den);
  const n0 = trim(num);
  const lead = d0[d0.length - 1];
  const d = d0.map((v) => v / lead);
  const p = n0.map((v) => v / lead);
  const n = d.length - 1;
  if (p.length > n + 1) throw new Error('is not proper (more zeros than poles): it cannot be simulated');
  const D = p.length === n + 1 ? p[n] : 0;
  const C = Array.from({ length: n }, (_, j) => (p[j] || 0) - D * d[j]);
  const A = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i < n - 1 ? (j === i + 1 ? 1 : 0) : -d[j])));
  return { A, C, D, n };
}

/** Solve (I - G) M = H for M (Gaussian elimination, partial pivoting). */
function solveLoop(G, H) {
  const n = G.length;
  const width = H[0]?.length ?? 0;
  const a = G.map((row, i) => [...row.map((g, j) => (i === j ? 1 : 0) - g), ...H[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let r = 0; r < n; r++) {
      if (r === col || !a[r][col]) continue;
      const k = a[r][col] / a[col][col];
      for (let c = col; c < n + width; c++) a[r][c] -= k * a[col][c];
    }
  }
  return a.map((row, i) => row.slice(n).map((v) => v / a[i][i]));
}

const dot = (row, x) => {
  let sum = 0;
  for (let i = 0; i < row.length; i++) sum += row[i] * x[i];
  return sum;
};

function matVec(M, x, out) {
  for (let i = 0; i < M.length; i++) out[i] = dot(M[i], x);
  return out;
}

/**
 * Prepare a diagram for simulation. `options`: `values` (every coefficient's
 * number), `sources` (the analysis's source settings: a source set to a
 * constant holds it, the rest are zero), `input` (the source the sine
 * drives), `output` (a signal key for the output tone), `frequency` (f/fs
 * of the sine, made coherent with the window), `samples` (the window),
 * `warmup`, `subSteps`, `dither` (`{ shape: 'rect' | 'tri', steps }`, at
 * each quantizer's input, ditherSettings; each run draws the same sequence).
 * Returns `{ ok, fullScale, frequency, signals, run }`:
 * `signals` `[{ key, name, domain, role }]`, `run(amplitude)` (dBFS) gives
 * `{ peaks (per signal, over the window), tone (the output's amplitude at
 * the input frequency), overloaded }`.
 */
export function prepareSimulation(circuit, options = {}) {
  const { signals, sources, issues } = signalFlowGraph(circuit);
  if (issues.length) return failure(issues[0].code, issues[0].message);
  const values = options.values || {};
  const parts = [...circuit.components.values()];
  const samplers = parts.filter((c) => c.type === 'sampler');
  const quantizers = parts.filter((c) => c.type === 'quantizer');
  let domain;
  if (samplers.length) {
    const found = signalDomains({ circuit, signals });
    if (!found.ok) return failure(found.code, found.error);
    domain = found.domain;
  } else {
    if (parts.some((c) => isBlockIn(c, 's'))) return failure('no-clock', 'a continuous-time diagram needs a sampler to be simulated (it sets the clock)');
    domain = new Map([...signals.keys()].map((key) => [key, 'z']));
  }
  const num = (expression) => evaluateExpression(coefficientValue(String(expression).replace(/\s/g, '')), values);
  let T = 1;
  try {
    const periods = samplers.map((c) => num(parseGain(c.value || 'T')));
    if (periods.some((t) => !(t > 0))) return failure('bad-period', 'a sampler\'s period must be positive');
    if (periods.some((t) => Math.abs(t - periods[0]) > 1e-9 * periods[0])) return failure('mixed-periods', 'the samplers run at different periods: one rate is supported');
    if (periods.length) T = periods[0];
  } catch (err) {
    return failure('bad-value', err.message);
  }
  const levels = new Map();
  for (const q of quantizers) {
    try { levels.set(q.refdes, parseLevels(q.value)); } catch (err) { return failure('bad-levels', `${q.refdes}: ${err.message}`); }
  }
  const fullScale = quantizers.length ? Math.max(...[...levels.values()].map((n) => n - 1)) : 1;
  const dither = ditherSettings(options.dither, fullScale);

  // Source settings, as the analysis reads them.
  const settings = new Map(Object.entries(options.sources || {}).map(([name, value]) => [canonicalNetName(name), value]));
  const modeOf = (source) => settings.get(canonicalNetName(source.id)) ?? settings.get(canonicalNetName(source.name)) ?? settings.get(source.key);
  const realSources = sources.filter((source) => !source.quantizer);
  const driven = realSources.find((source) => source.id === options.input) || null;
  if (!driven) return failure('no-input', 'pick the source the sine drives');
  const sourceValue = new Map();
  for (const source of realSources) {
    const mode = modeOf(source);
    let constant = 0;
    if (mode && typeof mode === 'object' && 'constant' in mode) {
      try { constant = num(mode.constant); } catch { return failure('bad-constant', `${source.name}: a constant must be a number or a coefficient`); }
    }
    sourceValue.set(source.key, { driven: source === driven, constant });
  }

  const signalAt = (component, term) => [...signals.values()].find((signal) => signal.readers.some((r) => r.comp === component.refdes && r.term === term)) || null;
  const numeric = (component) => withCoefficients(blockTransferFunction(component), values);
  const gainOf = (component) => num(parseGain(component.value));
  // A multiply junction: a gain of its constant inputs on its one signal.
  const multiplyOf = (component) => {
    let gain = 1;
    const varying = [];
    for (const term of JUNCTION_INPUTS) {
      const signal = signalAt(component, term);
      if (!signal) continue;
      const source = sourceValue.get(signal.key);
      if (source && !source.driven) gain *= source.constant;
      else varying.push(signal);
    }
    if (varying.length > 1) throw new Error(`${component.refdes} multiplies two signals`);
    return { gain, signal: varying[0] || null };
  };

  const list = [...signals.values()];
  const cont = list.filter((s) => domain.get(s.key) === 's');
  const disc = list.filter((s) => domain.get(s.key) === 'z');
  const ci = new Map(cont.map((s, i) => [s.key, i]));
  const di = new Map(disc.map((s, i) => [s.key, i]));

  // ----- the continuous side: blocks and DAC pulse terms as states.
  const blocks = [];
  const terms = [];
  const dacs = [];
  let m = 0;
  try {
    for (const signal of cont) {
      const component = signal.driver && !signal.driver.source ? circuit.components.get(signal.driver.comp) : null;
      if (!isBlockIn(component, 's')) continue;
      const input = signalAt(component, 'in');
      const value = numeric(component);
      if (input && domain.get(input.key) === 'z') {
        // A DAC: each sample an impulse at each of its pulse's edges, all
        // into one state in observable form (its numerators enter through
        // B, the output is the state's last entry).
        const split = delayTermsOf(value);
        if (!split.ok) throw new Error(`${component.refdes}: ${split.error}`);
        const base = realize([0], split.den);
        const dac = { component, out: signal.key, n: base.n, A: base.A.map((row, r) => row.map((_, c) => base.A[c][r])), offset: m };
        for (const term of split.terms) {
          const model = realize(term.num, split.den);
          if (model.D || !base.n) throw new Error(`${component.refdes}: impulses would reach its output; a DAC block needs a pulse such as (1 - exp(-s*T))/s`);
          terms.push({ dac, input: input.key, delay: term.delay, B: model.C });
        }
        dacs.push(dac);
        m += base.n;
      } else {
        if (hasDelays(value)) throw new Error(`${component.refdes}: a delay on a continuous signal cannot be simulated (put it in the DAC block)`);
        const model = realize(denseCoefficients(value.numerator, 's'), denseCoefficients(value.denominator, 's'));
        blocks.push({ component, out: signal.key, input: input?.key || null, model, offset: m });
        m += model.n;
      }
    }
  } catch (err) {
    return failure('unsimulatable', err.message);
  }
  const OSC_C = m;
  const OSC_S = m + 1;
  const ONE = m + 2;
  const size = m + 3;

  const zero = (rows, cols) => Array.from({ length: rows }, () => new Array(cols).fill(0));
  // Continuous signals: Y = G Y + H X.
  const Gc = zero(cont.length, cont.length);
  const Hc = zero(cont.length, size);
  try {
    for (const [i, signal] of cont.entries()) {
      const source = sourceValue.get(signal.key);
      if (source) {
        if (source.driven) Hc[i][OSC_S] = 1;
        else Hc[i][ONE] = source.constant;
        continue;
      }
      if (!signal.driver) continue;
      const component = circuit.components.get(signal.driver.comp);
      const feed = (gain, from) => { if (from && ci.has(from.key)) Gc[i][ci.get(from.key)] += gain; };
      if (isBlockIn(component, 's')) {
        const block = blocks.find((b) => b.out === signal.key);
        if (block) {
          block.model.C.forEach((c, j) => { Hc[i][block.offset + j] += c; });
          if (block.input) feed(block.model.D, { key: block.input });
        } else {
          const dac = dacs.find((d) => d.out === signal.key);
          if (dac) Hc[i][dac.offset + dac.n - 1] += 1;
        }
      } else if (component.type === 'gain') feed(gainOf(component), signalAt(component, 'in'));
      else if (component.type === 'signal_sum') {
        for (const term of JUNCTION_INPUTS) feed(component.negativeInputs?.has(term) ? -1 : 1, signalAt(component, term));
      } else if (component.type === 'signal_multiply') {
        const { gain, signal: from } = multiplyOf(component);
        feed(gain, from);
      } else if (component.type === 'quantizer') {
        throw new Error(`${component.refdes} rounds a continuous signal: put a sampler before it`);
      }
    }
  } catch (err) {
    return failure('unsimulatable', err.message);
  }
  const Mc = solveLoop(Gc, Hc);
  if (!Mc) return failure('algebraic-loop', 'a continuous loop with no integration has a gain of exactly 1');

  // ----- the sampled side: Y = G Y + Hx x + P p, p = [samplers, sources, quantizers].
  const zblocks = [];
  let md = 0;
  try {
    for (const signal of disc) {
      const component = signal.driver && !signal.driver.source ? circuit.components.get(signal.driver.comp) : null;
      if (!isBlockIn(component, 'z')) continue;
      const value = numeric(component);
      const model = realize(denseCoefficients(value.numerator, 'z'), denseCoefficients(value.denominator, 'z'));
      zblocks.push({ component, out: signal.key, input: signalAt(component, 'in')?.key || null, model, offset: md });
      md += model.n;
    }
  } catch (err) {
    return failure('unsimulatable', `${err.message.includes(':') ? '' : 'an H(z) block '}${err.message}`);
  }
  const discreteSources = disc.filter((s) => sourceValue.has(s.key));
  const pSampler = new Map(samplers.map((c, k) => [c.refdes, k]));
  const pSource = new Map(discreteSources.map((s, k) => [s.key, samplers.length + k]));
  const pQuant = new Map(quantizers.map((c, k) => [c.refdes, samplers.length + discreteSources.length + k]));
  const pSize = samplers.length + discreteSources.length + quantizers.length;
  const Gd = zero(disc.length, disc.length);
  const Hd = zero(disc.length, md + pSize);
  try {
    for (const [i, signal] of disc.entries()) {
      if (sourceValue.has(signal.key)) { Hd[i][md + pSource.get(signal.key)] = 1; continue; }
      if (!signal.driver) continue;
      const component = circuit.components.get(signal.driver.comp);
      const feed = (gain, from) => { if (from && di.has(from.key)) Gd[i][di.get(from.key)] += gain; };
      if (isBlockIn(component, 'z')) {
        const block = zblocks.find((b) => b.out === signal.key);
        block.model.C.forEach((c, j) => { Hd[i][block.offset + j] += c; });
        if (block.input) feed(block.model.D, { key: block.input });
      } else if (component.type === 'sampler') Hd[i][md + pSampler.get(component.refdes)] = 1;
      else if (component.type === 'quantizer') Hd[i][md + pQuant.get(component.refdes)] = 1;
      else if (component.type === 'gain') feed(gainOf(component), signalAt(component, 'in'));
      else if (component.type === 'signal_sum') {
        for (const term of JUNCTION_INPUTS) feed(component.negativeInputs?.has(term) ? -1 : 1, signalAt(component, term));
      } else if (component.type === 'signal_multiply') {
        const { gain, signal: from } = multiplyOf(component);
        feed(gain, from);
      }
    }
  } catch (err) {
    return failure('unsimulatable', err.message);
  }
  const Md = solveLoop(Gd, Hd);
  if (!Md) return failure('algebraic-loop', 'a sampled loop with no delay has a gain of exactly 1');
  // Quantizers in the order their inputs need them; one that needs its own
  // output (no delay round its loop) cannot be rounded.
  const order = [];
  const pending = new Set(quantizers);
  while (pending.size) {
    const ready = [...pending].find((q) => {
      const input = signalAt(q, 'in');
      if (!input || !di.has(input.key)) return true;
      const row = Md[di.get(input.key)];
      return [...pending].every((other) => Math.abs(row[md + pQuant.get(other.refdes)]) < 1e-12);
    });
    if (!ready) return failure('delay-free-loop', `${[...pending][0].refdes} sits in a loop with no delay: its input needs its own output`);
    order.push({ refdes: ready.refdes, levels: levels.get(ready.refdes), row: signalAt(ready, 'in') && di.has(signalAt(ready, 'in').key) ? Md[di.get(signalAt(ready, 'in').key)] : null, p: md + pQuant.get(ready.refdes) });
    pending.delete(ready);
  }

  // ----- the continuous dynamics, F, and the period's segments.
  const window = Math.max(64, Math.round(options.samples || 4096));
  const warmup = Math.max(0, Math.round(options.warmup ?? window / 4));
  const cycles = Math.max(1, Math.round((options.frequency || 1 / 256) * window));
  const frequency = cycles / window;
  const omega = (2 * Math.PI * frequency) / T;
  const F = zero(size, size);
  for (const block of blocks) {
    const { A, n } = block.model;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) F[block.offset + r][block.offset + c] += A[r][c];
    if (block.input) {
      const row = Mc[ci.get(block.input)];
      for (let c = 0; c < size; c++) F[block.offset + n - 1][c] += row[c];
    }
  }
  for (const dac of dacs) {
    for (let r = 0; r < dac.n; r++) for (let c = 0; c < dac.n; c++) F[dac.offset + r][dac.offset + c] += dac.A[r][c];
  }
  F[OSC_C][OSC_S] = -omega;
  F[OSC_S][OSC_C] = omega;
  const subSteps = Math.max(1, Math.round(options.subSteps || 8));
  const offsets = new Set(Array.from({ length: subSteps }, (_, k) => (k * T) / subSteps));
  for (const term of terms) {
    let shift = Math.floor(term.delay / T + 1e-9);
    let frac = term.delay - shift * T;
    if (frac > T * (1 - 1e-9)) { shift += 1; frac = 0; }
    if (frac < T * 1e-9) frac = 0;
    term.shift = shift;
    term.frac = frac;
    offsets.add(frac);
  }
  const starts = [...offsets].sort((a, b) => a - b).filter((v, i, all) => i === 0 || v - all[i - 1] > T * 1e-9);
  const segments = starts.map((start, i) => ({
    start,
    phi: expm(F.map((row) => row.map((v) => v * ((starts[i + 1] ?? T) - start)))),
    impulses: terms.filter((term) => Math.abs(term.frac - start) < T * 1e-9),
  }));
  const maxShift = Math.max(0, ...terms.map((t) => t.shift));
  const dacInputs = [...new Set(terms.map((t) => t.input))];

  const named = (signal) => {
    const net = signal.netIds.map((id) => circuit.nets.get(id)).find((n) => n?.name);
    if (net) return net.name;
    const driver = signal.driver && !signal.driver.source ? signal.driver.comp : null;
    // An unnamed net goes by the part driving it, as math: H1 -> H_{1}.
    const tex = (refdes) => refdes.replace(/^([A-Za-z]+)_?(\d+)$/, (m, letters, digits) => `${letters}_{${digits}}`);
    return driver ? (circuit.labelOf(driver)?.text || tex(driver)) : signal.display;
  };
  const roleOf = (signal) => {
    if (sourceValue.has(signal.key)) return 'source';
    const type = signal.driver ? circuit.components.get(signal.driver.comp)?.type : null;
    if (signal.key === options.output) return 'output';
    if (quantizers.some((q) => signalAt(q, 'in')?.key === signal.key)) return 'quantizer-input';
    if (TRANSFER_FUNCTION_TYPES[type] === 'z' || (TRANSFER_FUNCTION_TYPES[type] === 's' && blocks.some((b) => b.out === signal.key))) return 'state';
    return 'other';
  };
  // A quantizer's output steps between levels, its peak jumping by nature;
  // so does anything only scaled or summed from such signals (c_1 v).
  const steppedKeys = new Set();
  for (let changed = true; changed;) {
    changed = false;
    for (const signal of [...cont, ...disc]) {
      if (steppedKeys.has(signal.key) || !signal.driver || signal.driver.source) continue;
      const part = circuit.components.get(signal.driver.comp);
      const inputs = (part.type === 'signal_sum' ? JUNCTION_INPUTS : part.type === 'gain' ? ['in'] : []).map((term) => signalAt(part, term)).filter(Boolean);
      if (part.type === 'quantizer' || (inputs.length && inputs.every((input) => steppedKeys.has(input.key)))) {
        steppedKeys.add(signal.key);
        changed = true;
      }
    }
  }
  const quantized = (signal) => steppedKeys.has(signal.key);
  const signalList = [...cont, ...disc].map((signal) => ({ key: signal.key, name: named(signal), domain: domain.get(signal.key), role: roleOf(signal), ...(quantized(signal) ? { quantized: true } : {}) }));
  const outputIndex = signalList.findIndex((s) => s.key === options.output);

  const samplerRows = samplers.map((c) => {
    const input = signalAt(c, 'in');
    return input && ci.has(input.key) ? Mc[ci.get(input.key)] : null;
  });

  /** One amplitude's run; `record` keeps the output's samples over the
   *  window, `levels` (true, or a list of signal indices) those nets'
   *  magnitudes at each sample (`magnitudes`, by index, for quantiles);
   *  `phase` (radians) where the sine starts. */
  const run = (amplitudeDb, { record = false, levels = false, phase = 0 } = {}) => {
    const recorded = record && outputIndex >= 0 ? new Float64Array(window) : null;
    const wanted = levels === true ? signalList.map((_, i) => i) : Array.isArray(levels) ? levels : [];
    const magnitudes = wanted.length ? signalList.map((_, i) => (wanted.includes(i) ? new Float64Array(window) : null)) : null;
    const leveled = magnitudes ? wanted.filter((i) => i >= 0 && i < signalList.length) : [];
    const amplitude = fullScale * 10 ** (amplitudeDb / 20);
    let X = new Float64Array(size);
    let next = new Float64Array(size);
    // The oscillator's pair is (A cos, A sin) of the sine's phase.
    if (sourceValue.get(driven.key) && domain.get(driven.key) === 's') { X[OSC_C] = amplitude * Math.cos(phase); X[OSC_S] = amplitude * Math.sin(phase); }
    X[ONE] = 1;
    let xd = new Float64Array(md);
    const p = new Float64Array(pSize);
    const state = new Float64Array(md + pSize);
    const Yc = new Float64Array(cont.length);
    const Yd = new Float64Array(disc.length);
    const history = new Map(dacInputs.map((key) => [key, new Float64Array(maxShift + 1)]));
    const peaks = new Float64Array(signalList.length);
    // Each state's peak in each half of the window: a loop running away
    // grows from one half to the next, where a stable one repeats (the
    // sine fits each half a whole number of times).
    const halves = [new Float64Array(m + md), new Float64Array(m + md)];
    let re = 0;
    let im = 0;
    const total = warmup + window;
    // The same dither sequence every run: amplitudes compare like for like.
    const random = dither ? seededRandom(0x5eed) : null;
    const ditherSample = !dither ? () => 0
      : dither.shape === 'rect' ? () => dither.amplitude * (2 * random() - 1)
      : () => dither.amplitude * (random() - random());
    // A state a thousand times full scale: the loop has run away.
    const limit = 1e3 * fullScale;
    const track = (measuring) => {
      if (!measuring) return;
      matVec(Mc, X, Yc);
      for (let i = 0; i < cont.length; i++) { const v = Math.abs(Yc[i]); if (v > peaks[i]) peaks[i] = v; }
    };
    for (let n = 0; n < total; n++) {
      const measuring = n >= warmup;
      // Just before t = nT: the samplers read.
      samplerRows.forEach((row, k) => { p[k] = row ? dot(row, X) : 0; });
      for (const [key, k] of pSource) {
        const source = sourceValue.get(key);
        p[k] = source.driven ? amplitude * Math.sin(2 * Math.PI * frequency * n + phase) : source.constant;
      }
      state.set(xd, 0);
      state.set(p, md);
      for (const q of order) {
        const y = q.row ? dot(q.row, state) : 0;
        state[q.p] = quantize(y + ditherSample(), q.levels);
      }
      matVec(Md, state, Yd);
      // The continuous signals at nT^-, and the output, for the peaks and the tone.
      matVec(Mc, X, Yc);
      if (measuring) {
        for (let i = 0; i < cont.length; i++) { const v = Math.abs(Yc[i]); if (v > peaks[i]) peaks[i] = v; }
        for (let i = 0; i < disc.length; i++) { const v = Math.abs(Yd[i]); if (v > peaks[cont.length + i]) peaks[cont.length + i] = v; }
        for (const i of leveled) magnitudes[i][n - warmup] = Math.abs(i < cont.length ? Yc[i] : Yd[i - cont.length]);
        if (outputIndex >= 0) {
          const y = outputIndex < cont.length ? Yc[outputIndex] : Yd[outputIndex - cont.length];
          if (recorded) recorded[n - warmup] = y;
          const phase = 2 * Math.PI * frequency * (n - warmup);
          re += y * Math.cos(phase);
          im -= y * Math.sin(phase);
        }
      }
      // The sampled states step; the DACs take this sample.
      const nextXd = new Float64Array(md);
      for (const block of zblocks) {
        const { A, n: order2 } = block.model;
        const u = block.input && di.has(block.input) ? Yd[di.get(block.input)] : 0;
        for (let r = 0; r < order2; r++) {
          let v = 0;
          for (let c = 0; c < order2; c++) v += A[r][c] * xd[block.offset + c];
          nextXd[block.offset + r] = v + (r === order2 - 1 ? u : 0);
        }
      }
      xd = nextXd;
      for (const [key, buffer] of history) {
        buffer.copyWithin(1, 0, buffer.length - 1);
        buffer[0] = di.has(key) ? Yd[di.get(key)] : 0;
      }
      // Through the period: impulses at their offsets, e^{F h} between.
      for (const segment of segments) {
        for (const term of segment.impulses) {
          const v = history.get(term.input)[term.shift];
          for (let j = 0; j < term.dac.n; j++) X[term.dac.offset + j] += term.B[j] * v;
        }
        if (segment.start > 0 || segment.impulses.length) track(measuring);
        matVec(segment.phi, X, next);
        [X, next] = [next, X];
      }
      if (X.some((v) => !(Math.abs(v) < limit)) || xd.some((v) => !(Math.abs(v) < limit))) {
        return { peaks: peaks.map(() => Infinity), tone: Infinity, overloaded: true };
      }
      if (measuring) {
        const half = halves[n - warmup < window / 2 ? 0 : 1];
        for (let i = 0; i < m; i++) { const v = Math.abs(X[i]); if (v > half[i]) half[i] = v; }
        for (let i = 0; i < md; i++) { const v = Math.abs(xd[i]); if (v > half[m + i]) half[m + i] = v; }
      }
    }
    for (let i = 0; i < m + md; i++) {
      if (halves[1][i] > 2 * fullScale && halves[1][i] > 2 * halves[0][i]) return { peaks: Array.from(peaks), tone: null, overloaded: true };
    }
    const tone = outputIndex >= 0 ? (2 * Math.hypot(re, im)) / window : null;
    return { peaks: Array.from(peaks), tone, overloaded: false, ...(recorded ? { samples: recorded } : {}), ...(magnitudes ? { magnitudes } : {}) };
  };

  return { ok: true, fullScale, frequency, period: T, signals: signalList, run, dither };
}

/** The amplitudes a sweep runs, in dBFS: coarse far below full scale, a
 *  quarter dB from -6 dBFS up, where loops overload. */
export function sweepAmplitudes(low = -60, high = 3) {
  const out = [];
  for (let a = low; a < -20; a += 4) out.push(a);
  for (let a = Math.max(low, -20); a < -6; a += 1) out.push(a);
  for (let i = 0; Math.max(low, -6) + i * 0.25 <= high + 1e-9; i++) out.push(Math.max(low, -6) + i * 0.25);
  return out;
}
