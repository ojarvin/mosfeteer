/**
 * Draw the small-signal model the solve actually used as an ordinary
 * schematic: one column per node, shunt branches hanging from each node down
 * to a single AC-ground rail, and series branches stacked in rows above the
 * node line. The primitives come from the pipeline *after* its pre-solve
 * transforms (Miller decoupling, `r_o -> infinity`, triode overrides), so the
 * drawing shows the circuit the displayed equations describe, not the
 * schematic they came from.
 *
 * The result is an ordinary `Circuit`: it renders, exports, and analyzes like
 * any other document, which is what makes it checkable -- analyzing the model
 * must reproduce the source schematic's equations.
 */
import { Circuit } from '../model.js';
import { rectsOverlap } from '../geometry.js';
import { createRationalOps } from './algebra-ops.js';
import { renderExpression } from './present.js';

const AC_GROUND_NODE = '@AC_GROUND';

const AC_GROUND_NAMES = new Set([AC_GROUND_NODE, '0', 'AC_GROUND']);
const SOURCE_KINDS = new Set(['vccs', 'current-source', 'voltage-source', 'opamp']);
// One row of the model per branch between a node and the AC ground.
const LEVEL_H = 240;
// The ground symbol's pin, under the row of the AC ground.
const GROUND_DROP = 40;
const PORT_GAP = 160;
// The free cells between a symbol and the label of the branch after it.
const ELEMENT_GAP = 80;

/** Elements whose branch is drawn with each symbol. */
const ELEMENT_TYPES = new Map([
  ['resistor', 'resistor'],
  ['conductance', 'resistor'],
  ['triode-resistance', 'resistor'],
  ['capacitor', 'capacitor'],
  ['inductor', 'inductor'],
  ['vccs', 'vccs'],
  // An opamp: a VCVS from its output to its reference.
  ['opamp', 'vcvs'],
  ['current-source', 'current_source'],
  ['voltage-source', 'voltage_source'],
]);

function isGround(node) {
  return node === undefined || node === null || AC_GROUND_NAMES.has(String(node));
}

/** Accept every primitive shape the pipeline hands out: branches carry `a`/`b`
 * or `terminals`, controlled sources carry `outPlus`/`outMinus`. */
function normalize(primitive) {
  if (!primitive || typeof primitive !== 'object') return null;
  // A differential opamp's common-mode constraint has no branch to draw.
  if (String(primitive.kind || '').toLowerCase() === 'opamp-cm') return null;
  const a = primitive.a ?? primitive.terminals?.a ?? primitive.outPlus;
  const b = primitive.b ?? primitive.terminals?.b ?? primitive.outMinus;
  if (a === undefined && b === undefined) return null;
  const controlA = primitive.control?.a ?? primitive.controlPlus;
  const controlB = primitive.control?.b ?? primitive.controlMinus;
  return {
    id: String(primitive.id || primitive.kind || 'primitive'),
    kind: String(primitive.kind || '').toLowerCase(),
    a: isGround(a) ? AC_GROUND_NODE : String(a),
    b: isGround(b) ? AC_GROUND_NODE : String(b),
    control: controlA === undefined && controlB === undefined ? null : {
      a: isGround(controlA) ? AC_GROUND_NODE : String(controlA),
      b: isGround(controlB) ? AC_GROUND_NODE : String(controlB),
    },
    parameter: primitive.parameter ? String(primitive.parameter) : '',
    value: primitive.value,
    metadata: primitive.metadata || {},
    source: primitive,
  };
}

/** `ro1` -> `r_{o1}`, `CGD` -> `C_{GD}`, `gmb2` -> `g_{mb2}`: the same textbook
 * spelling the netlist and the equations use. */
function textbookSymbol(raw) {
  const name = String(raw || '');
  if (!name) return '';
  if (/^gmb[A-Za-z0-9_]*$/.test(name)) return `g_{mb${name.slice(3)}}`;
  if (/^gm[A-Za-z0-9_]*$/.test(name)) return `g_{m${name.slice(2)}}`;
  if (/^go[A-Za-z0-9_]*$/.test(name)) return `g_{o${name.slice(2)}}`;
  if (/^rds[A-Za-z0-9_]*$/.test(name)) return `r_{ds${name.slice(3)}}`;
  if (/^rd[A-Za-z0-9_]*$/.test(name)) return `r_{d${name.slice(2)}}`;
  if (/^ro[A-Za-z0-9_]*$/.test(name)) return `r_{o${name.slice(2)}}`;
  if (/^[RCL][A-Za-z0-9_]+$/.test(name)) return `${name[0]}_{${name.slice(1)}}`;
  return name;
}

