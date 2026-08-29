/**
 * Schematic Spawner — vim-like keyboard editor.
 *
 * Modes:
 *   NORMAL   h/j/k/l move (selected comp or cursor), r/R rotate, x/X mirror,
 *            dd delete, yy/p copy-paste, w persistent wire mode, Tab cycle, Enter select-at-cursor,
 *            u/Ctrl-Z undo, U/Ctrl-Y/Ctrl-R redo, v visual mode, i insert (fuzzy search), ':' ex-mode, ? keymap.
 *   INSERT   type to fuzzy-search a component/label, Enter picks a ghost, arrows move cursor, Esc back.
 *   VISUAL   hjkl grows a selection box, Enter commits it (like a marquee).
 *   WIRE     terminal letters pick/complete connections.
 */

import { Circuit } from '../core/model.js';
import { getSymbol, symbolTypeNames } from '../core/components/index.js';
import { runCommand, commandHelp } from '../core/commands.js';
import { svgString, editorOverlay } from '../core/render.js';
import { snap, GRID } from '../core/grid.js';
import { applyMarkup } from '../core/model.js';
import { smartRoute } from '../core/router.js';
import { applyDir } from '../core/geometry.js';
import { wireRunAt, moveWireRun } from '../core/wireedit.js';
import { crossNetOverlaps } from '../core/wiring.js';

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
const circuitSelectEl = document.getElementById('circuit-select');
const circuitNameEl = document.getElementById('circuit-name');

// ----- editor state ----------------------------------------------

let circuit = new Circuit();
let mode = 'normal'; // 'normal' | 'insert'
let pendingPlace = null; // insert-mode ghost: { kind:'component', type, rotation, mirrorX, mirrorY } | { kind:'label' }
let selected = null; // primary refdes
let multi = new Set(); // all selected component refdes (always includes selected)
let selLabel = null; // primary id of the selected label object (exclusive with component selection)
let selLabels = new Set(); // all selected label ids (always includes selLabel if any)
let selectedNets = new Set(); // ids of highlighted nets
let selectedWire = null; // primary {netId, branch, segment} of the selected wire segment(s)
let selectedWires = new Set(); // every selected wire segment, as "netId:branch:segment" keys (always includes selectedWire)
let cursor = { x: 0, y: 0 };
let visual = null; // visual mode: anchor grid point {x,y} the selection box starts from
let insertQuery = ''; // insert-mode fuzzy-search string
let wire = null; // { source: {refdes, term} | null, points: [{x,y}] } — a wire being drawn in segments
let counts = 0;
let pendingKey = null; // { key, at } for yy / dd chords
let showGrid = true; // '#' toggles the placement grid
let history = []; // undo stack (JSON blobs)
let future = []; // redo stack
let zoom = 0.7; // px per world unit (a 40-unit cell renders as 28px)
let view = { x: -640, y: -480, w: 1280, h: 960 }; // fixed world window (infinite canvas)
let currentCircuitName = '';
let lastSavedSnapshot = '';
let draftReady = false;
const DRAFT_KEY = 'schematic-spawner:draft';
let remoteConflictLogged = false;
// Cross-net collinear wire overlaps (B4): highlighted spans + status warning.
let netWarnings = []; // [{ key, otherKey, x0, y0, x1, y1 }]
let wiresDirty = true; // set when wire geometry may have changed; recomputes netWarnings

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
  clampViewScale();
  view.x = cx - view.w / 2;
  view.y = cy - view.h / 2;
}

/** Zoom limits: never zoom in so close that a grid cell (40 units) exceeds
 *  ~120px on screen — beyond that the grid-snapped cursor can sit a screen away
 *  from the mouse with no way to bring it back. And never zoom out so far that
 *  the drawn grid line count explodes (keeps the SVG light over a huge canvas). */
function minViewW() {
  const p = paneSize();
  const cellPx = 120;
  return Math.max(p ? (40 * p.w) / cellPx : 320, 320);
}

function maxViewW() {
  return 40 * 1000; // at most ~1000 grid cells across, ~1000 grid lines per axis
}

/** Clamp view.w/h into the zoom range, preserving the center (and aspect). */
function clampViewScale() {
  const min = minViewW();
  const max = maxViewW();
  if (view.w < min || view.w > max) {
    const cx = view.x + view.w / 2;
    const cy = view.y + view.h / 2;
    const nw = Math.min(Math.max(view.w, min), max);
    const f = nw / view.w;
    view.w = nw;
    view.h *= f;
    view.x = cx - view.w / 2;
    view.y = cy - view.h / 2;
  }
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

function persistDraft() {
  if (!draftReady) return;
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      name: currentCircuitName,
      state: circuit.toJSON(),
      savedSnapshot: lastSavedSnapshot,
    }));
  } catch (err) {
    logLine(`Could not preserve browser draft: ${err.message}`, 'error');
  }
}

function restoreDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (!draft || !draft.state) {
      lastSavedSnapshot = snapshot();
      return;
    }
    applyJson(JSON.stringify(draft.state));
    currentCircuitName = draft.name || '';
    circuitNameEl.value = currentCircuitName;
    lastSavedSnapshot = draft.savedSnapshot || snapshot();
  } catch (err) {
    logLine(`Could not restore browser draft: ${err.message}`, 'error');
    lastSavedSnapshot = snapshot();
  }
}

async function refreshCircuitList() {
  try {
    const response = await fetch('/api/circuits', { cache: 'no-store' });
    if (!response.ok) throw new Error(`server returned ${response.status}`);
    const data = await response.json();
    circuitSelectEl.replaceChildren(new Option('Open circuit...', ''));
    for (const name of data.circuits || []) circuitSelectEl.appendChild(new Option(name, name));
    if (currentCircuitName) circuitSelectEl.value = currentCircuitName;
  } catch (err) {
    logLine(`Could not list circuits: ${err.message}`, 'error');
  }
}

async function saveCircuit() {
  const name = circuitNameEl.value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) {
    logLine('Circuit name must start with a letter or number and contain only letters, numbers, _ or -.', 'error');
    circuitNameEl.focus();
    return;
  }
  try {
    const response = await fetch(`/api/circuits/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: circuit.toJSON() }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `server returned ${response.status}`);
    currentCircuitName = name;
    lastSavedSnapshot = snapshot();
    persistDraft();
    await refreshCircuitList();
    logLine(`Saved ${name} (circuit.json and circuit.svg).`);
  } catch (err) {
    logLine(`Could not save circuit: ${err.message}`, 'error');
  }
}

async function loadCircuit(name = circuitSelectEl.value) {
  if (!name) return;
  try {
    const response = await fetch(`/api/circuits/${encodeURIComponent(name)}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `server returned ${response.status}`);
    history.push(snapshot());
    future.length = 0;
    applyJson(JSON.stringify(data.state));
    setSelection([]);
    cursor = { x: 0, y: 0 };
    currentCircuitName = data.name;
    remoteConflictLogged = false;
    circuitNameEl.value = data.name;
    circuitSelectEl.value = data.name;
    lastSavedSnapshot = snapshot();
    fitView();
    render();
    logLine(`Loaded ${data.name}.`);
  } catch (err) {
    logLine(`Could not load circuit: ${err.message}`, 'error');
  }
}

let lastSeenActive = null;
async function syncActiveCircuit() {
  // First, follow the server's "active circuit" — the agent drives it, the browser
  // mirrors it. This lets the user open the page once and watch the agent's work
  // appear automatically, without typing the circuit name or clicking Load.
  // Only auto-load on a CHANGE of the server's active (lastSeenActive), not on
  // every poll where active merely differs from currentCircuitName — otherwise
  // a manual load gets clobbered by the next tick (the user picks "foo", the
  // poll sees active="cmos-inverter" still, reloads cmos-inverter).
  let active = null;
  try {
    const ar = await fetch('/api/active', { cache: 'no-store' });
    if (ar.ok) {
      const data = await ar.json();
      if (typeof data.active === 'string') active = data.active;
    }
  } catch (err) {
    // network blip — keep going with the content sync below
  }
  if (active !== lastSeenActive) {
    lastSeenActive = active;
    if (active && active !== currentCircuitName) {
      await loadCircuit(active);
      return; // loadCircuit already re-rendered + fit
    }
  }
  if (!currentCircuitName) return;
  try {
    const response = await fetch(`/api/circuits/${encodeURIComponent(currentCircuitName)}`, { cache: 'no-store' });
    if (!response.ok) return;
    const data = await response.json();
    const remoteSnapshot = JSON.stringify(data.state);
    if (remoteSnapshot === snapshot()) return;
    if (snapshot() !== lastSavedSnapshot) {
      if (!remoteConflictLogged) {
        logLine(`Remote changes to ${currentCircuitName} were not loaded because this circuit has unsaved local changes.`, 'error');
        remoteConflictLogged = true;
      }
      return;
    }
    applyJson(remoteSnapshot);
    lastSavedSnapshot = remoteSnapshot;
    remoteConflictLogged = false;
    fitView();
    logLine(`Updated ${currentCircuitName} from the live agent session.`);
  } catch {
    // A transient server restart should not interrupt editing.
  }
}

