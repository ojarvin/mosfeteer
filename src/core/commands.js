import { Circuit } from './model.js';
import { getSymbol, symbolTypeNames } from './components/index.js';
import { GRID, onGrid, snap, ceilGrid } from './grid.js';
import { rectsOverlap } from './geometry.js';
import { segThroughInterior, smartRoute } from './router.js';
import { renderAscii } from './ascii.js';
import { svgString } from './render.js';
import { demoCircuit } from './templates.js';

/** Re-route every net that touches any of the given component refdes. */
function rerouteNetsFor(circuit, refs) {
  const touched = new Set();
  for (const r of refs) {
    const c = circuit.components.get(r);
    if (!c) continue;
    for (const t of c.def.terminals) {
      const net = circuit.netOfTerminal({ comp: c.refdes, term: t.name });
      if (net) touched.add(net.id);
    }
  }
  const rects = [];
  const pins = new Map();
  for (const comp of circuit.components.values()) {
    if (comp.type === 'solder') continue;
    rects.push(comp.bboxWorld());
    for (const t of comp.worldTerminals()) {
      pins.set(`${t.x},${t.y}`, pinDir(comp, t.x, t.y));
    }
  }
  const wires = [];
  for (const net of circuit.nets.values()) {
    if (!touched.has(net.id)) wires.push(net.points());
  }
  for (const id of touched) {
    const net = circuit.nets.get(id);
    if (!net) continue;
    const world = net.terminalWorlds().filter(Boolean);
    if (world.length < 2) {
      net.route = null;
      continue;
    }
    const env = { rects, pins, wires };
    const path = [{ x: world[0].x, y: world[0].y }];
    for (let i = 1; i < world.length; i++) {
      const seg = smartRoute(path[path.length - 1], world[i], env);
      if (!seg || seg.length < 2) continue;
      for (let k = 1; k < seg.length; k++) path.push({ x: seg[k].x, y: seg[k].y });
    }
    net.route = path.length >= 2 ? path : null;
  }
}

/** Outward direction from a component body toward a world terminal pin. */
function pinDir(c, wx, wy) {
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
  let violations = [];
  for (const c of comps) {
    for (const t of c.def.terminals) {
      const w = c.terminalWorld(t.name);
      const net = circuit.netOfTerminal({ comp: c.refdes, term: t.name });
      if (!onGrid(w.x) || !onGrid(w.y)) violations.push(`${c.refdes}.${t.name}@(${w.x},${w.y}) off-grid`);
      terminals.push({ ref: `${c.refdes}.${t.name}`, x: w.x, y: w.y, net: net ? net.id : null });
      if (!net) dangling.push(`${c.refdes}.${t.name}@(${w.x},${w.y})`);
    }
  }
  for (const c of comps) {
    if (!onGrid(c.transform.x) || !onGrid(c.transform.y)) violations.push(`${c.refdes} origin off-grid`);
  }
  const overlaps = [];
  for (let i = 0; i < comps.length; i++) {
    for (let j = i + 1; j < comps.length; j++) {
      if (annotated(comps[i]) || annotated(comps[j])) continue;
      if (rectsOverlap(comps[i].bboxWorld(), comps[j].bboxWorld())) {
        overlaps.push(`${comps[i].refdes}/${comps[j].refdes}`);
      }
    }
  }
  const nets = [];
  for (const net of circuit.nets.values()) {
    nets.push({ id: net.id, name: net.name, n: net.terminals.length, length: net.length() });
  }
  // Wires running through the strict interior of a component's bounding box.
  // segThroughInterior counts a segment leaving a boundary pin straight across
  // its own body too, while allowing wires that hug the boundary line.
  const boxViolations = [];
  for (const net of circuit.nets.values()) {
    const pts = net.points();
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      for (const comp of comps) {
        if (annotated(comp)) continue;
        if (segThroughInterior(a, b, comp.bboxWorld())) {
          boxViolations.push(
            `net ${net.id} seg (${a.x},${a.y})-(${b.x},${b.y}) through ${comp.refdes}(${comp.type}) bbox`
          );
        }
      }
    }
  }
  return {
    components: comps.map((c) => c.refdes),
    terminalCount: terminals.length,
    unconnectedTerminals: dangling,
    nets,
    overlappingBBoxes: overlaps,
    wireThroughBBoxes: boxViolations,
    gridViolations: violations,
    bounds: circuit.bounds(),
  };
}

