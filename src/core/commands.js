import { Circuit, canonicalNetName, transformComponentWorld } from './model.js';
import { getSymbol, symbolTypeNames } from './components/index.js';
import { GRID, onGrid, snap, ceilGrid } from './grid.js';
import { rectsOverlap, applyDir, applyTransform } from './geometry.js';
import { balancedCrossCoupling, gateBodyCrossingAllowed, segThroughInterior, smartRoute } from './router.js';
import { crossNetOverlaps } from './wiring.js';
import { renderAscii } from './ascii.js';
import { svgString } from './render.js';
import { BlockDiagram } from './block-model.js';
import { renderDocument, saveDocument } from './document.js';
import { analyzeInputImpedance, analyzeOutputImpedance, analyzeTransferFunction } from './analysis/index.js';

/** Materialize a net's route with the pin-escaped outside bends: two-terminal
  *  nets route via smartRoute; larger nets get the balanced T-junction; nets
 *  with mid-wire junctions are walked through every anchor in order.
 *  Delegates to the model's fresh-layout path so 3+ terminal nets get the
 *  multi-branch T-junction geometry (balancedPaths), not a single polyline. */
function routeNet(circuit, net) {
  if (circuit.rerouteNet(net, 'refresh') === false) throw new Error('unable to route wire safely');
}

/** Re-route every net that touches any of the given component refdes.
 *  `moved` (optional) is a Map of refdes -> {dx,dy} so hand-drawn wire shapes
 *  are preserved (slid / re-anchored) instead of recomputed. */
function rerouteNetsFor(circuit, refs, moved, fresh = false) {
  const touched = new Set();
  for (const r of refs) {
    const c = circuit.components.get(r);
    if (!c) continue;
    for (const t of c.terminalDefs) {
      const net = circuit.netOfTerminal({ comp: c.refdes, term: t.name });
      if (net) touched.add(net.id);
    }
  }
  for (const id of touched) {
    const net = circuit.nets.get(id);
    if (net && circuit.rerouteNet(net, fresh ? 'refresh' : moved) === false) {
      throw new Error('unable to route wire safely');
    }
  }
}

/** Outward direction from a component body toward a world terminal pin.
 *  Honors the terminal's explicit local direction (via the transform) first,
 *  matching the editor's pinDir, then falls back to the bbox-centre heuristic. */
function pinDir(c, wx, wy) {
  const t = c.terminalDefs.find((term) => {
    const p = applyTransform(c.transform, term.x, term.y);
    return p.x === wx && p.y === wy;
  });
  if (t && t.dir) {
    const d = applyDir(c.transform, t.dir.x, t.dir.y);
    if (d.x !== 0 || d.y !== 0) return d;
  }
  const r = c.bboxWorld();
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const ndx = r.w === 0 ? 0 : (wx - cx) / (r.w / 2);
  const ndy = r.h === 0 ? 0 : (wy - cy) / (r.h / 2);
  if (Math.abs(ndx) >= Math.abs(ndy)) return { x: Math.sign(ndx), y: 0 };
  return { x: 0, y: Math.sign(ndy) };
}

const FLAG_ARITY = {
  at: 2,
  rot: 1,
  value: 1,
  name: 1,
  reference: 1,
  model: 1,
  'ac-ground': 1,
  mode: 1,
  'differential-side': 1,
  'ignore-channel-length-modulation': 0,
  'ignore-body-effect': 0,
  'gmro-large': 0,
  miller: 0,
  context: 1,
  input: 1,
  net: 1,
  file: 1,
  mirrorX: 0,
  mirrorY: 0,
  json: 0,
  explain: 0,
  grid: 0,
};

/** Split a command line into array honoring double-quoted strings. */
export function splitArgs(line) {
  const m = String(line).match(/"[^"]*"|\S+/g);
  return m ? m.map((s) => (s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s)) : [];
}

/** Parse args into {pos, flags} given known flag arities. */
export function parseArgs(args) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const arity = FLAG_ARITY[key];
      if (arity === undefined) throw new Error(`unknown flag --${key}`);
      flags[key] = arity === 0 ? true : [];
      for (let k = 0; k < arity; k++) {
        if (i + 1 >= args.length) throw new Error(`--${key} expects ${arity} value(s)`);
        flags[key].push(args[++i]);
      }
    } else {
      pos.push(a);
    }
  }
  return { pos, flags };
}