function applyJson(blob) {
  circuit = Circuit.fromJSON(JSON.parse(blob));
  wiresDirty = true; // wire geometry may have changed under any wholesale load
  if (selected && !circuit.components.has(selected)) selected = null;
  multi = new Set([...multi].filter((r) => circuit.components.has(r)));
  if (selLabel && !circuit.labels.has(selLabel)) selLabel = null;
  selLabels = new Set([...selLabels].filter((id) => circuit.labels.has(id)));
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

/**
 * Nearest terminal within a click-tolerant radius of a world point. Wire-mode
 * clicks use this so a slightly-off click on (or near) a pin still starts/ends
 * a wire instead of selecting the component. Tolerance mirrors the wire hit
 * tolerance but at least half a grid cell, so genuine wire-interior clicks
 * (far from any pin) keep working for segment dragging.
 */
function nearestTerminal(w) {
  const p = paneSize();
  const pxPerUnit = p ? view.w / p.w : 1;
  const tol = Math.max(GRID / 2, 12 / pxPerUnit);
  let best = null;
  let bestD = Infinity;
  for (const c of sortedComps()) {
    for (const t of c.worldTerminals()) {
      const d = Math.hypot(t.x - w.x, t.y - w.y);
      if (d < bestD) {
        bestD = d;
        best = { refdes: c.refdes, term: t.name, x: t.x, y: t.y };
      }
    }
  }
  return bestD <= tol ? best : null;
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
  selectedWire = null;
  selectedWires.clear();
  multi = new Set(refs);
  selected = refs.length ? (refs.includes(primary) ? primary : refs[0]) : null;
  if (selected && !circuit.components.has(selected)) selected = null;
  selLabel = null;
  selLabels.clear();
}

/** Replace the label selection. `primary` defaults to the first element. */
function setLabelSelection(ids, primary = ids[0]) {
  selectedWire = null;
  selectedWires.clear();
  selLabels = new Set(ids);
  selLabel = ids.length ? (ids.includes(primary) ? primary : ids[0]) : null;
}

/** Deserialize a "netId:branch:segment" key into {netId, branch, segment}. */
function keyToWire(key) {
  const [netId, branch, segment] = String(key).split(':');
  return { netId, branch: Number(branch), segment: Number(segment) };
}

/** Keep the primary segment pointer consistent with the selection set. */
function syncSelectedWire() {
  const first = selectedWires.values().next().value;
  selectedWire = first ? keyToWire(first) : null;
}

function selectedLabels() {
  return [...selLabels].map((id) => circuit.labels.get(id)).filter(Boolean);
}

function selectedLabel() {
  return selLabel && circuit.labels.has(selLabel) ? circuit.labels.get(selLabel) : null;
}

/** Match a world point against label bboxes (labels draw on top of everything). */
function pickLabel(w) {
  const x = snap(w.x);
  const y = snap(w.y);
  for (const label of circuit.labels.values()) {
    const r = label.bbox();
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return label;
  }
  return null;
}

function selectedComps() {
  const out = [];
  for (const r of multi) {
    const c = circuit.components.get(r);
    if (c) out.push(c);
  }
  return out;
}

/**
 * Rotate every selected component by ±90° increments about its OWN origin.
 * A pure rotation: the origin never moves, so repeated rotations/mirrors never
 * translate the component and always stay on the 40-grid (this matches the CLI
 * `rotate` command). Mirrored/rotated terminals stay on grid because a 90°
 * rotation about an on-grid origin maps grid points to grid points.
 */
function rotateSelectionAbout(deg) {
  const refs = selectedComps().map((c) => c.refdes);
  commit(() => {
    for (const c of selectedComps()) {
      circuit.setTransform(c.refdes, { rotation: (((c.transform.rotation + deg) % 360) + 360) % 360 });
    }
    rerouteTouchedNets(refs, null, true);
  });
}

/**
 * Mirror every selected component about its own vertical (x) or horizontal (y)
 * axis through the origin — a pure reflection that never moves the component's
 * position (matches the CLI `mirror` command). Repeated mirrors are stable.
 */
function mirrorSelectionAbout(axis) {
  const refs = selectedComps().map((c) => c.refdes);
  commit(() => {
    for (const c of selectedComps()) {
      if (axis === 'x') circuit.setTransform(c.refdes, { mirrorX: !c.transform.mirrorX });
      else circuit.setTransform(c.refdes, { mirrorY: !c.transform.mirrorY });
    }
    rerouteTouchedNets(refs, null, true);
  });
}

/** Re-route every net touching the given components (holistic, from terminals).
 *  `moved` (optional) is a Map of refdes -> {dx,dy} so drawn wire shapes are
 *  preserved instead of recomputed when a component is dragged. */
function rerouteTouchedNets(refs, moved, fresh = false) {
  for (const id of netsTouching(refs)) {
    const net = circuit.nets.get(id);
    if (net) rerouteNet(net, fresh ? 'refresh' : moved);
  }
}

/** Delete all selected components and labels together in one undo step.
 *  Owned labels ride along with their component; only free labels are removed explicitly. */
function deleteSelection() {
  if (selectedWire || selectedWires.size) {
    if (selectedWire && !selectedWires.size) selectedWires.add(`${selectedWire.netId}:${selectedWire.branch}:${selectedWire.segment}`);
    const keys = [...selectedWires];
    selectedWire = null;
    selectedWires.clear();
    // Group the deletions by net so every segment is cut against the same
    // (original) branch geometry — indices never shift under one another.
    const byNet = new Map();
    for (const key of keys) {
      const w = keyToWire(key);
      if (!byNet.has(w.netId)) byNet.set(w.netId, []);
      byNet.get(w.netId).push({ branch: w.branch, segment: w.segment });
    }
    commit(() => {
      for (const [netId, segs] of byNet) {
        if (circuit.nets.get(netId)) circuit.deleteWireSegments(netId, segs);
      }
    });
    wiresDirty = true; // wire segments were removed
    selectedNets.clear();
    return true;
  }
  const comps = selectedComps();
  const labels = selectedLabels();
  if (!comps.length && !labels.length && selectedNets.size) {
    const ids = [...selectedNets];
    commit(() => {
      for (const id of ids) circuit.removeNet(id);
      circuit.syncJunctionSolders();
    });
    selectedNets.clear();
    return true;
  }
  if (!comps.length && !labels.length) return false;
  const touched = netsTouching(comps.map((c) => c.refdes));
  commit(() => {
    for (const lab of labels) if (!lab.owner) circuit.removeLabel(lab.id);
    for (const c of comps) circuit.removeComponent(c.refdes);
    for (const id of touched) {
      const net = circuit.nets.get(id);
      if (net) rerouteNet(net);
    }
  });
  setSelection([]);
  setLabelSelection([]);
  selectedNets.clear();
  return true;
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
  tw = Math.min(Math.max(tw, minViewW()), maxViewW());
  th = tw / aspect;
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

/** Place a dedicated label object at the cursor (anchor = cursor), then open the inline editor. */
function placeLabelAtCursor(text = 'label') {
  try {
    const label = circuit.addLabel({ text, x: cursor.x, y: cursor.y, align: 'center' });
    setSelection([]);
    setLabelSelection([label.id]);
    logLine(`placed label "${label.text}" @ (${label.anchor.x},${label.anchor.y})`);
    render();
    inlineEditLabel(label);
  } catch (err) {
    logLine(`Error placing label: ${err.message}`);
  }
}

/**
 * Commit the current insert-mode ghost at the cursor. Stays on the same
 * pendingPlace so the user can place several of the same component in a row.
 */
function placePending() {
  if (!pendingPlace) return;
  if (pendingPlace.kind === 'label') {
    const label = circuit.addLabel({ text: 'label', x: cursor.x, y: cursor.y, align: 'center' });
    setSelection([]);
    setLabelSelection([label.id]);
    logLine(`placed label @ (${label.anchor.x},${label.anchor.y})`);
  } else {
    const comp = circuit.addComponent(pendingPlace.type, {
      x: cursor.x,
      y: cursor.y,
      rotation: pendingPlace.rotation || 0,
      mirrorX: pendingPlace.mirrorX === null ? undefined : pendingPlace.mirrorX,
      mirrorY: pendingPlace.mirrorY === null ? undefined : pendingPlace.mirrorY,
      noLabel: false,
    });
    setSelection([comp.refdes]);
    logLine(`placed ${comp.refdes} (${pendingPlace.type}) @ (${cursor.x},${cursor.y})`);
  }
  render();
}

// ----- render -----------------------------------------------------------

/** Recompute collinear overlaps between different nets' wires (B4). Runs only
 *  when `wiresDirty` says the wire geometry changed since the last frame. */
function updateNetWarnings() {
  const nets = [...circuit.nets.values()].map((n) => ({ id: n.id, paths: n.paths() }));
  netWarnings = crossNetOverlaps(nets);
}

function render() {
  if (wiresDirty) {
    updateNetWarnings();
    wiresDirty = false;
  }
  persistDraft();
  renderCanvas();
  renderComponents();
  renderNets();
  renderDetail();
  renderStatus();
  updateInsertMenu();
  if (window.__app) {
    window.__app.renders.push({ t: performance.now(), view: { ...view } });
    if (window.__app.renders.length > 500) window.__app.renders.shift();
  }
}

function renderCanvas() {
  const wirePreview =
    wire && wire.source
      ? (() => {
          const from = wireOrigin(wire.source);
          if (!from) return undefined;
          // The draft wire being built: the accumulated click-through segments
          // plus the live segment to the cursor. The final leg to the cursor is
          // suggested by the router so it bends cleanly around bodies.
          const base = [from, ...(wire.points || [])];
          const tail = smartRoute(base[base.length - 1], cursor, netEnv());
          const pts = [...base, ...tail.slice(1)];
          return { from, to: cursor, pts };
        })()
      : undefined;

  let svg = svgString(circuit, {
    grid: showGrid,
    terminals: false,
    junctions: false,
    background: true,
    viewport: { x: view.x, y: view.y, w: view.w, h: view.h },
  });
  const nets = selectedWire ? [] : [...selectedNets].map((id) => circuit.nets.get(id)).filter(Boolean);
  // Solder dots sitting on a highlighted net's junction points get a halo so
  // wire junctions on the net stand out (device bodies are deliberately NOT
  // highlighted — only wires + solder dots belong to a net's visual).
  const netSolder = [];
  const solders = new Map();
  for (const c of circuit.components.values()) {
    if (c.type === 'solder') solders.set(`${c.transform.x},${c.transform.y}`, c);
  }
  for (const net of nets) {
    for (const j of net.junctions) {
      if (solders.has(`${j.x},${j.y}`)) netSolder.push({ x: j.x, y: j.y });
    }
  }
  const ghost =
    mode === 'insert' && pendingPlace
      ? pendingPlace.kind === 'label'
        ? { label: true, x: cursor.x, y: cursor.y }
        : (() => {
            try {
              const def = getSymbol(pendingPlace.type);
              return {
                def,
                x: cursor.x,
                y: cursor.y,
                rotation: pendingPlace.rotation || 0,
                mirrorX: pendingPlace.mirrorX !== null ? pendingPlace.mirrorX : !!def.defaultMirrorX,
                mirrorY: pendingPlace.mirrorY !== null ? pendingPlace.mirrorY : !!def.defaultMirrorY,
              };
            } catch {
              return undefined;
            }
          })()
      : undefined;
  const overlay = editorOverlay(circuit, {
    cursor,
    selection: [...multi],
    wireSegments: (() => {
      if (!selectedWires.size && !selectedWire) return [];
      const keys = selectedWires.size ? [...selectedWires] : [`${selectedWire.netId}:${selectedWire.branch}:${selectedWire.segment}`];
      const out = [];
      for (const key of keys) {
        const w = keyToWire(key);
        const n = circuit.nets.get(w.netId);
        const p = n?.paths()?.[w.branch];
        if (p?.[w.segment]) out.push({ a: p[w.segment - 1], b: p[w.segment] });
      }
      return out;
    })(),
    selLabel,
    selLabels: [...selLabels],
    nets,
    netSolder: [...netSolder],
    warnOverlaps: netWarnings,
    rubber: visual
      ? { x0: Math.min(visual.x, cursor.x), y0: Math.min(visual.y, cursor.y), x1: Math.max(visual.x, cursor.x), y1: Math.max(visual.y, cursor.y), color: '#2e7d32' }
      : drag && drag.rubber
        ? drag.rubber
        : undefined,
    wirePreview,
    wireMode: !!wire,
    wireSource: wire && wire.source ? { ...wire.source } : undefined,
    ghost,
  });
  svg = svg.replace('</svg>', `${overlay}\n</svg>`);
  canvasEl.innerHTML = svg;
  canvasEl.classList.toggle('wire-mode', !!wire);
}

// ----- mouse ------------------------------------------------------------

const DRAG_THRESH = 6; // px before a press becomes a drag
let drag = null;
let inlineInput = null; // the active inline-edit <input>, if any
let lastLabelClick = null; // { id, x, y, at } of the previous label click (for double-click fallback)
let lastWireClick = null; // { key, x, y, at } of the previous wire click (for double-click fallback)
let lastNetClick = null; // { netId, x, y, at } of the previous nets-list click (for double-click fallback)

/** A press becomes a drag once the pointer has moved BOTH more than the pixel
 *  threshold (a few px of click jitter is never a drag) AND more than half a
 *  grid cell in world units (zoom-independent — at any zoom a click that stays
 *  within a cell is a plain click, never a drag). */
function dragMoved(startWorld, startClient, w, ev) {
  const world = Math.hypot(w.x - startWorld.x, w.y - startWorld.y);
  const client = Math.hypot(ev.clientX - startClient.x, ev.clientY - startClient.y);
  return world > GRID / 2 && client > DRAG_THRESH;
}

/** Abort an in-progress mouse drag. A cancelled wire run is restored to its
 *  pre-drag polyline so nothing is left half-edited. */
function cancelDrag() {
  if (drag && drag.mode === 'wireseg') {
    for (const r of drag.runs || []) {
      if (r.branch !== undefined && r.net.branches && r.net.branches[r.branch]) {
        r.net.branches[r.branch] = r.orig.map((p) => ({ ...p }));
        if (r.branch === 0) r.net.route = r.net.branches[0].map((p) => ({ ...p }));
      } else if (r.hadRoute) {
        r.net.route = r.orig.map((p) => ({ ...p }));
      } else {
        r.net.route = null;
      }
    }
  }
  drag = null;
  render();
}

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

function worldToClient(wx, wy, refView = view) {
  const pane = document.querySelector('.canvas-pane');
  const r = pane.getBoundingClientRect();
  return {
    x: r.left + ((wx - refView.x) / refView.w) * r.width,
    y: r.top + ((wy - refView.y) / refView.h) * r.height,
  };
}

function worldRect(a, b) {
  return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
}

/** True when rect `r` lies COMPLETELY inside `box` (touching an edge counts
 *  as inside). Marquee selection uses containment, not mere intersection, so
 *  a box only captures whole objects. */
function rectContained(r, box) {
  return r.x >= box.x0 && r.x + r.w <= box.x1 && r.y >= box.y0 && r.y + r.h <= box.y1;
}

/** Select everything COMPLETELY inside a world box (components by bbox, labels
 *  by bbox, nets by route). With `shift` the box adds to the current selection.
 *  Shared by the mouse marquee and visual-mode Enter. */
function applyBoxSelection(x0, y0, x1, y1, shift) {
  const box = worldRect({ x: x0, y: y0 }, { x: x1, y: y1 });
  const found = [];
  for (const c of circuit.components.values()) {
    if (rectContained(c.bboxWorld(), box)) found.push(c.refdes);
  }
  const foundLabels = [];
  for (const label of circuit.labels.values()) {
    if (rectContained(label.bbox(), box)) foundLabels.push(label.id);
  }
  const nets = [];
  for (const net of circuit.nets.values()) {
    if (netInBox(net, box)) nets.push(net.id);
  }
  if (shift) {
    const set = new Set(multi);
    for (const r of found) set.add(r);
    setSelection([...set]);
    const labSet = new Set(selLabels);
    for (const id of foundLabels) labSet.add(id);
    setLabelSelection([...labSet]);
  } else {
    setSelection(found);
    setLabelSelection(foundLabels);
  }
  selectedNets = new Set(nets);
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

/** Pick the nearest net route within a forgiving screen-sized hit area.
 *  Considers EVERY drawn branch of a multi-way net, so a joined/connected wire
 *  is selectable and draggable anywhere along it. */
function pickWire(w) {
  const p = paneSize();
  const pxPerUnit = p ? view.w / p.w : 1;
  const tol = 12 / pxPerUnit;
  const snapped = { x: snap(w.x), y: snap(w.y) };
  let best = null;
  let bestD = tol;
  for (const net of circuit.nets.values()) {
    const paths = net.paths();
    for (let bi = 0; bi < paths.length; bi++) {
      const pts = paths[bi];
      for (let i = 1; i < pts.length; i++) {
        const d = Math.min(
          distToSegment(w.x, w.y, pts[i - 1], pts[i]),
          distToSegment(snapped.x, snapped.y, pts[i - 1], pts[i]),
        );
        if (d < bestD) {
          bestD = d;
          best = { net, branch: bi, seg: i, pts };
        }
      }
    }
  }
  return best;
}

/** Does the net's ENTIRE route lie inside the box? (Marquee selection only
 *  captures nets whose every drawn branch point is inside.) */
function netInBox(net, box) {
  const inside = (x, y) => x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1;
  const paths = net.paths();
  if (paths.length === 0) return false;
  for (const pts of paths) {
    for (const p of pts) if (!inside(p.x, p.y)) return false;
  }
  return true;
}

function zoomOutAt(w) {
  const f = 1.35;
  const nw = Math.min(view.w * f, maxViewW());
  const factor = nw / view.w;
  view.x = w.x - (w.x - view.x) * factor;
  view.y = w.y - (w.y - view.y) * factor;
  view.w = nw;
  view.h *= factor;
}

function zoomToWorldRect(r) {
  const pad = 60;
  const aspect = view.w / view.h;
  let tw = r.x1 - r.x0 + pad * 2;
  let th = r.y1 - r.y0 + pad * 2;
  if (tw / th > aspect) th = tw / aspect;
  else tw = th * aspect;
  tw = Math.min(Math.max(tw, minViewW()), maxViewW());
  th = tw / aspect;
  view.w = tw;
  view.h = th;
  view.x = (r.x0 + r.x1) / 2 - tw / 2;
  view.y = (r.y0 + r.y1) / 2 - th / 2;
}

// ----- wire segment editing (see src/core/wireedit.js) ----------------------
// wireRunAt, collapseCollinear, findRunLine, moveWireRun are pure polyline
// helpers imported from src/core/wireedit.js (unit tested there).

// ----- smart net routing ----------------------------------------------------

/** Outward direction from a component body toward a world terminal pin. Uses the
 *  terminal's explicit local direction (honoring the component transform) when
 *  present, otherwise infers it from the terminal's position vs the bbox centre. */
function pinDir(c, t, wx, wy) {
  if (t.dir) {
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

/** Routing environment for smartRoute: component bboxes, pin directions, other wires. */
function netEnv(excludeNetId = null) {
  const rects = [];
  const pins = new Map();
  for (const c of circuit.components.values()) {
    if (c.type === 'solder') continue;
    rects.push(c.bboxWorld());
    for (const t of c.def.terminals) {
      const w = c.terminalWorld(t.name);
      pins.set(`${w.x},${w.y}`, pinDir(c, t, w.x, w.y));
    }
  }
  const wires = [];
  for (const n of circuit.nets.values()) {
    if (n.id === excludeNetId) continue;
    wires.push(...n.paths());
  }
  return { rects, pins, wires };
}

/** Recompute the explicit route of a net (pairwise through its terminals in order). */
function rerouteNet(net, moved) {
  circuit.rerouteNet(net, moved);
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

/** Connect two terminals, re-route the resulting net, commit history once.
 *  All branch splicing and solder-dot derivation happens in Circuit#wireTo so
 *  the geometry is always orthogonal, split correctly, and carries exactly one
 *  dot per real junction. */
function connectTwo(src, dst, points) {
  const before = snapshot();
  const meet = circuit.components.get(dst.refdes).terminalWorld(dst.term);
  const net = circuit.wireTo(`${src.refdes}.${src.term}`, meet, points);
  wiresDirty = true; // wireTo grew / spliced a net
  history.push(before);
  future.length = 0;
  // Stay in wiring mode so the next click can start another connection.
  wire = { source: null, points: [] };
  selectedNets = new Set([net.id]);
  setSelection([dst.refdes]);
  logLine(`net ${net.id}: ${net.terminals.map((t) => `${t.comp}.${t.term}`).join('  ')}; len=${net.length()}`);
}

/** World point of a wire source: a component terminal or a free point. */
function wireOrigin(src) {
  if (!src) return null;
  if (src.refdes) {
    const comp = circuit.components.get(src.refdes);
    return comp ? comp.terminalWorld(src.term) : null;
  }
  return { x: src.x, y: src.y };
}

/** Grid-snapped projection of `w` onto the nearest segment of `net`'s drawn
 *  route. Returns { P, k, route } — P the snapped projection, k the route
 *  segment index it falls on, route the net's drawn polyline. */
function projectOnNet(net, w, branch = 0) {
  const route = net.paths()[branch] || [];
  const snapped = { x: snap(w.x), y: snap(w.y) };
  let P = snapped;
  let k = -1;
  let bestD = Infinity;
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i];
    const b = route[i + 1];
    const proj = a.x === b.x
      ? { x: a.x, y: Math.max(Math.min(a.y, b.y), Math.min(Math.max(a.y, b.y), snapped.y)) }
      : { x: Math.max(Math.min(a.x, b.x), Math.min(Math.max(a.x, b.x), snapped.x)), y: a.y };
    const sp = { x: snap(proj.x), y: snap(proj.y) };
    const d = Math.hypot(sp.x - snapped.x, sp.y - snapped.y);
    if (d < bestD) {
      bestD = d;
      P = sp;
      k = i;
    }
  }
  return { P, k, route };
}

function doWireClick(x, y, terminalHit) {
  const hit = terminalHit || matchAt(x, y);
  if (hit && hit.term) {
    if (!wire.source) {
      wire.source = { refdes: hit.refdes, term: hit.term };
      wire.points = [];
      cursor = { x: hit.x ?? x, y: hit.y ?? y };
      logLine(`wire from ${hit.refdes}.${hit.term} — click points, then click/Enter on the target`);
    } else if (hit.refdes === wire.source.refdes && hit.term === wire.source.term) {
      logLine('same terminal — click the other terminal');
    } else {
      try {
        connectWireToTerminal(hit);
      } catch (err) {
        logLine(String(err.message || err));
      }
    }
  } else if (wire.source) {
    // Build the wire in segments: each empty-space click appends a bend point.
    wire.points.push({ x, y });
    cursor = { x, y };
    logLine(`wire segment @ (${x},${y}) — click more points or commit`);
  } else {
    // Starting a wire needs no terminal: click any grid point (or a wire) and
    // the draft grows from there.
    startWireAt({ x, y });
  }
  render();
}

/** Begin a wire from a non-terminal point: empty space starts a free-floating
 *  draft; a point on an existing wire records that net as the origin (the
 *  junction + solder are materialized on commit so a cancelled wire leaves no
 *  orphan dot). */
function startWireAt(w) {
  const wireHit = pickWire(w);
  if (wireHit) {
    const { P, k } = projectOnNet(wireHit.net, w, wireHit.branch);
    if (k < 0) {
      logLine('no junction point on that wire');
      return;
    }
    wire.source = { x: P.x, y: P.y, netId: wireHit.net.id };
    wire.points = [];
    cursor = { x: P.x, y: P.y };
    logLine(`wire from net ${wireHit.net.id} @ (${P.x},${P.y}) — click points, then click/Enter on a target`);
  } else {
    wire.source = { x: snap(w.x), y: snap(w.y) };
    wire.points = [];
    cursor = { x: snap(w.x), y: snap(w.y) };
    logLine('wire from a free point — click points, then click/Enter on a target');
  }
}

/** Pressing Enter in wire mode commits the draft wire at the cursor: onto a
 *  component terminal (connect) or onto another wire (join nets + solder). */
function commitWireAtCursor() {
  if (!wire || !wire.source) {
    logLine('start a wire by clicking a terminal (or any point) first');
    return;
  }
  const hit = nearestTerminal(cursor);
  if (hit) {
    try {
      connectWireToTerminal(hit);
    } catch (err) {
      logLine(String(err.message || err));
    }
    render();
    return;
  }
  const wireHit = pickWire(cursor);
  if (wireHit) {
    joinWireToNet(wireHit);
    render();
    return;
  }
  logLine('point the cursor at a terminal or a wire to commit (Esc cancels)');
}

/** Commit the draft wire onto a component terminal. Terminal-origin wires go
 *  through connectTwo; free-point / on-wire-origin drafts splice into the
 *  target net without disturbing its existing wire. */
function connectWireToTerminal(dst) {
  const src = wire.source;
  if (src.refdes) {
    connectTwo(src, dst, wire.points);
    return;
  }
  const before = snapshot();
  const end = circuit.components.get(dst.refdes).terminalWorld(dst.term);
  const net = circuit.wirePointTo({ x: src.x, y: src.y }, end, wire.points, src.netId);
  wiresDirty = true; // a draft spliced into the target net
  history.push(before);
  future.length = 0;
  wire = { source: null, points: [] };
  selectedNets = new Set([net.id]);
  logLine(`wired into net ${net.id} at ${dst.refdes}.${dst.term}; len=${net.length()}`);
}

/** Join the draft wire into an existing net at the cursor's point on that net's
 *  route. Junction solder dots are derived from the resulting geometry. */
function joinWireToNet(wireHit) {
  const src = wire.source;
  const { P, k } = projectOnNet(wireHit.net, cursor, wireHit.branch);
  if (k < 0) {
    logLine('no junction point on that wire');
    return;
  }
  if (src.refdes) {
    const srcNet = circuit.netOfTerminal(`${src.refdes}.${src.term}`);
    if (srcNet && srcNet.id === wireHit.net.id) {
      logLine('already the same net');
      return;
    }
  }
  const before = snapshot();
  const net = src.refdes
    ? circuit.wireTo(`${src.refdes}.${src.term}`, P, wire.points)
    : circuit.wirePointTo({ x: src.x, y: src.y }, P, wire.points, src.netId);
  wiresDirty = true; // a draft joined into an existing net
  history.push(before);
  future.length = 0;
  wire = { source: null, points: [] };
  selectedNets = new Set([net.id]);
  logLine(`joined into net ${net.id} at (${P.x},${P.y})`);
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
    // In persistent wiring mode, terminal/empty-space clicks pick wire ends;
    // an interior wire click must remain available for segment dragging.
    // Terminal proximity (not just an exact grid hit) always wins, so a slightly
    // off click on a pin starts/ends the wire instead of selecting the body.
    const terminalHit = nearestTerminal(startWorld);
    const wireHit = pickWire(startWorld);
    if (terminalHit || !wireHit) {
      drag = { mode: 'wirepick', startClient, startWorld, rubber: null, terminalHit: terminalHit || null };
      return;
    }
  }

  // Insert mode with a ghost selected: a left-click places the ghost at the
  // snapped cursor and stays on the same component so more can be placed.
  if (mode === 'insert' && pendingPlace) {
    cursor = { x: snap(startWorld.x), y: snap(startWorld.y) };
    commit(() => placePending());
    return;
  }

  // Labels draw on top of everything: picking one selects/drags it first.
  const labelHit = pickLabel(startWorld);
  if (labelHit) {
    const a = labelHit.anchorWorld();
    cursor = { x: snap(a.x), y: snap(a.y) };
    // Second click of a double-click: open the inline editor. It's deferred with
    // setTimeout so focus is set AFTER the mousedown->mouseup completes — opening
    // and focusing an <input> in the middle of the click sequence lets the
    // following mouseup (and its document blur) immediately close the editor.
    if (ev.detail >= 2) {
      lastLabelClick = null;
      setSelection([]);
      setLabelSelection([labelHit.id]);
      render();
      setTimeout(() => inlineEditLabel(labelHit), 0);
      return;
    }
    // Manual double-click detection (timing + position) as a fallback for
    // environments that don't set ev.detail (some headless drivers).
    const prev = lastLabelClick;
    lastLabelClick = { id: labelHit.id, x: startWorld.x, y: startWorld.y, at: Date.now() };
    if (
      prev &&
      prev.id === labelHit.id &&
      Date.now() - prev.at < 500 &&
      Math.abs(startWorld.x - prev.x) <= GRID &&
      Math.abs(startWorld.y - prev.y) <= GRID
    ) {
      lastLabelClick = null;
      setSelection([]);
      setLabelSelection([labelHit.id]);
      render();
      setTimeout(() => inlineEditLabel(labelHit), 0);
      return;
    }
    if (ev.shiftKey) {
      if (selLabels.has(labelHit.id)) {
        selLabels.delete(labelHit.id);
        if (selLabel === labelHit.id) selLabel = selLabels.size ? [...selLabels][0] : null;
      } else {
        selLabels.add(labelHit.id);
        if (!selLabel) selLabel = labelHit.id;
      }
      setSelection([]);
      setLabelSelection([...selLabels]);
      render();
      return;
    }
    setSelection([]);
    setLabelSelection([labelHit.id]);
    const startAnchors = new Map();
    for (const id of selLabels) {
      const l = circuit.labels.get(id);
      if (l) startAnchors.set(id, { x: l.anchorWorld().x, y: l.anchorWorld().y });
    }
    drag = {
      mode: 'labelmove',
      labelId: labelHit.id,
      startClient,
      startWorld,
      startAnchors,
      moved: false,
      committed: false,
      rubber: null,
    };
    render();
    return;
  }
  // Clicking anywhere that isn't a label resets any pending double-click state.
  lastLabelClick = null;
  lastWireClick = null;

  // Wires render on top of component bodies, so a wire running along/inside a
  // body must be pickable first. Hit order: exact TERMINAL, then WIRE, then
  // component bbox, then empty space.
  const hit = pickAt(startWorld);
  const termHit = hit && hit.term ? hit : null;
  if (termHit) {
    beginComponentDrag(hit, startWorld, startClient, ev);
    return;
  }

  // Click/drag a wire: clicking selects its net, dragging edits a route run.
  const wireHit = pickWire(startWorld);
  if (wireHit) {
    const net = wireHit.net;
    // The run is found from the drawn polyline (a specific branch for joined
    // nets), materialized into a local array so a plain click never mutates the
    // net — only an actual drag attaches a route (and Escape restores `orig`).
    const key = `${net.id}:${wireHit.branch}:${wireHit.seg}`;
    // Double-click a wire selects its NET (the segment selection is replaced).
    // Headless CDP never fires a native `dblclick`, so detect the second press
    // here on the mousedown (ev.detail) with the same manual timing/position
    // fallback the labels use; the browser `dblclick` handler stays as backup.
    const now = Date.now();
    const prevWireClick = lastWireClick;
    lastWireClick = { key, x: startWorld.x, y: startWorld.y, at: now };
    if (
      ev.detail >= 2 ||
      (prevWireClick &&
        prevWireClick.key === key &&
        now - prevWireClick.at < 500 &&
        Math.abs(startWorld.x - prevWireClick.x) <= GRID &&
        Math.abs(startWorld.y - prevWireClick.y) <= GRID)
    ) {
      selectedWire = null;
      selectedWires.clear();
      selectedNets = new Set([net.id]);
      cursor = { x: snap(startWorld.x), y: snap(startWorld.y) };
      render();
      return;
    }
    // Shift+click (or clicking a segment already in the selection) drags every
    // selected segment's run together; a plain click on an unselected segment
    // drags only that run (the selection resets on mouseup).
    const moveKeys = ev.shiftKey || selectedWires.has(key)
      ? new Set([...selectedWires, key])
      : new Set([key]);
    const runs = [];
    const seenRun = new Set();
    for (const k of moveKeys) {
      const w = keyToWire(k);
      const n = circuit.nets.get(w.netId);
      if (!n) continue;
      const pts = n.branches && n.branches[w.branch] && n.branches[w.branch].length >= 2
        ? n.branches[w.branch]
        : n.route && n.route.length >= 2 ? n.route : n.points().slice();
      const run = wireRunAt(pts, w.segment);
      const runKey = `${k}:${run.orient}:${run.val}`;
      if (seenRun.has(runKey)) continue; // same maximal run, don't move twice
      seenRun.add(runKey);
      runs.push({
        net: n,
        branch: w.branch,
        seg: w.segment,
        pts,
        orig: pts.map((p) => ({ ...p })),
        orient: run.orient,
        line: run.val,
        startLine: run.val,
        hadRoute: !!(n.route && n.route.length >= 2),
      });
    }
    const primary = runs.find((r) => r.net === net && r.branch === wireHit.branch && r.seg === wireHit.seg) || runs[0];
    // Only runs perpendicular to the drag direction can move together (a drag
    // shifts a run sideways). Same-orientation runs move as a group; selected
    // runs of the other orientation stay put (still selected, still deletable).
    const dragRuns = runs.filter((r) => r.orient === primary.orient);
    cursor = { x: snap(startWorld.x), y: snap(startWorld.y) };
    drag = {
      mode: 'wireseg',
      net,
      branch: primary.branch,
      seg: primary.seg,
      pts: primary.pts,
      orig: primary.orig,
      runs: dragRuns,
      orient: primary.orient,
      line: primary.line,
      startAxis: primary.orient === 'h' ? startWorld.y : startWorld.x,
      startLine: primary.startLine,
      startClient,
      startWorld,
      shift: ev.shiftKey,
      key,
      moved: false,
      committed: false,
      rubber: null,
      startSnapshot: snapshot(),
    };
    render();
    return;
  }

  // A component bbox hit (no exact terminal, no wire over it): select/drag it.
  if (hit && circuit.components.has(hit.refdes)) {
    beginComponentDrag(hit, startWorld, startClient, ev);
    return;
  }

  // Empty space: clear selection, then a drag marquee-selects.
  cursor = { x: snap(startWorld.x), y: snap(startWorld.y) };
  if (!ev.shiftKey) {
    setSelection([]);
    selectedNets.clear();
  }
  drag = { mode: 'marquee', startClient, startWorld, startSelection: new Set(multi), startLabelSelection: new Set(selLabels), moved: false, rubber: null };
  render();
}

/** Select the component (or shift-toggle the multi-selection) and arm a move
 *  drag. Shared by exact-terminal hits and bbox fallback picks. */
function beginComponentDrag(hit, startWorld, startClient, ev) {
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
  const refs = [...origins.keys()];
  // If labels are part of the same selection, move them along with the components.
  const labelOrigins = new Map();
  for (const id of selLabels) {
    const l = circuit.labels.get(id);
    if (l) labelOrigins.set(id, { x: l.anchorWorld().x, y: l.anchorWorld().y });
  }
  drag = {
    mode: 'move',
    startClient,
    startWorld,
    startCursor: { ...cursor },
    origins,
    netRoutes: null,
    labelOrigins,
    moved: false,
    rubber: null,
  };
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

  const movedOut = dragMoved(drag.startWorld, drag.startClient, w, ev);

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
      cursor = { x: snap(w.x), y: snap(w.y) };
      if (!drag.committed) {
        drag.committed = true;
        // The drag owns each run's polyline: attach copies to their nets so the
        // live edit renders; branch/route arrays are already live in the model.
        for (const r of drag.runs) {
          if (r.net.branches && r.net.branches[r.branch]) r.net.branches[r.branch] = r.pts;
          else r.net.route = r.pts;
        }
      }
      const axis = drag.orient === 'h' ? w.y : w.x;
      const delta = axis - drag.startAxis;
      for (const r of drag.runs) {
        const target = r.startLine + delta;
        r.line = moveWireRun(r.pts, r.orient, r.line, target);
      }
      wiresDirty = true; // live re-route changes wire geometry every frame
      render();
    }
    return;
  }

if (drag.mode === 'labelmove') {
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
      for (const [id, sa] of drag.startAnchors) {
        const label = circuit.labels.get(id);
        if (label) label.moveTo(sa.x + dwx, sa.y + dwy);
      }
      const primary = circuit.labels.get(drag.labelId);
      if (primary) {
        const a = primary.anchorWorld();
        cursor = { x: a.x, y: a.y };
      }
    }
    render();
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
        // Capture the touched nets' wire geometry once. Every subsequent frame
        // re-anchors from this snapshot with the cumulative drag delta, so a
        // long, circular drag can never accumulate new segments.
        drag.netRoutes = new Map();
        for (const id of netsTouching([...drag.origins.keys()])) {
          const net = circuit.nets.get(id);
          if (!net) continue;
          drag.netRoutes.set(id, {
            route: net.route ? net.route.map((p) => ({ ...p })) : null,
            branches: net.branches ? net.branches.map((b) => b.map((p) => ({ ...p }))) : null,
          });
        }
      }
      const dwx = w.x - drag.startWorld.x;
      const dwy = w.y - drag.startWorld.y;
      const moved = new Map();
      for (const [r, o] of drag.origins) {
        const c = circuit.components.get(r);
        if (!c) continue;
        const nx = snap(o.x + dwx);
        const ny = snap(o.y + dwy);
        circuit.moveComponent(r, nx, ny);
        moved.set(r, { dx: nx - o.x, dy: ny - o.y });
      }
      // Free labels selected alongside components follow the drag (owned labels
      // already track their component's transform).
      if (drag.labelOrigins) {
        for (const [id, o] of drag.labelOrigins) {
          const l = circuit.labels.get(id);
          if (l && !l.owner) l.moveTo(o.x + dwx, o.y + dwy);
        }
      }
      // Restore the pre-drag wire geometry and re-anchor from it with the total
      // delta, so wires follow the component without accumulating or detaching.
      for (const [id, snap] of drag.netRoutes || []) {
        const net = circuit.nets.get(id);
        if (!net) continue;
        net.route = snap.route ? snap.route.map((p) => ({ ...p })) : null;
        net.branches = snap.branches ? snap.branches.map((b) => b.map((p) => ({ ...p }))) : null;
        rerouteNet(net, moved);
      }
      cursor = { x: snap(drag.startCursor.x + dwx), y: snap(drag.startCursor.y + dwy) };
    }
    render();
    return;
  }
}

