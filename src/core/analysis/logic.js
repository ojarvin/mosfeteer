/**
 * Logic analysis: a drawing of gates, multiplexers, tri-state buffers,
 * flip-flops, and latches as its truth table, and each output as a
 * minimized sum of products.
 *
 * Inputs are the input ports and the logic pins nothing drives; outputs the
 * output ports and the logic outputs that drive nothing. A pin wired to
 * nothing is a signal of its own, named by the pin (`U1.a`); ground and a
 * supply are 0 and 1. Signals are 0 and 1, `Z` where every tri-state driver
 * is off, and `X` where drivers disagree or an input is unknown.
 *
 * Flip-flops and latches make it sequential: a state transition table, its
 * present state (each element's Q) and inputs on the left, the next state
 * (Q⁺) and outputs on the right, with each next state as an equation. The
 * flip-flops share one clock, an input of its own that takes no column; a
 * latch's next state is what it holds once its enable has been and gone
 * (Q⁺ = EN·L + EN̄·Q). A reset forces the state to 0.
 *
 * It refuses rather than guesses: a loop through gates with no flip-flop or
 * latch in it, two drivers on one signal (unless tri-state), a part that is
 * not logic on a logic signal, flip-flops on more than one clock or edge, a
 * clock that also feeds logic or comes from it.
 */

import { analyzedCircuit, canonicalNetName } from '../model.js';

const GATES = {
  inverter: ([a]) => not(a),
  buffer: ([a]) => known(a),
  and2_gate: and, and3_gate: and,
  nand2_gate: (v) => not(and(v)), nand3_gate: (v) => not(and(v)),
  or2_gate: or, or3_gate: or,
  nor2_gate: (v) => not(or(v)), nor3_gate: (v) => not(or(v)),
  xor2_gate: xor, xor3_gate: xor,
  xnor2_gate: (v) => not(xor(v)), xnor3_gate: (v) => not(xor(v)),
};
const TRISTATE = { tristate_buffer: (a) => known(a), tristate_inverter: (a) => not(a) };
const PORTS = new Set(['input', 'output', 'inputoutput', 'port']);
// Parts that only join wires, or name them.
const PASSIVE = new Set(['solder']);

/** At most this many inputs and states together: 2^12 rows. */
export const LOGIC_MAX_VARIABLES = 12;

function known(v) { return v === 0 || v === 1 ? v : 'X'; }
function not(v) { return v === 0 ? 1 : v === 1 ? 0 : 'X'; }
function and(values) {
  if (values.some((v) => v === 0)) return 0;
  return values.every((v) => v === 1) ? 1 : 'X';
}
function or(values) {
  if (values.some((v) => v === 1)) return 1;
  return values.every((v) => v === 0) ? 0 : 'X';
}
function xor(values) {
  if (values.some((v) => v !== 0 && v !== 1)) return 'X';
  return values.reduce((a, b) => a ^ b, 0);
}

const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true });

/** A sequential part's pins: data, clock or enable, reset, and whether
 *  each acts inverted. */
function sequentialPins(component) {
  const names = new Set(component.terminalDefs.map((t) => t.name));
  if (names.has('D')) {
    return { latch: false, data: 'D', clock: names.has('CLKB') ? 'CLKB' : 'CLK', falling: names.has('CLKB'), reset: names.has('RSTB') ? 'RSTB' : names.has('RST') ? 'RST' : null, resetLow: names.has('RSTB') };
  }
  if (names.has('L')) {
    return { latch: true, data: 'L', clock: names.has('ENB') ? 'ENB' : 'EN', falling: names.has('ENB'), reset: names.has('RSTB') ? 'RSTB' : names.has('RST') ? 'RST' : null, resetLow: names.has('RSTB') };
  }
  return null;
}

/** A signal's name as TeX: markup kept, `$…$` unwrapped, a short name with
 *  digits subscripted (Q0 → Q_{0}), a longer word upright, a pin as text. */
