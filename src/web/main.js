/**
 * Schematic Spawner — vim-like keyboard editor.
 *
 * Modes:
 *   NORMAL   h/j/k/l move (selected comp or cursor), r/R rotate, x/X mirror,
 *            dd delete, yy/p copy-paste, w wire, Tab cycle, Enter select-at-cursor,
 *            u undo, Ctrl-R redo, i insert, ':' ex-mode commands, ? keymap.
 *   INSERT   letters place components at the cursor, arrows move cursor, Esc back.
 *   WIRE     terminal letters pick/complete connections.
 */

import { Circuit } from '../core/model.js';
import { symbolTypeNames } from '../core/components/index.js';
import { runCommand, commandHelp } from '../core/commands.js';
import { svgString, editorOverlay } from '../core/render.js';
import { demoCircuit } from '../core/templates.js';
import { snap } from '../core/grid.js';
import { smartRoute } from '../core/router.js';

// ----- boot failure surface --------------------------------------
// If the module fails to load/parse/import, show the problem instead of a dead page.

const banner = () => document.getElementById('boot-banner');

window.addEventListener('error', (ev) => {
  const b = banner();
  if (b) {
    b.textContent = `App failed to start: ${ev.message || 'unknown error'} — open it via server (npm run serve → http://127.0.0.1:8080/); double-clicking index.html is blocked by the browser.`;
    b.classList.add('error');
  }
});

// ----- element references -----------------------------------------

const canvasEl = document.getElementById('canvas');
const componentsListEl = document.getElementById('components-list');
const netsListEl = document.getElementById('nets-list');
const detailEl = document.getElementById('detail');
const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');
const cmdInput = document.getElementById('cmd-input');
const paletteEl = document.getElementById('palette');

// ----- editor state ----------------------------------------------

let circuit = new Circuit();
let mode = 'normal'; // 'normal' | 'insert'
let selected = null; // primary refdes
let multi = new Set(); // all selected component refdes (always includes selected)
let selectedNets = new Set(); // ids of highlighted nets
let cursor = { x: 0, y: 0 };
let wire = null; // { source: {refdes, term} | null }
let counts = 0;
let pendingKey = null; // { key, at } for yy / dd chords
let history = []; // undo stack (JSON blobs)
let future = []; // redo stack
let zoom = 0.7; // px per world unit (a 40-unit cell renders as 28px)
let view = { x: -640, y: -480, w: 1280, h: 960 }; // fixed world window (infinite canvas)

function paneSize() {
  const pane = document.querySelector('.canvas-pane');
  if (!pane) return null;
  const r = pane.getBoundingClientRect();
  if (r.width < 10 || r.height < 10) return null;
  return { w: r.width, h: r.height };
}

/** Build a view of the current pane size (grid-aligned) centered on (cx,cy). */
function viewFromCenter(cx, cy) {
  const p = paneSize();
  const w = p ? Math.ceil((p.w / zoom) / 40) * 40 : 1280;
  const h = p ? Math.ceil((p.h / zoom) / 40) * 40 : 960;
  return { x: snap(cx - w / 2), y: snap(cy - h / 2), w, h };
}

/** Re-fit the fixed window to the pane size exactly (keeps center AND scale). */
function resizeView() {
  const p = paneSize();
  if (!p) return;
  const pxPerUnit = p.w / view.w;
  const cx = view.x + view.w / 2;
  const cy = view.y + view.h / 2;
  view.w = p.w / pxPerUnit;
  view.h = p.h / pxPerUnit;
  view.x = cx - view.w / 2;
  view.y = cy - view.h / 2;
}

// ----- console log --------------------------------------------------

function logLine(text, cls) {
  const line = document.createElement('div');
  if (cls) line.className = cls;
  line.textContent = text;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function logCommand(line) {
  logLine(`> ${line}`, 'cmd');
}

// ----- history --------------------------------------------------------

function commit(fn) {
  history.push(JSON.stringify(circuit.toJSON()));
  if (history.length > 200) history.shift();
  future.length = 0;
  fn();
}

function snapshot() {
  return JSON.stringify(circuit.toJSON());
}

function applyJson(blob) {
  circuit = Circuit.fromJSON(JSON.parse(blob));
  if (selected && !circuit.components.has(selected)) selected = null;
  multi = new Set([...multi].filter((r) => circuit.components.has(r)));
  selectedNets.clear();
}

function undo() {
  if (!history.length) return;
  future.push(snapshot());
  applyJson(history.pop());
  render();
}

function redo() {
  if (!future.length) return;
  history.push(snapshot());
  applyJson(future.pop());
  render();
}

// ----- helpers ---------------------------------------------------------

function sortedComps() {
  return [...circuit.components.values()].sort((a, b) => a.refdes.localeCompare(b.refdes));
}

/** Match a world point: exact terminal first, then containing bbox. */
function matchAt(x, y) {
  for (const c of sortedComps()) {
    for (const t of c.worldTerminals()) {
      if (t.x === x && t.y === y) return { refdes: c.refdes, term: t.name };
    }
  }
  for (const c of sortedComps()) {
    const r = c.bboxWorld();
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return { refdes: c.refdes };
  }
  return null;
}

function compUnderCursor() {
  const hit = matchAt(cursor.x, cursor.y);
  return hit && circuit.components.has(hit.refdes) ? circuit.components.get(hit.refdes) : null;
}

function selectedComp() {
  return selected && circuit.components.has(selected) ? circuit.components.get(selected) : null;
}

/** Replace the selection. `primary` defaults to the first element. */
function setSelection(refs, primary = refs[0]) {
  multi = new Set(refs);
  selected = refs.length ? (refs.includes(primary) ? primary : refs[0]) : null;
  if (selected && !circuit.components.has(selected)) selected = null;
}

function selectedComps() {
  const out = [];
  for (const r of multi) {
    const c = circuit.components.get(r);
    if (c) out.push(c);
  }
  return out;
}

function moveCursor(cellsX, cellsY) {
  cursor = { x: snap(cursor.x + cellsX * 40), y: snap(cursor.y + cellsY * 40) };
}

/** Fit the view to all contents (F), preserving the pane aspect ratio so the
 *  drawing always fills the space without distortion. */
function fitView() {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x, y) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  const b = circuit.bounds();
  if (b.w > 0 || b.h > 0) {
    add(b.x, b.y);
    add(b.x + b.w, b.y + b.h);
  }
  for (const c of selectedComps()) {
    const r = c.bboxWorld();
    add(r.x, r.y);
    add(r.x + r.w, r.y + r.h);
  }
  add(cursor.x, cursor.y);
  if (!Number.isFinite(x0)) {
    x0 = -120;
    y0 = -120;
    x1 = 120;
    y1 = 120;
  }
  const M = 120;
  const aspect = view.w / view.h;
  let tw = x1 - x0 + 2 * M;
  let th = y1 - y0 + 2 * M;
  if (tw / th > aspect) th = tw / aspect;
  else tw = th * aspect;
  tw = Math.max(tw, 240);
  th = Math.max(th, 240);
  view.w = tw;
  view.h = th;
  view.x = (x0 + x1) / 2 - tw / 2;
  view.y = (y0 + y1) / 2 - th / 2;
  render();
}

