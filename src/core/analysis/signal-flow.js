/**
 * Signal-flow analysis: transfer functions of a block diagram drawn from
 * transfer-function blocks (`tf_s`, `tf_z`), sum and multiply junctions, and
 * ports. Each wire is one signal, driven by at most one output: a block's
 * `out` or a junction's `e`. A signal nothing drives -- a named wire, or an
 * input port's -- is a source. Every source is set to `input` (a transfer
 * function is derived from it), `zero`, or a `constant`; one exact symbolic
 * solve then gives each input's transfer function to the chosen output.
 *
 * The algebra is the small-signal engine's (rational.js, solve.js): exact,
 * with symbolic coefficients (`k`, `a_1`, `w_0`), so feedback loops need no
 * special handling. A multiply is linear only when all but one of its inputs
 * are constants (a source set to `constant` or `zero`, wired straight to it);
 * two signals meeting there have no transfer function and are refused, as
 * are a loop mixing s and z, a doubly driven signal, and any other part on a
 * signal wire. Nothing is guessed.
 */

import { ONE, add, integer, keyOf, multiply, negate, polynomialCoefficients, power, rational, rationalAdd, rationalDivide, rationalFunction, rationalMultiply, substitute, substituteRational, symbol } from './rational.js';
import { createRationalOps } from './algebra-ops.js';
import { cancelCommonPolynomialFactor } from './polynomial-gcd.js';
import { renderExpression } from './present.js';
import { bodeSketch, evaluateExpression, expressionSymbols, polynomialRoots } from './bode.js';
import { TRANSFER_FUNCTION_TYPES, isBlockIn, parseGain, readTransferFunction } from '../transfer-function.js';
import { canonicalNetName } from '../model.js';
import { samplePath } from './sampling.js';

const JUNCTIONS = new Set(['signal_sum', 'signal_multiply', 'gain']);
const JUNCTION_INPUTS = ['n', 's', 'w'];
const SOURCE_TYPES = new Set(['input']);
// Parts that may sit on a signal wire without taking part in it.
const PASSIVE_TYPES = new Set(['solder', 'output', 'port', 'inputoutput']);

// Parts whose output is in their input's domain (s or z).
const PASS_THROUGH = new Set([...JUNCTIONS, 'quantizer']);

function isSignalPart(component) {
  return PASS_THROUGH.has(component.type) || Object.hasOwn(TRANSFER_FUNCTION_TYPES, component.type) || component.type === 'sampler';
}

/** A quantizer's error source: a gain of 1 plus this, in the linear model. */
export const quantizerErrorKey = (refdes) => `quantizer:${refdes}`;

/** Whether a drawing has any signal-flow part (the analysis mode it opens in). */
export function hasSignalFlow(circuit) {
  return [...circuit.components.values()].some(isSignalPart);
}

// ----- the signal graph ---------------------------------------------------------------

function signalKey(net) {
  const name = canonicalNetName(net.name || '');
  return name ? `name:${name}` : `net:${net.id}`;
}

/**
 * The drawing's signals: `{ signals, sources, issues }`. A signal is
 * `{ key, name, display, netIds, driver, readers }` (driver and readers are
 * `{ comp, term }`); sources are the signals nothing in the diagram drives,
 * `{ id, key, name }`: an input port's (`id` its refdes) or any other wire
 * that is read (`id` its name). Only wires touching a signal-flow part or an
 * input port count.
 */
export function signalFlowGraph(circuit) {
  const signals = new Map();
  const issues = [];
  const signalOf = (net) => {
    const key = signalKey(net);
    let signal = signals.get(key);
    if (!signal) {
      signal = { key, name: net.name || net.id, display: net.name || net.id, netIds: [], drivers: [], readers: [], others: [] };
      signals.set(key, signal);
    }
    signal.netIds.push(net.id);
    return signal;
  };
  const relevant = (net) => net.terminals.some(({ comp }) => {
    const component = circuit.components.get(comp);
    return component && (isSignalPart(component) || SOURCE_TYPES.has(component.type));
  });
  for (const net of circuit.nets.values()) {
    if (!relevant(net)) continue;
    const signal = signalOf(net);
    for (const terminal of net.terminals) {
      const component = circuit.components.get(terminal.comp);
      if (!component) continue;
      const def = component.terminalDefs.find((t) => t.name === terminal.term);
      if (SOURCE_TYPES.has(component.type)) signal.drivers.push({ ...terminal, source: true });
      else if (isSignalPart(component)) {
        if (def?.signalRole === 'output') signal.drivers.push({ ...terminal });
        else signal.readers.push({ ...terminal });
      } else if (!PASSIVE_TYPES.has(component.type)) signal.others.push(terminal.comp);
    }
  }
  const sources = [];
  for (const signal of signals.values()) {
    const others = [...new Set(signal.others)];
    if (others.length) issues.push({ code: 'not-a-signal-part', message: `${others.join(', ')} on signal ${signal.display} is not a signal-flow part (only transfer functions, sum and multiply junctions, and ports are)`, refs: others });
    if (signal.drivers.length > 1) issues.push({ code: 'two-drivers', message: `signal ${signal.display} is driven by ${signal.drivers.map((d) => `${d.comp}.${d.term}`).join(' and ')}: a signal has one driver`, refs: signal.drivers.map((d) => d.comp) });
    signal.driver = signal.drivers.length === 1 ? signal.drivers[0] : null;
    // A source: an input port, or a wire that is read but nothing drives.
    const port = signal.drivers.find((driver) => driver.source);
    if (port) sources.push({ id: port.comp, key: signal.key, name: signal.display });
    else if (!signal.drivers.length && signal.readers.length) sources.push({ id: signal.display, key: signal.key, name: signal.display });
    delete signal.drivers;
    delete signal.others;
  }
  // Each quantizer adds its error, E, as a source of its own.
  for (const component of circuit.components.values()) {
    if (component.type === 'quantizer') sources.push({ id: component.refdes, key: quantizerErrorKey(component.refdes), name: `E_{${component.refdes}}`, quantizer: true });
  }
  sources.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { signals, sources, issues };
}

// ----- coefficients -------------------------------------------------------------------

/** An exact number from a decimal: 0.5 -> 1/2, 3.5e-3 -> 7/2000. */
function exactDecimal(text) {
  const match = text.match(/^(\d*)(?:\.(\d*))?(?:e([-+]?\d+))?$/i);
  const digits = `${match[1] || ''}${match[2] || ''}` || '0';
  const exponent = Number(match[3] || 0) - (match[2] || '').length;
  return exponent >= 0 ? integer(BigInt(digits) * 10n ** BigInt(exponent)) : rational(BigInt(digits), 10n ** BigInt(-exponent));
}

function factor(text) {
  if (/^(\d|\.\d)/.test(text)) return exactDecimal(text);
  // K_{p} and K_p name the same symbol.
  return symbol(text.replace(/[{}]/g, ''));
}

/** A coefficient token as an exact expression: `-2*g_m/C`. */
export function coefficientValue(token) {
  const negative = token.startsWith('-');
  const body = token.replace(/^[-+]/, '');
  const [top, ...below] = body.split('/');
  let value = multiply(...top.split('*').map(factor));
  for (const part of below) value = multiply(value, power(multiply(...part.split('*').map(factor)), -1));
  return negative ? negate(value) : value;
}

// ----- delays -------------------------------------------------------------------------

// A delay e^{-sT} is a symbol of its own in the exact algebra, named by its
// TeX so equations draw it as written; this registry keeps each name's delay
// T (an exact expression free of s) for evaluating it numerically. A name
// always means the same delay, so the registry only grows.
const DELAYS = new Map();

/** The symbol standing for e^{-s delay}. */
export function delaySymbol(delay) {
  const shown = renderExpression(delay);
  const name = shown === '1' ? '{e^{-s}}' : `{e^{-s\\,${shown}}}`;
  const known = DELAYS.get(name);
  if (known && keyOf(known) !== keyOf(delay)) throw new Error(`two delays draw as ${shown}`);
  DELAYS.set(name, delay);
  return symbol(name);
}

const isDelayName = (name) => DELAYS.has(name);

/** Whether a result has a delay e^{-sT} in it. */
export function hasDelays(value) {
  const names = new Set();
  expressionSymbols(value.numerator, value.variable, names);
  expressionSymbols(value.denominator, value.variable, names);
  return [...names].some(isDelayName);
}

/** An expression AST (transfer-function.js parseExpression) as an exact
 *  rational in s; `exp(-sT)` becomes T's delay symbol. */
function expressionValue(node, options) {
  switch (node.t) {
    case 'num': return rationalFunction(exactDecimal(node.v), ONE, options);
    case 'sym': return rationalFunction(symbol(node.name), ONE, options);
    case 'var': return rationalFunction(symbol('s'), ONE, options);
    case 'exp': return rationalFunction(delaySymbol(delayExpression(node.delay)), ONE, options);
    case 'add': return node.terms.reduce((sum, { sign, node: term }) => {
      const value = expressionValue(term, options);
      return rationalAdd(sum, sign < 0 ? rationalMultiply(value, rationalFunction(integer(-1), ONE, options), options) : value, options);
    }, rationalFunction(integer(0), ONE, options));
    case 'mul': return node.factors.reduce((product, f) => rationalMultiply(product, expressionValue(f, options), options), rationalFunction(ONE, ONE, options));
    case 'div': return rationalDivide(expressionValue(node.num, options), expressionValue(node.den, options), options);
    case 'pow': {
      const base = expressionValue(node.base, options);
      let out = rationalFunction(ONE, ONE, options);
      for (let i = 0; i < Math.abs(node.n); i++) out = rationalMultiply(out, base, options);
      return node.n < 0 ? rationalDivide(rationalFunction(ONE, ONE, options), out, options) : out;
    }
    default: throw new Error('unknown expression');
  }
}

/** A delay's AST (free of s) as an exact expression. */
function delayExpression(node) {
  switch (node.t) {
    case 'num': return exactDecimal(node.v);
    case 'sym': return symbol(node.name);
    case 'add': return add(...node.terms.map(({ sign, node: term }) => (sign < 0 ? negate(delayExpression(term)) : delayExpression(term))));
    case 'mul': return multiply(...node.factors.map(delayExpression));
    case 'div': return multiply(delayExpression(node.num), power(delayExpression(node.den), -1));
    case 'pow': return power(delayExpression(node.base), node.n);
    default: throw new Error('a delay is free of s');
  }
}