function canvasMouseUp(ev) {
  if (!drag) return;
  const movedOut = dragMoved(drag.startWorld, drag.startClient, clientToWorld(ev.clientX, ev.clientY), ev);
  const w = clientToWorld(ev.clientX, ev.clientY);

  if (drag.mode === 'zoom') {
    if (!drag.moved) {
      zoomOutAt(w);
    } else {
      zoomToWorldRect(worldRect(drag.startWorld, w));
    }
  } else if (drag.mode === 'wireseg') {
    const anyMoved = drag.runs.some((r) => JSON.stringify(r.pts) !== JSON.stringify(r.orig));
    if (!drag.moved || !anyMoved) {
      // A plain click (or a jittery gesture that never actually moved a run):
      // select the segment(s) and leave every polyline exactly as it was.
      for (const r of drag.runs) {
        if (r.branch !== undefined && r.net.branches && r.net.branches[r.branch]) {
          r.net.branches[r.branch] = r.orig.map((p) => ({ ...p }));
          if (r.branch === 0) r.net.route = r.net.branches[0].map((p) => ({ ...p }));
        } else if (!r.hadRoute) {
          r.net.route = null; // don't materialize a route on a click
        }
      }
      selectedNets.clear();
      if (drag.shift) {
        if (selectedWires.has(drag.key)) selectedWires.delete(drag.key);
        else selectedWires.add(drag.key);
        syncSelectedWire();
      } else {
        selectedWires = new Set([drag.key]);
        selectedWire = keyToWire(drag.key);
      }
      drag = null; // a click never leaves a drag armed (a bare mousemove would re-drag the run)
      render();
      return;
    }
    // The drag re-routed the runs live. Persist each run back to its net — for
    // branch nets the live-edit only updated the local pts array, so without
    // this write the model stays stale. Then reroute + reduce so each dragged
    // run reconnects cleanly to its terminal(s) and any run dragged onto a
    // same-net wire merges instead of hiding beneath it.
    for (const r of drag.runs) {
      if (r.branch !== undefined && r.net.branches && r.net.branches[r.branch]) {
        r.net.branches[r.branch] = r.pts.map((p) => ({ ...p }));
        if (r.branch === 0) r.net.route = r.net.branches[0].map((p) => ({ ...p }));
      } else {
        r.net.route = r.pts.map((p) => ({ ...p }));
      }
    }
    const touchedNets = new Set(drag.runs.map((r) => r.net.id));
    for (const id of touchedNets) {
      const net = circuit.nets.get(id);
      if (!net) continue;
      rerouteNet(net); // re-anchor the persisted drag against the terminals
      circuit._reduceNet(net); // merge any run dragged onto a same-net wire
    }
    circuit.syncJunctionSolders();
    wiresDirty = true; // committed wire drag changed net geometry
    history.push(drag.startSnapshot);
    if (history.length > 200) history.shift();
    future.length = 0;
  } else if (drag.mode === 'marquee') {
    if (drag.moved) {
      const box = worldRect(drag.startWorld, w);
      applyBoxSelection(box.x0, box.y0, box.x1, box.y1, ev.shiftKey);
    }
  } else if (drag.mode === 'wirepick') {
    if (!movedOut) doWireClick(snap(w.x), snap(w.y), drag.terminalHit);
  } else if (drag.mode === 'move') {
    if (drag.moved) {
      const refs = [...drag.origins.keys()];
      // Touching pins connect at the COMMITTED position only (never mid-drag,
      // where a pin merely passing over another would merge nets).
      if (circuit.connectCoincident(refs) > 0) {
        for (const id of netsTouching(refs)) {
          const net = circuit.nets.get(id);
          if (net) rerouteNet(net);
        }
      }
      // Re-sync junction solder dots to the moved topology.
      circuit.syncJunctionSolders();
      // A moved component can land a wire leg on top of a same-net wire; reduce
      // the touched nets so overlapped runs merge instead of hiding beneath.
      for (const id of netsTouching(refs)) {
        const net = circuit.nets.get(id);
        if (net) circuit._reduceNet(net);
      }
      wiresDirty = true; // moved components re-route their nets
    }
  }

  drag = null;
  render();
}

