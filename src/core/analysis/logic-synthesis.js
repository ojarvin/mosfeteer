/**
 * Logic synthesis, the reverse of the logic analysis (logic.js): named
 * inputs and outputs, each output's value in every row of the truth table
 * (0, 1, Z for not driven, - for either), as minimized equations, mapped
 * onto the logic parts a style and a list of allowed gates leave, and drawn:
 * input ports, the gates, output ports, all wired.
 *
 * - `synthesizeLogic(spec, options)` minimizes and maps. An output that is
 *   Z in some rows is a tri-state buffer: its enable is 1 in the rows that
 *   are not Z, its data free there. The mapped gates are simulated over
 *   every row and checked against the table before anything is drawn.
 * - `drawSynthesis(circuit, result, { at })` draws them into a drawing.
 */

import { GRID } from '../grid.js';
import { logicNameTex, minimalCover } from './logic.js';
import { addTerminalStubs } from '../stubs.js';
import { busBits, nameList } from '../bus.js';
import { addPinRail } from '../pin-rails.js';

export const MAX_SYNTHESIS_INPUTS = 8;
export const MAX_SYNTHESIS_OUTPUTS = 8;
/** Up to this many inputs, the inputs are drawn as wired rails; more are
 *  joined to the gates by name. */
export const WIRED_INPUTS = 4;

export const SYNTHESIS_STYLES = ['and-or', 'nand', 'or-and', 'nor'];
export const SYNTHESIS_GATES = ['inverter', 'and', 'nand', 'or', 'nor'];
// A name, or a bus bit of one (`D[3]`, `D<3>`).
const NAME = /^[A-Za-z][A-Za-z0-9_]*(?:\[\d+\]|<\d+>)?$/;

/**
 * Signal names typed as a list, separated by spaces or commas; a bus range
 * (`D[3:0]`, `D<3:0>`) is its bits, first to last (`D[3]` ... `D[0]`).
 */
export function signalNames(text) {
  return nameList(text).flatMap((name) => {
    const bus = busBits(name);
    if (!bus?.range) return [name];
    const [open, close] = name.endsWith('>') ? ['<', '>'] : ['[', ']'];
    return bus.bits.map((bit) => `${bus.base}${open}${bit}${close}`);
  });
}

/** Names as a list to show, separated by spaces, a bus's bits in a row
 *  written as their range again (`D[3] D[2] D[1] D[0]` -> `D[3:0]`). */
export function compactNames(names) {
  const out = [];
  for (let i = 0; i < names.length;) {
    const first = /^(.*)([[<])(\d+)[\]>]$/.exec(names[i]);
    let j = i + 1;
    if (first) {
      const [, base, open] = first;
      let step = 0;
      let last = Number(first[3]);
      for (; j < names.length; j++) {
        const next = /^(.*)([[<])(\d+)[\]>]$/.exec(names[j]);
        if (!next || next[1] !== base || next[2] !== open) break;
        const delta = Number(next[3]) - last;
        if (Math.abs(delta) !== 1 || (step && delta !== step)) break;
        step = delta;
        last = Number(next[3]);
      }
      if (j - i > 1) {
        const close = open === '[' ? ']' : '>';
        out.push(`${base}${open}${first[3]}:${last}${close}`);
        i = j;
        continue;
      }
    }
    out.push(names[i]);
    i += 1;
  }
  return out.join(' ');
}

/** Rows are counted up in binary, the first input the most significant. */
export function rowCount(inputs) {
  return 2 ** inputs.length;
}

/**
 * The spec checked: `{ inputs: [name], outputs: [{ name, values }] }`, a
 * value string per output of 0, 1, Z, and - (x reads as -), one per row; a
 * short one is padded with 0. Returns `{ ok, error?, inputs, outputs }`.
 */
export function normalizeSynthesisSpec(spec) {
  const inputs = (spec?.inputs || []).flatMap((name) => signalNames(name));
  const outputs = (spec?.outputs || []).map((output) => ({ name: String(output?.name ?? '').trim(), values: String(output?.values ?? '') })).filter((output) => output.name);
  const fail = (error) => ({ ok: false, error, inputs, outputs });
  if (!inputs.length) return fail('name at least one input');
  if (!outputs.length) return fail('name at least one output');
  if (inputs.length > MAX_SYNTHESIS_INPUTS) return fail(`at most ${MAX_SYNTHESIS_INPUTS} inputs (${rowCount(inputs.slice(0, MAX_SYNTHESIS_INPUTS))} rows)`);
  if (outputs.length > MAX_SYNTHESIS_OUTPUTS) return fail(`at most ${MAX_SYNTHESIS_OUTPUTS} outputs`);
  const names = [...inputs, ...outputs.map((output) => output.name)];
  const bad = names.find((name) => !NAME.test(name));
  if (bad) return fail(`"${bad}" is not a signal name: a letter, then letters, digits, or _, and a bit ([3] or <3>) of a bus`);
  const seen = new Set();
  for (const name of names) {
    if (seen.has(name.toLowerCase())) return fail(`"${name}" is named twice`);
    seen.add(name.toLowerCase());
  }
  const rows = rowCount(inputs);
  for (const output of outputs) {
    const values = output.values.replace(/\s+/g, '').toUpperCase().replace(/X/g, '-');
    if (/[^01Z-]/.test(values)) return fail(`${output.name}: a value is 0, 1, Z, or -`);
    if (values.length > rows) return fail(`${output.name}: ${values.length} values for ${rows} rows`);
    output.values = values.padEnd(rows, '0');
  }
  return { ok: true, inputs, outputs };
}

/** The options checked: a style, the allowed gates, and the most inputs a gate has. */
export function normalizeSynthesisOptions(options = {}) {
  const style = SYNTHESIS_STYLES.includes(options.style) ? options.style : 'and-or';
  const gates = Array.isArray(options.gates) ? SYNTHESIS_GATES.filter((gate) => options.gates.includes(gate)) : [...SYNTHESIS_GATES];
  const maxInputs = Number(options.maxInputs) === 2 ? 2 : 3;
  return { style, gates, maxInputs };
}

const literalTex = (inputs) => ([k, v]) => (v ? logicNameTex(inputs[k]) : `\\overline{${logicNameTex(inputs[k])}}`);

/** A sum of products, or a product of sums, in TeX. */
function formTex(terms, pos, inputs) {
  if (!terms.length) return pos ? '1' : '0';
  if (terms.some((term) => !term.length)) return pos ? '0' : '1';
  const literal = literalTex(inputs);
  if (!pos) return terms.map((term) => term.map(literal).join(' \\cdot ')).join(' + ');
  return terms.map((term) => (term.length > 1 && terms.length > 1 ? `(${term.map(literal).join(' + ')})` : term.map(literal).join(' + '))).join(' \\cdot ');
}

/**
 * One function minimized: `ones`, `zeros`, the rest free. A sum of products
 * covers the ones; a product of sums is the complement's sum of products,
 * each product a sum of complemented literals. Returns `{ terms, pos, tex }`.
 */
