import { Circuit, canonicalNetName, transformComponentWorld } from './model.js';
import { getSymbol, symbolTypeNames } from './components/index.js';
import { GRID, onGrid, snap, ceilGrid } from './grid.js';
import { rectsOverlap, applyDir, applyTransform } from './geometry.js';
import { balancedCrossCoupling, segThroughInterior, smartRoute, balancedRoute } from './router.js';
import { crossNetOverlaps } from './wiring.js';
import { renderAscii } from './ascii.js';
import { svgString } from './render.js';

/** Build the routing environment for a circuit (component bboxes + pin dirs). */
function routeEnv(circuit) {
  const rects = [];
  const pins = new Map();
  for (const comp of circuit.components.values()) {
    if (comp.type === 'solder') continue;
    rects.push(comp.bboxWorld());
    for (const t of comp.worldTerminals()) pins.set(`${t.x},${t.y}`, pinDir(comp, t.x, t.y));
  }
  return { rects, pins, wires: [] };
}

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
    for (const t of c.def.terminals) {
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
  const t = c.def.terminals.find((term) => {
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
  net: 1,
  file: 1,
  mirrorX: 0,
  mirrorY: 0,
  json: 0,
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

/** Evaluation report used to judge whether the diagram "looks good". */
export function evaluate(circuit) {
  const comps = [...circuit.components.values()];
  const annotated = (c) => c.type === 'solder'; // pure annotation: no electrical body
  const terminals = [];
  const dangling = [];
  const issues = [];
  const terminalRefsByPoint = new Map();
  const addIssue = (kind, message, details = {}) => {
    issues.push({ kind, severity: 'error', message, ...details });
  };
  const pointCopy = (p) => ({ x: p.x, y: p.y });
  const refsAt = (p) => terminalRefsByPoint.get(`${p.x},${p.y}`) || [];

  let violations = [];
  for (const c of comps) {
    for (const t of c.def.terminals) {
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
      if (!net) {
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
  const labels = [...circuit.labels.values()].filter((label) => !['arrow', 'box'].includes(label.kind));
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
  // Wires running through the strict interior of a component's bounding box.
  // segThroughInterior counts a segment leaving a boundary pin straight across
  // its own body too, while allowing wires that hug the boundary line.
  const boxViolations = [];
  const diagonalViolations = [];
  for (const net of circuit.nets.values()) {
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
          if (segThroughInterior(a, b, comp.bboxWorld())) {
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
    '  connect REF.TERM REF.TERM ... [--name N]  (alias wire)',
    '  cross A1 A2 B1 B2             - protected matched diagonal cross-coupling',
    '  disconnect REF.TERM            - detach one terminal from its net',
    '  nets                           - list nets with terminals and length',
    '  net <id> add|drop|name|label|rm ... - manage a net (fixed: path, vertex, junction edits)',
    '                                   net N1 add R1.a ; net N1 drop R2.b ;',
    '                                   net N1 name OUT ; net N1 rm',
    '  netlabel add NET [ID] NAME X Y  - place a label owned by a net',
    '  netlabel rename|retarget|rm ... - edit/remove a net label',
    '  netlabel convert LABEL NET    - convert an annotation to a net label',
    '  netlabel detach LABEL [TEXT]  - convert a net label to an annotation',
    '  netlabel list [NET]             - list net labels',
    '  annotation (label/annotate) add [ID] TEXT X Y - place a free annotation',
    '  annotation rename|move|rm ... - edit/remove an annotation label',
    '  list                           - list components',
    '  state                          - full JSON state',
    '  bounds                         - drawing extents',
    '  eval                           - quality report (unconnected/overlaps/off-grid)',
    '  ascii                          - coarse ASCII layout preview',
    '  svg [file] [--grid]            - export SVG (default data/preview.svg)',
    '  png [file] [--grid]            - rasterize SVG to PNG (default data/preview.png)',
    '  save <file> | load <file>      - JSON snapshot I/O',
    'Flags: --json prints machine-readable result. All coordinates are 40-grid.',
  ].join('\n');
}

export function runCommand(circuit, line, io) {
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
    if (rep.ok) {
      lines.push('no dangling terminals, no bbox overlaps, all on grid');
    }
    return result(lines.join('\n'), rep, false);
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
    return result(`moved ${c.refdes} to ${pp(c.transform.x, c.transform.y)}`, { refdes: c.refdes, x: c.transform.x, y: c.transform.y }, true);
  }
  if (cmd === 'rotate') {
    const c = circuit.getComponent(pos[0]);
    const deg = pos[1] !== undefined ? Number(pos[1]) : 90;
    circuit.setTransform(c.refdes, { rotation: c.transform.rotation + deg });
    rerouteNetsFor(circuit, [c.refdes], null, true);
    circuit.syncJunctionSolders();
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
    if (circuit.components.has(newName)) throw new Error(`refdes ${newName} taken`);
    circuit.components.delete(c.refdes);
    c.refdes = newName;
    circuit.components.set(newName, c);
    for (const net of circuit.nets.values()) {
      for (const t of net.terminals) if (t.comp === pos[0]) t.comp = newName;
      if (net.routingMode === 'fixed') {
        for (const path of net.fixedPaths) {
          if (path.start?.comp === pos[0]) path.start.comp = newName;
          if (path.end?.comp === pos[0]) path.end.comp = newName;
        }
      }
    }
    // the instance label follows its owner (its text mirrors the refdes)
    const lab = circuit.labelOf(c.refdes);
    if (lab) {
      lab.owner = newName;
      if (lab.text === pos[0]) lab.text = newName;
    }
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
    const net = circuit.connect(...pos);
    if (flags.name && flags.name[0]) circuit.renameNet(net, flags.name[0]);
    // circuit.connect now re-routes fresh internally when it adds any new
    // terminal to an existing net (so the new terminal always gets a real
    // drawn branch). The previous separate `routeNet(circuit, net)` here
    // was a partial duplicate that only set `net.route` and left stale
    // `net.branches` from the prior save — making the new terminal
    // "connected by reference" with no wire to it after reload.
    const terms = net.terminals.map((t) => termInfo(circuit, t.comp, t.term));
    return result(`net ${net.id}${net.name ? ` "${net.name}"` : ''}: ${terms.join('  ')}; len=${net.length()}`, { netId: net.id, name: net.name, terminals: net.terminals.map((t) => ({ ...t })), length: net.length() }, true);
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
        return result(`dropped ${pos[2]} from net ${net.id}`, null, true);
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
    return result(`deleted segment ${branch}:${segment} from net ${net.id}`, net.toJSON(), true);
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
  throw new Error('usage: net <id> add|drop|name|rm|path|vertex|junction');
}