/** A node's name as math: a textbook name (`V_{OUT}`) as it is, a plain
 * one (`VIN`, `N4`) upright. */
function mathNode(name) {
  return /[_^\\]/.test(name) ? name : `\\mathrm{${name}}`;
}

/**
 * A controlled source is labeled with its own transconductance times the
 * controlling voltage, the way a hybrid-pi figure is drawn: the control pair
 * is text, never a second pair of wires across the drawing. The pair names the
 * drawing's own nodes -- `g_{m1}\,\mathrm{VIN}`, not `g_{m1} v_{gs1}` -- so the
 * reader can follow the control back to a node without decoding a subscript.
 * A grounded side drops out: `g_{m1}\,\mathrm{VIN}`, `-g_{m2}\,\mathrm{N4}`.
 */
function controlTimes(gain, control, nodeName) {
  const plus = nodeName(control?.a);
  const minus = nodeName(control?.b);
  if (plus && minus) return `${gain}\\,(${mathNode(plus)} - ${mathNode(minus)})`;
  if (plus) return `${gain}\\,${mathNode(plus)}`;
  if (minus) return `-${gain}\\,${mathNode(minus)}`;
  return gain;
}

/**
 * A Miller shunt has no parameter symbol of its own, and its admittance is a
 * whole fraction -- far too wide to sit beside a symbol. Name it the way a
 * textbook does and state the value in the legend below the drawing.
 */
function millerSymbol(element, symbol) {
  const device = String(element.metadata?.component || '').replace(/\W/g, '') || 'M';
  const side = element.metadata?.millerSide === 'output' ? 'out' : 'in';
  return `${symbol === 'capacitor' ? 'C' : 'Y'}_{${device},${side}}`;
}

/** An admittance divided by `s`, when that leaves no frequency behind: the
 * capacitance a capacitive shunt is drawn as. */
function perFrequency(value, options) {
  try {
    const ops = createRationalOps({ variable: 's', maxOperations: 4000 });
    const capacitance = ops.div(value, ops.s());
    if (ops.budget?.exceeded) return null;
    const rendered = renderExpression(capacitance, options.renderOptions || {});
    return /(^|[^A-Za-z])s([^A-Za-z]|$)/.test(rendered) ? null : rendered;
  } catch { return null; }
}

function elementLabel(element, symbol, options, nodeName) {
  if (element.kind === 'vccs') return { text: element.control ? controlTimes(textbookSymbol(element.parameter) || 'g_m', element.control, nodeName) : textbookSymbol(element.parameter) || 'g_m' };
  if (element.kind === 'opamp') {
    // Its gain times its inputs' difference: infinite when ideal.
    const parameter = textbookSymbol(element.metadata.opampParameter || '');
    const model = element.metadata.opampModel;
    const gain = model === 'finite-gain' ? parameter : model === 'gbw' ? `\\frac{${parameter}}{s}` : '\\infty';
    return { text: controlTimes(gain, element.control, nodeName) };
  }
  if (element.parameter) return { text: textbookSymbol(element.parameter) };
  let rendered = '';
  try { rendered = renderExpression(element.value, options.renderOptions || {}); }
  catch { rendered = ''; }
  if (element.kind === 'admittance') {
    // A Miller capacitance the solve used as a symbol: the same name, and its
    // definition as the equations' "Where" states it.
    const derived = element.metadata?.millerSymbol && (options.derived || []).find((entry) => entry.name === element.metadata.millerSymbol);
    if (derived) return { text: derived.name, legend: { symbol: derived.name, value: derived.tex } };
    const name = millerSymbol(element, symbol);
    // A shunt drawn as a capacitor is named as one, so state a capacitance:
    // the primitive carries the admittance Y = sC, and C = Y/s is the
    // textbook Miller value.
    if (symbol === 'capacitor') {
      const capacitance = perFrequency(element.value, options);
      if (capacitance) return { text: name, legend: { symbol: name, value: capacitance } };
    }
    return { text: name, legend: rendered ? { symbol: `Y_{${name.slice(name.indexOf('{') + 1, -1)}}`, value: rendered } : null };
  }
  return { text: rendered || element.id };
}