/** A block's transfer function as an exact rational in s, or in z (z^-1
 *  definitions are written over the same power of z). */
export function blockTransferFunction(component) {
  const variable = TRANSFER_FUNCTION_TYPES[component.type];
  const read = readTransferFunction(component.value, variable);
  if (read.kind === 'expression') return expressionValue(read.ast, { variable, maxOperations: 200000 });
  const { num, den, inverse, delay } = read;
  const v = symbol(variable);
  const polynomial = (tokens, degree) => add(...tokens.map((token, i) => multiply(coefficientValue(token), power(v, degree(i)))));
  if (inverse) {
    const m = Math.max(num.length, den.length) - 1;
    return rationalFunction(polynomial(num, (i) => m - i), polynomial(den, (i) => m - i), { variable });
  }
  const top = polynomial(num, (i) => num.length - 1 - i);
  return rationalFunction(delay ? multiply(delaySymbol(delayExpression(delay)), top) : top, polynomial(den, (i) => den.length - 1 - i), { variable });
}

// ----- solving ------------------------------------------------------------------------

function failure(code, error, issues = []) {
  return { ok: false, code, error, issues };
}

/**
 * Analyze the drawing. `options`: `output` (a signal key, a net name or id,
 * or a port's refdes), `sources` (`{ [refdes]: 'input' | 'zero' |
 * { constant: value } }`; a source left out is zero), and `values` (the
 * coefficients' numbers, which a sampled loop needs). Returns `{ ok,
 * variable, output, entries, issues }`, an entry per input:
 * `{ input, value (exact rational), tex, equation, poles, zeros }`. With a
 * sampler the result is in z and each `value` is a sampled result
 * (`sampledResult`), worked out again for each set of numbers.
 */
export function analyzeSignalFlow(circuit, options = {}, graph = signalFlowGraph(circuit)) {
  const { signals, sources, issues } = graph;
  if (issues.length) return failure(issues[0].code, issues[0].message, issues);
  const parts = [...circuit.components.values()].filter(isSignalPart);

  const output = resolveSignal(circuit, signals, options.output);
  if (!output) return failure('no-output', options.output ? `no signal "${options.output}" to take the output from` : 'pick the output signal');
  // Settings name a source by its port, its wire's name, or its signal key.
  const settings = new Map(Object.entries(options.sources || {}).map(([name, value]) => [canonicalNetName(name), value]));
  const modeOf = (source) => {
    const value = settings.get(canonicalNetName(source.id)) ?? settings.get(canonicalNetName(source.name)) ?? settings.get(source.key);
    if (value === 'input') return { kind: 'input' };
    if (value && typeof value === 'object' && 'constant' in value) return { kind: 'constant', value: String(value.constant) };
    return { kind: 'zero' };
  };
  const inputs = sources.filter((source) => modeOf(source).kind === 'input');
  if (!inputs.length) return failure('no-input', 'set at least one source to input');
  const sourceBySignal = new Map(sources.map((source) => [source.key, { ...source, mode: modeOf(source) }]));
  const context = { circuit, signals, sourceBySignal };

  if (parts.some((component) => component.type === 'sampler')) return analyzeSampled(context, output, inputs, options.values || {});
  const domains = new Set(parts.map((component) => TRANSFER_FUNCTION_TYPES[component.type]).filter(Boolean));
  if (domains.size > 1) {
    const blocks = (variable) => parts.filter((component) => TRANSFER_FUNCTION_TYPES[component.type] === variable).map((component) => component.refdes);
    return failure('mixed-domains', `the diagram mixes H(s) blocks (${blocks('s').join(', ')}, continuous) and H(z) blocks (${blocks('z').join(', ')}, sampled) with no sampler: put one where the continuous signal is sampled (an H(s) block reading a sampled signal is the DAC)`);
  }
  const variable = domains.has('z') ? 'z' : 's';

  // Unknowns: every signal a block or junction drives.
  const unknowns = [...signals.values()].filter((signal) => signal.driver && !signal.driver.source);
  const system = linearSystem(context, unknowns, inputs.map((source) => source.key), variable);
  if (!system.ok) return system;

  const outputSource = sourceBySignal.get(output.key);
  let columns;
  if (system.index.has(output.key)) {
    const solved = eliminateSignals(system.A, system.B, system.index.get(output.key), system.ops, variable);
    if (!solved.ok) return failure(solved.code, solved.error);
    columns = solved.columns;
  } else if (outputSource) {
    columns = inputs.map((source) => (source.key === output.key ? system.ops.one : system.ops.zero));
  } else {
    return failure('no-output', `signal ${output.display} is not driven`);
  }

  const entries = inputs.map((source, column) => present(columns[column], variable, source, output));
  return { ok: true, variable, output: { key: output.key, name: output.display }, entries, issues: [] };
}

/**
 * The loop gain at a signal: the loop broken there, 1 injected into what
 * reads it (every source at zero), and T = -(what its driver returns), the
 * negative-feedback convention, so a quantizer's NTF is 1/(1 + T). `breakAt`
 * names the signal (a key, a net name, a port); `values` as for
 * analyzeSignalFlow. Returns `{ ok, variable, signal, value }` -- `value`
 * T, an exact rational, or for a sampled loop a sampled result -- or a
 * failure.
 */
/** The signals a loop can be broken at: driven ones, sampled ones only in
 *  a diagram with a sampler; a quantizer's output first. */
export function loopBreakSignals(circuit) {
  const graph = signalFlowGraph(circuit);
  const domains = [...circuit.components.values()].some((c) => c.type === 'sampler') ? signalDomains({ circuit, signals: graph.signals }) : null;
  const driven = [...graph.signals.values()].filter((s) => s.driver && !s.driver.source && (!domains?.ok || domains.domain.get(s.key) === 'z'));
  const quantized = driven.filter((s) => circuit.components.get(s.driver.comp)?.type === 'quantizer');
  return [...quantized, ...driven.filter((s) => !quantized.includes(s))];
}

export function loopGain(circuit, { breakAt, values = {} } = {}) {
  const graph = signalFlowGraph(circuit);
  if (graph.issues.length) return failure(graph.issues[0].code, graph.issues[0].message, graph.issues);
  const signal = resolveSignal(circuit, graph.signals, breakAt);
  if (!signal) return failure('no-signal', breakAt ? `no signal "${breakAt}" to break the loop at` : 'pick a signal to break the loop at');
  if (!signal.driver || signal.driver.source) return failure('not-in-loop', `${signal.display} is a source: break the loop at a signal a part drives`);
  // The signal cut in two: an injected one its readers read, a returned one
  // its driver drives; the injected one keeps the signal's domain.
  const hasSampler = [...circuit.components.values()].some((c) => c.type === 'sampler');
  const original = hasSampler ? signalDomains({ circuit, signals: graph.signals }) : null;
  if (original && !original.ok) return original;
  // A sampled loop is broken where it is sampled: a continuous signal in it
  // carries no single return to inject against.
  if (original && original.domain.get(signal.key) !== 'z') {
    return failure('continuous-break', `${signal.display} is continuous: break a sampled loop at a sampled signal (the sampler's or the quantizer's output)`);
  }
  const injected = { ...signal, key: `${signal.key}\u0000in`, driver: { source: true, comp: '\u0000loop' }, readers: signal.readers, ...(original ? { domain: original.domain.get(signal.key) } : {}) };
  const returned = { ...signal, key: `${signal.key}\u0000out`, readers: [] };
  const signals = new Map([...graph.signals].filter(([key]) => key !== signal.key));
  signals.set(injected.key, injected);
  signals.set(returned.key, returned);
  const source = { id: '\u0000loop', key: injected.key, name: signal.display };
  const report = analyzeSignalFlow(circuit, { output: returned.key, sources: { [injected.key]: 'input' }, values }, { signals, sources: [source, ...graph.sources.filter((s) => s.key !== signal.key)], issues: [] });
  if (!report.ok) return report;
  const [entry] = report.entries;
  const minusOne = rationalFunction(integer(-1), ONE, { variable: report.variable });
  const negate = (value) => (value ? (value.kind === 'mixed' ? null : rationalMultiply(value, minusOne, { variable: value.variable })) : null);
  const value = entry.value?.kind === 'sampled'
    ? Object.freeze({ ...entry.value, at: (v) => negate(entry.value.at(v)) })
    : negate(entry.value);
  return { ok: true, variable: report.variable, signal: signal.display, key: signal.key, value, sampled: !!entry.sampled };
}

/**
 * A loop gain's margins from its number-valued response: the crossover
 * (|T| = 1, the last one), the phase margin there (180 degrees plus its
 * phase, read in (-360, 0]), and the gain margin where the phase crosses
 * -180 degrees. Frequencies as the curve gives them (f/fs, or omega).
 */
export function loopMargins(curve) {
  if (!curve?.points?.length) return null;
  const pts = curve.points;
  const wrap = (phase) => { let p = phase % 360; if (p > 0) p -= 360; return p; };
  let crossover = null;
  for (let i = 1; i < pts.length; i++) {
    if ((pts[i - 1].db >= 0) !== (pts[i].db >= 0)) {
      const t = pts[i - 1].db / (pts[i - 1].db - pts[i].db);
      crossover = { f: pts[i - 1].f * (pts[i].f / pts[i - 1].f) ** t, phase: pts[i - 1].phase + t * (pts[i].phase - pts[i - 1].phase) };
    }
  }
  let phaseCross = null;
  for (let i = 1; i < pts.length; i++) {
    const a = wrap(pts[i - 1].phase) + 180;
    const b = wrap(pts[i].phase) + 180;
    if (Math.abs(a - b) < 180 && (a >= 0) !== (b >= 0)) {
      const t = a / (a - b);
      phaseCross = { f: pts[i - 1].f * (pts[i].f / pts[i - 1].f) ** t, db: pts[i - 1].db + t * (pts[i].db - pts[i - 1].db) };
      break;
    }
  }
  return {
    crossover: crossover && crossover.f,
    phaseMargin: crossover ? 180 + wrap(crossover.phase) : null,
    gainMargin: phaseCross ? -phaseCross.db : null,
    phaseCrossover: phaseCross && phaseCross.f,
  };
}

