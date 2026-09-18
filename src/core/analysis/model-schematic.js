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

export const AC_GROUND_NODE = '@AC_GROUND';

const AC_GROUND_NAMES = new Set([AC_GROUND_NODE, '0', 'AC_GROUND']);
const SOURCE_KINDS = new Set(['vccs', 'current-source', 'voltage-source']);
const MIN_PITCH = 240;
const SLOT_PADDING = 240;
const BUS_Y = 0;
const SHUNT_Y = 240;
const RAIL_Y = 480;
const ROW_H = 240;
const PORT_GAP = 240;

/** Elements whose branch is drawn with each symbol. */
const ELEMENT_TYPES = new Map([
  ['resistor', 'resistor'],
  ['conductance', 'resistor'],
  ['triode-resistance', 'resistor'],
  ['capacitor', 'capacitor'],
  ['inductor', 'inductor'],
  ['vccs', 'vccs'],
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
export function textbookSymbol(raw) {
  const name = String(raw || '');
  if (!name) return '';
  if (/^gmb[A-Za-z0-9_]*$/.test(name)) return `g_{mb${name.slice(3)}}`;
  if (/^gm[A-Za-z0-9_]*$/.test(name)) return `g_{m${name.slice(2)}}`;
  if (/^go[A-Za-z0-9_]*$/.test(name)) return `g_{o${name.slice(2)}}`;
  if (/^rds[A-Za-z0-9_]*$/.test(name)) return `r_{ds${name.slice(3)}}`;
  if (/^ro[A-Za-z0-9_]*$/.test(name)) return `r_{o${name.slice(2)}}`;
  if (/^[RCL][A-Za-z0-9_]+$/.test(name)) return `${name[0]}_{${name.slice(1)}}`;
  return name;
}

/**
 * A controlled source is labelled with its own transconductance times the
 * controlling voltage, the way a hybrid-pi figure is drawn: the control pair
 * is text, never a second pair of wires across the drawing. The pair names the
 * drawing's own nodes -- `g_{m1}(V_{IN} - 0)`, not `g_{m1} v_{gs1}` -- so the
 * reader can follow the control back to a node without decoding a subscript.
 */
function controlledSourceLabel(element, nodeName) {
  const gain = textbookSymbol(element.parameter) || 'g_m';
  if (!element.control) return gain;
  const plus = nodeName(element.control.a) || '0';
  const minus = nodeName(element.control.b) || '0';
  return `${gain}(${plus} - ${minus})`;
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
  if (element.kind === 'vccs') return { text: controlledSourceLabel(element, nodeName) };
  if (element.parameter) return { text: textbookSymbol(element.parameter) };
  let rendered = '';
  try { rendered = renderExpression(element.value, options.renderOptions || {}); }
  catch { rendered = ''; }
  if (element.kind === 'admittance') {
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

/**
 * A label's rendered width is only known in a browser, and the drawing has to
 * be laid out before that. Estimate it from the text the way `textWidth` does
 * -- the tight per-glyph model at the label font size -- so columns are spaced
 * for their own contents instead of a fixed guess.
 */
function estimateLabelWidth(tex) {
  const plain = String(tex)
    .replace(/\\left|\\right|\\,|\\;|\\!/g, '')
    .replace(/\\frac/g, '')
    .replace(/[{}$]/g, '');
  return Math.max(120, plain.length * 24);
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
  const centre = new Map();
  if (circuit) {
    for (const node of seen) {
      const net = circuit.nets.get(node);
      const points = (net?.terminals || []).map((terminal) => {
        try { return circuit.getComponent(terminal.comp).terminalWorld(terminal.term).x; }
        catch { return null; }
      }).filter((value) => value !== null);
      if (points.length) centre.set(node, points.reduce((sum, value) => sum + value, 0) / points.length);
    }
  }
  const inputNode = portNode(report, 'input');
  const outputNode = portNode(report, 'output');
  const rank = (node) => node === inputNode ? -Infinity : node === outputNode ? Infinity : 0;
  return [...seen].sort((left, right) => {
    const ranked = rank(left) - rank(right);
    if (Number.isFinite(ranked) && ranked !== 0) return ranked;
    if (!Number.isFinite(ranked)) return ranked < 0 ? -1 : 1;
    const a = centre.get(left);
    const b = centre.get(right);
    if (a !== undefined && b !== undefined && a !== b) return a - b;
    return seen.indexOf(left) - seen.indexOf(right);
  });
}

/** The analysis node a port role resolved to, as the context recorded it. */
function portNode(report, role) {
  const context = report?.context || report?.details?.pipeline?.context;
  return context?.[role]?.node || null;
}

/**
 * Where to hang a node's name: the middle of its longest run, preferring a
 * horizontal one, and only where a label-sized box above the wire clears every
 * symbol. A node whose wires are all crowded keeps its name in the net list
 * rather than printing it over a component.
 */
function netLabelAnchor(net, width, boxes) {
  const segments = [];
  for (const path of (net.paths ? net.paths() : [])) {
    for (let index = 1; index < path.length; index += 1) segments.push([path[index - 1], path[index]]);
  }
  const span = ([a, b]) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const horizontal = segments.filter(([a, b]) => a.y === b.y);
  const ordered = (horizontal.length ? horizontal : segments).sort((left, right) => span(right) - span(left));
  for (const [a, b] of ordered) {
    const point = { x: snapTo((a.x + b.x) / 2), y: snapTo((a.y + b.y) / 2) };
    const box = { x: point.x - width / 2, y: point.y - 120, w: width, h: 120 };
    if (!boxes.some((other) => rectsOverlap(box, other))) return point;
  }
  return null;
}

function snapTo(value) {
  return Math.round(value / 40) * 40;
}

/**
 * Build the drawn model.
 *
 * @param {object} report a successful `analyzeSmallSignalV2` report
 * @param {{circuit?: import('../model.js').Circuit, nodeNames?: Map}} options
 * @returns {{ok: boolean, circuit?: Circuit, correspondence?: Map, notes: string[], error?: string}}
 */
export function smallSignalSchematic(report, options = {}) {
  const primitives = report?.details?.pipeline?.selected;
  if (!Array.isArray(primitives) || !primitives.length) {
    return { ok: false, notes: [], error: 'this analysis produced no small-signal primitives to draw' };
  }
  const elements = primitives.map(normalize).filter(Boolean);
  const names = nodeNames(report, options);
  // The node's own name, markup included: label text renders `_{...}`.
  const nodeName = (node) => (!node || node === AC_GROUND_NODE ? '' : String(names.get(node) || node));
  const plainName = (node) => nodeName(node).replace(/[_^]\{([^}]*)\}/g, '$1');
  const nodes = orderNodes(elements, report, options);
  const shunts = new Map(nodes.map((node) => [node, []]));
  const series = [];
  for (const element of elements) {
    const aGround = element.a === AC_GROUND_NODE;
    const bGround = element.b === AC_GROUND_NODE;
    if (aGround && bGround) continue;
    // A controlled source across one node carries no current -- the body
    // effect of a device whose source is the AC reference. Drawing it says
    // nothing and costs a column.
    if (element.control && element.control.a === element.control.b) continue;
    if (aGround || bGround) shunts.get(bGround ? element.a : element.b).push(element);
    else series.push(element);
  }

  // Every element is drawn with its label above it, so a node's slot is as
  // wide as its own branches need -- a Miller shunt beside a bare r_o should
  // not push every other column apart.
  const symbols = new Map(elements.map((element) => [element, elementSymbol(element)]));
  const labels = new Map(elements.map((element) => [element, elementLabel(element, symbols.get(element), options, nodeName)]));
  // A shunt wears its label on its left, so its neighbour must clear it.
  const widthOf = (element) => Math.max(MIN_PITCH, snapTo(estimateLabelWidth(labels.get(element).text) + 160));
  const pitches = new Map(nodes.map((node) => [node, Math.max(MIN_PITCH, ...shunts.get(node).map(widthOf))]));

  const columns = new Map();
  let x = 0;
  for (const node of nodes) {
    const count = Math.max(1, shunts.get(node).length);
    const width = count * pitches.get(node) + 2 * SLOT_PADDING;
    columns.set(node, snapTo(x + width / 2));
    x += width;
  }

  const circuit = new Circuit();
  const used = new Set();
  const correspondence = new Map();
  const notes = [];
  const legend = [];
  const attachments = new Map(nodes.map((node) => [node, []]));
  const groundRefs = [];

  const addElement = (element, placement, upright = true) => {
    const type = symbols.get(element);
    const refdes = uniqueRefdes(element.parameter || element.id.replace(/\W/g, ''), used);
    const component = circuit.addComponent(type, { ...placement, refdes, noLabel: true });
    const label = labels.get(element);
    // Plain `_{...}` markup, not a math label: every symbol in the drawing is
    // a name with a subscript, and a markup label needs no browser
    // measurement, so the figure lays out the same in a test, an export, and
    // the dock. The one thing that needs real math -- a Miller admittance --
    // is named here and stated in the legend instead.
    //
    // An upright branch wears its label on the left, where a textbook puts it;
    // a branch lying along a row wears it above, clear of its own wires.
    const width = estimateLabelWidth(label.text);
    const world = upright ? { x: -(80 + width / 2), y: 0 } : { x: 0, y: -160 };
    circuit.addLabel({
      owner: refdes,
      text: label.text,
      align: 'center',
      offset: localOffset(world.x, world.y, placement.rotation || 0),
    });
    if (label.legend) legend.push(label.legend);
    correspondence.set(refdes, { primitive: element.id, component: element.metadata?.component || null, role: element.kind });
    return component;
  };

  // Shunt branches: node bus -> element -> ground rail.
  for (const node of nodes) {
    const list = shunts.get(node);
    const centreX = columns.get(node);
    const pitch = pitches.get(node);
    list.forEach((element, index) => {
      const shuntX = snapTo(centreX + (index - (list.length - 1) / 2) * pitch);
      const vertical = SOURCE_KINDS.has(element.kind);
      // A source symbol is already vertical; a passive is turned upright. The
      // current of a controlled source flows from `a` into `b`, so a source
      // whose ground end is `a` is turned around rather than redrawn.
      const flipped = element.a === AC_GROUND_NODE;
      const rotation = vertical ? (flipped ? 180 : 0) : (flipped ? 270 : 90);
      const component = addElement(element, { x: shuntX, y: SHUNT_Y, rotation }, true);
      const [top, bottom] = flipped ? ['b', 'a'] : ['a', 'b'];
      attachments.get(node).push(`${component.refdes}.${top}`);
      groundRefs.push(`${component.refdes}.${bottom}`);
    });
  }

  // Series branches stack in rows above the node line, lowest row first.
  const rows = [];
  for (const element of series) {
    const left = Math.min(columns.get(element.a), columns.get(element.b));
    const right = Math.max(columns.get(element.a), columns.get(element.b));
    let row = rows.findIndex((spans) => spans.every(([from, to]) => right <= from || left >= to));
    if (row < 0) row = rows.push([]) - 1;
    rows[row].push([left, right]);
    const y = BUS_Y - (row + 1) * ROW_H;
    const rotation = SOURCE_KINDS.has(element.kind) ? 270 : 0;
    const component = addElement(element, { x: snapTo((left + right) / 2), y, rotation }, false);
    const aLeft = columns.get(element.a) <= columns.get(element.b);
    attachments.get(element.a).push(`${component.refdes}.${aLeft ? 'a' : 'b'}`);
    attachments.get(element.b).push(`${component.refdes}.${aLeft ? 'b' : 'a'}`);
  }

  // The interface ports read left to right on the node line itself, outside
  // every column: the input node sorts first and the output node last, so
  // neither stub crosses another node's bus.
  const portNodes = new Set();
  // Outside everything drawn, and outside every column: a node that only
  // controls a source has a column but nothing standing in it.
  const drawn = [...circuit.components.values()].map((component) => component.bboxWorld());
  const spans = [...columns.values()];
  const leftEdge = snapTo(Math.min(...drawn.map((box) => box.x), ...spans) - PORT_GAP);
  const rightEdge = snapTo(Math.max(...drawn.map((box) => box.x + box.w), ...spans) + PORT_GAP);
  const portFor = (node, type, side) => {
    if (!node || !columns.has(node)) return;
    const refdes = uniqueRefdes(plainName(node), used);
    const port = circuit.addComponent(type, {
      refdes, x: side === 'left' ? leftEdge : rightEdge, y: BUS_Y, noLabel: true,
    });
    // Above the port, not beside it: an outward-facing port box already
    // occupies the side its own label offset points at.
    circuit.addLabel({ owner: refdes, text: nodeName(node), align: 'center', offset: { x: 0, y: -120 } });
    attachments.get(node).push(`${port.refdes}.p`);
    portNodes.add(node);
  };
  portFor(portNode(report, 'input'), 'input', 'left');
  portFor(portNode(report, 'output'), 'output', 'right');

  // One AC-ground rail under the whole drawing.
  const railX = snapTo(Math.min(...columns.values()) - SLOT_PADDING);
  const ground = circuit.addComponent('ground', { refdes: 'GND', x: railX, y: RAIL_Y, noLabel: true });
  groundRefs.push(`${ground.refdes}.gnd`);

  const failures = [];
  const wire = (refs, name, stub = null) => {
    try {
      // A node that only controls a source -- a bare gate -- has no branch of
      // its own. Draw its port down to the node line anyway: the controlling
      // voltage needs somewhere to be read.
      if (refs.length === 1 && stub) {
        circuit.wireTo(refs[0], stub);
        return null;
      }
      if (refs.length < 2) return null;
      const net = circuit.connect(...refs);
      if (name && net) circuit.renameNet(net, name);
      return net;
    } catch (error) { failures.push(`${name || 'net'}: ${error.message}`); }
    return null;
  };
  const wired = new Map();
  for (const node of nodes) {
    wired.set(node, wire(attachments.get(node), nodeName(node) || node, { x: columns.get(node), y: BUS_Y }));
  }
  wire(groundRefs, 'VSS');

  // Name the nodes on the drawing. A node with a port already reads its name
  // off that port, and the AC-ground rail is what the ground symbol says.
  const boxes = [...circuit.components.values()].map((component) => component.bboxWorld());
  for (const node of nodes) {
    const net = wired.get(node);
    if (!net || portNodes.has(node) || !net.name) continue;
    const anchor = netLabelAnchor(net, estimateLabelWidth(net.name), boxes);
    if (!anchor) continue;
    try { circuit.addNetLabel(net, { anchor, netSide: 'above' }); }
    catch { /* a node whose wire the router shaped differently keeps its name in the net list */ }
  }
  if (failures.length) notes.push(`${failures.length} connection${failures.length === 1 ? '' : 's'} could not be routed automatically`);

  const miller = (report?.details?.pipeline?.millerSubstitutions || []).map(({ device }) => device).filter(Boolean);
  if (miller.length) notes.push(`Miller approximation applied to ${miller.join(', ')}`);
  const omitted = report?.details?.pipeline?.omittedOutputResistances || [];
  if (omitted.length) notes.push(`r_o omitted for ${omitted.join(', ')}`);

  return { ok: true, circuit, correspondence, notes, legend, failures };
}
