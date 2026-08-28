/**
 * Schematic Spawner — vim-like keyboard editor.
 *
 * Modes:
 *   NORMAL   h/j/k/l move (selected comp or cursor), r/R rotate, x/X mirror,
 *            dd delete, yy/p copy-paste, w persistent wire mode, Tab cycle, Enter select-at-cursor,
 *            u/Ctrl-Z undo, U/Ctrl-Y/Ctrl-R redo, i insert, ':' ex-mode, ? keymap.
 *   INSERT   letters place components at the cursor, arrows move cursor, Esc back.
 *   WIRE     terminal letters pick/complete connections.
 */

import { Circuit } from '../core/model.js';
import { getSymbol, symbolTypeNames } from '../core/components/index.js';
import { runCommand, commandHelp } from '../core/commands.js';
import { svgString, editorOverlay } from '../core/render.js';
import { demoCircuit } from '../core/templates.js';
import { snap, GRID } from '../core/grid.js';
import { balancedRoute, smartRoute } from '../core/router.js';
import { applyDir } from '../core/geometry.js';
import { wireRunAt, moveWireRun } from '../core/wireedit.js';

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
let cursor = { x: 0, y: 0 };
let wire = null; // { source: {refdes, term} | null }
let counts = 0;
let pendingKey = null; // { key, at } for yy / dd chords
let history = []; // undo stack (JSON blobs)
let future = []; // redo stack
let zoom = 0.7; // px per world unit (a 40-unit cell renders as 28px)
let view = { x: -640, y: -480, w: 1280, h: 960 }; // fixed world window (infinite canvas)
let currentCircuitName = '';
let lastSavedSnapshot = '';
let draftReady = false;
const DRAFT_KEY = 'schematic-spawner:draft';
let remoteConflictLogged = false;

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

async function syncActiveCircuit() {
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
  multi = new Set(refs);
  selected = refs.length ? (refs.includes(primary) ? primary : refs[0]) : null;
  if (selected && !circuit.components.has(selected)) selected = null;
  selLabel = null;
  selLabels.clear();
}