function cycleSelection(dir) {
  const list = sortedComps();
  if (!list.length) {
    setSelection([]);
    render();
    return;
  }
  const idx = list.findIndex((c) => c.refdes === selected);
  const next = ((idx === -1 ? (dir > 0 ? -1 : 0) : idx) + dir + list.length) % list.length;
  selected = list[next].refdes;
  multi = new Set([selected]);
  const p = list[next].transform;
  cursor = { x: p.x, y: p.y };
  render();
}

function placeAtCursor(type) {
  try {
    const comp = circuit.addComponent(type, { x: cursor.x, y: cursor.y });
    setSelection([comp.refdes]);
    logLine(`placed ${comp.refdes} (${type}) @ (${cursor.x},${cursor.y})`);
  } catch (err) {
    logLine(`Error placing ${type}: ${err.message}`);
  }
}

// ----- render -----------------------------------------------------------

function render() {
  renderCanvas();
  renderComponents();
  renderNets();
  renderDetail();
  renderStatus();
  if (window.__app) {
    window.__app.renders.push({ t: performance.now(), view: { ...view } });
    if (window.__app.renders.length > 500) window.__app.renders.shift();
  }
}

function renderCanvas() {
  const wirePreview =
    wire && wire.source
      ? (() => {
          const comp = circuit.components.get(wire.source.refdes);
          if (!comp) return undefined;
          const from = comp.terminalWorld(wire.source.term);
          const pts = smartRoute(from, cursor, netEnv());
          return { from, to: cursor, pts };
        })()
      : undefined;

  let svg = svgString(circuit, {
    grid: true,
    terminals: true,
    junctions: true,
    background: true,
    viewport: { x: view.x, y: view.y, w: view.w, h: view.h },
  });
  const nets = [...selectedNets].map((id) => circuit.nets.get(id)).filter(Boolean);
  const overlay = editorOverlay(circuit, {
    cursor,
    selection: [...multi],
    nets,
    rubber: drag && drag.rubber ? drag.rubber : undefined,
    wirePreview,
  });
  svg = svg.replace('</svg>', `${overlay}\n</svg>`);
  canvasEl.innerHTML = svg;
}

// ----- mouse ------------------------------------------------------------

const DRAG_THRESH = 4; // px before a press becomes a drag
let drag = null;

/** Convert client (pane-relative) coordinates to world, using `refView` for the
 *  mapping. During a pan/zoom drag the reference must be the view captured at
 *  mousedown — mapping against the *live* view creates feedback and makes the
 *  pan stick/stutter. */
function clientToWorld(clientX, clientY, refView = view) {
  const pane = document.querySelector('.canvas-pane');
  const r = pane.getBoundingClientRect();
  return {
    x: refView.x + ((clientX - r.left) / r.width) * refView.w,
    y: refView.y + ((clientY - r.top) / r.height) * refView.h,
  };
}

function worldRect(a, b) {
  return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
}

function rectOverlap(r, box) {
  return r.x < box.x1 && box.x0 < r.x + r.w && r.y < box.y1 && box.y0 < r.y + r.h;
}

function pickAt(w) {
  const x = snap(w.x);
  const y = snap(w.y);
  for (const c of sortedComps()) {
    for (const t of c.worldTerminals()) {
      if (t.x === x && t.y === y) return { refdes: c.refdes, term: t.name };
    }
  }
  for (const c of sortedComps()) {
    const r = c.bboxWorld();
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return { refdes: c.refdes };
  }
  return null;
}