/**
 * The equations `x - sum G x = sum S u` of `unknowns` (signals), in
 * `variable`: `A` over the unknowns, `B` over `inputKeys` (signals whose
 * values are given -- input sources, or a sampled loop's other side). A
 * signal neither unknown nor an input drops out (a zero or constant source:
 * superposition). `extra(signal, row, feed)` builds a row the usual parts
 * do not (a sampler's).
 */
function linearSystem({ circuit, signals, sourceBySignal }, unknowns, inputKeys, variable, extra = null) {
  const index = new Map(unknowns.map((signal, i) => [signal.key, i]));
  // A big diagram's exact algebra is big: give it room, the elimination
  // keeps it as small as the diagram allows.
  const ops = createRationalOps({ variable, maxOperations: 20_000_000 });
  const n = unknowns.length;
  const A = Array.from({ length: n }, () => Array(n).fill(ops.zero));
  const B = Array.from({ length: n }, () => Array(inputKeys.length).fill(ops.zero));
  const inputColumn = new Map(inputKeys.map((key, column) => [key, column]));
  const toRational = (value) => (value?.kind === 'rational' ? value : rationalFunction(value, integer(1), { variable }));
  const signalAt = (component, term) => {
    for (const signal of signals.values()) {
      if (signal.readers.some((reader) => reader.comp === component.refdes && reader.term === term)) return signal;
    }
    return null;
  };
  // y = sum of gain * x over its inputs: x unknown -> into A; x an input
  // -> into B; zero and constant sources drop out (superposition).
  const feed = (row, gain, signal) => {
    if (!signal) return;
    const g = toRational(gain);
    if (index.has(signal.key)) A[row][index.get(signal.key)] = ops.sub(A[row][index.get(signal.key)], g);
    else if (inputColumn.has(signal.key)) B[row][inputColumn.get(signal.key)] = ops.add(B[row][inputColumn.get(signal.key)], g);
  };

  for (const signal of unknowns) {
    const row = index.get(signal.key);
    A[row][row] = ops.one;
    const component = circuit.components.get(signal.driver.comp);
    if (Object.hasOwn(TRANSFER_FUNCTION_TYPES, component.type)) {
      let h;
      try {
        h = blockTransferFunction(component);
      } catch (err) {
        return failure('bad-transfer-function', `${component.refdes}: ${err.message}`);
      }
      feed(row, h, signalAt(component, 'in'));
    } else if (component.type === 'gain') {
      let k;
      try {
        k = coefficientValue(parseGain(component.value));
      } catch (err) {
        return failure('bad-gain', `${component.refdes}: ${err.message}`);
      }
      feed(row, k, signalAt(component, 'in'));
    } else if (component.type === 'quantizer') {
      // Linear model: v = y + E, its error a source of its own.
      feed(row, ops.one, signalAt(component, 'in'));
      feed(row, ops.one, { key: quantizerErrorKey(component.refdes) });
    } else if (component.type === 'signal_sum') {
      for (const term of JUNCTION_INPUTS) {
        const sign = component.negativeInputs?.has(term) ? ops.neg(ops.one) : ops.one;
        feed(row, sign, signalAt(component, term));
      }
    } else if (component.type === 'signal_multiply') {
      const connected = JUNCTION_INPUTS.map((term) => signalAt(component, term)).filter(Boolean);
      const constants = [];
      const varying = [];
      for (const input of connected) {
        const source = sourceBySignal.get(input.key);
        if (source && source.mode.kind !== 'input') constants.push(source.mode.kind === 'zero' ? '0' : source.mode.value);
        else varying.push(input);
      }
      if (varying.length > 1) {
        return failure('nonlinear', `${component.refdes} multiplies ${varying.map((s) => s.display).join(' by ')}: two signals multiplied have no transfer function (set all but one of its inputs to a constant)`, [{ code: 'nonlinear', refs: [component.refdes] }]);
      }
      let gain;
      try {
        gain = constants.reduce((product, value) => multiply(product, coefficientValue(value.replace(/\s/g, ''))), integer(1));
      } catch {
        return failure('bad-constant', `${component.refdes}: a constant must be a number or a symbol`);
      }
      feed(row, gain, varying[0]);
    } else if (extra) {
      const built = extra(signal, row, feed, signalAt);
      if (built && !built.ok) return built;
    }
  }
  return { ok: true, A, B, ops, index, signalAt };
}

// ----- sampled loops ------------------------------------------------------------------

/**
 * Each signal's domain: 's' (continuous) or 'z' (sampled). A sampler's and
 * an H(z) block's outputs are sampled, an H(s) block's continuous (reading
 * a sampled signal, it is the DAC); a junction's output is its inputs'
 * domain, and a source takes the domain of what it meets. Returns `{ ok,
 * domain: Map }` or a failure naming the part that mixes them.
 */
export function signalDomains({ circuit, signals }) {
  const domain = new Map();
  // Why each signal has its domain: the part that set it (`{ comp, kind }`,
  // kind 'drives' or 'reads'), carried through junctions, for the message
  // when two domains meet.
  const origin = new Map();
  const readersOf = (signal) => signal.readers.map((reader) => ({ reader, component: circuit.components.get(reader.comp) }));
  const junctionInputs = (component) => [...signals.values()].filter((signal) => signal.readers.some((reader) => reader.comp === component.refdes));
  const outputOf = (component) => [...signals.values()].find((signal) => signal.driver?.comp === component.refdes && !signal.driver.source);
  // A signal that says its domain keeps it (a broken loop's injected copy).
  for (const signal of signals.values()) if (signal.domain) domain.set(signal.key, signal.domain);
  for (const signal of signals.values()) {
    if (!signal.driver || signal.driver.source || domain.has(signal.key)) continue;
    const type = circuit.components.get(signal.driver.comp)?.type;
    const at = { comp: signal.driver.comp, kind: 'drives' };
    if (type === 'sampler' || TRANSFER_FUNCTION_TYPES[type] === 'z') { domain.set(signal.key, 'z'); origin.set(signal.key, at); }
    else if (TRANSFER_FUNCTION_TYPES[type] === 's') { domain.set(signal.key, 's'); origin.set(signal.key, at); }
  }
  for (let changed = true; changed;) {
    changed = false;
    const set = (signal, value, why) => {
      if (signal && value && !domain.has(signal.key)) { domain.set(signal.key, value); if (why) origin.set(signal.key, why); changed = true; }
    };
    for (const component of circuit.components.values()) {
      if (!PASS_THROUGH.has(component.type)) continue;
      const out = outputOf(component);
      const ins = junctionInputs(component);
      const from = [out, ...ins].find((signal) => signal && domain.get(signal.key));
      if (!from) continue;
      const known = domain.get(from.key);
      set(out, known, origin.get(from.key));
      for (const signal of ins) set(signal, known, origin.get(from.key));
    }
    // A source read by a sampler or an H(s) block is continuous; by an H(z) block, sampled.
    for (const signal of signals.values()) {
      if (domain.has(signal.key)) continue;
      for (const { component } of readersOf(signal)) {
        if (component?.type === 'sampler' || isBlockIn(component, 's')) set(signal, 's', { comp: component.refdes, kind: 'reads' });
        else if (isBlockIn(component, 'z')) set(signal, 'z', { comp: component.refdes, kind: 'reads' });
      }
    }
  }
  for (const signal of signals.values()) if (!domain.has(signal.key)) domain.set(signal.key, 's');
  // A quantizer's error is in its output's domain.
  for (const component of circuit.components.values()) {
    if (component.type === 'quantizer') domain.set(quantizerErrorKey(component.refdes), domain.get(outputOf(component)?.key) || 's');
  }
  // A signal as the message names it: its net name, else its driver's pin.
  const nameOf = (signal) => {
    const named = signal.netIds.map((id) => circuit.nets.get(id)).find((net) => net?.name);
    if (named) return named.name;
    if (signal.driver && !signal.driver.source) return `${signal.driver.comp}.${signal.driver.term}`;
    return signal.display;
  };
  const partKind = (refdes) => {
    const type = circuit.components.get(refdes)?.type;
    return type === 'sampler' ? 'a sampler' : TRANSFER_FUNCTION_TYPES[type] === 'z' ? 'an H(z) block' : TRANSFER_FUNCTION_TYPES[type] === 's' ? 'an H(s) block' : 'a part';
  };
  const describe = (signal) => {
    const sampled = domain.get(signal.key) === 'z';
    const why = origin.get(signal.key);
    const reason = !why ? 'nothing makes it sampled'
      : why.kind === 'drives' ? `${why.comp}, ${partKind(why.comp)}, drives it${why.comp === signal.driver?.comp ? '' : ' through junctions'}`
      : `${why.comp}, ${partKind(why.comp)}, reads it`;
    return `${nameOf(signal)} is ${sampled ? 'sampled' : 'continuous'} (${reason})`;
  };
  // Where the domains meet, only a sampler (s to z) or an H(s) block (z to s) may stand.
  for (const component of circuit.components.values()) {
    if (component.type === 'sampler' || isBlockIn(component, 'z')) {
      const input = [...signals.values()].find((signal) => signal.readers.some((reader) => reader.comp === component.refdes));
      if (input && domain.get(input.key) !== (component.type === 'sampler' ? 's' : 'z')) {
        return failure('mixed-domains', component.type === 'sampler'
          ? `${component.refdes} samples a signal that is already sampled: ${describe(input)}`
          : `${component.refdes} is an H(z) block reading a continuous signal: ${describe(input)}; sample it first (a sampler)`, [{ code: 'mixed-domains', refs: [component.refdes] }]);
      }
    } else if (PASS_THROUGH.has(component.type)) {
      // Inputs first: the signals the message names are then the ones that meet.
      const touching = [...junctionInputs(component), outputOf(component)].filter(Boolean);
      if (new Set(touching.map((signal) => domain.get(signal.key))).size > 1) {
        // One of each domain is enough to see the clash.
        const continuous = touching.find((signal) => domain.get(signal.key) === 's');
        const sampled = touching.find((signal) => domain.get(signal.key) === 'z');
        return failure('mixed-domains', `${component.refdes} joins a continuous and a sampled signal: ${describe(continuous)}, but ${describe(sampled)}. Put a sampler (s to z), or an H(s) block as the DAC (z to s), between them`, [{ code: 'mixed-domains', refs: [component.refdes, ...new Set([origin.get(continuous.key)?.comp, origin.get(sampled.key)?.comp].filter(Boolean))] }]);
      }
    }
  }
  return { ok: true, domain };
}

