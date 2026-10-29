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
 * (Q⁺) and outputs on the right, with each next state as an equation. One
 * input clocks the flip-flops, takes no column, and reaches only clock pins
 * (through gates, if gated); the others may be clocked from it through
 * logic, as a ripple counter's stages are. A row is one period of it: it
 * rises, then falls, and after each edge every flip-flop whose clock just
 * had its edge takes its D, all together, until no more edges ripple
 * through (zero delays: clocks are taken as glitch-free). A latch's next
 * state is what it holds once its enable has been and gone
 * (Q⁺ = EN·L + EN̄·Q). A reset forces the state to 0.
 *
 * It refuses rather than guesses: a loop through gates with no flip-flop or
 * latch in it, two drivers on one signal (unless tri-state), a part that is
 * not logic on a logic signal, more than one clock input, a clock that
 * reaches anything but clock pins, flip-flops that clock each other.
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
 * Analyze the logic of `circuit`, clocked from `options.clock` (a signal's
 * name) where the drawing leaves the clock open. Returns `{ ok: false,
 * error, clockChoices? }`, or
 * `{ ok: true, sequential, inputs, outputs, states, clock, clockChoices,
 * rows, expressions }`: `clock` is `{ name, edges, ripple, gated, text }`, and
 * `clockChoices` the inputs it could be; `inputs`, `outputs`, `states` are
 * `{ key, name }` (a
 * state's `next` is its Q⁺ name), `rows` each `{ inputs, states, next,
 * outputs }` of 0, 1, 'Z', 'X' in that order, and `expressions` one
 * `{ name, tex, sop }` per next state and output (`tex` null for an output
 * that can be Z or X).
 */
export function analyzeLogic(source, options = {}) {
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

  // The clock: the one input among the flip-flops' clocks, else the one
  // input that reaches them through gates (a gated clock), or the one
  // chosen (`options.clock`). The rest come from logic -- a stage clocked
  // by another's output.
  const flipFlops = sequential.filter((e) => !e.latch);
  let clock = null;
  let clockChoices = [];
  let rippled = false;
  if (flipFlops.length) {
    const clocks = [...new Set(flipFlops.map((e) => e.signals[e.clock]))];
    const railed = clocks.find((signal) => signal.constant !== null);
    if (railed) return { ok: false, error: `The clock ${railed.name} is tied to ${railed.constant ? 'the supply' : 'ground'}.` };
    const direct = clocks.filter((signal) => !signal.drivers.length);
    if (direct.length > 1) return { ok: false, error: `The flip-flops are on ${direct.length} clock inputs (${direct.map((signal) => signal.name).join(', ')}): the analysis takes one, the rest clocked from it.` };
    // Inputs whose way through gates ends at clock pins only.
    const gateOf = new Map(gates.map((gate) => [gate.component, gate]));
    const clocksOnly = (start) => {
      const reached = new Set([start]);
      let any = false;
      for (const signal of reached) {
        for (const reader of signal.readers) {
          if (reader.clock) { any = true; continue; }
          const gate = gateOf.get(reader.component);
          if (!gate) return false;
          reached.add(gate.output);
        }
      }
      return any;
    };
    clockChoices = direct.length ? direct : [...signals.values()]
      .filter((signal) => !signal.drivers.length && signal.constant === null && signal.readers.length && clocksOnly(signal))
      .sort((a, b) => natural(a.name, b.name));
    if (options.clock) {
      clock = [...signals.values()].find((signal) => signal.name === options.clock && !signal.drivers.length && signal.constant === null) || null;
      if (!clock) return { ok: false, error: `${options.clock} is not an input to clock from.`, clockChoices: clockChoices.map((signal) => signal.name) };
    } else if (clockChoices.length > 1) {
      return { ok: false, error: `The clock could be ${clockChoices.map((signal) => signal.name).join(' or ')}: pick it.`, clockChoices: clockChoices.map((signal) => signal.name) };
    } else clock = clockChoices[0] || null;
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

  // The clock reaches clock pins only, through gates if it is gated: an
  // output or a data pin it reached would have no value between periods.
  if (flipFlops.length) {
    if (!clock) return { ok: false, error: 'No flip-flop is clocked from an input: clock one from an input, the others from it or from each other.' };
    const reached = new Set([clock]);
    for (const signal of reached) {
      if (signal !== clock && outputs.includes(signal)) return { ok: false, error: `The clock ${clock.name} reaches the output ${signal.name}: the analysis takes a clock that only clocks.` };
      for (const reader of signal.readers) {
        if (reader.clock) continue;
        const gate = gates.find((g) => g.component === reader.component);
        if (!gate) return { ok: false, error: `The clock ${clock.name} reaches ${reader.component.refdes}.${reader.pin}, not a clock pin: the analysis takes a clock that only clocks.` };
        reached.add(gate.output);
      }
    }
    // Who clocks whom: a flip-flop whose clock depends on its own output
    // (directly or through others) would race.
    const depends = new Map();
    for (const e of flipFlops) for (const pin of ['Q', 'QB']) if (e.signals[pin]) depends.set(e.signals[pin], new Set([e]));
    for (const gate of order) {
      const all = new Set(depends.get(gate.output) || []);
      for (const signal of gate.inputs.values()) for (const e of depends.get(signal) || []) all.add(e);
      depends.set(gate.output, all);
    }
    const clockedBy = new Map(flipFlops.map((e) => [e, [...(depends.get(e.signals[e.clock]) || [])]]));
    rippled = flipFlops.some((e) => clockedBy.get(e).length);
    const mark = new Map();
    const race = (e, path) => {
      if (mark.get(e) === 'done') return null;
      if (mark.get(e) === 'open') return path.slice(path.indexOf(e));
      mark.set(e, 'open');
      for (const before of clockedBy.get(e)) {
        const found = race(before, [...path, e]);
        if (found) return found;
      }
      mark.set(e, 'done');
      return null;
    };
    for (const e of flipFlops) {
      const loop = race(e, []);
      if (loop) {
        const names = loop.map((x) => x.component.refdes);
        return { ok: false, error: names.length === 1 ? `${names[0]} clocks itself: it would race.` : `${names.join(', ')} clock each other: they would race.` };
      }
    }
  }

  // Every signal's value with the inputs and the states set, and the clock
  // at `clockValue`, worked out gate by gate.
  const settle = (inputValues, stateValues, clockValue = 0) => {
    const value = new Map();
    for (const signal of signals.values()) if (signal.constant !== null) value.set(signal, signal.constant);
    inputs.forEach((signal, i) => value.set(signal, inputValues[i]));
    if (clock) value.set(clock, clockValue);
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
    return { read, resetOf };
  };

  // A row: the outputs in the present state; a latch's next state what it
  // holds once its enable has gone; the flip-flops' after one period of the
  // clock -- it rises, then falls, and after each edge every flip-flop
  // whose clock just had its edge takes its D, together, until no more
  // edges ripple through.
  const evaluate = (inputValues, stateValues) => {
    const present = settle(inputValues, stateValues, 0);
    const next = [...stateValues];
    states.forEach(({ element }, i) => {
      if (!element.latch) return;
      const r = present.resetOf(element);
      const d = present.read(element.signals[element.data]);
      const en = present.read(element.signals[element.clock]);
      const enabled = element.falling ? not(en) : known(en);
      const q = enabled === 1 ? known(d) : enabled === 0 ? stateValues[i] : (known(d) === stateValues[i] ? stateValues[i] : 'X');
      next[i] = r === 1 ? 0 : r === 0 ? q : (q === 0 ? 0 : 'X');
    });
    if (flipFlops.length) {
      const state = [...stateValues];
      let before = present;
      for (const level of [1, 0]) {
        let now = settle(inputValues, state, level);
        for (let round = 0; round <= flipFlops.length; round += 1) {
          const taken = [];
          states.forEach(({ element }, i) => {
            if (element.latch) return;
            const signal = element.signals[element.clock];
            const [a, b] = [before.read(signal), now.read(signal)];
            if (a === b) return;
            const edge = element.falling ? a === 1 && b === 0 : a === 0 && b === 1;
            const unknown = a === 'X' || b === 'X' || a === 'Z' || b === 'Z';
            if (!edge && !unknown) return;
            const d = known(now.read(element.signals.D));
            taken.push([i, edge ? d : d === state[i] ? d : 'X']);
          });
          if (!taken.length) break;
          for (const [i, q] of taken) state[i] = q;
          before = now;
          now = settle(inputValues, state, level);
        }
        before = now;
      }
      states.forEach(({ element }, i) => {
        if (element.latch) return;
        // A reset holds the state at 0 whatever the clock did.
        const r = before.resetOf(element);
        next[i] = r === 1 ? 0 : r === 0 ? state[i] : (state[i] === 0 ? 0 : 'X');
      });
    }
    return { next, outputs: outputs.map((signal) => present.read(signal)) };
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
    clock: clock ? clockOf(clock, flipFlops, rippled) : null,
    clockChoices: clockChoices.map((signal) => signal.name),
    rows,
    expressions,
  };
}

/** The clock as the table names it: its edges (the flip-flops on it
 *  directly; one through gates may see either), whether others are
 *  clocked from flip-flops (a ripple) or through any logic (gated), and
 *  the sentence that says what a row is. */
function clockOf(clock, flipFlops, ripple) {
  const direct = flipFlops.filter((e) => e.signals[e.clock] === clock);
  const edges = new Set(direct.map((e) => (e.falling ? 'falling' : 'rising')));
  const which = edges.size > 1 || direct.length < flipFlops.length ? 'both' : [...edges][0];
  const text = which !== 'both'
    ? `On each ${which} edge of ${clock.name}`
    : `After each period of ${clock.name}, its rising edge then its falling edge${ripple ? ', the flip-flops clocked from others rippling through until they settle' : ''}`;
  // Clocked through logic, a flip-flop sees clean edges here, as with no delays.
  const gated = direct.length < flipFlops.length;
  return { name: clock.name, edges: which, ripple, gated, text };
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