/** Replace the label selection. `primary` defaults to the first element. */
function setLabelSelection(ids, primary = ids[0]) {
  selLabels = new Set(ids);
  selLabel = ids.length ? (ids.includes(primary) ? primary : ids[0]) : null;
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

/** Grid-snapped centroid of the selected components' bounding boxes and labels' anchors. */
function selectionCentroid() {
  const comps = selectedComps();
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const c of comps) {
    const r = c.bboxWorld();
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  for (const lab of selectedLabels()) {
    const r = lab.bbox();
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0 };
  return { x: snap((x0 + x1) / 2), y: snap((y0 + y1) / 2) };
}

/** Rotate every selected component about the selection centroid by ±90° increments. */
function rotateSelectionAbout(deg) {
  const p = selectionCentroid();
  const refs = selectedComps().map((c) => c.refdes);
  commit(() => {
    for (const c of selectedComps()) {
      const t = c.transform;
      // Rotate the component's origin about P, then spin the symbol by the same amount.
      let nx;
      let ny;
      if (deg === 90) {
        nx = p.x - (t.y - p.y);
        ny = p.y + (t.x - p.x);
      } else if (deg === 180) {
        nx = 2 * p.x - t.x;
        ny = 2 * p.y - t.y;
      } else {
        nx = p.x + (t.y - p.y);
        ny = p.y - (t.x - p.x);
      }
      circuit.moveComponent(c.refdes, nx, ny);
      circuit.setTransform(c.refdes, { rotation: (((t.rotation + deg) % 360) + 360) % 360 });
    }
    // Free labels rotate about P too (owned labels follow their component).
    for (const lab of selectedLabels()) {
      if (lab.owner) continue;
      const a = lab.anchorWorld();
      let nx;
      let ny;
      if (deg === 90) {
        nx = p.x - (a.y - p.y);
        ny = p.y + (a.x - p.x);
      } else if (deg === 180) {
        nx = 2 * p.x - a.x;
        ny = 2 * p.y - a.y;
      } else {
        nx = p.x + (a.y - p.y);
        ny = p.y - (a.x - p.x);
      }
      lab.moveTo(nx, ny);
    }
    rerouteTouchedNets(refs);
  });
}

/** Mirror every selected component about the vertical (x) or horizontal (y) centroid axis. */
function mirrorSelectionAbout(axis) {
  const p = selectionCentroid();
  const refs = selectedComps().map((c) => c.refdes);
  commit(() => {
    for (const c of selectedComps()) {
      const t = c.transform;
      if (axis === 'x') {
        circuit.moveComponent(c.refdes, 2 * p.x - t.x, t.y);
        circuit.setTransform(c.refdes, { mirrorX: !t.mirrorX });
      } else {
        circuit.moveComponent(c.refdes, t.x, 2 * p.y - t.y);
        circuit.setTransform(c.refdes, { mirrorY: !t.mirrorY });
      }
    }
    // Free labels mirror about P too (owned labels follow their component).
    for (const lab of selectedLabels()) {
      if (lab.owner) continue;
      const a = lab.anchorWorld();
      if (axis === 'x') lab.moveTo(2 * p.x - a.x, a.y);
      else lab.moveTo(a.x, 2 * p.y - a.y);
    }
    rerouteTouchedNets(refs);
  });
}

/** Re-route every net touching the given components (holistic, from terminals). */
function rerouteTouchedNets(refs) {
  for (const id of netsTouching(refs)) {
    const net = circuit.nets.get(id);
    if (net) rerouteNet(net);
  }
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

function render() {
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
          const comp = circuit.components.get(wire.source.refdes);
          if (!comp) return undefined;
          const from = comp.terminalWorld(wire.source.term);
          const pts = smartRoute(from, cursor, netEnv());
          return { from, to: cursor, pts };
        })()
      : undefined;

  let svg = svgString(circuit, {
    grid: true,
    terminals: false,
    junctions: false,
    background: true,
    viewport: { x: view.x, y: view.y, w: view.w, h: view.h },
  });
  const nets = [...selectedNets].map((id) => circuit.nets.get(id)).filter(Boolean);
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
    selLabel,
    selLabels: [...selLabels],
    nets,
    rubber: drag && drag.rubber ? drag.rubber : undefined,
    wirePreview,
    wireMode: !!wire,
    ghost,
  });
  svg = svg.replace('</svg>', `${overlay}\n</svg>`);
  canvasEl.innerHTML = svg;
  canvasEl.classList.toggle('wire-mode', !!wire);
}

// ----- mouse ------------------------------------------------------------

const DRAG_THRESH = 4; // px before a press becomes a drag
let drag = null;
let inlineInput = null; // the active inline-edit <input>, if any
let lastLabelClick = null; // { id, x, y, at } of the previous label click (for double-click fallback)

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

