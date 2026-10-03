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

import { add, integer, multiply, negate, polynomialCoefficients, power, rational, rationalFunction, substituteRational, symbol } from './rational.js';
import { createRationalOps } from './algebra-ops.js';
import { cancelCommonPolynomialFactor } from './polynomial-gcd.js';
import { renderExpression } from './present.js';
import { bodeSketch, expressionSymbols, polynomialRoots } from './bode.js';
import { TRANSFER_FUNCTION_TYPES, parseGain, parseTransferFunction } from '../transfer-function.js';
import { canonicalNetName } from '../model.js';

const JUNCTIONS = new Set(['signal_sum', 'signal_multiply', 'gain']);
const JUNCTION_INPUTS = ['n', 's', 'w'];
const SOURCE_TYPES = new Set(['input']);
// Parts that may sit on a signal wire without taking part in it.
const PASSIVE_TYPES = new Set(['solder', 'output', 'port', 'inputoutput']);

function isSignalPart(component) {
  return JUNCTIONS.has(component.type) || Object.hasOwn(TRANSFER_FUNCTION_TYPES, component.type);
}

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

/** A block's transfer function as an exact rational in s, or in z (z^-1
 *  definitions are written over the same power of z). */
export function blockTransferFunction(component) {
  const variable = TRANSFER_FUNCTION_TYPES[component.type];
  const { num, den, inverse } = parseTransferFunction(component.value, variable);
  const v = symbol(variable);
  const polynomial = (tokens, degree) => add(...tokens.map((token, i) => multiply(coefficientValue(token), power(v, degree(i)))));
  if (inverse) {
    const m = Math.max(num.length, den.length) - 1;
    return rationalFunction(polynomial(num, (i) => m - i), polynomial(den, (i) => m - i), { variable });
  }
  return rationalFunction(polynomial(num, (i) => num.length - 1 - i), polynomial(den, (i) => den.length - 1 - i), { variable });
}

// ----- solving ------------------------------------------------------------------------

function failure(code, error, issues = []) {
  return { ok: false, code, error, issues };
}

/**
 * Analyze the drawing. `options`: `output` (a signal key, a net name or id,
 * or a port's refdes) and `sources` (`{ [refdes]: 'input' | 'zero' |
 * { constant: value } }`; a source left out is zero). Returns `{ ok,
 * variable, output, entries, issues }`, an entry per input:
 * `{ input, value (exact rational), tex, equation, poles, zeros }`.
 */
export function analyzeSignalFlow(circuit, options = {}) {
  const { signals, sources, issues } = signalFlowGraph(circuit);
  if (issues.length) return failure(issues[0].code, issues[0].message, issues);
  const parts = [...circuit.components.values()].filter(isSignalPart);
  const domains = new Set(parts.map((component) => TRANSFER_FUNCTION_TYPES[component.type]).filter(Boolean));
  if (domains.size > 1) return failure('mixed-domains', 'the diagram mixes H(s) and H(z) blocks: a sampled loop needs a sampler and a conversion, which are not supported yet');
  const variable = domains.has('z') ? 'z' : 's';

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

  // Unknowns: every signal a block or junction drives.
  const unknowns = [...signals.values()].filter((signal) => signal.driver && !signal.driver.source);
  const index = new Map(unknowns.map((signal, i) => [signal.key, i]));
  // A big diagram's exact algebra is big: give it room, the elimination
  // below keeps it as small as the diagram allows.
  const ops = createRationalOps({ variable, maxOperations: 20_000_000 });
  const n = unknowns.length;
  const A = Array.from({ length: n }, () => Array(n).fill(ops.zero));
  const B = Array.from({ length: n }, () => Array(inputs.length).fill(ops.zero));
  const inputColumn = new Map(inputs.map((source, column) => [source.key, column]));
  const toRational = (value) => (value?.kind === 'rational' ? value : rationalFunction(value, integer(1), { variable }));
  const signalAt = (component, term) => {
    for (const signal of signals.values()) {
      if (signal.readers.some((reader) => reader.comp === component.refdes && reader.term === term)) return signal;
    }
    return null;
  };
  // y = sum of gain * x over its inputs: x unknown -> into A; x an input
  // source -> into B; zero and constant sources drop out (superposition).
  const feed = (row, gain, signal) => {
    if (!signal) return;
    if (index.has(signal.key)) A[row][index.get(signal.key)] = ops.sub(A[row][index.get(signal.key)], gain);
    else if (inputColumn.has(signal.key)) B[row][inputColumn.get(signal.key)] = ops.add(B[row][inputColumn.get(signal.key)], gain);
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
      feed(row, toRational(h), signalAt(component, 'in'));
    } else if (component.type === 'gain') {
      let k;
      try {
        k = coefficientValue(parseGain(component.value));
      } catch (err) {
        return failure('bad-gain', `${component.refdes}: ${err.message}`);
      }
      feed(row, toRational(k), signalAt(component, 'in'));
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
      feed(row, toRational(gain), varying[0]);
    }
  }

  const outputSource = sourceBySignal.get(output.key);
  let columns;
  if (index.has(output.key)) {
    const solved = eliminateSignals(A, B, index.get(output.key), ops, variable);
    if (!solved.ok) return failure(solved.code, solved.error);
    columns = solved.columns;
  } else if (outputSource) {
    columns = inputs.map((source) => (source.key === output.key ? ops.one : ops.zero));
  } else {
    return failure('no-output', `signal ${output.display} is not driven`);
  }

  const entries = inputs.map((source, column) => present(columns[column], variable, source, output));
  return { ok: true, variable, output: { key: output.key, name: output.display }, entries, issues: [] };
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
  const G = A.map((row, y) => new Map(row.flatMap((a, x) => (x !== y && !ops.isZero(a) ? [[x, ops.neg(a)]] : []))));
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