/** Local offset that renders at a given world offset for a placed symbol. */
function localOffset(dx, dy, rotation) {
  const turn = ((rotation % 360) + 360) % 360;
  if (turn === 90) return { x: dy, y: -dx };
  if (turn === 180) return { x: -dx, y: -dy };
  if (turn === 270) return { x: -dy, y: dx };
  return { x: dx, y: dy };
}

/** A Miller shunt made only of capacitors is a capacitor in the drawing --
 * that is exactly the textbook Miller capacitance. */
function elementSymbol(element) {
  const mapped = ELEMENT_TYPES.get(element.kind);
  if (mapped) return mapped;
  if (element.kind === 'admittance') {
    const kinds = element.metadata?.feedbackKinds || [];
    if (kinds.length && kinds.every((kind) => kind === 'capacitor')) return 'capacitor';
  }
  return 'resistor';
}

function uniqueRefdes(base, used) {
  const clean = String(base || 'X').replace(/[^A-Za-z0-9_]/g, '') || 'X';
  let candidate = /^[A-Za-z]/.test(clean) ? clean : `X${clean}`;
  let index = 2;
  while (used.has(candidate)) candidate = `${clean}_${index++}`;
  used.add(candidate);
  return candidate;
}

/** Node display names, preferring the source circuit's own net names. */
function nodeNames(report, options) {
  const names = new Map();
  const circuit = options.circuit;
  if (circuit) {
    for (const net of circuit.nets.values()) names.set(net.id, net.name || net.id);
  }
  for (const [key, value] of options.nodeNames instanceof Map ? options.nodeNames : []) names.set(key, value);
  return names;
}

/**
 * Node order across the drawing. The source schematic's own left-to-right
 * order is the one the reader already knows, so use it when the circuit is
 * available; otherwise fall back to first appearance with the analysis input
 * first and its output last.
 */
function orderNodes(elements, report, options) {
  const seen = [];
  for (const element of elements) {
    for (const node of [element.a, element.b, element.control?.a, element.control?.b]) {
      if (node && node !== AC_GROUND_NODE && !seen.includes(node)) seen.push(node);
    }
  }
  const circuit = options.circuit;
  const center = new Map();
  if (circuit) {
    for (const node of seen) {
      const net = circuit.nets.get(node);
      const points = (net?.terminals || []).map((terminal) => {
        try { return circuit.getComponent(terminal.comp).terminalWorld(terminal.term).x; }
        catch { return null; }
      }).filter((value) => value !== null);
      if (points.length) center.set(node, points.reduce((sum, value) => sum + value, 0) / points.length);
    }
  }
  const inputNode = portNode(report, 'input');
  const outputNode = portNode(report, 'output');
  const rank = (node) => node === inputNode ? -Infinity : node === outputNode ? Infinity : 0;
  return [...seen].sort((left, right) => {
    const ranked = rank(left) - rank(right);
    if (Number.isFinite(ranked) && ranked !== 0) return ranked;
    if (!Number.isFinite(ranked)) return ranked < 0 ? -1 : 1;
    const a = center.get(left);
    const b = center.get(right);
    if (a !== undefined && b !== undefined && a !== b) return a - b;
    return seen.indexOf(left) - seen.indexOf(right);
  });
}

/** The analysis node a port role resolved to, as the context recorded it. */
function portNode(report, role) {
  const context = report?.context || report?.details?.pipeline?.context;
  return context?.[role]?.node || null;
}

/** A net's straight runs, longest first, horizontal ones before vertical:
 * `{ horizontal, from, to, at }`, `at` the run's own y (or x). */
function wireRuns(net) {
  const runs = [];
  for (const path of net.paths ? net.paths() : []) {
    for (let index = 1; index < path.length; index += 1) {
      const [a, b] = [path[index - 1], path[index]];
      if (a.y === b.y && a.x !== b.x) runs.push({ horizontal: true, from: Math.min(a.x, b.x), to: Math.max(a.x, b.x), at: a.y });
      else if (a.x === b.x && a.y !== b.y) runs.push({ horizontal: false, from: Math.min(a.y, b.y), to: Math.max(a.y, b.y), at: a.x });
    }
  }
  return runs.sort((left, right) => Number(right.horizontal) - Number(left.horizontal) || (right.to - right.from) - (left.to - left.from));
}

