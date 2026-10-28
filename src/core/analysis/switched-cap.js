/**
 * Switched-capacitor analysis: a drawn SC circuit's exact z-domain transfer
 * function, by charge conservation from phase to phase.
 *
 * The clock is the timing diagram's (or, without one, the beats'): one
 * period steps through its states, and in each a switch is closed while its
 * phase is high (timing-diagram.js timingStates). Within a state, closed
 * switches join nodes into one; every joined node is then one of:
 *
 * - **held**: on the AC ground (a rail, ground, or an input port not under
 *   test) at 0, or on the input under test at its sample u;
 * - **driven**: an op-amp's output, whatever its feedback asks;
 * - **floating**: everything else, whose charge -- the sum over the
 *   capacitor plates on it of C (v - v_other) -- is what those same plates
 *   held at the end of the state before (one z^-1 back across the period's
 *   start).
 *
 * An op-amp is ideal: its inputs at one voltage (a virtual short), no
 * current into them; a fully differential one's outputs also average to
 * ground (an ideal common-mode feedback). The input is a sample held for a
 * whole period, u[n] (as a sample-and-hold drives it), and the output is
 * read at the end of one state of that period: H(z) = V_out(z) / U(z) solves
 * every state's equations at once.
 *
 * A capacitor is its value when that is a coefficient (C_S, 2*C_u), else
 * the symbol the small-signal analysis gives it (its refdes: CS, C1). Anything an SC circuit is not made of -- a resistor, a
 * transistor -- is refused, as is a state the equations do not determine
 * (an op-amp without feedback, an input shorted to ground): the analysis
 * says so rather than guessing.
 */

import { resolveAnalysisContext, AC_GROUND } from './context.js';
import { createRationalOps } from './algebra-ops.js';
import { solveLinearSystem } from './solve.js';
import { cancelCommonPolynomialFactor } from './polynomial-gcd.js';
import { integer, polynomialCoefficients, rational, rationalFunction, substitute, symbol } from './rational.js';
import { expressionSymbols } from './bode.js';
import { coefficientValue, numericRootsOf, transferTex } from './signal-flow.js';
import { parseGain } from '../transfer-function.js';
import { timingStates } from '../timing-diagram.js';
import { samePhase, switchGroupKey, switchState, switchStateAt } from '../beats.js';
import { analyzedCircuit, isReferenceMarker } from '../model.js';
import { opampModel } from './devices.js';
import { switchedCapNoise } from './switched-cap-noise.js';

const VARIABLE = 'z';
// Drawn parts that carry no charge and no current of their own: ports and
// solder dots (rails and ground are reference markers, isReferenceMarker).
const PORTS = new Set(['input', 'output', 'inputoutput', 'port', 'solder']);
const OPAMPS = new Set(['opamp', 'opamp_diff', 'opamp_diff_cmfb']);

function failure(code, error, extra = {}) {
  return { ok: false, code, error, ...extra };
}

/**
 * The clock's states, each with the switches closed in it: from the timing
 * diagram, else from the beats (one state a beat). Returns
 * `{ ok, states: [{ name, closed: Set of refdes }], source }` or a failure.
 */
export function switchedCapPhases(circuit) {
  circuit = analyzedCircuit(circuit);
  const switches = [...circuit.components.values()].filter((component) => switchState(component));
  if (!switches.length) return failure('no-switches', 'There are no switches: a switched-capacitor circuit switches its capacitors.');
  const states = timingStates(circuit);
  if (states?.length) {
    return {
      ok: true,
      source: 'timing',
      states: states.map((state) => ({
        name: state.name,
        closed: new Set(switches.filter((s) => [...state.closed].some((key) => samePhase(key, switchGroupKey(s)))).map((s) => s.refdes)),
      })),
    };
  }
  if (circuit.beats?.length) {
    return {
      ok: true,
      source: 'beats',
      states: circuit.beats.map((beat, index) => ({
        name: beat.name || `beat ${index + 1}`,
        closed: new Set(switches.filter((s) => switchStateAt(circuit, s.refdes, index) === 'closed').map((s) => s.refdes)),
      })),
    };
  }
  return failure('no-phases', 'Draw a timing diagram (or beats) first: it says which switches close in each phase.');
}