function distToSegment(px, py, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - a.x) * dx + (py - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

/** Pick the net whose route passes within ~6px of the point; returns {net, seg}. */
function pickWire(w) {
  const p = paneSize();
  const pxPerUnit = p ? view.w / p.w : 1;
  const tol = 6 / pxPerUnit;
  let best = null;
  let bestD = tol;
  for (const net of circuit.nets.values()) {
    const pts = net.points();
    for (let i = 1; i < pts.length; i++) {
      const d = distToSegment(w.x, w.y, pts[i - 1], pts[i]);
      if (d < bestD) {
        bestD = d;
        best = { net, seg: i };
      }
    }
  }
  return best;
}

/** Does any part of the net's route lie inside the box? */
function netInBox(net, box) {
  const pts = net.points();
  if (!pts.length) return false;
  const inside = (x, y) => x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1;
  for (const p of pts) if (inside(p.x, p.y)) return true;
  for (let i = 1; i < pts.length; i++) {
    if (inside((pts[i - 1].x + pts[i].x) / 2, (pts[i - 1].y + pts[i].y) / 2)) return true;
  }
  return false;
}

function zoomOutAt(w) {
  const f = 1.35;
  view.x = w.x - (w.x - view.x) * f;
  view.y = w.y - (w.y - view.y) * f;
  view.w *= f;
  view.h *= f;
}

function zoomToWorldRect(r) {
  const pad = 60;
  const aspect = view.w / view.h;
  let tw = r.x1 - r.x0 + pad * 2;
  let th = r.y1 - r.y0 + pad * 2;
  if (tw / th > aspect) th = tw / aspect;
  else tw = th * aspect;
  tw = Math.max(tw, 240);
  th = Math.max(th, 240);
  view.w = tw;
  view.h = th;
  view.x = (r.x0 + r.x1) / 2 - tw / 2;
  view.y = (r.y0 + r.y1) / 2 - th / 2;
}

// ----- smart net routing ----------------------------------------------------

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

/** Routing environment for smartRoute: component bboxes, pin directions, other wires. */
function netEnv(excludeNetId = null) {
  const rects = [];
  const pins = new Map();
  for (const c of circuit.components.values()) {
    if (c.type === 'solder') continue;
    rects.push(c.bboxWorld());
    for (const t of c.worldTerminals()) pins.set(`${t.x},${t.y}`, pinDir(c, t.x, t.y));
  }
  const wires = [];
  for (const n of circuit.nets.values()) {
    if (n.id === excludeNetId) continue;
    wires.push(n.points());
  }
  return { rects, pins, wires };
}

/** Recompute the explicit route of a net (pairwise through its terminals in order). */
function rerouteNet(net) {
  const env = netEnv(net.id);
  const world = net.terminalWorlds().filter(Boolean);
  if (world.length < 2) {
    net.route = null;
    return;
  }
  const path = [{ x: world[0].x, y: world[0].y }];
  for (let i = 1; i < world.length; i++) {
    const seg = smartRoute(path[path.length - 1], world[i], env);
    if (!seg || seg.length < 2) continue;
    for (let k = 1; k < seg.length; k++) path.push({ x: seg[k].x, y: seg[k].y });
  }
  net.route = path.length >= 2 ? path : null;
}

/** Ids of every net that touches any of the given components. */
function netsTouching(refs) {
  const touched = new Set();
  for (const r of refs) {
    const c = circuit.components.get(r);
    if (!c) continue;
    for (const t of c.def.terminals) {
      const net = circuit.netOfTerminal({ comp: c.refdes, term: t.name });
      if (net) touched.add(net.id);
    }
  }
  return touched;
}

/** Re-route every net that touches any of the given components. */
function rerouteAffected(refs) {
  for (const id of netsTouching(refs)) {
    const net = circuit.nets.get(id);
    if (net) rerouteNet(net);
  }
}

/** Connect two terminals, re-route the resulting net, commit history once. */
function connectTwo(src, dst) {
  const before = snapshot();
  const net = circuit.connect(`${src.refdes}.${src.term}`, `${dst.refdes}.${dst.term}`);
  rerouteNet(net);
  history.push(before);
  future.length = 0;
  wire = null;
  selectedNets = new Set([net.id]);
  setSelection([dst.refdes]);
  logLine(`net ${net.id}: ${net.terminals.map((t) => `${t.comp}.${t.term}`).join('  ')}; len=${net.length()}`);
}

function doWireClick(x, y) {
  const hit = matchAt(x, y);
  if (hit && hit.term) {
    if (!wire.source) {
      wire.source = { refdes: hit.refdes, term: hit.term };
      cursor = { x, y };
      logLine(`wire from ${hit.refdes}.${hit.term} — click the target terminal`);
    } else if (hit.refdes === wire.source.refdes && hit.term === wire.source.term) {
      logLine('same terminal — click the other terminal');
    } else {
      try {
        connectTwo(wire.source, hit);
      } catch (err) {
        logLine(String(err.message || err));
      }
    }
  } else {
    cursor = { x, y };
  }
  render();
}

/** Maximal collinear run of the route containing segment `seg` (pts[seg-1]->pts[seg]). */
function wireRunAt(pts, seg) {
  const n = pts.length;
  const i = Math.max(1, Math.min(seg, n - 1));
  const orient = pts[i - 1].y === pts[i].y ? 'h' : 'v';
  const val = orient === 'h' ? pts[i].y : pts[i].x;
  const same = (p) => (orient === 'h' ? p.y === val : p.x === val);
  let lo = i - 1;
  let hi = i;
  while (lo > 0 && same(pts[lo - 1])) lo--;
  while (hi < n - 1 && same(pts[hi + 1])) hi++;
  return { lo, hi, orient, val };
}

/** Move the run [lo..hi] perpendicular by `delta` (world units on grid), keeping all
 *  segments axis-aligned. Neighbours that are fixed keep the run from sliding past
 *  them (no inverted folds). Returns true if anything changed. */
function moveWireRun(pts, run, delta) {
  const lo = run.lo;
  const hi = run.hi;
  const n = pts.length;
  let lower = -Infinity;
  let upper = Infinity;
  const neighborVal = (idx) => (run.orient === 'h' ? pts[idx].y : pts[idx].x);
  if (lo > 0) {
    const nv = neighborVal(lo - 1);
    if (nv < run.val) lower = Math.max(lower, nv);
    else upper = Math.min(upper, nv);
  }
  if (hi < n - 1) {
    const nv = neighborVal(hi + 1);
    if (nv < run.val) lower = Math.max(lower, nv);
    else upper = Math.min(upper, nv);
  }
  if (lower + 40 > upper - 40) return false;
  let raw = snap(run.val + delta);
  raw = Math.max(raw, lower + 40);
  raw = Math.min(raw, upper - 40);
  if (raw === run.val) return false;
  for (let i = lo; i <= hi; i++) {
    if (run.orient === 'h') pts[i].y = raw;
    else pts[i].x = raw;
  }
  return true;
}

function canvasMouseDown(ev) {
  if (document.activeElement === cmdInput) cmdInput.blur();
  const b = ev.button;
  const startWorld = clientToWorld(ev.clientX, ev.clientY);
  const startClient = { x: ev.clientX, y: ev.clientY };

  if (b === 1) {
    ev.preventDefault();
    drag = { mode: 'pan', startClient, startWorld, startView: { ...view }, rubber: null };
    return;
  }
  if (b === 2) {
    ev.preventDefault();
    drag = { mode: 'zoom', startClient, startWorld, moved: false, rubber: null };
    return;
  }
  if (b !== 0) return;

  if (wire) {
    drag = { mode: 'wirepick', startClient, startWorld, rubber: null };
    return;
  }

  const hit = pickAt(startWorld);
  if (hit && circuit.components.has(hit.refdes)) {
    cursor = { x: snap(startWorld.x), y: snap(startWorld.y) };
    if (ev.shiftKey) {
      if (multi.has(hit.refdes)) {
        multi.delete(hit.refdes);
        if (selected === hit.refdes) selected = multi.size ? [...multi][0] : null;
      } else {
        multi.add(hit.refdes);
        if (!selected) selected = hit.refdes;
      }
      render();
      return;
    }
    if (!multi.has(hit.refdes)) setSelection([hit.refdes]);
    const origins = new Map();
    for (const r of multi) {
      const c = circuit.components.get(r);
      if (c) origins.set(r, { x: c.transform.x, y: c.transform.y });
    }
    drag = {
      mode: 'move',
      startClient,
      startWorld,
      startCursor: { ...cursor },
      origins,
      moved: false,
      rubber: null,
    };
    render();
    return;
  }

  // Click/drag a wire: clicking selects its net, dragging edits a route run.
  const wireHit = pickWire(startWorld);
  if (wireHit) {
    const net = wireHit.net;
    if (!net.route || net.route.length < 2) net.route = net.points().slice();
    cursor = { x: snap(startWorld.x), y: snap(startWorld.y) };
    drag = {
      mode: 'wireseg',
      net,
      pts: net.route,
      run: wireRunAt(net.route, wireHit.seg),
      startClient,
      startWorld,
      moved: false,
      committed: false,
      rubber: null,
    };
    render();
    return;
  }

  // Empty space: clear selection, then a drag marquee-selects.
  cursor = { x: snap(startWorld.x), y: snap(startWorld.y) };
  if (!ev.shiftKey) {
    setSelection([]);
    selectedNets.clear();
  }
  drag = { mode: 'marquee', startClient, startWorld, startSelection: new Set(multi), moved: false, rubber: null };
  render();
}

function canvasMouseMove(ev) {
  const w = clientToWorld(ev.clientX, ev.clientY);

  if (!drag) {
    // The cursor follows the mouse, always snapped to the nearest grid point.
    // The view never pans on its own — pan manually with the middle button.
    const nx = snap(w.x);
    const ny = snap(w.y);
    if (nx !== cursor.x || ny !== cursor.y) {
      cursor = { x: nx, y: ny };
      render();
    }
    return;
  }

  const movedOut = Math.abs(ev.clientX - drag.startClient.x) > DRAG_THRESH || Math.abs(ev.clientY - drag.startClient.y) > DRAG_THRESH;

  if (drag.mode === 'pan') {
    // Map the pointer back against the mousedown view (startView) so the pan
    // delta equals the raw pointer movement — no feedback from prior moves.
    const p = clientToWorld(ev.clientX, ev.clientY, drag.startView);
    view.x = drag.startView.x - (p.x - drag.startWorld.x);
    view.y = drag.startView.y - (p.y - drag.startWorld.y);
    render();
    return;
  }

  if (drag.mode === 'zoom' || drag.mode === 'marquee') {
    if (movedOut) drag.moved = true;
    const r = worldRect(drag.startWorld, w);
    drag.rubber = { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1, color: drag.mode === 'zoom' ? '#a06b13' : '#4f9cf9' };
    if (!movedOut) drag.rubber = null;
    render();
    return;
  }

  if (drag.mode === 'wireseg') {
    if (movedOut) drag.moved = true;
    if (drag.moved) {
      if (!drag.committed) {
        drag.committed = true;
        history.push(snapshot());
        if (history.length > 200) history.shift();
        future.length = 0;
      }
      const delta = drag.run.orient === 'h' ? w.y - drag.startWorld.y : w.x - drag.startWorld.x;
      if (moveWireRun(drag.pts, drag.run, delta)) render();
    }
    return;
  }

  if (drag.mode === 'move') {
    if (movedOut) drag.moved = true;
    if (drag.moved) {
      if (!drag.committed) {
        drag.committed = true;
        history.push(snapshot());
        if (history.length > 200) history.shift();
        future.length = 0;
      }
      const dwx = w.x - drag.startWorld.x;
      const dwy = w.y - drag.startWorld.y;
      for (const [r, o] of drag.origins) {
        const c = circuit.components.get(r);
        if (c) circuit.moveComponent(r, snap(o.x + dwx), snap(o.y + dwy));
      }
      cursor = { x: snap(drag.startCursor.x + dwx), y: snap(drag.startCursor.y + dwy) };
    }
    render();
    return;
  }
}

function canvasMouseUp(ev) {
  if (!drag) return;
  const movedOut = Math.abs(ev.clientX - drag.startClient.x) > DRAG_THRESH || Math.abs(ev.clientY - drag.startClient.y) > DRAG_THRESH;
  const w = clientToWorld(ev.clientX, ev.clientY);

  if (drag.mode === 'zoom') {
    if (!drag.moved) {
      zoomOutAt(w);
    } else {
      zoomToWorldRect(worldRect(drag.startWorld, w));
    }
  } else if (drag.mode === 'wireseg') {
    if (!drag.moved) {
      selectedNets = new Set([drag.net.id]);
      render();
      return;
    }
    // dragging moved the route; record the committed state already handled in move
  } else if (drag.mode === 'marquee') {
    if (drag.moved) {
      const box = worldRect(drag.startWorld, w);
      const found = [];
      for (const c of circuit.components.values()) {
        if (rectOverlap(c.bboxWorld(), box)) found.push(c.refdes);
      }
      const nets = [];
      for (const net of circuit.nets.values()) {
        if (netInBox(net, box)) nets.push(net.id);
      }
      if (ev.shiftKey) {
        const set = new Set(drag.startSelection);
        for (const r of found) set.add(r);
        setSelection([...set]);
      } else {
        setSelection(found);
      }
      selectedNets = new Set(nets);
    }
  } else if (drag.mode === 'wirepick') {
    if (!movedOut) doWireClick(snap(w.x), snap(w.y));
  } else if (drag.mode === 'move') {
    if (drag.moved) rerouteAffected([...drag.origins.keys()]);
  }

  drag = null;
  render();
}

canvasEl.addEventListener('mousedown', canvasMouseDown);
canvasEl.addEventListener('mousemove', canvasMouseMove);
window.addEventListener('mouseup', canvasMouseUp);
canvasEl.addEventListener('contextmenu', (ev) => ev.preventDefault());
canvasEl.addEventListener('dragstart', (ev) => ev.preventDefault());

// Mouse wheel: zoom about the pointer (in on scroll-up, out on scroll-down).
canvasEl.addEventListener(
  'wheel',
  (ev) => {
    ev.preventDefault();
    const f = Math.pow(1.0016, ev.deltaY);
    const nw = Math.min(Math.max(view.w * f, 80), 1e6);
    const factor = nw / view.w;
    const w = clientToWorld(ev.clientX, ev.clientY);
    view.x = w.x - (w.x - view.x) * factor;
    view.y = w.y - (w.y - view.y) * factor;
    view.w = nw;
    view.h *= factor;
    render();
  },
  { passive: false }
);

function renderComponents() {
  componentsListEl.innerHTML = '';
  if (circuit.components.size === 0) {
    componentsListEl.innerHTML = '<div class="no-items">No components</div>';
    return;
  }
  for (const comp of sortedComps()) {
    const row = document.createElement('div');
    row.className = 'row' + (multi.has(comp.refdes) ? ' selected' : '');
    row.dataset.ref = comp.refdes;

    const ref = document.createElement('span');
    ref.className = 'ref';
    ref.textContent = comp.refdes;

    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${comp.type}  ${comp.transform.x},${comp.transform.y}  rot${comp.transform.rotation}${
      comp.transform.mirrorX ? ' X' : ''
    }${comp.transform.mirrorY ? ' Y' : ''}`;

    const remove = document.createElement('button');
    remove.className = 'remove';
    remove.textContent = 'Remove';
    remove.title = `Remove ${comp.refdes}`;
    remove.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const touched = netsTouching([comp.refdes]);
      commit(() => {
        circuit.removeComponent(comp.refdes);
        for (const id of touched) {
          const net = circuit.nets.get(id);
          if (net) rerouteNet(net);
        }
        multi.delete(comp.refdes);
        if (selected === comp.refdes) selected = multi.size ? [...multi][0] : null;
      });
      render();
    });

    row.appendChild(ref);
    row.appendChild(meta);
    row.appendChild(remove);

    row.addEventListener('click', () => {
      cursor = { x: comp.transform.x, y: comp.transform.y };
      setSelection([comp.refdes]);
      render();
    });

    componentsListEl.appendChild(row);
  }
}

function renderNets() {
  netsListEl.innerHTML = '';
  if (circuit.nets.size === 0) {
    netsListEl.innerHTML = '<div class="no-items">No nets</div>';
    return;
  }
  for (const net of circuit.nets.values()) {
    const row = document.createElement('div');
    row.className = 'row' + (selectedNets.has(net.id) ? ' selected' : '');

    const ref = document.createElement('span');
    ref.className = 'ref';
    ref.textContent = net.name || net.id;

    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${net.terminals.length} term  ${net.length()}u  ${net.id}`;

    row.appendChild(ref);
    row.appendChild(meta);

    row.addEventListener('click', () => {
      selectedNets = new Set([net.id]);
      const pt = net.points()[Math.floor(net.points().length / 2)];
      if (pt) cursor = { x: pt.x, y: pt.y };
      render();
    });

    netsListEl.appendChild(row);
  }
}

function renderDetail() {
  detailEl.innerHTML = '';
  const comp = selectedComp();
  if (!comp) {
    detailEl.innerHTML = '<div class="no-items">Select a component to see its terminals</div>';
    return;
  }

  const meta = document.createElement('div');
  meta.className = 'detail-meta';
  meta.textContent = `${comp.refdes} (${comp.type})  value: ${comp.value || '-'}  —  wire: press w, then a terminal letter below`;
  detailEl.appendChild(meta);

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Term</th><th>World</th><th>Grid</th><th>Net</th></tr>';
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const t of comp.worldTerminals()) {
    const tr = document.createElement('tr');
    const net = circuit.netOfTerminal(`${comp.refdes}.${t.name}`);

    const nameTd = document.createElement('td');
    nameTd.textContent = t.name;
    nameTd.style.fontWeight = '600';

    const posTd = document.createElement('td');
    posTd.textContent = `${t.x},${t.y}`;

    const gridTd = document.createElement('td');
    const onGrid = t.x % 40 === 0 && t.y % 40 === 0;
    gridTd.textContent = onGrid ? 'ok' : 'NO';
    gridTd.className = onGrid ? 'on-grid' : 'off-grid';

    const netTd = document.createElement('td');
    if (net) {
      netTd.textContent = `N${net.id}${net.name ? ` ${net.name}` : ''}`;
      netTd.className = 'net-label';
    } else {
      netTd.textContent = '—';
      netTd.style.color = 'var(--danger)';
    }

    tr.appendChild(nameTd);
    tr.appendChild(posTd);
    tr.appendChild(gridTd);
    tr.appendChild(netTd);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  detailEl.appendChild(table);
}

const TERM_LETTERS = new Set(['a', 'b', 'c', 'd', 'e', 'g', 'p', 's']);

function onWireKey(key) {
  if (key === 'Escape') {
    wire = null;
    logLine('wiring cancelled');
  } else if (key === 'h') {
    moveCursor(-1, 0);
  } else if (key === 'j') {
    moveCursor(0, 1);
  } else if (key === 'k') {
    moveCursor(0, -1);
  } else if (key === 'l') {
    moveCursor(1, 0);
  } else if (key === 'Tab') {
    cycleSelection(1);
    return;
  } else if (TERM_LETTERS.has(key)) {
    const comp = compUnderCursor() || selectedComp();
    if (!comp) {
      logLine('click a terminal (or point the cursor at a component)');
    } else if (!comp.def.terminals[key]) {
      logLine(`${comp.refdes} has no terminal "${key}" (${Object.keys(comp.def.terminals).join(',')})`);
    } else if (!wire.source) {
      wire.source = { refdes: comp.refdes, term: key };
      logLine(`wire from ${comp.refdes}.${key} — click/type the target terminal`);
    } else if (comp.refdes === wire.source.refdes && key === wire.source.term) {
      logLine('same terminal');
    } else {
      try {
        connectTwo(wire.source, { refdes: comp.refdes, term: key });
      } catch (err) {
        logLine(String(err.message || err));
      }
    }
  }
  render();
}

const PLACEMENT = {
  r: 'resistor',
  c: 'capacitor',
  L: 'inductor',
  d: 'diode',
  n: 'nmos',
  P: 'pmos',
  b: 'npn',
  p: 'pnp',
  g: 'ground',
  s: 'supply',
  i: 'input',
  o: 'output',
  O: 'inputoutput',
  a: 'solder',
};

const INSERT_MOVE = {
  h: [-1, 0],
  j: [0, 1],
  k: [0, -1],
  l: [1, 0],
  ArrowLeft: [-1, 0],
  ArrowDown: [0, 1],
  ArrowUp: [0, -1],
  ArrowRight: [1, 0],
};

function onInsertKey(key) {
  if (PLACEMENT[key]) {
    commit(() => placeAtCursor(PLACEMENT[key]));
    render();
  } else if (INSERT_MOVE[key]) {
    moveCursor(INSERT_MOVE[key][0], INSERT_MOVE[key][1]);
    render();
  } else if (key === 'Escape') {
    mode = 'normal';
    render();
  }
}

function onNormalKey(key) {
  if (/^[0-9]$/.test(key)) {
    counts = counts * 10 + Number(key);
    return;
  }
  const count = counts || 1;
  counts = 0;

  const nudgeKey = {
    h: [-1, 0],
    j: [0, 1],
    k: [0, -1],
    l: [1, 0],
    ArrowLeft: [-1, 0],
    ArrowDown: [0, 1],
    ArrowUp: [0, -1],
    ArrowRight: [1, 0],
  }[key];
  if (nudgeKey) {
    const comps = selectedComps();
    if (comps.length) {
      const dx = nudgeKey[0] * count * 40;
      const dy = nudgeKey[1] * count * 40;
      commit(() => {
        for (const c of comps) circuit.moveComponent(c.refdes, c.transform.x + dx, c.transform.y + dy);
        rerouteAffected(comps.map((c) => c.refdes));
      });
      const primary = comps.find((c) => c.refdes === selected) || comps[0];
      cursor = { x: primary.transform.x, y: primary.transform.y };
    } else {
      moveCursor(nudgeKey[0] * count, nudgeKey[1] * count);
    }
    render();
    return;
  }

  if (key === 'r' || key === 'R') {
    const comps = selectedComps();
    if (!comps.length) {
      logLine('nothing selected to rotate');
    } else {
      const dir = key === 'r' ? 1 : -1;
      commit(() => {
        for (const c of comps) {
          const t = c.transform;
          circuit.setTransform(c.refdes, { rotation: (((t.rotation + dir * 90 * count) % 360) + 360) % 360 });
        }
        rerouteAffected(comps.map((c) => c.refdes));
      });
      render();
    }
    return;
  }

  if (key === 'x' || key === 'X') {
    const comps = selectedComps();
    if (!comps.length) {
      logLine('nothing selected to mirror');
    } else {
      commit(() => {
        for (const c of comps) {
          const t = c.transform;
          if (key === 'x') circuit.setTransform(c.refdes, { mirrorX: !t.mirrorX });
          else circuit.setTransform(c.refdes, { mirrorY: !t.mirrorY });
        }
        rerouteAffected(comps.map((c) => c.refdes));
      });
      render();
    }
    return;
  }

  if (key === 'Enter') {
    const hit = matchAt(cursor.x, cursor.y);
    if (hit) {
      cursor = { x: circuit.components.get(hit.refdes).transform.x, y: circuit.components.get(hit.refdes).transform.y };
      setSelection([hit.refdes]);
      render();
    } else {
      logLine(`${cursor.x},${cursor.y}: nothing here`);
    }
    return;
  }

  if (key === 'y') {
    if (pendingKey && pendingKey.key === 'y' && Date.now() - pendingKey.at < 800) {
      const comp = selectedComp();
      if (comp) {
        clipboard = { type: comp.type, rotation: comp.transform.rotation, mirrorX: comp.transform.mirrorX, mirrorY: comp.transform.mirrorY };
        logLine(`yanked ${comp.refdes} (${comp.type})`);
      } else {
        logLine('nothing selected to yank');
      }
      pendingKey = null;
    } else {
      pendingKey = { key: 'y', at: Date.now() };
    }
    return;
  }

  if (key === 'd') {
    if (pendingKey && pendingKey.key === 'd' && Date.now() - pendingKey.at < 800) {
      const doomed = selectedComps();
      const touched = netsTouching(doomed.map((c) => c.refdes));
      commit(() => {
        for (const c of doomed) circuit.removeComponent(c.refdes);
        for (const id of touched) {
          const net = circuit.nets.get(id);
          if (net) rerouteNet(net);
        }
      });
      setSelection([]);
      selectedNets.clear();
      render();
      pendingKey = null;
    } else {
      pendingKey = { key: 'd', at: Date.now() };
    }
    return;
  }

  if (key === 'p') {
    if (!clipboard) {
      logLine('nothing yanked');
    } else {
      commit(() => {
        const comp = circuit.addComponent(clipboard.type, {
          x: cursor.x,
          y: cursor.y,
          rotation: clipboard.rotation,
          mirrorX: clipboard.mirrorX,
          mirrorY: clipboard.mirrorY,
        });
        setSelection([comp.refdes]);
      });
      render();
    }
    return;
  }

  if (key === 'w') {
    wire = { source: null };
    logLine('wiring: click the SOURCE terminal, then click the TARGET terminal');
    render();
    return;
  }

  if (key === 'i' || key === 'I' || key === 'A') {
    mode = 'insert';
    render();
    return;
  }

  if (key === ':') {
    cmdInput.value = ':';
    cmdInput.focus();
    cmdInput.setSelectionRange(1, 1);
    return;
  }

  if (key === '?') {
    logKeymap();
    return;
  }

  if (key === 'u') {
    undo();
    return;
  }

  if (key === 'Tab') {
    cycleSelection(1);
    return;
  }

  if (key === 'Delete' || key === 'Backspace') {
    const doomed = selectedComps();
    if (doomed.length) {
      const touched = netsTouching(doomed.map((c) => c.refdes));
      commit(() => {
        for (const c of doomed) circuit.removeComponent(c.refdes);
        for (const id of touched) {
          const net = circuit.nets.get(id);
          if (net) rerouteNet(net);
        }
      });
      setSelection([]);
      selectedNets.clear();
      render();
    }
    return;
  }

  if (key === 'F' || key === 'f') {
    fitView();
    return;
  }

  if (key === 'Escape') {
    pendingKey = null;
    setSelection([]);
    selectedNets.clear();
    render();
    return;
  }
}

function logKeymap() {
  logLine(
    [
      '-- normal --',
      'h j k l     move selected comp(s) / cursor (counts: 5l)',
      'r / R       rotate selected 90 cw / ccw',
      'x / X       mirror selected on x / y',
      'dd          delete selected     yy   yank selected',
      'p           paste yanked component at cursor',
      'w           wire (pick terminal letters)',
      'Tab         cycle selection',
      'Ctrl-A      select all components',
      'Enter       select component under cursor',
      'u           undo    Ctrl-R  redo',
      'F / f       fit view to contents',
      'Esc         deselect everything',
      'i           insert mode (place components)',
      ':           ex-mode command line (e.g. :connect R1.a R2.a)',
      '?           this help',
      '-- insert --',
      'h j k l     move cursor between placements (vim home row)',
      'r c L d     resistor capacitor inductor diode',
      'n P b p     nmos pmos npn pnp',
      'g s i o O   ground supply input output inout-io',
      'a           solder dot (junction annotation)',
      'arrows      also move cursor   Esc back to normal',
      '-- mouse --',
      'left        click select · drag marquee-select · drag comp to move',
      'wire        w, then click START terminal, click TARGET terminal',
      'wire drag   click a wire to select it · drag a segment to re-route it',
      'shift-click toggle in selection     shift-drag marquee adds',
      'middle      drag to pan (view never pans on its own)',
      'right       drag = zoom box · right-click = zoom out',
      'wheel       zoom about the pointer (scroll up = in, down = out)',
      'F / f fit   view fills the pane · cursor follows the mouse',
    ].join('\n')
  );
}

// ----- command console ---------------------------------------------------

let clipboard = null;

function runLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return;

  logCommand(trimmed);

  const before = snapshot();
  let result;
  try {
    result = runCommand(circuit, trimmed);
  } catch (err) {
    logLine(String(err.message || err));
    return;
  }

  let output = result ? result.text : '';
  if (result && result.json !== undefined && result.json !== null) {
    output += output ? '\n' : '';
    output += JSON.stringify(result.json);
  }

  if (output) logLine(output);

  if (result && result.mutated) {
    history.push(before);
    if (history.length > 200) history.shift();
    future.length = 0;
    multi = new Set([...multi].filter((r) => circuit.components.has(r)));
    if (!circuit.components.has(selected)) selected = multi.size ? [...multi][0] : null;
  }
  render();
}