/** Grid points along a run, from its middle outward. */
function alongRun({ from, to }) {
  const middle = snapTo((from + to) / 2);
  const points = [middle];
  for (let step = 40; middle - step >= from || middle + step <= to; step += 40) points.push(middle - step, middle + step);
  return points.filter((value) => value >= from && value <= to);
}

/**
 * Hang a node's name on its wire: the middle of its longest run, above or
 * below a horizontal one, else beside a vertical one, the first place it
 * covers no symbol, label, or other wire. A node whose wires are all crowded
 * keeps its name in the net list rather than printing it over a component.
 */
function placeNetName(circuit, net, boxes) {
  for (const run of wireRuns(net)) {
    const sides = run.horizontal ? ['above', 'below'] : ['right', 'left'];
    for (const along of alongRun(run)) {
      const anchor = run.horizontal ? { x: along, y: run.at } : { x: run.at, y: along };
      for (const netSide of sides) {
        let label;
        try { label = circuit.addNetLabel(net, { anchor, netSide }); }
        catch { continue; }
        const box = label.bbox();
        if (!boxes.some((other) => rectsOverlap(box, other))) {
          boxes.push(box);
          return label;
        }
        circuit.removeLabel(label.id);
      }
    }
  }
  return null;
}

function snapTo(value) {
  return Math.round(value / 40) * 40;
}

/** Every wire segment of every net, as thin boxes a label must not cover. */
function wireBoxes(circuit, except = null) {
  const boxes = [];
  for (const net of circuit.nets.values()) {
    if (net === except) continue;
    for (const path of net.paths ? net.paths() : []) {
      for (let index = 1; index < path.length; index += 1) {
        const [a, b] = [path[index - 1], path[index]];
        boxes.push({ x: Math.min(a.x, b.x) - 1, y: Math.min(a.y, b.y) - 1, w: Math.abs(a.x - b.x) + 2, h: Math.abs(a.y - b.y) + 2 });
      }
    }
  }
  return boxes;
}

/**
 * A math label's footprint: its text's own estimated size in whole pairs of
 * cells. Saved with the label (`mathBox`), it stands for the browser's
 * measurement until there is one, so the label sits a cell off its symbol
 * as drawn, not off the spare cells an unmeasured math box keeps.
 */
function mathFootprint(text) {
  const probe = new Circuit().addLabel({ text, x: 0, y: 0, align: 'center', math: true });
  const pair = (size) => Math.max(80, 80 * Math.ceil(size / 80));
  return { w: pair(probe.textWidth()), h: pair(probe.textHeight()) };
}

/**
 * Build the drawn model.
 *
 * `ports: false` leaves out the interface ports and names every node with a
 * net label instead: the form placed into a design, whose own ports already
 * carry those names.
 *
 * @param {object} report a successful `analyzeSmallSignalV2` report
 * @param {{circuit?: import('../model.js').Circuit, nodeNames?: Map, ports?: boolean}} options
 * @returns {{ok: boolean, circuit?: Circuit, correspondence?: Map, notes: string[], error?: string}}
 */