/** Joined nodes: a small union-find over node names. */
function joiner() {
  const parent = new Map();
  const find = (node) => {
    if (!parent.has(node)) parent.set(node, node);
    let root = node;
    while (parent.get(root) !== root) root = parent.get(root);
    parent.set(node, root);
    return root;
  };
  return { find, join: (a, b) => parent.set(find(a), find(b)) };
}

/**
 * Analyze a drawn SC circuit. `options`: `input`, `output` (as the
 * small-signal analysis takes them; one of each is found when the drawing
 * has only one), `readout` (the state whose end the output is read at: its
 * index, or its name; the last by default). Returns `{ ok, variable: 'z',
 * value (H(z), exact), tex, equation, states, readout, zeros, poles,
 * capacitors }` or a failure `{ ok: false, code, error }`.
 */
export function analyzeSwitchedCap(circuit, options = {}) {
  circuit = analyzedCircuit(circuit);
  const phases = switchedCapPhases(circuit);
  if (!phases.ok) return phases;
  const { states } = phases;
  if (states.length < 2) return failure('one-phase', 'The clock has one state only: nothing switches, so nothing is sampled. Give the timing diagram two phases or more.');

  const context = resolveAnalysisContext(circuit, { input: options.input, output: options.output });
  if (!context.ok) return failure('ports', context.error);
  const node = (refdes, term) => context.terminalNodes.get(`${refdes}.${term}`) ?? null;
  const inputNode = context.input.node;
  const outputNode = context.output.node;

  // The parts: capacitors, switches, op-amps; markers carry nothing, and a
  // chopper is a short the context has already joined its nets through.
  const capacitors = [];
  const switches = [];
  const opamps = [];
  for (const component of circuit.components.values()) {
    const type = component.type;
    if (type === 'capacitor' || type === 'variable_capacitor') {
      const a = node(component.refdes, 'a');
      const b = node(component.refdes, 'b');
      if (a && b && a !== b) capacitors.push({ refdes: component.refdes, a, b, value: capacitance(component) });
    } else if (switchState(component)) {
      const a = node(component.refdes, 'a');
      const b = node(component.refdes, 'b');
      if (a && b) switches.push({ refdes: component.refdes, a, b });
    } else if (OPAMPS.has(type)) {
      const terms = type === 'opamp' ? ['ip', 'im', 'o'] : ['ip', 'im', 'op', 'om'];
      const nodes = Object.fromEntries(terms.map((term) => [term, node(component.refdes, term)]));
      const missing = terms.filter((term) => !nodes[term]);
      if (missing.length) return failure('unconnected', `${component.refdes}: ${missing.join(', ')} not connected`);
      // Its gain as the small-signal analysis models it: ideal, or finite
      // A (A1 for U1). A gain-bandwidth needs settling in time, which
      // charge from phase to phase does not see.
      const { model, parameter } = opampModel(component);
      if (model === 'gbw') return failure('opamp-model', `${component.refdes} is modeled by its gain-bandwidth, which needs settling in time within a phase: this analysis takes an ideal or a finite-gain op-amp (its small-signal parameters).`);
      opamps.push({ refdes: component.refdes, type, ...nodes, gain: model === 'finite-gain' ? parameter : null });
    } else if (!PORTS.has(type) && type !== 'chopper' && !isReferenceMarker(component)) {
      return failure('unsupported-part', `${component.refdes} (${type}): the switched-capacitor analysis takes capacitors, switches, op-amps, and ports.`);
    }
  }
  if (!capacitors.length) return failure('no-capacitors', 'There are no capacitors to switch.');
  // A stray capacitance asked for (switchedCapStrays): one more capacitor,
  // from its node to ground, in a symbol of its own.
  for (const stray of options.strays || []) capacitors.push({ refdes: stray.name, a: stray.node, b: AC_GROUND, value: symbol(stray.name), stray: true });

  // Each state: its joined nodes and what holds each.
  const outputsOf = (opamp) => (opamp.type === 'opamp' ? [opamp.o] : [opamp.op, opamp.om]);
  const allNodes = new Set([AC_GROUND, inputNode, outputNode, ...capacitors.flatMap((c) => [c.a, c.b]), ...switches.flatMap((s) => [s.a, s.b]), ...opamps.flatMap((o) => [o.ip, o.im, ...outputsOf(o)])]);
  const layouts = [];
  for (const state of states) {
    const { find, join } = joiner();
    for (const s of switches) if (state.closed.has(s.refdes)) join(s.a, s.b);
    const groups = new Map(); // root -> { index, kind }
    const groupOf = (n) => {
      const root = find(n);
      if (!groups.has(root)) groups.set(root, { index: groups.size, kind: 'floating', root, drivers: [] });
      return groups.get(root);
    };
    for (const n of allNodes) groupOf(n);
    const ground = groupOf(AC_GROUND);
    ground.kind = 'ground';
    const input = groupOf(inputNode);
    if (input === ground) return failure('input-shorted', `In ${state.name} the input is switched to ground.`);
    input.kind = 'input';
    for (const opamp of opamps) {
      for (const out of outputsOf(opamp)) {
        const group = groupOf(out);
        if (group.kind !== 'floating' && group.kind !== 'driven') return failure('output-shorted', `In ${state.name} ${opamp.refdes}'s output is switched onto ${group.kind === 'ground' ? 'ground' : 'the input'}.`);
        if (group.kind === 'driven') return failure('output-shorted', `In ${state.name} two op-amp outputs are switched together (${group.drivers.join(', ')} and ${opamp.refdes}).`);
        group.kind = 'driven';
        group.drivers.push(opamp.refdes);
      }
    }
    layouts.push({ state, groupOf, groups: [...groups.values()] });
  }

  // What a period carries from phase to phase is each capacitor's voltage
  // (vc = v_a - v_b). A phase is solved alone, its nodes in terms of the
  // input u and the voltages the phase before left: a small system in the
  // capacitances only. It gives vc_k = M_k vc_(k-1) + n_k u; around the
  // period, the last phase's vc is s = z^-1 Phi s + gamma u, and only that
  // -- as large as the number of capacitors -- is solved in z.
  const ops = createRationalOps({ variable: VARIABLE, maxOperations: options.maxOperations });
  // `numbers` puts numbers in for the capacitances and gains before solving
  // (the calculator's route: quick for any circuit).
  const numbers = options.numbers ? new Map(Object.entries(options.numbers).map(([name, number]) => [name, exactNumber(number)])) : null;
  const lift = numbers ? (expression) => ops.add(ops.zero, substitute(expression, numbers)) : (expression) => ops.add(ops.zero, expression);
  const n = capacitors.length;
  const width = 1 + n; // a node as [u, vc_1 .. vc_n] (before the phase)
  const values = capacitors.map((cap) => lift(cap.value));

  const phaseMaps = [];
  for (const layout of layouts) {
    const columns = new Map();
    for (const group of layout.groups) if (group.kind !== 'ground' && group.kind !== 'input') columns.set(group, columns.size);
    const size = columns.size;
    const A = [];
    const B = [];
    const newRow = () => {
      A.push(Array(size).fill(ops.zero));
      B.push(Array(width).fill(ops.zero));
      return A.length - 1;
    };
    // `value` times node `node`'s voltage now, into row `r`; a held node's
    // goes to the right-hand side (the input as u, ground as nothing).
    const term = (r, node, value) => {
      const group = layout.groupOf(node);
      if (group.kind === 'ground') return;
      if (group.kind === 'input') { B[r][0] = ops.sub(B[r][0], value); return; }
      const column = columns.get(group);
      A[r][column] = ops.add(A[r][column], value);
    };
    for (const group of layout.groups) {
      if (group.kind !== 'floating') continue;
      // Floating: its plates' charge now, C (v_here - v_there), is what they
      // held before: +C vc on a plate a, -C vc on a plate b.
      const plates = [];
      for (const [i, cap] of capacitors.entries()) {
        // A capacitor with both plates here (shorted) holds no charge.
        if (layout.groupOf(cap.a) === layout.groupOf(cap.b)) continue;
        if (layout.groupOf(cap.a) === group) plates.push({ i, here: cap.a, there: cap.b, sign: 1 });
        if (layout.groupOf(cap.b) === group) plates.push({ i, here: cap.b, there: cap.a, sign: -1 });
      }
      if (!plates.length) {
        // No capacitor on it: its voltage moves nothing, unless an op-amp
        // input is on it -- then the op-amp's other input sets it.
        const opampInput = opamps.some((o) => layout.groupOf(o.ip) === group || layout.groupOf(o.im) === group);
        if (!opampInput) term(newRow(), group.root, ops.one);
        continue;
      }
      const r = newRow();
      for (const { i, here, there, sign } of plates) {
        term(r, here, values[i]);
        term(r, there, ops.neg(values[i]));
        B[r][1 + i] = ops.add(B[r][1 + i], sign > 0 ? values[i] : ops.neg(values[i]));
      }
    }
    // The op-amps: inputs at one voltage (ideal), or the output A times
    // their difference (v_ip - v_im - v_o / A = 0); a differential one's
    // outputs about ground.
    for (const opamp of opamps) {
      const r = newRow();
      term(r, opamp.ip, ops.one);
      term(r, opamp.im, ops.neg(ops.one));
      if (opamp.gain) {
        const inverse = ops.div(ops.one, lift(symbol(opamp.gain)));
        if (opamp.type === 'opamp') term(r, opamp.o, ops.neg(inverse));
        else {
          term(r, opamp.op, ops.neg(inverse));
          term(r, opamp.om, inverse);
        }
      }
      if (opamp.type !== 'opamp') {
        const cm = newRow();
        term(cm, opamp.op, ops.one);
        term(cm, opamp.om, ops.one);
      }
    }
    const undetermined = () => failure('undetermined', `In ${layout.state.name} the circuit has no definite solution: an op-amp without feedback, or a node nothing sets (check which switches close then).`);
    if (A.length !== size) return undetermined();
    const solved = size ? solveLinearSystem(A, B, { ops }) : { ok: true, values: [] };
    if (!solved.ok) return /budget/i.test(solved.error || '') ? failure('budget', 'The circuit is too large to solve exactly.') : undetermined();
    // Any node now, as [u, vc_1 .. vc_n].
    const nodeRow = (node) => {
      const group = layout.groupOf(node);
      if (group.kind === 'ground') return Array(width).fill(ops.zero);
      if (group.kind === 'input') return [ops.one, ...Array(n).fill(ops.zero)];
      return solved.values[columns.get(group)];
    };
    const vc = capacitors.map((cap) => nodeRow(cap.a).map((value, j) => ops.sub(value, nodeRow(cap.b)[j])));
    phaseMaps.push({
      M: vc.map((row) => row.slice(1)),
      gain: vc.map((row) => row[0]),
      output: nodeRow(outputNode),
    });
  }
  if (phaseMaps.some((map) => map.output?.some?.((value) => value?.budgetExceeded))) return failure('budget', 'The circuit is too large to solve exactly.');

  const readout = readoutIndex(states, options.readout);
  if (readout < 0) return failure('readout', `There is no state "${options.readout}" to read the output in.`);

  // Small matrix algebra over the exact rationals.
  const times = (M, v) => M.map((row) => row.reduce((sum, value, j) => ops.add(sum, ops.mul(value, v[j])), ops.zero));
  const matrixTimes = (M, N) => M.map((row) => N[0].map((_, j) => row.reduce((sum, value, k) => ops.add(sum, ops.mul(value, N[k][j])), ops.zero)));
  const plus = (a, b) => a.map((value, i) => ops.add(value, b[i]));
  const identity = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? ops.one : ops.zero)));
  // Around the period: s = z^-1 Phi s + gamma u (vc after the last phase).
  let Phi = identity;
  let gamma = Array(n).fill(ops.zero);
  for (const map of phaseMaps) {
    Phi = matrixTimes(map.M, Phi);
    gamma = plus(times(map.M, gamma), map.gain);
  }
  const zInverse = ops.div(ops.one, lift(symbol(VARIABLE)));
  const loop = identity.map((row, i) => row.map((value, j) => ops.sub(value, ops.mul(zInverse, Phi[i][j]))));
  const settled = n ? solveLinearSystem(loop, gamma.map((value) => [value]), { ops }) : { ok: true, values: [] };
  if (!settled.ok) return failure(/budget/i.test(settled.error || '') ? 'budget' : 'undetermined', /budget/i.test(settled.error || '') ? 'The circuit is too large to solve exactly.' : 'The phases\' equations have no single solution.');
  const last = settled.values.map((row) => row[0]);
  // The voltages the readout phase starts from: the period before's last,
  // then the phases of this one up to it.
  let before = last.map((value) => ops.mul(zInverse, value));
  for (let k = 0; k < readout; k += 1) before = plus(times(phaseMaps[k].M, before), phaseMaps[k].gain);
  const out = phaseMaps[readout].output;
  const raw = out.slice(1).reduce((sum, coefficient, j) => ops.add(sum, ops.mul(coefficient, before[j])), out[0]);
  if (raw?.budgetExceeded) return failure('budget', 'The circuit is too large to solve exactly.');
  // A capacitor reset every period is a state the input never reaches: its
  // pole and zero cancel, and the result is as low an order as it really is.
  // A factor in the capacitances alone ((C_S + C_F)^2 over and under) goes
  // too: each capacitance in turn taken as the variable.
  const value = cancelCapacitanceFactors(cancelCommonPolynomialFactor(raw, { variable: VARIABLE, maxWork: 400_000 }), capacitors, opamps.map((opamp) => opamp.gain).filter(Boolean));

  // kT/C noise, in the same symbols (over kT), when asked for (it is its
  // own, heavier work); its failure leaves H(z).
  let noise = null;
  if (options.noise) try {
    // Its own budget: the transfer function's may be spent.
    // In symbols it can grow past reading (unmatched halves): then it is
    // refused, quickly, and the calculator's numbers still come.
    const noiseOps = createRationalOps({ variable: VARIABLE, maxOperations: options.noiseMaxOperations ?? (numbers ? 2_000_000 : 300_000) });
    const noiseLift = numbers ? (expression) => noiseOps.add(noiseOps.zero, substitute(expression, numbers)) : (expression) => noiseOps.add(noiseOps.zero, expression);
    noise = switchedCapNoise({ states, layouts, capacitors, switches, opamps, nodes: { ground: AC_GROUND, input: inputNode, output: outputNode }, ops: noiseOps, lift: noiseLift, maxTerms: numbers ? 0 : 400, phaseMaps, Phi, readout, transfer: value, variable: VARIABLE });
    if (noiseOps.budget.exceeded || noise.tooLarge) noise = { ok: false, error: numbers ? 'The noise is too large to work out.' : 'The noise is too large to show in symbols; the calculator still gives its numbers.' };
  } catch (error) {
    noise = { ok: false, error: error.message };
  }
  if (noise?.ok) {
    const gainNames = opamps.map((opamp) => opamp.gain).filter(Boolean);
    const tidy = (entry) => ({ input: cancelCapacitanceFactors(entry.input, capacitors, gainNames) });
    noise = { ok: true, contributors: noise.contributors.map((contributor) => ({ ...contributor, ...tidy(contributor) })), total: tidy(noise.total) };
  }

  // In the textbook form: the denominator's constant term 1 (C_F divided out).
  const tex = transferTex(value, VARIABLE, { symbolicLead: true });
  const label = `\\frac{${texName(context.output.name)}}{${texName(context.input.name)}}`;
  return {
    ok: true,
    variable: VARIABLE,
    source: phases.source,
    states: states.map((state) => ({ name: state.name, closed: [...state.closed] })),
    readout,
    input: context.input.name,
    output: context.output.name,
    capacitors: capacitors.filter((cap) => !cap.stray).map((cap) => cap.refdes),
    // The op-amps' finite gains' symbols (A1), apart from the capacitances.
    gains: opamps.filter((opamp) => opamp.gain).map((opamp) => opamp.gain),
    // Every symbol a number can be given for: the capacitances, the gains.
    symbols: [...new Set([...capacitors.flatMap((cap) => [...expressionSymbols(cap.value, VARIABLE)]), ...opamps.map((opamp) => opamp.gain).filter(Boolean)])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    value,
    tex,
    label,
    equation: `${label} = ${tex}`,
    noise,
    ...numericRootsOf(value),
  };
}