// ----- status -------------------------------------------------------------

function renderStatus() {
  const comp = selectedComp();
  const sel = comp ? `${comp.refdes}${multi.size > 1 ? ` +${multi.size - 1}` : ''}` : '-';
  const parts = [mode === 'insert' ? 'INSERT' : 'NORMAL', `sel ${sel}`, `@${cursor.x},${cursor.y}`];
  if (mode === 'insert') {
    parts.push('place r c L d n P b p g s i o O · move h j k l');
  }
  if (wire) {
    parts.push(wire.source ? `WIRE ${wire.source.refdes}.${wire.source.term} ->` : 'WIRE: click a terminal');
  }
  if (selectedNets.size) parts.push(`nets ${selectedNets.size}`);
  statusEl.textContent = parts.join('  ·  ');
  statusEl.className = mode === 'insert' ? 'status insert' : 'status normal';
}

// ----- toolbox -------------------------------------------------------------

function buildPalette() {
  paletteEl.innerHTML = '';
  for (const type of symbolTypeNames) {
    const btn = document.createElement('button');
    btn.textContent = type;
    btn.title = `Place ${type} at the cursor`;
    btn.addEventListener('click', () => {
      commit(() => placeAtCursor(type));
      render();
    });
    paletteEl.appendChild(btn);
  }
}