/** Pick the nearest net route within a forgiving screen-sized hit area. */
function pickWire(w) {
  const p = paneSize();
  const pxPerUnit = p ? view.w / p.w : 1;
  const tol = 12 / pxPerUnit;
  const snapped = { x: snap(w.x), y: snap(w.y) };
  let best = null;
  let bestD = tol;
  for (const net of circuit.nets.values()) {
    const pts = net.points();
    for (let i = 1; i < pts.length; i++) {
      const d = Math.min(
        distToSegment(w.x, w.y, pts[i - 1], pts[i]),
        distToSegment(snapped.x, snapped.y, pts[i - 1], pts[i]),
      );
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
  // Two-terminal nets keep the preview's pin-escaped outside bend; larger nets
  // get the balanced T-junction routing (which already routes branch legs with
  // smartRoute pin escapes).
  net.route = world.length === 2 ? smartRoute(world[0], world[1], env) : balancedRoute(world, env);
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

/** Connect two terminals, re-route the resulting net, commit history once. */
function connectTwo(src, dst) {
  const before = snapshot();
  const net = circuit.connect(`${src.refdes}.${src.term}`, `${dst.refdes}.${dst.term}`);
  rerouteNet(net);
  history.push(before);
  future.length = 0;
  // Stay in wiring mode so the next click can start another connection.
  wire = { source: null };
  selectedNets = new Set([net.id]);
  setSelection([dst.refdes]);
  logLine(`net ${net.id}: ${net.terminals.map((t) => `${t.comp}.${t.term}`).join('  ')}; len=${net.length()}`);
}

function doWireClick(x, y, terminalHit) {
  const hit = terminalHit || matchAt(x, y);
  if (hit && hit.term) {
    if (!wire.source) {
      wire.source = { refdes: hit.refdes, term: hit.term };
      cursor = { x: hit.x ?? x, y: hit.y ?? y };
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
      labelOrigins,
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
    const run = wireRunAt(net.route, wireHit.seg);
    cursor = { x: snap(startWorld.x), y: snap(startWorld.y) };
    drag = {
      mode: 'wireseg',
      net,
      pts: net.route,
      orient: run.orient,
      line: run.val,
      startAxis: run.orient === 'h' ? startWorld.y : startWorld.x,
      startLine: run.val,
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
  drag = { mode: 'marquee', startClient, startWorld, startSelection: new Set(multi), startLabelSelection: new Set(selLabels), moved: false, rubber: null };
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
      cursor = { x: snap(w.x), y: snap(w.y) };
      if (!drag.committed) {
        drag.committed = true;
        history.push(snapshot());
        if (history.length > 200) history.shift();
        future.length = 0;
      }
      const axis = drag.orient === 'h' ? w.y : w.x;
      const target = drag.startLine + (axis - drag.startAxis);
      drag.line = moveWireRun(drag.pts, drag.orient, drag.line, target);
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
      }
      const dwx = w.x - drag.startWorld.x;
      const dwy = w.y - drag.startWorld.y;
      for (const [r, o] of drag.origins) {
        const c = circuit.components.get(r);
        if (c) circuit.moveComponent(r, snap(o.x + dwx), snap(o.y + dwy));
      }
      // Free labels selected alongside components follow the drag (owned labels
      // already track their component's transform).
      if (drag.labelOrigins) {
        for (const [id, o] of drag.labelOrigins) {
          const l = circuit.labels.get(id);
          if (l && !l.owner) l.moveTo(o.x + dwx, o.y + dwy);
        }
      }
      // The net is treated as a holistic set: re-route its wires from the
      // terminals + environment rather than hand-carrying a wire body, so a
      // drag can never leave wires dangling or collapsed.
      rerouteTouchedNets([...drag.origins.keys()]);
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
      const foundLabels = [];
      for (const label of circuit.labels.values()) {
        if (rectOverlap(label.bbox(), box)) foundLabels.push(label.id);
      }
      const nets = [];
      for (const net of circuit.nets.values()) {
        if (netInBox(net, box)) nets.push(net.id);
      }
      if (ev.shiftKey) {
        const set = new Set(drag.startSelection);
        for (const r of found) set.add(r);
        setSelection([...set]);
        const labSet = new Set(drag.startLabelSelection || []);
        for (const id of foundLabels) labSet.add(id);
        setLabelSelection([...labSet]);
      } else {
        setSelection(found);
        setLabelSelection(foundLabels);
      }
      selectedNets = new Set(nets);
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
  input.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') done(true);
    else if (ev.key === 'Escape') done(false);
  });
  input.addEventListener('blur', () => done(true));
}

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

  // Placement keys select a ghost (follows the cursor; click/Enter commits).
  if (key === 't') {
    pendingPlace = { kind: 'label' };
    render();
  } else if (PLACEMENT[key]) {
    pendingPlace = { kind: 'component', type: PLACEMENT[key], rotation: 0, mirrorX: null, mirrorY: null };
    render();
  } else if (key === 'Enter') {
    if (pendingPlace) {
      placePending();
    }
  } else if (INSERT_MOVE[key]) {
    moveCursor(INSERT_MOVE[key][0], INSERT_MOVE[key][1]);
    render();
  } else if (key === 'Escape') {
    if (pendingPlace) pendingPlace = null; // back to the component-selection menu
    else mode = 'normal';
    render();
  } else if (key === 'Backspace') {
    if (pendingPlace) pendingPlace = null; // back to the component-selection menu
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
    const labs = selectedLabels();
    if (comps.length || labs.length) {
      const dx = nudgeKey[0] * count * 40;
      const dy = nudgeKey[1] * count * 40;
      commit(() => {
        const refs = comps.map((c) => c.refdes);
        for (const c of comps) circuit.moveComponent(c.refdes, c.transform.x + dx, c.transform.y + dy);
        // Only free labels are moved explicitly — owned labels follow their
        // component's transform automatically (avoid double-moving them).
        for (const lab of labs) if (!lab.owner) lab.translate(dx, dy);
        rerouteTouchedNets(refs);
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
      if (selLabels.size) {
        commit(() => {
          for (const id of selLabels) circuit.removeLabel(id);
        });
        setSelection([]);
        setLabelSelection([]);
        render();
        pendingKey = null;
        return;
      }
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
    if (selLabels.size) {
      commit(() => {
        for (const id of selLabels) circuit.removeLabel(id);
      });
      setSelection([]);
      setLabelSelection([]);
      render();
      return;
    }
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
      'dd          delete selected     yy   yank selected',
      'p           paste yanked component at cursor',
      'w           enter persistent wire mode (Esc exits)',
      'Tab         cycle selection',
      'Ctrl-A      select all components',
      'Enter       select component under cursor',
      'u / C-z     undo    U / C-y / C-r  redo',
      'F / f       fit view to contents',
      'Esc         deselect everything',
      'i           insert mode (place components & labels)',
      ':           ex-mode command line (e.g. :connect R1.a R2.a)',
      '?           this help',
      '-- insert --',
      'h j k l     move cursor between placements (vim home row)',
      'r c L d     resistor capacitor inductor diode',
      'n p N P     nmos pmos npn pnp',
      'i v C       current src · voltage src · current sink',
      'g s         ground supply',
      'u A b       opamp · AND gate · buffer',
      'I o O       input output inout-io',
      'x X a t     switch open · switch closed · solder · label',
      '(more components in the insert menu next to the cursor)',
      'Enter/click place ghost at cursor · R/X rotate/mirror ghost',
      'Esc/Backspace  cancel ghost (back to menu)   Esc exits insert',
      'arrows      also move cursor',
      '-- labels --',
      't (insert)  place a label (double-click to edit text)',
      'Shift+Left / Shift+Right  align left / right (centre default)',
      'h j k l     move a selected label (set its offset if it belongs to a part)',
      'dd / Del    delete the selected label',
      'double-click  edit the label text inline',
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
  const label = selectedLabel();
  const sel = label
    ? `lab "${label.text}"${selLabels.size > 1 ? ` +${selLabels.size - 1}` : ''}`
    : comp
      ? `${comp.refdes}${multi.size > 1 ? ` +${multi.size - 1}` : ''}`
      : '-';
  const parts = [mode === 'insert' ? 'INSERT' : 'NORMAL', `sel ${sel}`, `@${cursor.x},${cursor.y}`];
  if (mode === 'insert') {
    parts.push(pendingPlace ? `place ${pendingPlace.kind === 'label' ? 'label' : pendingPlace.type} @ click/Enter · R/X · Esc cancel` : 'pick r c L d n p N P g s x X i o O a · t label');
  }
  if (wire) {
    parts.push(wire.source ? `WIRE ${wire.source.refdes}.${wire.source.term} ->` : 'WIRE: click a terminal');
  }
  if (selectedNets.size) parts.push(`nets ${selectedNets.size}`);
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
// assigned key (blank when none) so new components surface automatically.
function insertMenuEntries() {
  return [
    ...symbolTypeNames.map((type) => [PLACEMENT_BY_TYPE.get(type) || '', type]),
    ['t', 'label'],
  ];
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
    insertMenu._entries = insertMenuEntries();
    for (const [key, type] of insertMenu._entries) {
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
    document.body.appendChild(insertMenu);
  }
  // Highlight the currently selected ghost, if any.
  const entries = insertMenu._entries;
  for (let i = 0; i < entries.length; i++) {
    const [key, type] = entries[i];
    const item = insertMenu.children[i];
    const active = pendingPlace ? (pendingPlace.kind === 'label' ? type === 'label' : pendingPlace.type === type) : false;
    item.classList.toggle('active', active);
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
      selectedNets.clear();
      render();
    }
    return;
  }

  const key = ev.key;
  if (key.startsWith('F') && /^F\d+$/.test(key)) return;

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
  nets: [...circuit.nets.values()].map((net) => ({ id: net.id, terminals: net.terminals.map((t) => t.comp + '.' + t.term), route: net.route, pts: net.points() })),
  labels: [...circuit.labels.values()].map((l) => ({ ...l.toJSON(), world: l.anchorWorld() })),
});

view = viewFromCenter(0, 0);

try {
  restoreDraft();
  draftReady = true;
  render();
  refreshCircuitList();
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