function minimized(ones, zeros, n, pos, inputs) {
  const all = Array.from({ length: 2 ** n }, (_, i) => i);
  const free = (taken) => all.filter((i) => !taken.has(i));
  if (!pos) {
    const terms = minimalCover(ones, free(new Set([...ones, ...zeros])), n);
    return { terms, pos, tex: formTex(terms, pos, inputs) };
  }
  const terms = minimalCover(zeros, free(new Set([...ones, ...zeros])), n).map((term) => term.map(([k, v]) => [k, 1 - v]));
  return { terms, pos, tex: formTex(terms, pos, inputs) };
}

/** The gate network: hash-consed nodes, each built once. */
class Network {
  constructor(inputs, { gates, maxInputs }) {
    this.allowed = new Set(gates);
    this.maxInputs = maxInputs;
    this.nodes = [];
    this.byKey = new Map();
    this.inputs = inputs.map((name, k) => this.add(`in:${k}`, { kind: 'input', k, name }));
  }

  add(key, node) {
    if (this.byKey.has(key)) return this.byKey.get(key);
    const made = { id: this.nodes.length, ...node };
    this.nodes.push(made);
    this.byKey.set(key, made);
    return made;
  }

  constant(value) {
    return this.add(`const:${value}`, { kind: 'const', value });
  }

  gate(op, args) {
    const ordered = op === 'tristate' ? args : [...args].sort((a, b) => a.id - b.id);
    const type = op === 'inverter' ? 'inverter' : op === 'tristate' ? 'tristate_buffer' : `${op}${args.length}_gate`;
    return this.add(`${type}(${ordered.map((a) => a.id).join(',')})`, { kind: 'gate', op, type, args: ordered });
  }

  has(op) { return this.allowed.has(op); }

  not(x) {
    if (x.inverts) return x.inverts;
    let node;
    if (this.has('inverter')) node = this.gate('inverter', [x]);
    else if (this.has('nand')) node = this.gate('nand', [x, x]);
    else if (this.has('nor')) node = this.gate('nor', [x, x]);
    else throw new Error('no allowed gate inverts: allow the inverter, NAND, or NOR');
    node.inverts = x;
    return node;
  }

  /** AND, OR of any number: the gate itself, a tree of it, or its dual. */
  and(xs) { return this.combine('and', xs); }
  or(xs) { return this.combine('or', xs); }
  nand(xs) { return this.combine('nand', xs); }
  nor(xs) { return this.combine('nor', xs); }

  combine(op, xs) {
    const unique = [...new Map(xs.map((x) => [x.id, x])).values()];
    const dual = { and: 'or', or: 'and', nand: 'nor', nor: 'nand' }[op];
    const plain = { and: 'and', or: 'or', nand: 'and', nor: 'or' }[op];
    const inverted = op === 'nand' || op === 'nor';
    if (unique.length === 1) return inverted ? this.not(unique[0]) : unique[0];
    if (this.has(op)) {
      // Too many for one gate: fold the first few with the plain gate (a
      // NAND of many is a NAND of ANDs), a level at a time, the fewest gates.
      let items = unique;
      while (items.length > this.maxInputs) {
        let excess = items.length - this.maxInputs;
        const next = [];
        let at = 0;
        while (excess > 0 && items.length - at >= 2) {
          const size = Math.min(this.maxInputs, excess + 1, items.length - at);
          next.push(this.combine(plain, items.slice(at, at + size)));
          at += size;
          excess -= size - 1;
        }
        items = [...next, ...items.slice(at)];
      }
      return this.gate(op, items);
    }
    const inverse = { and: 'nand', or: 'nor', nand: 'and', nor: 'or' }[op];
    // AND as NOT NAND, NAND as NOT AND, and so on, when that gate is allowed.
    if (this.has(inverse)) return this.not(this.combine(inverse, unique));
    // De Morgan: AND is NOR of the complements, NAND is OR of them.
    const across = { and: 'nor', or: 'nand', nand: 'or', nor: 'and' }[op];
    if (this.has(across)) return this.combine(across, unique.map((x) => this.not(x)));
    if (this.has(dual)) return inverted ? this.combine(dual, unique.map((x) => this.not(x))) : this.not(this.combine(dual, unique.map((x) => this.not(x))));
    throw new Error('no allowed gate combines signals: allow AND, NAND, OR, or NOR');
  }

  literal([k, v]) {
    return v ? this.inputs[k] : this.not(this.inputs[k]);
  }

  /** One minimized function, built in `style`. */
  build({ terms, pos }, style) {
    if (!terms.length) return this.constant(pos ? 1 : 0);
    if (terms.some((term) => !term.length)) return this.constant(pos ? 0 : 1);
    const inner = (term) => term.map((literal) => this.literal(literal));
    if (style === 'and-or') return this.or(terms.map((term) => this.and(inner(term))));
    if (style === 'or-and') return this.and(terms.map((term) => this.or(inner(term))));
    // NAND–NAND: f = NAND of the products' NANDs (a lone literal enters
    // complemented); NOR–NOR the dual on the sums.
    const [outer, sub] = style === 'nand' ? ['nand', 'nand'] : ['nor', 'nor'];
    if (terms.length === 1) return style === 'nand' ? this.and(inner(terms[0])) : this.or(inner(terms[0]));
    return this.combine(outer, terms.map((term) => (term.length === 1 ? this.not(this.literal(term[0])) : this.combine(sub, inner(term)))));
  }
}

/** Every node's value in row `row` (inputs most significant first). */
function simulate(network, row, n) {
  const values = [];
  for (const node of network.nodes) {
    if (node.kind === 'input') values.push((row >> (n - 1 - node.k)) & 1);
    else if (node.kind === 'const') values.push(node.value);
    else {
      const args = node.args.map((arg) => values[arg.id]);
      const all = args.every(Boolean);
      const any = args.some(Boolean);
      values.push({ inverter: 1 - args[0], buffer: args[0], and: +all, nand: +!all, or: +any, nor: +!any, tristate: args[0] }[node.op]);
    }
  }
  return values;
}

/**
 * Synthesize `spec` (normalizeSynthesisSpec) in `options`
 * (normalizeSynthesisOptions). Returns `{ ok: false, error }` or
 * `{ ok: true, inputs, outputs, network, gateCount }`: each output
 * `{ name, values, tex, enableTex, node }` -- `tex` its equation (null when
 * it is never driven), `enableTex` its tri-state enable or null, `node` what
 * drives its port.
 */