/** An exact number from a float, to 12 significant figures. */
const exactFloat = (x) => coefficientValue(String(Number(x.toPrecision(12))));

/** A numeric rational in s with delays as `{ den, terms: [{ delay, num }] }`
 *  (samplePath's input), or a failure. */
export function delayTermsOf(value) {
  const den = denseCoefficients(value.denominator, 's');
  if (!den) return { ok: false, error: 'a delay inside a continuous-time loop cannot be sampled exactly' };
  const list = coefficientList(value.numerator, 's');
  if (!list) return { ok: false, error: 'the path to a sampler does not reduce to numbers' };
  const byDelay = new Map();
  for (const { power: p, coefficient } of list) {
    const split = delayMonomials(coefficient);
    if (!split) return { ok: false, error: 'the path to a sampler does not reduce to numbers' };
    for (const [delay, number] of split) {
      const key = delay.toPrecision(12);
      if (!byDelay.has(key)) byDelay.set(key, { delay, num: [] });
      const num = byDelay.get(key).num;
      while (num.length <= p) num.push(0);
      num[p] += number;
    }
  }
  return { ok: true, den, terms: [...byDelay.values()] };
}

/** A numeric coefficient with delays as a Map delay -> number. */
function delayMonomials(value) {
  switch (value?.kind) {
    case 'number': return new Map([[0, Number(value.numerator) / Number(value.denominator)]]);
    case 'symbol': {
      const delay = DELAYS.get(value.name);
      if (!delay) return null;
      try { return new Map([[evaluateExpression(delay, {}), 1]]); } catch { return null; }
    }
    case 'add': {
      const out = new Map();
      for (const term of value.terms) {
        const part = delayMonomials(term);
        if (!part) return null;
        for (const [d, v] of part) out.set(d, (out.get(d) || 0) + v);
      }
      return out;
    }
    case 'multiply': {
      let out = new Map([[0, 1]]);
      for (const factor of value.factors) {
        const part = delayMonomials(factor);
        if (!part) return null;
        out = convolveDelays(out, part);
      }
      return out;
    }
    case 'power': {
      const base = delayMonomials(value.base);
      if (!base || value.exponent < 0) return null;
      let out = new Map([[0, 1]]);
      for (let i = 0; i < value.exponent; i++) out = convolveDelays(out, base);
      return out;
    }
    default: return null;
  }
}

/** The product of two delay -> number maps. */
function convolveDelays(a, b) {
  const next = new Map();
  for (const [d1, v1] of a) for (const [d2, v2] of b) next.set(d1 + d2, (next.get(d1 + d2) || 0) + v1 * v2);
  return next;
}

/** A sampled path `{ num, den }` (z^-1 powers) as an exact rational in z. */
function sampledRational({ num, den }) {
  const z = symbol('z');
  const m = Math.max(num.length, den.length) - 1;
  const polynomial = (list) => add(...list.map((c, i) => multiply(exactFloat(c), power(z, m - i))));
  return cancelCommonPolynomialFactor(rationalFunction(polynomial(num), polynomial(den), { variable: 'z' }), { variable: 'z' });
}

/**
 * A diagram with samplers: a continuous-time loop sampled into a discrete
 * one (a CT sigma-delta modulator). The continuous side is solved exactly,
 * once, for every sampler's input: a transfer function from each
 * continuous source and from each sampled signal an H(s) block reads (the
 * DAC's input). For a set of coefficient values those paths are sampled
 * (sampling.js) and the sampled side solved in z: a sampled source's result
 * is a rational in z; a continuous source's is the z part times its path
 * to the sampler, G(s) at s = j omega, a tone in giving the same tone out
 * (its images aside). The output must be a sampled signal.
 */
function analyzeSampled(context, output, inputs, initialValues) {
  const { circuit, signals, sourceBySignal } = context;
  const domains = signalDomains(context);
  if (!domains.ok) return domains;
  const { domain } = domains;
  if (domain.get(output.key) !== 'z') return failure('continuous-output', `${output.display} is continuous: with a sampler, take the output from a sampled signal (after the sampler)`);
  const samplers = [...circuit.components.values()].filter((component) => component.type === 'sampler');
  let periods;
  try {
    periods = samplers.map((component) => coefficientValue(parseGain(component.value || 'T')));
  } catch (err) {
    return failure('bad-gain', `sampler: ${err.message}`);
  }

  // The continuous side: unknowns its driven signals, inputs its sources and
  // the sampled signals H(s) blocks read.
  const continuous = [...signals.values()].filter((signal) => domain.get(signal.key) === 's' && signal.driver && !signal.driver.source);
  const sInputs = inputs.filter((source) => domain.get(source.key) === 's');
  const dacInputs = [...signals.values()].filter((signal) => domain.get(signal.key) === 'z'
    && signal.readers.some((reader) => isBlockIn(circuit.components.get(reader.comp), 's')));
  const sSystem = linearSystem(context, continuous, [...sInputs.map((s) => s.key), ...dacInputs.map((s) => s.key)], 's');
  if (!sSystem.ok) return sSystem;
  // Per sampler: its input's paths, [continuous sources..., DAC inputs...].
  const paths = [];
  for (const component of samplers) {
    const input = sSystem.signalAt(component, 'in');
    let columns;
    if (input && sSystem.index.has(input.key)) {
      const solved = eliminateSignals(sSystem.A, sSystem.B, sSystem.index.get(input.key), sSystem.ops, 's');
      if (!solved.ok) return failure(solved.code, solved.error);
      columns = solved.columns;
    } else {
      // Sampling a source (or nothing) directly.
      const keys = [...sInputs.map((s) => s.key), ...dacInputs.map((s) => s.key)];
      columns = keys.map((key) => (input && key === input.key ? sSystem.ops.one : sSystem.ops.zero));
    }
    paths.push({ component, g: columns.slice(0, sInputs.length), f: columns.slice(sInputs.length) });
  }

  // The sampled side, built once with each sampler's row filled per values.
  const discrete = [...signals.values()].filter((signal) => domain.get(signal.key) === 'z' && signal.driver && !signal.driver.source);
  const zInputs = inputs.filter((source) => domain.get(source.key) === 'z');
  const pseudo = samplers.map((component) => `\u0000sampler:${component.refdes}`);
  const symbols = new Set();
  for (const path of paths) for (const value of [...path.g, ...path.f]) for (const name of resultSymbols(value, 's')) symbols.add(name);
  for (const period of periods) expressionSymbols(period, 's', symbols);
  const zProbe = linearSystem(context, discrete, [...zInputs.map((s) => s.key), ...pseudo], 'z', () => ({ ok: true }));
  if (!zProbe.ok) return zProbe;
  for (const row of [...zProbe.A, ...zProbe.B]) for (const value of row) for (const name of resultSymbols(value, 'z')) symbols.add(name);
  const symbolList = [...symbols].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  let memo = null;
  /** Every input's result at these numbers: `{ ok, columns }` or a failure. */
  const at = (values) => {
    const given = Object.fromEntries(symbolList.map((name) => [name, Number.isFinite(values?.[name]) ? values[name] : 1]));
    const key = JSON.stringify(given);
    if (memo?.key === key) return memo.result;
    const result = solveSampledAt(given);
    memo = { key, result };
    return result;
  };
  const solveSampledAt = (given) => {
    const T = periods.map((period) => evaluateExpression(period, given));
    if (T.some((t) => !(t > 0))) return failure('bad-period', 'a sampler\'s period must be positive');
    if (T.some((t) => Math.abs(t - T[0]) > 1e-9 * T[0])) return failure('mixed-periods', 'the samplers run at different periods: one rate is supported');
    const sampled = [];
    for (const [i, path] of paths.entries()) {
      const fd = [];
      for (const f of path.f) {
        const numericF = withCoefficients(f, given);
        if (!numericF.numerator || (numericF.numerator.kind === 'number' && numericF.numerator.numerator === 0n)) { fd.push(null); continue; }
        const split = delayTermsOf(numericF);
        if (!split.ok) return failure('unsampleable', `${path.component.refdes}: ${split.error}`);
        try {
          fd.push(sampledRational(samplePath(split, T[i])));
        } catch (err) {
          return failure('unsampleable', `${path.component.refdes}: ${err.message}`);
        }
      }
      sampled.push(fd);
    }
    const sampler = new Map(samplers.map((component, i) => [component.refdes, i]));
    const zSystem = linearSystem(context, discrete, [...zInputs.map((s) => s.key), ...pseudo], 'z', (signal, row, feed) => {
      const i = sampler.get(signal.driver.comp);
      if (i === undefined) return { ok: true };
      sampled[i].forEach((fd, k) => { if (fd) feed(row, fd, dacInputs[k]); });
      feed(row, integer(1), { key: pseudo[i] });
      return { ok: true };
    });
    if (!zSystem.ok) return zSystem;
    const numericEntry = (value) => withCoefficients(value, given);
    const A = zSystem.A.map((row) => row.map(numericEntry));
    const B = zSystem.B.map((row) => row.map(numericEntry));
    let columns;
    if (zSystem.index.has(output.key)) {
      const solved = eliminateSignals(A, B, zSystem.index.get(output.key), zSystem.ops, 'z');
      if (!solved.ok) return failure(solved.code, solved.error);
      columns = solved.columns;
    } else {
      columns = [...zInputs.map((s) => s.key), ...pseudo].map((k) => (k === output.key ? zSystem.ops.one : zSystem.ops.zero));
    }
    const zColumn = new Map(zInputs.map((source, c) => [source.key, columns[c]]));
    const out = inputs.map((source) => {
      if (zColumn.has(source.key)) return zColumn.get(source.key);
      const j = sInputs.findIndex((s) => s.key === source.key);
      const terms = paths.map((path, i) => ({ z: columns[zInputs.length + i], s: withCoefficients(path.g[j], given) }))
        .filter(({ z, s }) => !isZeroRational(z) && !isZeroRational(s));
      return { kind: 'mixed', terms, period: T[0] };
    });
    return { ok: true, columns: out };
  };

  const first = at(initialValues);
  if (!first.ok) return first;
  const entries = inputs.map((source, column) => {
    const value = sampledResult({ at: (values) => { const r = at(values); return r.ok ? r.columns[column] : null; }, symbols: symbolList, continuous: domain.get(source.key) === 's', paths: paths.map((path) => path.g[sInputs.findIndex((s) => s.key === source.key)]) });
    return presentSampled(value, initialValues, source, output);
  });
  return { ok: true, variable: 'z', sampled: true, output: { key: output.key, name: output.display }, entries, issues: [] };
}