/** Coefficient times a power of the variable, as one signed term. */
function termTex(coefficient, powerText) {
  let tex = renderExpression(coefficient);
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
export function transferTex(value, variable) {
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
  const render = (list) => sumTex(order(list).map(({ power: p, coefficient }) => termTex(coefficient, powerText(p))));
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
  if (Math.abs(root.im) < 1e-12) return fmt(root.re);
  const re = Math.abs(root.re) < 1e-12 ? '' : fmt(root.re);
  const im = `${fmt(Math.abs(root.im))}j`;
  return re ? `${re} ${root.im < 0 ? '-' : '+'} ${im}` : `${root.im < 0 ? '-' : ''}${im}`;
}

function present(value, variable, source, output) {
  const tex = transferTex(value, variable);
  const label = `\\frac{${texName(output.display)}}{${texName(source.name)}}`;
  return {
    input: source.id,
    inputName: source.name,
    value,
    tex,
    label,
    equation: `${label} = ${tex}`,
    zeros: numericRoots(coefficientList(value.numerator, variable)),
    poles: numericRoots(coefficientList(value.denominator, variable)),
  };
}

/** A signal's name in TeX, as it was written (V_{OUT} keeps its markup). */
function texName(name) {
  return String(name);
}

// ----- frequency response -------------------------------------------------------------

function denseCoefficients(value, variable) {
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
export function responseCurve(value, variable, { pointsPerDecade = 40, sAxis = 'omega' } = {}) {
  const num = denseCoefficients(value.numerator, variable);
  const den = denseCoefficients(value.denominator, variable);
  if (!num || !den) return null;
  if (variable === 's' && sAxis !== 'normalized') {
    const sketch = bodeSketch(num, den, { pointsPerDecade });
    return { variable, axis: 'relative', points: sketch.points.map(({ w, db, phase }) => ({ f: w, db, phase })) };
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
  return { variable, axis: 'normalized', points };
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

export function responsePlot(traces, variable, { sAxis = 'omega' } = {}) {
  const withVariable = traces.map((trace) => ({ ...trace, variable: trace.variable || variable }));
  const axis = plotAxis(withVariable, sAxis);
  const curves = withVariable
    .map((trace) => ({ trace, curve: responseCurve(trace.value, trace.variable, { sAxis: axis }) }))
    .filter(({ curve }) => curve && curve.points.length > 1);
  if (!curves.length) return null;
  const all = curves.flatMap(({ curve }) => curve.points.map((point) => point.f));
  const curveAxis = curves[0].curve.axis;
  const low = Math.floor(Math.log10(Math.min(...all)) + 1e-9);
  // A sampled system's frequencies end at f_s/2, where its curves do.
  const high = curveAxis === 'normalized' ? Math.log10(0.5) : Math.ceil(Math.log10(Math.max(...all)) - 1e-9);
  return {
    kind: 'response',
    axis: curveAxis,
    range: { low, high: Math.max(high, low + 1) },
    traces: curves.map(({ trace, curve }) => ({
      label: trace.label,
      color: trace.color,
      points: curve.points.map(({ f, db }) => ({ f, db })),
    })),
  };
}

// ----- coefficients given values ------------------------------------------------------

/** The symbols a result depends on, besides its variable (`a_1`, `k`). */
export function resultSymbols(value, variable) {
  const out = new Set();
  expressionSymbols(value.numerator, variable, out);
  expressionSymbols(value.denominator, variable, out);
  return [...out].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** A result with its symbols given numbers (`{ a_1: 0.5 }`), still exact. */
export function withCoefficients(value, values) {
  const replacements = new Map();
  for (const [name, number] of Object.entries(values || {})) {
    if (Number.isFinite(number)) replacements.set(name, coefficientValue(String(Number(number.toPrecision(12)))));
  }
  if (!replacements.size) return value;
  return cancelCommonPolynomialFactor(substituteRational(value, replacements), { variable: value.variable });
}

/** The zeros and poles of a result, numeric once its symbols have values. */
export function numericRootsOf(value) {
  const variable = value.variable;
  return {
    zeros: numericRoots(coefficientList(value.numerator, variable)),
    poles: numericRoots(coefficientList(value.denominator, variable)),
  };
}