export function smallSignalSchematic(report, options = {}) {
  const primitives = report?.details?.pipeline?.selected;
  if (!Array.isArray(primitives) || !primitives.length) {
    return { ok: false, notes: [], error: 'this analysis produced no small-signal primitives to draw' };
  }
  const withPorts = options.ports !== false;
  const elements = primitives.map(normalize).filter(Boolean);
  const names = nodeNames(report, options);
  // The node's own name, markup included: label text renders `_{...}`.
  const nodeName = (node) => (!node || node === AC_GROUND_NODE ? '' : String(names.get(node) || node));
  const plainName = (node) => nodeName(node).replace(/[_^]\{([^}]*)\}/g, '$1');
  const nodes = orderNodes(elements, report, options);
  // A controlled source across one node carries no current -- the body
  // effect of a device whose source is the AC reference. Drawing it says
  // nothing and costs a place.
  const branches = elements.filter((element) => !(element.a === AC_GROUND_NODE && element.b === AC_GROUND_NODE)
    && !(element.control && element.control.a === element.control.b));

  // Rows: the AC ground at the bottom, and a transconductance's drain end
  // above its source end, so a transistor stacked on another stands on it in
  // the figure as it does in the schematic. Every other node stands on the
  // first row; a resistor or capacitor spans whatever rows its ends are on.
  const level = new Map([[AC_GROUND_NODE, 0]]);
  for (const element of branches) {
    for (const node of [element.a, element.b]) if (!level.has(node)) level.set(node, 1);
  }
  const above = branches.filter((element) => element.kind === 'vccs' && element.a !== AC_GROUND_NODE).map((element) => [element.a, element.b]);
  for (let pass = 0, changed = true; changed; pass += 1) {
    changed = false;
    // Drains feeding back on their own sources leave no order to keep:
    // every node then stands on the first row.
    if (pass > level.size) {
      for (const node of level.keys()) if (node !== AC_GROUND_NODE) level.set(node, 1);
      break;
    }
    for (const [upper, lower] of above) {
      if (level.get(upper) > level.get(lower)) continue;
      level.set(upper, level.get(lower) + 1);
      changed = true;
    }
  }
  const top = Math.max(1, ...level.values());
  const rowY = (row) => -row * LEVEL_H;

  // A device's branches between the same two nodes -- g_m, g_mb, and r_o of
  // one transistor -- stand side by side, sources first: one parallel unit.
  // A branch whose ends share a row lies along it, a unit of its own.
  const units = new Map();
  for (const element of branches) {
    const [upper, lower] = level.get(element.a) >= level.get(element.b) ? [element.a, element.b] : [element.b, element.a];
    const flat = level.get(upper) === level.get(lower);
    const key = flat ? element.id : `${upper}|${lower}|${element.metadata?.component || element.id}`;
    if (!units.has(key)) units.set(key, { upper, lower, flat, elements: [], order: units.size, component: element.metadata?.component || null });
    units.get(key).elements.push(element);
  }
  for (const unit of units.values()) {
    unit.elements.sort((left, right) => Number(SOURCE_KINDS.has(right.kind)) - Number(SOURCE_KINDS.has(left.kind)));
    unit.hi = level.get(unit.upper);
    unit.lo = level.get(unit.lower);
  }

  const symbols = new Map(elements.map((element) => [element, elementSymbol(element)]));
  const labels = new Map(elements.map((element) => [element, elementLabel(element, symbols.get(element), { ...options, derived: report.derivedSymbols }, nodeName)]));
  // The cells left of a branch its label takes, as `addElement` places it:
  // the box a cell clear of the symbol, since until a browser measures it a
  // math label's ink is its whole box.
  const reachOf = (width) => 40 * Math.ceil((80 + width / 2) / 40);
  const leftRoom = (element) => {
    const { w: width } = mathFootprint(labels.get(element).text);
    return reachOf(width) + width / 2;
  };

  // Columns read from input to output: each unit by its upper node's place
  // in that order (the input first), and a branch lying between two nodes
  // (a gate-drain capacitance) between their columns. Units of devices
  // drawn at one x share a column, and a unit hanging from the node a
  // column's stack ends at continues that stack (M1 over its source
  // resistor), where their rows allow.
  const sourceX = (unit) => {
    try { return unit.component ? options.circuit?.getComponent(unit.component).transform.x ?? null : null; }
    catch { return null; }
  };
  const rank = (unit) => (unit.flat ? (nodes.indexOf(unit.upper) + nodes.indexOf(unit.lower)) / 2 : nodes.indexOf(unit.upper));
  const ordered = [...units.values()].map((unit) => ({ unit, x: sourceX(unit), rank: rank(unit) }))
    .sort((left, right) => left.rank - right.rank || (left.x ?? Infinity) - (right.x ?? Infinity) || left.unit.order - right.unit.order);
  const columns = [];
  for (const { unit, x } of ordered) {
    const chained = (column) => column.units.some((other) => (other.lower === unit.upper && other.lo === unit.hi)
      || (other.upper === unit.lower && other.hi === unit.lo));
    const fits = (column) => !unit.flat && ((x !== null && column.x === x) || chained(column))
      && column.units.every((other) => !other.flat && (unit.hi <= other.lo || unit.lo >= other.hi));
    const column = columns.find(fits) || columns[columns.push({ x, units: [] }) - 1];
    column.units.push(unit);
  }
  const placed = new Map();
  let cursor = 0;
  for (const column of columns) {
    // Each unit's branches left to right, then the units of a stack shifted
    // so their first branches line up: one straight wire through the stack.
    const rows = column.units.map((unit) => {
      if (unit.flat) return [40 * Math.ceil((cursor + 80 + ELEMENT_GAP) / 40)];
      const xs = [];
      let at = cursor;
      for (const element of unit.elements) {
        xs.push(40 * Math.ceil((at + leftRoom(element)) / 40));
        at = xs[xs.length - 1] + 40 + ELEMENT_GAP;
      }
      return xs;
    });
    const anchor = Math.max(...rows.map((xs) => xs[0]));
    let right = cursor;
    column.units.forEach((unit, index) => {
      const shift = anchor - rows[index][0];
      unit.elements.forEach((element, at) => {
        const x = rows[index][at] + shift;
        placed.set(element, { x, y: unit.flat ? rowY(unit.hi) : snapTo((rowY(unit.hi) + rowY(unit.lo)) / 2) });
        right = Math.max(right, x + (unit.flat ? 80 : 40) + ELEMENT_GAP);
      });
    });
    cursor = right;
  }

  const circuit = new Circuit();
  const used = new Set();
  const correspondence = new Map();
  const notes = [];
  const legend = [];
  const attachments = new Map(nodes.map((node) => [node, []]));
  const groundRefs = [];
  const attach = (node, ref) => (node === AC_GROUND_NODE ? groundRefs : attachments.get(node)).push(ref);

  const addElement = (element, placement, upright = true) => {
    const type = symbols.get(element);
    const refdes = uniqueRefdes(element.parameter || element.id.replace(/\W/g, ''), used);
    const component = circuit.addComponent(type, { ...placement, refdes, noLabel: true });
    const label = labels.get(element);
    // A math label, set in the equations' own font. Laid out from the
    // model's estimate of its box, never a browser measurement, so the figure
    // lays out the same in a test, an export, and the dock. A Miller
    // admittance, a whole fraction, is named here and stated in the legend.
    //
    // An upright branch wears its label on the left, where a textbook puts it;
    // a branch lying along a row wears it above, clear of its own wires. The
    // offset comes from the label's own measured box, so the text sits
    // against its symbol.
    // Right-aligned when it stands to the left: the measured text ends at
    // the box's edge nearest the symbol, whatever the box rounds up to.
    const owned = circuit.addLabel({ owner: refdes, text: label.text, align: upright ? 'right' : 'center', math: true, mathBox: mathFootprint(label.text), offset: { x: 0, y: 0 } });
    const box = owned.bbox();
    const world = upright ? { x: -reachOf(box.w), y: 0 } : { x: 0, y: -reachOf(box.h) };
    owned.offset = localOffset(world.x, world.y, placement.rotation || 0);
    owned.clearMeasuredTextBounds();
    if (label.legend) legend.push(label.legend);
    correspondence.set(refdes, { primitive: element.id, component: element.metadata?.component || null, role: element.kind });
    return component;
  };

  // Every unit's branches upright between its two rows. A source symbol is
  // already vertical; a passive is turned upright. The current of a
  // controlled source flows from `a` into `b`, so a source whose lower end is
  // `a` is turned around rather than redrawn.
  for (const unit of units.values()) {
    if (unit.flat) {
      // Lying along its row: `a` toward the node drawn further left.
      const [element] = unit.elements;
      const at = placed.get(element);
      const xs = (node) => branches.filter((other) => other !== element && placed.has(other) && (other.a === node || other.b === node)).map((other) => placed.get(other).x);
      const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : at.x);
      const aLeft = mean(xs(element.a)) <= mean(xs(element.b));
      const rotation = SOURCE_KINDS.has(element.kind) ? (aLeft ? 270 : 90) : (aLeft ? 0 : 180);
      const component = addElement(element, { ...at, rotation }, false);
      attach(element.a, `${component.refdes}.a`);
      attach(element.b, `${component.refdes}.b`);
      continue;
    }
    for (const element of unit.elements) {
      const aUp = element.a === unit.upper;
      const rotation = SOURCE_KINDS.has(element.kind) ? (aUp ? 0 : 180) : (aUp ? 90 : 270);
      const component = addElement(element, { ...placed.get(element), rotation }, true);
      attach(unit.upper, `${component.refdes}.${aUp ? 'a' : 'b'}`);
      attach(unit.lower, `${component.refdes}.${aUp ? 'b' : 'a'}`);
    }
  }

  // The interface ports, on their node's row just outside everything drawn:
  // the input on the left, the output on the right. A node that only
  // controls a source -- a bare gate -- has no row; its port stands on the
  // top one.
  const portNodes = new Set();
  const stubs = new Map();
  const drawn = [...circuit.components.values()].map((component) => component.bboxWorld());
  const leftEdge = snapTo(Math.min(0, ...drawn.map((box) => box.x)) - PORT_GAP);
  const rightEdge = snapTo(Math.max(cursor, ...drawn.map((box) => box.x + box.w)) + PORT_GAP);
  const portFor = (node, type, side) => {
    if (!withPorts || !node || !attachments.has(node)) return;
    const x = side === 'left' ? leftEdge : rightEdge;
    const y = rowY(level.get(node) ?? top);
    const refdes = uniqueRefdes(plainName(node), used);
    const port = circuit.addComponent(type, { refdes, x, y, noLabel: true });
    // Above the port, not beside it: an outward-facing port box already
    // occupies the side its own label offset points at.
    circuit.addLabel({ owner: refdes, text: nodeName(node), align: 'center', offset: { x: 0, y: -120 } });
    attachments.get(node).push(`${port.refdes}.p`);
    stubs.set(node, { x: x + (side === 'left' ? PORT_GAP : -PORT_GAP), y });
    portNodes.add(node);
  };
  portFor(portNode(report, 'input'), 'input', 'left');
  portFor(portNode(report, 'output'), 'output', 'right');

  // The AC ground a cell under the first branch that reaches it: the rail is
  // no longer than the branches it joins.
  const grounded = [...placed.entries()].filter(([element]) => element.a === AC_GROUND_NODE || element.b === AC_GROUND_NODE)
    .map(([, at]) => at.x).sort((left, right) => left - right)[0];
  if (grounded !== undefined) {
    const ground = circuit.addComponent('ground', { refdes: uniqueRefdes('GND', used), x: grounded, y: rowY(0) + GROUND_DROP, noLabel: true });
    groundRefs.push(`${ground.refdes}.gnd`);
  }

  const failures = [];
  const wire = (refs, name, stub = null) => {
    try {
      // A node that only controls a source -- a bare gate -- has no branch of
      // its own. Draw its port down to the node line anyway: the controlling
      // voltage needs somewhere to be read.
      if (refs.length === 1 && stub) return circuit.wireTo(refs[0], stub) || null;
      if (refs.length < 2) return null;
      const net = circuit.connect(...refs);
      if (name && net) circuit.renameNet(net, name);
      return net;
    } catch (error) { failures.push(`${name || 'net'}: ${error.message}`); }
    return null;
  };
  // A pin no other branch shares -- the input end of a resistor when no port
  // is drawn -- gets a short lead of its own to carry the node's name.
  const lead = (ref) => {
    const [refdes, term] = ref.split('.');
    const component = circuit.components.get(refdes);
    const pin = component.terminalWorld(term);
    const { x, y } = component.transform;
    const dx = Math.sign(pin.x - x);
    const dy = dx ? 0 : Math.sign(pin.y - y);
    return { x: pin.x + dx * 2 * 40, y: pin.y + dy * 2 * 40 };
  };
  const wired = new Map();
  for (const node of nodes) {
    const refs = attachments.get(node);
    const stub = stubs.get(node) || (refs.length === 1 ? lead(refs[0]) : null);
    const net = wire(refs, nodeName(node) || node, stub);
    if (net && refs.length === 1 && !portNodes.has(node) && nodeName(node)) {
      try { circuit.renameNet(net, nodeName(node)); }
      catch (error) { failures.push(`${nodeName(node)}: ${error.message}`); }
    }
    wired.set(node, net);
  }
  wire(groundRefs, 'VSS');

  // Name the nodes on the drawing. A node with a port already reads its name
  // off that port, and the AC-ground rail is what the ground symbol says.
  // Clear of every symbol *and* every label already placed: a node name that
  // lands on a branch's own label is as unreadable as one over a symbol.
  const boxes = [
    ...[...circuit.components.values()].map((component) => component.bboxWorld()),
    ...[...circuit.labels.values()].map((label) => label.bbox()),
  ];
  for (const node of nodes) {
    const net = wired.get(node);
    if (!net?.name || portNodes.has(node)) continue;
    // Its own wire it sits on; every other wire it keeps clear of.
    const others = wireBoxes(circuit, net);
    placeNetName(circuit, net, [...boxes, ...others]);
    const placed = [...circuit.labels.values()].find((label) => label.netId === net.id);
    if (placed) boxes.push(placed.bbox());
  }

  if (failures.length) notes.push(`${failures.length} connection${failures.length === 1 ? '' : 's'} could not be routed automatically`);

  const miller = (report?.details?.pipeline?.millerSubstitutions || []).map(({ device }) => device).filter(Boolean);
  if (miller.length) notes.push(`Miller approximation applied to ${miller.join(', ')}`);
  const omitted = report?.details?.pipeline?.omittedOutputResistances || [];
  if (omitted.length) notes.push(`r_o omitted for ${omitted.join(', ')}`);

  return { ok: true, circuit, correspondence, notes, legend, failures };
}