function fmt(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
function pp(x, y) {
  return `(${fmt(x)},${fmt(y)})`;
}

function termInfo(circuit, comp, term) {
  const c = circuit.components.get(comp);
  if (!c) return `${comp}.${term}??`;
  const p = c.terminalWorld(term);
  return `${comp}.${term}${pp(p.x, p.y)}`;
}

const ISSUE_HINTS = {
  'unconnected-terminal': 'Connect this terminal with Wire/connect, or deliberately remove the unused component.',
  'component-overlap': 'Move one component at least one grid cell clear of the other component body.',
  'label-component-overlap': 'Move the label into open space; keep its anchor attached if it is an electrical net label.',
  'label-overlap': 'Separate the labels or adjust their alignment so their boxes do not overlap.',
  'wire-through-body': 'Reroute the net around the component body; only a shared MOS gate bus may use the documented exception.',
  'managed-diagonal': 'Redraw this net with F3 set to orthogonal; reserve diagonal geometry for deliberate fixed routes.',
  'grid-violation': 'Move or edit the object onto the 40-unit grid.',
  'cross-net-overlap': 'Choose one physical net and move the other collinear span; crossings may cross transversely but must not overlap.',
  'malformed-net-label': 'Retarget the label to a drawable point on a named physical net, or convert it to a free annotation.',
};

function routeExplanation(circuit, refs) {
  if (refs.length !== 2) throw new Error('usage: explain connect REF.TERM REF.TERM');
  const endpoints = refs.map((ref) => circuit.resolveTerm(ref));
  const points = endpoints.map(({ comp, term }) => circuit.getComponent(comp).terminalWorld(term));
  const existing = circuit.netOfTerminal(endpoints[0]);
  const env = circuit._netEnv(existing?.id || null);
  const path = smartRoute(points[0], points[1], env);
  const segments = path ? path.slice(1).map((point, i) => ({ from: path[i], to: point })) : [];
  const length = segments.reduce((sum, segment) => sum + Math.abs(segment.to.x - segment.from.x) + Math.abs(segment.to.y - segment.from.y), 0);
  const turns = path ? Math.max(0, path.length - 2) : null;
  const first = segments[0];
  const last = segments.at(-1);
  const pinEscape = {
    source: first ? { x: Math.sign(first.to.x - first.from.x), y: Math.sign(first.to.y - first.from.y) } : null,
    target: last ? { x: Math.sign(last.from.x - last.to.x), y: Math.sign(last.from.y - last.to.y) } : null,
  };
  const result = {
    source: refs[0],
    target: refs[1],
    points,
    path,
    length,
    turns,
    pinEscape,
    existingNetId: existing?.id || null,
    routeable: !!path,
    reason: path
      ? `Found a ${length}-unit route with ${turns} bend${turns === 1 ? '' : 's'}; the first and last legs leave the pins before entering open routing space.`
      : 'No safe route was found. The router rejected candidates that cross component bodies, violate pin direction, or overlap another net.',
  };
  return result;
}

function diagnosticExplanation(report) {
  const byKind = new Map();
  for (const issue of report.issues || []) {
    if (!byKind.has(issue.kind)) byKind.set(issue.kind, []);
    byKind.get(issue.kind).push(issue);
  }
  const groups = [...byKind].map(([kind, issues]) => ({
    kind,
    count: issues.length,
    hint: ISSUE_HINTS[kind] || 'Inspect the referenced objects and make the smallest safe edit.',
    issues: issues.map(({ kind: ignored, severity: ignoredSeverity, ...issue }) => issue),
  }));
  return {
    ok: report.ok,
    summary: report.ok ? 'No design-check issues were found.' : `${report.issues.length} design-check issue${report.issues.length === 1 ? '' : 's'} need attention.`,
    groups,
  };
}

/** Evaluation report used to judge whether the diagram "looks good". */
export function evaluate(circuit) {
  const comps = [...circuit.components.values()];
  const annotated = (c) => c.type === 'solder'; // pure annotation: no electrical body
  const terminals = [];
  const dangling = [];
  const issues = [];
  const terminalRefsByPoint = new Map();
  const addIssue = (kind, message, details = {}) => {
    issues.push({ kind, severity: 'error', message, hint: ISSUE_HINTS[kind] || 'Inspect the referenced objects and make the smallest safe edit.', ...details });
  };
  const pointCopy = (p) => ({ x: p.x, y: p.y });
  const refsAt = (p) => terminalRefsByPoint.get(`${p.x},${p.y}`) || [];

  let violations = [];
  for (const c of comps) {
    for (const t of c.terminalDefs) {
      const w = c.terminalWorld(t.name);
      const net = circuit.netOfTerminal({ comp: c.refdes, term: t.name });
      const ref = `${c.refdes}.${t.name}`;
      const point = pointCopy(w);
      const pointKey = `${w.x},${w.y}`;
      if (!terminalRefsByPoint.has(pointKey)) terminalRefsByPoint.set(pointKey, []);
      terminalRefsByPoint.get(pointKey).push(ref);
      if (!onGrid(w.x) || !onGrid(w.y)) {
        const message = `${ref}@(${w.x},${w.y}) off-grid`;
        violations.push(message);
        addIssue('grid-violation', message, { refs: [ref], points: [point], location: 'terminal' });
      }
      terminals.push({ ref: `${c.refdes}.${t.name}`, x: w.x, y: w.y, net: net ? net.id : null });
      // Schematic blocks are visual interface shells. Their perimeter pins are
      // available for optional wiring, but an unused pin is not a design-check
      // failure; the block body is still included in overlap/body geometry.
      if (!net && c.type !== 'block') {
        const message = `${ref}@(${w.x},${w.y})`;
        dangling.push(message);
        addIssue('unconnected-terminal', `unconnected terminal ${message}`, {
          refs: [ref],
          points: [point],
        });
      }
    }
  }
  for (const c of comps) {
    if (!onGrid(c.transform.x) || !onGrid(c.transform.y)) {
      const point = { x: c.transform.x, y: c.transform.y };
      const message = `${c.refdes} origin off-grid`;
      violations.push(message);
      addIssue('grid-violation', message, { refs: [c.refdes], points: [point], location: 'origin' });
    }
  }
  const overlaps = [];
  for (let i = 0; i < comps.length; i++) {
    for (let j = i + 1; j < comps.length; j++) {
      if (annotated(comps[i]) || annotated(comps[j])) continue;
      const a = comps[i].bboxWorld();
      const b = comps[j].bboxWorld();
      if (rectsOverlap(a, b)) {
        const refs = [comps[i].refdes, comps[j].refdes];
        const message = refs.join('/');
        overlaps.push(message);
        addIssue('component-overlap', `overlapping bboxes ${message}`, {
          refs,
          points: [
            { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) },
            { x: Math.min(a.x + a.w, b.x + b.w), y: Math.min(a.y + a.h, b.y + b.h) },
          ],
        });
      }
    }
  }
  const labels = [...circuit.labels.values()].filter((label) => !['arrow', 'box', 'line'].includes(label.kind));
  const labelComponentOverlaps = [];
  const labelOverlaps = [];
  const netLabelIssues = [];
  for (const label of labels) {
    if (!label.netId) continue;
    const net = circuit.nets.get(label.netId);
    const malformed = (message) => {
      const issue = { labelId: label.id, netId: label.netId, message };
      netLabelIssues.push(issue);
      addIssue('malformed-net-label', message, {
        refs: [label.id],
        labelId: label.id,
        netId: label.netId,
      });
    };
    if (!net) { malformed(`net label ${label.id} targets missing net ${label.netId}`); continue; }
    if (label.owner) malformed(`net label ${label.id} also has owner ${label.owner}`);
    if (!canonicalNetName(net.name)) malformed(`net label ${label.id} targets unnamed net ${net.id}`);
    else if (!circuit._netLabelAnchorOnPath(net, label.anchorWorld())) {
      malformed(`net label ${label.id} anchor is not on drawable net ${net.id}`);
    }
  }
  const overlapPoints = (a, b) => [
    { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) },
    { x: Math.min(a.x + a.w, b.x + b.w), y: Math.min(a.y + a.h, b.y + b.h) },
  ];
  for (const label of labels) {
    const labelBox = label.bbox();
    for (const comp of comps) {
      if (annotated(comp)) continue;
      const compBox = comp.bboxWorld();
      if (!rectsOverlap(labelBox, compBox)) continue;
      const message = `label ${label.id} overlaps ${comp.refdes}(${comp.type}) bbox`;
      labelComponentOverlaps.push(message);
      addIssue('label-component-overlap', message, {
        refs: [label.id, comp.refdes],
        points: overlapPoints(labelBox, compBox),
        labelId: label.id,
        componentRef: comp.refdes,
      });
    }
  }
  for (let i = 0; i < labels.length; i++) {
    const a = labels[i];
    const aBox = a.bbox();
    for (let j = i + 1; j < labels.length; j++) {
      const b = labels[j];
      const bBox = b.bbox();
      if (!rectsOverlap(aBox, bBox)) continue;
      const refs = [a.id, b.id];
      const message = `labels ${refs.join('/')} overlap`;
      labelOverlaps.push(message);
      addIssue('label-overlap', message, {
        refs,
        points: overlapPoints(aBox, bBox),
        labelIds: refs,
      });
    }
  }
  // `Net.paths()` normalizes managed geometry for rendering.  Evaluation must
  // also inspect explicitly stored paths as-is, otherwise malformed persisted
  // managed geometry (notably a diagonal route) would be silently repaired and
  // reported as clean.
  const evaluationPaths = (net) => {
    if (net.routingMode === 'managed' && net.branches?.length) return net.branches;
    if (net.routingMode === 'managed' && net.route?.length >= 2) return [net.route];
    return net.paths();
  };
  const nets = [];
  for (const net of circuit.nets.values()) {
    nets.push({ id: net.id, name: net.name, n: net.terminals.length, length: net.length() });
  }
  const gatePassagesForNet = (net) => {
    const passages = [];
    for (const comp of comps) {
      const gate = comp.terminalDefs.find((t) => t.direction === 'gate');
      if (!gate) continue;
      const gateNet = circuit.netOfTerminal({ comp: comp.refdes, term: gate.name });
      if (gateNet?.id !== net.id) continue;
      const point = comp.terminalWorld(gate.name);
      passages.push({ rect: comp.bboxWorld(), point, dir: pinDir(comp, point.x, point.y) });
    }
    return passages.length >= 2 ? passages : [];
  };
  // Wires running through the strict interior of a component's bounding box.
  // A shared MOS gate bus is the intentional exception: it may enter the body
  // on a gate axis when at least two MOS gates belong to that same physical net.
  const boxViolations = [];
  const diagonalViolations = [];
  for (const net of circuit.nets.values()) {
    const gateEnv = { gatePassages: gatePassagesForNet(net) };
    for (const pts of evaluationPaths(net)) {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        if (a.x !== b.x && a.y !== b.y && net.routingMode === 'managed' && !net.allowDiagonal) {
          const message = `net ${net.id} diagonal (${a.x},${a.y})-(${b.x},${b.y})`;
          const refs = [...new Set([...refsAt(a), ...refsAt(b)])];
          diagonalViolations.push(message);
          addIssue('managed-diagonal', message, {
            refs,
            points: [pointCopy(a), pointCopy(b)],
            netId: net.id,
          });
        }
        for (const comp of comps) {
          if (annotated(comp)) continue;
          const compBox = comp.bboxWorld();
          if (segThroughInterior(a, b, compBox) &&
              !gateBodyCrossingAllowed(a, b, compBox, gateEnv)) {
            const message = `net ${net.id} seg (${a.x},${a.y})-(${b.x},${b.y}) through ${comp.refdes}(${comp.type}) bbox`;
            boxViolations.push(message);
            addIssue('wire-through-body', message, {
              refs: [...new Set([comp.refdes, ...refsAt(a), ...refsAt(b)])],
              points: [pointCopy(a), pointCopy(b)],
              netId: net.id,
            });
          }
        }
      }
    }
  }
  const crossOverlaps = crossNetOverlaps([...circuit.nets.values()].map((net) => ({
    id: net.id,
    paths: evaluationPaths(net),
  })));
  for (const overlap of crossOverlaps) {
    const message = `nets ${overlap.key} and ${overlap.otherKey} overlap (${overlap.x0},${overlap.y0})-(${overlap.x1},${overlap.y1})`;
    addIssue('cross-net-overlap', message, {
      refs: [],
      points: [{ x: overlap.x0, y: overlap.y0 }, { x: overlap.x1, y: overlap.y1 }],
      netIds: [overlap.key.split(':')[0], overlap.otherKey.split(':')[0]],
      segments: [overlap.key, overlap.otherKey],
    });
  }
  const ok = issues.length === 0;
  return {
    components: comps.map((c) => c.refdes),
    terminalCount: terminals.length,
    unconnectedTerminals: dangling,
    nets,
    overlappingBBoxes: overlaps,
    wireThroughBBoxes: boxViolations,
    diagonalWireSegments: diagonalViolations,
    gridViolations: violations,
    labelComponentOverlaps,
    labelOverlaps,
    netLabelIssues,
    logicalNetGroups: circuit.logicalNetGroups().map((group) => ({
      name: group.name,
      netIds: group.netIds.slice(),
      terminalCount: group.terminals.length,
      labelIds: group.labels.map((label) => label.id),
    })),
    crossNetOverlaps: crossOverlaps,
    netNameWarnings: (circuit.netNameWarnings || []).map((warning) => ({
      netId: warning.netId,
      names: warning.names.slice(),
      message: warning.message,
    })),
    issues,
    ok,
    bounds: circuit.bounds(),
  };
}