const isZeroRational = (value) => !value || (value.numerator?.kind === 'number' && value.numerator.numerator === 0n);

/**
 * A sampled result: worked out for each set of coefficient numbers.
 * `withCoefficients` gives its number-valued form -- a rational in z for a
 * sampled source, or `{ kind: 'mixed', terms: [{ z, s }], period }` for a
 * continuous one -- and `resultSymbols` its symbols.
 */
function sampledResult(spec) {
  return Object.freeze({ kind: 'sampled', ...spec });
}

/** A sampled result as an entry, its equation at these numbers. */
function presentSampled(value, values, source, output) {
  const label = `\\frac{${texName(output.display)}}{${texName(source.name)}}`;
  const entry = { input: source.id, inputName: source.name, value, label, sampled: true, continuous: value.continuous, ...(source.quantizer ? { quantizer: source.id } : {}) };
  Object.assign(entry, sampledEquation(entry, values));
  return entry;
}

/** A sampled entry's equation, poles, and zeros at these numbers. */
export function sampledEquation(entry, values) {
  const numericValue = entry.value.at(values);
  if (!numericValue) return { equation: `${entry.label} = \\text{?}`, tex: '\\text{?}', zeros: null, poles: null, delayed: false };
  if (numericValue.kind !== 'mixed') {
    const tex = transferTex(numericValue, 'z', { digits: 4 });
    return { tex, equation: `${entry.label} = ${tex}`, ...numericRootsOf(numericValue) };
  }
  // A continuous input: the sampled loop's part, times its path to the sampler.
  const tex = numericValue.terms.map(({ z }, i) => {
    const path = entry.value.paths[i];
    const pathTex = path ? transferTex(path, 's') : '1';
    const zTex = transferTex(z, 'z', { digits: 4 });
    const wrap = (t) => (/^\\frac|^[^+-]*$/.test(t.replace(/^-/, '')) && !/ [+-] /.test(t) ? t : `\\left(${t}\\right)`);
    return pathTex === '1' ? zTex : `${wrap(zTex)} \\cdot ${wrap(pathTex)}`;
  }).join(' + ') || '0';
  // Every term shares the sampled loop's poles; the zeros are the z part's
  // when the path to the sampler is a plain number (a source added there).
  const [first] = numericValue.terms;
  const roots = first ? numericRootsOf(first.z) : { zeros: null, poles: null };
  const plainPath = numericValue.terms.length === 1 && isPlainNumber(first.s.numerator) && isPlainNumber(first.s.denominator);
  return { tex, equation: `${entry.label} = ${tex}`, zeros: plainPath ? roots.zeros : null, poles: roots.poles, delayed: false, mixed: true };
}

/**
 * Solve `A x = B` for one unknown by eliminating the others one at a time,
 * the way a signal-flow graph is reduced by hand: each signal is a weighted
 * sum of others (A's rows are `x_y - sum G x = sum S u`). A node's self-loop
 * folds into `1 / (1 - loop)`, then the node is substituted into every
 * equation that reads it. The next node to go is always the cheapest
 * (fewest inputs times readers), and each new coefficient has its common
 * factors cancelled, so the expressions stay as small as the diagram allows
 * -- where a generic elimination order makes a large symbolic diagram's
 * algebra explode. Returns `{ ok, columns }`, a transfer function per column
 * of B, or `{ ok: false, code, error }`.
 */
export function eliminateSignals(A, B, outputIndex, ops, variable) {
  const n = A.length;
  const width = B[0]?.length ?? 0;
  const cancel = (value) => cancelCommonPolynomialFactor(value, { variable, maxWork: 400_000 });
  // A row is x_y - sum G x: off the diagonal G = -a; on it, a signal feeding
  // itself (a block wired back to its own input, a sampler's loop) is 1 - a.
  const G = A.map((row, y) => new Map(row.flatMap((a, x) => {
    const g = x === y ? ops.sub(ops.one, a) : ops.neg(a);
    return ops.isZero(g) ? [] : [[x, g]];
  })));
  const S = B.map((row) => new Map(row.flatMap((b, c) => (!ops.isZero(b) ? [[c, b]] : []))));
  const readers = Array.from({ length: n }, () => new Set());
  G.forEach((row, y) => { for (const x of row.keys()) readers[x].add(y); });
  const alive = new Set(Array.from({ length: n }, (_, i) => i));
  const budgetOut = () => ({ ok: false, code: 'budget', error: 'the diagram is too large to solve symbolically within the work limit: give some coefficients numbers, or split the diagram' });
  const singular = { ok: false, code: 'singular', error: 'the diagram has no unique solution: a loop with a gain of exactly 1 (check the signs at the sums)' };
  const exhausted = (value) => value?.budgetExceeded === true;
  // v = (sum G x + S u) / (1 - loop).
  const fold = (v) => {
    const loop = G[v].get(v);
    if (loop === undefined) return true;
    G[v].delete(v);
    readers[v].delete(v);
    const d = ops.sub(ops.one, loop);
    if (ops.isZero(d)) return false;
    for (const [x, g] of G[v]) G[v].set(x, cancel(ops.div(g, d)));
    for (const [c, s] of S[v]) S[v].set(c, cancel(ops.div(s, d)));
    return true;
  };
  const accumulate = (map, key, value) => {
    const sum = map.has(key) ? ops.add(map.get(key), value) : value;
    if (ops.isZero(sum)) map.delete(key);
    else map.set(key, cancel(sum));
    return map.has(key);
  };
  while (alive.size > 1) {
    let pick = -1;
    let cost = Infinity;
    for (const v of alive) {
      if (v === outputIndex) continue;
      const inputs = G[v].size - (G[v].has(v) ? 1 : 0);
      const reading = readers[v].size - (readers[v].has(v) ? 1 : 0);
      const c = inputs * reading;
      if (c < cost) { cost = c; pick = v; }
    }
    const v = pick;
    if (!fold(v)) return singular;
    for (const y of [...readers[v]]) {
      if (y === v || !alive.has(y)) continue;
      const gyv = G[y].get(v);
      G[y].delete(v);
      for (const [x, g] of G[v]) {
        if (accumulate(G[y], x, ops.mul(gyv, g))) readers[x].add(y);
        else readers[x].delete(y);
      }
      for (const [c, s] of S[v]) accumulate(S[y], c, ops.mul(gyv, s));
      if ([...G[y].values(), ...S[y].values()].some(exhausted)) return budgetOut();
    }
    for (const x of G[v].keys()) readers[x].delete(v);
    alive.delete(v);
  }
  if (!fold(outputIndex)) return singular;
  if (G[outputIndex].size) return singular;
  const columns = Array.from({ length: width }, (_, c) => S[outputIndex].get(c) ?? ops.zero);
  if (columns.some(exhausted)) return budgetOut();
  return { ok: true, columns: columns.map(cancel) };
}

/** A signal by key, net name or id, or the refdes of a port on it. */
function resolveSignal(circuit, signals, target) {
  if (!target) return null;
  if (signals.has(target)) return signals.get(target);
  const name = canonicalNetName(target);
  for (const signal of signals.values()) {
    if (signal.netIds.includes(target) || canonicalNetName(signal.name) === name) return signal;
  }
  const port = circuit.components.get(target);
  if (port) {
    for (const signal of signals.values()) {
      if (signal.netIds.some((id) => circuit.nets.get(id)?.terminals.some((t) => t.comp === port.refdes))) return signal;
    }
  }
  return null;
}

// ----- presentation -------------------------------------------------------------------

function coefficientList(value, variable) {
  return polynomialCoefficients(value, variable) || null;
}

const isPlainNumber = (value) => value?.kind === 'number';