/**
 * Place a drawn model (`smallSignalSchematic(report, { ports: false })`) into
 * `circuit`, a band below its drawing and aligned with its left edge, as
 * drawing-only parts: drawn and checked like the rest, read by no analysis.
 * A part whose name the design already uses takes the next free one; the
 * nets keep the node names, the virtual connection that ties each to the
 * schematic node it models. Returns the added refdes and label ids.
 */
export function placeSmallSignalModel(circuit, model) {
  const source = model.circuit;
  const ink = circuit.components.size || circuit.labels.size ? circuit.bounds() : { x: 0, y: 0, w: 0, h: 0 };
  const own = source.bounds();
  const dx = snapTo(ink.x - own.x);
  const dy = ink.h ? 40 * Math.ceil((ink.y + ink.h + 80 - own.y) / 40) : snapTo(-own.y);
  const at = (point) => ({ x: point.x + dx, y: point.y + dy });

  const used = new Set([...circuit.components.keys(), ...circuit.labels.keys()]);
  const refs = new Map();
  const added = { components: [], labels: [] };
  const wasLoading = circuit._loading;
  circuit._loading = true;
  try {
    for (const component of source.components.values()) {
      // Junction dots are derived from the wires once they are in.
      if (component.type === 'solder') continue;
      const refdes = uniqueRefdes(component.refdes, used);
      refs.set(component.refdes, refdes);
      circuit.addComponent(component.type, {
        refdes,
        ...at(component.transform),
        rotation: component.transform.rotation,
        mirrorX: component.transform.mirrorX,
        mirrorY: component.transform.mirrorY,
        value: component.value,
        drawingOnly: true,
        noLabel: true,
      });
      added.components.push(refdes);
    }
    const nets = new Map();
    for (const net of source.nets.values()) {
      const copy = circuit.createWireNet({
        name: net.name,
        route: net.route?.map(at) || null,
        branches: net.branches?.map((path) => path.map(at)) || null,
        junctions: net.junctions.map(at),
      });
      for (const terminal of net.terminals) {
        if (refs.has(terminal.comp)) copy.terminals.push({ comp: refs.get(terminal.comp), term: terminal.term });
      }
      nets.set(net.id, copy);
    }
    for (const label of source.labels.values()) {
      let copy;
      if (label.owner) {
        if (!refs.has(label.owner)) continue;
        copy = circuit.addLabel({ owner: refs.get(label.owner), text: label.text, align: label.align, math: label.math, mathBox: label.toJSON().mathBox, offset: { ...label.offset } });
      } else if (label.netId) {
        const net = nets.get(label.netId);
        if (!net?.name) continue;
        copy = circuit.addNetLabel(net.id, { anchor: at(label.anchor), align: label.align, netSide: label.netSide });
      } else {
        copy = circuit.addLabel({ text: label.text, align: label.align, math: label.math, ...at(label.anchor) });
      }
      added.labels.push(copy.id);
    }
  } finally {
    circuit._loading = wasLoading;
  }
  circuit.syncJunctionSolders();
  return added;
}