canvasEl.addEventListener('mousedown', canvasMouseDown);
canvasEl.addEventListener('mousemove', canvasMouseMove);
window.addEventListener('mouseup', canvasMouseUp);
canvasEl.addEventListener('contextmenu', (ev) => ev.preventDefault());
canvasEl.addEventListener('dragstart', (ev) => ev.preventDefault());

// Double-click a label to edit its text inline.
canvasEl.addEventListener('dblclick', (ev) => {
  const w = clientToWorld(ev.clientX, ev.clientY);
  const label = pickLabel(w);
  if (label) inlineEditLabel(label);
  else {
    const hit = pickWire(w);
    if (hit) {
      selectedWire = null;
      selectedWires.clear();
      selectedNets = new Set([hit.net.id]);
      render();
    }
  }
});

/** Overlay an <input> on the label's anchor; Enter/blur commits, Escape cancels. */
function inlineEditLabel(label) {
  if (!label || inlineInput) return;
  lastLabelClick = null; // starting an edit clears any pending double-click state
  const a = label.anchorWorld();
  const pane = document.querySelector('.canvas-pane');
  const r = pane.getBoundingClientRect();
  const sx = r.left + ((a.x - view.x) / view.w) * r.width;
  const sy = r.top + ((a.y - view.y) / view.h) * r.height;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = label.text;
  input.spellcheck = false;
  input.style.cssText = `position:absolute;left:${sx}px;top:${sy}px;transform:translate(-50%,-50%);z-index:30;font:12px sans-serif;padding:2px 4px;min-width:60px;`;
  document.body.appendChild(input);
  inlineInput = input;
  input.focus();
  input.select();
  let closed = false;
  const done = (applyText) => {
    if (closed) return;
    closed = true;
    inlineInput = null;
    const v = input.value.trim();
    input.remove();
    if (applyText && v && v !== label.text) {
      commit(() => label.setText(v));
    }
    render();
  };
  // Ctrl+, (comma) / Ctrl+. (period) wrap the selected text in subscript /
  // superscript markup `_{...}` / `^{...}`. Toggle off (un-wrap) by pressing
  // again on the same selection; a selection that mixes plain and sub/super
  // text reverts everything in it to normal. The canvas re-renders the markup
  // live so the effect is visible while editing.
  const toggleMarkup = (mark) => {
    const res = applyMarkup(input.value, input.selectionStart, input.selectionEnd, mark);
    if (!res) return;
    input.value = res.text;
    input.setSelectionRange(res.selStart, res.selEnd);
    commit(() => label.setText(res.text));
    render();
  };
  input.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') done(true);
    else if (ev.key === 'Escape') done(false);
    else if ((ev.ctrlKey || ev.metaKey) && ev.key === ',') {
      ev.preventDefault();
      toggleMarkup('_');
    } else if ((ev.ctrlKey || ev.metaKey) && ev.key === '.') {
      ev.preventDefault();
      toggleMarkup('^');
    }
  });
  input.addEventListener('blur', () => done(true));
}