export function logicNameTex(name) {
  const text = String(name);
  const math = text.match(/^\$(.*)\$$/);
  if (math) return math[1];
  if (/[_^]\{/.test(text)) return text;
  const word = text.match(/^([A-Za-z]+)(\d*)$/);
  if (word) {
    const [, letters, digits] = word;
    const head = letters.length === 1 ? letters : `\\mathrm{${letters}}`;
    return digits ? `${head}_{${digits}}` : head;
  }
  return `\\text{${text}}`;
}

/**
 * Analyze the logic of `circuit`. Returns `{ ok: false, error }`, or
 * `{ ok: true, sequential, inputs, outputs, states, clock, rows,
 * expressions }`: `inputs`, `outputs`, `states` are `{ key, name }` (a
 * state's `next` is its Q⁺ name), `rows` each `{ inputs, states, next,
 * outputs }` of 0, 1, 'Z', 'X' in that order, and `expressions` one
 * `{ name, tex, sop }` per next state and output (`tex` null for an output
 * that can be Z or X).
 */
export function analyzeLogic(source) {
  const circuit = analyzedCircuit(source);
  const signals = new Map(); // key -> { key, name, drivers: [], readers: [], ports: Set, constant }
  const signalOf = (key, name) => {
    if (!signals.has(key)) signals.set(key, { key, name, drivers: [], readers: [], ports: new Set(), constant: null, named: false });
    return signals.get(key);
  };
  // A pin's signal: its net's (by name, so equal names join), else its own.
  const netKey = (net) => `net:${canonicalNetName(net.name) || net.id}`;
  const pinSignal = (component, term) => {
    const net = circuit.netOfTerminal({ comp: component.refdes, term });
    if (!net) return signalOf(`pin:${component.refdes}.${term}`, `${component.refdes}.${term}`);
    const signal = signalOf(netKey(net), canonicalNetName(net.name) || null);
    if (net.name) signal.named = true;
    return signal;
  };

  const gates = [];
  const sequential = [];
  for (const component of [...circuit.components.values()].sort((a, b) => natural(a.refdes, b.refdes))) {
    const type = component.type;
    if (GATES[type] || TRISTATE[type] || type === 'mux2') {
      const pin = (name) => pinSignal(component, name);
      const inputs = component.terminalDefs.filter((t) => t.direction === 'input').map((t) => [t.name, pin(t.name)]);
      const output = pin('y');
      const gate = { component, type, inputs: new Map(inputs), output };
      for (const [name, signal] of inputs) signal.readers.push({ component, pin: name });
      output.drivers.push({ component, pin: 'y', tristate: !!TRISTATE[type] });
      gates.push(gate);
    } else if (sequentialPins(component)) {
      const pins = sequentialPins(component);
      const element = { component, ...pins, signals: {} };
      for (const t of component.terminalDefs) {
        const signal = pinSignal(component, t.name);
        element.signals[t.name] = signal;
        if (t.direction === 'output') signal.drivers.push({ component, pin: t.name });
        else signal.readers.push({ component, pin: t.name, clock: t.name === pins.clock && !pins.latch });
      }
      sequential.push(element);
    }
  }
  if (!gates.length && !sequential.length) return { ok: false, error: 'There is no logic to analyze: draw gates, multiplexers, flip-flops, or latches.' };

  // What else touches the logic: ports name signals, rails are constants,
  // anything else is not logic.
  const logicKeys = new Set(signals.keys());
  for (const component of circuit.components.values()) {
    if (GATES[component.type] || TRISTATE[component.type] || component.type === 'mux2' || sequentialPins(component) || PASSIVE.has(component.type)) continue;
    for (const t of component.terminalDefs || []) {
      const net = circuit.netOfTerminal({ comp: component.refdes, term: t.name });
      if (!net || !logicKeys.has(netKey(net))) continue;
      const signal = signals.get(netKey(net));
      if (PORTS.has(component.type)) signal.ports.add(component.type);
      else if (component.type === 'ground') signal.constant = signal.constant === 1 ? 'both' : 0;
      else if (component.type === 'supply') signal.constant = signal.constant === 0 ? 'both' : 1;
      else return { ok: false, error: `${component.refdes} (${component.type}) is on the logic signal ${signal.name || component.refdes}: only logic parts, ports, ground, and supplies can be.` };
    }
  }
  for (const signal of signals.values()) {
    if (!signal.name) {
      // An unnamed net is named by the pin that drives it, else one it feeds.
      const pin = signal.drivers[0] || signal.readers[0];
      signal.name = `${pin.component.refdes}.${pin.pin}`;
    }
    if (signal.constant === 'both') return { ok: false, error: `${signal.name} is tied to both ground and the supply.` };
    if (signal.constant !== null && signal.drivers.length) return { ok: false, error: `${signal.name} is tied to ${signal.constant ? 'the supply' : 'ground'} and driven by ${signal.drivers[0].component.refdes}.${signal.drivers[0].pin}.` };
    const plain = signal.drivers.filter((d) => !d.tristate);
    if (signal.drivers.length > 1 && plain.length) {
      return { ok: false, error: `${signal.name} is driven by ${signal.drivers.map((d) => `${d.component.refdes}.${d.pin}`).join(' and ')}: only tri-state outputs can share a signal.` };
    }
    if (signal.drivers.length && signal.ports.has('input')) return { ok: false, error: `${signal.name} is an input port and is driven by ${signal.drivers[0].component.refdes}.${signal.drivers[0].pin}.` };
  }

  // The clock: every flip-flop's, one input on one edge.
  const flipFlops = sequential.filter((e) => !e.latch);
  let clock = null;
  if (flipFlops.length) {
    const clocks = new Set(flipFlops.map((e) => e.signals[e.clock]));
    if (clocks.size > 1) return { ok: false, error: `The flip-flops are on ${clocks.size} clocks (${[...clocks].map((s) => s.name).join(', ')}): the analysis takes one.` };
    clock = [...clocks][0];
    if (new Set(flipFlops.map((e) => e.falling)).size > 1) return { ok: false, error: `The flip-flops on ${clock.name} trigger on both edges: the analysis takes one.` };
    if (clock.drivers.length || clock.constant !== null) return { ok: false, error: `The clock ${clock.name} comes from logic: clock the flip-flops from an input.` };
    const other = clock.readers.find((r) => !r.clock);
    if (other) return { ok: false, error: `The clock ${clock.name} also feeds ${other.component.refdes}.${other.pin}: the analysis takes a clock that only clocks.` };
  }

  // Inputs: what nothing drives (bar the clock and the rails); outputs: the
  // output ports, and logic outputs that feed nothing.
  const portIn = (s) => s.ports.has('input') || s.ports.has('inputoutput') || s.ports.has('port');
  const portOut = (s) => s.ports.has('output') || s.ports.has('inputoutput') || s.ports.has('port');
  const inputs = [...signals.values()].filter((s) => s !== clock && !s.drivers.length && s.constant === null && (s.readers.length || portIn(s)))
    .sort((a, b) => natural(a.name, b.name));
  // A flip-flop's or latch's Q is its state, shown as such, not an output
  // too; its own pin wired to nothing is not one either.
  const stateSignals = new Set(sequential.map((e) => e.signals.Q));
  const unwiredState = (s) => s.key.startsWith('pin:') && s.drivers.some((d) => sequentialPins(d.component));
  const outputs = [...signals.values()].filter((s) => s.drivers.length && !stateSignals.has(s) && (portOut(s) || (!s.readers.length && !unwiredState(s))))
    .sort((a, b) => natural(a.name, b.name));
  const states = sequential.map((e) => ({ element: e, name: e.signals.Q.named ? e.signals.Q.name : `${e.component.refdes}.Q` }));
  if (inputs.length + states.length > LOGIC_MAX_VARIABLES) {
    return { ok: false, error: `${inputs.length} inputs and ${states.length} states make ${2 ** (inputs.length + states.length)} rows: the analysis takes up to ${LOGIC_MAX_VARIABLES} together.` };
  }

  // The gates in order, each after what drives its inputs; a loop with no
  // flip-flop or latch in it is not combinational logic.
  const driverGate = new Map();
  for (const gate of gates) driverGate.set(gate.output, [...(driverGate.get(gate.output) || []), gate]);
  const order = [];
  const mark = new Map();
  const visit = (gate, path) => {
    if (mark.get(gate) === 'done') return null;
    if (mark.get(gate) === 'open') return [...path.slice(path.indexOf(gate)), gate];
    mark.set(gate, 'open');
    for (const signal of gate.inputs.values()) {
      for (const before of driverGate.get(signal) || []) {
        const loop = visit(before, [...path, gate]);
        if (loop) return loop;
      }
    }
    mark.set(gate, 'done');
    order.push(gate);
    return null;
  };
  for (const gate of gates) {
    const loop = visit(gate, []);
    if (loop) return { ok: false, error: `A loop runs through ${[...new Set(loop.map((g) => g.component.refdes))].join(', ')} with no flip-flop or latch: draw a latch as a latch part.` };
  }

  if (!outputs.length && !states.length) return { ok: false, error: 'The logic has no output: add an output port, or leave a gate\'s output unwired.' };

  // Every signal's value for one row: inputs and states set, the rest
  // worked out gate by gate.
  const evaluate = (inputValues, stateValues) => {
    const value = new Map();
    for (const signal of signals.values()) if (signal.constant !== null) value.set(signal, signal.constant);
    inputs.forEach((signal, i) => value.set(signal, inputValues[i]));
    const resetOf = (e) => {
      if (!e.reset) return 0;
      const r = value.get(e.signals[e.reset]);
      const v = r === undefined ? 0 : r;
      return e.resetLow ? not(v) : known(v);
    };
    // A sequential part's outputs: its state, or 0 while reset (which can
    // depend on logic, so settled after the gates below).
    const setStates = () => states.forEach(({ element }, i) => {
      const r = resetOf(element);
      const q = r === 1 ? 0 : r === 0 ? stateValues[i] : 'X';
      value.set(element.signals.Q, q);
      if (element.signals.QB) value.set(element.signals.QB, not(q));
    });
    setStates();
    const read = (signal) => (value.has(signal) ? value.get(signal) : 'X');
    const resolve = (signal, driven) => {
      // Tri-state drivers on one signal: the one driving, Z if none.
      const all = [...(signal.drivenBy || []), driven].filter((v) => v !== 'Z');
      signal.drivenBy = [...(signal.drivenBy || []), driven];
      const settled = signal.drivenBy.length === signal.drivers.length;
      if (!settled) return;
      value.set(signal, !all.length ? 'Z' : all.every((v) => v === all[0]) ? all[0] : 'X');
    };
    for (const signal of signals.values()) delete signal.drivenBy;
    for (const gate of order) {
      const at = (pin) => { const v = read(gate.inputs.get(pin)); return v === 'Z' ? 'X' : v; };
      let out;
      if (GATES[gate.type]) out = GATES[gate.type]([...gate.inputs.keys()].map(at));
      else if (TRISTATE[gate.type]) out = at('en') === 1 ? TRISTATE[gate.type](at('a')) : at('en') === 0 ? 'Z' : 'X';
      else {
        const s = at('s');
        out = s === 0 ? at('a') : s === 1 ? at('b') : at('a') === at('b') ? at('a') : 'X';
      }
      resolve(gate.output, out);
    }
    for (const signal of signals.values()) delete signal.drivenBy;
    setStates();
    const next = states.map(({ element }, i) => {
      const r = resetOf(element);
      if (r === 1) return 0;
      const d = read(element.signals[element.data]);
      let q;
      if (!element.latch) q = known(d);
      else {
        const en = read(element.signals[element.clock]);
        const enabled = element.falling ? not(en) : known(en);
        q = enabled === 1 ? known(d) : enabled === 0 ? stateValues[i] : (known(d) === stateValues[i] ? stateValues[i] : 'X');
      }
      return r === 0 ? q : (q === 0 ? 0 : 'X');
    });
    return { next, outputs: outputs.map((signal) => read(signal)) };
  };

  const width = states.length + inputs.length;
  const rows = [];
  for (let index = 0; index < 2 ** width; index += 1) {
    const bits = Array.from({ length: width }, (_, k) => (index >> (width - 1 - k)) & 1);
    const stateValues = bits.slice(0, states.length);
    const inputValues = bits.slice(states.length);
    const { next, outputs: out } = evaluate(inputValues, stateValues);
    rows.push({ states: stateValues, inputs: inputValues, next, outputs: out });
  }

  const variables = [...states.map((s) => s.name), ...inputs.map((s) => s.name)];
  const nextName = (name) => `${logicNameTex(name)}^{+}`;
  const expressions = [
    ...states.map((state, i) => ({ name: nextName(state.name), ...sumOfProducts(rows.map((row) => row.next[i]), variables) })),
    ...outputs.map((signal, i) => ({ name: logicNameTex(signal.name), ...sumOfProducts(rows.map((row) => row.outputs[i]), variables) })),
  ];
  return {
    ok: true,
    sequential: states.length > 0,
    inputs: inputs.map((s) => ({ key: s.key, name: s.name })),
    outputs: outputs.map((s) => ({ key: s.key, name: s.name })),
    states: states.map((s) => ({ ref: s.element.component.refdes, name: s.name, next: nextName(s.name), latch: s.element.latch })),
    clock: clock ? { name: clock.name, falling: flipFlops[0].falling } : null,
    rows,
    expressions,
  };
}

/**
 * A column of values over every combination of `variables` (most
 * significant first) as a minimized sum of products (Quine–McCluskey: the
 * prime implicants, the essential ones, then the fewest more that cover the
 * rest, the larger first). Returns `{ tex, sop }`: `sop` the products as
 * [variable index, 0 or 1] lists, `tex` the sum in TeX -- null where a value
 * is Z or X.
 */
export function sumOfProducts(column, variables) {
  if (column.some((v) => v !== 0 && v !== 1)) return { tex: null, sop: null };
  const n = variables.length;
  const ones = column.map((v, i) => (v === 1 ? i : -1)).filter((i) => i >= 0);
  if (!ones.length) return { tex: '0', sop: [] };
  if (ones.length === column.length) return { tex: '1', sop: [[]] };
  // Implicants as [value, mask]: mask bits set where the variable is free.
  let current = new Map(ones.map((m) => [`${m}/0`, { value: m, mask: 0, covers: [m] }]));
  const primes = [];
  while (current.size) {
    const next = new Map();
    const used = new Set();
    const list = [...current.values()];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.mask !== b.mask) continue;
        const diff = a.value ^ b.value;
        if (diff & (diff - 1)) continue;
        const merged = { value: a.value & ~diff, mask: a.mask | diff, covers: [...new Set([...a.covers, ...b.covers])] };
        next.set(`${merged.value}/${merged.mask}`, merged);
        used.add(a);
        used.add(b);
      }
    }
    for (const implicant of list) if (!used.has(implicant)) primes.push(implicant);
    current = next;
  }
  // Essential primes first, then the one covering the most still left.
  const left = new Set(ones);
  const chosen = [];
  for (const m of ones) {
    const covering = primes.filter((p) => p.covers.includes(m));
    if (covering.length === 1 && !chosen.includes(covering[0])) chosen.push(covering[0]);
  }
  for (const p of chosen) for (const m of p.covers) left.delete(m);
  while (left.size) {
    const best = primes.filter((p) => !chosen.includes(p))
      .map((p) => ({ p, gain: p.covers.filter((m) => left.has(m)).length }))
      .sort((a, b) => b.gain - a.gain || popcount(b.p.mask) - popcount(a.p.mask) || a.p.value - b.p.value)[0];
    chosen.push(best.p);
    for (const m of best.p.covers) left.delete(m);
  }
  const sop = chosen.map((p) => {
    const literals = [];
    for (let k = 0; k < n; k++) {
      const bit = 1 << (n - 1 - k);
      if (!(p.mask & bit)) literals.push([k, p.value & bit ? 1 : 0]);
    }
    return literals;
  }).sort((a, b) => a.length - b.length || compareProducts(a, b));
  const literal = ([k, v]) => (v ? logicNameTex(variables[k]) : `\\overline{${logicNameTex(variables[k])}}`);
  const tex = sop.map((product) => product.map(literal).join(' \\cdot ')).join(' + ');
  return { tex, sop };
}

function popcount(x) { let c = 0; while (x) { c += x & 1; x >>= 1; } return c; }
function compareProducts(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i][0] !== b[i][0]) return a[i][0] - b[i][0];
    if (a[i][1] !== b[i][1]) return b[i][1] - a[i][1];
  }
  return 0;
}

/** A table cell: 0, 1, Z, X. */
export const logicValueText = (v) => String(v);