export function commandHelp() {
  return [
    'Commands',
    '  help | version',
    '  clear                          - start an empty circuit',
    '  add <type> [refdes] [--at X Y] [--rot D] [--mirrorX] [--mirrorY] [--value V]',
    '                                  types: ' + symbolTypeNames.join(' '),
    '  move <refdes> <X> <Y>          - move (snapped to 40-grid)',
    '  rotate <refdes> [deg=90]       - rotate by multiples of 90',
    '  mirror <refdes> <x|y>          - flip along an axis',
    '  value <refdes> <V>             - set value/label text',
    '  rename <refdes> <new>          - rename a component',
    '  rm <refdes>                    - remove a component',
    '  connect REF.TERM REF.TERM ... [--name N] [--explain]  (alias wire)',
    '  cross A1 A2 B1 B2             - two protected diagonal cross-coupled routes',
    '  disconnect REF.TERM            - detach one terminal from its net',
    '  nets                           - list nets with terminals and length',
    '  net <id> add|drop|name|label|rm|segment-rm|path|vertex|junction ... - manage a net',
    '                                   net N1 add R1.a ; net N1 drop R2.b ;',
    '                                   net N1 name OUT ; net N1 rm',
    '  netlabel add NET [ID] NAME X Y  - place a label on a physical net',
    '  netlabel rename|retarget|rm ... - edit/remove a net label',
    '  netlabel convert LABEL NET    - convert an annotation to a net label',
    '  netlabel detach LABEL [TEXT]  - convert a net label to an annotation',
    '  netlabel list [NET]             - list net labels',
    '  annotation (label/annotate) add [ID] TEXT X Y - place a free annotation',
    '  annotation rename|move|rm ... - edit/remove an annotation label',
    '  list                           - list components',
    '  state                          - full JSON state',
    '  bounds                         - drawing extents',
    '  eval                           - quality report (connectivity, overlaps, routing, labels, grid)',
    '  analyze output-impedance NET [--input IN] [--reference NET] [--ac-ground NET,...] [--mode single-ended|differential] [--differential-side NET] [--model REF=triode|current-source] [--context TEXT] [--ignore-channel-length-modulation] [--ignore-body-effect] [--gmro-large] [--miller] - derive symbolic Z_out (input is zeroed)',
    '  analyze input-impedance NET [--reference NET] [--ac-ground NET,...] [--mode single-ended|differential] [--differential-side NET] [--model REF=triode|current-source] [--context TEXT] [--ignore-channel-length-modulation] [--ignore-body-effect] [--gmro-large] [--miller] - derive symbolic Z_in',
    '  analyze transfer-function OUT [--input IN] [--reference NET] [--ac-ground NET,...] [--mode single-ended|differential] [--differential-side NET] [--model REF=triode|current-source] [--context TEXT] [--ignore-channel-length-modulation] [--ignore-body-effect] [--gmro-large] [--miller] - derive symbolic A_v',
    '  --miller                       - explicitly enable the default Miller approximation',
    '  explain eval                   - grouped diagnostics with plain-language repair hints',
    '  explain connect REF.TERM REF.TERM - dry-run route with path, bends, and pin escapes',
    '  ascii                          - coarse ASCII layout preview',
    '  svg [file] [--grid]            - export SVG (default data/preview.svg)',
    '  png [file] [--grid]            - rasterize SVG to PNG (default data/preview.png)',
    '  save <file> | load <file>      - JSON snapshot I/O',
    'Flags: --json prints machine-readable result. All coordinates are 40-grid.',
  ].join('\n');
}

export function runCommand(circuit, line, io) {
  if (circuit instanceof BlockDiagram) return runBlockCommand(circuit, line, io);
  const { pos, flags } = parseArgs(splitArgs(line));
  const cmd = pos.shift() || 'help';
  return dispatch(circuit, cmd, pos, flags, io);
}