document.getElementById('btn-demo').addEventListener('click', () => {
  history.push(snapshot());
  future.length = 0;
  circuit = demoCircuit();
  setSelection([]);
  selectedNets.clear();
  cursor = { x: 400, y: 0 };
  fitView();
  logLine('Loaded demo circuit.');
});

document.getElementById('btn-clear').addEventListener('click', () => {
  history.push(snapshot());
  future.length = 0;
  circuit = new Circuit();
  setSelection([]);
  selectedNets.clear();
  cursor = { x: 0, y: 0 };
  view = viewFromCenter(0, 0);
  render();
  logLine('Cleared circuit.');
});

document.getElementById('btn-export').addEventListener('click', () => {
  const svg = svgString(circuit, { grid: true, terminals: true, junctions: true, background: true });
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'schematic.svg';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

document.getElementById('btn-help').addEventListener('click', () => {
  logKeymap();
  logLine('');
  try {
    logLine(commandHelp());
  } catch (err) {
    logLine(String(err.message || err));
  }
});

// ----- keyboard -------------------------------------------------------------

window.addEventListener('keydown', (ev) => {
  const tag = (ev.target && ev.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    if (ev.target === cmdInput && ev.key === 'Escape') {
      cmdInput.value = '';
      cmdInput.blur();
    }
    return;
  }

  if (ev.metaKey || ev.ctrlKey) {
    if (ev.key.toLowerCase() === 'r') {
      ev.preventDefault();
      redo();
    } else if (ev.key.toLowerCase() === 'a') {
      ev.preventDefault();
      setSelection([...circuit.components.keys()]);
      selectedNets.clear();
      render();
    }
    return;
  }

  const key = ev.key;
  if (key.startsWith('F') && /^F\d+$/.test(key)) return;

  if (wire) {
    onWireKey(key);
  } else if (mode === 'insert') {
    onInsertKey(key);
  } else {
    onNormalKey(key);
  }
  ev.preventDefault();
});

cmdInput.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') {
    let line = cmdInput.value.replace(/^:+/, '').trim();
    cmdInput.value = '';
    cmdInput.blur();
    if (line) runLine(line);
  } else if (ev.key === 'Escape') {
    cmdInput.value = '';
    cmdInput.blur();
  }
});

// ----- boot ------------------------------------------------------------

window.__circuit = () => ({
  comps: [...circuit.components.values()].map((c) => ({ refdes: c.refdes, type: c.type, x: c.transform.x, y: c.transform.y, rot: c.transform.rotation, mx: c.transform.mirrorX, my: c.transform.mirrorY })),
  nets: [...circuit.nets.values()].map((net) => ({ id: net.id, terminals: net.terminals.map((t) => t.comp + '.' + t.term), route: net.route, pts: net.points() })),
});

view = viewFromCenter(0, 0);

try {
  buildPalette();
  render();
  logLine('Schematic Spawner ready. Press ? for the keymap. Normal: i to insert, w to wire, u undo.');
} catch (err) {
  const b = banner();
  if (b) {
    b.textContent = `Init failed: ${err && err.message ? err.message : err}`;
    b.classList.add('error');
  }
  throw err;
}
const bb = banner();
if (bb) bb.remove();

const paneEl = document.querySelector('.canvas-pane');
if (paneEl && typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => {
    resizeView();
    render();
  }).observe(paneEl);
}