export function commandHelp() {
  return [
    'Commands',
    '  help | version',
    '  clear                          - start an empty circuit',
    '  demo                           - load the demo circuit',
    '  add <type> [refdes] [--at X Y] [--rot D] [--mirrorX] [--mirrorY] [--value V]',
    '                                  types: ' + symbolTypeNames.join(' '),
    '  move <refdes> <X> <Y>          - move (snapped to 40-grid)',
    '  rotate <refdes> [deg=90]       - rotate by multiples of 90',
    '  mirror <refdes> <x|y>          - flip along an axis',
    '  value <refdes> <V>             - set value/label text',
    '  rename <refdes> <new>          - rename a component',
    '  rm <refdes>                    - remove a component',
    '  connect REF.TERM REF.TERM ... [--name N]  (alias wire)',
    '  disconnect REF.TERM            - detach one terminal from its net',
    '  nets                           - list nets with terminals and length',
    '  net <id> add|drop|name|rm ...  - manage a net:',
    '                                   net N1 add R1.a ; net N1 drop R2.b ;',
    '                                   net N1 name OUT ; net N1 rm',
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
  if (cmd === 'demo') {
    const fresh = demoCircuit();
    circuit.components = fresh.components;
    circuit.nets = fresh.nets;
    circuit.labels = fresh.labels;
    return result('loaded demo circuit', fresh.toJSON(), true);
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
    if (rep.gridViolations.length) lines.push(`GRID VIOLATIONS: ${rep.gridViolations.join(', ')}`);
    if (!rep.unconnectedTerminals.length && !rep.overlappingBBoxes.length && !rep.gridViolations.length) {
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
      mirrorX: !!flags.mirrorX,
      mirrorY: !!flags.mirrorY,
      value: flags.value ? flags.value[0] : undefined,
    });
    const terms = c.worldTerminals().map((t) => `${t.name}=${pp(t.x, t.y)}`);
    const m = `${c.transform.mirrorX ? 'X' : ''}${c.transform.mirrorY ? 'Y' : ''}`;
    const text = `added ${c.refdes} (${type}) at ${pp(c.transform.x, c.transform.y)} rot=${c.transform.rotation}${m ? ` mir(${m})` : ''}; terminals ${terms.join(' ')}`;
    return result(text, { refdes: c.refdes, type, at: { x: c.transform.x, y: c.transform.y }, rotation: c.transform.rotation, mirrorX: c.transform.mirrorX, mirrorY: c.transform.mirrorY, terminals: c.worldTerminals() }, true);
  }
  if (cmd === 'move') {
    const c = circuit.getComponent(pos[0]);
    circuit.moveComponent(c.refdes, Number(pos[1]), Number(pos[2]));
    rerouteNetsFor(circuit, [c.refdes]);
    circuit.syncJunctionSolders();
    return result(`moved ${c.refdes} to ${pp(c.transform.x, c.transform.y)}`, { refdes: c.refdes, x: c.transform.x, y: c.transform.y }, true);
  }
  if (cmd === 'rotate') {
    const c = circuit.getComponent(pos[0]);
    const deg = pos[1] !== undefined ? Number(pos[1]) : 90;
    circuit.setTransform(c.refdes, { rotation: c.transform.rotation + deg });
    rerouteNetsFor(circuit, [c.refdes]);
    circuit.syncJunctionSolders();
    return result(`rotated ${c.refdes} to ${c.transform.rotation}°`, { refdes: c.refdes, rotation: c.transform.rotation }, true);
  }
  if (cmd === 'mirror') {
    const c = circuit.getComponent(pos[0]);
    const axis = (pos[1] || 'x').toLowerCase();
    if (axis === 'x') circuit.setTransform(c.refdes, { mirrorX: !c.transform.mirrorX });
    else if (axis === 'y') circuit.setTransform(c.refdes, { mirrorY: !c.transform.mirrorY });
    else throw new Error('mirror axis must be x or y');
    rerouteNetsFor(circuit, [c.refdes]);
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
    if (flags.name && flags.name[0]) net.name = flags.name[0];
    const terms = net.terminals.map((t) => termInfo(circuit, t.comp, t.term));
    return result(`net ${net.id}${net.name ? ` "${net.name}"` : ''}: ${terms.join('  ')}; len=${net.length()}`, { netId: net.id, name: net.name, terminals: net.terminals.map((t) => ({ ...t })), length: net.length() }, true);
  }
  if (cmd === 'disconnect') {
    const net = circuit.disconnect(pos[0]);
    return result(`disconnected ${pos[0]} (net ${net.id})`, { terminal: pos[0], netId: net.id }, true);
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
    rows.push(`${net.id}${net.name ? ` "${net.name}"` : ''} n=${net.terminals.length} len=${net.length()}  [${terms}]`);
  }
  return result(rows.join('\n') || '(no nets)', null);
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
    return result(`added ${pos[2]} to net ${net.id}`, net.toJSON(), true);
  }
  if (op === 'drop') {
    for (let i = 0; i < net.terminals.length; i++) {
      const t = net.terminals[i];
      if (`${t.comp}.${t.term}` === pos[2]) {
        net.terminals.splice(i, 1);
        if (net.terminals.length === 0) circuit.nets.delete(net.id);
        circuit.syncJunctionSolders();
        return result(`dropped ${pos[2]} from net ${net.id}`, null, true);
      }
    }
    throw new Error(`terminal ${pos[2]} not in net ${net.id}`);
  }
  if (op === 'name') {
    net.name = pos[2] || '';
    return result(`net ${net.id} name = "${net.name}"`, net.toJSON(), true);
  }
  if (op === 'rm') {
    circuit.nets.delete(net.id);
    circuit.syncJunctionSolders();
    return result(`removed net ${net.id}`, null, true);
  }
  throw new Error('usage: net <id> add|drop|name|rm');
}