function dispatch(circuit, cmd, pos, flags, io) {
  const json = flags.json;
  const result = (text, data, mutated = false) => ({ text, json: data, mutated });

  // ---------- meta / state ----------
  if (cmd === 'help') return result(commandHelp(), null);
  if (cmd === 'version') return result('schematic-spawner 0.1.0 (grid = 40)', null);
  if (cmd === 'clear') {
    circuit.components.clear();
    circuit.nets.clear();
    circuit.labels.clear();
    circuit.netNameWarnings = [];
    return result('cleared', null, true);
  }
  if (cmd === 'list') {
    const rows = [];
    for (const c of circuit.components.values()) {
      const terms = c.worldTerminals().map((t) => `${t.name}=${pp(t.x, t.y)}`).join(' ');
      rows.push(`${c.refdes.padEnd(8)} ${c.type.padEnd(12)} at ${pp(c.transform.x, c.transform.y)} rot=${c.transform.rotation} mX=${c.transform.mirrorX ? 1 : 0} mY=${c.transform.mirrorY ? 1 : 0}  ${terms}`);
    }
    return result(rows.join('\n') || '(no components)', null);
  }
  if (cmd === 'nets') return netList(circuit, result);
  if (cmd === 'state') return result(JSON.stringify(circuit.toJSON(), null, 2), circuit.toJSON());
  if (cmd === 'bounds') {
    const b = circuit.bounds();
    return result(`bounds ${pp(b.x, b.y)} .. ${pp(b.x + b.w, b.y + b.h)} (${fmt(b.w)} x ${fmt(b.h)})`, b, false);
  }
  if (cmd === 'eval') {
    const rep = evaluate(circuit);
    const lines = [
      `components: ${rep.components.length}`,
      `terminals:  ${rep.terminalCount}, unconnected: ${rep.unconnectedTerminals.length}`,
    ];
    if (rep.unconnectedTerminals.length) lines.push(`  dangling: ${rep.unconnectedTerminals.join(', ')}`);
    lines.push(`nets: ${rep.nets.length}`);
    for (const n of rep.nets) lines.push(`  ${n.id} ${n.name ? `"${n.name}" ` : ''}n=${n.n} len=${n.length}`);
    if (rep.overlappingBBoxes.length) lines.push(`overlapping bboxes: ${rep.overlappingBBoxes.join(', ')}`);
    if (rep.wireThroughBBoxes.length) lines.push(`wires through bboxes: ${rep.wireThroughBBoxes.join(', ')}`);
    if (rep.diagonalWireSegments.length) lines.push(`managed diagonal wires: ${rep.diagonalWireSegments.join(', ')}`);
    if (rep.gridViolations.length) lines.push(`GRID VIOLATIONS: ${rep.gridViolations.join(', ')}`);
    if (rep.labelComponentOverlaps.length) lines.push(`label-component overlaps: ${rep.labelComponentOverlaps.join(', ')}`);
    if (rep.labelOverlaps.length) lines.push(`label overlaps: ${rep.labelOverlaps.join(', ')}`);
    if (rep.crossNetOverlaps.length) lines.push(`cross-net overlaps: ${rep.crossNetOverlaps.map((x) => `${x.key}/${x.otherKey}`).join(', ')}`);
    if (rep.netNameWarnings.length) lines.push(`net name conflicts: ${rep.netNameWarnings.map((x) => x.message).join('; ')}`);
    if (rep.ok) {
      lines.push('no dangling terminals, no bbox overlaps, all on grid');
    }
    return result(lines.join('\n'), rep, false);
  }
  if (cmd === 'analyze' || cmd === 'analysis') {
    const subject = pos.shift();
    if (subject !== 'output-impedance' && subject !== 'rout' && subject !== 'zout' && subject !== 'input-impedance' && subject !== 'rin' && subject !== 'zin' && subject !== 'transfer-function' && subject !== 'transfer' && subject !== 'gain') {
      throw new Error('usage: analyze <input-impedance|output-impedance|transfer-function> NET [--input NET] [--reference NET] [--ac-ground NET,...] [--mode single-ended|differential] [--differential-side NET] [--model REF=triode|current-source] [--context TEXT] [--ignore-channel-length-modulation] [--ignore-body-effect] [--gmro-large] [--miller]');
    }
    const target = pos.shift();
    if (!target || pos.length) throw new Error('usage: analyze <input-impedance|output-impedance|transfer-function> NET [--input NET] [--reference NET] [--ac-ground NET,...] [--mode single-ended|differential] [--differential-side NET] [--model REF=triode|current-source] [--context TEXT] [--ignore-channel-length-modulation] [--ignore-body-effect] [--gmro-large] [--miller]');
    const analysisOptions = {
      reference: flags.reference?.[0],
      acGrounds: flags['ac-ground'],
      mode: flags.mode?.[0],
      differentialSide: flags['differential-side']?.[0],
      models: flags.model,
      context: flags.context?.[0],
      input: flags.input?.[0],
      ignoreChannelLengthModulation: !!flags['ignore-channel-length-modulation'],
      ignoreBodyEffect: !!flags['ignore-body-effect'],
      gmroLarge: !!flags['gmro-large'],
      // The core analysis defaults Miller on; only pass the flag when the
      // caller explicitly requested it so an omitted CLI option does not
      // accidentally disable the default.
      ...(flags.miller ? { millerApproximation: true } : {}),
    };
    const report = subject === 'output-impedance' || subject === 'rout' || subject === 'zout'
      ? analyzeOutputImpedance(circuit, target, analysisOptions)
      : subject === 'input-impedance' || subject === 'rin' || subject === 'zin'
        ? analyzeInputImpedance(circuit, target, analysisOptions)
        : analyzeTransferFunction(circuit, target, analysisOptions);
    const lines = [report.ok ? report.equation : `unsupported: ${report.error}`];
    if (report.systematicEquation && report.systematicEquation !== report.equation) lines.push(`systematic: ${report.systematicEquation}`);
    if (report.ok) {
      lines.push(`target: ${report.target.name || report.target.netId}`);
      lines.push(`reference: ${report.reference.name || report.reference.netId}${report.reference.inferred ? ' (inferred from ground)' : ''}`);
      if (report.input) lines.push(`input: ${report.input.name || report.input.netId}`);
      if (report.dependencies?.length) lines.push(`depends on: ${report.dependencies.join(', ')}`);
    }
    if (Number.isFinite(report.equationCount)) lines.push(`node system: ${report.equationCount} equations, ${report.unknownCount} unknowns`);
    for (const equation of report.nodeEquations || report.equations || []) lines.push(`node: ${equation}`);
    if (report.smallSignalNetlist) lines.push(`small-signal netlist:\n${report.smallSignalNetlist}`);
    for (const assumption of report.assumptions || []) lines.push(`assumption: ${assumption}`);
    for (const approximation of report.approximations || []) lines.push(`approximation: ${approximation}`);
    return result(lines.join('\n'), report, false);
  }
  if (cmd === 'explain' || cmd === 'diagnose') {
    const subject = pos.shift() || 'eval';
    if (subject === 'eval' || subject === 'check') {
      const explanation = diagnosticExplanation(evaluate(circuit));
      const lines = [explanation.summary];
      for (const group of explanation.groups) {
        lines.push(`${group.kind} (${group.count}): ${group.hint}`);
        for (const issue of group.issues) lines.push(`  ${issue.message}`);
      }
      return result(lines.join('\n'), explanation, false);
    }
    if (subject === 'connect' || subject === 'route') {
      const explanation = routeExplanation(circuit, pos);
      const lines = [explanation.reason, `  ${explanation.source} -> ${explanation.target}`];
      if (explanation.path) lines.push(`  path: ${explanation.path.map((point) => pp(point.x, point.y)).join(' -> ')}`);
      return result(lines.join('\n'), explanation, false);
    }
    throw new Error('usage: explain eval | explain connect REF.TERM REF.TERM');
  }
  if (cmd === 'ascii') return result(renderAscii(circuit), null);

  // ---------- components ----------
  if (cmd === 'add') {
    const type = pos[0];
    const def = getSymbol(type);
    let refdes = pos[1];
    let x;
    let y;
    if (flags.at) {
      x = Number(flags.at[0]);
      y = Number(flags.at[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('--at expects numeric X Y');
    } else {
      const b = circuit.bounds();
      x = b.w > 0 || b.h > 0 ? ceilGrid(b.x + b.w) + GRID : 0;
      y = b.w > 0 || b.h > 0 ? snap(b.y) : 0;
    }
    const c = circuit.addComponent(type, {
      refdes,
      x,
      y,
      rotation: flags.rot ? Number(flags.rot[0]) : 0,
      // Omit the mirror flags when not given so the symbol's own defaults apply
      // (e.g. output ports default to mirrorX, pmos to mirrorY).
      mirrorX: flags.mirrorX ? true : undefined,
      mirrorY: flags.mirrorY ? true : undefined,
      value: flags.value ? flags.value[0] : undefined,
    });
    const terms = c.worldTerminals().map((t) => `${t.name}=${pp(t.x, t.y)}`);
    const m = `${c.transform.mirrorX ? 'X' : ''}${c.transform.mirrorY ? 'Y' : ''}`;
    const text = `added ${c.refdes} (${type}) at ${pp(c.transform.x, c.transform.y)} rot=${c.transform.rotation}${m ? ` mir(${m})` : ''}; terminals ${terms.join(' ')}`;
    return result(text, { refdes: c.refdes, type, at: { x: c.transform.x, y: c.transform.y }, rotation: c.transform.rotation, mirrorX: c.transform.mirrorX, mirrorY: c.transform.mirrorY, terminals: c.worldTerminals() }, true);
  }
  if (cmd === 'move') {
    const c = circuit.getComponent(pos[0]);
    const ox = c.transform.x;
    const oy = c.transform.y;
    circuit.moveComponent(c.refdes, Number(pos[1]), Number(pos[2]));
    const moved = new Map([[c.refdes, { dx: c.transform.x - ox, dy: c.transform.y - oy }]]);
    rerouteNetsFor(circuit, [c.refdes], moved);
    // Touching pins connect at the committed position (a pin that lands exactly
    // on another component's pin joins its net); re-route any merged net.
    if (circuit.connectCoincident(c.refdes) > 0) {
      const touched = new Set();
      for (const id of [...circuit.nets.keys()]) {
        if (circuit.nets.get(id).terminals.some((t) => t.comp === c.refdes)) touched.add(id);
      }
      for (const id of touched) routeNet(circuit, circuit.nets.get(id));
    }
    // A moved component can land a wire leg on top of a same-net wire; reduce
    // the touched nets so overlapped runs merge instead of hiding beneath.
    for (const id of [...circuit.nets.keys()]) {
      const net = circuit.nets.get(id);
      if (net && net.terminals.some((t) => t.comp === c.refdes)) circuit._reduceNet(net);
    }
    // Re-attach wire pieces that landed back on common endpoints after a
    // detached move; this also restores any junction solder markers.
    circuit.reconnectCoincidentNets();
    return result(`moved ${c.refdes} to ${pp(c.transform.x, c.transform.y)}`, { refdes: c.refdes, x: c.transform.x, y: c.transform.y }, true);
  }
  if (cmd === 'rotate') {
    const c = circuit.getComponent(pos[0]);
    const deg = pos[1] !== undefined ? Number(pos[1]) : 90;
    circuit.setTransform(c.refdes, { rotation: c.transform.rotation + deg });
    rerouteNetsFor(circuit, [c.refdes], null, true);
    circuit.reconnectCoincidentNets();
    return result(`rotated ${c.refdes} to ${c.transform.rotation}°`, { refdes: c.refdes, rotation: c.transform.rotation }, true);
  }
  if (cmd === 'mirror') {
    const c = circuit.getComponent(pos[0]);
    const axis = (pos[1] || 'x').toLowerCase();
    if (axis !== 'x' && axis !== 'y') throw new Error('mirror axis must be x or y');
    const operation = axis === 'x' ? 'mirrorX' : 'mirrorY';
    const next = transformComponentWorld(
      c.transform,
      { x: c.transform.x, y: c.transform.y },
      operation,
    );
    circuit.setTransform(c.refdes, {
      rotation: next.rotation,
      mirrorX: next.mirrorX,
      mirrorY: next.mirrorY,
    });
    rerouteNetsFor(circuit, [c.refdes], null, true);
    circuit.reconnectCoincidentNets();
    circuit.syncJunctionSolders();
    return result(`mirrored ${c.refdes} along ${axis}`, { refdes: c.refdes, axis }, true);
  }
  if (cmd === 'value' || cmd === 'setvalue') {
    const c = circuit.getComponent(pos[0]);
    const v = pos[1];
    circuit.setValue(c.refdes, v);
    return result(`${c.refdes} value = "${v}"`, { refdes: c.refdes, value: v }, true);
  }
  if (cmd === 'rename') {
    const c = circuit.getComponent(pos[0]);
    const newName = pos[1];
    circuit.renameComponent(c.refdes, newName);
    return result(`renamed ${pos[0]} -> ${newName}`, { from: pos[0], to: newName }, true);
  }
  if (cmd === 'rm' || cmd === 'remove') {
    const c = circuit.getComponent(pos[0]);
    circuit.removeComponent(c.refdes);
    return result(`removed ${pos[0]}`, { removed: pos[0] }, true);
  }

  // ---------- connectivity ----------
  if (cmd === 'connect' || cmd === 'wire') {
    if (pos.length < 2) throw new Error('usage: connect REF.TERM REF.TERM [...]');
    const explanation = flags.explain ? routeExplanation(circuit, pos.slice(0, 2)) : null;
    const net = circuit.connect(...pos);
    if (flags.name && flags.name[0]) circuit.renameNet(net, flags.name[0]);
    const terms = net.terminals.map((t) => termInfo(circuit, t.comp, t.term));
    return result(`net ${net.id}${net.name ? ` "${net.name}"` : ''}: ${terms.join('  ')}; len=${net.length()}${explanation ? `; ${explanation.reason}` : ''}`, { netId: net.id, name: net.name, terminals: net.terminals.map((t) => ({ ...t })), length: net.length(), ...(explanation ? { explanation } : {}) }, true);
  }
  if (cmd === 'cross') {
    if (pos.length !== 4) throw new Error('usage: cross A1 A2 B1 B2');
    const refs = pos.map((ref) => circuit.resolveTerm(ref));
    const points = refs.map((ref) => circuit.getComponent(ref.comp).terminalWorld(ref.term));
    let paths;
    try {
      paths = balancedCrossCoupling([points[0], points[1]], [points[2], points[3]]);
    } catch (err) {
      throw new Error(`invalid cross-coupling endpoints: ${err.message}`);
    }
    const pairNets = [
      [circuit.netOfTerminal(refs[0]), circuit.netOfTerminal(refs[1])],
      [circuit.netOfTerminal(refs[2]), circuit.netOfTerminal(refs[3])],
    ];
    const existing = pairNets.flat();
    if (existing.some(Boolean)) {
      const samePath = (net, path, start, end) => {
        if (!net || net.routingMode !== 'fixed' || net.fixedPaths.length !== 1) return false;
        const entry = net.fixedPaths[0];
        if (!entry.start || !entry.end || entry.start.comp !== start.comp || entry.start.term !== start.term ||
            entry.end.comp !== end.comp || entry.end.term !== end.term || entry.points.length !== path.length) return false;
        return entry.points.every((p, i) => p.x === path[i].x && p.y === path[i].y);
      };
      const idempotent = pairNets[0][0] && pairNets[0][0] === pairNets[0][1] &&
        pairNets[1][0] && pairNets[1][0] === pairNets[1][1] && pairNets[0][0] !== pairNets[1][0] &&
        samePath(pairNets[0][0], paths[0], refs[0], refs[1]) &&
        samePath(pairNets[1][0], paths[1], refs[2], refs[3]);
      if (!idempotent) throw new Error('cross-coupling endpoints already belong to a net');
      return result(`cross ${pos.join(' ')} already exists (${pairNets[0][0].id}, ${pairNets[1][0].id})`, {
        nets: [pairNets[0][0].toJSON(), pairNets[1][0].toJSON()],
      }, false);
    }
    const nets = [
      circuit.wireDirectTo(refs[0], refs[1], paths[0].slice(1, -1)),
      circuit.wireDirectTo(refs[2], refs[3], paths[1].slice(1, -1)),
    ];
    return result(`cross ${pos.join(' ')}: fixed nets ${nets[0].id}, ${nets[1].id}`, {
      nets: nets.map((net) => net.toJSON()),
    }, true);
  }
  if (cmd === 'disconnect') {
    const net = circuit.disconnect(pos[0]);
    return result(`disconnected ${pos[0]} (net ${net.id})`, { terminal: pos[0], netId: net.id }, true);
  }
  if (cmd === 'netlabel' || cmd === 'net-label' || cmd === 'net_label' || cmd === 'nlabel' || cmd === 'wirelabel' || cmd === 'wire-label') {
    return netLabelCommand(circuit, pos, result);
  }
  if (cmd === 'annotation' || cmd === 'annotate' || cmd === 'label') {
    return annotationCommand(circuit, pos, result);
  }
  if (cmd === 'net') return netCommand(circuit, pos, result);

  // ---------- files / render ----------
  if (cmd === 'svg' || cmd === 'export') {
    const file = flags.file ? flags.file[0] : pos[0] || 'data/preview.svg';
    const svg = svgString(circuit, { grid: !!flags.grid, terminals: false, junctions: false, background: true });
    if (io) {
      io.writeTextFile(file, svg);
      return result(`wrote ${file} (${svg.length} bytes)`, null);
    }
    return result('(no file I/O) SVG below; use --json for the string', { svg });
  }
  if (cmd === 'png' || cmd === 'render') {
    const file = flags.file ? flags.file[0] : pos[0] || 'data/preview.png';
    if (!io) return result('PNG export requires CLI (file I/O); use svg/--json instead', null);
    const svgFile = file.replace(/\.png$/i, '') + '.svg';
    io.writeTextFile(svgFile, svgString(circuit, { grid: !!flags.grid, terminals: false, junctions: false, background: true }));
    const out = io.rasterize(svgFile, file);
    return result(`wrote ${file} via ${out.tool}`, null);
  }
  if (cmd === 'save') {
    const file = flags.file ? flags.file[0] : pos[0];
    if (!file) throw new Error('usage: save <file>');
    if (!io) return result('save requires CLI (file I/O)', null);
    io.writeTextFile(file, JSON.stringify(circuit.toJSON(), null, 2));
    return result(`saved state to ${file}`, null);
  }
  if (cmd === 'load') {
    const file = flags.file ? flags.file[0] : pos[0];
    if (!file) throw new Error('usage: load <file>');
    if (!io) return result('load requires CLI (file I/O)', null);
    const data = JSON.parse(io.readTextFile(file));
    const fresh = Circuit.fromJSON(data);
    circuit.components = fresh.components;
    circuit.nets = fresh.nets;
    circuit.labels = fresh.labels;
    return result(`loaded state from ${file}`, fresh.toJSON(), true);
  }

  throw new Error(`unknown command "${cmd}" (try: help)`);
}

export function blockCommandHelp() {
  return [
    'Block diagram commands',
    '  block add ID TEXT X Y W H | add-block ID TEXT X Y W H',
    '  block move|resize|rename|remove ... (or move-block etc.)',
    '  terminal add BLOCK ID SIDE OFFSET | move-terminal BLOCK.ID SIDE OFFSET | rm-terminal BLOCK.ID',
    '  connector add ID FROM TO | rm-connector ID',
    '  netlabel add CONNECTOR [ID] TEXT X Y | netlabel rename ID TEXT | netlabel rm ID',
    '  annotation add [label|arrow|box|line] ID TEXT X Y [X Y ...] | annotation rename ID TEXT | annotation move ID X Y | annotation rm ID',
    '  list | state | bounds | svg/export [file] | save <file>',
  ].join('\n');
}

function runBlockCommand(diagram, line, io) {
  const { pos, flags } = parseArgs(splitArgs(line)); let cmd = pos.shift() || 'help';

  // Keep the explicit command names used by existing scripts, while also
  // accepting the namespaced vocabulary in the block-document contract. This
  // normalization is local to BlockDiagram and can never affect electrical
  // `add`, `move`, `connect`, or `net` commands.
  const families = {
    block: { add: 'add-block', move: 'move-block', resize: 'resize-block', rename: 'rename-block', remove: 'remove-block', rm: 'remove-block', help: 'help' },
    terminal: { add: 'add-terminal', move: 'move-terminal', remove: 'remove-terminal', rm: 'remove-terminal', help: 'help' },
    connector: { add: 'add-connector', remove: 'remove-connector', rm: 'remove-connector', help: 'help' },
  };
  if (families[cmd]) {
    const familyName = cmd;
    const operation = pos.shift() || 'help';
    cmd = families[familyName][operation];
    if (!cmd) throw new Error(`unknown ${familyName} operation "${operation}"`);
  }
  const result = (text, json = null, mutated = false) => ({ text, json, mutated });
  if (cmd === 'help') return result(blockCommandHelp());
  if (cmd === 'list') return result([
    ...[...diagram.blocks.values()].map((b) => `${b.id} ${b.text}`),
    ...[...diagram.arrows.values()].map((a) => a.detached
      ? `${a.id} (detached visual connector)`
      : `${a.id} ${a.from.block}.${a.from.terminal} -> ${a.to.block}.${a.to.terminal}`),
  ].join('\n') || '(no blocks)');
  if (cmd === 'state') return result(JSON.stringify(diagram.toJSON(), null, 2), diagram.toJSON());
  if (cmd === 'bounds') return result(JSON.stringify(diagram.bounds()), diagram.bounds());
  if (cmd === 'add-block') {
    const [id, text, x, y, w, h] = pos;
    if (!id || text === undefined || [x, y, w, h].some((value) => value === undefined || !Number.isFinite(Number(value)))) {
      throw new Error('usage: add-block ID TEXT X Y W H');
    }
    const block = diagram.addBlock({ id, text, x: Number(x), y: Number(y), w: Number(w), h: Number(h) });
    return result(`added ${block.id}`, block.toJSON(), true);
  }
  if (cmd === 'move-block') {
    const block = diagram.moveBlock(pos[0], Number(pos[1]), Number(pos[2]));
    return result(`moved ${block.id}`, block.toJSON(), true);
  }
  if (cmd === 'resize-block') {
    const block = diagram.resizeBlock(pos[0], Number(pos[1]), Number(pos[2]));
    return result(`resized ${block.id}`, block.toJSON(), true);
  }
  if (cmd === 'rename-block') {
    const block = diagram.renameBlock(pos[0], pos.slice(1).join(' '));
    return result(`renamed ${block.id}`, block.toJSON(), true);
  }
  if (cmd === 'rm-block' || cmd === 'remove-block') {
    const block = diagram.removeBlock(pos[0]);
    return result(`removed ${block.id}`, block.toJSON(), true);
  }
  if (cmd === 'add-terminal') {
    const [blockId, id, side, offset] = pos;
    if (!blockId || !id || !side || offset === undefined || !Number.isFinite(Number(offset))) {
      throw new Error('usage: add-terminal BLOCK ID SIDE OFFSET');
    }
    const terminal = diagram.addTerminal(blockId, { id, side, offset: Number(offset) });
    return result(`added terminal ${blockId}.${terminal.id}`, terminal.toJSON(), true);
  }
  if (cmd === 'move-terminal') {
    const terminal = diagram.moveTerminal(pos[0], pos[1], Number(pos[2]));
    return result(`moved terminal ${pos[0]}`, terminal.toJSON(), true);
  }
  if (cmd === 'rm-terminal' || cmd === 'remove-terminal') {
    const ref = pos[0];
    if (!diagram.removeTerminal(ref)) throw new Error(`unknown terminal "${ref}"`);
    return result(`removed terminal ${ref}`, null, true);
  }
  if (cmd === 'add-arrow' || cmd === 'add-connector') {
    const [id, from, to] = pos;
    if (!id || !from || !to) throw new Error('usage: add-connector ID FROM TO');
    const arrow = diagram.addArrow({ id, from, to });
    return result(`added connector ${arrow.id}`, arrow.toJSON(), true);
  }
  if (cmd === 'rm-arrow' || cmd === 'remove-arrow' || cmd === 'rm-connector' || cmd === 'remove-connector') {
    const arrow = diagram.removeArrow(pos[0]);
    return result(`removed connector ${arrow.id}`, arrow.toJSON(), true);
  }
  if (cmd === 'netlabel' || cmd === 'net-label') {
    const op = pos.shift();
    if (op === 'list') return result([...diagram.labels.values()].filter((label) => label.connectorId).map((label) => `${label.id} connector=${label.connectorId} "${label.text}"`).join('\n') || '(no connector labels)');
    if (op === 'add') {
      const connector = pos.shift();
      const tail = pos.slice();
      if (!connector || tail.length < 3) throw new Error('usage: netlabel add CONNECTOR [ID] TEXT X Y');
      const x = Number(tail.at(-2)); const y = Number(tail.at(-1));
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('usage: netlabel add CONNECTOR [ID] TEXT X Y');
      tail.splice(-2);
      const id = tail.length > 1 ? tail.shift() : undefined;
      const label = diagram.addNetLabel(connector, { id, text: tail.join(' '), anchor: { x, y } });
      return result(`added connector label ${label.id}`, label.toJSON(), true);
    }
    if (op === 'rename') {
      const label = diagram.labels.get(pos[0]);
      if (!label?.connectorId || !pos[1]) throw new Error(`unknown connector label "${pos[0]}"`);
      label.setText(pos.slice(1).join(' '));
      return result(`renamed connector label ${label.id}`, label.toJSON(), true);
    }
    if (op === 'rm' || op === 'remove') {
      if (!diagram.labels.get(pos[0])?.connectorId || !diagram.removeLabel(pos[0])) throw new Error(`unknown connector label "${pos[0]}"`);
      return result(`removed connector label ${pos[0]}`, null, true);
    }
    throw new Error('usage: netlabel add|rename|rm|list ...');
  }
  if (cmd === 'annotation' || cmd === 'annotate') {
    const op = pos.shift();
    if (op === 'list') return result([...diagram.labels.values()].map((label) => `${label.id} ${label.kind} ${label.text}`).join('\n') || '(no annotations)');
    if (op === 'add') {
      let kind = 'label';
      let id;
      let text;
      let coordinateArgs;
      if (['label', 'arrow', 'box', 'line'].includes(pos[0])) {
        [kind, id, text] = pos;
        coordinateArgs = pos.slice(3);
      } else {
        [id, text] = pos;
        coordinateArgs = pos.slice(2);
      }
      const coordinates = coordinateArgs.map(Number);
      const needed = kind === 'label' ? 2 : 4;
      const coordinateCountOkay = kind === 'line'
        ? coordinates.length >= needed && coordinates.length % 2 === 0
        : coordinates.length === needed;
      if (!id || text === undefined || !coordinateCountOkay || coordinates.some((value) => !Number.isFinite(value))) {
        throw new Error('usage: annotation add [kind] ID TEXT X Y [X Y ...]');
      }
      const points = [];
      for (let index = 0; index < coordinates.length; index += 2) points.push({ x: coordinates[index], y: coordinates[index + 1] });
      const values = kind === 'label'
        ? { id, text, x: points[0].x, y: points[0].y }
        : kind === 'line'
          ? { id, text, points }
          : { id, text, x: points[0].x, y: points[0].y, end: points[1] };
      const label = kind === 'label' ? diagram.addLabel(values) : diagram.addAnnotation(kind, values);
      return result(`added annotation ${label.id}`, label.toJSON(), true);
    }
    if (op === 'rename') {
      const label = diagram.labels.get(pos[0]);
      if (!label) throw new Error(`unknown annotation "${pos[0]}"`);
      const text = pos.slice(1).join(' ');
      const children = ['arrow', 'box', 'line'].includes(label.kind)
        ? [...diagram.labels.values()].filter((child) => child.parent === label.id)
        : [];
      for (const child of children) child.setText(text);
      if (!children.length) label.setText(text);
      return result(`renamed annotation ${label.id}`, label.toJSON(), true);
    }
    if (op === 'move') {
      const label = diagram.labels.get(pos[0]);
      const x = Number(pos[1]);
      const y = Number(pos[2]);
      if (!label || !Number.isFinite(x) || !Number.isFinite(y)) throw new Error(!label ? `unknown annotation "${pos[0]}"` : 'usage: annotation move LABEL X Y');
      label.moveTo(x, y);
      return result(`moved annotation ${label.id}`, label.toJSON(), true);
    }
    if (op === 'rm' || op === 'remove') { if (!diagram.removeLabel(pos[0])) throw new Error(`unknown annotation "${pos[0]}"`); return result(`removed annotation ${pos[0]}`, null, true); }
    throw new Error('usage: annotation add|rename|move|rm|list ...');
  }
  if (cmd === 'svg' || cmd === 'export') {
    const file = flags.file?.[0] || pos[0] || 'data/preview.svg';
    const svg = renderDocument(diagram, { background: true });
    if (io) { io.writeTextFile(file, svg); return result(`wrote ${file} (${svg.length} bytes)`); }
    return result('SVG below', { svg });
  }
  if (cmd === 'save') {
    const file = flags.file?.[0] || pos[0];
    if (!io || !file) throw new Error('save requires file I/O and a path');
    io.writeTextFile(file, JSON.stringify(saveDocument(diagram), null, 2));
    return result(`saved state to ${file}`);
  }
  throw new Error(`unknown command "${cmd}" (try: help)`);
}

function netList(circuit, result) {
  const rows = [];
  for (const net of circuit.nets.values()) {
    const terms = net.terminals.map((t) => termInfo(circuit, t.comp, t.term)).join(' ');
    const labels = circuit.netLabels(net).map((label) => label.id).join(',');
    rows.push(`${net.id}${net.name ? ` "${net.name}"` : ''} n=${net.terminals.length} len=${net.length()}${labels ? ` labels=${labels}` : ''}  [${terms}]`);
  }
  return result(rows.join('\n') || '(no nets)', null);
}

function netLabelCommand(circuit, pos, result) {
  const op = pos[0];
  if (op === 'list') {
    const labels = pos[1] ? circuit.netLabels(pos[1]) : [...circuit.labels.values()].filter((label) => label.isNetLabel());
    const rows = labels.map((label) => `${label.id} net=${label.netId} name="${label.text}" at ${pp(label.anchorWorld().x, label.anchorWorld().y)}`);
    return result(rows.join('\n') || '(no net labels)', labels.map((label) => label.toJSON()));
  }
  if (op === 'add') {
    const netId = pos[1];
    if (!netId) throw new Error('usage: netlabel add NET [ID] NAME X Y');
    const tail = pos.slice(2);
    let x = 0;
    let y = 0;
    if (tail.length < 3 || !Number.isFinite(Number(tail.at(-2))) || !Number.isFinite(Number(tail.at(-1)))) {
      throw new Error('usage: netlabel add NET [ID] NAME X Y');
    }
    if (tail.length >= 2 && Number.isFinite(Number(tail.at(-2))) && Number.isFinite(Number(tail.at(-1)))) {
      x = Number(tail.at(-2));
      y = Number(tail.at(-1));
      tail.splice(-2);
    }
    if (tail.length === 0) throw new Error('usage: netlabel add NET [ID] NAME X Y');
    const id = tail.length > 1 ? tail.shift() : undefined;
    const name = tail.join(' ');
    const label = circuit.addNetLabel(netId, { id, text: name, x, y });
    return result(`added net label ${label.id} to ${label.netId} (${label.text})`, label.toJSON(), true);
  }
  if (op === 'rename') {
    const label = circuit._resolveNetLabel(pos[1]);
    const name = pos.slice(2).join(' ');
    if (!name) throw new Error('usage: netlabel rename LABEL NAME');
    circuit.renameNetLabel(label, name);
    return result(`renamed net ${label.netId} to "${label.text}"`, label.toJSON(), true);
  }
  if (op === 'retarget') {
    if (!pos[1] || !pos[2]) throw new Error('usage: netlabel retarget LABEL NET');
    const label = circuit.retargetNetLabel(pos[1], pos[2]);
    return result(`retargeted net label ${label.id} to ${label.netId}`, label.toJSON(), true);
  }
  if (op === 'convert') {
    if (!pos[1] || !pos[2]) throw new Error('usage: netlabel convert LABEL NET');
    const label = circuit.convertLabelToNet(pos[1], pos[2]);
    return result(`converted ${label.id} to net label ${label.netId}`, label.toJSON(), true);
  }
  if (op === 'detach') {
    if (!pos[1]) throw new Error('usage: netlabel detach LABEL [TEXT]');
    const label = circuit.convertNetLabelToAnnotation(pos[1], pos.slice(2).join(' ') || null);
    return result(`converted ${label.id} to an annotation`, label.toJSON(), true);
  }
  if (op === 'rm' || op === 'remove') {
    const label = circuit._resolveNetLabel(pos[1]);
    circuit.removeLabel(label);
    return result(`removed net label ${label.id}`, null, true);
  }
  throw new Error('usage: netlabel add|rename|retarget|convert|detach|rm|list ...');
}

function annotationCommand(circuit, pos, result) {
  const op = pos[0];
  if (op === 'list') {
    const labels = [...circuit.labels.values()].filter((label) => !label.owner && !label.isNetLabel());
    const rows = labels.map((label) => `${label.id} text="${label.text}" at ${pp(label.anchorWorld().x, label.anchorWorld().y)}`);
    return result(rows.join('\n') || '(no annotations)', labels.map((label) => label.toJSON()));
  }
  if (op === 'add') {
    const tail = pos.slice(1);
    if (tail.length < 3 || !Number.isFinite(Number(tail.at(-2))) || !Number.isFinite(Number(tail.at(-1)))) {
      throw new Error('usage: annotation add [ID] TEXT X Y');
    }
    const x = Number(tail.at(-2));
    const y = Number(tail.at(-1));
    tail.splice(-2);
    const id = tail.length > 1 ? tail.shift() : undefined;
    const label = circuit.addLabel({ id, text: tail.join(' '), x, y });
    return result(`added annotation ${label.id}`, label.toJSON(), true);
  }
  if (op === 'rename') {
    const label = circuit.labels.get(pos[1]);
    if (!label || label.owner || label.isNetLabel()) throw new Error(`unknown annotation "${pos[1]}"`);
    const text = pos.slice(2).join(' ');
    if (!text) throw new Error('usage: annotation rename LABEL TEXT');
    label.setText(text);
    return result(`renamed annotation ${label.id}`, label.toJSON(), true);
  }
  if (op === 'move') {
    const label = circuit.labels.get(pos[1]);
    const x = Number(pos[2]);
    const y = Number(pos[3]);
    if (!label || label.owner || label.isNetLabel() || !Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error('usage: annotation move LABEL X Y');
    }
    label.moveTo(x, y);
    return result(`moved annotation ${label.id}`, label.toJSON(), true);
  }
  if (op === 'rm' || op === 'remove') {
    const label = circuit.labels.get(pos[1]);
    if (!label || label.owner || label.isNetLabel()) throw new Error(`unknown annotation "${pos[1]}"`);
    circuit.removeLabel(label);
    return result(`removed annotation ${label.id}`, null, true);
  }
  throw new Error('usage: annotation add|rename|move|rm|list ...');
}

function netCommand(circuit, pos, result) {
  const sub = pos[0];
  if (!sub) return netList(circuit, result);
  if (sub === 'list') return netList(circuit, result);
  const net = circuit.nets.get(sub);
  if (!net) throw new Error(`unknown net "${sub}"`);
  const op = pos[1];
  if (op === 'add') {
    circuit.connectTo(net.id, pos[2]);
    routeNet(circuit, net);
    return result(`added ${pos[2]} to net ${net.id}`, net.toJSON(), true);
  }
  if (op === 'drop') {
    for (let i = 0; i < net.terminals.length; i++) {
      const t = net.terminals[i];
      if (`${t.comp}.${t.term}` === pos[2]) {
        circuit._dropFixedAnchor(net, t);
        net.terminals.splice(i, 1);
        if (net.terminals.length === 0) circuit.removeNet(net);
        else if (net.terminals.length > 1) routeNet(circuit, net);
        circuit.syncJunctionSolders();
        const remaining = circuit.nets.get(net.id);
        return result(`dropped ${pos[2]} from net ${net.id}`, remaining?.toJSON() || null, true);
      }
    }
    throw new Error(`terminal ${pos[2]} not in net ${net.id}`);
  }
  if (op === 'name') {
    circuit.renameNet(net, pos.slice(2).join(' '));
    return result(`net ${net.id} name = "${net.name}"`, net.toJSON(), true);
  }
  if (op === 'label') return netLabelCommand(circuit, [pos[2], net.id, ...pos.slice(3)], result);
  if (op === 'segment-rm') {
    const branch = Number(pos[2]);
    const segment = Number(pos[3]);
    if (!Number.isInteger(branch) || !Number.isInteger(segment)) throw new Error('usage: net <id> segment-rm BRANCH SEG');
    circuit.deleteWireSegment(net.id, branch, segment);
    const remaining = circuit.nets.get(net.id);
    return result(`deleted segment ${branch}:${segment} from net ${net.id}`, remaining?.toJSON() || null, true);
  }
  if (op === 'vertex' || op === 'vertex-set') {
    const path = Number(pos[2]);
    const vertex = Number(pos[3]);
    const x = Number(pos[4]);
    const y = Number(pos[5]);
    if (![path, vertex, x, y].every(Number.isFinite) || !Number.isInteger(path) || !Number.isInteger(vertex)) {
      throw new Error('usage: net <id> vertex PATH VERTEX X Y');
    }
    circuit.setFixedPathVertex(net.id, path, vertex, { x, y });
    return result(`moved fixed vertex ${path}:${vertex} on net ${net.id}`, net.toJSON(), true);
  }
  if (op === 'path' || op === 'path-set') {
    const path = Number(pos[2]);
    const coords = pos.slice(3).map(Number);
    if (!Number.isInteger(path) || path < 0 || coords.length < 4 || coords.length % 2 !== 0 || !coords.every(Number.isFinite)) {
      throw new Error('usage: net <id> path PATH X1 Y1 X2 Y2 [...]');
    }
    const points = [];
    for (let i = 0; i < coords.length; i += 2) points.push({ x: coords[i], y: coords[i + 1] });
    circuit.setFixedPath(net.id, path, points);
    return result(`replaced fixed path ${path} on net ${net.id}`, net.toJSON(), true);
  }
  if (op === 'junction' || op === 'junction-set') {
    const junction = Number(pos[2]);
    const x = Number(pos[3]);
    const y = Number(pos[4]);
    if (!Number.isInteger(junction) || !Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error('usage: net <id> junction INDEX X Y');
    }
    circuit.setFixedJunction(net.id, junction, { x, y });
    return result(`moved fixed junction ${junction} on net ${net.id}`, net.toJSON(), true);
  }
  if (op === 'rm') {
    circuit.removeNet(net);
    return result(`removed net ${net.id}`, null, true);
  }
  throw new Error('usage: net <id> add|drop|name|label|rm|segment-rm|path|vertex|junction');
}