/** The symbol's delay e^{-s T} raised to n, as e^{-n s T}. */
function delayPowerTex(name, n) {
  const inner = name.slice(1, -1).replace(/^e\^\{-s/, '');
  if (n === 1) return `e^{-s${inner.slice(0, -1)}}`;
  return `e^{${n < 0 ? '' : '-'}${Math.abs(n)}s${inner.slice(0, -1)}}`;
}

const delayPart = (factor) => (factor.kind === 'symbol' && isDelayName(factor.name) ? [factor.name, 1]
  : factor.kind === 'power' && factor.base.kind === 'symbol' && isDelayName(factor.base.name) ? [factor.base.name, factor.exponent] : null);

/** An expression with delays: the delay-free part first and its delays
 *  after it (k e^{-sT}), delay-free terms leading a sum (1 - e^{-sT}). */
function coefficientTex(value) {
  const names = expressionSymbols(value, 's');
  if (![...names].some(isDelayName)) return renderExpression(value);
  if (value.kind === 'add') {
    const terms = value.terms.map((term) => coefficientTex(term));
    const order = value.terms.map((term, i) => ({ i, delayed: [...expressionSymbols(term, 's')].some(isDelayName), negative: terms[i].startsWith('-') }));
    order.sort((a, b) => (a.delayed - b.delayed) || (a.negative - b.negative) || (a.i - b.i));
    return order.map(({ i }, k) => {
      const tex = terms[i];
      if (k === 0) return tex;
      return tex.startsWith('-') ? ` - ${tex.slice(1).trim()}` : ` + ${tex}`;
    }).join('');
  }
  if (value.kind === 'symbol' || value.kind === 'power') {
    const part = delayPart(value);
    if (part) return delayPowerTex(...part);
  }
  if (value.kind === 'multiply') {
    const delays = [];
    const sums = [];
    const rest = [];
    for (const factor of value.factors) {
      const part = delayPart(factor);
      if (part) delays.push(delayPowerTex(...part));
      else if ([...expressionSymbols(factor, 's')].some(isDelayName)) sums.push(`\\left(${coefficientTex(factor)}\\right)`);
      else rest.push(factor);
    }
    let head = rest.length ? renderExpression(rest.length === 1 ? rest[0] : multiply(...rest)) : '';
    if (rest.some((f) => f.kind === 'add')) head = `\\left(${head}\\right)`;
    if (head === '1') head = '';
    if (head === '-1') head = '-';
    const tail = [...sums, ...delays].join('\\,');
    return `${head}${head && head !== '-' ? '\\,' : ''}${tail}`;
  }
  return renderExpression(value);
}

/** Coefficient times a power of the variable, as one signed term. */
function termTex(coefficient, powerText, digits = 0) {
  let tex = digits && isPlainNumber(coefficient) ? decimalTex(coefficient, digits) : coefficientTex(coefficient);
  // A compound coefficient (a_1 - 1) keeps its own signs in its brackets: its
  // leading minus belongs to its first term, not to the whole term.
  if (coefficient.kind === 'add') return { negative: false, tex: powerText ? `\\left(${tex}\\right) ${powerText}` : tex };
  let negative = false;
  if (tex.startsWith('-')) {
    negative = true;
    tex = tex.slice(1).trim();
  }
  if (powerText) tex = tex === '1' ? powerText : `${tex} ${powerText}`;
  return { negative, tex };
}

function sumTex(terms) {
  if (!terms.length) return '0';
  return terms.map((t, i) => (i === 0 ? `${t.negative ? '-' : ''}${t.tex}` : ` ${t.negative ? '-' : '+'} ${t.tex}`)).join('');
}

/**
 * A transfer function as textbook TeX: in s, descending powers with a monic
 * denominator; in z, ascending powers of z^-1 with the constant term of the
 * denominator 1 (when it is a number).
 */
/** A number to `digits` significant figures, as a decimal (1.234, -0.05). */
function decimalTex(value, digits) {
  const x = Number(value.numerator) / Number(value.denominator);
  const text = String(Number(x.toPrecision(digits)));
  return /e/.test(text) ? text.replace(/e([-+]?\d+)/, (m, e) => `\\cdot 10^{${Number(e)}}`) : text;
}

export function transferTex(value, variable, { digits = 0 } = {}) {
  const numerator = coefficientList(value.numerator, variable);
  const denominator = coefficientList(value.denominator, variable);
  if (!numerator || !denominator) return `\\frac{${renderExpression(value.numerator, { variable })}}{${renderExpression(value.denominator, { variable })}}`;
  if (!numerator.length) return '0';
  // Normalize by the denominator's leading coefficient when it is a number.
  const lead = denominator[0].coefficient;
  const scale = isPlainNumber(lead) ? lead : null;
  const norm = (list) => list.map(({ power: p, coefficient }) => ({ power: p, coefficient: scale ? multiply(coefficient, power(scale, -1)) : coefficient }));
  const num = norm(numerator);
  const den = norm(denominator);
  // In z, every power is taken relative to the denominator's highest, so the
  // denominator runs 1, z^-1, z^-2 ... and the numerator keeps whatever
  // powers it has (a z^1 stays a z, rather than 1 over z^-1).
  const shift = variable === 'z' ? (den[0]?.power ?? 0) : 0;
  const powerText = (p) => {
    const e = p - shift;
    return e === 0 ? '' : e === 1 ? variable : `${variable}^{${e}}`;
  };
  // In z: the constant first, then falling powers (z^-1, z^-2), then any
  // rising ones; in s: highest power first.
  const zOrder = (a, b) => {
    const ea = a.power - shift;
    const eb = b.power - shift;
    if ((ea <= 0) !== (eb <= 0)) return ea <= 0 ? -1 : 1;
    return ea <= 0 ? eb - ea : ea - eb;
  };
  const order = (list) => (variable === 'z' ? [...list].sort(zOrder) : list);
  const render = (list) => sumTex(order(list).map(({ power: p, coefficient }) => termTex(coefficient, powerText(p), digits)));
  const denominatorIsOne = den.length === 1 && den[0].power === shift && isPlainNumber(den[0].coefficient)
    && den[0].coefficient.numerator === 1n && den[0].coefficient.denominator === 1n;
  if (denominatorIsOne) return render(num);
  return `\\frac{${render(num)}}{${render(den)}}`;
}

/** Numeric roots (low power first coefficients), or null when symbolic. */
function numericRoots(list) {
  if (!list || !list.length || !list.every(({ coefficient }) => isPlainNumber(coefficient))) return null;
  const degree = list[0].power;
  const dense = Array(degree + 1).fill(0);
  for (const { power: p, coefficient } of list) dense[p] = Number(coefficient.numerator) / Number(coefficient.denominator);
  return polynomialRoots(dense).map((root) => ({ re: root.re, im: root.im }));
}

/** A complex number the way a reader wants it: 3 significant figures. */
export function complexText(root) {
  const fmt = (x) => {
    const v = Math.abs(x) < 1e-12 ? 0 : Number(x.toPrecision(3));
    return String(v);
  };
  // A repeated root comes back split by round-off (1 +- 1e-9j): it is real.
  if (Math.abs(root.im) < 1e-12 || Math.abs(root.im) < 1e-6 * Math.abs(root.re)) return fmt(root.re);
  const re = Math.abs(root.re) < 1e-12 ? '' : fmt(root.re);
  const im = `${fmt(Math.abs(root.im))}j`;
  return re ? `${re} ${root.im < 0 ? '-' : '+'} ${im}` : `${root.im < 0 ? '-' : ''}${im}`;
}

function present(value, variable, source, output) {
  const tex = transferTex(value, variable);
  const label = `\\frac{${texName(output.display)}}{${texName(source.name)}}`;
  return {
    input: source.id,
    ...(source.quantizer ? { quantizer: source.id } : {}),
    inputName: source.name,
    value,
    tex,
    label,
    equation: `${label} = ${tex}`,
    ...numericRootsOf(value),
  };
}

/** A signal's name in TeX, as it was written (V_{OUT} keeps its markup). */
function texName(name) {
  return String(name);
}

// ----- frequency response -------------------------------------------------------------

export function denseCoefficients(value, variable) {
  const list = coefficientList(value, variable);
  if (!list || !list.every(({ coefficient }) => isPlainNumber(coefficient))) return null;
  const dense = Array((list[0]?.power ?? 0) + 1).fill(0);
  for (const { power: p, coefficient } of list) dense[p] = Number(coefficient.numerator) / Number(coefficient.denominator);
  return dense;
}

function evaluate(dense, re, im) {
  // Horner with a complex argument, coefficients low power first.
  let a = 0;
  let b = 0;
  for (let i = dense.length - 1; i >= 0; i--) {
    const nextA = a * re - b * im + dense[i];
    b = a * im + b * re;
    a = nextA;
  }
  return { re: a, im: b };
}

/**
 * The magnitude (dB) and phase (degrees) of a numeric transfer function:
 * in s over ω in the coefficients' own units, around its corners (bode.js),
 * or -- `sAxis: 'normalized'`, s taken in units of 1/Ts -- over f/fs like a
 * z result, s = j 2 pi f; in z over normalized frequency f/fs from 10^-4 to
 * 1/2, z = e^{j 2 pi f}. Null when a coefficient is symbolic.
 */
export function responseCurve(value, variable, { pointsPerDecade = 40, sAxis = 'omega', at: extra = [] } = {}) {
  if (!value) return null;
  // `at`: frequencies on the curve's own axis to land on exactly (a band's
  // edges and centre), where a grid would step past a peak or a notch.
  if (value.kind === 'mixed') return withPointsAt(mixedCurve(value, { pointsPerDecade }), extra, (f) => mixedAt(value, f));
  if (variable === 's' && hasDelays(value)) {
    const normalized = sAxis === 'normalized';
    return withPointsAt(delayedCurve(value, { pointsPerDecade, sAxis }), extra, (f) => {
      const w = normalized ? 2 * Math.PI * f : f;
      const top = complexAt(value.numerator, w);
      const bottom = complexAt(value.denominator, w);
      return top && bottom ? cmul(top, cinv(bottom)) : null;
    });
  }
  const num = denseCoefficients(value.numerator, variable);
  const den = denseCoefficients(value.denominator, variable);
  if (!num || !den) return null;
  const ratioAt = (re, im) => {
    const top = evaluate(num, re, im);
    const bottom = evaluate(den, re, im);
    const d = bottom.re ** 2 + bottom.im ** 2;
    return [(top.re * bottom.re + top.im * bottom.im) / d, (top.im * bottom.re - top.re * bottom.im) / d];
  };
  if (variable === 's' && sAxis !== 'normalized') {
    const sketch = bodeSketch(num, den, { pointsPerDecade });
    const curve = { variable, axis: 'relative', points: sketch.points.map(({ w, db, phase }) => ({ f: w, db, phase })) };
    return withPointsAt(curve, extra, (w) => ratioAt(0, w));
  }
  // Over f/fs: z on the unit circle, or s up the imaginary axis.
  const at = variable === 's' ? (w) => ({ re: 0, im: w }) : (w) => ({ re: Math.cos(w), im: Math.sin(w) });
  const points = [];
  let previous = null;
  for (let i = 0; i <= Math.round(Math.log10(0.5 / 1e-4) * pointsPerDecade); i++) {
    const f = Math.min(0.5, 1e-4 * 10 ** (i / pointsPerDecade));
    const w = 2 * Math.PI * f;
    const point = at(w);
    const top = evaluate(num, point.re, point.im);
    const bottom = evaluate(den, point.re, point.im);
    const d = bottom.re ** 2 + bottom.im ** 2;
    const h = { re: (top.re * bottom.re + top.im * bottom.im) / d, im: (top.im * bottom.re - top.re * bottom.im) / d };
    let phase = (Math.atan2(h.im, h.re) * 180) / Math.PI;
    if (previous !== null) {
      while (phase - previous > 180) phase -= 360;
      while (phase - previous < -180) phase += 360;
    }
    previous = phase;
    points.push({ f, db: 20 * Math.log10(Math.hypot(h.re, h.im) || 1e-300), phase });
  }
  return withPointsAt({ variable, axis: 'normalized', points }, extra, (f) => {
    const w = 2 * Math.PI * f;
    return variable === 's' ? ratioAt(0, w) : ratioAt(Math.cos(w), Math.sin(w));
  });
}

/**
 * A curve with points added at `fs` (within its range, not already on it),
 * each from `hAt(f)` ([re, im], or null to skip), its phase unwrapped to
 * the point before it.
 */
function withPointsAt(curve, fs, hAt) {
  if (!curve || !fs?.length || curve.points.length < 2) return curve;
  const points = [...curve.points];
  const first = points[0].f;
  const last = points[points.length - 1].f;
  for (const f of fs) {
    if (!(f >= first && f <= last) || points.some((p) => Math.abs(p.f - f) <= 1e-12 * f)) continue;
    const h = hAt(f);
    if (!h || !h.every(Number.isFinite)) continue;
    const index = points.findIndex((p) => p.f > f);
    const before = points[index - 1];
    let phase = (Math.atan2(h[1], h[0]) * 180) / Math.PI;
    while (phase - before.phase > 180) phase -= 360;
    while (phase - before.phase < -180) phase += 360;
    points.splice(index, 0, { f, db: 20 * Math.log10(Math.hypot(h[0], h[1]) || 1e-300), phase });
  }
  return { ...curve, points };
}

// A complex number as [re, im].
const cmul = ([a, b], [c, d]) => [a * c - b * d, a * d + b * c];
const cinv = ([a, b]) => { const m = a * a + b * b; return [a / m, -b / m]; };

/** An expression's value at s = j w, its delays e^{-j w T}; null when a
 *  symbol other than a numeric delay is left. */
function complexAt(value, w) {
  switch (value?.kind) {
    case 'number': return [Number(value.numerator) / Number(value.denominator), 0];
    case 'symbol': {
      if (value.name === 's') return [0, w];
      const delay = DELAYS.get(value.name);
      if (!delay) return null;
      const t = evaluateExpression(delay, {});
      return [Math.cos(w * t), -Math.sin(w * t)];
    }
    case 'add': {
      let sum = [0, 0];
      for (const term of value.terms) {
        const v = complexAt(term, w);
        if (!v) return null;
        sum = [sum[0] + v[0], sum[1] + v[1]];
      }
      return sum;
    }
    case 'multiply': {
      let product = [1, 0];
      for (const factor of value.factors) {
        const v = complexAt(factor, w);
        if (!v) return null;
        product = cmul(product, v);
      }
      return product;
    }
    case 'power': {
      const base = complexAt(value.base, w);
      if (!base) return null;
      let out = [1, 0];
      for (let i = 0; i < Math.abs(value.exponent); i++) out = cmul(out, base);
      return value.exponent < 0 ? cinv(out) : out;
    }
    default: return null;
  }
}

/** The numeric delays of a result (its symbols' values all given). */
function numericDelays(value) {
  const names = new Set();
  expressionSymbols(value.numerator, 's', names);
  expressionSymbols(value.denominator, 's', names);
  const delays = [];
  for (const name of names) {
    if (!isDelayName(name)) return null;
    try { delays.push(evaluateExpression(DELAYS.get(name), {})); } catch { return null; }
  }
  return delays;
}

/**
 * The response of a result with delays, evaluated directly at s = j w: on
 * ω, from a decade under its slowest corner or longest delay to two over
 * its fastest (a delay T notches at multiples of 2 pi/T); on f/fs, delays
 * counted in sample periods. Null while a symbol has no value.
 */
function delayedCurve(value, { pointsPerDecade, sAxis }) {
  const delays = numericDelays(value);
  if (!delays || !delays.length || delays.some((t) => !Number.isFinite(t))) return null;
  const normalized = sAxis === 'normalized';
  let low = -4;
  let high = Math.log10(0.5);
  if (!normalized) {
    const spans = delays.map(Math.abs).filter((t) => t > 0);
    const tmin = spans.length ? Math.min(...spans) : 1;
    const tmax = spans.length ? Math.max(...spans) : 1;
    low = Math.log10(0.1 / tmax);
    high = Math.log10(100 / tmin);
    // Corners of the delay-free part (the delays set to 1) widen the range.
    const replacements = new Map([...expressionSymbols(value.numerator, 's'), ...expressionSymbols(value.denominator, 's')].filter(isDelayName).map((name) => [name, ONE]));
    try {
      const bare = substituteRational(value, replacements);
      const num = denseCoefficients(bare.numerator, 's');
      const den = denseCoefficients(bare.denominator, 's');
      if (num?.length && den) {
        const sketch = bodeSketch(num, den, { pointsPerDecade: 4 }).points.map((p) => p.w);
        if (sketch.length) {
          low = Math.min(low, Math.log10(Math.min(...sketch)));
          high = Math.max(high, Math.log10(Math.max(...sketch)));
        }
      }
    } catch { /* the delays' range alone */ }
    low = Math.floor(low);
    high = Math.ceil(high);
  }
  // Delays ripple: a finer grid than a rational's.
  const perDecade = Math.max(pointsPerDecade, 120);
  const count = Math.round((high - low) * perDecade);
  const points = [];
  let previous = null;
  for (let i = 0; i <= count; i++) {
    const f = 10 ** Math.min(high, low + i / perDecade);
    const w = normalized ? 2 * Math.PI * f : f;
    const top = complexAt(value.numerator, w);
    const bottom = complexAt(value.denominator, w);
    if (!top || !bottom) return null;
    const h = cmul(top, cinv(bottom));
    if (!h.every(Number.isFinite)) continue;
    let phase = (Math.atan2(h[1], h[0]) * 180) / Math.PI;
    if (previous !== null) {
      while (phase - previous > 180) phase -= 360;
      while (phase - previous < -180) phase += 360;
    }
    previous = phase;
    points.push({ f, db: 20 * Math.log10(Math.hypot(h[0], h[1]) || 1e-300), phase });
  }
  return { variable: 's', axis: normalized ? 'normalized' : 'relative', points };
}

/** A rational's value at a complex point (z, or s), its delays e^{-sT}
 *  taken at s = `sForDelays`. */
function rationalAt(value, point, variable, w) {
  const at = (expr) => complexAtPoint(expr, point, variable, w);
  const top = at(value.numerator);
  const bottom = at(value.denominator);
  return top && bottom ? cmul(top, cinv(bottom)) : null;
}

function complexAtPoint(value, point, variable, w) {
  switch (value?.kind) {
    case 'number': return [Number(value.numerator) / Number(value.denominator), 0];
    case 'symbol': {
      if (value.name === variable) return point;
      const delay = DELAYS.get(value.name);
      if (!delay || variable !== 's') return null;
      const t = evaluateExpression(delay, {});
      return [Math.cos(w * t), -Math.sin(w * t)];
    }
    case 'add': {
      let sum = [0, 0];
      for (const term of value.terms) {
        const v = complexAtPoint(term, point, variable, w);
        if (!v) return null;
        sum = [sum[0] + v[0], sum[1] + v[1]];
      }
      return sum;
    }
    case 'multiply': {
      let product = [1, 0];
      for (const factor of value.factors) {
        const v = complexAtPoint(factor, point, variable, w);
        if (!v) return null;
        product = cmul(product, v);
      }
      return product;
    }
    case 'power': {
      const base = complexAtPoint(value.base, point, variable, w);
      if (!base) return null;
      let out = [1, 0];
      for (let i = 0; i < Math.abs(value.exponent); i++) out = cmul(out, base);
      return value.exponent < 0 ? cinv(out) : out;
    }
    default: return null;
  }
}

/**
 * A continuous input's response through a sampled loop, over f/fs: each
 * term's z part at z = e^{j 2 pi f} times its s part at s = j 2 pi f / T.
 */
/** A mixed result's value at f/fs `f`, or null where a part has no number. */
function mixedAt(value, f) {
  const theta = 2 * Math.PI * f;
  const w = theta / value.period;
  let h = [0, 0];
  for (const term of value.terms) {
    const zPart = rationalAt(term.z, [Math.cos(theta), Math.sin(theta)], 'z', 0);
    const sPart = rationalAt(term.s, [0, w], 's', w);
    if (!zPart || !sPart) return null;
    const v = cmul(zPart, sPart);
    h = [h[0] + v[0], h[1] + v[1]];
  }
  return h;
}

function mixedCurve(value, { pointsPerDecade }) {
  const points = [];
  let previous = null;
  const perDecade = Math.max(pointsPerDecade, 120);
  const low = -4;
  const high = Math.log10(0.5);
  for (let i = 0; i <= Math.round((high - low) * perDecade); i++) {
    const f = 10 ** Math.min(high, low + i / perDecade);
    const h = mixedAt(value, f);
    if (!h) return null;
    if (!h.every(Number.isFinite)) continue;
    let phase = (Math.atan2(h[1], h[0]) * 180) / Math.PI;
    if (previous !== null) {
      while (phase - previous > 180) phase -= 360;
      while (phase - previous < -180) phase += 360;
    }
    previous = phase;
    points.push({ f, db: 20 * Math.log10(Math.hypot(h[0], h[1]) || 1e-300), phase });
  }
  return { variable: 'z', axis: 'normalized', points };
}

// ----- plots of several responses -----------------------------------------------------

/** Trace colors: distinct hues that read on light and dark paper alike. */
export const TRACE_COLORS = Object.freeze(['#3b74e0', '#e0533b', '#2e9e5b', '#c98a12', '#9356d6', '#1aa0a8', '#d6458f', '#6b7a8f']);

/**
 * A plot of several magnitude responses on one pair of axes, as a plot
 * annotation keeps it (model.js normalizePlot): `traces` are
 * `{ label (TeX), color, value (exact rational), variable? }` (`variable`
 * the default). On f/fs (`sAxis: 'normalized'`, or any z trace) s and z
 * results share the axis; on ω only s results plot. The frequency range
 * covers every trace. Null when none can be plotted.
 */
export function plotAxis(traces, sAxis = 'omega') {
  return traces.some((trace) => trace.variable === 'z') || sAxis === 'normalized' ? 'normalized' : 'omega';
}

/**
 * The signal band's edges in f/fs: `bw` from DC when `f0` is 0 (one line at
 * bw), else `f0 +- bw/2` (two). Empty when no bandwidth is set.
 */
/** A band's edges and its centre, f/fs: where a response is sampled exactly. */
export function bandFrequencies(band) {
  const f0 = Number(band?.f0) || 0;
  return [...bandEdges(band), ...(f0 > 0 && bandEdges(band).length ? [f0] : [])];
}

export function bandEdges(band) {
  const f0 = Number(band?.f0) || 0;
  const bw = Number(band?.bw);
  if (!(bw > 0)) return [];
  return f0 > 0 ? [f0 - bw / 2, f0 + bw / 2].filter((f) => f > 0) : [bw];
}

/**
 * The peak SQNR (dB) of a quantizer of `levels` levels whose error reaches
 * the output through `ntf` (a number-valued rational in z), over the signal
 * band: a full-scale sine (amplitude N - 1, Schreier's levels) against the
 * error taken as white, of variance Delta^2/12 = 1/3 (levels 2 apart)
 * spread over f/fs in (-1/2, 1/2), shaped by |NTF(e^{j 2 pi f})|^2 in band.
 * Null without a band or a number-valued z result.
 */
export function bandSqnr(ntf, levels, band) {
  const edges = bandEdges(band);
  if (!edges.length || !ntf || ntf.kind === 'mixed' || ntf.variable !== 'z') return null;
  const [f1, f2] = edges.length === 2 ? edges : [0, edges[0]];
  if (!(f2 > f1) || f2 > 0.5) return null;
  // Simpson's rule over the band.
  const steps = 4096;
  const h = (f2 - f1) / steps;
  let sum = 0;
  for (let i = 0; i <= steps; i++) {
    const theta = 2 * Math.PI * (f1 + i * h);
    const v = rationalAt(ntf, [Math.cos(theta), Math.sin(theta)], 'z', 0);
    if (!v) return null;
    const power = v[0] ** 2 + v[1] ** 2;
    sum += power * (i === 0 || i === steps ? 1 : i % 2 ? 4 : 2);
  }
  const inBand = (sum * h) / 3;
  const noise = 2 * (1 / 3) * inBand;
  const signal = (levels - 1) ** 2 / 2;
  return noise > 0 ? 10 * Math.log10(signal / noise) : Infinity;
}

/** `quantity` 'phase' plots each trace's phase (degrees) in place of its
 *  magnitude (dB), on the same frequency axis. */
/** `dbfs`, with a simulated spectrum: `{ offset(trace) }`, each trace's |H|
 *  moved into the spectrum's dBFS (a noise level, or a tone's level). */
export function responsePlot(traces, variable, { sAxis = 'omega', band = null, quantity = 'magnitude', background = [], dbfs = null } = {}) {
  const withVariable = traces.map((trace) => ({ ...trace, variable: trace.variable || variable }));
  const axis = plotAxis(withVariable, sAxis);
  // Each curve lands exactly on the band's edges and centre (on its own axis).
  const bandPoints = (variable) => bandFrequencies(band).map((f) => (variable === 's' && axis !== 'normalized' ? 2 * Math.PI * f : f));
  const curves = withVariable
    .map((trace) => ({ trace, curve: responseCurve(trace.value, trace.variable, { sAxis: axis, at: bandPoints(trace.variable) }) }))
    .filter(({ curve }) => curve && curve.points.length > 1);
  if (!curves.length) return null;
  const all = curves.flatMap(({ curve }) => curve.points.map((point) => point.f));
  const curveAxis = curves[0].curve.axis;
  const low = Math.floor(Math.log10(Math.min(...all)) + 1e-9);
  // A sampled system's frequencies end at f_s/2, where its curves do.
  const high = curveAxis === 'normalized' ? Math.log10(0.5) : Math.ceil(Math.log10(Math.max(...all)) - 1e-9);
  // The band's edges on this axis: f/fs as they are, or omega = 2 pi f with
  // s in units of 1/Ts.
  const edges = bandEdges(band).map((f) => (curveAxis === 'normalized' ? f : 2 * Math.PI * f));
  return {
    kind: 'response',
    axis: curveAxis,
    range: { low, high: Math.max(high, low + 1) },
    ...(edges.length ? { band: edges } : {}),
    ...(quantity === 'phase' ? { quantity: 'phase' } : {}),
    ...(dbfs && quantity !== 'phase' && curveAxis === 'normalized' ? { units: 'dBFS' } : {}),
    traces: [
      // Behind the curves: a simulated output's spectrum, on f/fs.
      ...(quantity !== 'phase' && curveAxis === 'normalized' ? background : []).map((trace) => ({ ...trace, background: true, points: trace.points.filter((p) => p.f <= 0.5) })),
      ...curves.map(({ trace, curve }) => {
        const offset = dbfs && quantity !== 'phase' && curveAxis === 'normalized' ? dbfs.offset(trace) : 0;
        return {
          label: trace.label,
          color: trace.color,
          points: curve.points.map(({ f, db, phase }) => ({ f, db: quantity === 'phase' ? phase : db + offset })),
        };
      }),
    ],
  };
}

// ----- coefficients given values ------------------------------------------------------

/** The symbols a result depends on, besides its variable (`a_1`, `k`);
 *  a delay e^{-sT} contributes the symbols of its T. */
export function resultSymbols(value, variable) {
  if (value?.kind === 'sampled') return value.symbols;
  const found = new Set();
  expressionSymbols(value.numerator, variable, found);
  expressionSymbols(value.denominator, variable, found);
  const out = new Set();
  for (const name of found) {
    if (isDelayName(name)) expressionSymbols(DELAYS.get(name), variable, out);
    else out.add(name);
  }
  return [...out].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** Every coefficient a diagram's parts name: its blocks' (a delay's T
 *  included), its gains', its samplers' periods. */
export function diagramSymbols(circuit) {
  const out = new Set();
  for (const component of circuit.components.values()) {
    try {
      if (Object.hasOwn(TRANSFER_FUNCTION_TYPES, component.type)) {
        for (const name of resultSymbols(blockTransferFunction(component), TRANSFER_FUNCTION_TYPES[component.type])) out.add(name);
      } else if (component.type === 'gain' || component.type === 'sampler') {
        expressionSymbols(coefficientValue(parseGain(component.value || 'T')), 's', out);
      }
    } catch { /* a part that does not read names nothing */ }
  }
  return [...out].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** A result with its symbols given numbers (`{ a_1: 0.5 }`), still exact;
 *  a delay e^{-sT} becomes the delay of T's number. */
export function withCoefficients(value, values) {
  if (value?.kind === 'sampled') return value.at(values || {});
  const replacements = new Map();
  for (const [name, number] of Object.entries(values || {})) {
    if (Number.isFinite(number)) replacements.set(name, coefficientValue(String(Number(number.toPrecision(12)))));
  }
  if (!replacements.size) return value;
  const found = new Set();
  expressionSymbols(value.numerator, value.variable, found);
  expressionSymbols(value.denominator, value.variable, found);
  for (const name of found) {
    if (!isDelayName(name)) continue;
    const delay = DELAYS.get(name);
    const given = substitute(delay, replacements);
    // No delay at all is e^0 = 1.
    if (given.kind === 'number' && given.numerator === 0n) replacements.set(name, ONE);
    else if (keyOf(given) !== keyOf(delay)) replacements.set(name, delaySymbol(given));
  }
  return cancelCommonPolynomialFactor(substituteRational(value, replacements), { variable: value.variable });
}

/** The zeros and poles of a result, numeric once its symbols have values;
 *  null with a delay, which has infinitely many. */
export function numericRootsOf(value) {
  if (!value || value.kind === 'mixed') return { zeros: null, poles: null, delayed: false };
  const variable = value.variable;
  if (hasDelays(value)) return { zeros: null, poles: null, delayed: true };
  return {
    delayed: false,
    zeros: numericRoots(coefficientList(value.numerator, variable)),
    poles: numericRoots(coefficientList(value.denominator, variable)),
  };
}

/** The coefficients that set a diagram's timing rather than its gains: its
 *  samplers' periods and the T of every delay e^{-sT} (an optimizer keeps
 *  them as they are). */
export function timingSymbols(circuit) {
  const out = new Set();
  for (const component of circuit.components.values()) {
    try {
      if (component.type === 'sampler') expressionSymbols(coefficientValue(parseGain(component.value || 'T')), 's', out);
      else if (TRANSFER_FUNCTION_TYPES[component.type] === 's') {
        const value = blockTransferFunction(component);
        const found = new Set();
        expressionSymbols(value.numerator, 's', found);
        expressionSymbols(value.denominator, 's', found);
        for (const name of found) if (isDelayName(name)) expressionSymbols(DELAYS.get(name), 's', out);
      }
    } catch { /* a part that does not read names nothing */ }
  }
  return [...out].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * A number-valued result's value at f/fs, as [re, im]: z = e^{j 2 pi f}, s =
 * j 2 pi f (s in units of 1/Ts, its delays included), or a continuous input
 * through a sampled loop (its z part times its s part, s = j 2 pi f / T).
 * Null while a symbol has no number.
 */
export function responseAt(value, variable, f) {
  const theta = 2 * Math.PI * f;
  if (!value) return null;
  if (value.kind === 'mixed') {
    const w = theta / value.period;
    let h = [0, 0];
    for (const term of value.terms) {
      const zPart = rationalAt(term.z, [Math.cos(theta), Math.sin(theta)], 'z', 0);
      const sPart = rationalAt(term.s, [0, w], 's', w);
      if (!zPart || !sPart) return null;
      const v = cmul(zPart, sPart);
      h = [h[0] + v[0], h[1] + v[1]];
    }
    return h;
  }
  return variable === 'z' ? rationalAt(value, [Math.cos(theta), Math.sin(theta)], 'z', 0) : rationalAt(value, [0, theta], 's', theta);
}