export function synthesizeLogic(rawSpec, rawOptions = {}) {
  const spec = normalizeSynthesisSpec(rawSpec);
  if (!spec.ok) return { ok: false, error: spec.error };
  const options = normalizeSynthesisOptions(rawOptions);
  const { inputs } = spec;
  const n = inputs.length;
  const pos = options.style === 'or-and' || options.style === 'nor';
  // NAND–NAND and NOR–NOR are that gate alone, inverters if allowed.
  const only = { nand: 'nand', nor: 'nor' }[options.style];
  if (only && !options.gates.includes(only)) return { ok: false, error: `${only.toUpperCase()}–${only.toUpperCase()} needs ${only.toUpperCase()} gates allowed` };
  const gates = only ? options.gates.filter((gate) => gate === only || gate === 'inverter') : options.gates;
  const network = new Network(inputs, { ...options, gates });
  const outputs = [];
  try {
    for (const output of spec.outputs) {
      const rows = [...output.values];
      const where = (wanted) => rows.flatMap((v, i) => (wanted.includes(v) ? [i] : []));
      const ones = where(['1']);
      const zeros = where(['0']);
      const floating = where(['Z']);
      const data = minimized(ones, zeros, n, pos, inputs);
      if (!floating.length) {
        outputs.push({ name: output.name, values: output.values, tex: data.tex, enableTex: null, node: network.build(data, options.style) });
        continue;
      }
      // Z in places: a tri-state buffer, enabled where the output is driven.
      const enable = minimized(where(['0', '1', '-']), floating, n, pos, inputs);
      const node = network.gate('tristate', [network.build(data, options.style), network.build(enable, options.style)]);
      outputs.push({ name: output.name, values: output.values, tex: floating.length === rows.length ? null : data.tex, enableTex: enable.tex, node });
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
  // Each output port has a net of its own, named by it: an output that is
  // an input, its complement, a constant, or another output's signal is
  // buffered.
  const driven = new Set();
  for (const output of outputs) {
    const node = output.node;
    if (node.kind !== 'gate' || node.inverts?.kind === 'input' || driven.has(node.id)) {
      output.node = network.add(`buffer:${output.name}`, { kind: 'gate', op: 'buffer', type: 'buffer', args: [node] });
    }
    driven.add(output.node.id);
  }
  // The gates as built, row by row, against the table.
  for (let row = 0; row < rowCount(inputs); row++) {
    const values = simulate(network, row, n);
    for (const output of outputs) {
      const want = output.values[row];
      const node = output.node;
      const driven = node.op === 'tristate' ? values[node.args[1].id] === 1 : true;
      const got = values[node.op === 'tristate' ? node.args[0].id : node.id];
      const fine = want === '-' ? driven : want === 'Z' ? !driven : driven && String(got) === want;
      if (!fine) return { ok: false, error: `internal: the gates for ${output.name} disagree with the table in row ${row}` };
    }
  }
  // Only the nodes the outputs reach are drawn.
  const reached = new Set();
  const visit = (node) => {
    if (reached.has(node)) return;
    reached.add(node);
    for (const arg of node.args || []) visit(arg);
  };
  for (const output of outputs) visit(output.node);
  // Every input has its port, used or not.
  const used = network.nodes.filter((node) => reached.has(node) || node.kind === 'input');
  const gateCount = used.filter((node) => node.kind === 'gate').length;
  return { ok: true, inputs, outputs, style: options.style, nodes: used, gateCount };
}

/** Gates by type, for a summary: "3 NAND2, 2 inverters". */
export function gateSummary(result) {
  const counts = new Map();
  for (const node of result.nodes) if (node.kind === 'gate') counts.set(node.type, (counts.get(node.type) || 0) + 1);
  const label = (type) => (type === 'inverter' || type === 'buffer' ? type : type === 'tristate_buffer' ? 'tri-state buffer' : type.replace(/_gate$/, '').toUpperCase());
  return [...counts].map(([type, count]) => `${count} ${label(type)}${count > 1 && /inverter|buffer/.test(type) ? 's' : ''}`).join(', ') || 'no gates';
}

// --- Drawing --------------------------------------------------------------

const ROW = 7 * GRID; // a gate's height, its name, and two cells between
const STACK = 6 * GRID; // the least between two gates in a column: a cell clear of the name below
const GATE = 6 * GRID; // a gate, input pins to output
const GAP = 3 * GRID; // the least wire between columns
const NAMED_GAP = 4 * GRID; // and room for named stubs
const RAIL = 2 * GRID; // between rails

/**
 * A gate's inputs in pin order, top to bottom: the order that turns the
 * fewest wires (a gate's output level with its pin runs straight), then
 * crosses the fewest, then the rails first. `levelOf(arg)` is a gate's
 * output level, or null for a rail or a constant, which come in along a
 * row of their own.
 */
function pinOrder(node, levelOf, y) {
  if (node.op === 'tristate' || node.args.length < 2) return node.args;
  const offsets = pinOffsets(node);
  const orders = [];
  const permute = (rest, done) => {
    if (!rest.length) orders.push(done);
    rest.forEach((arg, i) => permute([...rest.slice(0, i), ...rest.slice(i + 1)], [...done, arg]));
  };
  permute(node.args, []);
  const cost = (args) => {
    let turns = 0;
    let crossings = 0;
    let rails = 0;
    args.forEach((arg, i) => {
      const at = levelOf(arg);
      if (at === null) { rails += i; return; }
      if (at !== y + offsets[i]) turns += 1;
      for (let j = i + 1; j < args.length; j++) {
        const other = levelOf(args[j]);
        if (other !== null && other < at) crossings += 1;
      }
    });
    return turns * 100 + crossings * 10 + rails;
  };
  return orders.reduce((best, args) => (cost(args) < cost(best) ? args : best));
}

/** Each input pin's height on a gate, top to bottom, as pinsOf names them. */
const pinOffsets = (node) => (node.op === 'tristate' || node.type === 'inverter' || node.type === 'buffer' ? [0, 0]
  : node.args.length === 3 ? [-GRID, 0, GRID] : [-GRID, GRID]);

const pinsOf = (node) => (node.op === 'tristate' ? ['a', 'en'] : node.type === 'inverter' || node.type === 'buffer' ? ['a'] : ['a', 'b', 'c'].slice(0, node.args.length));

/** The complement of an input, made in the header (rails, or stubs). */
const complementOf = (node) => node.kind === 'gate' && node.inverts?.kind === 'input' ? node.inverts : null;

/**
 * Draw `result` (synthesizeLogic) into `circuit`, its top left at `at`
 * (default: right of what is drawn). Up to WIRED_INPUTS inputs, each input
 * and its complement is a rail the gates tap; past that, every gate input
 * that reads one is a stub named for it. A gate the router cannot reach is
 * joined by name; where even that finds no room, the inputs are joined by
 * name, then every connection. Returns `{ refs, mode }`: the parts added,
 * and 'rails', 'inputs', or 'names'. All or nothing: a name already in the
 * drawing leaves the drawing as it was and throws.
 */
export function drawSynthesis(circuit, result, { at = null, wired = null, modes = null } = {}) {
  if (!result?.ok) throw new Error(result?.error || 'nothing synthesized');
  for (const name of [...result.inputs, ...result.outputs.map((output) => output.name)]) {
    if (circuit.components.has(name)) throw new Error(`the drawing already has a part named ${name}`);
    const lower = name.toLowerCase();
    if ([...circuit.nets.values()].some((net) => net.name && net.name.toLowerCase() === lower)) throw new Error(`the drawing already has a net named ${name}: draw into an empty design, or rename it`);
  }
  const useRails = wired ?? result.inputs.length <= WIRED_INPUTS;
  const origin = at || (() => {
    if (!circuit.components.size) return { x: 0, y: 0 };
    const box = circuit.inkBounds(0);
    return { x: Math.ceil((box.x + box.w) / GRID) * GRID + 8 * GRID, y: Math.round(box.y / GRID) * GRID };
  })();
  const netsBefore = new Set(circuit.nets.keys());
  const labelsBefore = new Set(circuit.labels.keys());
  // Wired where the router finds room; else joined by name, the inputs
  // first, then every connection.
  const tried = modes || [...(useRails ? ['rails'] : []), 'inputs', 'names'];
  for (const [i, mode] of tried.entries()) {
    const added = [];
    try {
      layOut(circuit, result, origin, mode, added);
      return { refs: added, mode };
    } catch (err) {
      for (const ref of added.reverse()) if (circuit.components.has(ref)) circuit.removeComponent(ref);
      for (const id of [...circuit.nets.keys()]) if (!netsBefore.has(id)) circuit.removeNet(id);
      for (const id of [...circuit.labels.keys()]) if (!labelsBefore.has(id)) circuit.removeLabel(id);
      if (i === tried.length - 1) throw err;
    }
  }
}

function layOut(circuit, result, origin, mode, added) {
  const useRails = mode === 'rails';
  const nodes = result.nodes;
  const ref = new Map(); // node id -> refdes
  const pos = new Map(); // node id -> { x, y } of the part's origin
  const place = (node, type, x, y, refdes = null) => {
    const part = circuit.addComponent(type, { refdes: refdes ?? circuit.nextRefdes('U'), x, y });
    added.push(part.refdes);
    ref.set(node.id, part.refdes);
    pos.set(node.id, { x, y });
    return part;
  };

  // The rails: each input used, and each complement made from one.
  const inputs = nodes.filter((node) => node.kind === 'input');
  const complements = nodes.filter(complementOf);
  const body = nodes.filter((node) => node.kind === 'gate' && !complementOf(node));
  const isRail = (node) => node.kind === 'input' || !!complementOf(node);
  const readers = new Map(nodes.map((node) => [node.id, []]));
  for (const node of body) for (const [i, arg] of node.args.entries()) readers.get(arg.id).push({ node, pin: pinsOf(node)[i] });
  const outputOf = new Map(result.outputs.map((output) => [output.node.id, output]));
  const complementFor = new Map(complements.map((node) => [node.inverts.id, node]));
  // A rail for each input or complement a gate reads.
  const tapped = (node) => readers.get(node.id).length > 0;

  // Gate columns: depth from the rails.
  const depth = new Map();
  const depthOf = (node) => {
    if (isRail(node) || node.kind === 'const') return 0;
    if (depth.has(node.id)) return depth.get(node.id);
    const d = node.op === 'tristate' ? 0 : 1 + Math.max(...node.args.map(depthOf));
    depth.set(node.id, d);
    return d;
  };
  for (const node of body) depthOf(node);
  const deepest = Math.max(0, ...body.filter((node) => node.op !== 'tristate').map(depthOf));
  for (const node of body) if (node.op === 'tristate') depth.set(node.id, deepest + 1);
  // Across: the input ports, the rails (each input, then its complement
  // past the complement gates), then the gate columns, then the output ports.
  const ordered = [...inputs].sort((a, b) => a.k - b.k);
  const trueRails = useRails ? ordered.filter(tapped) : [];
  const complementRails = useRails ? ordered.filter((input) => complementFor.has(input.id) && tapped(complementFor.get(input.id))) : [];
  const portX = origin.x + 2 * GRID;
  const trueX = new Map(trueRails.map((input, i) => [input.id, portX + 2 * GRID + i * RAIL]));
  const lastTrue = trueRails.length ? portX + 2 * GRID + (trueRails.length - 1) * RAIL : portX;
  const invX = lastTrue + 2 * GRID + 3 * GRID;
  const complementX = new Map(complementRails.map((input, i) => [complementFor.get(input.id).id, invX + 3 * GRID + 3 * GRID + i * RAIL]));
  // By name, the gates start past the header, room for the stubs' names.
  const railsRight = useRails
    ? Math.max(lastTrue, ...complementX.values(), complements.length ? invX + 3 * GRID : lastTrue)
    : (complements.length ? invX + 3 * GRID + 8 * GRID : portX + 2 * GRID);
  const columns = Math.max(0, ...depth.values());
  // The complement gates stand in a header above the gates; with none, the
  // input ports stand beside the gates, level with the rows they feed.
  const header = complements.length > 0 || !useRails;
  // A header row three cells below the one above it, past a complement
  // gate's name: four cells to a row with a gate, six from one to another.
  const headerY = [];
  for (const [i, input] of ordered.entries()) {
    if (!i) { headerY.push(origin.y); continue; }
    const gate = complementFor.has(input.id);
    const before = complementFor.has(ordered[i - 1].id);
    headerY.push(headerY[i - 1] + (gate ? (before ? 6 : 4) : 3) * GRID);
  }
  const headerBottom = headerY.at(-1) ?? origin.y;
  const top = header ? (useRails ? headerBottom + ROW : origin.y) : origin.y + 3 * GRID;

  // Down: rows, shared by every column. A gate of the first column starts a
  // row; a later gate stands in the row of what it reads from the nearest
  // column, level with it by the pin it takes (rails first, then gates top
  // to bottom, as the pins are given out below), so that wire runs straight.
  // Gates joined by name have their inputs' names above and below them:
  // a whole row apart.
  const stack = useRails ? STACK : ROW;
  const rowOf = new Map();
  const offsetOf = new Map();
  let rows = 0;
  const order = [];
  const visit = (node) => {
    if (isRail(node) || node.kind === 'const' || rowOf.has(node.id)) return;
    for (const arg of node.args) visit(arg);
    // An output's buffer takes a row of its own: what it buffers runs on
    // to another output, or is a rail.
    const placed = node.op === 'buffer' ? [] : node.args.filter((arg) => rowOf.has(arg.id));
    if (!placed.length) {
      rowOf.set(node.id, rows++);
      offsetOf.set(node.id, 0);
    } else if (node.op === 'tristate' && rowOf.has(node.args[0].id)) {
      // A tri-state sits level with its data, its enable below.
      rowOf.set(node.id, rowOf.get(node.args[0].id));
      offsetOf.set(node.id, offsetOf.get(node.args[0].id));
    } else {
      // Level with a source by any of its pins: the nearest column first;
      // of those, one leaving the gate clear of the gates already in its
      // column, nearest the other sources.
      const level = (arg) => rowOf.get(arg.id) * ROW + offsetOf.get(arg.id);
      const offsets = pinOffsets(node);
      const placed = node.args.filter((arg) => rowOf.has(arg.id));
      const sources = placed.flatMap((arg) => offsets.slice(0, node.args.length).map((offset) => ({ arg, offset })));
      const d = depthOf(node);
      const taken = order.filter((other) => depth.get(other.id) === d).map((other) => rowOf.get(other.id) * ROW + offsetOf.get(other.id));
      const at = ({ arg, offset }) => level(arg) - offset;
      const middle = placed.reduce((sum, arg) => sum + level(arg), 0) / placed.length;
      const deepest = Math.max(...placed.map((arg) => depth.get(arg.id)));
      const ranked = [...sources].sort((p, q) => (depth.get(q.arg.id) === deepest) - (depth.get(p.arg.id) === deepest)
        || Math.abs(at(p) - middle) - Math.abs(at(q) - middle));
      const nearest = ranked.find((source) => depth.get(source.arg.id) === deepest && taken.every((y) => Math.abs(y - at(source)) >= stack)) || ranked[0];
      rowOf.set(node.id, rowOf.get(nearest.arg.id));
      offsetOf.set(node.id, offsetOf.get(nearest.arg.id) - nearest.offset);
    }
    order.push(node);
  };
  for (const output of result.outputs) visit(output.node);

  // The rows' heights: a gap that a wire runs along between gates is two
  // cells taller, in every column. The gaps: above row k is gap k.
  const extra = new Array(rows + 1).fill(0);
  const levels = (gaps) => {
    const rowY = [];
    let y = top;
    for (let k = 0; k < rows; k++) {
      y += gaps[k];
      rowY.push(y);
      y += ROW;
    }
    const want = new Map(order.map((node) => [node.id, rowY[rowOf.get(node.id)] + offsetOf.get(node.id)]));
    // Within a column, a gate at least a row below the one above it.
    for (let d = 1; d <= columns; d++) {
      const column = order.filter((node) => depth.get(node.id) === d).sort((p, q) => want.get(p.id) - want.get(q.id));
      let floor = -Infinity;
      for (const node of column) {
        const at = Math.max(want.get(node.id), floor);
        want.set(node.id, at);
        // A tri-state's enable comes from below: two cells more.
        floor = at + stack + (node.op === 'tristate' ? 2 * GRID : 0);
      }
    }
    // Output ports level with their gates, three cells apart at least; on
    // a tie, the gate further right keeps the row: its wire is the short one.
    // Back the other way: a gate fed by rails alone may stand anywhere, so
    // it moves level with a pin of a gate that reads it, one no other gate
    // already feeds straight, nearest where it stands, keeping its column
    // apart.
    const first = order.filter((node) => depth.get(node.id) === 1 && node.args.every((arg) => isRail(arg) || arg.kind === 'const'))
      .sort((p, q) => want.get(p.id) - want.get(q.id));
    const firstColumn = order.filter((node) => depth.get(node.id) === 1);
    // Twice: a gate that moved may make room for one handled before it.
    for (const node of [...first, ...first]) {
      const others = firstColumn.filter((other) => other !== node).map((other) => want.get(other.id));
      const options = [];
      for (const reader of order.filter((r) => r.args.includes(node) && r.op !== 'tristate')) {
        const fed = new Set(reader.args.filter((arg) => arg !== node && !isRail(arg) && arg.kind !== 'const').map((arg) => want.get(arg.id)));
        for (const offset of pinOffsets(reader).slice(0, reader.args.length)) {
          const y = want.get(reader.id) + offset;
          if (!fed.has(y) && others.every((other) => Math.abs(other - y) >= stack)) options.push(y);
        }
      }
      if (!options.length) continue;
      const here = want.get(node.id);
      if (options.includes(here)) continue;
      want.set(node.id, options.reduce((best, y) => (Math.abs(y - here) < Math.abs(best - here) ? y : best)));
    }
    // Each level with its gate where it can be, three cells from the next;
    // the gates furthest right first, whose wires are the short ones. The
    // rest take the nearest level free, above or below.
    const ports = new Map();
    const free = (y) => [...ports.values()].every((other) => Math.abs(other - y) >= 3 * GRID);
    const byDepth = [...result.outputs].sort((p, q) => depth.get(q.node.id) - depth.get(p.node.id) || want.get(p.node.id) - want.get(q.node.id));
    const pushed = [];
    for (const output of byDepth) {
      const level = want.get(output.node.id);
      if (free(level)) ports.set(output.name, level);
      else pushed.push(output);
    }
    // A level is clear when its wire passes every gate right of the driver
    // a cell from its box and from the name above it.
    for (const output of pushed.sort((p, q) => want.get(p.node.id) - want.get(q.node.id))) {
      const level = want.get(output.node.id);
      const right = order.filter((node) => depth.get(node.id) > depth.get(output.node.id)).map((node) => want.get(node.id));
      const clearOf = (y) => right.every((gate) => y >= gate + 3 * GRID || y <= gate - 5 * GRID);
      let at = null;
      for (let step = GRID; at === null && step <= 12 * GRID; step += GRID) {
        if (free(level + step) && clearOf(level + step)) at = level + step;
        else if (free(level - step) && clearOf(level - step)) at = level - step;
      }
      for (let step = GRID; at === null; step += GRID) {
        if (free(level + step)) at = level + step;
        else if (free(level - step)) at = level - step;
      }
      ports.set(output.name, at);
    }
    return { want, ports };
  };
  const gapNear = (node, rel) => rowOf.get(node.id) + (rel > 0 ? 1 : 0);
  let { want: wantY, ports: portY } = levels(extra);
  // A later gate's input from a rail comes along a gap past the first
  // column, above or below its row; an output port pushed off its gate's
  // level is reached along the gap below.
  if (useRails) {
    for (const node of order) {
      if (depth.get(node.id) === 1 || node.op === 'tristate') continue;
      const offsets = pinOffsets(node);
      pinOrder(node, (arg) => (wantY.has(arg.id) ? wantY.get(arg.id) : null), wantY.get(node.id)).forEach((arg, i) => {
        if (isRail(arg)) extra[gapNear(node, offsetOf.get(node.id) + offsets[i])] = 2 * GRID;
      });
    }
  }
  for (const output of result.outputs) {
    const off = portY.get(output.name) - wantY.get(output.node.id);
    if (off) extra[rowOf.get(output.node.id) + (off > 0 ? 1 : 0)] = 2 * GRID;
  }
  ({ want: wantY, ports: portY } = levels(extra));

  // Across, now the levels are known: between columns, a track for each wire
  // that turns on its way in, and room to turn; the output ports as near.
  const outLevel = (node) => (isRail(node) || node.kind === 'const' ? null : wantY.get(node.id));
  const turning = (d) => {
    const turns = new Set();
    for (const node of order.filter((n) => depth.get(n.id) === d)) {
      const args = pinOrder(node, (arg) => (rowOf.has(arg.id) ? wantY.get(arg.id) : null), wantY.get(node.id));
      const offsets = pinOffsets(node);
      args.forEach((arg, i) => {
        if (arg.kind === 'const') return;
        if (isRail(arg) || outLevel(arg) !== wantY.get(node.id) + offsets[i] || node.op === 'tristate') turns.add(`${arg.id}>${node.id}`);
      });
    }
    return turns.size;
  };
  const starts = [null, railsRight + 4 * GRID + 3 * GRID];
  for (let d = 2; d <= columns + 1; d++) {
    const turns = d <= columns ? turning(d) : result.outputs.filter((output) => portY.get(output.name) !== wantY.get(output.node.id)).length;
    starts.push(starts[d - 1] + GATE + Math.max(GAP, (turns + 2) * GRID) + (useRails ? 0 : NAMED_GAP));
  }
  // The first column's pins four cells past the rails: room for a ground or
  // a supply hung on one.
  const columnX = (d) => starts[d];

  for (const node of order) place(node, node.type, columnX(depth.get(node.id)), wantY.get(node.id));
  // Pins in the order that turns and crosses the fewest wires (pinOrder).
  const argsOf = new Map(order.map((node) => [node.id, pinOrder(node, (arg) => (wantY.has(arg.id) ? wantY.get(arg.id) : null), wantY.get(node.id))]));
  for (const list of readers.values()) list.length = 0;
  for (const node of order) for (const [i, arg] of argsOf.get(node.id).entries()) readers.get(arg.id).push({ node, pin: pinsOf(node)[i] });

  // Input ports: in the header, a row each beside its complement gate; else
  // from the highest row a rail is tapped on down, each on a row no rail
  // left of its own is tapped on, nor ends on.
  if (header) {
    for (const [row, input] of ordered.entries()) {
      const y = headerY[row];
      place(input, 'input', portX, y, input.name);
      const complement = complementFor.get(input.id);
      if (complement) place(complement, complement.type, invX, y);
    }
  } else {
    const tapRows = new Map(ordered.map((input) => [input.id, readers.get(input.id).filter(({ node }) => depth.get(node.id) === 1)
      .map(({ node, pin }) => wantY.get(node.id) + pinOffsets(node)[pinsOf(node).indexOf(pin)])]));
    const allTaps = [...tapRows.values()].flat();
    // Two cells apart, as a gate's pins are: a port level with its own tap
    // runs straight on into the gate.
    let y = allTaps.length ? Math.min(...allTaps) : top;
    const spans = [];
    for (const input of ordered) {
      const blocked = (at) => spans.some(({ rows: taken, ends }) => taken.includes(at) || ends.includes(at));
      while (blocked(y)) y += GRID;
      place(input, 'input', portX, y, input.name);
      const own = [y, ...tapRows.get(input.id)];
      spans.push({ rows: tapRows.get(input.id), ends: [Math.min(...own), Math.max(...own)] });
      y += 2 * GRID;
    }
  }

  // Output ports, right of the last column.
  const outX = columnX(Math.max(columns, 1) + 1) - 3 * GRID;
  for (const output of result.outputs) {
    const part = circuit.addComponent('output', { refdes: output.name, x: outX, y: portY.get(output.name) });
    added.push(part.refdes);
  }

  // The channel a wire into column d turns in: from two cells past the
  // column before's outputs to two cells before its inputs.
  const channelBefore = (d) => [columnX(d - 1) + 5 * GRID, columnX(d) - 5 * GRID];
  const terminal = (node) => `${ref.get(node.id)}.${node.kind === 'input' ? 'p' : 'y'}`;
  const pinPoint = (node, pin) => circuit.getComponent(ref.get(node.id)).terminalWorld(pin);
  const later = []; // connections left to the router
  const nets = []; // nets whose wires are drawn (drawWires)
  const conns = [];

  // Rails, drawn: the header wire, the rail down to its lowest tap, and a tap
  // to each first-column gate input that reads it.
  if (useRails) {
    // Each rail's wire: the header, the rail down to its lowest tap, and a
    // tap to each first-column gate input; then each later gate's input
    // that reads it, by a free row and a free channel (railTracks).
    const rails = [];
    for (const input of ordered) {
      const y = pos.get(input.id).y;
      const complement = complementFor.get(input.id);
      const x = trueX.get(input.id);
      const paths = [];
      const terms = [`${input.name}.p`];
      if (complement) {
        const pins = pinsOf(complement).map((pin) => ({ pin, at: pinPoint(complement, pin) }));
        terms.push(...pins.map(({ pin }) => `${ref.get(complement.id)}.${pin}`));
        if (pins.length === 1) paths.push([{ x: portX, y }, pins[0].at]);
        else {
          // Both inputs of a NAND or NOR tied: a bar a cell before them.
          const barX = pins[0].at.x - GRID;
          paths.push([{ x: portX, y }, { x: barX, y }], [{ x: barX, y: pins[0].at.y }, { x: barX, y: pins.at(-1).at.y }]);
          for (const { at: point } of pins) paths.push([{ x: barX, y: point.y }, point]);
        }
      } else if (x !== undefined) paths.push([{ x: portX, y }, { x, y }]);
      rails.push({ node: input, x, y, paths, terms, source: `${input.name}.p` });
    }
    for (const complement of complements) {
      const out = pinPoint(complement, 'y');
      const x = complementX.get(complement.id);
      rails.push({ node: complement, x, y: out.y, paths: x === undefined ? [] : [[out, { x, y: out.y }]], terms: [`${ref.get(complement.id)}.y`], source: `${ref.get(complement.id)}.y` });
    }
    for (const rail of rails) {
      if (rail.x === undefined) continue;
      const taps = readers.get(rail.node.id).filter(({ node }) => depth.get(node.id) === 1);
      railPaths(rail.paths, rail.terms, rail.x, rail.y, taps, ref, pinPoint);
    }
    for (const rail of rails) if (rail.x === undefined && rail.paths.length) nets.push(rail);
    for (const rail of rails) {
      if (rail.x === undefined) continue;
      nets.push(rail);
      for (const { node, pin } of readers.get(rail.node.id)) {
        if (depth.get(node.id) !== 1) conns.push({ net: rail, pin: pinPoint(node, pin), term: `${ref.get(node.id)}.${pin}`, target: ref.get(node.id), channel: channelBefore(depth.get(node.id)), fallback: [`${ref.get(node.id)}.${pin}`, rail.source, rail.node] });
      }
    }
    for (const rail of rails) if (rail.x === undefined) {
      for (const { node, pin } of readers.get(rail.node.id)) later.push([`${ref.get(node.id)}.${pin}`, rail.source, rail.node]);
    }
  } else {
    // By name: a port wired to its complement gate, or a short wire.
    for (const input of ordered) {
      const complement = complementFor.get(input.id);
      if (complement) {
        const terms = [`${input.name}.p`, ...pinsOf(complement).map((pin) => `${ref.get(complement.id)}.${pin}`)];
        const port = circuit.getComponent(input.name).terminalWorld('p');
        const pins = pinsOf(complement).map((pin) => pinPoint(complement, pin));
        const paths = pins.length === 1 ? [[port, pins[0]]] : (() => {
          const barX = pins[0].x - GRID;
          return [[port, { x: barX, y: port.y }], [{ x: barX, y: pins[0].y }, { x: barX, y: pins[1].y }], ...pins.map((p) => [{ x: barX, y: p.y }, p])];
        })();
        installNet(circuit, terms, paths);
      }
    }
    const named = [];
    for (const rail of [...ordered, ...complements]) {
      const name = railName(rail);
      if (rail.kind !== 'input') named.push({ terms: [`${ref.get(rail.id)}.y`], name, from: rail });
      for (const { node, pin } of readers.get(rail.id)) named.push({ terms: [`${ref.get(node.id)}.${pin}`], name });
    }
    for (const { terms, name } of named) namedStub(circuit, terms[0], name);
  }

  // Constants: a ground or a supply on the pin.
  for (const node of order) for (const [i, arg] of argsOf.get(node.id).entries()) if (arg.kind === 'const') addRail(circuit, `${ref.get(node.id)}.${pinsOf(node)[i]}`, arg.value, added);

  // Gate to gate, and gate to port (every output is a gate's:
  // synthesizeLogic buffers the rest), drawn; a tri-state's enable, from
  // below, and what cannot be drawn, by the router.
  const gateNets = new Map();
  const netOf = (node) => {
    if (!gateNets.has(node.id)) {
      const net = { paths: [], terms: [terminal(node)] };
      gateNets.set(node.id, net);
      nets.push(net);
    }
    return gateNets.get(node.id);
  };
  const drawn = mode !== 'names';
  for (const node of order) {
    for (const [i, arg] of argsOf.get(node.id).entries()) {
      if (isRail(arg) || arg.kind === 'const') continue;
      const term = `${ref.get(node.id)}.${pinsOf(node)[i]}`;
      if (!drawn || (node.op === 'tristate' && pinsOf(node)[i] === 'en')) later.push([term, terminal(arg)]);
      else conns.push({ net: netOf(arg), from: pinPoint(arg, 'y'), pin: pinPoint(node, pinsOf(node)[i]), term, target: ref.get(node.id), source: ref.get(arg.id), channel: channelBefore(depth.get(node.id)), fallback: [term, terminal(arg)] });
    }
  }
  for (const output of result.outputs) {
    const term = `${output.name}.p`;
    if (!drawn) later.push([term, terminal(output.node)]);
    else conns.push({ net: netOf(output.node), from: pinPoint(output.node, 'y'), pin: circuit.getComponent(output.name).terminalWorld('p'), term, target: output.name, source: ref.get(output.node.id), channel: [columnX(Math.max(columns, 1)) + 5 * GRID, outX - 2 * GRID], fallback: [term, terminal(output.node)] });
  }
  const above = header ? headerBottom + 2 * GRID : origin.y;
  const placed = drawWires(circuit, nets, conns, { above });
  for (const conn of conns) if (!placed.has(conn)) later.push(conn.fallback);
  for (const net of nets) if (net.paths.length) installNet(circuit, net.terms, net.paths);
  // Routed first, all of them; what the router cannot reach is joined by
  // name after, when most outputs have a wire to carry the name.
  const unrouted = [];
  for (const [a, b, rail] of later) {
    if ((rail?.kind === 'input' && !useRails) || mode === 'names') unrouted.push([a, b, rail]);
    else {
      try {
        circuit.connect(a, b);
      } catch {
        unrouted.push([a, b, rail]);
      }
    }
  }
  for (const [a, b, rail] of unrouted) {
    // An input port names its own signal.
    if (rail?.kind === 'input') namedStub(circuit, a, rail.name);
    else joinByName(circuit, a, b, rail ? railName(rail) : null);
  }
  // A port joined only by name still has a wire of its own.
  for (const name of [...result.inputs, ...result.outputs.map((output) => output.name)]) {
    if (circuit.netOfTerminal({ comp: name, term: 'p' })) continue;
    const port = circuit.getComponent(name);
    const p = port.terminalWorld('p');
    const out = port.type === 'output' ? -1 : 1;
    installNet(circuit, [`${name}.p`], [[p, { x: p.x + out * 2 * GRID, y: p.y }]]);
  }
}

/**
 * Join `a` (a port, or a gate input) to the output `b` by name, where the
 * router finds no way: `given` (a complement rail's), the port's, the
 * net's, or a fresh n1, n2... on a stub at each end that has no wire.
 */
function joinByName(circuit, a, b, given = null) {
  const [comp] = a.split('.');
  const port = circuit.getComponent(comp).type === 'output';
  const net = circuit.netOfTerminal(circuit.resolveTerm(b));
  const taken = new Set([...circuit.nets.values()].map((other) => other.name?.toLowerCase()).filter(Boolean));
  for (const refdes of circuit.components.keys()) taken.add(refdes.toLowerCase());
  let name = given || (port ? comp : net?.name);
  for (let k = 1; !name; k++) if (!taken.has(`n${k}`)) name = `n${k}`;
  if (!net) namedStub(circuit, b, name);
  else if (net.name !== name) {
    circuit.renameNet(net, name);
    if (![...circuit.labels.values()].some((label) => label.netId === net.id)) {
      const out = circuit.getComponent(b.split('.')[0]).terminalWorld('y');
      circuit.addNetLabel(net, { anchor: { x: out.x + GRID, y: out.y }, netSide: 'above', align: 'left' });
    }
  }
  if (!port) namedStub(circuit, a, name);
}

/** The name a rail is joined by: its input's, or its complement's (A̅). */
function railName(rail) {
  // Label markup has no TeX: an overbar is a combining overline per letter
  // (D̅[3̅] for a bus bit, its brackets left bare).
  return rail.kind === 'input' ? rail.name : [...rail.inverts.name].map((ch) => (/[\w]/.test(ch) ? `${ch}\u0305` : ch)).join('');
}

/** Segments of `paths`, each { a, b } with a before b. */
function segmentsOf(paths) {
  const out = [];
  for (const path of paths) {
    for (let i = 1; i < path.length; i++) {
      const [a, b] = [path[i - 1], path[i]];
      out.push(a.x < b.x || a.y < b.y ? { a, b } : { a: b, b: a });
    }
  }
  return out;
}

const onSegment = (p, { a, b }) => (a.x === b.x ? p.x === a.x && p.y >= a.y && p.y <= b.y : p.y === a.y && p.x >= a.x && p.x <= b.x);

/** Two segments lying along each other for some length. */
function alongside(s, t) {
  if (s.a.x === s.b.x && t.a.x === t.b.x && s.a.x === t.a.x) return Math.min(s.b.y, t.b.y) > Math.max(s.a.y, t.a.y);
  if (s.a.y === s.b.y && t.a.y === t.b.y && s.a.y === t.a.y) return Math.min(s.b.x, t.b.x) > Math.max(s.a.x, t.a.x);
  return false;
}

/** Whether segment `s` passes within a cell of box `r` ({ x, y, w, h }). */
function nearBox(s, r, margin) {
  const x0 = r.x - margin;
  const x1 = r.x + r.w + margin;
  const y0 = r.y - margin;
  const y1 = r.y + r.h + margin;
  return Math.max(s.a.x, x0) < Math.min(s.b.x, x1) + (s.a.x === s.b.x ? 1 : 0) && Math.max(s.a.y, y0) < Math.min(s.b.y, y1) + (s.a.y === s.b.y ? 1 : 0)
    && s.a.x < x1 && s.b.x > x0 && s.a.y < y1 && s.b.y > y0;
}

/**
 * Wires drawn rather than routed, each from its net to a pin: from a rail
 * (extended up or down) along a free row; or from a gate's output straight
 * across when level, else turning once in a free channel before the pin's
 * column, else down a channel after the gate to a free row and along it;
 * into the pin. A row and a channel are free when the wire keeps a cell
 * from every part and clear of the labels, and neither runs along another
 * net's wire nor ends on one. Each net is { paths, terms, x (a rail's) };
 * each connection { net, from (an output pin; none for a rail), pin, term,
 * target }. Returns the connections drawn.
 */
function drawWires(circuit, nets, conns, { above }) {
  const done = new Set();
  if (!conns.length) return done;
  const bodies = [...circuit.components.values()].map((part) => ({ refdes: part.refdes, box: part.bboxWorld() }));
  const labels = [...circuit.labels.values()].filter((label) => label.owner).map((label) => label.bbox()).filter(Boolean);
  const wires = new Map(nets.map((net) => [net, segmentsOf(net.paths)]));
  const bottom = Math.max(...bodies.map(({ box }) => box.y + box.h));
  // A wire leaves its gate and enters its pin through the part's own box:
  // the first and the last segment pass by that part only.
  const clear = (net, segments, skip) => {
    for (const [i, seg] of segments.entries()) {
      const own = i === 0 ? skip.first : i === segments.length - 1 ? skip.last : null;
      for (const { refdes, box } of bodies) {
        if (refdes === own && seg.a.y === seg.b.y) continue;
        if (nearBox(seg, box, GRID)) return false;
      }
      for (const box of labels) if (nearBox(seg, box, 0)) return false;
    }
    const corners = segments.flatMap((seg) => [seg.a, seg.b]);
    for (const [other, theirs] of wires) {
      if (other === net) continue;
      for (const t of theirs) {
        if (segments.some((seg) => alongside(seg, t))) return false;
        if (corners.some((point) => onSegment(point, t))) return false;
        if (segments.some((seg) => onSegment(t.a, seg) || onSegment(t.b, seg))) return false;
      }
    }
    return true;
  };
  /** The path from where it leaves the net's own wire. */
  const trimmed = (net, path) => {
    const own = wires.get(net);
    const on = (point) => own.some((seg) => onSegment(point, seg));
    let start = 0;
    let from = path[0];
    for (let i = 1; i < path.length; i++) {
      const [a, b] = [path[i - 1], path[i]];
      const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / GRID;
      let k = 0;
      while (k < steps && on({ x: a.x + Math.sign(b.x - a.x) * GRID * (k + 1), y: a.y + Math.sign(b.y - a.y) * GRID * (k + 1) })) k++;
      from = { x: a.x + Math.sign(b.x - a.x) * GRID * k, y: a.y + Math.sign(b.y - a.y) * GRID * k };
      start = i;
      if (k < steps) break;
    }
    return [from, ...path.slice(start)].filter((point, i, list) => i === 0 || point.x !== list[i - 1].x || point.y !== list[i - 1].y);
  };
  const rowsNear = (y) => {
    const rows = [];
    for (let row = above; row <= bottom + 2 * GRID; row += GRID) rows.push(row);
    return rows.sort((p, q) => Math.abs(p - y) - Math.abs(q - y)).slice(0, 40);
  };
  const ordered = [...conns].sort((p, q) => (p.from ? Math.abs(p.from.y - p.pin.y) : Infinity) - (q.from ? Math.abs(q.from.y - q.pin.y) : Infinity));
  for (const conn of ordered) {
    const { net, pin } = conn;
    const skip = { first: conn.source, last: conn.target };
    // Where a wire turns down: on a turn its net already makes, else from
    // the middle of its channel out, so the turns spread evenly.
    const jogs = (lo, hi) => {
      const [from, to] = conn.channel || [lo, hi];
      const mid = Math.round((Math.max(lo, from) + Math.min(hi, to)) / 2 / GRID) * GRID;
      const xs = [];
      for (let x = Math.ceil(lo / GRID) * GRID; x <= hi; x += GRID) xs.push(x);
      const reuse = new Set(wires.get(net).filter((seg) => seg.a.x === seg.b.x && seg.a.x !== net.x).map((seg) => seg.a.x));
      return xs.sort((p, q) => (reuse.has(q) - reuse.has(p)) || Math.abs(p - mid) - Math.abs(q - mid));
    };
    const candidates = function* candidates() {
      if (!conn.from) {
        const own = wires.get(net).filter((seg) => seg.a.x === net.x && seg.b.x === net.x);
        const top = Math.min(net.y, ...own.map((seg) => seg.a.y));
        const low = Math.max(net.y, ...own.map((seg) => seg.b.y));
        for (const row of rowsNear(pin.y)) {
          const extension = row > low ? [[{ x: net.x, y: low }, { x: net.x, y: row }]] : row < top ? [[{ x: net.x, y: row }, { x: net.x, y: top }]] : [];
          if (row === pin.y) yield { path: [{ x: net.x, y: row }, pin], extension };
          else for (const jog of jogs(Math.max(net.x + 2 * GRID, pin.x - 12 * GRID), pin.x - 2 * GRID)) yield { path: [{ x: net.x, y: row }, { x: jog, y: row }, { x: jog, y: pin.y }, pin], extension };
        }
        return;
      }
      const start = conn.from;
      if (start.y === pin.y) yield { path: [start, pin], extension: [] };
      for (const jog of jogs(start.x + 2 * GRID, pin.x - 2 * GRID)) yield { path: [start, { x: jog, y: start.y }, { x: jog, y: pin.y }, pin], extension: [] };
      for (const row of rowsNear(pin.y)) {
        if (row === start.y || row === pin.y) continue;
        for (let out = start.x + 2 * GRID; out <= start.x + 4 * GRID; out += GRID) {
          for (const jog of jogs(Math.max(out + 2 * GRID, pin.x - 8 * GRID), pin.x - 2 * GRID)) {
            yield { path: [start, { x: out, y: start.y }, { x: out, y: row }, { x: jog, y: row }, { x: jog, y: pin.y }, pin], extension: [] };
          }
        }
      }
    };
    for (const candidate of candidates()) {
      const path = trimmed(net, candidate.path);
      if (path.length < 2) continue;
      // A trimmed path no longer starts at its gate; a rail's extension
      // passes by every part.
      const ends = { first: path[0] === candidate.path[0] ? skip.first : null, last: skip.last };
      if (!clear(net, segmentsOf([path]), ends) || !clear(net, segmentsOf(candidate.extension), {})) continue;
      net.paths.push(...candidate.extension, path);
      net.terms.push(conn.term);
      wires.set(net, segmentsOf(net.paths));
      done.add(conn);
      break;
    }
  }
  return done;
}

/** A rail from `y` (its port's row) to its farthest taps, and the taps. */
function railPaths(paths, terms, x, y, taps, ref, pinPoint) {
  if (!taps.length) return;
  const points = taps.map(({ node, pin }) => ({ term: `${ref.get(node.id)}.${pin}`, at: pinPoint(node, pin) }));
  const ys = [y, ...points.map((p) => p.at.y)];
  paths.push([{ x, y: Math.min(...ys) }, { x, y: Math.max(...ys) }]);
  for (const { term, at: point } of points) {
    terms.push(term);
    paths.push([{ x, y: point.y }, point]);
  }
}

function installNet(circuit, terms, paths) {
  const net = circuit.createWireNet({ branches: paths, route: paths[0] });
  for (const term of terms) circuit.connectTo(net.id, term);
  if (!circuit.installNetPaths(net, paths)) throw new Error(`could not draw the wires of ${terms[0]}`);
  return net;
}

function namedStub(circuit, term, name) {
  // A three-input gate's names: above, in line, and below, a cell apart.
  const part = circuit.getComponent(term.split('.')[0]);
  const pin = term.split('.')[1];
  const side = part.terminalDefs.length === 4 ? { b: 'end', c: 'below' }[pin] : null;
  // A cell long where two would run into a wire.
  for (const cells of [2, 1]) {
    const { stubs } = addTerminalStubs(circuit, [part.refdes], { terms: [term], names: { [term]: name }, sides: side ? { [term]: side } : null, cells });
    if (stubs.length) return;
  }
  throw new Error(`no room for a stub on ${term}`);
}

function addRail(circuit, term, value, added) {
  const [comp, pin] = term.split('.');
  const marker = addPinRail(circuit, { comp, term: pin }, value ? 'supply' : 'ground');
  added.push(marker.refdes);
}