/** The stray capacitance switchedCapStrays puts at a node. */
export const STRAY = 'C_{p}';

/**
 * Which capacitor plates' strays reach the output: for each node a
 * capacitor plate sits on (ground aside), H(z) again with a capacitance
 * C_p from that node to ground. A node that is always held -- by the
 * input, ground, an ideal op-amp's virtual ground, or its output -- gives
 * the same H(z): its strays are harmless (the stray-insensitive
 * integrator's every plate). One that floats in some phase gives an H(z)
 * in C_p. `options` as analyzeSwitchedCap's. Returns `{ ok, nodes: [{
 * node, name, plates: [refdes.terminal], parts, sensitive, value, tex,
 * error }] }` or a failure; `name` the net's name, or null for an unnamed
 * one; `parts` every part with a terminal there, to tell it by.
 */
export function switchedCapStrays(circuit, options = {}) {
  const base = analyzeSwitchedCap(circuit, { ...options, noise: false });
  if (!base.ok) return base;
  const context = resolveAnalysisContext(analyzedCircuit(circuit), { input: options.input, output: options.output });
  const plates = new Map();
  const parts = new Map();
  for (const [key, node] of context.terminalNodes) {
    const refdes = key.slice(0, key.lastIndexOf('.'));
    if (!parts.has(node)) parts.set(node, new Set());
    parts.get(node).add(refdes);
  }
  for (const component of analyzedCircuit(circuit).components.values()) {
    if (component.type !== 'capacitor' && component.type !== 'variable_capacitor') continue;
    for (const term of ['a', 'b']) {
      const node = context.terminalNodes.get(`${component.refdes}.${term}`);
      if (!node || node === AC_GROUND) continue;
      if (!plates.has(node)) plates.set(node, []);
      plates.get(node).push(`${component.refdes}.${term}`);
    }
  }
  const nodes = [...plates].map(([node, on]) => {
    const name = circuit.nets.get(node)?.name || null;
    const result = analyzeSwitchedCap(circuit, { ...options, noise: false, strays: [{ node, name: STRAY }], maxOperations: options.strayMaxOperations ?? 300_000 });
    const own = { node, name, plates: on, parts: [...(parts.get(node) || [])].sort() };
    if (!result.ok) return { ...own, error: result.error };
    const sensitive = expressionSymbols(result.value, VARIABLE).has(STRAY);
    return { ...own, sensitive, ...(sensitive ? { value: result.value, tex: result.tex } : {}) };
  });
  return { ok: true, nodes };
}