// ----- mouse wheel: zoom about the pointer ----------------------------------
canvasEl.addEventListener(
  'wheel',
  (ev) => {
    ev.preventDefault();
    const f = Math.pow(1.0016, ev.deltaY);
    const nw = Math.min(Math.max(view.w * f, minViewW()), maxViewW());
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

    row.addEventListener('click', (ev) => {
      cursor = { x: comp.transform.x, y: comp.transform.y };
      if (ev.shiftKey) {
        // Shift-click toggles this instance in/out of the multi-selection.
        if (multi.has(comp.refdes)) {
          multi.delete(comp.refdes);
          if (selected === comp.refdes) selected = multi.size ? [...multi][0] : null;
        } else {
          multi.add(comp.refdes);
          if (!selected) selected = comp.refdes;
        }
      } else {
        setSelection([comp.refdes]);
      }
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
    if (!net.terminals.length) continue; // never show empty/ghost nets
    const row = document.createElement('div');
    row.className = 'row' + (selectedNets.has(net.id) ? ' selected' : '');

    const ref = document.createElement('span');
    ref.className = 'ref';
    ref.textContent = net.name || net.id;
    ref.title = 'Double-click to rename';

    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${net.terminals.length} term  ${net.length()}u  ${net.id}`;

    row.appendChild(ref);
    row.appendChild(meta);

    row.addEventListener('click', (ev) => {
      const now = Date.now();
      const prev = lastNetClick;
      // A plain click re-renders the list, replacing this row node before the
      // browser can fire a native `dblclick` on it, so a fast second click at
      // the same position is detected here manually (like labels and wires).
      const doubleClick =
        !ev.shiftKey &&
        prev &&
        prev.netId === net.id &&
        now - prev.at < 500 &&
        Math.abs(ev.clientX - prev.x) <= 6 &&
        Math.abs(ev.clientY - prev.y) <= 6;
      lastNetClick = { netId: net.id, x: ev.clientX, y: ev.clientY, at: now };
      if (doubleClick) {
        startNetRename(net, ref);
        return;
      }
      if (ev.shiftKey) {
        // Shift-click toggles this net in/out of the highlighted set.
        if (selectedNets.has(net.id)) selectedNets.delete(net.id);
        else selectedNets.add(net.id);
      } else {
        selectedNets = new Set([net.id]);
      }
      const pt = net.points()[Math.floor(net.points().length / 2)];
      if (pt) cursor = { x: pt.x, y: pt.y };
      render();
    });

    row.addEventListener('dblclick', () => {
      // Native dblclick backup for browsers that deliver it (the manual
      // detection above covers the row-replacing re-render case).
      startNetRename(net, ref);
    });

    netsListEl.appendChild(row);
  }
}

/** Open the inline rename <input> for a net's row (Enter/blur commits, Esc
 *  cancels). The net name is replaced in place so the row is not re-rendered
 *  mid-edit. */
function startNetRename(net, ref) {
  selectedNets = new Set([net.id]);
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'rename-input';
  input.value = net.name || '';
  input.placeholder = net.id;
  input.spellcheck = false;
  ref.replaceWith(input);
  input.focus();
  input.select();
  let closed = false;
  const done = (applyText) => {
    if (closed) return;
    closed = true;
    const v = input.value.trim();
    input.replaceWith(ref);
    if (applyText && v && v !== net.name) {
      commit(() => {
        net.name = v;
      });
    }
    render();
  };
  input.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') done(true);
    else if (ev.key === 'Escape') done(false);
  });
  input.addEventListener('blur', () => done(true));
}

function renderDetail() {
  detailEl.innerHTML = '';
  const label = selectedLabel();
  if (label) {
    const meta = document.createElement('div');
    meta.className = 'detail-meta';
    meta.textContent = `label "${label.text}"  align: ${label.align}${label.owner ? `  owned by ${label.owner}` : ''}  — double-click to edit text, Shift+Left/Right to align`;
    detailEl.appendChild(meta);

    const table = document.createElement('table');
    const row = document.createElement('tr');
    const a = label.anchorWorld();
    const b = label.bbox();
    for (const [k, v] of [
      ['Text', label.text],
      ['Align', label.align],
      ['Anchor', `${a.x},${a.y}`],
      ['BBox', `${b.x},${b.y} ${b.w}x${b.h}`],
      ['Owner', label.owner || '—'],
    ]) {
      const th = document.createElement('td');
      th.textContent = k;
      th.style.fontWeight = '600';
      const td = document.createElement('td');
      td.textContent = v;
      row.appendChild(th);
      row.appendChild(td);
    }
    table.appendChild(row);
    detailEl.appendChild(table);
    return;
  }

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
    selectedWire = null;
    selectedWires.clear();
    selectedNets.clear();
    logLine('wiring cancelled');
  } else if (key === 'Enter') {
    commitWireAtCursor();
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
      wire.points = [];
      logLine(`wire from ${comp.refdes}.${key} — click/type the target terminal`);
    } else if (comp.refdes === wire.source.refdes && key === wire.source.term) {
      logLine('same terminal');
    } else {
      try {
        connectWireToTerminal({ refdes: comp.refdes, term: key });
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
  p: 'pmos',
  N: 'npn',
  P: 'pnp',
  g: 'ground',
  s: 'supply',
  x: 'switch_open',
  X: 'switch_closed',
  i: 'current_source',
  v: 'voltage_source',
  C: 'current_sink',
  u: 'opamp',
  A: 'and_gate',
  b: 'buffer',
  I: 'input',
  o: 'output',
  O: 'inputoutput',
  a: 'solder',
};

const PLACEMENT_BY_TYPE = new Map(Object.entries(PLACEMENT).map(([key, type]) => [type, key]));

/** Rank a component/label name against a fuzzy query (subsequence match).
 *  Returns a score >= 0 for a match (higher = better) or -1 for no match.
 *  Prefix hits beat substring hits, which beat pure subsequences; shorter
 *  names win ties. */
function fuzzyScore(q, name) {
  const s = String(name).toLowerCase();
  const query = String(q).toLowerCase();
  if (!query) return 0;
  if (s.startsWith(query)) return 100 - s.length;
  if (s.includes(query)) return 80 - s.length;
  let i = 0;
  for (const ch of s) {
    if (ch === query[i]) i++;
    if (i === query.length) return 60 - s.length;
  }
  return -1;
}

function onInsertKey(key) {
  // Arrow keys move the cursor; all other printable keys go into the fuzzy
  // search query (hjkl are NOT cursor keys here — you type them).
  const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key];
  if (arrow) {
    moveCursor(arrow[0], arrow[1]);
    render();
    return;
  }

  // With a ghost selected, R/X rotate/mirror the about-to-be-placed component.
  if (pendingPlace && pendingPlace.kind === 'component' && (key === 'r' || key === 'R')) {
    pendingPlace.rotation = (((pendingPlace.rotation || 0) + (key === 'r' ? 90 : -90)) % 360 + 360) % 360;
    render();
    return;
  }
  if (pendingPlace && pendingPlace.kind === 'component' && (key === 'x' || key === 'X')) {
    if (key === 'x') pendingPlace.mirrorX = pendingPlace.mirrorX === null ? true : !pendingPlace.mirrorX;
    else pendingPlace.mirrorY = pendingPlace.mirrorY === null ? true : !pendingPlace.mirrorY;
    render();
    return;
  }

  // A placement ghost is pending: Enter/click commits it; Esc drops it back to
  // the search picker so a different component can be typed.
  if (pendingPlace) {
    if (key === 'Enter') {
      placePending();
    } else if (key === 'Escape' || key === 'Backspace') {
      pendingPlace = null;
      insertQuery = '';
      render();
    }
    return;
  }

  // Fuzzy search picker (no ghost): type to filter, Enter picks the best match.
  if (key === 'Enter') {
    const entries = insertMenuEntries();
    if (insertQuery && entries.length) {
      const [, type] = entries[0];
      pendingPlace = type === 'label' ? { kind: 'label' } : { kind: 'component', type, rotation: 0, mirrorX: null, mirrorY: null };
      insertQuery = '';
      render();
    }
    return;
  }
  if (key === 'Escape') {
    mode = 'normal';
    insertQuery = '';
    render();
    return;
  }
  if (key === 'Backspace') {
    insertQuery = insertQuery.slice(0, -1);
    render();
    return;
  }
  if (key.length === 1) {
    insertQuery += key;
    render();
    return;
  }
}

/** Visual mode: hjkl moves the cursor to grow a selection box; Enter commits
 *  the box selection and leaves visual mode, Escape cancels without selecting. */
function onVisualKey(key) {
  const move = {
    h: [-1, 0],
    j: [0, 1],
    k: [0, -1],
    l: [1, 0],
    ArrowLeft: [-1, 0],
    ArrowDown: [0, 1],
    ArrowUp: [0, -1],
    ArrowRight: [1, 0],
  }[key];
  if (move) {
    moveCursor(move[0], move[1]);
    render();
    return;
  }
  if (key === 'Enter') {
    applyBoxSelection(visual.x, visual.y, cursor.x, cursor.y, false);
    visual = null;
    render();
    return;
  }
  if (key === 'Escape' || key === 'v') {
    visual = null;
    render();
    return;
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
    const labs = selectedLabels();
    if (comps.length || labs.length) {
      const dx = nudgeKey[0] * count * 40;
      const dy = nudgeKey[1] * count * 40;
      commit(() => {
        const refs = comps.map((c) => c.refdes);
        const moved = new Map();
        for (const c of comps) {
          circuit.moveComponent(c.refdes, c.transform.x + dx, c.transform.y + dy);
          moved.set(c.refdes, { dx, dy });
        }
        // Only free labels are moved explicitly — owned labels follow their
        // component's transform automatically (avoid double-moving them).
        for (const lab of labs) if (!lab.owner) lab.translate(dx, dy);
        // Nudging moves the wires too, exactly like a drag: a net whose
        // terminals all ride nudged components translates rigidly with them.
        rerouteTouchedNets(refs, moved);
      });
      const primary = comps.find((c) => c.refdes === selected) || comps[0];
      const a = labs.length ? labs[0].anchorWorld() : null;
      if (primary) cursor = { x: primary.transform.x, y: primary.transform.y };
      else if (a) cursor = { x: a.x, y: a.y };
    } else {
      moveCursor(nudgeKey[0] * count, nudgeKey[1] * count);
    }
    render();
    return;
  }

  if (key === 'r' || key === 'R') {
    if (!selectedComps().length) {
      logLine('nothing selected to rotate');
    } else {
      const total = (((key === 'r' ? 90 : -90) * count) % 360 + 360) % 360;
      if (total) rotateSelectionAbout(total);
      const primary = selectedComp() || selectedComps()[0];
      cursor = { x: primary.transform.x, y: primary.transform.y };
      render();
    }
    return;
  }

  if (key === 'x' || key === 'X') {
    if (!selectedComps().length) {
      logLine('nothing selected to mirror');
    } else {
      mirrorSelectionAbout(key === 'x' ? 'x' : 'y');
      render();
    }
    return;
  }

  if (key === 'Enter') {
    const lab = pickLabel(cursor);
    if (lab) {
      const a = lab.anchorWorld();
      cursor = { x: snap(a.x), y: snap(a.y) };
      setSelection([]);
      setLabelSelection([lab.id]);
      render();
      return;
    }
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
      copySelection();
      pendingKey = null;
    } else {
      pendingKey = { key: 'y', at: Date.now() };
    }
    return;
  }

  if (key === 'd') {
    if (pendingKey && pendingKey.key === 'd' && Date.now() - pendingKey.at < 800) {
      if (deleteSelection()) render();
      pendingKey = null;
    } else {
      pendingKey = { key: 'd', at: Date.now() };
    }
    return;
  }

  if (key === 'p') {
    pasteClipboard();
    return;
  }

  if (key === 'w') {
    wire = { source: null };
    logLine('wiring: click the SOURCE terminal, then click the TARGET terminal');
    render();
    return;
  }

  if (key === 'v') {
    // Visual mode: the box grows from the cursor as you move with hjkl; Enter
    // commits the box selection (like a marquee), Esc cancels.
    visual = { x: cursor.x, y: cursor.y };
    selectedNets.clear();
    render();
    return;
  }

  if (key === 'i' || key === 'I' || key === 'A') {
    mode = 'insert';
    pendingPlace = null;
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

  if (key === '#') {
    setGrid(!showGrid);
    return;
  }

  if (key === 'D') {
    toggleTheme();
    return;
  }

  if (key === 'u') {
    undo();
    return;
  }

  if (key === 'U') {
    redo();
    return;
  }

  if (key === 'Tab') {
    cycleSelection(1);
    return;
  }

  if (key === 'Delete' || key === 'Backspace') {
    deleteSelection();
    render();
    return;
  }

  if (key === 'F' || key === 'f') {
    fitView();
    return;
  }

  if (key === 'Escape') {
    pendingKey = null;
    setSelection([]);
    setLabelSelection([]);
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
      'dd          delete selected     yy / C-c   copy selected set',
      'p / C-v     paste the copied set at the cursor (new ids, nets kept)',
      'D           toggle dark mode',
      'w           enter persistent wire mode (Esc exits)',
      '            click points to build a wire in segments; click/Enter the',
      '            target terminal to connect, or Enter on another wire to join',
      '            that net (a solder dot marks the junction)',
      'Tab         cycle selection',
      'Ctrl-A      select all components',
      'Enter       select component under cursor',
      'u / C-z     undo    U / C-y / C-r  redo',
      'F / f       fit view to contents',
      '#           toggle the placement grid on / off',
      'Esc         deselect everything',
      'v           visual mode: hjkl grows a box · Enter selects · Esc cancels',
      'i           insert mode (fuzzy-search component & label placement)',
      ':           ex-mode command line (e.g. :connect R1.a R2.a)',
      '?           this help',
      '-- insert --',
      'type        fuzzy-search component names (e.g. nmos, curr, sw, output)',
      'Enter       pick the best match as a placement ghost',
      'Enter/click place ghost at cursor · R/X rotate/mirror ghost',
      'arrows      move cursor between placements',
      'Backspace   edit the search string',
      'Esc/Backspace  cancel ghost (back to search)   Esc exits insert',
      'arrows      also move cursor',
      '-- labels --',
      't (insert)  place a label (double-click to edit text)',
      'Shift+Left / Shift+Right  align left / right (centre default)',
      'h j k l     move a selected label (set its offset if it belongs to a part)',
      'dd / Del    delete the selected label',
      'double-click  edit the label text inline',
      'C-, / C-.    in the label editor: subscript / superscript the selection',
      '             (press again to revert; mixed selection reverts to normal)',
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

/** Copied selection: components, their free labels, and the nets that run
 *  entirely inside the selection. Pasted copies keep their relative positions
 *  and connectivity and are given fresh ids (refdes / label ids / net ids). */
let clipboard = null; // { comps, labels, nets, anchor }

/** Copy the current selection (components + free labels + internal nets). */
function copySelection() {
  const comps = selectedComps();
  const freeLabels = selectedLabels().filter((l) => !l.owner);
  if (!comps.length && !freeLabels.length) {
    logLine('nothing selected to copy');
    return;
  }
  const compRefs = new Set(comps.map((c) => c.refdes));
  const nets = [];
  for (const net of circuit.nets.values()) {
    if (net.terminals.length && net.terminals.every((t) => compRefs.has(t.comp))) {
      nets.push({
        name: net.name,
        terminals: net.terminals.map((t) => ({ comp: t.comp, term: t.term })),
        route: net.route ? net.route.map((p) => ({ ...p })) : null,
        junctions: net.junctions.map((p) => ({ ...p })),
        branches: net.branches ? net.branches.map((b) => b.map((p) => ({ ...p }))) : null,
      });
    }
  }
  // Grid-snapped anchor = bbox centre of the selection, so paste re-centres it
  // at the cursor without drifting off the grid.
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const addRect = (r) => {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  };
  for (const c of comps) addRect(c.bboxWorld());
  for (const l of freeLabels) addRect(l.bbox());
  const anchor = { x: snap((x0 + x1) / 2), y: snap((y0 + y1) / 2) };
  clipboard = {
    comps: comps.map((c) => ({
      origRef: c.refdes,
      type: c.type,
      x: c.transform.x,
      y: c.transform.y,
      rotation: c.transform.rotation,
      mirrorX: c.transform.mirrorX,
      mirrorY: c.transform.mirrorY,
    })),
    labels: freeLabels.map((l) => ({ text: l.text, align: l.align, x: l.anchorWorld().x, y: l.anchorWorld().y })),
    nets,
    anchor,
  };
  logLine(`copied ${comps.length} component(s), ${freeLabels.length} label(s), ${nets.length} net(s)`);
}

/** Paste the clipboard at the cursor (re-centred on the selection anchor). */
function pasteClipboard() {
  if (!clipboard) {
    logLine('nothing copied');
    return;
  }
  const dx = snap(cursor.x) - clipboard.anchor.x;
  const dy = snap(cursor.y) - clipboard.anchor.y;
  const addedComps = [];
  const addedLabels = [];
  commit(() => {
    const refMap = new Map();
    for (const c of clipboard.comps) {
      const comp = circuit.addComponent(c.type, {
        x: c.x + dx,
        y: c.y + dy,
        rotation: c.rotation,
        mirrorX: c.mirrorX,
        mirrorY: c.mirrorY,
      });
      refMap.set(c.origRef, comp.refdes);
      addedComps.push(comp.refdes);
    }
    for (const l of clipboard.labels) {
      const nl = circuit.addLabel({ text: l.text, align: l.align, x: l.x + dx, y: l.y + dy });
      addedLabels.push(nl.id);
    }
    for (const n of clipboard.nets) {
      const net = circuit._createNet(n.name);
      for (const t of n.terminals) {
        const newRef = refMap.get(t.comp);
        if (newRef) net.terminals.push({ comp: newRef, term: t.term });
      }
      net.route = n.route ? n.route.map((p) => ({ x: p.x + dx, y: p.y + dy })) : null;
      net.junctions = n.junctions.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      net.branches = n.branches ? n.branches.map((b) => b.map((p) => ({ x: p.x + dx, y: p.y + dy }))) : null;
    }
    circuit.syncJunctionSolders();
    setSelection(addedComps);
    setLabelSelection(addedLabels);
  });
  render();
}

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
    wiresDirty = true; // commands can re-route / splice nets
    multi = new Set([...multi].filter((r) => circuit.components.has(r)));
    if (!circuit.components.has(selected)) selected = multi.size ? [...multi][0] : null;
  }
  render();
}

// ----- status -------------------------------------------------------------

function renderStatus() {
  const comp = selectedComp();
  const label = selectedLabel();
  const sel = label
    ? `lab "${label.text}"${selLabels.size > 1 ? ` +${selLabels.size - 1}` : ''}`
    : comp
      ? `${comp.refdes}${multi.size > 1 ? ` +${multi.size - 1}` : ''}`
      : '-';
  const parts = [visual ? 'VISUAL' : mode === 'insert' ? 'INSERT' : 'NORMAL', `sel ${sel}`, `@${cursor.x},${cursor.y}`];
  if (visual) {
    parts.push('box from cursor · hjkl grow · Enter select · Esc cancel');
  }
  if (mode === 'insert') {
    parts.push(pendingPlace ? `place ${pendingPlace.kind === 'label' ? 'label' : pendingPlace.type} @ click/Enter · R/X · Esc cancel` : insertQuery ? `~${insertQuery} · Enter pick` : 'type to filter · Esc exit');
  }
  if (wire) {
    parts.push(
      wire.source
        ? wire.source.refdes
          ? `WIRE ${wire.source.refdes}.${wire.source.term} ->`
          : `WIRE (${wire.source.x},${wire.source.y}) ->`
        : 'WIRE: click a terminal or any point',
    );
  }
  if (selectedNets.size) parts.push(`nets ${selectedNets.size}`);
  if (netWarnings.length) parts.push('⚠ wire overlap with another net (highlighted)');
  statusEl.textContent = parts.join('  ·  ');
  statusEl.className = wire ? 'status wire' : mode === 'insert' ? 'status insert' : 'status normal';
}

// ----- insert-mode menu ----------------------------------------------------
// A read-only, non-interactive dropdown next to the cursor (shown in insert
// mode) listing every placable component with its hotkey. Selection is via
// the hotkeys themselves; the menu just mirrors the options and follows the
// cursor. `pointer-events: none` keeps it from intercepting clicks/drags.
let insertMenu = null;
// Every registered symbol type appears in the menu; the hotkey column shows the
// assigned key (blank when none) so new components surface automatically. The
// list is fuzzy-filtered by the live `insertQuery` while typing.
function insertMenuEntries() {
  const all = [...symbolTypeNames.map((type) => [PLACEMENT_BY_TYPE.get(type) || '', type]), ['', 'label']];
  if (!insertQuery) return all;
  return all
    .map(([key, type]) => [key, type, fuzzyScore(insertQuery, type)])
    .filter(([, , score]) => score >= 0)
    .sort((a, b) => b[2] - a[2] || a[1].localeCompare(b[1]))
    .map(([key, type]) => [key, type]);
}

function updateInsertMenu() {
  // The picker only needs to be visible when insert mode has no ghost selected;
  // once a placement (component/label) is pending it would just be in the way.
  if (mode !== 'insert' || pendingPlace) {
    if (insertMenu) insertMenu.remove();
    insertMenu = null;
    return;
  }
  if (!insertMenu) {
    insertMenu = document.createElement('div');
    insertMenu.id = 'insert-menu';
    insertMenu.className = 'insert-menu';
    document.body.appendChild(insertMenu);
  }
  // Rebuild the entries every render so the live query filter is reflected.
  insertMenu.textContent = '';
  const query = document.createElement('div');
  query.className = 'insert-menu-query';
  query.textContent = insertQuery ? `~ ${insertQuery}` : 'type to filter…';
  insertMenu.appendChild(query);
  const entries = insertMenuEntries();
  insertMenu._entries = entries;
  if (!entries.length) {
    const none = document.createElement('div');
    none.className = 'insert-menu-none';
    none.textContent = 'no match';
    insertMenu.appendChild(none);
  }
  for (const [key, type] of entries) {
    const item = document.createElement('div');
    item.className = 'insert-menu-item';
    const kbd = document.createElement('span');
    kbd.className = 'insert-menu-key';
    kbd.textContent = key || '·';
    const name = document.createElement('span');
    name.textContent = type;
    item.appendChild(kbd);
    item.appendChild(name);
    insertMenu.appendChild(item);
  }
  const p = worldToClient(cursor.x, cursor.y);
  insertMenu.style.display = 'block';
  const rect = insertMenu.getBoundingClientRect();
  let left = p.x + 14;
  let top = p.y - rect.height / 2;
  if (left + 160 > window.innerWidth - 8) left = p.x - 160 - 14;
  top = Math.max(8, Math.min(window.innerHeight - rect.height - 8, top));
  insertMenu.style.left = `${left}px`;
  insertMenu.style.top = `${top}px`;
}

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

document.getElementById('btn-new-circuit').addEventListener('click', () => {
  const name = window.prompt('New circuit name:');
  if (name === null) return;
  circuitNameEl.value = name.trim();
  currentCircuitName = '';
  history.push(snapshot());
  future.length = 0;
  circuit = new Circuit();
  setSelection([]);
  selectedNets.clear();
  cursor = { x: 0, y: 0 };
  view = viewFromCenter(0, 0);
  render();
  logLine(`Started new circuit "${circuitNameEl.value}". Save to create its directory.`);
});

document.getElementById('btn-load-circuit').addEventListener('click', () => loadCircuit());
document.getElementById('btn-save-circuit').addEventListener('click', saveCircuit);
circuitSelectEl.addEventListener('change', () => loadCircuit());

document.getElementById('btn-export').addEventListener('click', () => {
  const svg = svgString(circuit, { grid: true, terminals: false, junctions: false, background: true });
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

// ----- theme (dark mode) ---------------------------------------------

const THEME_KEY = 'schematic-spawner:theme';
const themeBtn = document.getElementById('btn-theme');

function applyTheme(dark) {
  document.documentElement.classList.toggle('dark', dark);
  if (themeBtn) themeBtn.textContent = dark ? 'Light' : 'Dark';
  themeBtn.title = dark ? 'Switch to light theme' : 'Switch to dark theme';
  try {
    localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
  } catch { /* storage unavailable */ }
}

function toggleTheme() {
  applyTheme(!document.documentElement.classList.contains('dark'));
}

// Persist the theme across reloads; default to light unless the system prefers dark.
try {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved) applyTheme(saved === 'dark');
  else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) applyTheme(true);
} catch { /* storage unavailable */ }
if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

// ----- grid toggle button --------------------------------------------

const gridBtn = document.getElementById('btn-grid');

/** Turn the placement grid on/off; keeps the toolbar button and the '#'
 *  keybinding in sync. */
function setGrid(on) {
  showGrid = on;
  if (gridBtn) {
    gridBtn.classList.toggle('off', !showGrid);
    gridBtn.textContent = showGrid ? 'Grid' : 'Grid off';
    gridBtn.title = showGrid ? 'Hide the placement grid (#)' : 'Show the placement grid (#)';
  }
  render();
  logLine(showGrid ? 'grid shown' : 'grid hidden');
}

if (gridBtn) {
  gridBtn.addEventListener('click', () => setGrid(!showGrid));
  gridBtn.textContent = showGrid ? 'Grid' : 'Grid off';
  gridBtn.title = 'Hide the placement grid (#)';
}

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
    const k = ev.key.toLowerCase();
    if (k === 'z') {
      ev.preventDefault();
      undo();
    } else if (k === 'y') {
      ev.preventDefault();
      redo();
    } else if (k === 'r') {
      ev.preventDefault();
      redo();
    } else if (k === 'a') {
      ev.preventDefault();
      setSelection([...circuit.components.keys()]);
      setLabelSelection([...circuit.labels.keys()]);
      // Select every non-empty net too, so Ctrl+A grabs the whole drawing.
      selectedNets = new Set(
        [...circuit.nets.values()].filter((n) => n.terminals.length).map((n) => n.id)
      );
      render();
    } else if (k === 'c') {
      ev.preventDefault();
      copySelection();
    } else if (k === 'v') {
      ev.preventDefault();
      pasteClipboard();
    }
    return;
  }

  const key = ev.key;
  if (key.startsWith('F') && /^F\d+$/.test(key)) return;

  // Escape cancels an in-progress mouse drag (e.g. a stuck wire re-route).
  if (key === 'Escape' && drag) {
    ev.preventDefault();
    cancelDrag();
    return;
  }

  // Shift+Left/Right set a selected label's alignment (cycle through center).
  if (ev.shiftKey && !wire && mode === 'normal' && (key === 'ArrowLeft' || key === 'ArrowRight')) {
    const lab = selectedLabel();
    if (lab) {
      const want = key === 'ArrowRight' ? (lab.align === 'right' ? 'center' : 'right') : lab.align === 'left' ? 'center' : 'left';
      commit(() => lab.setAlign(want));
      render();
      ev.preventDefault();
      return;
    }
  }

  if (wire) {
    onWireKey(key);
  } else if (mode === 'insert') {
    onInsertKey(key);
  } else if (visual) {
    onVisualKey(key);
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

window.__run = (line) => { runLine(line); };
window.__load = (json) => { applyJson(typeof json === 'string' ? json : JSON.stringify(json)); fitView(); };
window.__circuit = () => ({
  comps: [...circuit.components.values()].map((c) => ({ refdes: c.refdes, type: c.type, x: c.transform.x, y: c.transform.y, rot: c.transform.rotation, mx: c.transform.mirrorX, my: c.transform.mirrorY })),
  nets: [...circuit.nets.values()].map((net) => ({ id: net.id, terminals: net.terminals.map((t) => t.comp + '.' + t.term), route: net.route, branches: net.branches, junctions: net.junctions, pts: net.points() })),
  labels: [...circuit.labels.values()].map((l) => ({ ...l.toJSON(), world: l.anchorWorld() })),
});

view = viewFromCenter(0, 0);

try {
  restoreDraft();
  draftReady = true;
  render();
  refreshCircuitList();
  syncActiveCircuit(); // pick up the agent's active circuit immediately
  window.setInterval(syncActiveCircuit, 500);
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

window.addEventListener('beforeunload', (ev) => {
  persistDraft();
  if (snapshot() === lastSavedSnapshot) return;
  ev.preventDefault();
  ev.returnValue = 'You have unsaved schematic changes.';
});

const paneEl = document.querySelector('.canvas-pane');
if (paneEl && typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => {
    resizeView();
    render();
  }).observe(paneEl);
}