const BOLTZMANN = 1.380649e-23;
// Points over half the unit circle the mean of a colored noise is taken at.
const NOISE_POINTS = 1024;

/**
 * The kT/C noise in numbers: the calculator. `options`: the analysis's
 * (`input`, `output`, `readout`), `values` (a number for each symbol of
 * `result.symbols`: farads, gains; `symbols` and `gains` as a result has
 * them spare finding them again), `celsius`, `fs` (the sample rate, Hz).
 * Each contributor's input-referred noise, and their total: `rms` (V, over
 * the band to f_s/2) and `density` (V/sqrt(Hz), the white noise with that
 * RMS: rms / sqrt(f_s / 2)). Returns `{ ok, contributors: [{ phaseName,
 * switches, capacitors, rms, density }], total: { rms, density } }` or a
 * failure.
 */
export function switchedCapNoiseFigures(circuit, options = {}) {
  circuit = analyzedCircuit(circuit);
  const { values = {}, celsius = 27, fs = 1 } = options;
  if (!(Number(fs) > 0)) return failure('noise', 'Give the sample rate f_s, above 0.');
  const kelvin = Number(celsius) + 273.15;
  if (!(kelvin > 0)) return failure('noise', 'The temperature is below absolute zero.');
  const missing = [];
  // Capacitances in units of the first one, so the exact numbers stay small;
  // the noise, over capacitance, is scaled back.
  // The symbols to give numbers to: as given (a result's), else found.
  const symbols = options.symbols ? { symbols: options.symbols, gains: options.gains || [] } : analyzeSwitchedCap(circuit, { input: options.input, output: options.output, readout: options.readout });
  if (symbols.ok === false) return symbols;
  const gains = new Set(symbols.gains);
  const capacitances = symbols.symbols.filter((name) => !gains.has(name));
  for (const name of symbols.symbols) if (!(Number(values[name]) > 0)) missing.push(name);
  if (missing.length) return failure('values', `Give ${missing.join(', ')} a value above 0.`, { missing });
  const unit = capacitances.length ? Number(values[capacitances[0]]) : 1;
  const numbers = Object.fromEntries(symbols.symbols.map((name) => [name, gains.has(name) ? Number(values[name]) : Number(values[name]) / unit]));
  const result = analyzeSwitchedCap(circuit, { input: options.input, output: options.output, readout: options.readout, noise: true, numbers });
  if (!result.ok) return result;
  if (!result.noise?.ok) return failure('noise', result.noise?.error || 'No noise.');
  const kT = BOLTZMANN * kelvin;
  // A value over kT (per capacitance unit) as its mean over the band.
  const figures = (value) => {
    const mean = meanOnCircle(value) / unit;
    const power = kT * mean;
    return { rms: Math.sqrt(power), density: Math.sqrt(power / (Number(fs) / 2)), power };
  };
  return {
    ok: true,
    contributors: result.noise.contributors.map((contributor) => ({ phaseName: contributor.phaseName, switches: contributor.switches, capacitors: contributor.capacitors, ...figures(contributor.input) })),
    total: figures(result.noise.total.input),
    kelvin,
  };
}

/** A rational in z with number coefficients, as a number from BigInts. */
function bigRatio(numerator, denominator) {
  const scale = (value) => value.toString().replace('-', '').length;
  const shift = Math.max(0, Math.max(scale(numerator), scale(denominator)) - 300);
  const cut = 10n ** BigInt(shift);
  return Number(numerator / cut) / Number(denominator / cut);
}

/** The mean of a real noise ratio E(z) over z = e^(j w), 0 < w < pi
 *  (midpoints: a zero of H on the circle is never landed on). */
function meanOnCircle(value) {
  const terms = (expression) => (polynomialCoefficients(expression, VARIABLE) || []).map(({ power, coefficient }) => {
    if (coefficient?.kind !== 'number') throw new Error('The noise still has a symbol in it.');
    return { power, value: bigRatio(coefficient.numerator, coefficient.denominator) };
  });
  if (value?.kind === 'number') return bigRatio(value.numerator, value.denominator);
  const top = terms(value.numerator ?? value);
  const bottom = value.denominator ? terms(value.denominator) : [{ power: 0, value: 1 }];
  const at = (list, w) => list.reduce(([re, im], { power, value: c }) => [re + c * Math.cos(power * w), im + c * Math.sin(power * w)], [0, 0]);
  let sum = 0;
  for (let i = 0; i < NOISE_POINTS; i += 1) {
    const w = Math.PI * (i + 0.5) / NOISE_POINTS;
    const [a, b] = at(top, w);
    const [c, d] = at(bottom, w);
    sum += (a * c + b * d) / (c * c + d * d);
  }
  return sum / NOISE_POINTS;
}

/** A number as an exact rational (twelve significant digits). */
function exactNumber(value) {
  const [mantissa, exponent] = Number(value).toExponential(11).split('e');
  const digits = BigInt(mantissa.replace('.', ''));
  const power = Number(exponent) - 11;
  return power >= 0 ? integer(digits * 10n ** BigInt(power)) : rational(digits, 10n ** BigInt(-power));
}

/**
 * A capacitor's capacitance as a symbol: its value when that is a
 * coefficient (C_S, 2*C_u, 0.5), so the two halves of a differential
 * circuit can share one and the result reduces; else its refdes (CS), as
 * the small-signal analysis names it.
 */
function capacitance(component) {
  const text = String(component.value ?? '').trim();
  if (text) {
    try {
      return coefficientValue(String(parseGain(text)).replace(/\s/g, ''));
    } catch { /* not a coefficient (1 pF): the refdes */ }
  }
  return symbol(component.refdes);
}

/** `value` with each factor common to its numerator and denominator that
 *  depends on a capacitance canceled; back as a function of z. */
function cancelCapacitanceFactors(value, capacitors, gains = []) {
  if (value?.kind !== 'rational') return value;
  const names = new Set(gains);
  for (const cap of capacitors) expressionSymbols(cap.value, VARIABLE, names);
  let current = value;
  for (const name of names) {
    const inName = rationalFunction(current.numerator, current.denominator, { variable: name });
    const canceled = cancelCommonPolynomialFactor(inName, { variable: name, maxWork: 200_000 });
    if (canceled === inName || canceled?.kind !== 'rational') continue;
    current = rationalFunction(canceled.numerator, canceled.denominator, { variable: VARIABLE });
  }
  return current;
}

/** The state the output is read at: an index, a name, or the last. */
function readoutIndex(states, readout) {
  if (readout === undefined || readout === null || readout === '') return states.length - 1;
  if (Number.isInteger(readout)) return readout >= 0 && readout < states.length ? readout : -1;
  const index = states.findIndex((state) => state.name === readout || samePhase(state.name, String(readout)));
  return index;
}

/** A net's name as TeX: math kept, plain names upright. */
function texName(name) {
  const text = String(name ?? '').trim();
  if (!text) return 'V';
  return text.replace(/^\$+|\$+$/g, '');
}

