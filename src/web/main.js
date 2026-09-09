/**
 * Schematic Spawner — keyboard-driven schematic editor.
 *
 * Modes:
 *   NORMAL   arrows move (selected comp or cursor), l line annotation, r rotate, Shift+r mirror,
 *            Shift+Up/Down layer, dd delete, y/p copy-paste, Ctrl+Shift+V paste style, Ctrl+I/B
 *            toggle italic/bold on selected labels, w single managed wire mode, Tab cycle, Enter select-at-cursor,
 *   INSERT   type to fuzzy-search a component/label, Enter picks a ghost, arrows move cursor, Esc back.
 *   VISUAL   arrows grow a selection box, Enter commits it (like a marquee).
 *   WIRE     terminal letters pick/complete connections.
 */

import { Circuit, LABEL_FONT_SIZE, containedWireSegments, extractWireFragments, transformComponentWorld, transformWorldPoints } from '../core/model.js';
import { getSymbol, symbolTypeNames } from '../core/components/index.js';
import { runCommand, commandHelp, evaluate } from '../core/commands.js';
import { svgString, editorOverlay } from '../core/render.js';
import { snap, GRID } from '../core/grid.js';
import { applyMarkup } from '../core/model.js';
import { segThroughInterior, smartRoute } from '../core/router.js';
import { applyDir } from '../core/geometry.js';
import { moveJunctionEndpoint, wireRunAt, moveWireRun } from '../core/wireedit.js';
import { crossNetOverlaps, clonePath, pointOnPath } from '../core/wiring.js';
import { selectedSetMoveSource, completeSelectedNetIds as selectedCompleteNetIds, chooseWireHitCandidate } from './selection.js';
import { componentPaletteItems, editorKeymapText, layerActionForKey } from './toolbar.js';
import { createPersistenceAdapter } from './persistence.js';

// ----- boot failure surface --------------------------------------
// If the module fails to load/parse/import, show the problem instead of a dead page.

const banner = () => document.getElementById('boot-banner');

window.addEventListener('error', (ev) => {
  const b = banner();
  if (b) {
    b.textContent = `App failed to start: ${ev.message || 'unknown error'} — in browser mode, use npm run serve.`;
    b.classList.add('error');
  }
});

// ----- element references -----------------------------------------

const canvasEl = document.getElementById('canvas');
const componentContextMenuEl = document.getElementById('component-context-menu');
const componentsListEl = document.getElementById('components-list');
const netsListEl = document.getElementById('nets-list');
const detailEl = document.getElementById('detail');
const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');
const cmdInput = document.getElementById('cmd-input');
const consoleEl = document.getElementById('console-panel');
const consoleResizerEl = document.getElementById('console-resizer');
const circuitSelectEl = document.getElementById('circuit-select');
const circuitNameEl = document.getElementById('circuit-name');
const saveStateEl = document.getElementById('save-state');
const deleteCircuitBtn = document.getElementById('btn-delete-circuit');
const exportCircuitBtn = document.getElementById('btn-export');
const deleteDialog = document.getElementById('delete-dialog');
const deleteDialogMessage = document.getElementById('delete-dialog-message');
const switchDialog = document.getElementById('switch-dialog');
const switchDialogMessage = document.getElementById('switch-dialog-message');
const checkSummaryBodyEl = document.getElementById('check-summary-body');
const clearCheckButtonEl = document.getElementById('btn-clear-check');
const helpDialog = document.getElementById('help-dialog');
const helpDialogContent = document.getElementById('help-dialog-content');
const helpSearch = document.getElementById('help-search');

// Small line icons keep the compact tool rail scannable without a dependency.
// Button text and existing aria labels remain the accessible names.
const ICON_PATHS = {
  'folder-open': '<path d="M3 6.5h6l2 2h10v9H3z"/><path d="M3 6.5V5h7l2 2h9"/>',
  'file-plus': '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h4M12 11v6M9 14h6"/>',
  trash: '<path d="M5 7h14M10 11v6M14 11v6M8 7l1-3h6l1 3m-11 0 1 14h10l1-14"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  save: '<path d="M5 4h12l3 3v13H4V4zM8 4v6h8V4M8 20v-6h8v6"/>',
  download: '<path d="M12 3v12m0 0 5-5m-5 5-5-5M4 20h16"/>',
  grid: '<path d="M4 4h16v16H4zM4 10h16M4 16h16M10 4v16M16 4v16"/>',
  crosshair: '<circle cx="12" cy="12" r="6"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>',
  moon: '<path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5z"/>',
  cursor: '<path d="m5 3 4 17 3-7 7-3z"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  wire: '<path d="M3 17h5l4-10h5l4 6"/>',
  'box-select': '<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/>',
  move: '<path d="M12 3v18m0-18-3 3m3-3 3 3M12 21l-3-3m3 3 3-3M3 12h18m-18 0 3-3m-3 3 3 3m15-3-3-3m3 3-3 3"/>',
  detach: '<path d="M5 5h7m0 0v7m0-7L5 12M19 19h-7m0 0v-7m0 7 7-7"/>',
  copy: '<path d="M8 8h11v12H8zM5 16H4V4h12v1"/>',
  tag: '<path d="M4 5v6l9 9 7-7-9-9H4zM8 8h.01"/>',
  text: '<path d="M5 5h14M12 5v14M8 19h8"/>',
  arrow: '<path d="M4 18 18 6m0 0h-7m7 0v7"/>',
  rectangle: '<rect x="4" y="5" width="16" height="14" rx="1"/>',
  line: '<path d="M5 19 19 5"/>',
  front: '<path d="M12 19V5m0 0-5 5m5-5 5 5"/>',
  back: '<path d="M12 5v14m0 0-5-5m5 5 5-5"/>',
  'x-circle': '<circle cx="12" cy="12" r="8"/><path d="m9 9 6 6m0-6-6 6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1.2.8-1.5 1.3-1.5 2.5M12 17h.01"/>',
};

function installButtonIcons() {
  for (const button of document.querySelectorAll('button[data-icon]')) {
    const path = ICON_PATHS[button.dataset.icon];
    if (!path || button.querySelector('.button-icon')) continue;
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.classList.add('button-icon');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('focusable', 'false');
    icon.innerHTML = path;
    button.prepend(icon);
  }
}

function setButtonLabel(button, text) {
  if (!button) return;
  const icon = button.querySelector('.button-icon');
  button.replaceChildren(...(icon ? [icon, document.createTextNode(text)] : [document.createTextNode(text)]));
}

installButtonIcons();
// ----- editor state ----------------------------------------------

const persistence = createPersistenceAdapter();

let circuit = new Circuit();
let mode = 'normal'; // 'normal' | 'insert'
let labelMode = null; // null | 'net' | 'annotation' | 'arrow' | 'box' | 'line'
let annotationStart = null;
let annotationPoints = [];
let moveMode = null; // null | 'connected' | 'detached' (armed one-shot move)
let copyMode = false; // armed one-shot copy placement
let deleteMode = false; // persistent one-shot delete tool
let movePending = false;
let copyPending = false;
let routeMode = 'orthogonal'; // 'orthogonal' | 'diagonal'; applies when w starts
let routeChoiceExposed = false;
let lastCheckReport = null;
let diagnosticSelection = { components: new Set(), nets: new Set(), labels: new Set() };

function resetCheckState() {
  lastCheckReport = null;
  diagnosticSelection = { components: new Set(), nets: new Set(), labels: new Set() };
}

function clearCheckReport() {
  lastCheckReport = null;
  clearDiagnosticFocus();
  renderCheckSummary();
}

function clearDiagnosticFocus() {
  diagnosticSelection = { components: new Set(), nets: new Set(), labels: new Set() };
}
let pendingPlace = null; // insert-mode ghost: { kind:'component', type, rotation, mirrorX, mirrorY } | { kind:'label' }
let selected = null; // primary refdes
let multi = new Set(); // all selected component refdes (always includes selected)
let selLabel = null; // primary id of the selected label object (exclusive with component selection)
let selLabels = new Set(); // all selected label ids (always includes selLabel if any)
let selectedNets = new Set(); // ids of highlighted nets
let componentRangeAnchor = null; // last component row used as a range anchor
let netRangeAnchor = null; // last net row used as a range anchor
let selectedNetSolders = new Set(); // solder components selected through net selection
let selectedWire = null; // primary {netId, branch, segment} of the selected wire segment(s)
let selectedWires = new Set(); // every selected wire segment, as "netId:branch:segment" keys (always includes selectedWire)
let cursor = { x: 0, y: 0 };
let cursorInCanvas = false;
let crosshairVisible = true;
let visual = null; // visual mode: anchor grid point {x,y} the selection box starts from
let insertQuery = ''; // insert-mode fuzzy-search string
let wire = null; // { source: {refdes, term} | null, points: [{x,y}] } — a wire being drawn in segments
let directWire = null; // protected direct wire: { source:{refdes,term}, points:[] }
let counts = 0;
let pendingKey = null; // { key, at } for dd chord
let showGrid = true; // '#' toggles the placement grid
let history = []; // undo stack (JSON blobs)
let future = []; // redo stack
let pendingCircuitLoad = null;
let zoom = 0.7; // px per world unit (a 40-unit cell renders as 28px)
let view = { x: -640, y: -480, w: 1280, h: 960 }; // fixed world window (infinite canvas)
let currentCircuitName = '';
let lastSavedSnapshot = '';
let draftReady = false;
let deleteInFlight = false;
const DRAFT_KEY = 'schematic-spawner:draft';
let restoredDraftName = null;
let remoteConflictLogged = false;
// Cross-net collinear wire overlaps (B4): highlighted spans + status warning.
let netWarnings = []; // [{ key, otherKey, x0, y0, x1, y1 }]
let wiresDirty = true; // set when wire geometry may have changed; recomputes netWarnings

/**
 * Derive the one interaction state used by the toolbar, canvas, and status
 * line. Keeping this small and pure also makes the keyboard vocabulary usable
 * by alternate (Virtuoso-style) control surfaces without duplicating mode
 * precedence rules.
 */
export function deriveInteractionState({ mode = 'normal', labelMode = null, wire = null, directWire = null, visual = null, moveMode = null, copyMode = false, deleteMode = false, movePending = false, copyPending = false, routeMode = 'orthogonal' } = {}) {
  if (directWire) return {
    key: 'wire',
    canvasClass: 'direct-wire-mode',
    toolbar: 'wire',
    label: directWire.routeMode === 'diagonal' ? 'DIAGONAL WIRE' : 'LEGACY FIXED WIRE',
  };
  if (wire) return {
    key: 'wire',
    canvasClass: 'wire-mode',
    toolbar: 'wire',
    label: 'WIRE',
  };
  if (visual) return { key: 'visual', canvasClass: 'mode-visual', toolbar: 'visual', label: 'VISUAL' };
  if (labelMode === 'net') return { key: 'net-label', canvasClass: 'mode-net-label', toolbar: 'net-label', label: 'NET LABEL' };
  if (labelMode === 'annotation') return { key: 'annotation', canvasClass: 'mode-annotation', toolbar: 'annotation', label: 'ANNOTATION' };
  if (labelMode === 'line') return { key: 'line', canvasClass: 'mode-annotation', toolbar: 'line', label: 'LINE' };
  if (labelMode === 'arrow') return { key: 'arrow', canvasClass: 'mode-annotation', toolbar: 'arrow', label: 'ARROW' };
  if (labelMode === 'box') return { key: 'box', canvasClass: 'mode-annotation', toolbar: 'box', label: 'BOX' };
  if (mode === 'insert') return { key: 'place', canvasClass: 'mode-place', toolbar: 'place', label: 'PLACE' };
  if (copyMode) return { key: 'copy', canvasClass: 'mode-copy', toolbar: 'copy', label: 'COPY' };
  if (deleteMode) return { key: 'delete', canvasClass: 'mode-delete', toolbar: 'delete', label: 'DELETE' };
  if (moveMode === 'detached') return { key: 'detached-move', canvasClass: 'mode-detached-move', toolbar: 'move-detached', label: 'DETACHED MOVE' };
  if (moveMode === 'connected') return { key: 'move', canvasClass: 'mode-move', toolbar: 'move', label: 'MOVE' };
  return { key: 'normal', canvasClass: 'mode-normal', toolbar: 'normal', label: 'NORMAL' };
}

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
    logLine(`Could not preserve local draft: ${err.message}`, 'error');
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
    restoredDraftName = /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(currentCircuitName)
      ? currentCircuitName
      : null;
  } catch (err) {
    logLine(`Could not restore local draft: ${err.message}`, 'error');
    lastSavedSnapshot = snapshot();
  }
}

async function refreshCircuitList() {
  try {
    const data = await persistence.list();
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
    const data = await persistence.save(name, circuit.toJSON());
    currentCircuitName = name;
    lastSavedSnapshot = snapshot();
    persistDraft();
    await refreshCircuitList();
    renderSaveState();
    logLine(`Saved ${name} (circuit.json and circuit.svg).`);
  } catch (err) {
    logLine(`Could not save circuit: ${err.message}`, 'error');
  }
}

async function exportCircuit() {
  const name = circuitNameEl.value.trim() || 'circuit';
  try {
    const result = await persistence.export({
      content: svgString(circuit, { grid: true, terminals: false, junctions: false, background: true, netNames: true }),
      suggestedName: `${name}.svg`,
      extension: 'svg',
    });
    if (!result.canceled) logLine(`Exported ${result.path || `${name}.svg`}.`);
  } catch (err) {
    logLine(`Could not export circuit: ${err.message}`, 'error');
  }
}

async function loadCircuit(name = circuitSelectEl.value, quiet = false) {
  if (!name) return;
  try {
    const data = await persistence.load(name);
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
    // A transient load failure (active circuit whose file does not exist yet)
    // is retried by syncActiveCircuit on the next poll — log only the first.
    if (!quiet) logLine(`Could not load circuit: ${err.message}`, 'error');
  }
}

function hasUnsavedChanges() {
  return snapshot() !== lastSavedSnapshot;
}

function requestCircuitLoad(name = circuitSelectEl.value || circuitNameEl.value.trim()) {
  if (!name) return;
  if (!hasUnsavedChanges()) {
    loadCircuit(name);
    return;
  }
  pendingCircuitLoad = name;
  if (switchDialogMessage) {
    switchDialogMessage.textContent = `Loading "${name}" will discard the unsaved changes in "${currentCircuitName || 'this design'}".`;
  }
  circuitSelectEl.value = currentCircuitName;
  switchDialog?.showModal();
}

function renderSaveState() {
  const dirty = hasUnsavedChanges();
  if (saveStateEl) {
    saveStateEl.textContent = dirty ? '• unsaved' : currentCircuitName ? 'saved' : '';
    saveStateEl.classList.toggle('unsaved', dirty);
  }
  if (deleteCircuitBtn) deleteCircuitBtn.disabled = !currentCircuitName || deleteInFlight;
}


async function deleteSavedCircuit() {
  const name = currentCircuitName;
  if (!name || deleteInFlight) return;
  deleteInFlight = true;
  renderSaveState();
  try {
    const data = await persistence.delete(name);

    history = [];
    future = [];
    circuit = new Circuit();
    resetCheckState();
    directWire = null;
    wire = null;
    drag = null;
    moveMode = null;
    copyMode = false;
    deleteMode = false;
    movePending = false;
    copyPending = false;
    visual = null;
    pendingPlace = null;
    labelMode = null;
    annotationPoints = [];
    setSelection([]);
    selectedNets.clear();
    cursor = { x: 0, y: 0 };
    view = viewFromCenter(0, 0);
    currentCircuitName = '';
    circuitNameEl.value = '';
    circuitSelectEl.value = '';
    lastSavedSnapshot = snapshot();
    lastSeenActive = null;
    lastFailedActive = null;
    restoredDraftName = null;
    remoteConflictLogged = false;
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* storage unavailable */ }
    render();
    await refreshCircuitList();
    logLine(`Deleted circuit "${data.name || name}".`);
  } catch (err) {
    logLine(`Could not delete circuit: ${err.message}`, 'error');
  } finally {
    deleteInFlight = false;
    renderSaveState();
  }
}

function askDeleteCircuit() {
  const name = currentCircuitName;
  if (!name || !deleteDialog) return;
  deleteDialogMessage.textContent = hasUnsavedChanges()
    ? `This permanently deletes "${name}" and discards its unsaved editor changes. This cannot be undone.`
    : `This permanently deletes "${name}" and its saved files. This cannot be undone.`;
  deleteDialog.showModal();
}

let lastSeenActive = null;
let lastFailedActive = null; // active circuit whose load failed (retry silently)
async function syncActiveCircuit() {
  if (!persistence.liveSync) return;
  // First, follow the server's "active circuit" — the agent drives it, the browser
  // mirrors it. This lets the user open the page once and watch the agent's work
  // appear automatically, without typing the circuit name or clicking Load.
  // Only auto-load on a CHANGE of the server's active (lastSeenActive), not on
  // every poll where active merely differs from currentCircuitName — otherwise
  // a manual load gets clobbered by the next tick.
  let active = null;
  let activeResponseSucceeded = false;
  try {
    const ar = await fetch('/api/active', { cache: 'no-store' });
    if (ar.ok) {
      const data = await ar.json();
      if (typeof data.active === 'string') {
        active = data.active;
        activeResponseSucceeded = true;
      }
    }
  } catch (err) {
    // network blip — keep going with the content sync below
  }

  // A named local draft is the user's current editing session. On the first
  // successful active response after boot, seed the seen value but do not
  // replace that draft with a stale server-active circuit. Later active changes
  // still follow the normal auto-load path.
  if (activeResponseSucceeded && restoredDraftName && currentCircuitName === restoredDraftName) {
    lastSeenActive = active;
    restoredDraftName = null;
    return;
  }
  if (activeResponseSucceeded && restoredDraftName && currentCircuitName !== restoredDraftName) {
    restoredDraftName = null;
  }

  if (active !== lastSeenActive) {
    if (active && active !== currentCircuitName) {
      // A failed load (e.g. the agent marked a brand-new circuit active before
      // its first file write) must NOT advance lastSeenActive — otherwise the
      // poll would never retry and the user would need a manual refresh once
      // the file appears. Retry on every tick (silently after the first error)
      // until the circuit actually loads.
      const quietRetry = active === lastFailedActive;
      await loadCircuit(active, quietRetry);
      if (currentCircuitName === active) {
        lastSeenActive = active;
        lastFailedActive = null;
      } else {
        lastFailedActive = active;
      }
      return; // loadCircuit already re-rendered + fit (or logged the failure)
    }
    lastSeenActive = active;
  }
  if (!currentCircuitName) return;
  try {
    const data = await persistence.load(currentCircuitName);
    // The model normalizes loaded state (notably reducible net geometry), so
    // compare and record the canonical representation rather than the raw
    // JSON returned by the server. Otherwise a clean design can become
    // permanently dirty after the first poll of a normalized save.
    const remoteSnapshot = JSON.stringify(Circuit.fromJSON(data.state).toJSON());
    const currentSnapshot = snapshot();
    if (remoteSnapshot === currentSnapshot) return;
    if (currentSnapshot !== lastSavedSnapshot) {
      if (!remoteConflictLogged) {
        logLine(`Remote changes to ${currentCircuitName} were not loaded because this circuit has unsaved local changes.`, 'error');
        remoteConflictLogged = true;
      }
      return;
    }
    applyJson(remoteSnapshot);
    lastSavedSnapshot = snapshot();
    remoteConflictLogged = false;
    fitView();
    logLine(`Updated ${currentCircuitName} from the live agent session.`);
  } catch {
    // A transient server restart should not interrupt editing.
  }
}

function applyJson(blob) {
  // A draft endpoint belongs to the currently visible circuit. Never carry it
  // across loads, undo/redo, or remote replacement.
  directWire = null;
  wire = null;
  drag = null;
  moveMode = null;
  copyMode = false;
  deleteMode = false;
  movePending = false;
  copyPending = false;
  visual = null;
  mode = 'normal';
  labelMode = null;
  annotationPoints = [];
  resetCheckState();
  circuit = Circuit.fromJSON(JSON.parse(blob));
  wiresDirty = true; // wire geometry may have changed under any wholesale load
  // A wholesale replacement has no compatible editor selection.  Do not carry
  // stale branch indices, labels, or net highlights across load/undo/redo.
  selected = null;
  multi.clear();
  selLabel = null;
  selLabels.clear();
  selectedWire = null;
  selectedWires.clear();
  selectedNets.clear();
  componentRangeAnchor = null;
  netRangeAnchor = null;
}

function cancelDirectDraft() {
  if (!directWire) return false;
  directWire = null;
  if (drag?.mode === 'directpick') drag = null;
  return true;
}
function restoreToolState(state) {
  if (!state?.copyMode && !state?.moveMode && !state?.deleteMode) return;
  mode = 'normal';
  labelMode = null;
  annotationPoints = [];
  visual = null;
  drag = null;
  copyMode = !!state.copyMode;
  moveMode = state.moveMode || null;
  deleteMode = !!state.deleteMode;
  movePending = false;
  copyPending = false;
}

function undo() {
  const cancelled = cancelDirectDraft();
  if (!history.length) {
    if (cancelled) render();
    return;
  }
  const toolState = { copyMode, moveMode, deleteMode };
  future.push(snapshot());
  applyJson(history.pop());
  restoreToolState(toolState);
  render();
}

function redo() {
  const cancelled = cancelDirectDraft();
  if (!future.length) {
    if (cancelled) render();
    return;
  }
  const toolState = { copyMode, moveMode, deleteMode };
  history.push(snapshot());
  applyJson(future.pop());
  restoreToolState(toolState);
  render();
}

// ----- helpers ---------------------------------------------------------

function sortedComps() {
  return [...circuit.components.values()].sort((a, b) => a.refdes.localeCompare(b.refdes));
}

function visibleNets() {
  return [...circuit.nets.values()]
    .filter((net) => net.terminals.length || net.paths().some((path) => path.length >= 2))
    .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id) || a.id.localeCompare(b.id));
}

function rangeValues(items, anchor, value, getValue) {
  const end = items.findIndex((item) => getValue(item) === value);
  const start = items.findIndex((item) => getValue(item) === anchor);
  if (end < 0) return [];
  const from = start < 0 ? end : Math.min(start, end);
  const to = start < 0 ? end : Math.max(start, end);
  return items.slice(from, to + 1).map(getValue);
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

function openFixedEndpointAt(w) {
  const p = paneSize();
  const tol = 12 / (p ? view.w / p.w : 1);
  return circuit.fixedOpenEndpointAt(w, tol);
}

/** Resolve a wire drop to one exact path/segment identity.  A snapped point
 * lying on two different paths is intentionally ambiguous: do not choose a
 * net merely because it happened to render first. */
function exactWireTargetAt(w, excludeNetId = null, sourceEndpoint = null) {
  const point = { x: snap(w.x), y: snap(w.y) };
  const p = paneSize();
  const tol = 12 / (p ? view.w / p.w : 1);
  const candidates = [];
  const onSegment = (a, b) => {
    const cross = (point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x);
    return cross === 0 && point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x) &&
      point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y);
  };
  for (const net of circuit.nets.values()) {
    if (net.id === excludeNetId) continue;
    for (let pathIndex = 0; pathIndex < net.paths().length; pathIndex++) {
      const path = net.paths()[pathIndex];
      const segments = [];
      for (let segmentIndex = 1; segmentIndex < path.length; segmentIndex++) {
        // A dragged endpoint stays incident to one segment of its own path.
        // That segment is not a drop target: otherwise an empty drop sees the
        // source wire as a target, and a real target becomes falsely ambiguous.
        if (sourceEndpoint && net.id === sourceEndpoint.netId && pathIndex === sourceEndpoint.pathIndex &&
            segmentIndex === (sourceEndpoint.endpointIndex === 0 ? 1 : path.length - 1)) continue;
        const a = path[segmentIndex - 1];
        const b = path[segmentIndex];
        if ((a.x === b.x && a.y === b.y) || !onSegment(a, b) || distToSegment(w.x, w.y, a, b) > tol) continue;
        segments.push(segmentIndex);
      }
      if (segments.length) candidates.push({ netId: net.id, pathIndex, segmentIndex: segments[0], point });
    }
  }
  const identities = new Set(candidates.map((candidate) => `${candidate.netId}:${candidate.pathIndex}`));
  if (identities.size !== 1) return candidates.length ? { ambiguous: true } : null;
  return candidates[0];
}

function fixedEndpointTarget(endpoint) {
  const net = circuit.nets.get(endpoint.netId);
  const path = net?.paths()?.[endpoint.pathIndex];
  if (!path || path.length < 2) return null;
  return {
    netId: endpoint.netId,
    pathIndex: endpoint.pathIndex,
    segmentIndex: endpoint.endpointIndex === 0 ? 1 : path.length - 1,
    point: { ...endpoint.point },
  };
}

function compUnderCursor() {
  const hit = matchAt(cursor.x, cursor.y);
  return hit && circuit.components.has(hit.refdes) ? circuit.components.get(hit.refdes) : null;
}


function selectedComp() {
  return selected && circuit.components.has(selected) ? circuit.components.get(selected) : null;
}

/** Replace the selection. `primary` defaults to the first element. */
function setSelection(refs, primary = refs[0], preserveMixed = false) {
  clearDiagnosticFocus();
  if (!preserveMixed) {
    selLabel = null;
    selLabels.clear();
    selectedWire = null;
    selectedWires.clear();
    selectedNets.clear();
  }
  multi = new Set(refs);
  selected = refs.length ? (refs.includes(primary) ? primary : refs[0]) : null;
  if (selected && !circuit.components.has(selected)) selected = null;
}

/** Replace the label selection. `primary` defaults to the first element. */
function setLabelSelection(ids, primary = ids[0], preserveMixed = false) {
  clearDiagnosticFocus();
  if (!preserveMixed) {
    selected = null;
    multi.clear();
    selectedWire = null;
    selectedWires.clear();
    selectedNets.clear();
  }
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

/** Drop segment keys whose net/branch/segment no longer exists.  Topology
 * edits, undo/load, and MST reduction can all invalidate branch indices. */
function validateSelectedWires() {
  const valid = new Set();
  for (const key of selectedWires) {
    const w = keyToWire(key);
    const path = circuit.nets.get(w.netId)?.paths()?.[w.branch];
    if (path && w.segment > 0 && w.segment < path.length) valid.add(key);
  }
  selectedWires = valid;
  if (selectedWire) {
    const key = `${selectedWire.netId}:${selectedWire.branch}:${selectedWire.segment}`;
    if (!valid.has(key)) selectedWire = null;
  }
  if (!selectedWire) syncSelectedWire();
}

function diagonalWireKeys(net) {
  return new Set(net.paths().flatMap((path, branch) =>
    path.slice(1).map((point, index) => {
      const prev = path[index];
      return point.x !== prev.x && point.y !== prev.y ? `${net.id}:${branch}:${index + 1}` : null;
    }).filter(Boolean)));
}

function selectedLabels() {
  return [...selLabels].map((id) => circuit.labels.get(id)).filter(Boolean);
}

function selectedLabel() {
  return selLabel && circuit.labels.has(selLabel) ? circuit.labels.get(selLabel) : null;
}
function toggleSelectedLabelFont(field) {
  const targets = new Map();
  for (const label of selectedLabels()) {
    targets.set(label.id, label);
    if (label.kind === 'arrow' || label.kind === 'box') {
      for (const child of circuit.labels.values()) {
        if (child.parent === label.id) targets.set(child.id, child);
      }
    }
  }
  if (!targets.size) return;
  commit(() => {
    for (const label of targets.values()) label.style[field] = label.style[field] === false;
  });
  render();
}

function selectedWireTargets() {
  return [...selectedWires].map((key) => {
    const wire = keyToWire(key);
    return wire ? { net: circuit.nets.get(wire.netId), key: `${wire.branch}:${wire.segment}` } : null;
  }).filter((item) => item?.net);
}
function syncSelectedNetSolders() {
  for (const ref of selectedNetSolders) multi.delete(ref);
  selectedNetSolders = new Set();
  for (const id of selectedNets) {
    const net = circuit.nets.get(id);
    if (!net) continue;
    for (const junction of net.junctions) {
      for (const comp of circuit.components.values()) {
        if (comp.type === 'solder' && comp.transform.x === junction.x && comp.transform.y === junction.y) {
          selectedNetSolders.add(comp.refdes);
        }
      }
    }
  }
  for (const ref of selectedNetSolders) multi.add(ref);
  if (selectedNetSolders.size && !selected) selected = [...selectedNetSolders][0];
}

function styleDefaults(field) {
  return field === 'color' ? '#111' : field === 'lineStyle' ? 'solid' : 'normal';
}

function selectedWireTargetKeys() {
  const keys = new Set(selectedWires);
  if (selectedWire) keys.add(`${selectedWire.netId}:${selectedWire.branch}:${selectedWire.segment}`);
  return [...keys];
}

function selectedStyleSource() {
  const comps = selectedComps();
  const labels = selectedLabels();
  const nets = [...selectedNets].map((id) => circuit.nets.get(id)).filter(Boolean);
  const wireKeys = selectedWireTargetKeys();
  const total = comps.length + labels.length + nets.length + wireKeys.length;
  if (total !== 1) return null;
  if (comps.length === 1) return { kind: 'object', style: { ...(comps[0].style || {}) } };
  if (labels.length === 1) return { kind: 'object', style: { ...(labels[0].style || {}) } };
  if (nets.length === 1) return { kind: 'object', style: { ...(nets[0].style || {}) } };
  const wire = keyToWire(wireKeys[0]);
  const net = circuit.nets.get(wire.netId);
  if (!net) return null;
  return {
    kind: 'wire',
    style: { ...(net.wireStyles?.[`${wire.branch}:${wire.segment}`] || net.style || {}) },
  };
}

function applyStyleToSelected(style) {
  const comps = selectedComps();
  const labels = selectedLabels();
  const wireTargets = selectedWireTargets();
  const nets = [...selectedNets].map((id) => circuit.nets.get(id)).filter(Boolean);
  const wireKeys = selectedWireTargetKeys();
  if (selectedWire) {
    const net = circuit.nets.get(selectedWire.netId);
    if (net) wireTargets.push({ net, key: `${selectedWire.branch}:${selectedWire.segment}` });
  }
  const objects = [...comps, ...labels, ...nets];
  if (!objects.length && !wireTargets.length) {
    logLine('nothing selected for style paste');
    return false;
  }
  commit(() => {
    for (const obj of objects) {
      const next = { ...(obj.style || {}) };
      for (const field of ['color', 'lineStyle', 'width']) {
        if (style[field] !== undefined && (field !== 'lineStyle' || ['arrow', 'box', 'line'].includes(obj.kind) || obj.routingMode)) {
          next[field] = style[field];
        }
      }
      if (style.color !== undefined && typeof obj.setColor === 'function') obj.setColor(style.color);
      obj.style = { ...(obj.style || {}), ...next };
    }
    for (const { net, key } of wireTargets) {
      net.wireStyles[key] = { ...(net.wireStyles[key] || net.style || {}), ...style };
    }
  });
  render();
  return true;
}

function pasteStyle() {
  if (!clipboard?.style) {
    logLine(clipboard ? 'style paste requires a single copied object' : 'nothing copied');
    return false;
  }
  return applyStyleToSelected(clipboard.style);
}

function applySelectedStyle(field, value) {
  const comps = selectedComps();
  const labels = selectedLabels();
  const wireTargets = selectedWireTargets();
  const nets = [...selectedNets].map((id) => circuit.nets.get(id)).filter(Boolean);
  if (selectedWire) {
    const net = circuit.nets.get(selectedWire.netId);
    if (net) wireTargets.push({ net, key: `${selectedWire.branch}:${selectedWire.segment}` });
  }
  const objects = [...comps, ...labels, ...nets];
  if (!objects.length && !wireTargets.length) return;
  const next = value || styleDefaults(field);
  commit(() => {
    for (const obj of objects) {
      if (field === 'lineStyle' && !['arrow', 'box', 'line'].includes(obj.kind) && !obj.routingMode) continue;
      if (field === 'color' && typeof obj.setColor === 'function') obj.setColor(next);
      else obj.style = { ...(obj.style || {}), [field]: next };
    }
    for (const { net, key } of wireTargets) {
      net.wireStyles[key] = { ...(net.wireStyles[key] || net.style || {}), [field]: next };
    }
  });
  render();
}
function updateStyleControls() {
  const line = document.getElementById('style-line');
  const color = document.getElementById('style-color');
  const width = document.getElementById('style-width');
  if (!line || !color || !width) return;
  const wireTargets = selectedWireTargets();
  if (selectedWire) {
    const net = circuit.nets.get(selectedWire.netId);
    if (net) wireTargets.push({ net, key: `${selectedWire.branch}:${selectedWire.segment}` });
  }
  const objects = [...selectedComps(), ...selectedLabels(), ...[...selectedNets].map((id) => circuit.nets.get(id)).filter(Boolean)];
  const hasWireSelection = wireTargets.length > 0 || selectedWire || selectedWires.size > 0 || selectedNets.size > 0;
  const supportsLine = hasWireSelection || objects.some((o) => ['arrow', 'box', 'line'].includes(o.kind));
  line.disabled = (!objects.length && !wireTargets.length) || !supportsLine;
  color.disabled = width.disabled = !objects.length && !wireTargets.length;
  if (!objects.length && !wireTargets.length) {
    color.value = '#111';
    line.value = 'solid';
    width.value = 'normal';
    color.style.backgroundColor = '#111';
    return;
  }
  for (const [el, field] of [[color, 'color'], [line, 'lineStyle'], [width, 'width']]) {
    const values = [
      ...objects.map((o) => o.style?.[field] || styleDefaults(field)),
      ...wireTargets.map(({ net, key }) => net.wireStyles?.[key]?.[field] || net.style?.[field] || styleDefaults(field)),
    ];
    const value = values[0];
    el.value = values.length && values.every((v) => v === value) ? value : '';
  }
  color.style.backgroundColor = color.value || '';
}

/** Match a world point against label bboxes (labels draw on top of everything). */
function pickLabel(w) {
  const x = snap(w.x);
  const y = snap(w.y);
  for (const label of circuit.labels.values()) {
    if (['arrow', 'box', 'line'].includes(label.kind)) continue;
    const r = label.bbox();
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return label;
  }
  return null;
}

function annotationTextAt(world) {
  const p = { x: snap(world.x), y: snap(world.y) };
  for (const label of circuit.labels.values()) {
    if (!['arrow', 'box'].includes(label.kind)) continue;
    const w = Math.max(GRID, label.colWidth() * GRID) / 2;
    const h = Math.max(GRID, label.rowHeight() * GRID) / 2;
    if (Math.abs(p.x - label.textAnchor.x) <= w && Math.abs(p.y - label.textAnchor.y) <= h) return label;
  }
  return null;
}

function annotationGeometryAt(world) {
  const p = { x: snap(world.x), y: snap(world.y) };
  const near = (a, b) => {
    const dx = b.x - a.x; const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    const q = { x: a.x + dx * t, y: a.y + dy * t };
    return Math.hypot(p.x - q.x, p.y - q.y) <= GRID / 2;
  };
  for (const label of circuit.labels.values()) {
    if (label.kind === 'line' && label.points.some((point, i) => i > 0 && near(label.points[i - 1], point))) return label;
    if (label.kind === 'arrow' && near(label.anchor, label.end)) return label;
    if (label.kind === 'box') {
      const a = label.anchor; const b = label.end;
      const x0 = Math.min(a.x, b.x); const x1 = Math.max(a.x, b.x);
      const y0 = Math.min(a.y, b.y); const y1 = Math.max(a.y, b.y);
      if (near({ x: x0, y: y0 }, { x: x1, y: y0 }) || near({ x: x1, y: y0 }, { x: x1, y: y1 }) ||
          near({ x: x1, y: y1 }, { x: x0, y: y1 }) || near({ x: x0, y: y1 }, { x: x0, y: y0 })) return label;
    }
  }
  return null;
}

function annotationEndpointAt(world) {
  const p = { x: snap(world.x), y: snap(world.y) };
  for (const label of circuit.labels.values()) {
    if (label.kind === 'line') {
      const index = label.points.findIndex((point) => Math.abs(p.x - point.x) <= GRID / 2 && Math.abs(p.y - point.y) <= GRID / 2);
      if (index >= 0) return { label, endpoint: `vertex:${index}` };
    }
    if (!['arrow', 'box'].includes(label.kind)) continue;
    if (label.kind === 'box') {
      const x0 = Math.min(label.anchor.x, label.end.x); const x1 = Math.max(label.anchor.x, label.end.x);
      const y0 = Math.min(label.anchor.y, label.end.y); const y1 = Math.max(label.anchor.y, label.end.y);
      const corners = [['top-left', x0, y0], ['top-right', x1, y0], ['bottom-right', x1, y1], ['bottom-left', x0, y1]];
      const hit = corners.find(([, x, y]) => Math.abs(p.x - x) <= GRID / 2 && Math.abs(p.y - y) <= GRID / 2);
      if (hit) return { label, endpoint: `corner:${hit[0]}` };
    }
    for (const endpoint of ['start', 'end']) {
      const q = endpoint === 'start' ? label.anchor : label.end;
      if (Math.abs(p.x - q.x) <= GRID / 2 && Math.abs(p.y - q.y) <= GRID / 2) return { label, endpoint };
    }
  }
  return null;
}

function annotationSegmentAt(world) {
  const p = { x: snap(world.x), y: snap(world.y) };
  const near = (a, b) => {
    const dx = b.x - a.x; const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    const q = { x: a.x + dx * t, y: a.y + dy * t };
    return Math.hypot(p.x - q.x, p.y - q.y) <= GRID / 2;
  };
  for (const label of circuit.labels.values()) {
    if (label.kind !== 'line') continue;
    for (let i = 1; i < label.points.length; i++) {
      if (near(label.points[i - 1], label.points[i])) return { label, segment: i };
    }
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

function selectedDrawTargets() {
  const groups = [];
  const netIds = new Set(selectedNets);
  if (selectedWire) netIds.add(selectedWire.netId);
  const nets = [...netIds].map((id) => circuit.nets.get(id)).filter(Boolean);
  if (nets.length) groups.push({ objects: nets, peers: [...circuit.nets.values()] });

  const comps = selectedComps().filter((comp) => !selectedNetSolders.has(comp.refdes));
  if (comps.length) groups.push({ objects: comps, peers: [...circuit.components.values()] });

  const labels = selectedLabels();
  if (labels.length) {
    const objects = [...new Map(labels.map((label) => {
      const parent = label.parent ? circuit.labels.get(label.parent) : label;
      return [parent?.id, parent];
    }).filter(([, label]) => label)).values()];
    const isAnnotation = (label) => ['arrow', 'box', 'line'].includes(label.kind);
    const allLabels = [...circuit.labels.values()];
    groups.push(...[
      {
        objects: objects.filter(isAnnotation),
        peers: allLabels.filter(isAnnotation),
      },
      {
        objects: objects.filter((label) => !isAnnotation(label)),
        peers: allLabels.filter((label) => !isAnnotation(label) && !label.parent),
      },
    ].filter(({ objects: group }) => group.length));
  }
  return groups.length ? { groups } : null;
}

function restackSelected(direction) {
  pendingKey = null;
  const targets = selectedDrawTargets();
  if (!targets) {
    logLine('select an object to move it front or back');
    return;
  }
  commit(() => {
    for (const { objects, peers } of targets.groups) {
      const ordered = [...objects].sort((a, b) => a.drawOrder - b.drawOrder);
      const base = direction === 'front'
        ? Math.max(...peers.map((object) => object.drawOrder)) + 1
        : Math.min(...peers.map((object) => object.drawOrder)) - ordered.length;
      ordered.forEach((object, index) => { object.drawOrder = base + index; });
    }
  });
  render();
}

function refreshCopyGhostBase() {
  if (drag?.mode === 'copyghost' && drag.ghost) {
    drag.ghost.baseSnapshot = snapshot();
    drag.ghost.baseGeometry = captureCopyGhostGeometry(drag.ghost);
    // The base snapshot now already contains the ghost at the current cursor.
    // Reset the translation origin so the next mousemove applies only its
    // incremental delta instead of translating from the old copy start.
    drag.startWorld = { x: snap(cursor.x), y: snap(cursor.y) };
    drag.ghost.startWorld = { ...drag.startWorld };
  }
}

function captureCopyGhostGeometry(ghost) {
  const comps = new Map();
  for (const ref of ghost.refs) {
    const comp = circuit.components.get(ref);
    if (comp) comps.set(ref, { x: comp.transform.x, y: comp.transform.y });
  }
  const labels = new Map();
  for (const id of ghost.labels) {
    const label = circuit.labels.get(id);
    if (!label || label.owner) continue;
    labels.set(id, {
      anchor: { ...label.anchor },
      end: label.end ? { ...label.end } : null,
      points: label.points ? label.points.map((point) => ({ ...point })) : null,
      textAnchor: label.textAnchor ? { ...label.textAnchor } : null,
    });
  }
  const nets = new Map();
  for (const id of ghost.netIds) {
    const net = circuit.nets.get(id);
    if (net) nets.set(id, captureNetGeometry(net));
  }
  return { comps, labels, nets };
}

function restoreCopyGhostGeometry(ghost) {
  for (const [ref, origin] of ghost.baseGeometry?.comps || []) {
    const comp = circuit.components.get(ref);
    if (comp) {
      comp.transform.x = origin.x;
      comp.transform.y = origin.y;
    }
  }
  for (const [id, origin] of ghost.baseGeometry?.labels || []) {
    const label = circuit.labels.get(id);
    if (!label || label.owner) continue;
    label.anchor = { ...origin.anchor };
    if (origin.end) label.end = { ...origin.end };
    if (origin.points) label.points = origin.points.map((point) => ({ ...point }));
    if (origin.textAnchor) label.textAnchor = { ...origin.textAnchor };
  }
  for (const [id, origin] of ghost.baseGeometry?.nets || []) {
    const net = circuit.nets.get(id);
    if (net) translateNetGeometry(net, origin, 0, 0);
  }
}

function applySingletonWorldTransform(comp, operation, pivot = null) {
  const center = pivot || { x: comp.transform.x, y: comp.transform.y };
  const next = transformComponentWorld(comp.transform, center, operation);
  if (pivot) {
    comp.transform = next;
  } else {
    circuit.setTransform(comp.refdes, {
      rotation: next.rotation,
      mirrorX: next.mirrorX,
      mirrorY: next.mirrorY,
    });
  }
}

function applySingletonWorldMirror(comp, axis, pivot = null) {
  applySingletonWorldTransform(comp, axis === 'x' ? 'mirrorX' : 'mirrorY', pivot);
}

/**
 * Rotate a singleton component about its own origin, or about the copy point
 * while a copy ghost is active. Multi-component and mixed selections are
 * transformed as one world-space set by transformMixedSelection.
 */
function moveGhostActive() {
  return drag?.mode === 'move' && drag.modal;
}

function recordMoveGhostMutation() {
  if (!drag || !moveGhostActive()) return;
  if (!drag.committed) {
    history.push(drag.startSnapshot || snapshot());
    if (history.length > 200) history.shift();
    future.length = 0;
    drag.committed = true;
  }
  drag.moved = true;
  rebaseMoveGhost();
}

/**
 * Rebase a move ghost after a transform. The transformed object set is now
 * the origin for subsequent pointer deltas; the original snapshot remains the
 * one history entry for the whole gesture.
 */
function rebaseMoveGhost() {
  if (!moveGhostActive()) return;
  const point = { x: snap(cursor.x), y: snap(cursor.y) };
  drag.startWorld = point;
  drag.startCursor = { ...point };
  drag.origins = new Map([...drag.origins.keys()].map((refdes) => {
    const c = circuit.components.get(refdes);
    return c ? [refdes, { x: c.transform.x, y: c.transform.y }] : null;
  }).filter(Boolean));
  drag.labelOrigins = new Map([...drag.labelOrigins.keys()].map((id) => {
    const label = circuit.labels.get(id);
    const anchor = label?.anchorWorld();
    return anchor ? [id, { x: anchor.x, y: anchor.y }] : null;
  }).filter(Boolean));
  if (drag.detached) {
    for (const id of drag.detachedWireRoutes?.keys() || []) {
      const net = circuit.nets.get(id);
      if (net) drag.detachedWireRoutes.set(id, captureNetGeometry(net));
    }
    return;
  }
  drag.netRoutes = new Map();
  for (const id of netsTouching([...drag.origins.keys()])) {
    const net = circuit.nets.get(id);
    if (net) drag.netRoutes.set(id, captureNetGeometry(net));
  }
}

/**
 * Rotate a singleton component about its own origin, or about the copy point
 * while a copy ghost is active. Multi-component and mixed selections are
 * transformed as one world-space set by transformMixedSelection.
 */
function rotateSelectionAbout(deg) {
  const inCopyGhost = drag?.mode === 'copyghost';
  const inMoveGhost = moveGhostActive();
  const pivot = inCopyGhost || inMoveGhost ? { x: snap(cursor.x), y: snap(cursor.y) } : null;
  if (multi.size > 1 || selectedWires.size || selectedWire || selectedNets.size || selectedLabels().some((l) => !l.owner)) {
    const turns = ((deg % 360) + 360) % 360;
    const changed = transformMixedSelection(
      turns === 180 ? 'rotate180' : turns === 270 ? 'rotateCCW' : 'rotate',
      { recordHistory: !(inCopyGhost || inMoveGhost), center: pivot },
    );
    if (changed && inCopyGhost) {
      refreshCopyGhostBase();
      cursor = pivot;
    } else if (changed && inMoveGhost) {
      cursor = pivot;
      recordMoveGhostMutation();
    }
    return;
  }
  const refs = selectedComps().map((c) => c.refdes);
  const apply = () => {
    for (const c of selectedComps()) {
      if (pivot) applySingletonWorldTransform(c, 'rotate', pivot);
      else circuit.setTransform(c.refdes, { rotation: (((c.transform.rotation + deg) % 360) + 360) % 360 });
    }
    rerouteTouchedNets(refs, null, true);
  };
  if (inCopyGhost) {
    apply();
    refreshCopyGhostBase();
    cursor = pivot;
  } else if (inMoveGhost) {
    apply();
    cursor = pivot;
    recordMoveGhostMutation();
  } else {
    commit(apply);
  }
}

/**
 * Mirror a singleton component about a world vertical (x) or horizontal (y)
 * axis through the origin. Multi-component and mixed selections are
 * transformed as one world-space set by transformMixedSelection.
 */
function mirrorSelectionAbout(axis) {
  const inCopyGhost = drag?.mode === 'copyghost';
  const inMoveGhost = moveGhostActive();
  const pivot = inCopyGhost || inMoveGhost ? { x: snap(cursor.x), y: snap(cursor.y) } : null;
  if (multi.size > 1 || selectedWires.size || selectedWire || selectedNets.size || selectedLabels().some((l) => !l.owner)) {
    const changed = transformMixedSelection(
      axis === 'x' ? 'mirrorX' : 'mirrorY',
      { recordHistory: !(inCopyGhost || inMoveGhost), center: pivot },
    );
    if (changed && inCopyGhost) {
      refreshCopyGhostBase();
      cursor = pivot;
    } else if (changed && inMoveGhost) {
      cursor = pivot;
      recordMoveGhostMutation();
    }
    return;
  }
  const refs = selectedComps().map((c) => c.refdes);
  const apply = () => {
    for (const c of selectedComps()) applySingletonWorldMirror(c, axis, pivot);
    rerouteTouchedNets(refs, null, true);
  };
  if (inCopyGhost) {
    apply();
    refreshCopyGhostBase();
    cursor = pivot;
  } else if (inMoveGhost) {
    apply();
    cursor = pivot;
    recordMoveGhostMutation();
  } else {
    commit(apply);
  }
}

/** World-space transform for a mixed component/label/wire selection. Attached
 * nets must be wholly selected (and all their terminals selected); otherwise a
 * transform would need unsafe detach/rubber-band semantics and is rejected. */
function transformMixedSelection(operation, { recordHistory = true, center: pivot = null } = {}) {
  validateSelectedWires();
  // A component-set move ghost owns the complete attached nets through
  // `netsTouching(refs)`. Do not let a stale segment selection turn that
  // complete set into a rejected partial-net transform.
  const movingComponentSet = moveGhostActive() && selectedComps().length > 1;
  const keys = movingComponentSet ? new Set() : new Set(selectedWires);
  if (!movingComponentSet && selectedWire) keys.add(`${selectedWire.netId}:${selectedWire.branch}:${selectedWire.segment}`);
  const byNet = new Map();
  for (const key of keys) {
    const w = keyToWire(key);
    if (!byNet.has(w.netId)) byNet.set(w.netId, []);
    byNet.get(w.netId).push(w);
  }
  for (const [id, selectedParts] of byNet) {
    const net = circuit.nets.get(id);
    if (!net) continue;
    const all = net.paths().flatMap((p, branch) => p.slice(1).map((point, index) => ({
      point, key: `${id}:${branch}:${index + 1}`, previous: p[index],
    })).filter(({ point, previous }) => point.x !== previous.x || point.y !== previous.y).map(({ key }) => key));
    const complete = all.length === selectedParts.length && all.every((k) => keys.has(k));
    if (!complete || (net.terminals.length && !net.terminals.every((t) => multi.has(t.comp)))) {
      logLine(`cannot transform partial ${net.terminals.length ? 'attached' : 'floating'} net ${id}; copy it as a fragment first`);
      return;
    }
  }
  const refs = selectedComps().map((c) => c.refdes);
  const selectedRefSet = new Set(refs);
  const geometryNetIds = new Set(byNet.keys());
  const canTransformNet = (net) => !net.terminals.length || net.terminals.every((t) => selectedRefSet.has(t.comp));
  for (const id of selectedNets) {
    const net = circuit.nets.get(id);
    if (!net) continue;
    if (!canTransformNet(net)) {
      logLine(`cannot transform partial attached net ${id}; select all of its components first`);
      return;
    }
    if (net.paths().length) geometryNetIds.add(id);
  }
  // A complete net internal to a component set is part of that set even when
  // the user selected the components rather than clicking the wire itself.
  for (const id of netsTouching(refs)) {
    const net = circuit.nets.get(id);
    if (net && canTransformNet(net) && net.paths().length) geometryNetIds.add(id);
  }
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  const add = (r) => { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); };
  for (const c of selectedComps()) add(c.bboxWorld());
  for (const l of selectedLabels()) add(l.bbox());
  for (const id of geometryNetIds) {
    for (const p of circuit.nets.get(id)?.paths() || []) for (const point of p) add({ x: point.x, y: point.y, w: 0, h: 0 });
  }
  if (!Number.isFinite(x0)) return;
  const center = pivot || { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  const before = snapshot();
  const savedSelection = {
    selected,
    multi: [...multi],
    selLabel,
    selLabels: [...selLabels],
    selectedNets: [...selectedNets],
    selectedWire: selectedWire ? { ...selectedWire } : null,
    selectedWires: [...selectedWires],
  };
  const restoreSelection = () => {
    const refs = savedSelection.multi.filter((ref) => circuit.components.has(ref));
    setSelection(refs, savedSelection.selected, true);
    const labels = savedSelection.selLabels.filter((id) => circuit.labels.has(id));
    setLabelSelection(labels, savedSelection.selLabel, true);
    selectedNets = new Set(savedSelection.selectedNets.filter((id) => circuit.nets.has(id)));
    selectedWires = new Set(savedSelection.selectedWires.filter((key) => {
      const w = keyToWire(key);
      const path = circuit.nets.get(w.netId)?.paths()?.[w.branch];
      return !!path && w.segment > 0 && w.segment < path.length;
    }));
    selectedWire = savedSelection.selectedWire;
    validateSelectedWires();
    if (savedSelection.selectedWire && !selectedWire) syncSelectedWire();
  };
  try {
    const selectedAnnotationIds = new Set(selectedLabels().filter((l) => ['arrow', 'box', 'line'].includes(l.kind)).map((l) => l.id));
    for (const c of selectedComps()) {
      c.transform = transformComponentWorld(c.transform, center, operation);
    }
    for (const l of selectedLabels()) {
      if (l.parent && selectedAnnotationIds.has(l.parent)) continue;
      if (l.owner) continue;
      const p = transformWorldPoints([l.anchorWorld()], center, operation)[0];
      if (l.netId) {
        // Net geometry is transformed above; assign the corresponding anchor
        // directly so moveTo cannot reject the valid transformed path.
        l.anchor = { x: snap(p.x), y: snap(p.y) };
      } else if (['arrow', 'box', 'line'].includes(l.kind)) {
        l.anchor = p;
        l.end = transformWorldPoints([l.end], center, operation)[0];
        if (l.kind === 'line') l.points = transformWorldPoints(l.points, center, operation);
        l.textAnchor = transformWorldPoints([l.textAnchor], center, operation)[0];
        for (const child of circuit.labels.values()) {
          if (child.parent === l.id) child.anchor = transformWorldPoints([child.anchor], center, operation)[0];
        }
      } else {
        l.moveTo(p.x, p.y);
      }
    }
    for (const id of geometryNetIds) {
      const net = circuit.nets.get(id); if (!net) continue;
      if (net.routingMode === 'fixed') {
        net.fixedPaths = net.fixedPaths.map((e) => ({ ...e, points: transformWorldPoints(e.points, center, operation) }));
      } else {
        const paths = net.paths().map((p) => transformWorldPoints(p, center, operation));
        net.branches = paths; net.route = paths[0] || null;
      }
      net.junctions = net.junctions.map((p) => transformWorldPoints([p], center, operation)[0]);
    }
    // Complete net geometry inside the selection is part of the rigid set and
    // is never re-routed or reduced. Other touched nets are refreshed from
    // their terminals; a failed refresh aborts the entire transform.
    const transformed = geometryNetIds;
    for (const id of netsTouching(refs)) {
      const net = circuit.nets.get(id);
      if (net && !transformed.has(id)) {
        if (rerouteNet(net, 'refresh') === false) throw new Error(`unable to reroute net ${id} safely`);
      }
    }
    circuit.syncJunctionSolders();
    if (recordHistory) {
      history.push(before);
      if (history.length > 200) history.shift();
      future.length = 0;
    }
    wiresDirty = true;
    return true;
  } catch (err) {
    const keepMoveGhost = moveGhostActive() && !recordHistory;
    if (keepMoveGhost) {
      // A failed preview transform must restore only the circuit payload.
      // Clearing the modal drag here strands the move ghost and can leave the
      // next pointer event operating on stale component/net references.
      circuit = Circuit.fromJSON(JSON.parse(before));
      restoreSelection();
      rebaseMoveGhost();
    } else {
      applyJson(before);
      restoreSelection();
      // No half-completed drag or draft may retain references to the discarded
      // circuit instance. The normal key handler will render this restored state.
      drag = null;
      directWire = null;
    }
    wiresDirty = true;
    logLine(`transform cancelled: ${err.message}`, 'error');
    return false;
  }
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

/** Delete all selected objects together in one undo step.  Selected whole nets
 *  are removed before segment cuts, so selecting both cannot leave fragments;
 *  touched-but-unselected nets are rerouted afterward. */
function deleteSelection() {
  const comps = selectedComps();
  const labels = selectedLabels();
  const keys = new Set(selectedWires);
  if (selectedWire) keys.add(`${selectedWire.netId}:${selectedWire.branch}:${selectedWire.segment}`);
  const netIds = [...selectedNets];
  if (!comps.length && !labels.length && !keys.size && !netIds.length) return false;
  const touched = netsTouching(comps.map((c) => c.refdes));
  commit(() => {
    // Remove whole nets first. This is important when Ctrl+A (or a mixed
    // selection) includes both a net and one of its wire segments: cutting
    // first would create split fragment nets that survive the whole-net delete.
    for (const id of netIds) if (circuit.nets.has(id)) circuit.removeNet(id);
    // Group cuts by net so every segment is applied against the same original
    // branch snapshot — indices never shift under one another.
    const byNet = new Map();
    for (const key of keys) {
      const w = keyToWire(key);
      if (!byNet.has(w.netId)) byNet.set(w.netId, []);
      byNet.get(w.netId).push({ branch: w.branch, segment: w.segment });
    }
    for (const [netId, segs] of byNet) {
      if (circuit.nets.get(netId)) circuit.deleteWireSegments(netId, segs);
    }
    for (const lab of labels) circuit.removeLabel(lab.id);
    // Removing a whole net above can synchronize away an auto-generated
    // junction solder that was also captured in `comps`. Deletion is allowed
    // to be idempotent: do not pass that stale component to removeComponent.
    for (const c of comps) {
      if (circuit.components.has(c.refdes)) circuit.removeComponent(c.refdes);
    }
    for (const id of touched) {
      if (netIds.includes(id)) continue;
      const net = circuit.nets.get(id);
      if (net) rerouteNet(net);
    }
    circuit.syncJunctionSolders();
  });
  clearCheckReport();
  selectedWire = null;
  selectedWires.clear();
  setSelection([]);
  setLabelSelection([]);
  selectedNets.clear();
  wiresDirty = true;
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
  const pane = document.querySelector('.canvas-pane');
  const rail = document.querySelector('.mode-toolbar');
  const paneRect = pane?.getBoundingClientRect();
  const railRect = rail?.getBoundingClientRect();
  const paneW = paneRect?.width || 1;
  const paneH = paneRect?.height || 1;
  const leftPx = railRect
    ? Math.max(0, railRect.right - (paneRect?.left || 0))
    : 0;
  const usableW = Math.max(1, paneW - leftPx);
  const usableCenterPx = leftPx + usableW / 2;
  const marginPx = 16;
  const fitW = Math.max(1, usableW - marginPx * 2);
  const fitH = Math.max(1, paneH - marginPx * 2);
  const rangeW = Math.max(1, x1 - x0);
  const rangeH = Math.max(1, y1 - y0);
  const scale = Math.min(fitW / rangeW, fitH / rangeH);
  const aspect = paneW / paneH;
  let tw = paneW / scale;
  let th = paneH / scale;
  const minW = minViewW();
  const maxW = maxViewW();
  if (tw < minW) {
    tw = minW;
    th = tw / aspect;
  } else if (tw > maxW) {
    tw = maxW;
    th = tw / aspect;
  }
  view.w = tw;
  view.h = th;
  view.x = (x0 + x1) / 2 - tw * usableCenterPx / paneW;
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

function cycleLabelSelection(dir, fromId = selectedLabel()?.id) {
  const labels = [...circuit.labels.values()].sort((a, b) => a.id.localeCompare(b.id));
  if (!labels.length) return;
  const idx = labels.findIndex((label) => label.id === fromId);
  const next = labels[((idx < 0 ? (dir > 0 ? -1 : 0) : idx) + dir + labels.length) % labels.length];
  setSelection([]);
  setLabelSelection([next.id]);
  const a = next.anchorWorld();
  cursor = { x: a.x, y: a.y };
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

/** Return the drawable wire candidates under a label-placement click.  A
 * snapped crossing may belong to several physical nets; keep those identities
 * separate so the selected/highlighted-net rule below can resolve it without
 * relying on render order. */
function netLabelCandidatesAt(world) {
  const point = { x: snap(world.x), y: snap(world.y) };
  const candidates = new Map();
  const onSegment = (a, b) => {
    const cross = (point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x);
    return cross === 0 && point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x) &&
      point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y);
  };
  for (const net of circuit.nets.values()) {
    for (const path of net.paths()) {
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1];
        const b = path[i];
        if ((a.x === b.x && a.y === b.y) || !onSegment(a, b)) continue;
        candidates.set(net.id, { net, point });
        break;
      }
      if (candidates.has(net.id)) break;
    }
  }
  return [...candidates.values()];
}

function netLabelTargetAt(world) {
  const candidates = netLabelCandidatesAt(world);
  if (candidates.length <= 1) return candidates[0] || null;
  const highlighted = new Set([...selectedNets, ...diagnosticSelection.nets]);
  const selected = candidates.filter(({ net }) => highlighted.has(net.id));
  if (selected.length === 1) return selected[0];
  return { ambiguous: true, candidates };
}

function renameLabelThroughModel(label, text) {
  if (label?.isNetLabel?.()) return circuit.renameNetLabel(label, text);
  return label.setText(text);
}

function restoreProvisionalLabel(label, initialName = '') {
  const net = label?.netId ? circuit.nets.get(label.netId) : null;
  if (label && circuit.labels.has(label.id)) circuit.removeLabel(label.id);
  if (net && net.name !== initialName) {
    try { circuit.renameNet(net.id, initialName); }
    catch (err) { logLine(`could not restore provisional net: ${err.message}`, 'error'); }
  }
}

function moveLabelSafely(label, x, y) {
  try {
    if (label?.isNetLabel?.()) {
      const net = circuit.nets.get(label.netId);
      const attachment = net ? circuit._nearestNetPathAttachment(net, { x, y }) : null;
      if (!attachment) throw new Error('net label has no drawable path');
      x = attachment.point.x;
      y = attachment.point.y;
      label.netSide = attachment.side;
    }
    label.moveTo(x, y);
    label._moveErrorShown = false;
    return true;
  } catch (err) {
    if (!label._moveErrorShown) {
      logLine(`cannot move label: ${err.message}`, 'error');
      label._moveErrorShown = true;
    }
    return false;
  }
}

/** Place a label through the persistent Virtuoso label tools. */
function placeAnnotationAt(world) {
  let label;
  const point = { x: snap(world.x), y: snap(world.y) };
  commit(() => { label = circuit.addLabel({ text: 'label', x: point.x, y: point.y, align: 'center' }); });
  setSelection([]);
  setLabelSelection([label.id]);
  labelMode = null;
  logLine(`placed annotation @ (${point.x},${point.y})`);
  render();
  inlineEditLabel(label);
}

function commitLineAnnotation() {
  if (annotationPoints.length < 2) return false;
  let annotation;
  commit(() => { annotation = circuit.addAnnotation('line', { points: annotationPoints }); });
  setSelection([]);
  setLabelSelection([annotation.id]);
  logLine(`placed line annotation with ${annotationPoints.length} points`);
  annotationPoints = [];
  lastLineClick = null;
  render();
  return true;
}

function placeShapeAnnotation(world, endOverride = null) {
  const point = { x: snap(world.x), y: snap(world.y) };
  if (!annotationStart) {
    annotationStart = point;
    logLine(`${labelMode.toUpperCase()}: choose the end point`);
    render();
    return;
  }
  const end = endOverride || point;
  commit(() => {
    annotation = circuit.addAnnotation(labelMode, {
      x: annotationStart.x,
      y: annotationStart.y,
      end,
      text: 'label',
    });
    annotationLabel = [...circuit.labels.values()].find((label) => label.parent === annotation.id);
  });
  setSelection([]);
  setLabelSelection([annotation.id]);
  logLine(`placed ${labelMode} from (${annotationStart.x},${annotationStart.y}) to (${end.x},${end.y})`);
  annotationStart = null;
  labelMode = null;
  render();
  inlineEditLabel(annotationLabel, { removeOnEmpty: true });
}

function placeNetLabelAt(world) {
  const target = netLabelTargetAt(world);
  if (!target) {
    logLine('NET LABEL: click a physical wire');
    return false;
  }
  if (target.ambiguous) {
    logLine('NET LABEL: wire crossing is ambiguous — select/highlight one net first');
    return false;
  }
  const point = target.point;
  const net = target.net;
  let label;
  const provisional = !net.name;
  try {
    if (provisional) {
      // Keep the provisional editor state out of undo history.  The original
      // snapshot is recorded here and becomes the one atomic history entry if
      // the user eventually supplies a name.
      const initialSnapshot = snapshot();
      label = circuit.addLabel({ text: '', netId: net.id, x: point.x, y: point.y, align: 'center' });
      label._provisionalInitialName = net.name || '';
      label._provisionalInitialSnapshot = initialSnapshot;
    } else {
      commit(() => { label = circuit.addNetLabel(net.id, { anchor: point, align: 'center' }); });
    }
  } catch (err) {
    logLine(`NET LABEL: ${err.message}`, 'error');
    return false;
  }
  setSelection([]);
  setLabelSelection([label.id]);
  selectedNets = new Set([net.id]);
  logLine(`${provisional ? 'provisional net label' : `placed net label "${net.name}"`} on ${net.id} @ (${point.x},${point.y})`);
  render();
  if (provisional) inlineEditLabel(label, { provisional: true, initialSnapshot: label._provisionalInitialSnapshot, initialName: label._provisionalInitialName });
  return true;
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
  // A context menu is independent of canvas repainting. Closing it here made
  // it vanish on the first pointer move after opening it.
  syncSelectedNetSolders();
  updateStyleControls();
  validateSelectedWires();
  if (wiresDirty) {
    updateNetWarnings();
    wiresDirty = false;
  }
  persistDraft();
  renderCanvas();
  renderComponents();
  renderNets();
  renderDetail();
  renderCheckSummary();
  renderStatus();
  renderSaveState();
  updateInsertMenu();
  if (window.__app) {
    window.__app.renders.push({ t: performance.now(), view: { ...view } });
    if (window.__app.renders.length > 500) window.__app.renders.shift();
  }
}

function draftRoutePath(draft, to = cursor) {
  if (!draft?.source) return undefined;
  const from = wireOrigin(draft.source);
  if (!from) return undefined;
  const endpoints = [from, ...(draft.points || []), to].map((p) => ({ x: snap(p.x), y: snap(p.y) }));
  const allowDiagonal = draft.routeStyle === 'diagonal';
  const sourceNetId = draft.source.netId ||
    (draft.source.refdes ? circuit.netOfTerminal(`${draft.source.refdes}.${draft.source.term}`)?.id : null);
  const env = netEnv(sourceNetId);
  const path = [endpoints[0]];
  for (let i = 1; i < endpoints.length; i++) {
    const leg = allowDiagonal
      ? clonePath([endpoints[i - 1], endpoints[i]], true)
      : smartRoute(endpoints[i - 1], endpoints[i], { ...env, allowDiagonal: false });
    if (!leg) return undefined;
    for (const point of leg.slice(1)) path.push({ ...point });
  }
  return path;
}

function draftWirePreview(draft) {
  const pts = draftRoutePath(draft, cursor);
  if (!pts) return undefined;
  return { from: pts[0], to: pts[pts.length - 1], pts };
}

function renderCanvas() {
  const wirePreview = draftWirePreview(wire);
  // Legacy fixed-net editing deliberately does no routing or orthogonalization.
  const directFrom = directWire?.source ? wireOrigin(directWire.source) : null;
  if (directWire?.source && !directFrom) directWire = null;
  const directPreview = directFrom
    ? { from: directFrom, pts: [directFrom, ...(directWire.points || []), cursor] }
    : undefined;

  const ghostRefs = new Set();
  const ghostLabels = new Set();
  const ghostNets = new Set();
  if (drag?.mode === 'copyghost' && drag.ghost) {
    for (const ref of drag.ghost.refs) ghostRefs.add(ref);
    for (const id of drag.ghost.labels) ghostLabels.add(id);
    for (const id of drag.ghost.netIds) ghostNets.add(id);
  } else if (drag?.mode === 'move') {
    for (const ref of drag.origins?.keys?.() || []) ghostRefs.add(ref);
    for (const id of drag.labelOrigins?.keys?.() || []) ghostLabels.add(id);
    if (!drag.detached) {
      for (const id of netsTouching([...ghostRefs])) ghostNets.add(id);
    }
  } else if (drag?.mode === 'labelmove') {
    for (const id of drag.startAnchors?.keys?.() || []) ghostLabels.add(id);
  }
  let svg = svgString(circuit, {
    grid: showGrid,
    terminals: false,
    junctions: false,
    background: true,
    viewport: { x: view.x, y: view.y, w: view.w, h: view.h },
    editingLabel: inlineInput?.dataset.labelId,
    ghostRefs,
    ghostLabels,
    ghostNets,
    cursor,
    cursorCrosshair: crosshairVisible && cursorInCanvas ? view : null,
  });
  const highlightedNetIds = new Set([...selectedNets, ...diagnosticSelection.nets]);
  const nets = [...highlightedNetIds].map((id) => circuit.nets.get(id)).filter(Boolean);
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
  let previewSelection;
  const marqueeDrag = drag?.mode === 'marquee' || drag?.mode === 'deletemarquee';
  const previewBox = visual
    ? worldRect(visual, cursor)
    : marqueeDrag && drag.rubber
      ? drag.rubber
      : null;
  if (previewBox) {
    const found = boxSelectionContents(previewBox.x0, previewBox.y0, previewBox.x1, previewBox.y1);
    previewSelection = {
      refs: marqueeDrag && drag.shift ? [...new Set([...multi, ...found.refs])] : found.refs,
      labels: marqueeDrag && drag.shift ? [...new Set([...selLabels, ...found.labels])] : found.labels,
      nets: marqueeDrag && drag.shift ? [...new Set([...selectedNets, ...found.nets])] : found.nets,
      wires: marqueeDrag && drag.shift ? [...new Set([...selectedWires, ...found.wires])] : found.wires,
    };
  }
  const overlay = editorOverlay(circuit, {
    cursor,
    selection: [...new Set([...multi, ...diagnosticSelection.components])],
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
    previewWireSegments: (() => {
      const keys = previewSelection?.wires || [];
      const out = [];
      for (const key of keys) {
        const w = keyToWire(key);
        const p = circuit.nets.get(w.netId)?.paths()?.[w.branch];
        if (p?.[w.segment]) out.push({ a: p[w.segment - 1], b: p[w.segment] });
      }
      return out;
    })(),
    fixedDrag: drag && drag.mode === 'fixedwire'
      ? { x: cursor.x, y: cursor.y, junction: drag.junction >= 0 }
      : undefined,
    selLabel,
    // Diagnostics are additive and use the renderer's normal label-selection
    // overlay, leaving the user's selected label(s) intact.
    selLabels: [...new Set([...selLabels, ...diagnosticSelection.labels])],
    nets,
    previewSelection,
    // Keep the committed clicks visible while a line is being drafted.
    annotationPreview: labelMode === 'line' && (annotationPoints.length || drag?.mode === 'annotationlineplace')
      ? { kind: 'line', points: [...annotationPoints, ...(drag?.previewEnd ? [drag.previewEnd] : [cursor])] }
      : (drag?.mode === 'annotationplace' && (annotationStart || drag.previewEnd))
        || (['arrow', 'box'].includes(labelMode) && annotationStart)
        ? { kind: labelMode, a: annotationStart || drag?.startWorld, b: drag?.previewEnd || cursor }
        : undefined,
    warnOverlaps: netWarnings,
    rubber: visual
      ? { x0: Math.min(visual.x, cursor.x), y0: Math.min(visual.y, cursor.y), x1: Math.max(visual.x, cursor.x), y1: Math.max(visual.y, cursor.y), color: '#2e7d32' }
      : drag && drag.rubber
        ? drag.rubber
        : undefined,
    wirePreview,
    directWirePreview: directPreview,
    wireMode: !!wire || !!directWire,
    wireSource: (wire || directWire)?.source ? { ...(wire || directWire).source } : undefined,
    ghost,
  });
  svg = svg.replace('</svg>', `${overlay}\n</svg>`);
  canvasEl.innerHTML = svg;
}

// ----- mouse ------------------------------------------------------------

const DRAG_THRESH = 6; // px before a press becomes a drag
let drag = null;
let inlineInput = null; // the active inline-edit <input>, if any
let lastLabelClick = null; // { id, x, y, at } of the previous label click (for double-click fallback)
let lastLineClick = null;
let lastWireClick = null; // { key, x, y, at } of the previous wire click (for double-click fallback)
let lastNetClick = null; // { netId, x, y, at } of the previous nets-list click (for double-click fallback)
let lastComponentClick = null; // { refdes, x, y, at } of the previous component-list click

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
  if (drag?.mode === 'copyghost') {
    circuit = Circuit.fromJSON(JSON.parse(drag.ghost.beforeSnapshot));
    wiresDirty = true;
    drag = null;
    copyPending = false;
    copyMode = true;
    selected = null;
    multi.clear();
    selLabel = null;
    selLabels.clear();
    selectedWire = null;
    selectedWires.clear();
    selectedNets.clear();
    render();
    return;
  }
  if (drag?.modal) {
    if (drag.startSnapshot) applyJson(drag.startSnapshot);
    drag = null;
    movePending = false;
    copyPending = false;
    render();
    return;
  }
  if (drag && drag.mode === 'wireseg') {
    restoreManagedNetSnapshots(drag.netSnapshots);
    circuit.syncJunctionSolders();
    wiresDirty = true;
  }
  if (drag && drag.mode === 'floatingwire') {
    for (const f of drag.fragments || []) {
      if (f.fixed) {
        if (f.net.fixedPaths[f.branch]) f.net.fixedPaths[f.branch].points = f.orig.map((p) => ({ ...p }));
      } else if (f.net.branches?.[f.branch]) {
        f.net.branches[f.branch] = f.orig.map((p) => ({ ...p }));
        if (f.branch === 0) f.net.route = f.net.branches[0].map((p) => ({ ...p }));
      } else if (f.branch === 0) f.net.route = f.orig.map((p) => ({ ...p }));
    }
    circuit.syncJunctionSolders();
    wiresDirty = true;
  }
  if (drag && drag.mode === 'fixedwire') {
    for (const [net, saved] of drag.fixedSnapshots) {
      net.fixedPaths = saved.fixedPaths.map((entry) => ({
        points: entry.points.map((p) => ({ ...p })),
        start: entry.start ? { ...entry.start } : null,
        end: entry.end ? { ...entry.end } : null,
      }));
      net.junctions = saved.junctions.map((p) => ({ ...p }));
    }
    circuit.syncJunctionSolders();
    wiresDirty = true;
  }
  if (drag && drag.mode === 'fixedendpoint') {
    circuit.restoreFixedGeometry(drag.net, drag.saved.fixedPaths, drag.saved.junctions);
    wiresDirty = true;
  }
  // A cancelled shape gesture abandons the whole two-point draft. The tool
  // remains armed, so the next click starts a fresh annotation.
  if (drag?.mode === 'annotationplace') annotationStart = null;
  if (drag?.mode === 'annotationlineplace') annotationPoints = [];
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
  const found = boxSelectionContents(x0, y0, x1, y1);
  if (shift) {
    const set = new Set(multi);
    for (const r of found.refs) set.add(r);
    setSelection([...set], undefined, true);
    const labSet = new Set(selLabels);
    for (const id of found.labels) labSet.add(id);
    setLabelSelection([...labSet], undefined, true);
    selectedWires = new Set([...selectedWires, ...found.wires]);
  } else {
    setSelection(found.refs, undefined, true);
    setLabelSelection(found.labels, undefined, true);
    selectedWires = new Set(found.wires);
  }
  syncSelectedWire();
  selectedNets = shift ? new Set([...selectedNets, ...found.nets]) : new Set(found.nets);
}

/** Purely compute the objects a contained marquee/visual box would select. */
function boxSelectionContents(x0, y0, x1, y1) {
  const box = worldRect({ x: x0, y: y0 }, { x: x1, y: y1 });
  const refs = [];
  for (const c of circuit.components.values()) {
    if (rectContained(c.bboxWorld(), box)) refs.push(c.refdes);
  }
  const labels = [];
  for (const label of circuit.labels.values()) {
    if (rectContained(label.bbox(), box)) labels.push(label.id);
  }
  const nets = [];
  const wires = [];
  for (const net of circuit.nets.values()) {
    if (netInBox(net, box)) nets.push(net.id);
    for (const s of containedWireSegments(net.paths(), box)) wires.push(`${net.id}:${s.branch}:${s.segment}`);
  }
  return { refs, labels, nets, wires };
}

function beginMarqueeSelection(startWorld, startClient, ev) {
  cursor = { x: snap(startWorld.x), y: snap(startWorld.y) };
  if (!ev.shiftKey) setSelection([]);
  drag = {
    mode: 'marquee',
    startClient,
    startWorld,
    startSelection: new Set(multi),
    startLabelSelection: new Set(selLabels),
    shift: ev.shiftKey,
    moved: false,
    rubber: null,
  };
  render();
}

function hasSelectableObjectAt(world) {
  return !!(pickLabel(world) || annotationEndpointAt(world) ||
    annotationTextAt(world) || annotationGeometryAt(world) || pickWire(world) || pickAt(world));
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
  const candidates = [];
  for (const net of circuit.nets.values()) {
    const paths = net.paths();
    for (let bi = 0; bi < paths.length; bi++) {
      const pts = paths[bi];
      for (let i = 1; i < pts.length; i++) {
        if (pts[i].x === pts[i - 1].x && pts[i].y === pts[i - 1].y) continue;
        const distance = Math.min(
          distToSegment(w.x, w.y, pts[i - 1], pts[i]),
          distToSegment(snapped.x, snapped.y, pts[i - 1], pts[i]),
        );
        if (distance < tol) candidates.push({ net, branch: bi, seg: i, pts, distance });
      }
    }
  }
  return chooseWireHitCandidate({
    candidates,
    selectedNets,
    diagnosticNets: diagnosticSelection.nets,
  });
}

function fixedWireDragAt(hit, w, startClient, ev) {
  const points = hit.net.fixedPaths?.[hit.branch]?.points || hit.pts || [];
  if (points.length < 2) return false;
  const p = paneSize();
  const tol = 12 / (p ? view.w / p.w : 1);
  let vertex = -1;
  let distance = tol;
  points.forEach((point, index) => {
    const d = Math.hypot(point.x - w.x, point.y - w.y);
    if (d < distance) { distance = d; vertex = index; }
  });
  let junction = -1;
  distance = tol;
  hit.net.junctions.forEach((point, index) => {
    const d = Math.hypot(point.x - w.x, point.y - w.y);
    if (d < distance) { distance = d; junction = index; }
  });
  const fixedSnapshots = new Map();
  for (const net of circuit.nets.values()) {
    if (net.routingMode !== 'fixed') continue;
    fixedSnapshots.set(net, {
      fixedPaths: net.fixedPaths.map((entry) => ({
        points: entry.points.map((p) => ({ ...p })),
        start: entry.start ? { ...entry.start } : null,
        end: entry.end ? { ...entry.end } : null,
      })),
      junctions: net.junctions.map((p) => ({ ...p })),
    });
  }
  drag = {
    mode: 'fixedwire', net: hit.net, branch: hit.branch, seg: hit.seg,
    vertex, junction, startWorld: w, startClient, moved: false, committed: false,
    fixedSnapshots, startSnapshot: snapshot(), rubber: null,
  };
  cursor = { x: snap(w.x), y: snap(w.y) };
  logLine(junction >= 0 ? 'legacy fixed junction — drag to move its dot' : vertex >= 0 ? 'legacy fixed vertex — drag to move it' : 'legacy fixed path — drag to move its segment');
  render();
  return true;
}

function fixedEndpointDragAt(endpoint, startWorld, startClient) {
  const net = circuit.nets.get(endpoint.netId);
  if (!net) return false;
  const saved = {
    fixedPaths: net.fixedPaths.map((entry) => ({
      points: entry.points.map((p) => ({ ...p })),
      start: entry.start ? { ...entry.start } : null,
      end: entry.end ? { ...entry.end } : null,
    })),
    junctions: net.junctions.map((p) => ({ ...p })),
  };
  drag = {
    mode: 'fixedendpoint', endpoint, net, startWorld, startClient,
    moved: false, committed: false, startSnapshot: snapshot(), saved,
  };
  cursor = { x: snap(startWorld.x), y: snap(startWorld.y) };
  logLine('legacy fixed open endpoint — drag to move, or use Wire to extend');
  render();
  return true;
}

function commitFixedEndpointDraft(source, target, points, mode) {
  if (!source || !target) return false;
  const before = snapshot();
  const net = circuit.nets.get(source.netId);
  if (!net) return false;
  const saved = {
    fixedPaths: net.fixedPaths.map((entry) => ({
      points: entry.points.map((p) => ({ ...p })),
      start: entry.start ? { ...entry.start } : null,
      end: entry.end ? { ...entry.end } : null,
    })),
    junctions: net.junctions.map((p) => ({ ...p })),
  };
  try {
    const targetPoint = typeof target === 'string'
      ? (() => { const ref = circuit.resolveTerm(target); return circuit.components.get(ref.comp).terminalWorld(ref.term); })()
      : target.point;
    const entry = net.fixedPaths[source.pathIndex];
    const oldLength = entry?.points.length || 0;
    circuit.extendFixedEndpoint(source, [...points, targetPoint], { mode, active: true });
    const extended = net.fixedPaths[source.pathIndex];
    const endpointIndex = source.endpointIndex === 0 ? 0 : extended.points.length - 1;
    // Prepending changes the original path's segment indexes. Keep an explicit
    // same-path target pointing to its original geometry after the new suffix.
    let resolvedTarget = target;
    if (target && typeof target !== 'string') {
      const preTargetPath = circuit.nets.get(target.netId)?.paths()?.[target.pathIndex];
      const wasInterior = preTargetPath && !(
        (target.point.x === preTargetPath[0].x && target.point.y === preTargetPath[0].y) ||
        (target.point.x === preTargetPath.at(-1).x && target.point.y === preTargetPath.at(-1).y)
      );
      resolvedTarget = { ...target, interior: !!wasInterior };
      if (target.netId === source.netId && target.pathIndex === source.pathIndex && source.endpointIndex === 0) {
        resolvedTarget.segmentIndex += extended.points.length - oldLength;
      }
    }
    const result = circuit.attachWireEndpoint(source.netId, source.pathIndex, endpointIndex, resolvedTarget);
    history.push(before);
    if (history.length > 200) history.shift();
    future.length = 0;
    wiresDirty = true;
    logLine(`fixed endpoint attached to ${typeof target === 'string' ? target : `net ${target.netId}`}`);
    return result;
  } catch (err) {
    circuit.restoreFixedGeometry(net, saved.fixedPaths, saved.junctions);
    logLine(String(err.message || err));
    return null;
  }
}

/** Arm a rigid drag for complete branches of floating (zero-terminal) nets.
 * Detached moves split selected islands from attached nets first, then use
 * this path so every selected orthogonal or diagonal segment retains shape. */
function floatingWireDragAt(hit, startWorld, startClient, ev, moveKeys) {
  const fragments = [];
  for (const key of moveKeys) {
    const w = keyToWire(key);
    const net = circuit.nets.get(w.netId);
    if (!net || net.terminals.length || net.routingMode === 'managed' && !net.branches?.[w.branch] && !net.route) continue;
    const live = net.routingMode === 'fixed' ? net.fixedPaths[w.branch]?.points : net.branches?.[w.branch] || (w.branch === 0 ? net.route : null);
    if (!live || live.length < 2) continue;
    const selected = [...moveKeys].filter((k) => {
      const q = keyToWire(k); return q.netId === net.id && q.branch === w.branch;
    });
    const count = new Set(selected.map((k) => keyToWire(k).segment)).size;
    if (count !== live.length - 1) return false; // partial: use safe old behavior
    if (!fragments.some((f) => f.net === net && f.branch === w.branch)) {
      fragments.push({ net, branch: w.branch, orig: live.map((p) => ({ ...p })), fixed: net.routingMode === 'fixed' });
    }
  }
  if (!fragments.length) return false;
  drag = {
    mode: 'floatingwire', fragments, startWorld, startClient, moved: false,
    committed: false, startSnapshot: snapshot(), shift: ev.shiftKey,
    key: `${hit.net.id}:${hit.branch}:${hit.seg}`,
  };
  cursor = { x: snap(startWorld.x), y: snap(startWorld.y) };
  render();
  return true;
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
  return circuit.rerouteNet(net, moved);
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

/** Identify the kind of endpoint at a managed path boundary.  Terminal
 * membership wins when a terminal and a junction intentionally share a grid
 * point: that endpoint must remain attached to the component pin. */
function managedEndpointMeta(net, point) {
  const terminal = net.terminals.find((t) => {
    const c = circuit.components.get(t.comp);
    const p = c?.terminalWorld(t.term);
    return p && p.x === point.x && p.y === point.y;
  });
  if (terminal) {
    const c = circuit.components.get(terminal.comp);
    const def = c?.def.terminals.find((t) => t.name === terminal.term);
    return {
      type: 'terminal', comp: terminal.comp, term: terminal.term, point: { ...point },
      dir: c && def ? pinDir(c, def, point.x, point.y) : null,
    };
  }
  if (net.junctions.some((p) => p.x === point.x && p.y === point.y)) return { type: 'junction', point: { ...point } };
  return { type: 'free', point: { ...point } };
}
/** Restore a collapsed interior run so an earlier zero-clearance edit remains
 * reversible. The hint is transient editor state; ordinary authored straight
 * pin-to-pin wires retain their historical immovability. */
function editableManagedPath(net, branch, path) {
  const hint = net?._wireRunHint;
  if (!hint || hint.branch !== branch || !path || path.length !== 2 ||
      !hint.endpoints?.every((p, i) => p.x === path[i].x && p.y === path[i].y)) {
    return { path, interiorRun: false };
  }
  const axis = hint.orient;
  const line = axis === 'h' ? path[0].y : path[0].x;
  const last = hint.orig.length - 1;
  const restored = hint.orig.map((p, i) => {
    if (i === 0 || i === last) return { ...path[i === 0 ? 0 : 1] };
    return axis === 'h' ? { x: p.x, y: line } : { x: line, y: p.y };
  });
  if (net.branches?.[branch]) net.branches[branch] = restored;
  else if (branch === 0) net.route = restored;
  return { path: restored, interiorRun: true };
}
function managedWireBreaks(net) {
  return new Set((net?.anchorWorlds?.() || []).map((p) => `${p.x},${p.y}`));
}

/** Propagate a moved managed junction endpoint to every branch that shares it.
 * The edited branch has already moved its endpoint, so only points still at
 * the old coordinate need updating. */
function moveManagedJunction(net, oldPoint, newPoint) {
  if (oldPoint.x === newPoint.x && oldPoint.y === newPoint.y) return;
  const paths = net.branches?.length ? net.branches : net.route ? [net.route] : [];
  net.junctions = moveJunctionEndpoint(
    paths,
    net.junctions,
    oldPoint,
    newPoint,
    (path, index) => managedEndpointMeta(net, path[index]),
  );
}

/** Apply a wire-run edit while keeping junction endpoints and their incident
 * branches topologically joined. */
function moveManagedWireRun(run, target) {
  const endpoints = [
    run.endpointMeta?.start?.point && { ...run.endpointMeta.start.point },
    run.endpointMeta?.end?.point && { ...run.endpointMeta.end.point },
  ];
  run.line = moveWireRun(run.pts, run.orient, run.line, target, run.endpointMeta);
  for (const i of [0, 1]) {
    const meta = run.endpointMeta?.[i === 0 ? 'start' : 'end'];
    const oldPoint = endpoints[i];
    if (meta?.type !== 'junction' || !oldPoint) continue;
    const actualPoint = i === 0 ? run.pts[0] : run.pts[run.pts.length - 1];
    // Topology-bounded runs keep junction endpoints fixed and add connector
    // legs. Only legacy unbounded bridge moves propagate the junction.
    if (actualPoint?.x === oldPoint.x && actualPoint?.y === oldPoint.y) continue;
    const newPoint = run.orient === 'h'
      ? { x: oldPoint.x, y: run.line }
      : { x: run.line, y: oldPoint.y };
    moveManagedJunction(run.net, oldPoint, newPoint);
  }
  return run.line;
}

/** Restore every managed net touched by a wire drag, including branches and
 * junction metadata. Run-level restoration is insufficient when a moved
 * junction is shared by branches that were not directly selected. */
function restoreManagedNetSnapshots(snapshots) {
  for (const saved of snapshots?.values?.() || []) {
    const net = circuit.nets.get(saved.id) || saved.net;
    if (!net) continue;
    net.route = saved.route ? saved.route.map((p) => ({ ...p })) : null;
    net.branches = saved.branches ? saved.branches.map((b) => b.map((p) => ({ ...p }))) : null;
    net.junctions = saved.junctions.map((p) => ({ ...p }));
  }
}

/** Keep the legacy single-route view in lockstep with explicit managed
 * branches. A bridge may leave reduction as a no-op, so relying on
 * _reduceNet() to rewrite `route` leaves debug/ASCII consumers stale. */
function syncManagedRoute(net) {
  if (net.routingMode !== 'managed' || !net.branches) return;
  net.route = net.branches[0] ? net.branches[0].map((p) => ({ ...p })) : null;
}

/** Validate managed paths after a literal bridge edit. This intentionally
 * checks all branches of the affected net, not just the dragged bridge: moving
 * a junction can make an unselected incident leg diagonal or drill a body. */
function managedGeometryErrors(net) {
  const errors = [...net.wiringErrors()];
  const env = netEnv(net.id);
  const terminalAt = (point) => net.terminals.find((t) => {
    const c = circuit.components.get(t.comp);
    const p = c?.terminalWorld(t.term);
    return p && p.x === point.x && p.y === point.y;
  });
  const pinStep = (terminal, point) => {
    const c = circuit.components.get(terminal.comp);
    const def = c?.def.terminals.find((t) => t.name === terminal.term);
    return c && def ? pinDir(c, def, point.x, point.y) : null;
  };
  const step = (a, b) => ({ x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) });
  for (const [bi, path] of net.paths().entries()) {
    if (path.length < 2) continue;
    const first = terminalAt(path[0]);
    const last = terminalAt(path[path.length - 1]);
    if (first) {
      const dir = pinStep(first, path[0]);
      const actual = step(path[0], path[1]);
      if (dir && (actual.x !== dir.x || actual.y !== dir.y)) errors.push(`branch ${bi} leaves ${first.comp}.${first.term} against its pin direction`);
    }
    if (last) {
      const dir = pinStep(last, path[path.length - 1]);
      const actual = step(path[path.length - 1], path[path.length - 2]);
      if (dir && (actual.x !== dir.x || actual.y !== dir.y)) errors.push(`branch ${bi} enters ${last.comp}.${last.term} against its pin direction`);
    }
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      for (const rect of env.rects) if (segThroughInterior(a, b, rect)) {
        errors.push(`branch ${bi} crosses component body`);
        break;
      }
    }
  }
  return errors;
}

/** Connect two terminals, route only their new connection branch, and commit
 *  history once. Hand-drawn orthogonal or diagonal waypoints are preserved by
 *  Circuit#wireTo; topology growth never refreshes the existing net. */
function wireRouteOptions(targetIdentity = null) {
  const options = wire?.routeStyle === 'diagonal'
    ? { routeStyle: 'diagonal', allowDiagonal: true }
    : { routeStyle: 'orthogonal', allowDiagonal: false };
  if (targetIdentity) options.targetIdentity = targetIdentity;
  return options;
}

function newWireDraft() {
  const style = wire?.routeStyle === 'diagonal' || routeMode === 'diagonal'
    ? 'diagonal'
    : 'orthogonal';
  return {
    source: null,
    points: [],
    routeStyle: style,
    allowDiagonal: style === 'diagonal',
  };
}

function connectTwo(src, dst, points) {
  const before = snapshot();
  const meet = circuit.components.get(dst.refdes).terminalWorld(dst.term);
  const net = circuit.wireTo(`${src.refdes}.${src.term}`, meet, points, wireRouteOptions());
  wiresDirty = true; // wireTo grew / spliced a net
  history.push(before);
  future.length = 0;
  // Stay in wiring mode so the next click can start another connection.
  wire = newWireDraft();
  setSelection([dst.refdes]);
  selectedNets = new Set([net.id]);
  logLine(`net ${net.id}: ${net.terminals.map((t) => `${t.comp}.${t.term}`).join('  ')}; len=${net.length()}`);
}

function doDirectWireClick(x, y, fixedEndpoint = null) {
  if (fixedEndpoint && !directWire.source) {
    directWire.source = { fixed: fixedEndpoint };
    directWire.points = [];
    cursor = { x: fixedEndpoint.point.x, y: fixedEndpoint.point.y };
    logLine(`${activeDirectLabel()} from fixed open endpoint @ (${fixedEndpoint.point.x},${fixedEndpoint.point.y}) — click waypoints, then target`);
    render();
    return;
  }
  if (fixedEndpoint && directWire.source?.fixed) {
    const result = commitFixedEndpointDraft(directWire.source.fixed, fixedEndpointTarget(fixedEndpoint), directWire.points, 'literal');
    if (result) directWire = { source: null, points: [] };
    render();
    return;
  }
  const hit = nearestTerminal({ x, y });
  if (hit) {
    if (!directWire.source) {
      directWire.source = { refdes: hit.refdes, term: hit.term };
      cursor = { x: hit.x, y: hit.y };
      logLine(`${activeDirectLabel()} from ${hit.refdes}.${hit.term} — click points, then a target terminal`);
    } else if (directWire.source.fixed) {
      const result = commitFixedEndpointDraft(directWire.source.fixed, `${hit.refdes}.${hit.term}`, directWire.points, 'literal');
      if (result) directWire = { source: null, points: [] };
    } else if (hit.refdes === directWire.source.refdes && hit.term === directWire.source.term) {
      logLine('same terminal — click the other terminal');
    } else {
      commitDirectWire({ refdes: hit.refdes, term: hit.term });
    }
  } else if (directWire.source) {
    // Direct mode treats every non-terminal click as a literal waypoint. In
    // particular, crossing an existing wire never splices or joins it.
    directWire.points.push({ x, y });
    cursor = { x, y };
    logLine(`direct point @ (${x},${y})`);
  } else {
    logLine(`${activeDirectLabel()}: click a terminal or open fixed endpoint to start`);
  }
  render();
}

function commitDirectWire(dst) {
  const before = snapshot();
  const directKind = directWire?.routeMode === 'diagonal' ? 'diagonal' : 'legacy fixed';
  try {
    const net = circuit.wireDirectTo(
      `${directWire.source.refdes}.${directWire.source.term}`,
      `${dst.refdes}.${dst.term}`,
      directWire.points,
    );
    history.push(before);
    if (history.length > 200) history.shift();
    future.length = 0;
    wiresDirty = true;
    directWire = { source: null, points: [] };
    setSelection([dst.refdes]);
    selectedNets = new Set([net.id]);
    logLine(`${directKind} wire committed on net ${net.id}`);
  } catch (err) {
    logLine(String(err.message || err));
  }
}

function commitDirectAtCursor() {
  if (!directWire?.source) {
    logLine(`${activeDirectLabel()}: click a terminal or open fixed endpoint to start`);
    return;
  }
  const hit = nearestTerminal(cursor);
  if (hit && directWire.source.fixed) {
    const result = commitFixedEndpointDraft(directWire.source.fixed, `${hit.refdes}.${hit.term}`, directWire.points, 'literal');
    if (result) directWire = { source: null, points: [] };
  } else if (hit) commitDirectWire(hit);
  else if (directWire.source.fixed) {
    const target = exactWireTargetAt(cursor);
    if (target?.ambiguous) logLine(`${activeDirectLabel()}: wire target is ambiguous — select one exact path`);
    else if (target) {
      const result = commitFixedEndpointDraft(directWire.source.fixed, target, directWire.points, 'literal');
      if (result) directWire = { source: null, points: [] };
    } else logLine(`${activeDirectLabel()}: point at a terminal or exact wire target to commit`);
  }
  else logLine(`${activeDirectLabel()}: point at a terminal to commit (Esc cancels)`);
  render();
}

/** World point of a wire source: a component terminal or a free point. */
function wireOrigin(src) {
  if (!src) return null;
  if (src.fixed) return { ...src.fixed.point };
  if (src.refdes) {
    const comp = circuit.components.get(src.refdes);
    return comp ? comp.terminalWorld(src.term) : null;
  }
  return { x: src.x, y: src.y };
}

function activeDirectLabel() {
  return directWire?.routeMode === 'diagonal' ? 'DIAGONAL WIRE' : 'LEGACY FIXED WIRE';
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

function doWireClick(x, y, terminalHit, fixedEndpoint = null, fixedTarget = null) {
  const hit = terminalHit || matchAt(x, y);
  if (fixedEndpoint && !wire.source) {
    wire.source = { fixed: fixedEndpoint };
    wire.points = [];
    cursor = { x: fixedEndpoint.point.x, y: fixedEndpoint.point.y };
    logLine(`wire from fixed open endpoint @ (${fixedEndpoint.point.x},${fixedEndpoint.point.y}) — click points, then target`);
    return;
  }
  if (fixedEndpoint && wire.source?.fixed) {
    const target = fixedEndpointTarget(fixedEndpoint);
    const result = commitFixedEndpointDraft(wire.source.fixed, target, wire.points, 'smart');
    if (result) wire = newWireDraft();
    return;
  }
  if (fixedTarget && wire.source?.fixed) {
    if (fixedTarget.ambiguous) logLine('wire target is ambiguous — select one exact path');
    else if (commitFixedEndpointDraft(wire.source.fixed, fixedTarget, wire.points, 'smart')) wire = newWireDraft();
    return;
  }
  if (hit && hit.term) {
    if (!wire.source) {
      wire.source = { refdes: hit.refdes, term: hit.term };
      wire.points = [];
      cursor = { x: hit.x ?? x, y: hit.y ?? y };
      logLine(`wire from ${hit.refdes}.${hit.term} — terminal clicks commit; other clicks guide; Enter commits elsewhere`);
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
    const wireHit = pickWire({ x, y });
    if (wire.routeStyle === 'diagonal' && wireHit) {
      const target = exactWireTargetAt({ x, y });
      if (target?.ambiguous) {
        logLine('diagonal wire target is ambiguous — select one exact path');
        render();
        return;
      }
      else if (target && target.netId === wireHit.net.id && target.pathIndex === wireHit.branch) {
        joinWireToNet(wireHit);
        render();
        return;
      }
    }
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
    let P;
    let k;
    if (wire.routeStyle === 'diagonal') {
      const target = exactWireTargetAt(w);
      if (target?.ambiguous || !target || target.netId !== wireHit.net.id || target.pathIndex !== wireHit.branch) {
        logLine('diagonal wire must start at one exact point on the selected wire');
        return;
      }
      P = target.point;
      k = target.segmentIndex - 1;
    } else ({ P, k } = projectOnNet(wireHit.net, w, wireHit.branch));
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
    logLine('wire from a free point — click points, then commit');
  }
}

/** Pressing Enter in wire mode commits the draft wire: onto a terminal,
 *  another wire, or as an open-ended managed branch in empty space. */
function commitWireAtCursor() {
  if (!wire || !wire.source) {
    logLine('start a wire by clicking a terminal (or any point) first');
    return;
  }
  const hit = nearestTerminal(cursor);
  if (hit) {
    try { connectWireToTerminal(hit); } catch (err) { logLine(String(err.message || err)); }
    render();
    return;
  }
  const wireHit = pickWire(cursor);
  if (wireHit) {
    if (wire.source.fixed) {
      const target = exactWireTargetAt(cursor);
      if (target?.ambiguous) logLine('wire target is ambiguous — select one exact wire target');
      else if (target && commitFixedEndpointDraft(wire.source.fixed, target, wire.points, 'smart')) wire = newWireDraft();
      else if (!target) logLine('point the cursor at one exact wire target to commit');
      render();
      return;
    }
    joinWireToNet(wireHit);
    render();
    return;
  }
  if (wire.source.fixed) {
    logLine('point the cursor at a terminal or a wire to commit (Esc cancels)');
    return;
  }
  const path = draftRoutePath(wire, cursor);
  if (!path || path.length < 2) {
    logLine('unable to route wire safely');
    render();
    return;
  }
  const before = snapshot();
  try {
    const points = path.slice(1, -1);
    const net = wire.source.refdes
      ? circuit.wireTo(`${wire.source.refdes}.${wire.source.term}`, path[path.length - 1], points, wireRouteOptions())
      : circuit.wirePointTo(wire.source, path[path.length - 1], points, wire.source.netId, wireRouteOptions());
    wiresDirty = true;
    history.push(before);
    future.length = 0;
    wire = newWireDraft();
    if (net) selectedNets = new Set([net.id]);
    logLine(`wire ${net.id}: open-ended route; len=${net.length()}`);
  } catch (err) {
    logLine(String(err.message || err));
  }
  render();
}

/** Commit the draft wire onto a component terminal. Terminal-origin wires go
 *  through connectTwo; free-point / on-wire-origin drafts splice into the
 *  target net without disturbing its existing wire. */
function connectWireToTerminal(dst) {
  const src = wire.source;
  if (src.fixed) {
    if (commitFixedEndpointDraft(src.fixed, `${dst.refdes}.${dst.term}`, wire.points, 'smart')) wire = newWireDraft();
    return;
  }
  const end = circuit.components.get(dst.refdes).terminalWorld(dst.term);
  const draftPath = wire.points.length ? draftRoutePath(wire, end) : null;
  if (wire.points.length && (!draftPath || draftPath.length < 2)) {
    logLine('unable to route wire safely');
    return;
  }
  const points = draftPath ? draftPath.slice(1, -1) : wire.points;
  if (src.refdes) {
    connectTwo(src, dst, points);
    return;
  }
  const before = snapshot();
  const net = circuit.wirePointTo({ x: src.x, y: src.y }, end, points, src.netId, wireRouteOptions());
  wiresDirty = true; // a draft spliced into the target net
  history.push(before);
  future.length = 0;
  wire = newWireDraft();
  selectedNets = new Set([net.id]);
  logLine(`wired into net ${net.id} at ${dst.refdes}.${dst.term}; len=${net.length()}`);
}

/** Join the draft wire into an existing net at the cursor's point on that net's
 *  route. Junction solder dots are derived from the resulting geometry. */
function joinWireToNet(wireHit) {
  const src = wire.source;
  let targetIdentity = null;
  let P;
  let k;
  if (wire.routeStyle === 'diagonal') {
    targetIdentity = exactWireTargetAt(cursor);
    if (targetIdentity?.ambiguous) {
      logLine('diagonal wire target is ambiguous — select one exact wire target');
      return;
    }
    if (!targetIdentity || targetIdentity.netId !== wireHit.net.id || targetIdentity.pathIndex !== wireHit.branch) {
      logLine('diagonal wire target must be one exact point on the selected wire');
      return;
    }
    P = targetIdentity.point;
    k = targetIdentity.segmentIndex - 1;
  } else {
    ({ P, k } = projectOnNet(wireHit.net, cursor, wireHit.branch));
  }
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
  const draftPath = draftRoutePath(wire, P);
  if (!draftPath || draftPath.length < 2) {
    logLine('unable to route wire safely');
    return;
  }
  const points = draftPath.slice(1, -1);
  const net = src.refdes
    ? circuit.wireTo(`${src.refdes}.${src.term}`, P, points, wireRouteOptions(targetIdentity))
    : circuit.wirePointTo(src, P, points, src.netId, wireRouteOptions(targetIdentity));
  wiresDirty = true; // a draft joined into an existing net
  history.push(before);
  future.length = 0;
  wire = newWireDraft();
  selectedNets = new Set([net.id]);
  logLine(`joined into net ${net.id} at (${P.x},${P.y})`);
}


function managedWireDragAt(wireHit, startWorld, startClient, ev, modal = false) {
  const net = wireHit.net;
  const key = `${net.id}:${wireHit.branch}:${wireHit.seg}`;
  const moveKeys = ev.shiftKey || selectedWires.has(key)
    ? new Set([...selectedWires, key])
    : new Set([key]);
  const runs = [];
  const diagonalSelection = [...moveKeys].filter((selectedKey) => {
    const selected = keyToWire(selectedKey);
    const selectedNet = circuit.nets.get(selected.netId);
    return selectedNet && diagonalWireKeys(selectedNet).has(selectedKey);
  });
  if (diagonalSelection.length) {
    const required = new Set();
    for (const selectedKey of diagonalSelection) {
      const selected = keyToWire(selectedKey);
      for (const diagonalKey of diagonalWireKeys(circuit.nets.get(selected.netId))) required.add(diagonalKey);
    }
    if ([...required].some((diagonalKey) => !moveKeys.has(diagonalKey))) {
      logLine('connected move blocked: select the complete diagonal structure first');
      return false;
    }
  }
  const seenRun = new Set();
  for (const k of moveKeys) {
    const selected = keyToWire(k);
    const currentNet = circuit.nets.get(selected.netId);
    if (!currentNet) continue;
    let pts = currentNet.branches && currentNet.branches[selected.branch] && currentNet.branches[selected.branch].length >= 2
      ? currentNet.branches[selected.branch]
      : currentNet.route && currentNet.route.length >= 2 ? currentNet.route : currentNet.points().slice();
    const breaks = managedWireBreaks(currentNet);
    const selectedPath = selected.netId === net.id && selected.branch === wireHit.branch ? wireHit.pts : pts;
    const selectedRun = wireRunAt(selectedPath, selected.segment, breaks);
    const editable = editableManagedPath(currentNet, selected.branch, pts);
    pts = editable.path;
    const run = editable.interiorRun
      ? { orient: selectedRun.orient, val: selectedRun.val }
      : wireRunAt(pts, selected.segment, breaks);
    const runBounds = editable.interiorRun
      ? { lo: 1, hi: pts.length - 2 }
      : { lo: run.lo, hi: run.hi };
    const runKey = `${currentNet.id}:${selected.branch}:${run.orient}:${run.val}:${runBounds.lo}:${runBounds.hi}`;
    if (seenRun.has(runKey)) continue;
    seenRun.add(runKey);
    const endpointMeta = {
      start: managedEndpointMeta(currentNet, pts[runBounds.lo]),
      end: managedEndpointMeta(currentNet, pts[runBounds.hi]),
      segment: selected.segment,
      breaks,
      runBounds,
      interiorRun: editable.interiorRun,
    };
    runs.push({
      net: currentNet,
      branch: selected.branch,
      seg: selected.segment,
      pts,
      orig: pts.map((p) => ({ ...p })),
      orient: run.orient,
      line: run.val,
      startLine: run.val,
      hadRoute: !!(currentNet.route && currentNet.route.length >= 2),
      endpointMeta,
      junctionBridge: pts.length === 2 &&
        endpointMeta.start.type === 'junction' && endpointMeta.end.type === 'junction',
    });
  }
  const primary = runs.find((r) => r.net === net && r.branch === wireHit.branch && r.seg === wireHit.seg) || runs[0];
  if (!primary) return false;
  const dragRuns = runs.filter((r) => r.orient === primary.orient);
  const netSnapshots = new Map();
  for (const r of dragRuns) {
    if (netSnapshots.has(r.net.id)) continue;
    netSnapshots.set(r.net.id, {
      id: r.net.id,
      net: r.net,
      route: r.net.route ? r.net.route.map((p) => ({ ...p })) : null,
      branches: r.net.branches ? r.net.branches.map((b) => b.map((p) => ({ ...p }))) : null,
      junctions: r.net.junctions.map((p) => ({ ...p })),
    });
  }
  cursor = { x: snap(startWorld.x), y: snap(startWorld.y) };
  drag = {
    mode: 'wireseg',
    modal,
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
    netSnapshots,
  };
  render();
  return true;
}

function canvasMouseDown(ev) {
  if (document.activeElement === cmdInput) cmdInput.blur();
  const b = ev.button;
  const startWorld = clientToWorld(ev.clientX, ev.clientY);
  const startClient = { x: ev.clientX, y: ev.clientY };

  if (b === 1) {
    ev.preventDefault();
    drag = {
      mode: 'pan',
      startClient,
      startWorld,
      startView: { ...view },
      rubber: null,
      resume: drag,
    };
    return;
  }
  if (b === 2) {
    const hit = matchAt(snap(startWorld.x), snap(startWorld.y));
    if (hit?.refdes && circuit.components.has(hit.refdes)) {
      ev.preventDefault();
      drag = null;
      return;
    }
    ev.preventDefault();
    drag = { mode: 'zoom', startClient, startWorld, moved: false, rubber: null };
    return;
  }
  if (b !== 0) return;
  if (deleteMode) {
    // Defer the click action until mouseup so a real drag can form a box.
    // A stationary click keeps the existing Delete-mode semantics.
    drag = {
      mode: 'deletemarquee',
      startClient,
      startWorld,
      startSelection: new Set(multi),
      startLabelSelection: new Set(selLabels),
      moved: false,
      rubber: null,
    };
    return;
  }
  if (drag?.mode === 'copyghost') {
    cursor = { x: snap(startWorld.x), y: snap(startWorld.y) };
    moveCopyGhost(startWorld);
    commitCopyGhost();
    return;
  }
  // Modal move/copy destination clicks must win over object picking. This
  // keeps a destination on a label, wire, or terminal from being treated as a
  // new source.
  if (drag?.modal && (movePending || copyPending)) {
    drag.commitPoint = { world: { ...startWorld }, client: { ...startClient } };
    cursor = { x: snap(startWorld.x), y: snap(startWorld.y) };
    commitModalMove();
    return;
  }
  // Armed move/copy tools use an empty-space drag for box selection. Object
  // clicks retain their existing source/drag behavior and can start a ghost.
  if (!movePending && !copyPending && (moveMode || copyMode) &&
      !hasSelectableObjectAt(startWorld)) {
    beginMarqueeSelection(startWorld, startClient, ev);
    return;
  }
  if (copyMode) {
    beginCopySource(startWorld, startClient);
    return;
  }

  const openEndpoint = openFixedEndpointAt(startWorld);

  if (labelMode === 'line') {
    cursor = { x: snap(startWorld.x), y: snap(startWorld.y) };
    drag = { mode: 'annotationlineplace', startClient, startWorld, moved: false, previewEnd: { ...cursor }, rubber: null };
    return;
  }
  if (labelMode === 'arrow' || labelMode === 'box') {
    // Keep the cursor and preview anchored to the actual press. When a first
    // click has already established annotationStart, the next press begins
    // with its endpoint visible before any movement occurs.
    cursor = { x: snap(startWorld.x), y: snap(startWorld.y) };
    drag = {
      mode: 'annotationplace',
      startClient,
      startWorld,
      moved: false,
      previewEnd: annotationStart ? { ...cursor } : null,
      rubber: null,
    };
    return;
  }
  if (labelMode) {
    drag = { mode: 'labelplace', startClient, startWorld, moved: false, rubber: null };
    return;
  }

  if (directWire) {
    drag = { mode: 'directpick', startClient, startWorld, fixedEndpoint: openEndpoint };
    return;
  }
  if (wire) {
    if (openEndpoint) {
      drag = { mode: 'wirepick', startClient, startWorld, rubber: null, fixedEndpoint: openEndpoint };
      return;
    }
    // In persistent wiring mode, terminal/empty-space clicks pick wire ends;
    // an interior wire click must remain available for segment dragging.
    // Terminal proximity (not just an exact grid hit) always wins, so a slightly
    // off click on a pin starts/ends the wire instead of selecting the body.
    const terminalHit = nearestTerminal(startWorld);
    const wireHit = pickWire(startWorld);
    if (wire.source?.fixed && !terminalHit && wireHit) {
      drag = { mode: 'wirepick', startClient, startWorld, rubber: null, fixedTarget: exactWireTargetAt(startWorld) };
      return;
    }
    if (terminalHit || !wireHit) {
      drag = { mode: 'wirepick', startClient, startWorld, rubber: null, terminalHit: terminalHit || null };
      return;
    }
  }

  if (moveMode) {
    const moveWireHit = pickWire(startWorld);
    const moveLabelHit = pickLabel(startWorld) || annotationTextAt(startWorld) ||
      annotationGeometryAt(startWorld);
    const componentRef = [...multi].find((refdes) => {
      const box = circuit.components.get(refdes)?.bboxWorld();
      const source = { x: snap(startWorld.x), y: snap(startWorld.y) };
      return box && source.x >= box.x && source.x <= box.x + box.w &&
        source.y >= box.y && source.y <= box.y + box.h;
    }) || null;
    // A preselected component set owns the move gesture regardless of which
    // member was clicked. In particular, a wire in a selected net is a source
    // confirmation, not permission to fall into wire-only editing. Connected
    // and detached moves intentionally share this source decision.
    const refdes = selectedSetMoveSource({
      selectedRefs: multi,
      components: circuit.components,
      componentRef,
      wire: moveWireHit,
      label: moveLabelHit,
      selectedWireKeys: selectedWires,
      selectedNetIds: selectedNets,
      touchedNetIds: netsTouching([...multi]),
      selectedLabelIds: selLabels,
    });
    if (refdes) {
      cursor = { x: snap(startWorld.x), y: snap(startWorld.y) };
      armModalMove({ refdes }, startWorld, startClient);
      return;
    }
    if (moveMode === 'detached' && moveWireHit) {
      const before = snapshot();
      const key = `${moveWireHit.net.id}:${moveWireHit.branch}:${moveWireHit.seg}`;
      const selected = ev.shiftKey || selectedWires.has(key)
        ? new Set([...selectedWires, key])
        : new Set([key]);
      const byNet = new Map();
      for (const selectedKey of selected) {
        const wire = keyToWire(selectedKey);
        if (!byNet.has(wire.netId)) byNet.set(wire.netId, []);
        byNet.get(wire.netId).push({ branch: wire.branch, segment: wire.segment });
      }
      const detachedIds = new Set();
      for (const [id, segments] of byNet) {
        const net = circuit.nets.get(id);
        if (!net) continue;
        const result = splitDetachedWireNet(net, segments, new Set());
        for (const detachedId of result.selectedNetIds) detachedIds.add(detachedId);
      }
      const detachedKeys = new Set();
      for (const id of detachedIds) {
        const net = circuit.nets.get(id);
        for (const [branch, path] of (net?.paths() || []).entries()) {
          for (let segment = 1; segment < path.length; segment++) {
            detachedKeys.add(`${id}:${branch}:${segment}`);
          }
        }
      }
      if (detachedKeys.size && floatingWireDragAt(moveWireHit, startWorld, startClient, ev, detachedKeys)) {
        drag.startSnapshot = before;
        drag.modal = true;
        movePending = true;
        return;
      }
    }
    if (moveWireHit && moveWireHit.net.routingMode === 'fixed') {
      fixedWireDragAt(moveWireHit, startWorld, startClient, ev);
      drag.modal = true;
      movePending = true;
      return;
    }
    if (moveWireHit && moveWireHit.net.terminals.length === 0) {
      const key = `${moveWireHit.net.id}:${moveWireHit.branch}:${moveWireHit.seg}`;
      if (floatingWireDragAt(moveWireHit, startWorld, startClient, ev, new Set([key]))) {
        drag.modal = true;
        movePending = true;
        return;
      }
    }
    if (moveWireHit) {
      managedWireDragAt(moveWireHit, startWorld, startClient, ev, true);
      movePending = true;
      return;
    }
    const moveHit = matchAt(snap(startWorld.x), snap(startWorld.y));
    if (moveHit?.refdes && circuit.components.has(moveHit.refdes)) {
      cursor = { x: snap(startWorld.x), y: snap(startWorld.y) };
      armModalMove(moveHit, startWorld, startClient);
      return;
    }
    const labelHit = pickLabel(startWorld) || annotationTextAt(startWorld);
    if (labelHit) {
      armModalLabelMove(labelHit, startWorld, startClient);
      return;
    }
    const annotationHit = annotationGeometryAt(startWorld) || annotationEndpointAt(startWorld)?.label;
    if (annotationHit) {
      armModalLabelMove(annotationHit, startWorld, startClient);
      return;
    }
    logLine(`${moveMode === 'detached' ? 'detached move' : 'move'}: click a component, label, or wire`);
    return;
  }
  const endpointHit = annotationEndpointAt(startWorld);
  if (endpointHit) {
    setSelection([]);
    setLabelSelection([endpointHit.label.id]);
    drag = { mode: 'annotationendpoint', label: endpointHit.label, endpoint: endpointHit.endpoint, startClient, startWorld, startSnapshot: snapshot(), moved: false };
    return;
  }
  const annotationText = annotationTextAt(startWorld);
  if (annotationText) {
    if (!ev.shiftKey) {
      setSelection([]);
      setLabelSelection([annotationText.id]);
    }
    if (ev.shiftKey) {
      if (selLabels.has(annotationText.id)) {
        selLabels.delete(annotationText.id);
        if (selLabel === annotationText.id) selLabel = selLabels.size ? [...selLabels][0] : null;
      } else {
        selLabels.add(annotationText.id);
        if (!selLabel) selLabel = annotationText.id;
      }
      setLabelSelection([...selLabels], selLabel, true);
      render();
      return;
    }
    if (ev.detail >= 2) {
      setTimeout(() => inlineEditLabel(annotationText), 0);
      return;
    }
    drag = { mode: 'annotationtextmove', label: annotationText, startClient, startWorld, startText: { ...annotationText.textAnchor }, startSnapshot: snapshot(), moved: false };
    render();
    return;
  }
  const annotationSegment = annotationSegmentAt(startWorld);
  if (annotationSegment) {
    setSelection([]);
    setLabelSelection([annotationSegment.label.id]);
    drag = {
      mode: 'annotationsegment',
      label: annotationSegment.label,
      segment: annotationSegment.segment,
      startClient,
      startWorld,
      startPoints: annotationSegment.label.points.map((point) => ({ ...point })),
      startSnapshot: snapshot(),
      moved: false,
    };
    render();
    return;
  }
  const annotationGeometry = annotationGeometryAt(startWorld);
  if (annotationGeometry) {
    if (ev.shiftKey) {
      if (selLabels.has(annotationGeometry.id)) {
        selLabels.delete(annotationGeometry.id);
        if (selLabel === annotationGeometry.id) selLabel = selLabels.size ? [...selLabels][0] : null;
      } else {
        selLabels.add(annotationGeometry.id);
        if (!selLabel) selLabel = annotationGeometry.id;
      }
      setLabelSelection([...selLabels], selLabel, true);
      render();
      return;
    }
    setSelection([]);
    setLabelSelection([annotationGeometry.id]);
    drag = { mode: 'labelmove', labelId: annotationGeometry.id, startClient, startWorld, startAnchors: new Map([[annotationGeometry.id, { x: annotationGeometry.anchor.x, y: annotationGeometry.anchor.y }]]), moved: false, committed: false, duplicate: false };
    render();
    return;
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
      setLabelSelection([...selLabels], selLabel, true);
      render();
      return;
    }
    const selectedMember = selLabels.has(labelHit.id);
    const duplicateLabel = (ev.ctrlKey || ev.metaKey) && selectedMember;
    if (!duplicateLabel && !selectedMember) {
      setSelection([]);
      setLabelSelection([labelHit.id]);
    }
    // A selected label is a confirmation of the whole mixed set, just like a
    // selected component. Do not narrow a multi-label drag to the hit label.
    if (!duplicateLabel && selectedMember && multi.size) {
      beginObjectMove([...multi], [...selLabels], startWorld, startClient);
      return;
    }
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
      duplicate: duplicateLabel,
    };
    render();
    return;
  }

  // In normal mode an editable endpoint takes priority over ordinary wire and
  // component picking, but never over placement or labels drawn above it.
  if (openEndpoint) {
    fixedEndpointDragAt(openEndpoint, startWorld, startClient);
    return;
  }
  // Clicking anywhere that isn't a label resets any pending double-click state.
  lastLabelClick = null;
  lastWireClick = null;

  // Wires render behind component bodies, but remain selectable inside or
  // along them. Hit order: exact TERMINAL, then WIRE, then component bbox,
  // then empty space.
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
    if (net.terminals.length === 0 && net.routingMode !== 'fixed') {
      const floatingKey = `${net.id}:${wireHit.branch}:${wireHit.seg}`;
      const floatingKeys = ev.shiftKey || selectedWires.has(floatingKey)
        ? new Set([...selectedWires, floatingKey]) : new Set([floatingKey]);
      if (floatingWireDragAt(wireHit, startWorld, startClient, ev, floatingKeys)) return;
    }
    if (net.routingMode === 'fixed') {
      const key = `${net.id}:${wireHit.branch}:${wireHit.seg}`;
      if (ev.detail >= 2) {
        setSelection([]);
        selectedWire = null;
        selectedWires.clear();
        selectedNets = new Set([net.id]);
        logLine(`selected fixed net ${net.id} — geometry is literal; open endpoints can be reconnected`);
        render();
        return;
      }
      fixedWireDragAt(wireHit, startWorld, startClient, ev);
      drag.fixedKey = key;
      drag.fixedShift = ev.shiftKey;
      return;
    }
    // The run is found from the drawn polyline (a specific branch for joined
    // nets), materialized into a local array so a plain click never mutates the
    // net — only an actual drag attaches a route (and Escape restores `orig`).
    const key = `${net.id}:${wireHit.branch}:${wireHit.seg}`;
    // Double-click a wire selects its NET. Defer that selection until mouseup
    // so a second click can still become a real drag when the pointer moves.
    // Headless CDP never fires a native `dblclick`, hence the timing fallback.
    const now = Date.now();
    const prevWireClick = lastWireClick;
    lastWireClick = { key, x: startWorld.x, y: startWorld.y, at: now };
    const doubleWireClick = ev.detail >= 2 ||
      (prevWireClick &&
        prevWireClick.key === key &&
        now - prevWireClick.at < 500 &&
        Math.abs(startWorld.x - prevWireClick.x) <= GRID &&
        Math.abs(startWorld.y - prevWireClick.y) <= GRID);
    // Shift+click (or clicking a segment already in the selection) drags every
    // selected segment's run together; a plain click on an unselected segment
    // drags only that run (the selection resets on mouseup).
    const moveKeys = ev.shiftKey || selectedWires.has(key)
      ? new Set([...selectedWires, key])
      : new Set([key]);
    const diagonalSelection = [...moveKeys].filter((selectedKey) => {
      const selected = keyToWire(selectedKey);
      const selectedNet = circuit.nets.get(selected.netId);
      return selectedNet && diagonalWireKeys(selectedNet).has(selectedKey);
    });
    if (diagonalSelection.length) {
      const required = new Set();
      for (const selectedKey of diagonalSelection) {
        const selected = keyToWire(selectedKey);
        for (const diagonalKey of diagonalWireKeys(circuit.nets.get(selected.netId))) required.add(diagonalKey);
      }
      if ([...required].some((diagonalKey) => !moveKeys.has(diagonalKey))) {
        logLine('connected move blocked: select the complete diagonal structure first');
        return;
      }
    }
    const runs = [];
    const seenRun = new Set();
    for (const k of moveKeys) {
      const w = keyToWire(k);
      const n = circuit.nets.get(w.netId);
      if (!n) continue;
      let pts = n.branches && n.branches[w.branch] && n.branches[w.branch].length >= 2
        ? n.branches[w.branch]
        : n.route && n.route.length >= 2 ? n.route : n.points().slice();
      const breaks = managedWireBreaks(n);
      const selectedRun = wireRunAt(pts, w.segment, breaks);
      const editable = editableManagedPath(n, w.branch, pts);
      pts = editable.path;
      const run = editable.interiorRun
        ? { orient: selectedRun.orient, val: selectedRun.val }
        : wireRunAt(pts, w.segment, breaks);
      const runBounds = editable.interiorRun
        ? { lo: 1, hi: pts.length - 2 }
        : { lo: run.lo, hi: run.hi };
      const runKey = `${n.id}:${w.branch}:${run.orient}:${run.val}:${runBounds.lo}:${runBounds.hi}`;
      if (seenRun.has(runKey)) continue; // same bounded run, don't move twice
      seenRun.add(runKey);
      const endpointMeta = {
        start: managedEndpointMeta(n, pts[runBounds.lo]),
        end: managedEndpointMeta(n, pts[runBounds.hi]),
        segment: w.segment,
        breaks,
        runBounds,
        interiorRun: editable.interiorRun,
      };
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
        endpointMeta,
        junctionBridge: pts.length === 2 && endpointMeta.start.type === 'junction' && endpointMeta.end.type === 'junction',
      });
    }
    const primary = runs.find((r) => r.net === net && r.branch === wireHit.branch && r.seg === wireHit.seg) || runs[0];
    // Only runs perpendicular to the drag direction can move together (a drag
    // shifts a run sideways). Same-orientation runs move as a group; selected
    // runs of the other orientation stay put (still selected, still deletable).
    const dragRuns = runs.filter((r) => r.orient === primary.orient);
    const netSnapshots = new Map();
    for (const r of dragRuns) {
      if (netSnapshots.has(r.net.id)) continue;
      netSnapshots.set(r.net.id, {
        id: r.net.id,
        net: r.net,
        route: r.net.route ? r.net.route.map((p) => ({ ...p })) : null,
        branches: r.net.branches ? r.net.branches.map((b) => b.map((p) => ({ ...p }))) : null,
        junctions: r.net.junctions.map((p) => ({ ...p })),
      });
    }
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
      netSnapshots,
      doubleWireClick,
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
  beginMarqueeSelection(startWorld, startClient, ev);
}

/** Arm one translation drag for any selected object combination. Keeping
 * this collection in one place makes component, label, and mixed drags share
 * the same relative-anchor and wire behavior. */
function beginObjectMove(refs, labelIds, startWorld, startClient, options = {}) {
  const componentRefs = [...new Set(refs)].filter((refdes) => circuit.components.has(refdes));
  const labels = [...new Set(labelIds)].filter((id) => circuit.labels.has(id));
  setSelection(componentRefs, componentRefs[0], true);
  setLabelSelection(labels, labels[0], true);
  const origins = new Map(componentRefs.map((refdes) => {
    const c = circuit.components.get(refdes);
    return [refdes, { x: c.transform.x, y: c.transform.y }];
  }));
  const labelOrigins = new Map(labels.map((id) => {
    const l = circuit.labels.get(id);
    return [id, { x: l.anchorWorld().x, y: l.anchorWorld().y }];
  }));
  drag = {
    mode: 'move', modal: !!options.modal, startClient, startWorld,
    startCursor: { ...cursor }, origins, labelOrigins,
    netRoutes: null, detachedWireRoutes: null, touchedNetIds: null, selectedNetIds: null,
    moved: false, committed: false, rubber: null,
    duplicate: !!options.duplicate, detached: !!options.detached,
    startSnapshot: options.modal ? snapshot() : undefined,
  };
  movePending = !!options.modal;
  render();
}

/** Select the component (or shift-toggle the multi-selection) and arm a move
 *  drag. Shared by exact-terminal hits and bbox fallback picks. */
function beginComponentDrag(hit, startWorld, startClient, ev, options = {}) {
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
  const duplicate = (ev.ctrlKey || ev.metaKey) && multi.has(hit.refdes);
  // A click on an existing member confirms the complete mixed selection;
  // clicking a new component starts a component-only selection.
  const refs = multi.has(hit.refdes) ? [...multi] : [hit.refdes];
  const labels = multi.has(hit.refdes) ? [...selLabels] : [];
  beginObjectMove(refs, labels, startWorld, startClient, { duplicate, detached: options.detached });
}
/** Split selected wire runs before a detached component move.  The selected
 * islands become independent nets; unselected islands retain their exact
 * geometry and terminal membership. */
function splitDetachedWireNet(net, selected, movedRefs) {
  const paths = net.paths();
  const all = [];
  for (let branch = 0; branch < paths.length; branch++) {
    for (let segment = 1; segment < paths[branch].length; segment++) all.push({ branch, segment });
  }
  const selectedSet = new Set(selected.map((s) => `${s.branch}:${s.segment}`));
  const selectedRecords = all.filter((s) => selectedSet.has(`${s.branch}:${s.segment}`));
  if (!selectedRecords.length) return { selectedNetIds: new Set(), attached: new Set() };
  const unselectedRecords = all.filter((s) => !selectedSet.has(`${s.branch}:${s.segment}`));
  const groups = [
    ...extractWireFragments(paths, selectedRecords, net.junctions).map((g) => ({ ...g, selected: true })),
    ...extractWireFragments(paths, unselectedRecords, net.junctions).map((g) => ({ ...g, selected: false })),
  ];
  if (!groups.length) return { selectedNetIds: new Set(), attached: new Set() };

  const oldEntries = net.routingMode === 'fixed'
    ? net.fixedPaths.map((entry) => ({
      start: entry.start ? { ...entry.start } : null,
      end: entry.end ? { ...entry.end } : null,
    }))
    : [];
  const pointInGroup = (group, point) => group.paths.some((path) => pointOnPath(point, path));
  const terminalGroups = new Map();
  const attached = new Set();
  for (const terminal of net.terminals) {
    const comp = circuit.components.get(terminal.comp);
    const point = comp?.terminalWorld(terminal.term);
    if (!point) continue;
    const candidates = groups.filter((group) => pointInGroup(group, point));
    const preferred = movedRefs.has(terminal.comp)
      ? candidates.find((group) => group.selected)
      : candidates.find((group) => !group.selected);
    if (!preferred) continue;
    if (movedRefs.has(terminal.comp) && preferred.selected) attached.add(`${terminal.comp}.${terminal.term}`);
    if (!terminalGroups.has(preferred)) terminalGroups.set(preferred, []);
    terminalGroups.get(preferred).push({ comp: terminal.comp, term: terminal.term });
  }

  const targets = groups.map((group, index) => index === 0 ? net : circuit.createWireNet({
    name: net.name,
    routingMode: net.routingMode,
    allowDiagonal: net.allowDiagonal,
    drawOrder: net.drawOrder,
    preserveEmpty: true,
  }));
  const anchorAt = (point, terminals) => {
    for (const entry of oldEntries) {
      for (const anchor of [entry.start, entry.end]) {
        if (!anchor || !terminals.some((t) => `${t.comp}.${t.term}` === `${anchor.comp}.${anchor.term}`)) continue;
        const source = paths.find((path) => pointOnPath(point, path));
        if (source?.some((p) => p.x === point.x && p.y === point.y)) return { ...anchor };
      }
    }
    return null;
  };
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const target = targets[i];
    const terminals = terminalGroups.get(group) || [];
    target.preserveEmpty = true;
    target.terminals = terminals;
    target.junctions = group.junctions.map((p) => ({ ...p }));
    if (net.routingMode === 'fixed') {
      target.routingMode = 'fixed';
      target.fixedPaths = group.paths.map((path) => ({
        points: path.map((p) => ({ ...p })),
        start: anchorAt(path[0], terminals),
        end: anchorAt(path.at(-1), terminals),
      }));
      target.route = null;
      target.branches = null;
    } else {
      target.routingMode = 'managed';
      target.branches = group.paths.map((path) => path.map((p) => ({ ...p })));
      target.route = target.branches[0] || null;
    }
  }
  circuit._redistributeNetLabels(net, targets);
  return {
    selectedNetIds: new Set(targets.filter((target, i) => groups[i].selected).map((target) => target.id)),
    attached,
  };
}

/** Electrically detach a moved set before its first transform mutation.
 * Selected wire islands split into independent nets; all other wire geometry
 * remains in place as floating geometry. */
function detachMoveComponents(drag) {
  const selectedByNet = new Map();
  for (const key of selectedWires) {
    const wire = keyToWire(key);
    if (!selectedByNet.has(wire.netId)) selectedByNet.set(wire.netId, []);
    selectedByNet.get(wire.netId).push({ branch: wire.branch, segment: wire.segment });
  }
  const movedComponents = new Set(drag.origins.keys());
  const movedRefs = new Set();
  for (const refdes of movedComponents) {
    const comp = circuit.components.get(refdes);
    for (const terminal of comp?.worldTerminals() || []) movedRefs.add(`${refdes}.${terminal.name}`);
  }
  const selectedNetIds = new Set();
  const attached = new Set();
  const affectedNetIds = new Set(selectedByNet.keys());
  for (const [id, selected] of selectedByNet) {
    const net = circuit.nets.get(id);
    if (!net) continue;
    const result = splitDetachedWireNet(net, selected, movedComponents);
    for (const netId of result.selectedNetIds) selectedNetIds.add(netId);
    for (const ref of result.attached) attached.add(ref);
  }
  for (const ref of movedRefs) {
    const net = circuit.netOfTerminal(ref);
    if (net && !attached.has(ref)) {
      net.preserveEmpty = true;
      affectedNetIds.add(net.id);
      circuit.disconnect(ref);
    }
  }
  for (const id of affectedNetIds) {
    const net = circuit.nets.get(id);
    if (net) circuit._repairNetLabels(net);
  }
  circuit.syncJunctionSolders();
  return selectedNetIds;
}

function captureNetGeometry(net) {
  return {
    route: net.route ? net.route.map((p) => ({ ...p })) : null,
    branches: net.branches ? net.branches.map((path) => path.map((p) => ({ ...p }))) : null,
    fixedPaths: net.routingMode === 'fixed' ? net.fixedPaths.map((entry) => ({
      points: entry.points.map((p) => ({ ...p })),
      start: entry.start ? { ...entry.start } : null,
      end: entry.end ? { ...entry.end } : null,
    })) : null,
    junctions: net.junctions.map((p) => ({ ...p })),
  };
}
function snappedDragDelta(startWorld, currentWorld) {
  return {
    dx: snap(currentWorld.x - startWorld.x),
    dy: snap(currentWorld.y - startWorld.y),
  };
}


function translateNetGeometry(net, saved, dx, dy) {
  const move = (p) => ({ x: p.x + dx, y: p.y + dy });
  net.route = saved.route?.map(move) || null;
  net.branches = saved.branches?.map((path) => path.map(move)) || null;
  if (net.routingMode === 'fixed' && saved.fixedPaths) {
    net.fixedPaths = saved.fixedPaths.map((entry) => ({
      points: entry.points.map(move),
      start: entry.start ? { ...entry.start } : null,
      end: entry.end ? { ...entry.end } : null,
    }));
  }
  net.junctions = saved.junctions.map(move);
}

function armModalLabelMove(label, startWorld, startClient) {
  const ids = selLabels.has(label.id) ? [...selLabels] : [label.id];
  setSelection([], undefined, true);
  setLabelSelection(ids, label.id, true);
  const startAnchors = new Map();
  for (const id of ids) {
    const item = circuit.labels.get(id);
    if (item) startAnchors.set(id, { x: item.anchorWorld().x, y: item.anchorWorld().y });
  }
  drag = {
    mode: 'labelmove',
    modal: true,
    labelId: label.id,
    startClient,
    startWorld,
    startAnchors,
    moved: false,
    committed: false,
    rubber: null,
    duplicate: false,
    startSnapshot: snapshot(),
  };
  movePending = true;
  render();
}

function armModalMove(hit, startWorld, startClient) {
  // Preserve a preselected component set when the source click lands on one
  // of its members. A mixed component/label selection remains mixed.
  const refs = multi.has(hit.refdes) ? [...multi] : [hit.refdes];
  const labelIds = multi.has(hit.refdes) ? [...selLabels] : [];
  beginObjectMove(refs, labelIds, startWorld, startClient, {
    modal: true,
    detached: moveMode === 'detached',
  });
}

function finishMoveMutation(moveDrag) {
  if (!moveDrag.moved) return;
  const refs = [...moveDrag.origins.keys()];
  const previewed = moveDrag.netRoutes instanceof Map;
  if (moveDrag.detached) {
    circuit.reconnectCoincidentNets();
    wiresDirty = true;
    return;
  }
  const moved = new Map();
  for (const [refdes, origin] of moveDrag.origins) {
    const comp = circuit.components.get(refdes);
    if (comp) moved.set(refdes, {
      dx: comp.transform.x - origin.x,
      dy: comp.transform.y - origin.y,
    });
  }
  circuit.connectCoincident(refs);
  if (!previewed) {
    for (const id of netsTouching(refs)) {
      const net = circuit.nets.get(id);
      if (net) rerouteNet(net, moved);
    }
  }
  circuit.syncJunctionSolders();
  if (!previewed) {
    for (const id of netsTouching(refs)) {
      const net = circuit.nets.get(id);
      if (net) circuit._reduceNet(net);
    }
  }
  circuit.reconnectCoincidentNets();
  wiresDirty = true;
}

function commitModalMove() {
  if (!drag?.modal) return false;
  if (drag.mode === 'labelmove') {
    if (drag.moved && snapshot() !== drag.startSnapshot) {
      history.push(drag.startSnapshot);
      if (history.length > 200) history.shift();
      future.length = 0;
    }
    drag = null;
    movePending = false;
    render();
    return true;
  }
  const point = drag.commitPoint || (() => {
    const world = { ...cursor };
    return { world, client: worldToClient(world.x, world.y) };
  })();
  if (drag.mode === 'wireseg' || drag.mode === 'fixedwire' || drag.mode === 'floatingwire') {
    drag.modal = false;
    canvasMouseUp({
      clientX: point.client.x,
      clientY: point.client.y,
      button: 0,
      shiftKey: drag.shift,
    });
    movePending = false;
    return true;
  }
  // A modal source click may be followed by a destination click or Enter
  // without an intermediate mousemove event. Run the same preview mutation as
  // a real drag before committing, using the cursor when Enter supplied no
  // mousedown commit point.
  canvasMouseMove({
    clientX: point.client.x,
    clientY: point.client.y,
    shiftKey: drag.shift,
  });
  finishMoveMutation(drag);
  drag = null;
  movePending = false;
  copyPending = false;
  render();
  return true;
}

function copySelectionExists() {
  return multi.size > 0 || selLabels.size > 0 || selectedWires.size > 0 ||
    !!selectedWire || selectedNets.size > 0;
}
function expandCopyNetSelection() {
  const netIds = new Set(selectedNets);
  for (const label of selectedLabels()) if (label.netId) netIds.add(label.netId);
  const refs = new Set(multi);
  for (const id of netIds) {
    const net = circuit.nets.get(id);
    for (const terminal of net?.terminals || []) refs.add(terminal.comp);
  }
  if (refs.size) setSelection([...refs], selected && refs.has(selected) ? selected : [...refs][0], true);
}

function beginCopySource(startWorld, startClient) {
  // An existing selection is the source, not the object under the cursor.
  // This matters for mixed Ctrl+A/marquee selections and makes the source
  // click a confirmation gesture rather than an accidental selection change.
  if (!copySelectionExists()) {
    const label = pickLabel(startWorld);
    const annotation = annotationGeometryAt(startWorld);
    const wireHit = pickWire(startWorld);
    const hit = matchAt(snap(startWorld.x), snap(startWorld.y));
    if (annotation) {
      setLabelSelection([annotation.id]);
    } else if (label?.netId) {
      const net = circuit.nets.get(label.netId);
      const refs = [...new Set((net?.terminals || []).map((t) => t.comp))];
      if (refs.length) setSelection(refs);
      else selectedNets = new Set([label.netId]);
    } else if (label?.owner && circuit.components.has(label.owner)) {
      setSelection([label.owner]);
    } else if (label) {
      setLabelSelection([label.id]);
    } else if (wireHit) {
      const key = `${wireHit.net.id}:${wireHit.branch}:${wireHit.seg}`;
      selectedWire = keyToWire(key);
      selectedWires = new Set([key]);
      selectedNets.clear();
    } else if (hit?.refdes) {
      setSelection([hit.refdes]);
    } else {
      logLine('COPY: click a component, label, or wire source');
      return false;
    }
  }
  expandCopyNetSelection();
  if (!copySelection()) return false;
  return startCopyGhost(startWorld, startClient);
}
function deleteAtPoint(world) {
  const label = pickLabel(world) || annotationGeometryAt(world);
  const hitWire = pickWire(world);
  const hitComp = matchAt(snap(world.x), snap(world.y));
  if (label) {
    commit(() => circuit.removeLabel(label.id));
    clearCheckReport();
    if (selLabels.has(label.id)) setLabelSelection([]);
    render();
    return true;
  }
  if (hitWire) {
    commit(() => circuit.deleteWireSegments(hitWire.net.id, [{ branch: hitWire.branch, segment: hitWire.seg }]));
    clearCheckReport();
    selectedWire = null;
    selectedWires.clear();
    wiresDirty = true;
    render();
    return true;
  }
  if (hitComp?.refdes && circuit.components.has(hitComp.refdes)) {
    const touched = netsTouching([hitComp.refdes]);
    commit(() => {
      circuit.removeComponent(hitComp.refdes);
      for (const id of touched) {
        const net = circuit.nets.get(id);
        if (net) rerouteNet(net);
      }
    });
    clearCheckReport();
    multi.delete(hitComp.refdes);
    if (selected === hitComp.refdes) selected = multi.size ? [...multi][0] : null;
    render();
    return true;
  }
  logLine('DELETE: no component, label, or wire segment here');
  return false;
}

function canvasMouseMove(ev) {
  const w = clientToWorld(ev.clientX, ev.clientY);
  const nextCursor = { x: snap(w.x), y: snap(w.y) };
  const cursorChanged = nextCursor.x !== cursor.x || nextCursor.y !== cursor.y;
  cursor = nextCursor;

  if (!drag) {
    // The cursor follows the mouse, always snapped to the nearest grid point.
    // The view never pans on its own — pan manually with the middle button.
    if (cursorChanged) render();
    return;
  }

  const movedOut = dragMoved(drag.startWorld, drag.startClient, w, ev);
  if (drag.mode === 'annotationlineplace') {
    if (movedOut) drag.moved = true;
    drag.previewEnd = { ...cursor };
    render();
    return;
  }
  if (drag.mode === 'annotationplace') {
    if (movedOut) drag.moved = true;
    if (annotationStart || drag.moved) {
      drag.previewEnd = { ...cursor };
      render();
    }
    return;
  }
  if (drag.mode === 'annotationtextmove') {
    if (movedOut) drag.moved = true;
    if (drag.moved) {
      const dx = snap(w.x) - snap(drag.startWorld.x);
      const dy = snap(w.y) - snap(drag.startWorld.y);
      drag.label.textAnchor = { x: drag.startText.x + dx, y: drag.startText.y + dy };
      cursor = { ...drag.label.textAnchor };
      render();
    }
    return;
  }
  if (drag.mode === 'annotationsegment') {
    if (movedOut) drag.moved = true;
    if (drag.moved) {
      const dx = snap(w.x) - snap(drag.startWorld.x);
      const dy = snap(w.y) - snap(drag.startWorld.y);
      drag.label.points = drag.startPoints.map((point) => ({ ...point }));
      drag.label.moveSegment(drag.segment, dx, dy);
      cursor = { ...cursor };
      render();
    }
    return;
  }
  if (drag.mode === 'annotationendpoint') {
    if (movedOut) drag.moved = true;
    if (drag.moved) {
      const oldAnchor = { ...drag.label.anchor };
      const oldEnd = { ...drag.label.end };
      const oldPoints = drag.label.points?.map((point) => ({ ...point }));
      const p = { x: snap(w.x), y: snap(w.y) };
      if (drag.label.kind === 'line' && drag.endpoint.startsWith('vertex:')) {
        const index = Number(drag.endpoint.slice(7));
        drag.label.moveVertex(index, p.x, p.y);
      } else if (drag.endpoint.startsWith('corner:')) {
        const corner = drag.endpoint.slice(7);
        const x0 = Math.min(drag.label.anchor.x, drag.label.end.x);
        const x1 = Math.max(drag.label.anchor.x, drag.label.end.x);
        const y0 = Math.min(drag.label.anchor.y, drag.label.end.y);
        const y1 = Math.max(drag.label.anchor.y, drag.label.end.y);
        const fixed = {
          'top-left': { x: x1, y: y1 },
          'top-right': { x: x0, y: y1 },
          'bottom-right': { x: x0, y: y0 },
          'bottom-left': { x: x1, y: y0 },
        }[corner];
        drag.label.anchor = p;
        drag.label.end = fixed;
      } else if (drag.endpoint === 'start') drag.label.anchor = p;
      else if (drag.endpoint === 'end') drag.label.end = p;
      else if (drag.endpoint === 'left' || drag.endpoint === 'right') {
        const left = drag.endpoint === 'left';
        if ((drag.label.anchor.x < drag.label.end.x) === left) drag.label.anchor.x = p.x;
        else drag.label.end.x = p.x;
      } else {
        const top = drag.endpoint === 'top';
        if ((drag.label.anchor.y < drag.label.end.y) === top) drag.label.anchor.y = p.y;
        else drag.label.end.y = p.y;
      }
      const invalid = drag.label.kind === 'arrow'
        ? Math.hypot(drag.label.anchor.x - drag.label.end.x, drag.label.anchor.y - drag.label.end.y) < 80
        : drag.label.kind === 'box' && (drag.label.anchor.x === drag.label.end.x || drag.label.anchor.y === drag.label.end.y);
      if (invalid) {
        drag.label.anchor = oldAnchor;
        drag.label.end = oldEnd;
        if (oldPoints) drag.label.points = oldPoints;
      }
      cursor = p;
      render();
    }
    return;
  }
  if (drag.mode === 'copyghost') {
    drag.moved = movedOut || drag.moved;
    moveCopyGhost(w);
    render();
    return;
  }

  if (drag.mode === 'pan') {
    // Map the pointer back against the mousedown view (startView) so the pan
    // delta equals the raw pointer movement — no feedback from prior moves.
    const p = clientToWorld(ev.clientX, ev.clientY, drag.startView);
    view.x = drag.startView.x - (p.x - drag.startWorld.x);
    view.y = drag.startView.y - (p.y - drag.startWorld.y);
    render();
    return;
  }

  if (drag.mode === 'zoom' || drag.mode === 'marquee' || drag.mode === 'deletemarquee') {
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
      // Rebuild from the drag-start topology before every frame. Without this,
      // moving a run onto an adjacent run collapses the two terminal legs into
      // one straight segment, making the original run impossible to drag back.
      restoreManagedNetSnapshots(drag.netSnapshots);
      for (const r of drag.runs) {
        const paths = r.net.branches?.length
          ? r.net.branches
          : r.net.route && r.net.route.length >= 2
            ? [r.net.route]
            : [r.net.points()];
        r.pts = paths[r.branch] || paths[0];
        r.line = r.startLine;
      }
      const axis = drag.orient === 'h' ? w.y : w.x;
      const delta = axis - drag.startAxis;
      for (const r of drag.runs) {
        const target = r.startLine + delta;
        moveManagedWireRun(r, target);
      }
      wiresDirty = true; // live re-route changes wire geometry every frame
      render();
    }
    return;
  }

  if (drag.mode === 'floatingwire') {
    if (movedOut) drag.moved = true;
    if (drag.moved) {
      const dx = snap(w.x) - snap(drag.startWorld.x);
      const dy = snap(w.y) - snap(drag.startWorld.y);
      for (const f of drag.fragments) {
        const points = f.orig.map((p) => ({ x: p.x + dx, y: p.y + dy }));
        if (f.fixed) f.net.fixedPaths[f.branch].points = points;
        else {
          if (f.net.branches?.[f.branch]) f.net.branches[f.branch] = points;
          if (f.branch === 0) f.net.route = points;
        }
      }
      cursor = { x: snap(w.x), y: snap(w.y) };
      wiresDirty = true;
    }
    render();
    return;
  }

  if (drag.mode === 'fixedwire') {
    if (movedOut) drag.moved = true;
    if (drag.moved) {
      const dx = snap(w.x) - snap(drag.startWorld.x);
      const dy = snap(w.y) - snap(drag.startWorld.y);
      for (const [net, saved] of drag.fixedSnapshots) {
        net.fixedPaths = saved.fixedPaths.map((entry) => ({
          ...entry,
          points: entry.points.map((p) => ({ ...p })),
        }));
        net.junctions = saved.junctions.map((p) => ({ ...p }));
      }
      const net = drag.net;
      const movePoint = (p) => ({ x: p.x + dx, y: p.y + dy });
      if (drag.junction >= 0) {
        const old = drag.fixedSnapshots.get(net).junctions[drag.junction];
        const next = movePoint(old);
        net.junctions[drag.junction] = next;
        for (const entry of net.fixedPaths) {
          entry.points = entry.points.map((p) => p.x === old.x && p.y === old.y ? { ...next } : p);
        }
      } else if (drag.vertex >= 0) {
        const entry = net.fixedPaths[drag.branch];
        if (entry && drag.vertex > 0 && drag.vertex < entry.points.length - 1) {
          entry.points[drag.vertex] = movePoint(drag.fixedSnapshots.get(net).fixedPaths[drag.branch].points[drag.vertex]);
        }
      } else {
        const entry = net.fixedPaths[drag.branch];
        const saved = drag.fixedSnapshots.get(net).fixedPaths[drag.branch];
        if (entry && saved) {
          const indices = [drag.seg - 1, drag.seg].filter((i) => i > 0 && i < entry.points.length - 1);
          for (const i of indices) entry.points[i] = movePoint(saved.points[i]);
        }
      }
      cursor = { x: snap(w.x), y: snap(w.y) };
      render();
    }
    return;
  }

  if (drag.mode === 'labelmove') {
    if (movedOut) drag.moved = true;
    if (drag.moved) {
      if (!drag.committed) {
        if (drag.duplicate) {
          copySelection();
          const anchor = clipboard?.anchor;
          if (anchor) {
            cursor = { ...anchor };
            pasteClipboard();
          }
          drag.startAnchors = new Map(selectedLabels().map((l) => [l.id, { x: l.anchorWorld().x, y: l.anchorWorld().y }]));
          drag.labelId = selLabel;
          logLine('duplicated selection — dragging the copy');
        } else if (!drag.modal) {
          history.push(snapshot());
          if (history.length > 200) history.shift();
          future.length = 0;
        }
        drag.committed = true;
      }
      const delta = snappedDragDelta(drag.startWorld, w);
      for (const [id, sa] of drag.startAnchors) {
        const label = circuit.labels.get(id);
        if (label) moveLabelSafely(label, sa.x + delta.dx, sa.y + delta.dy);
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
      const moved = new Map();
      if (!drag.committed) {
        if (drag.duplicate) {
          // Paste at the original selection anchor first. The paste operation
          // records the pre-duplicate snapshot; the rest of this drag moves
          // the fresh selection, keeping the whole gesture undoable as one
          // operation.
          copySelection();
          const anchor = clipboard?.anchor;
          if (anchor) {
            cursor = { ...anchor };
            pasteClipboard();
          }
          drag.origins = new Map(selectedComps().map((c) => [c.refdes, { x: c.transform.x, y: c.transform.y }]));
          drag.labelOrigins = new Map(selectedLabels().map((l) => [l.id, { x: l.anchorWorld().x, y: l.anchorWorld().y }]));
          logLine('duplicated selection — dragging the copy');
        } else {
          history.push(snapshot());
          if (history.length > 200) history.shift();
          future.length = 0;
        }
        if (drag.detached) {
          const selectedNetIds = detachMoveComponents(drag);
          drag.detachedWireRoutes = new Map(
            [...selectedNetIds]
              .map((id) => [id, captureNetGeometry(circuit.nets.get(id))])
              .filter(([, saved]) => saved),
          );
        }
        // Capture the touched and explicitly selected complete nets' wire
        // geometry once. Every subsequent frame re-anchors from this snapshot
        // with the cumulative drag delta, so a long, circular drag can never
        // accumulate new segments.
        drag.netRoutes = new Map();
        drag.touchedNetIds = netsTouching([...drag.origins.keys()]);
        drag.selectedNetIds = selectedCompleteNetIds({
          selectedNetIds: selectedNets,
          nets: circuit.nets,
          selectedRefs: [...drag.origins.keys()],
        });
        const capturedNetIds = new Set([...drag.touchedNetIds, ...drag.selectedNetIds]);
        for (const id of drag.detached ? [] : capturedNetIds) {
          const net = circuit.nets.get(id);
          if (net) drag.netRoutes.set(id, captureNetGeometry(net));
        }
        drag.committed = true;
      }
      const delta = snappedDragDelta(drag.startWorld, w);
      for (const [r, o] of drag.origins) {
        const c = circuit.components.get(r);
        if (!c) continue;
        const nx = o.x + delta.dx;
        const ny = o.y + delta.dy;
        // Both move variants preview by assigning the transform directly.
        // Connected moves re-route from moved terminal positions; detached
        // moves keep the pre-existing wire paths as floating geometry.
        c.transform.x = nx;
        c.transform.y = ny;
        moved.set(r, { dx: nx - o.x, dy: ny - o.y });
      }
      // Labels share the same drag delta as every other selected object.
      // Owned labels follow their component; net labels wait until their net
      // has been re-anchored below so the new attachment remains valid.
      if (drag.labelOrigins) {
        for (const [id, o] of drag.labelOrigins) {
          const l = circuit.labels.get(id);
          if (l && !l.owner && !l.netId) moveLabelSafely(l, o.x + delta.dx, o.y + delta.dy);
        }
      }
      // Restore the pre-drag wire geometry and re-anchor from it with the total
      // delta, so wires follow the component without accumulating or detaching.
      for (const [id, saved] of drag.netRoutes || []) {
        const net = circuit.nets.get(id);
        if (!net) continue;
        translateNetGeometry(net, saved, 0, 0);
        const selectedOnly = drag.selectedNetIds?.has(id) && !drag.touchedNetIds?.has(id);
        if (selectedOnly && !net.terminals.length) {
          translateNetGeometry(net, saved, delta.dx, delta.dy);
        } else {
          rerouteNet(net, moved);
        }
      }
      for (const [id, saved] of drag.detachedWireRoutes || []) {
        const net = circuit.nets.get(id);
        if (net) translateNetGeometry(net, saved, delta.dx, delta.dy);
      }
      for (const [id, o] of drag.labelOrigins || []) {
        const l = circuit.labels.get(id);
        if (l?.netId) moveLabelSafely(l, o.x + delta.dx, o.y + delta.dy);
      }
      if (drag.detached) circuit.syncJunctionSolders();
      cursor = { x: drag.startCursor.x + delta.dx, y: drag.startCursor.y + delta.dy };
    }
    render();
    return;
  }
}

function canvasMouseUp(ev) {
  if (!drag) return;
  const movedOut = dragMoved(drag.startWorld, drag.startClient, clientToWorld(ev.clientX, ev.clientY), ev);
  const w = clientToWorld(ev.clientX, ev.clientY);
  if (drag.mode === 'pan') {
    if (ev.button !== 1) return;
    drag = drag.resume || null;
    render();
    return;
  }
  if (drag.mode === 'copyghost') {
    render();
    return;
  }

  if (drag.mode === 'zoom') {
    if (drag.moved) zoomToWorldRect(worldRect(drag.startWorld, w));
  } else if (drag.mode === 'wireseg') {
    if (drag.modal) {
      render();
      return;
    }
    const anyMoved = drag.runs.some((r) => JSON.stringify(r.pts) !== JSON.stringify(r.orig));
    if (!drag.moved || !anyMoved) {
      // A plain click (or a jittery gesture that never actually moved a run):
      selectedNets.clear();
      if (drag.shift) {
        if (selectedWires.has(drag.key)) selectedWires.delete(drag.key);
        else selectedWires.add(drag.key);
        syncSelectedWire();
      } else {
        setSelection([]);
        selectedWires = new Set([drag.key]);
        selectedWire = keyToWire(drag.key);
      }
      if (drag.doubleWireClick) {
        setSelection([]);
        selectedWire = null;
        selectedWires.clear();
        selectedNets = new Set([drag.net.id]);
        cursor = { x: snap(drag.startWorld.x), y: snap(drag.startWorld.y) };
        drag = null;
        render();
        return;
      }
      drag = null; // a click never leaves a drag armed (a bare mousemove would re-drag the run)
      render();
      return;
    }
    try {
      // The drag edited local run arrays live. Persist every run back to its
      // net before validating/reducing; incident branches were already kept in
      // sync by moveManagedJunction.
      for (const r of drag.runs) {
        if (r.branch !== undefined && r.net.branches && r.net.branches[r.branch]) {
          r.net.branches[r.branch] = r.pts.map((p) => ({ ...p }));
          if (r.branch === 0) r.net.route = r.net.branches[0].map((p) => ({ ...p }));
        } else {
          r.net.route = r.pts.map((p) => ({ ...p }));
        }
      }
      for (const r of drag.runs) {
        const collapsedInterior = r.orig.length > r.pts.length &&
          r.pts.length === 2 &&
          r.endpointMeta?.start?.type === 'terminal' &&
          r.endpointMeta?.end?.type === 'terminal';
        if (collapsedInterior) {
          r.net._wireRunHint = {
            branch: r.branch,
            orient: r.orient,
            orig: r.orig.map((p) => ({ ...p })),
            endpoints: r.pts.map((p) => ({ ...p })),
          };
        } else if (r.net._wireRunHint?.branch === r.branch) {
          r.net._wireRunHint = null;
        }
      }
      const touchedNets = new Set(drag.runs.map((r) => r.net.id));
      const literalNets = new Set(drag.runs.filter((r) => r.junctionBridge).map((r) => r.net.id));
      const expectedJunctions = new Map();
      for (const r of drag.runs) {
        if (!r.junctionBridge) continue;
        if (!expectedJunctions.has(r.net.id)) expectedJunctions.set(r.net.id, []);
        expectedJunctions.get(r.net.id).push(
          { from: { ...r.endpointMeta.start.point }, point: { ...r.pts[0] } },
          { from: { ...r.endpointMeta.end.point }, point: { ...r.pts[r.pts.length - 1] } },
        );
      }
      for (const id of touchedNets) {
        const net = circuit.nets.get(id);
        if (!net) continue;
        if (!literalNets.has(id)) {
          rerouteNet(net); // re-anchor ordinary terminal legs
        }
        circuit._reduceNet(net); // merge any run dragged onto a same-net wire
        if (literalNets.has(id)) syncManagedRoute(net);
        for (const expected of expectedJunctions.get(id) || []) {
          const point = expected.point;
          const moved = point.x !== expected.from.x || point.y !== expected.from.y;
          if (moved && [...circuit.components.values()].some((c) => c.worldTerminals().some((t) => t.x === point.x && t.y === point.y))) {
            throw new Error(`managed bridge junction landed on a component pin on ${id}`);
          }
          if (!net.junctions.some((p) => p.x === point.x && p.y === point.y)) {
            throw new Error(`managed bridge junction moved unexpectedly on ${id}`);
          }
        }
      }
      circuit.syncJunctionSolders();
      wiresDirty = true; // committed wire drag changed net geometry
      history.push(drag.startSnapshot);
      if (history.length > 200) history.shift();
      future.length = 0;
    } catch (err) {
      restoreManagedNetSnapshots(drag.netSnapshots);
      circuit.syncJunctionSolders();
      wiresDirty = true;
      logLine(`wire drag cancelled: ${err.message}`, 'error');
      drag = null;
      render();
      return;
    }
  } else if (drag.mode === 'floatingwire') {
    if (drag.modal) {
      render();
      return;
    }
    if (!drag.moved) {
      if (!drag.shift) setSelection([]);
      selectedNets.clear();
      if (drag.shift) {
        if (selectedWires.has(drag.key)) selectedWires.delete(drag.key);
        else selectedWires.add(drag.key);
      } else {
        selectedWires = new Set([drag.key]);
      }
      syncSelectedWire();
    } else {
      // Attach every landed endpoint.  A detached island can reconnect both
      // ends in one drop; stopping after the first endpoint leaves the second
      // terminal electrically dangling.
      const attachments = (drag.fragments || []).map((f) => ({
        f,
        points: f.net.routingMode === 'fixed'
          ? f.net.fixedPaths[f.branch]?.points?.map((p) => ({ ...p }))
          : (f.net.branches?.[f.branch] || (f.branch === 0 ? f.net.route : null))?.map((p) => ({ ...p })),
      }));
      const activeById = new Map();
      for (const { f, points: original } of attachments) {
        let activeNet = activeById.get(f.net.id) || f.net;
        if (!original || original.length < 2) continue;
        for (const point of [original[0], original.at(-1)]) {
          const paths = activeNet.paths();
          const branch = paths.findIndex((candidate) =>
            candidate[0]?.x === point.x && candidate[0]?.y === point.y ||
            candidate.at(-1)?.x === point.x && candidate.at(-1)?.y === point.y);
          if (branch < 0) continue;
          const endpoint = paths[branch][0]?.x === point.x && paths[branch][0]?.y === point.y ? 0 : paths[branch].length - 1;
          const term = [...circuit.components.values()].flatMap((c) => c.worldTerminals().map((t) => ({ ...t, refdes: c.refdes })))
            .find((t) => t.x === point.x && t.y === point.y);
          if (term) {
            try {
              activeNet = circuit.attachWireEndpoint(activeNet, branch, endpoint, `${term.refdes}.${term.name}`);
              activeById.set(f.net.id, activeNet);
            } catch (err) { logLine(err.message); }
            continue;
          }
          const other = exactWireTargetAt(point, activeNet.id);
          if (other && !other.ambiguous) {
            try {
              activeNet = circuit.attachWireEndpoint(activeNet, branch, endpoint, other);
              activeById.set(f.net.id, activeNet);
            } catch (err) { logLine(err.message); }
          } else if (other?.ambiguous) {
            logLine('wire endpoint target is ambiguous — no implicit crossing join');
          }
        }
      }
      circuit.syncJunctionSolders();
      wiresDirty = true;
      if (snapshot() !== drag.startSnapshot) {
        history.push(drag.startSnapshot);
        if (history.length > 200) history.shift();
        future.length = 0;
      }
    }
  } else if (drag.mode === 'fixedwire') {
    if (drag.modal) {
      render();
      return;
    }
    if (!drag.moved) {
      if (drag.fixedShift) {
        if (selectedWires.has(drag.fixedKey)) selectedWires.delete(drag.fixedKey);
        else selectedWires.add(drag.fixedKey);
        syncSelectedWire();
      } else {
        setSelection([]);
        selectedWires = new Set([drag.fixedKey]);
        selectedWire = keyToWire(drag.fixedKey);
      }
      selectedNets.clear();
    } else {
      if (snapshot() !== drag.startSnapshot) {
        circuit.syncJunctionSolders();
        history.push(drag.startSnapshot);
        if (history.length > 200) history.shift();
        future.length = 0;
        wiresDirty = true;
        logLine(drag.junction >= 0 ? 'moved fixed junction dot' : 'moved fixed wire geometry');
      } else {
        logLine('fixed endpoint has no movable geometry');
      }
    }
  } else if (drag.mode === 'fixedendpoint') {
    if (!drag.moved) {
      const path = drag.net.paths()[drag.endpoint.pathIndex];
      const segment = drag.endpoint.endpointIndex === 0 ? 1 : path.length - 1;
      setSelection([]);
      selectedWires = new Set([`${drag.net.id}:${drag.endpoint.pathIndex}:${segment}`]);
      syncSelectedWire();
      selectedNets.clear();
    } else {
      const point = { x: snap(w.x), y: snap(w.y) };
      const terminalHits = sortedComps().flatMap((c) => c.worldTerminals()
        .filter((t) => t.x === point.x && t.y === point.y)
        .map((t) => ({ refdes: c.refdes, term: t.name })));
      let target = null;
      if (terminalHits.length === 1) target = `${terminalHits[0].refdes}.${terminalHits[0].term}`;
      else if (terminalHits.length > 1) logLine('fixed endpoint target is ambiguous — choose one terminal');
      else {
        const wireTarget = exactWireTargetAt(w, null, drag.endpoint);
        if (wireTarget?.ambiguous) logLine('fixed endpoint target is ambiguous — choose one exact wire');
        else if (wireTarget) target = wireTarget;
      }
      if (target) {
        try {
          circuit.attachWireEndpoint(drag.endpoint.netId, drag.endpoint.pathIndex, drag.endpoint.endpointIndex, target);
        } catch (err) {
          circuit.restoreFixedGeometry(drag.net, drag.saved.fixedPaths, drag.saved.junctions);
          logLine(String(err.message || err));
        }
      }
      if (snapshot() !== drag.startSnapshot) {
        history.push(drag.startSnapshot);
        if (history.length > 200) history.shift();
        future.length = 0;
        wiresDirty = true;
        logLine(target ? 'attached fixed endpoint' : 'moved fixed endpoint');
      }
    }
  } else if (drag.mode === 'annotationlineplace') {
    if (!movedOut) {
      const point = { x: snap(w.x), y: snap(w.y) };
      if (!annotationPoints.length || point.x !== annotationPoints.at(-1).x || point.y !== annotationPoints.at(-1).y) annotationPoints.push(point);
      const now = Date.now();
      const previous = lastLineClick;
      const doubleClick = ev.detail >= 2 || (previous && now - previous.at < 500 &&
        Math.abs(point.x - previous.x) <= GRID && Math.abs(point.y - previous.y) <= GRID);
      lastLineClick = { x: point.x, y: point.y, at: now };
      if (doubleClick) commitLineAnnotation();
    }
  } else if (drag.mode === 'annotationtextmove') {
    if (drag.moved && snapshot() !== drag.startSnapshot) {
      history.push(drag.startSnapshot);
      if (history.length > 200) history.shift();
      future.length = 0;
    }
  } else if (drag.mode === 'marquee' || drag.mode === 'deletemarquee') {
    if (drag.moved) {
      const box = worldRect(drag.startWorld, w);
      applyBoxSelection(box.x0, box.y0, box.x1, box.y1, drag.shift);
      if (drag.mode === 'deletemarquee' && copySelectionExists()) deleteSelection();
    } else if (drag.mode === 'deletemarquee') {
      if (copySelectionExists()) deleteSelection();
      else deleteAtPoint(w);
    }
  } else if (drag.mode === 'annotationsegment' || drag.mode === 'annotationendpoint') {
    if (drag.moved && snapshot() !== drag.startSnapshot) {
      history.push(drag.startSnapshot);
      if (history.length > 200) history.shift();
      future.length = 0;
    }
  } else if (drag.mode === 'wirepick') {
    if (!movedOut) doWireClick(snap(w.x), snap(w.y), drag.terminalHit, drag.fixedEndpoint, drag.fixedTarget);
  } else if (drag.mode === 'directpick') {
    if (!movedOut) doDirectWireClick(snap(w.x), snap(w.y), drag.fixedEndpoint);
  } else if (drag.mode === 'annotationplace') {
    if (drag.moved) {
      if (!annotationStart) annotationStart = { x: snap(drag.startWorld.x), y: snap(drag.startWorld.y) };
      placeShapeAnnotation(w, { x: snap(w.x), y: snap(w.y) });
    } else {
      placeShapeAnnotation(w);
    }
  } else if (drag.mode === 'labelplace') {
    if (!movedOut) {
      if (labelMode === 'net') placeNetLabelAt(w);
      else if (labelMode === 'annotation') placeAnnotationAt(w);
    }
  } else if (drag.mode === 'move') {
    if (drag.modal) {
      // The source click stays armed, but a real drag commits on mouseup.
      // Click+click commits through commitModalMove; both paths share the same
      // preview and finalization.
      if (!drag.moved) {
        render();
        return;
      }
      drag.modal = false;
    }
    if (drag.moved) finishMoveMutation(drag);
  }
  drag = null;
  render();
}
canvasEl.addEventListener('mousedown', canvasMouseDown);
canvasEl.addEventListener('mousemove', canvasMouseMove);
// Keep the two-point shape preview alive after the first click. The normal
// mousemove path also updates the cursor, but pointermove remains available
// after the SVG is replaced during a repaint.
function updateShapePreviewCursor(ev) {
  if (!annotationStart || !['arrow', 'box'].includes(labelMode)) return;
  const w = clientToWorld(ev.clientX, ev.clientY);
  const next = { x: snap(w.x), y: snap(w.y) };
  if (next.x === cursor.x && next.y === cursor.y && !drag?.previewEnd) return;
  cursor = next;
  if (drag?.mode === 'annotationplace') drag.previewEnd = { ...next };
  render();
}
// Replacing the SVG during render can move the pointer off the old target
// before the bubbling mousemove reaches the canvas. Capture the movement at
// window level while a shape draft is active so the preview cannot stall.
window.addEventListener('pointermove', (ev) => {
  if (!annotationStart || !['arrow', 'box'].includes(labelMode)) return;
  const r = document.querySelector('.canvas-pane')?.getBoundingClientRect();
  if (!r || ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) return;
  updateShapePreviewCursor(ev);
}, true);
window.addEventListener('mousemove', (ev) => {
  if (!annotationStart || !['arrow', 'box'].includes(labelMode)) return;
  const r = document.querySelector('.canvas-pane')?.getBoundingClientRect();
  if (!r || ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) return;
  updateShapePreviewCursor(ev);
}, true);
canvasEl.addEventListener('pointermove', updateShapePreviewCursor);
canvasEl.addEventListener('mouseenter', () => {
  cursorInCanvas = true;
  render();
});
canvasEl.addEventListener('mouseleave', () => {
  cursorInCanvas = false;
  render();
});
function contextStyleValue(target, field) {
  if (target?.kind === 'wire') {
    const { net, branch, segment } = target.value;
    return net.wireStyles?.[`${branch}:${segment}`]?.[field] || net.style?.[field] || styleDefaults(field);
  }
  return target?.value?.style?.[field] || styleDefaults(field);
}

function contextTargetType(target) {
  return target.kind === 'component' ? 'component' : target.kind === 'wire' ? 'wire' : 'label';
}

function contextMatches(target, candidate, criterion) {
  if (criterion === 'type' && contextTargetType(target) !== contextTargetType(candidate)) return false;
  if (criterion === 'type') {
    if (target.kind === 'component') return candidate.value.type === target.value.type;
    if (target.kind === 'wire') return !!candidate.value.net.routingMode === !!target.value.net.routingMode;
    return candidate.value.kind === target.value.kind &&
      !!candidate.value.owner === !!target.value.owner &&
      !!candidate.value.netId === !!target.value.netId;
  }
  if (criterion === 'color' || criterion === 'lineStyle') {
    const field = criterion === 'color' ? 'color' : 'lineStyle';
    return contextStyleValue(candidate, field) === contextStyleValue(target, field);
  }
  return false;
}

let componentContextTarget = null;
let componentContextSubmenu = null;

function closeComponentContextMenu() {
  componentContextTarget = null;
  componentContextSubmenu = null;
  if (componentContextMenuEl) {
    componentContextMenuEl.hidden = true;
    componentContextMenuEl.replaceChildren();
  }
}

function contextCandidates(target, criterion) {
  if (criterion === 'color' || criterion === 'lineStyle') {
    const candidates = [...circuit.components.values()].map((value) => ({ kind: 'component', value }));
    candidates.push(...[...circuit.labels.values()].map((value) => ({ kind: 'label', value })));
    for (const net of circuit.nets.values()) {
      const paths = net.paths();
      for (let branch = 0; branch < paths.length; branch++) {
        for (let segment = 1; segment < paths[branch].length; segment++) {
          candidates.push({ kind: 'wire', value: { net, branch, segment } });
        }
      }
    }
    return candidates;
  }
  if (target.kind === 'component') {
    return [...circuit.components.values()].map((value) => ({ kind: 'component', value }));
  }
  if (target.kind === 'label') {
    return [...circuit.labels.values()].map((value) => ({ kind: 'label', value }));
  }
  const candidates = [];
  for (const net of circuit.nets.values()) {
    const paths = net.paths();
    for (let branch = 0; branch < paths.length; branch++) {
      for (let segment = 1; segment < paths[branch].length; segment++) {
        candidates.push({ kind: 'wire', value: { net, branch, segment } });
      }
    }
  }
  return candidates;
}

function selectSameTarget(criterion) {
  const target = componentContextTarget;
  if (!target) return;
  const candidates = contextCandidates(target, criterion).filter((candidate) => contextMatches(target, candidate, criterion));
  const refs = candidates.filter(({ kind }) => kind === 'component').map(({ value }) => value.refdes);
  const labels = candidates.filter(({ kind }) => kind === 'label').map(({ value }) => value.id);
  const wires = candidates.filter(({ kind }) => kind === 'wire')
    .map(({ value }) => `${value.net.id}:${value.branch}:${value.segment}`);
  setSelection(refs, target.kind === 'component' ? target.value.refdes : refs[0], true);
  setLabelSelection(labels, target.kind === 'label' ? target.value.id : labels[0], true);
  selectedWires = new Set(wires);
  syncSelectedWire();
  closeComponentContextMenu();
  render();
}

function openComponentContextMenu(target, x, y) {
  if (!componentContextMenuEl || !target) return;
  closeComponentContextMenu();
  componentContextTarget = target;
  const menu = componentContextMenuEl;
  menu.hidden = false;
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - 220))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - 90))}px`;

  const sameButton = document.createElement('button');
  sameButton.type = 'button';
  sameButton.textContent = 'Select same';
  sameButton.setAttribute('aria-haspopup', 'true');
  sameButton.setAttribute('aria-expanded', 'false');
  const arrow = document.createElement('span');
  arrow.textContent = '›';
  arrow.setAttribute('aria-hidden', 'true');
  sameButton.appendChild(arrow);

  const submenu = document.createElement('div');
  submenu.className = 'context-submenu';
  submenu.setAttribute('role', 'menu');
  submenu.setAttribute('aria-label', 'Select same criteria');
  const typeLabel = target.kind === 'component' ? 'Component type' : target.kind === 'wire' ? 'Wire type' : 'Label type';
  for (const [criterion, label] of [['type', typeLabel], ['color', 'Color'], ['lineStyle', 'Linestyle']]) {
    const item = document.createElement('button');
    item.type = 'button';
    item.textContent = label;
    item.setAttribute('role', 'menuitem');
    item.addEventListener('click', () => selectSameTarget(criterion));
    submenu.appendChild(item);
  }
  const openSubmenu = () => {
    submenu.classList.add('open');
    componentContextSubmenu = submenu;
    sameButton.setAttribute('aria-expanded', 'true');
  };
  sameButton.addEventListener('mouseenter', openSubmenu);
  sameButton.addEventListener('focus', openSubmenu);
  sameButton.addEventListener('click', openSubmenu);
  sameButton.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowRight' || ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      openSubmenu();
      submenu.querySelector('button')?.focus();
    }
  });
  menu.append(sameButton, submenu);
  sameButton.focus();
}

canvasEl.addEventListener('contextmenu', (ev) => {
  const world = clientToWorld(ev.clientX, ev.clientY);
  const label = pickLabel(world);
  const annotation = annotationGeometryAt(world);
  const hit = matchAt(snap(world.x), snap(world.y));
  const wire = pickWire(world);
  const target = label
    ? { kind: 'label', value: label }
    : annotation
      ? { kind: 'label', value: annotation }
      : hit?.refdes && circuit.components.has(hit.refdes)
        ? { kind: 'component', value: circuit.components.get(hit.refdes) }
        : wire
          ? { kind: 'wire', value: { net: wire.net, branch: wire.branch, segment: wire.seg } }
          : null;
  ev.preventDefault();
  if (target) openComponentContextMenu(target, ev.clientX, ev.clientY);
  else closeComponentContextMenu();
});
window.addEventListener('mousedown', (ev) => {
  if (componentContextMenuEl?.hidden || componentContextMenuEl.contains(ev.target)) return;
  closeComponentContextMenu();
});
window.addEventListener('keydown', (ev) => {
  if (componentContextMenuEl?.hidden) return;
  if (ev.key === 'Escape') {
    ev.preventDefault();
    closeComponentContextMenu();
    return;
  }
  if (ev.key === 'ArrowLeft' && componentContextSubmenu?.contains(document.activeElement)) {
    ev.preventDefault();
    componentContextSubmenu.classList.remove('open');
    componentContextSubmenu.previousElementSibling?.focus();
  }
});
canvasEl.addEventListener('dragstart', (ev) => ev.preventDefault());
window.addEventListener('mouseup', canvasMouseUp);

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
function inlineEditLabel(label, options = {}) {
  if (!label || inlineInput) return;
  const provisional = !!options.provisional;
  const initialSnapshot = options.initialSnapshot || null;
  const initialName = options.initialName || '';
  lastLabelClick = null; // starting an edit clears any pending double-click state
  const b = label.bbox();
  const pane = document.querySelector('.canvas-pane');
  const r = pane.getBoundingClientRect();
  const sy = r.top + ((b.y - view.y) / view.h) * r.height;
  const sw = (b.w / view.w) * r.width;
  const sh = (b.h / view.h) * r.height;
  // The persistent label box is centered on its anchor regardless of text
  // alignment. Keep the editor centered on that same box as it grows.
  const boxCenterX = r.left + (((b.x + b.w / 2) - view.x) / view.w) * r.width;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = label.text;
  input.spellcheck = false;
  input.className = 'label-inline-editor';
  input.dataset.labelId = label.id;
  input.style.position = 'absolute';
  input.style.zIndex = '30';
  input.style.left = `${boxCenterX - sw / 2}px`;
  input.style.top = `${sy}px`;
  input.style.width = `${sw}px`;
  input.style.height = `${sh}px`;
  input.style.fontSize = `${Math.max(12, LABEL_FONT_SIZE * r.width / view.w)}px`;
  input.style.textAlign = label.align;

  // Measure the live editor text in the same face as the rendered label. The
  // The box grows from the actual text anchor while keeping alignment stable.
  const measure = document.createElement('span');
  measure.className = 'label-inline-editor-measure';
  document.body.appendChild(measure);
  const resize = () => {
    measure.textContent = input.value || ' ';
    measure.style.fontSize = input.style.fontSize;
    const minWidth = Math.max(60, sw);
    const width = Math.max(minWidth, measure.getBoundingClientRect().width + 12);
    input.style.width = `${width}px`;
    input.style.left = `${boxCenterX - width / 2}px`;
  };
  resize();
  input.addEventListener('input', resize);
  document.body.appendChild(input);
  inlineInput = input;
  render();
  input.focus();
  input.select();
  let closed = false;
  const done = (applyText) => {
    if (closed) return;
    closed = true;
    inlineInput = null;
    measure.remove();
    const v = input.value.trim();
    input.remove();
    if (provisional) {
      if (applyText && v) {
        try {
          renameLabelThroughModel(label, v);
          history.push(initialSnapshot || snapshot());
          if (history.length > 200) history.shift();
          future.length = 0;
        } catch (err) {
          logLine(`net label edit cancelled: ${err.message}`, 'error');
          restoreProvisionalLabel(label, initialName);
        }
      } else {
        restoreProvisionalLabel(label, initialName);
      }
    } else if (applyText && v && v !== label.text) commit(() => renameLabelThroughModel(label, v));
    else if (options.removeOnEmpty && !v) commit(() => circuit.removeLabel(label.id));
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
    if (provisional) renameLabelThroughModel(label, res.text);
    else commit(() => renameLabelThroughModel(label, res.text));
    render();
  };
  input.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') done(true);
    else if (ev.key === 'Escape') done(false);
    else if (ev.key === 'Tab') {
      ev.preventDefault();
      done(true);
      cycleLabelSelection(ev.shiftKey ? -1 : 1, label.id);
    }
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
  componentsListEl.setAttribute('role', 'listbox');
  const comps = componentPaletteItems(sortedComps());
  if (comps.length === 0) {
    componentsListEl.innerHTML = '<div class="no-items">No components</div>';
    return;
  }
  for (const comp of comps) {
    const row = document.createElement('div');
    row.className = 'row' + (multi.has(comp.refdes) ? ' selected' : '');
    row.dataset.ref = comp.refdes;
    row.dataset.refdes = comp.refdes;
    row.dataset.type = comp.type;
    row.setAttribute('role', 'option');
    row.tabIndex = 0;
    row.setAttribute('aria-selected', String(multi.has(comp.refdes)));

    const ref = document.createElement('span');
    ref.className = 'ref';
    ref.textContent = comp.refdes;

    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = comp.type;

    const remove = document.createElement('button');
    remove.className = 'remove';
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = `Remove ${comp.refdes}`;
    remove.setAttribute('aria-label', `Remove ${comp.refdes}`);
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
      const now = Date.now();
      const prev = lastComponentClick;
      const doubleClick =
        !ev.shiftKey &&
        prev &&
        prev.refdes === comp.refdes &&
        now - prev.at < 500 &&
        Math.abs(ev.clientX - prev.x) <= 6 &&
        Math.abs(ev.clientY - prev.y) <= 6;
      lastComponentClick = { refdes: comp.refdes, x: ev.clientX, y: ev.clientY, at: now };
      if (doubleClick) {
        startComponentRename(comp, ref);
        return;
      }
      if (ev.shiftKey) {
        const refs = rangeValues(comps, componentRangeAnchor, comp.refdes, (item) => item.refdes);
        setSelection(refs.length ? refs : [comp.refdes], comp.refdes);
      } else {
        setSelection([comp.refdes]);
      }
      componentRangeAnchor = comp.refdes;
      netRangeAnchor = null;
      render();
    });
    row.addEventListener('dblclick', () => {
      // Native dblclick backup for browsers that deliver it (manual detection
      // in the click handler covers row replacement during the first click).
      startComponentRename(comp, ref);
    });
    row.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault();
      row.click();
    });

    componentsListEl.appendChild(row);
  }
}

function renderNets() {
  netsListEl.innerHTML = '';
  netsListEl.setAttribute('role', 'listbox');
  if (circuit.nets.size === 0) {
    netsListEl.innerHTML = '<div class="no-items">No nets</div>';
    return;
  }
  for (const net of visibleNets()) {
    const row = document.createElement('div');
    row.className = 'row' + (selectedNets.has(net.id) ? ' selected' : '');
    row.setAttribute('role', 'option');
    row.tabIndex = 0;
    row.setAttribute('aria-selected', String(selectedNets.has(net.id)));

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
      clearDiagnosticFocus();
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
        const ids = rangeValues(visibleNets(), netRangeAnchor, net.id, (item) => item.id);
        selectedNets = new Set(ids.length ? ids : [net.id]);
      } else {
        selectedNets = new Set([net.id]);
      }
      componentRangeAnchor = null;
      netRangeAnchor = net.id;
      const pt = net.points()[Math.floor(net.points().length / 2)];
      if (pt) cursor = { x: pt.x, y: pt.y };
      render();
    });

    row.addEventListener('dblclick', () => {
      // Native dblclick backup for browsers that deliver it (the manual
      // detection above covers the row-replacing re-render case).
      startNetRename(net, ref);
    });
    row.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault();
      row.click();
    });

    netsListEl.appendChild(row);
  }
}

/** Open the inline refdes editor for a component row. Invalid or occupied
 * names are rejected before commit, leaving the model and selection untouched. */
function startComponentRename(comp, ref) {
  if (!comp || inlineInput) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'rename-input';
  input.value = comp.refdes;
  input.placeholder = comp.refdes;
  input.spellcheck = false;
  ref.replaceWith(input);
  inlineInput = input;
  input.focus();
  input.select();
  let closed = false;
  const done = (applyText) => {
    if (closed) return;
    closed = true;
    inlineInput = null;
    const next = input.value.trim();
    input.replaceWith(ref);
    if (applyText && next && next !== comp.refdes &&
        /^[A-Za-z][A-Za-z0-9_]*$/.test(next) &&
        !circuit.components.has(next)) {
      const previous = comp.refdes;
      commit(() => circuit.renameComponent(previous, next));
      if (componentRangeAnchor === previous) componentRangeAnchor = next;
      if (selected === previous) selected = next;
      if (multi.has(previous)) {
        multi.delete(previous);
        multi.add(next);
      }
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

/** Open the inline rename <input> for a net's row (Enter/blur commits, Esc
 *  cancels). The net name is replaced in place so the row is not re-rendered
 *  mid-edit. */
function startNetRename(net, ref) {
  selectedNets = new Set([net.id]);
  netRangeAnchor = net.id;
  componentRangeAnchor = null;
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
    if (applyText && v && v !== net.name) commit(() => circuit.renameNet(net.id, v));
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
    const role = label.isNetLabel?.() ? `net label on ${label.netId}` : label.owner ? `instance label owned by ${label.owner}` : 'annotation';
    meta.textContent = `${role} "${label.text}"  align: ${label.align}  — t / double-click edit, Tab cycle, Shift+Left/Right align`;
    detailEl.appendChild(meta);

    const table = document.createElement('table');
    const row = document.createElement('tr');
    const a = label.anchorWorld();
    const b = label.bbox();
    for (const [k, v] of [
      ['Text', label.text],
      ['Role', label.isNetLabel?.() ? 'Electrical net label' : label.owner ? 'Instance label' : 'Annotation'],
      ['Align', label.align],
      ['Anchor', `${a.x},${a.y}`],
      ['BBox', `${b.x},${b.y} ${b.w}x${b.h}`],
      ['Owner', label.owner || '—'],
      ['Net', label.netId || '—'],
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
  meta.textContent = `${comp.refdes} (${comp.type})  value: ${comp.value || '-'}  —  Wire: managed/orthogonal or F3-selected diagonal`;
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
  } else if (key === 'Backspace') {
    if (wire?.points?.length) {
      wire.points.pop();
      const last = wire.points[wire.points.length - 1] || wire.source;
      if (last && Number.isFinite(last.x) && Number.isFinite(last.y)) {
        cursor = { x: snap(last.x), y: snap(last.y) };
      }
      logLine('removed last wire vertex');
    }
  } else if (key === 'Enter') {
    commitWireAtCursor();
  } else if (key === 'Tab') {
    // Wires and wire highlights are never part of Tab cycling.
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
  u: 'opamp',
  A: 'and_gate',
  b: 'buffer',
  I: 'input',
  o: 'output',
  O: 'inputoutput',
  a: 'solder',
};


// Human-facing names keep the picker useful at a glance. Aliases stay out of
// the menu while the underlying type remains the stable placement value.
const PLACEMENT_LABELS = {
  resistor: 'Resistor', capacitor: 'Capacitor', inductor: 'Inductor', diode: 'Diode',
  nmos: 'NMOS transistor', pmos: 'PMOS transistor',
  nmosb: 'NMOS transistor with bulk', pmosb: 'PMOS transistor with bulk',
  npn: 'NPN transistor', pnp: 'PNP transistor',
  ground: 'Ground', vcm: 'VCM (Common potential)', supply: 'Supply (VDD/VCC)',
  input: 'Input port', output: 'Output port', inputoutput: 'Input/output port',
  port: 'Port', port_filled: 'Filled port',
  current_source: 'Current source', voltage_source: 'Voltage source',
  opamp: 'Operational amplifier', opamp_diff: 'Differential op-amp', inverter: 'Inverter', buffer: 'Buffer',
  adc: 'ADC', dac: 'DAC',
  and_gate: 'AND gate', nand_gate: 'NAND gate', or_gate: 'OR gate', nor_gate: 'NOR gate',
  xor_gate: 'XOR gate', xnor_gate: 'XNOR gate',
  variable_resistor: 'Variable resistor', variable_capacitor: 'Variable capacitor', variable_inductor: 'Variable inductor',
  solder: 'Solder dot', switch_open: 'Switch, open', switch_closed: 'Switch, closed', label: 'Annotation',
};

const PLACEMENT_ALIASES = {
  resistor: ['res', 'resistance'], capacitor: ['cap'], inductor: ['coil'],
  nmos: ['mos', 'n-channel'], pmos: ['mos', 'p-channel'],
  nmosb: ['mos', 'body', 'bulk', 'n-channel'], pmosb: ['mos', 'body', 'bulk', 'p-channel'],
  npn: ['bjt'], pnp: ['bjt'],
  supply: ['vdd', 'vcc', 'power'], vcm: ['common', 'potential', 'vcm'], input: ['in'], output: ['out'], inputoutput: ['io'],
  current_source: ['idc', 'current'], voltage_source: ['vdc', 'voltage'],
  opamp: ['op amp'], opamp_diff: ['fully differential', 'diff'],
  variable_resistor: ['potentiometer', 'pot'], variable_capacitor: ['var cap'], variable_inductor: ['var coil'],
  switch_open: ['switch', 'open'], switch_closed: ['switch', 'closed'], solder: ['junction', 'dot'],
  label: ['annotation', 'text'],
};

// The registry is the single source of truth for insertable components.
// Grouping is derived from the type name, so adding a symbol to symbolTypes
// automatically adds it to the appropriate menu section.
const INSERT_COMPONENT_TYPES = [...symbolTypeNames];
const INSERT_CATEGORY_RULES = [
  ['Passives', /^(variable_)?(resistor|capacitor|inductor)$|^(diode|switch_)/],
  ['Semiconductors / actives', /^(nmos|pmos|nmosb|pmosb|npn|pnp)$/],
  ['Sources & power', /^(current_source|voltage_source|supply|ground|vcm)$/],
  ['Logic', /^(opamp|opamp_diff|inverter|buffer|.*_gate|adc|dac)$/],
  ['Interfaces / ports', /^(input|output|inputoutput|port|port_filled)$/],
];

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

function placementSearchScore(query, type) {
  return Math.max(
    fuzzyScore(query, type),
    fuzzyScore(query, PLACEMENT_LABELS[type] || type),
    ...(PLACEMENT_ALIASES[type] || []).map((alias) => fuzzyScore(query, alias)),
  );
}

function transformPendingComponent(operation) {
  if (!pendingPlace || pendingPlace.kind !== 'component') return false;
  const def = getSymbol(pendingPlace.type);
  const base = {
    x: cursor.x,
    y: cursor.y,
    rotation: pendingPlace.rotation || 0,
    mirrorX: pendingPlace.mirrorX === null ? !!def.defaultMirrorX : !!pendingPlace.mirrorX,
    mirrorY: pendingPlace.mirrorY === null ? !!def.defaultMirrorY : !!pendingPlace.mirrorY,
  };
  const next = transformComponentWorld(base, { x: cursor.x, y: cursor.y }, operation);
  pendingPlace.rotation = next.rotation;
  pendingPlace.mirrorX = next.mirrorX;
  pendingPlace.mirrorY = next.mirrorY;
  return true;
}

function selectInsertMatch() {
  const entries = insertMenuEntries();
  if (!entries.length) return false;
  const type = entries[0];
  pendingPlace = type === 'label'
    ? { kind: 'label' }
    : { kind: 'component', type, rotation: 0, mirrorX: null, mirrorY: null };
  insertQuery = '';
  return true;
}

function onInsertKey(key, shiftKey = false) {
  if (key === 'u' && pendingPlace) {
    undo();
    return;
  }
  // Arrow keys move the cursor and placement ghost.
  const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key];
  if (arrow) {
    moveCursor(arrow[0], arrow[1]);
    render();
    return;
  }
  // With a ghost selected, r rotates CW and Shift+r mirrors horizontally.
  if (pendingPlace && pendingPlace.kind === 'component' && key === 'r' && !shiftKey) {
    transformPendingComponent('rotate');
    render();
    return;
  }
  if (pendingPlace && pendingPlace.kind === 'component' && (key === 'R' || shiftKey && key.toLowerCase() === 'r')) {
    transformPendingComponent('mirrorX');
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

  // Fuzzy search picker (no ghost): Enter or Tab selects the best match.
  if (key === 'Enter' || key === 'Tab') {
    if (selectInsertMatch()) render();
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

/** Arrow keys grow the selection box; Enter commits it and Escape cancels. */
function onVisualKey(key) {
  const move = {
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
    if (deleteMode && copySelectionExists()) deleteSelection();
    render();
    return;
  }
  if (key === 'Escape' || key === 'v') {
    visual = null;
    render();
    return;
  }
}

function onNormalKey(key, shiftKey = false) {
  if (key === 'Enter' && drag?.mode === 'copyghost') {
    commitCopyGhost();
    return;
  }
  if (movePending && key === 'Enter') {
    commitModalMove();
    return;
  }
  if (/^[0-9]$/.test(key)) {
    counts = counts * 10 + Number(key);
    return;
  }
  const count = counts || 1;
  counts = 0;

  if (key === 'Enter' && labelMode === 'line') {
    commitLineAnnotation();
    return;
  }
  if (key === 'm' || key === 'M') {
    activateMove(shiftKey ? 'detached' : 'connected');
    return;
  }
  if (key === 'a') {
    activateShapeAnnotation('arrow');
    return;
  }
  if (key === 'b') {
    activateShapeAnnotation('box');
    return;
  }
  if (key === 'l') {
    activateShapeAnnotation('line');
    return;
  }
  if (key === 'C' || (key === 'c' && shiftKey)) {
    setCrosshair(!crosshairVisible);
    return;
  }

  if (key === 'c') {
    activateCopy();
    return;
  }

  // x is a quality check now; Shift+x saves without checking.  Mirroring is
  // intentionally no longer bound to x/X (see r/R below).
  if (key === 'x' || key === 'X') {
    if (key === 'X' || shiftKey) saveCircuit();
    else runCheck();
    return;
  }


  if (key === 'L') {
    activateNetLabel();
    return;
  }

  if (key === 'N' && shiftKey) {
    activateAnnotation();
    return;
  }

  // Normal-mode t edits only the primary selected label. Insert-mode t keeps
  // its separate label-placement behavior in onInsertKey.
  if (key === 't') {
    const lab = selectedLabel() || selectedLabels()[0];
    if (lab) inlineEditLabel(lab);
    return;
  }

  const nudgeKey = {
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
        for (const lab of labs) if (!lab.owner) moveLabelSafely(lab, lab.anchorWorld().x + dx, lab.anchorWorld().y + dy);
        // Coincident terminals are resolved only after the complete nudge has
        // been applied. This commit boundary matches mouse-based moves.
        circuit.connectCoincident(refs);
        // Nudging moves the wires too, exactly like a drag: a net whose
        // terminals all ride nudged components translates rigidly with them.
        rerouteTouchedNets(refs, moved);
        circuit.reconnectCoincidentNets();
      });
      wiresDirty = true;
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
    if (shiftKey || key === 'R') {
      selectedTransform('mirror-x');
      return;
    }
    if (!selectedComps().length && !selectedLabels().length && !selectedWires.size && !selectedWire && !selectedNets.size) {
      logLine('nothing selected to rotate');
    } else {
      const total = ((90 * count) % 360 + 360) % 360;
      if (total) rotateSelectionAbout(total);
      const primary = selectedComp() || selectedComps()[0];
      if (copyPivot) cursor = copyPivot;
      else if (primary) cursor = { x: primary.transform.x, y: primary.transform.y };
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
    copySelection();
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
    activateWire();
    return;
  }

  if (key === 'v') {
    // Visual mode: the box grows from the cursor as you move with arrows;
    // Enter commits the box selection (like a marquee), Esc cancels.
    activateVisual();
    return;
  }

  if (key === 'i' || key === 'I' || key === 'A') {
    activatePlace();
    return;
  }

  if (key === ':') {
    cmdInput.value = ':';
    cmdInput.focus();
    cmdInput.setSelectionRange(1, 1);
    return;
  }

  if (key === '?') {
    showHelp();
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
    if (drag?.mode === 'copyghost') cancelDrag();
    undo();
    return;
  }

  if (key === 'U') {
    redo();
    return;
  }

  if (key === 'Tab') {
    const comps = selectedComps();
    const labels = selectedLabels();
    const hasWireSelection = !!selectedWire || selectedWires.size > 0;
    if (!hasWireSelection && selectedNets.size === 0 && multi.size === 1 && selLabels.size === 0 && comps.length === 1) {
      cycleSelection(shiftKey ? -1 : 1);
    } else if (!hasWireSelection && selectedNets.size === 0 && multi.size === 0 && selLabels.size === 1 && labels.length === 1) {
      cycleLabelSelection(shiftKey ? -1 : 1);
    }
    return;
  }

  if (key === 'Backspace') {
    if (labelMode === 'line') {
      if (annotationPoints.length) {
        annotationPoints.pop();
        lastLineClick = null;
        render();
      }
    }
    return;
  }

  if (key === 'Delete') {
    if (deleteMode) {
      if (deleteSelection()) render();
    } else if (copySelectionExists()) {
      deleteSelection();
      render();
    } else {
      activateDelete();
    }
    return;
  }

  if (key === 'F' || key === 'f') {
    fitView();
    return;
  }

  if (key === 'Escape') {
    pendingKey = null;
    moveMode = null;
    copyMode = false;
    deleteMode = false;
    movePending = false;
    copyPending = false;
    labelMode = null;
    annotationStart = null;
    annotationPoints = [];
    setLabelSelection([]);
    selectedNets.clear();
    render();
    return;
  }
}

function keymapText() {
  return editorKeymapText();
}

function logKeymap() {
  logLine(keymapText());
}

let helpText = '';

function renderHelpSearch() {
  if (!helpDialogContent) return;
  const query = helpSearch?.value.trim().toLowerCase() || '';
  if (!query) {
    helpDialogContent.textContent = helpText;
    return;
  }
  const matches = helpText.split('\n').filter((line) => line.toLowerCase().includes(query));
  helpDialogContent.textContent = matches.length ? matches.join('\n') : `No help entries match "${helpSearch.value.trim()}"`;
}

function showHelp() {
  if (!helpDialog) return;
  helpText = keymapText();
  try {
    helpText += `\n\n${commandHelp()}`;
  } catch (err) {
    helpText += `\n\n${String(err.message || err)}`;
  }
  if (helpSearch) helpSearch.value = '';
  renderHelpSearch();
  if (!helpDialog.open) helpDialog.showModal();
  helpSearch?.focus();
}

helpSearch?.addEventListener('input', renderHelpSearch);
helpSearch?.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') ev.preventDefault();
});

// ----- command console ---------------------------------------------------

/** Copied selection.  `nets` are complete electrical nets; `fragments` are
 * terminal-less geometric islands extracted from selected segments. Net labels
 * are carried only inside their complete physical net record. */
let clipboard = null;

function copySelection() {
  // A selected owned/net label is still a real copy source: owned labels bring
  // their component, while net labels bring their physical net. Keep this
  // expansion here so keyboard copy, copy mode, and repeated ghosts agree.
  const labels = selectedLabels();
  const refs = new Set(multi);
  for (const label of labels) if (label.owner) refs.add(label.owner);
  const copyNetIds = new Set(selectedNets);
  for (const label of labels) if (label.netId) copyNetIds.add(label.netId);
  for (const id of copyNetIds) {
    const net = circuit.nets.get(id);
    for (const terminal of net?.terminals || []) refs.add(terminal.comp);
  }
  const comps = [...refs].map((refdes) => circuit.components.get(refdes)).filter(Boolean);
  const selectedFreeLabels = labels.filter((l) => !l.owner && !l.isNetLabel?.());
  const parentIds = new Set(selectedFreeLabels.filter((l) => ['arrow', 'box', 'line'].includes(l.kind)).map((l) => l.id));
  const freeLabels = [...new Map([...selectedFreeLabels, ...circuit.labels.values()].filter((l) => !l.owner && !l.isNetLabel?.() && (selectedFreeLabels.includes(l) || parentIds.has(l.parent))).map((l) => [l.id, l])).values()];
  const hasWholeTerminallessNet = [...copyNetIds].some((id) => {
    const net = circuit.nets.get(id);
    return net && net.terminals.length === 0 && net.paths().some((path) => path.length >= 2);
  });
  if (!comps.length && !freeLabels.length && !selectedWires.size && !selectedWire && !hasWholeTerminallessNet) {
    logLine('nothing selected to copy');
    return false;
  }
  const wireKeys = new Set(selectedWires);
  if (selectedWire) wireKeys.add(`${selectedWire.netId}:${selectedWire.branch}:${selectedWire.segment}`);
  const compRefs = new Set(comps.map((c) => c.refdes));
  const nets = [];
  const fragments = [];
  for (const net of circuit.nets.values()) {
    const ownKeys = [...wireKeys].filter((key) => keyToWire(key).netId === net.id);
    const paths = net.paths();
    const allKeys = paths.flatMap((p, branch) => p.slice(1).map((point, segment) => ({ point, previous: p[segment], segment }))
      .filter(({ point, previous }) => point.x !== previous.x || point.y !== previous.y)
      .map(({ segment }) => `${net.id}:${branch}:${segment + 1}`));
    const internal = net.terminals.length && net.terminals.every((t) => compRefs.has(t.comp));
    const completeTerminalless = !net.terminals.length &&
      (copyNetIds.has(net.id) || (ownKeys.length > 0 && ownKeys.length === allKeys.length));
    // A selected complete internal net is copied once as an ordinary net. A
    // partial selection is extracted below and must not duplicate the net.
    if ((internal && (!ownKeys.length || ownKeys.length === allKeys.length)) || completeTerminalless) {
      nets.push({
        id: net.id,
        name: net.name,
        routingMode: net.routingMode,
        drawOrder: net.drawOrder,
        terminals: net.terminals.map((t) => ({ comp: t.comp, term: t.term })),
        route: net.route ? net.route.map((p) => ({ ...p })) : null,
        branches: net.branches ? net.branches.map((path) => path.map((p) => ({ ...p }))) : null,
        junctions: net.junctions.map((p) => ({ ...p })),
        fixedPaths: net.routingMode === 'fixed' ? net.fixedPaths.map((e) => ({
          points: e.points.map((p) => ({ ...p })), start: e.start && { ...e.start }, end: e.end && { ...e.end },
        })) : null,
        netLabels: circuit.netLabels(net).map((label) => ({
          netId: net.id,
          text: label.text,
          align: label.align,
          netSide: label.netSide,
          x: label.anchorWorld().x,
          y: label.anchorWorld().y,
        })),
      });
    } else if (ownKeys.length) {
      const selected = ownKeys.map((key) => { const w = keyToWire(key); return { branch: w.branch, segment: w.segment }; });
      for (const island of extractWireFragments(paths, selected, net.junctions)) {
        fragments.push({ name: net.name, routingMode: net.routingMode,
          allowDiagonal: net.allowDiagonal, drawOrder: net.drawOrder, paths: island.paths, junctions: island.junctions });
      }
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
  for (const net of [...nets, ...fragments]) {
    const paths = net.paths || (net.path ? [net.path] : (net.branches || net.fixedPaths?.map((e) => e.points) || (net.route ? [net.route] : [])));
    for (const path of paths) for (const p of path) addRect({ x: p.x, y: p.y, w: 0, h: 0 });
  }
  if (!Number.isFinite(x0)) x0 = y0 = x1 = y1 = 0;
  const anchor = { x: snap((x0 + x1) / 2), y: snap((y0 + y1) / 2) };
  const styleSource = selectedStyleSource();
  clipboard = {
    comps: comps.map((c) => ({
      origRef: c.refdes,
      type: c.type,
      x: c.transform.x,
      y: c.transform.y,
      rotation: c.transform.rotation,
      mirrorX: c.transform.mirrorX,
      mirrorY: c.transform.mirrorY,
      style: { ...(c.style || {}) },
    })),
    labels: freeLabels.map((l) => ({
      id: l.id,
      kind: l.kind,
      parent: l.parent,
      text: l.text,
      align: l.align,
      x: l.anchorWorld().x,
      y: l.anchorWorld().y,
      end: l.kind === 'label' ? null : { ...l.end },
      points: l.kind === 'line' ? l.points.map((point) => ({ ...point })) : null,
      style: { ...(l.style || {}) },
    })),
    nets,
    fragments,
    anchor,
    style: styleSource?.style || null,
  };

  logLine(`copied ${comps.length} component(s), ${freeLabels.length} label(s), ${nets.length} net(s), ${fragments.length} wire island(s)`);
  return true;
}

function copyGhostSelection() {
  return {
    refs: selectedComps().map((c) => c.refdes),
    labels: selectedLabels().map((l) => l.id),
    netIds: [...new Set([...circuit.nets.keys()])],
    wireKeys: [...selectedWires],
  };
}

function restoreCopyGhostSelection(ghost) {
  setSelection(ghost.refs, ghost.refs[0], true);
  setLabelSelection(ghost.labels, ghost.labels[0], true);
  selectedNets = new Set(ghost.netIds.filter((id) => circuit.nets.has(id)));
  selectedWires = new Set(ghost.wireKeys);
  selectedWire = selectedWires.size ? keyToWire(selectedWires.values().next().value) : null;
  validateSelectedWires();
}

function translateCopyGhost(ghost, dx, dy) {
  for (const ref of ghost.refs) {
    const comp = circuit.components.get(ref);
    if (comp) {
      comp.transform.x += dx;
      comp.transform.y += dy;
    }
  }
  for (const id of ghost.labels) {
    const label = circuit.labels.get(id);
    if (!label || label.owner) continue;
    label.anchor.x += dx;
    label.anchor.y += dy;
    if (['arrow', 'box', 'line'].includes(label.kind)) {
      label.end.x += dx;
      label.end.y += dy;
      if (label.kind === 'line') label.points = label.points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
      label.textAnchor.x += dx;
      label.textAnchor.y += dy;
    }
  }
  for (const id of ghost.netIds) {
    const net = circuit.nets.get(id);
    if (!net) continue;
    const move = (p) => ({ x: p.x + dx, y: p.y + dy });
    if (net.routingMode === 'fixed') {
      for (const entry of net.fixedPaths) entry.points = entry.points.map(move);
    } else {
      if (net.route) net.route = net.route.map(move);
      if (net.branches) net.branches = net.branches.map((path) => path.map(move));
    }
    net.junctions = net.junctions.map(move);
  }
  circuit.syncJunctionSolders();
}

function startCopyGhost(startWorld, startClient, anchorShift = null) {
  if (!clipboard) return false;
  const beforeSnapshot = snapshot();
  const existingNetIds = new Set(circuit.nets.keys());
  const start = { x: snap(startWorld.x), y: snap(startWorld.y) };
  cursor = start;
  pasteClipboard({ recordHistory: false, connect: false });
  const ghost = copyGhostSelection();
  ghost.netIds = ghost.netIds.filter((id) => !existingNetIds.has(id));
  // The source click is the placement anchor, not the clipboard set center.
  // Translate the freshly pasted set back by the same offset so the clicked
  // source point remains under the cursor while all relative geometry stays
  // unchanged.
  const shift = anchorShift || {
    x: clipboard.anchor.x - start.x,
    y: clipboard.anchor.y - start.y,
  };
  translateCopyGhost(ghost, shift.x, shift.y);
  ghost.anchorShift = { ...shift };
  ghost.beforeSnapshot = beforeSnapshot;
  ghost.baseSnapshot = snapshot();
  ghost.baseGeometry = captureCopyGhostGeometry(ghost);
  ghost.startWorld = start;
  drag = {
    mode: 'copyghost',
    startWorld: start,
    startClient,
    ghost,
    moved: false,
    rubber: null,
  };
  copyPending = true;
  render();
  return true;
}

function moveCopyGhost(w) {
  if (!drag?.ghost) return;
  const ghost = drag.ghost;
  if (ghost.baseGeometry) {
    restoreCopyGhostGeometry(ghost);
  } else {
    circuit = Circuit.fromJSON(JSON.parse(ghost.baseSnapshot));
  }
  const dx = snap(w.x) - snap(drag.startWorld.x);
  const dy = snap(w.y) - snap(drag.startWorld.y);
  translateCopyGhost(ghost, dx, dy);
  restoreCopyGhostSelection(ghost);
  cursor = { x: snap(w.x), y: snap(w.y) };
  wiresDirty = true;
}

function commitCopyGhost() {
  if (!drag?.ghost) return false;
  const ghost = drag.ghost;
  circuit.connectCoincident(ghost.refs);
  circuit.reconnectCoincidentNets();
  circuit.ensureUniqueTerminals(ghost.refs);
  circuit.syncJunctionSolders();
  history.push(ghost.beforeSnapshot);
  if (history.length > 200) history.shift();
  future.length = 0;
  const anchorShift = ghost.anchorShift;
  drag = null;
  copyPending = false;
  startCopyGhost({ x: cursor.x, y: cursor.y }, { x: 0, y: 0 }, anchorShift);
  return true;
}

/** Paste the clipboard at the cursor (re-centred on the selection anchor). */
function pasteClipboard({ recordHistory = true, connect = true } = {}) {
  if (!clipboard) {
    logLine('nothing copied');
    return;
  }
  const dx = snap(cursor.x) - clipboard.anchor.x;
  const dy = snap(cursor.y) - clipboard.anchor.y;
  const addedComps = [];
  const addedLabels = [];
  const addedNetLabels = [];
  const apply = () => {
    const refMap = new Map();
    const wasLoading = circuit._loading;
    // Do not let addComponent's coincidence hook create memberships before
    // the copied net records exist.  Otherwise a paste at an existing pin can
    // leave that terminal in both the old and the copied net.
    circuit._loading = true;
    try {
      for (const c of clipboard.comps) {
        const comp = circuit.addComponent(c.type, {
          x: c.x + dx,
          y: c.y + dy,
          rotation: c.rotation,
          mirrorX: c.mirrorX,
          mirrorY: c.mirrorY,
          style: c.style,
        });
        refMap.set(c.origRef, comp.refdes);
        addedComps.push(comp.refdes);
      }
      const labelMap = new Map();
      for (const l of clipboard.labels.filter((label) => ['arrow', 'box', 'line'].includes(label.kind))) {
        const shape = circuit.addAnnotation(l.kind, {
          x: l.x + dx, y: l.y + dy, end: l.end && { x: l.end.x + dx, y: l.end.y + dy },
          points: l.points?.map((point) => ({ x: point.x + dx, y: point.y + dy })), style: l.style,
        });
        labelMap.set(l.id, shape.id);
        addedLabels.push(shape.id);
      }
      for (const l of clipboard.labels.filter((label) => label.kind === 'label')) {
        const nl = circuit.addLabel({ text: l.text, align: l.align, parent: l.parent ? labelMap.get(l.parent) : null, x: l.x + dx, y: l.y + dy, style: l.style });
        addedLabels.push(nl.id);
      }
      const netMap = new Map();
      for (const n of clipboard.nets) {
      const fixedPaths = n.routingMode === 'fixed' ? n.fixedPaths.map((e) => ({
        points: e.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
        start: e.start && refMap.has(e.start.comp) ? { comp: refMap.get(e.start.comp), term: e.start.term } : null,
        end: e.end && refMap.has(e.end.comp) ? { comp: refMap.get(e.end.comp), term: e.end.term } : null,
      })) : null;
      const net = circuit.createWireNet({ name: n.name, routingMode: n.routingMode, allowDiagonal: n.allowDiagonal, drawOrder: n.drawOrder, fixedPaths });
      netMap.set(n.id, net);
      for (const t of n.terminals) {
        const newRef = refMap.get(t.comp);
        if (newRef) net.terminals.push({ comp: newRef, term: t.term });
      }
        if (n.routingMode !== 'fixed') {
          net.route = n.route ? n.route.map((p) => ({ x: p.x + dx, y: p.y + dy })) : null;
          net.junctions = n.junctions.map((p) => ({ x: p.x + dx, y: p.y + dy }));
          net.branches = n.branches ? n.branches.map((b) => b.map((p) => ({ x: p.x + dx, y: p.y + dy }))) : null;
        }
        for (const label of n.netLabels || []) {
          const anchor = { x: label.x + dx, y: label.y + dy };
          const targetNet = netMap.get(label.netId) || net;
          const pasted = targetNet.name
            ? circuit.addNetLabel(targetNet.id, { anchor, align: label.align, netSide: label.netSide })
            : circuit.addLabel({ text: '', netId: targetNet.id, netSide: label.netSide, x: anchor.x, y: anchor.y, align: label.align });
          addedNetLabels.push(pasted.id);
        }
      }
      const pastedWireKeys = [];
      for (const fragment of clipboard.fragments || []) {
      const paths = fragment.paths.map((path) => path.map((p) => ({ x: p.x + dx, y: p.y + dy })));
      const net = circuit.createWireNet(fragment.routingMode === 'fixed'
        ? { name: fragment.name, routingMode: 'fixed', drawOrder: fragment.drawOrder, fixedPaths: paths.map((path) => ({ points: path, start: null, end: null })), junctions: fragment.junctions.map((p) => ({ x: p.x + dx, y: p.y + dy })) }
        : { name: fragment.name, routingMode: 'managed', allowDiagonal: fragment.allowDiagonal, drawOrder: fragment.drawOrder, branches: paths, route: paths[0], junctions: fragment.junctions.map((p) => ({ x: p.x + dx, y: p.y + dy })) });
        for (let branch = 0; branch < paths.length; branch++) {
          for (let segment = 1; segment < paths[branch].length; segment++) {
            if (paths[branch][segment - 1].x === paths[branch][segment].x && paths[branch][segment - 1].y === paths[branch][segment].y) continue;
            pastedWireKeys.push(`${net.id}:${branch}:${segment}`);
          }
        }
      }
      circuit._loading = wasLoading;
      // Coincidence is resolved once, against the complete copied topology.
      if (connect) circuit.connectCoincident(addedComps);
      circuit.ensureUniqueTerminals(addedComps);
      circuit.syncJunctionSolders();
      setSelection(addedComps, undefined, true);
      setLabelSelection([...addedLabels, ...addedNetLabels], undefined, true);
      selectedWires = new Set(pastedWireKeys);
      syncSelectedWire();
    } finally {
      circuit._loading = wasLoading;
    }
  };
  if (recordHistory) commit(apply);
  else apply();
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
    if (trimmed.split(/\s+/)[0].toLowerCase() === 'clear') resetCheckState();
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

const TOOLBAR_IDS = {
  normal: ['btn-mode-select', 'btn-select', 'mode-select'],
  place: ['btn-place', 'btn-insert', 'btn-mode-place', 'tool-place', 'tool-insert', 'mode-place'],
  wire: ['btn-wire', 'btn-mode-wire', 'tool-wire', 'mode-wire'],
  visual: ['btn-mode-visual', 'btn-box-select', 'tool-visual', 'mode-visual'],
  move: ['btn-move', 'btn-mode-move', 'tool-move', 'mode-move'],
  'move-detached': ['btn-move-detached', 'btn-detach-move', 'btn-mode-detach-move', 'btn-detached-move', 'tool-move-detached', 'mode-detached-move'],
  copy: ['btn-copy', 'btn-mode-copy', 'tool-copy', 'mode-copy'],
  delete: ['btn-delete', 'btn-mode-delete', 'tool-delete', 'mode-delete'],
  'send-back': ['btn-send-back'],
  'bring-front': ['btn-bring-front'],
  'net-label': ['btn-net-label', 'btn-mode-net-label', 'tool-net-label', 'mode-net-label'],
  annotation: ['btn-annotation', 'btn-mode-annotation', 'tool-annotation', 'mode-annotation'],
  arrow: ['btn-arrow', 'btn-mode-arrow', 'tool-arrow', 'mode-arrow'],
  box: ['btn-box', 'btn-mode-box', 'tool-box', 'mode-box'],
  line: ['btn-line', 'btn-mode-line', 'tool-line', 'mode-line'],
  rotate: ['btn-rotate', 'tool-rotate'],
  'mirror-x': ['btn-mirror-x', 'btn-mirror-horizontal', 'tool-mirror-x', 'tool-mirror-horizontal'],
  'mirror-y': ['btn-mirror-y', 'btn-mirror-vertical', 'tool-mirror-y', 'tool-mirror-vertical'],
  check: ['btn-check', 'btn-evaluate', 'tool-check'],
  save: ['btn-save', 'btn-save-circuit', 'tool-save'],
};

function interactionState() {
  return deriveInteractionState({ mode, labelMode, wire, directWire, visual, moveMode, copyMode, deleteMode, movePending, copyPending, routeMode });
}

function toolbarElements(action) {
  const selectors = (TOOLBAR_IDS[action] || []).map((id) => `#${id}`);
  selectors.push(`[data-interaction="${action}"]`, `[data-tool="${action}"]`, `[data-mode="${action}"]`, `[data-action="${action}"]`);
  return [...new Set(selectors.flatMap((selector) => [...document.querySelectorAll(selector)]))];
}

/** Apply all interaction affordances from one derived state. */
function syncInteractionUI() {
  const state = interactionState();
  for (const action of Object.keys(TOOLBAR_IDS)) {
    const active = state.toolbar === action;
    for (const el of toolbarElements(action)) {
      el.setAttribute('aria-pressed', String(active));
      el.setAttribute('aria-current', active ? 'true' : 'false');
      el.classList.toggle('active', active);
    }
  }
  for (const kind of ['orthogonal', 'diagonal']) {
    const active = routeMode === kind;
    for (const el of routeModeElements(kind)) {
      el.setAttribute('aria-pressed', String(active));
      el.setAttribute('aria-current', active ? 'true' : 'false');
      if (el.tagName === 'INPUT') el.checked = active;
      el.classList.toggle('active', active);
    }
  }
  for (const id of ['routing-mode', 'route-mode', 'route-mode-select', 'route-choice']) {
    const select = document.getElementById(id);
    if (select?.tagName === 'SELECT') select.value = routeMode;
  }
  canvasEl.classList.remove('mode-normal', 'mode-place', 'mode-insert', 'mode-wire', 'mode-visual', 'mode-move', 'mode-detached-move', 'mode-copy', 'mode-delete', 'mode-net-label', 'mode-annotation', 'wire-mode', 'direct-wire-mode');
  canvasEl.classList.add(state.canvasClass);
  if (wire) canvasEl.classList.add('wire-mode');
  if (directWire) canvasEl.classList.add('direct-wire-mode');
  return state;
}

function renderStatus() {
  const interaction = syncInteractionUI();
  const comp = selectedComp();
  const label = selectedLabel();
  const sel = label
    ? `${label.isNetLabel?.() ? 'net' : label.owner ? 'instance' : 'annotation'} "${label.text}"${selLabels.size > 1 ? ` +${selLabels.size - 1}` : ''}`
    : comp
      ? `${comp.refdes}${multi.size > 1 ? ` +${multi.size - 1}` : ''}`
      : '-';
  const parts = [interaction.label, `sel ${sel}`, `@${cursor.x},${cursor.y}`];
  if (visual) {
    parts.push('box from cursor · arrows grow · Enter select · Esc cancel');
  }
  if (mode === 'insert') {
    parts.push(pendingPlace ? `place ${pendingPlace.kind === 'label' ? 'label' : pendingPlace.type} @ click/Enter · arrows move · R/X · Esc cancel` : insertQuery ? `~${insertQuery} · Enter pick` : 'type or alias to filter · Esc exit');
  }
  if (labelMode === 'net') parts.push('click wire · selected/highlighted net resolves crossings · Esc cancel');
  if (labelMode === 'annotation') parts.push('click anywhere for free text · Esc cancel');
  if (wire) {
    parts.push(
      wire.source
        ? wire.source.fixed
          ? `WIRE fixed endpoint @ (${wire.source.fixed.point.x},${wire.source.fixed.point.y}) → click points / target`
          : wire.source.refdes
            ? `WIRE ${wire.source.refdes}.${wire.source.term} → terminal click commits · other clicks guide · Enter commits`
            : `WIRE (${wire.source.x},${wire.source.y}) → terminal click commits · other clicks guide · Enter commits`
        : `WIRE (${wire.routeStyle || routeMode}): click a terminal to commit, or any point to start`,
    );
  }
  if (directWire) {
    parts.push(directWire.source
      ? `${directWire.source.fixed ? 'fixed endpoint suffix' : `${directWire.routeMode || routeMode} direct path`}${directWire.points.length ? ` · ${directWire.points.length} point${directWire.points.length === 1 ? '' : 's'}` : ''} · click waypoints / terminal / wire · Enter · Esc cancel`
      : 'click a terminal or open fixed endpoint to start · Esc cancel');
  }
  if (selectedNets.size) parts.push(`nets ${selectedNets.size}`);
  if (lastCheckReport && (diagnosticSelection.components.size || diagnosticSelection.nets.size || diagnosticSelection.labels.size)) {
    parts.push(`check focus ${diagnosticSelection.components.size + diagnosticSelection.nets.size + diagnosticSelection.labels.size}`);
  }
  if (netWarnings.length) parts.push('⚠ wire overlap with another net (highlighted)');
  if (circuit.netNameWarnings?.length) parts.push('⚠ merged net names require reconciliation');
  statusEl.textContent = parts.join('  ·  ');
  statusEl.className = `status ${interaction.key}`;
  if (directWire) statusEl.classList.add('direct-wire');
  else if (wire) statusEl.classList.add('wire');
  else if (mode === 'insert') statusEl.classList.add('insert');
}

// ----- insert-mode menu ----------------------------------------------------
// A read-only, non-interactive dropdown next to the cursor (shown in insert
// mode) listing every placable component by name. `pointer-events: none` keeps
// it from intercepting clicks/drags.
let insertMenu = null;
// Every registered symbol type appears in the menu automatically; the list is
// fuzzy-filtered by the live `insertQuery` while typing.
function insertMenuEntries() {
  return insertMenuGroups().flatMap((group) => group.entries);
}

function insertMenuGroups() {
  const groups = INSERT_CATEGORY_RULES.map(([title, rule]) => ({
    title,
    entries: INSERT_COMPONENT_TYPES.filter((type) => rule.test(type)),
  }));
  groups.push({ title: 'Annotations', entries: ['solder', 'label'] });
  if (!insertQuery) return groups.filter((group) => group.entries.length);
  for (const group of groups) {
    group.entries = group.entries
      .map((type) => [type, placementSearchScore(insertQuery, type)])
      .filter(([, score]) => score >= 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([type]) => type);
  }
  const filtered = groups.filter((group) => group.entries.length);
  return filtered.sort((a, b) => (
    placementSearchScore(insertQuery, b.entries[0]) - placementSearchScore(insertQuery, a.entries[0])
  ));
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
  const groups = insertMenuGroups();
  insertMenu._entries = groups.flatMap((group) => group.entries);
  if (!insertMenu._entries.length) {
    const none = document.createElement('div');
    none.className = 'insert-menu-none';
    none.textContent = 'no match';
    insertMenu.appendChild(none);
  }
  for (const group of groups) {
    const heading = document.createElement('div');
    heading.className = 'insert-menu-category';
    heading.textContent = group.title;
    insertMenu.appendChild(heading);
    for (const type of group.entries) {
      const item = document.createElement('div');
      item.className = 'insert-menu-item';
      const name = document.createElement('span');
      name.textContent = PLACEMENT_LABELS[type] || type;
      item.appendChild(name);
      insertMenu.appendChild(item);
    }
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

// ----- Virtuoso-compatible toolbar actions ----------------------------------

function hasWireDraft() {
  return !!wire || !!directWire;
}

function hasModalPlacement() {
  return !!drag?.modal && (movePending || copyPending);
}

function activateLabelPlacement(kind) {
  if (hasWireDraft() || hasModalPlacement()) {
    logLine('finish or cancel the active interaction before placing a label');
    return;
  }
  mode = 'normal';
  pendingPlace = null;
  insertQuery = '';
  visual = null;
  moveMode = null;
  copyMode = false;
  deleteMode = false;
  movePending = false;
  copyPending = false;
  labelMode = kind;
  annotationStart = null;
  annotationPoints = [];
  logLine(kind === 'net'
    ? 'NET LABEL: click a physical wire; stays active until Esc'
    : kind === 'annotation'
      ? 'ANNOTATION: click anywhere to place free text; stays active until Esc'
      : `${kind.toUpperCase()}: click start and end points; stays active until Esc`);
  render();
}

function activateNetLabel() {
  activateLabelPlacement('net');
}

function activateAnnotation() {
  activateLabelPlacement('annotation');
}

function activateShapeAnnotation(kind) {
  activateLabelPlacement(kind);
}

function activatePlace() {
  if (hasWireDraft() || hasModalPlacement()) { logLine('finish the active interaction before placing'); return; }
  moveMode = null;
  copyMode = false;
  deleteMode = false;
  movePending = false;
  copyPending = false;
  visual = null;
  labelMode = null;
  annotationPoints = [];
  mode = 'insert';
  pendingPlace = null;
  insertQuery = '';
  render();
}

function activateSelect() {
  if (hasWireDraft() || hasModalPlacement()) { logLine('finish or cancel the active interaction first'); return; }
  mode = 'normal';
  pendingPlace = null;
  insertQuery = '';
  visual = null;
  labelMode = null;
  annotationPoints = [];
  moveMode = null;
  copyMode = false;
  deleteMode = false;
  movePending = false;
  copyPending = false;
  render();
}
function activateVisual() {
  if (hasWireDraft() || hasModalPlacement()) { logLine('finish or cancel the active interaction before box selection'); return; }
  mode = 'normal';
  moveMode = null;
  copyMode = false;
  // Keep Delete mode armed so a visual box can delete the selected set on
  // Enter, matching the immediate-delete semantics of click selection.
  movePending = false;
  copyPending = false;
  labelMode = null;
  annotationPoints = [];
  visual = { x: cursor.x, y: cursor.y };
  selectedNets.clear();
  render();
}

function activateDelete() {
  if (hasWireDraft() || hasModalPlacement()) { logLine('finish or cancel the active interaction before deleting'); return; }
  if (copySelectionExists()) {
    deleteSelection();
    deleteMode = false;
    render();
    return;
  }
  mode = 'normal';
  visual = null;
  moveMode = null;
  copyMode = false;
  movePending = false;
  copyPending = false;
  labelMode = null;
  annotationPoints = [];
  deleteMode = true;
  render();
}

function activateWire() {
  // Re-clicking Wire is intentionally harmless: a toolbar click must not lose
  // a partially drawn path, including its manually entered waypoints.
  if (hasWireDraft() || hasModalPlacement()) { logLine('active interaction retained'); render(); return; }
  moveMode = null;
  copyMode = false;
  deleteMode = false;
  movePending = false;
  copyPending = false;
  visual = null;
  labelMode = null;
  annotationPoints = [];
  mode = 'normal';
  // F3 changes the route style of this same managed workflow.  Diagonal wires
  // never become direct/fixed nets.
  wire = newWireDraft();
  logLine(`wiring (${routeMode}): click a terminal to commit, or any point to start; Enter commits elsewhere`);
  render();
}

function activateMove(kind = 'connected') {
  if (hasWireDraft() || hasModalPlacement()) { logLine('finish or cancel the active interaction before moving'); return; }
  mode = 'normal';
  visual = null;
  copyMode = false;
  deleteMode = false;
  movePending = false;
  copyPending = false;
  labelMode = null;
  annotationPoints = [];
  moveMode = kind === 'detached' ? 'detached' : 'connected';
  render();
}

function activateCopy() {
  if (hasWireDraft() || hasModalPlacement()) { logLine('finish or cancel the active interaction before copying'); return; }
  mode = 'normal';
  visual = null;
  moveMode = null;
  deleteMode = false;
  movePending = false;
  copyPending = false;
  labelMode = null;
  annotationPoints = [];
  copyMode = true; // source click and placement are handled by the canvas
  logLine('COPY: click an object, or use the existing selection; move the copy, then click/Enter (Esc exits)');
  render();
}

function selectedTransform(action) {
  clearDiagnosticFocus();
  if (hasWireDraft()) { logLine('finish or cancel the active wire before transforming'); return; }
  if (!selectedComps().length && !selectedLabels().length && !selectedWires.size && !selectedWire && !selectedNets.size) {
    logLine('nothing selected to transform');
    return;
  }
  if (action === 'rotate') rotateSelectionAbout(90);
  else mirrorSelectionAbout(action === 'mirror-x' ? 'x' : 'y');
  render();
}
function evaluationText(report) {
  const problems = [
    report.unconnectedTerminals?.length && `${report.unconnectedTerminals.length} unconnected terminal(s)`,
    report.overlappingBBoxes?.length && `${report.overlappingBBoxes.length} overlapping bbox pair(s)`,
    report.wireThroughBBoxes?.length && `${report.wireThroughBBoxes.length} wire/body violation(s)`,
    report.diagonalWireSegments?.length && `${report.diagonalWireSegments.length} diagonal segment(s)`,
    report.gridViolations?.length && `${report.gridViolations.length} grid violation(s)`,
    report.crossNetOverlaps?.length && `${report.crossNetOverlaps.length} cross-net overlap(s)`,
    report.labelComponentOverlaps?.length && `${report.labelComponentOverlaps.length} label/component overlap(s)`,
    report.labelOverlaps?.length && `${report.labelOverlaps.length} label overlap(s)`,
    report.netNameWarnings?.length && `${report.netNameWarnings.length} merged net name conflict(s)`,
  ].filter(Boolean);
  return problems.length ? `Check: ${problems.join('; ')}` : 'Check: no evaluator violations';
}

const CHECK_CATEGORIES = [
  ['unconnectedTerminals', 'Unconnected terminals'],
  ['overlappingBBoxes', 'Overlapping components'],
  ['wireThroughBBoxes', 'Wire through component body'],
  ['diagonalWireSegments', 'Diagonal segments'],
  ['gridViolations', 'Grid violations'],
  ['crossNetOverlaps', 'Cross-net wire overlaps'],
  ['labelComponentOverlaps', 'Label/component overlaps'],
  ['labelOverlaps', 'Label overlaps'],
];

function checkIssueTargets(category, value, structuredIssue) {
  const text = String(value);
  const components = new Set();
  const nets = new Set();
  const labels = new Set();
  if (category === 'labelComponentOverlaps') {
    // Label targets come from evaluate().issues, not from the human-readable
    // legacy strings in labelComponentOverlaps.
    if (structuredIssue?.labelId && circuit.labels.has(structuredIssue.labelId)) labels.add(structuredIssue.labelId);
    if (structuredIssue?.componentRef && circuit.components.has(structuredIssue.componentRef)) components.add(structuredIssue.componentRef);
  } else if (category === 'labelOverlaps') {
    for (const id of structuredIssue?.labelIds || []) if (circuit.labels.has(id)) labels.add(id);
  } else if (category === 'unconnectedTerminals') {
    const match = text.match(/^([A-Za-z][A-Za-z0-9_-]*)\./);
    if (match) components.add(match[1]);
  } else if (category === 'overlappingBBoxes') {
    for (const ref of text.split('/')) if (circuit.components.has(ref)) components.add(ref);
  } else {
    const net = text.match(/\bnet\s+([^\s:]+)/i);
    if (net && circuit.nets.has(net[1])) nets.add(net[1]);
    const through = text.match(/\bthrough\s+([A-Za-z][A-Za-z0-9_-]*)/i);
    if (through && circuit.components.has(through[1])) components.add(through[1]);
    const first = text.match(/^([A-Za-z][A-Za-z0-9_-]*)\b/);
    if (category === 'gridViolations' && first && circuit.components.has(first[1])) components.add(first[1]);
  }
  if (category === 'crossNetOverlaps' && value) {
    for (const key of [value.key, value.otherKey]) {
      const id = String(key || '').split(':')[0];
      if (circuit.nets.has(id)) nets.add(id);
    }
  }
  return { components, nets, labels };
}

function checkIssues(report) {
  const out = [];
  for (const [key, label] of CHECK_CATEGORIES) {
    const values = report[key] || [];
    const kind = key === 'labelComponentOverlaps' ? 'label-component-overlap' : key === 'labelOverlaps' ? 'label-overlap' : null;
    const structured = kind ? (report.issues || []).filter((issue) => issue.kind === kind) : [];
    for (let index = 0; index < values.length; index++) {
      const value = values[index];
      const targets = checkIssueTargets(key, value, structured[index]);
      out.push({ category: key, label, value, ...targets });
    }
  }
  return out;
}

function diagnosticFromReport(report) {
  const components = new Set();
  const nets = new Set();
  const labels = new Set();
  for (const issue of checkIssues(report)) {
    for (const ref of issue.components) components.add(ref);
    for (const id of issue.nets) nets.add(id);
    for (const id of issue.labels) labels.add(id);
  }
  diagnosticSelection = { components, nets, labels };
}

function focusCheckIssue(issue) {
  const points = [];
  for (const ref of issue.components) {
    const comp = circuit.components.get(ref);
    if (comp) {
      const b = comp.bboxWorld();
      points.push({ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y + b.h });
    }
  }
  for (const id of issue.labels) {
    const label = circuit.labels.get(id);
    if (label) {
      const b = label.bbox();
      points.push({ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y + b.h });
    }
  }
  for (const id of issue.nets) {
    const net = circuit.nets.get(id);
    for (const path of net?.paths() || []) points.push(...path);
  }
  diagnosticSelection = { components: new Set(issue.components), nets: new Set(issue.nets), labels: new Set(issue.labels) };
  if (!points.length) { render(); return; }
  const x0 = Math.min(...points.map((p) => p.x));
  const y0 = Math.min(...points.map((p) => p.y));
  const x1 = Math.max(...points.map((p) => p.x));
  const y1 = Math.max(...points.map((p) => p.y));
  const p = paneSize();
  const aspect = p ? p.w / p.h : view.w / view.h;
  let w = Math.max(view.w, x1 - x0 + 240);
  let h = Math.max(view.h, y1 - y0 + 240);
  if (w / h > aspect) h = w / aspect;
  else w = h * aspect;
  w = Math.min(Math.max(w, minViewW()), maxViewW());
  h = w / aspect;
  view.w = w;
  view.h = h;
  view.x = (x0 + x1) / 2 - w / 2;
  view.y = (y0 + y1) / 2 - h / 2;
  cursor = { x: snap((x0 + x1) / 2), y: snap((y0 + y1) / 2) };
  render();
}

function renderCheckSummary() {
  if (!checkSummaryBodyEl) return;
  checkSummaryBodyEl.replaceChildren();
  if (!lastCheckReport) {
    checkSummaryBodyEl.textContent = 'Not checked yet.';
    return;
  }
  const issues = checkIssues(lastCheckReport);
  const result = document.createElement('div');
  result.className = issues.length ? 'check-issues' : 'check-pass';
  result.textContent = issues.length ? `Issues found: ${issues.length}` : 'Pass: no issues found';
  checkSummaryBodyEl.appendChild(result);
  for (const [key, label] of CHECK_CATEGORIES) {
    const count = (lastCheckReport[key] || []).length;
    const row = document.createElement('div');
    row.className = count ? 'check-category issue' : 'check-category';
    row.textContent = `${label}: ${count}`;
    checkSummaryBodyEl.appendChild(row);
  }
  for (const warning of lastCheckReport.netNameWarnings || []) {
    const row = document.createElement('div');
    row.className = 'check-category warning';
    row.textContent = `Net naming warning: ${warning.message}`;
    checkSummaryBodyEl.appendChild(row);
  }
  for (const issue of issues) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'check-issue';
    button.textContent = `${issue.label}: ${typeof issue.value === 'string' ? issue.value : `${issue.value.x0},${issue.value.y0}–${issue.value.x1},${issue.value.y1}`}`;
    button.addEventListener('click', () => focusCheckIssue(issue));
    checkSummaryBodyEl.appendChild(button);
  }
}

function runCheck() {
  try {
    const report = evaluate(circuit);
    lastCheckReport = report;
    diagnosticFromReport(report);
    renderCheckSummary();
    const hasProblems = report.ok === false || CHECK_CATEGORIES.map(([key]) => key)
      .some((key) => report[key]?.length);
    logLine(evaluationText(report), hasProblems ? 'error' : undefined);
    return report;
  } catch (err) {
    logLine(`Check failed: ${err.message || err}`, 'error');
    return null;
  }
}

const ROUTE_MODE_IDS = {
  orthogonal: ['route-orthogonal', 'route-mode-orthogonal', 'btn-route-orthogonal', 'btn-route-ortho', 'btn-orthogonal-route'],
  diagonal: ['route-diagonal', 'route-mode-diagonal', 'btn-route-diagonal', 'btn-diagonal-route'],
};

function routeModeElements(kind) {
  const selectors = (ROUTE_MODE_IDS[kind] || []).map((id) => `#${id}`);
  selectors.push(`[data-route-mode="${kind}"]`, `[data-route="${kind}"]`);
  return [...new Set(selectors.flatMap((selector) => [...document.querySelectorAll(selector)]))];
}

function routeChoiceContainers() {
  return ['route-mode-controls', 'route-controls', 'route-choice', 'route-mode']
    .map((id) => document.getElementById(id)).filter(Boolean)
    .filter((el) => !['SELECT', 'INPUT', 'BUTTON'].includes(el.tagName));
}

function exposeRouteChoice() {
  routeChoiceExposed = true;
  for (const el of routeChoiceContainers()) {
    el.hidden = false;
    el.classList.add('exposed');
    el.setAttribute('aria-expanded', 'true');
  }
  for (const kind of ['orthogonal', 'diagonal']) for (const el of routeModeElements(kind)) el.hidden = false;
  for (const id of ['btn-route-mode', 'route-mode-toggle', 'btn-route-choice']) {
    const el = document.getElementById(id);
    if (el) el.setAttribute('aria-expanded', 'true');
  }
  for (const id of ['routing-mode', 'route-mode', 'route-mode-select', 'route-choice']) {
    const el = document.getElementById(id);
    if (el) el.hidden = false;
  }
}

function setRouteMode(next, announce = true) {
  const wanted = next === 'diagonal' ? 'diagonal' : 'orthogonal';
  routeMode = wanted;
  if (wire) {
    // Route choice is latched on the persistent wire command.  Changing F3 or
    // the selector while a draft is active therefore changes the exact model
    // options that the next commit will use, rather than merely changing the
    // status text or a preview.
    wire.routeStyle = wanted;
    wire.allowDiagonal = wanted === 'diagonal';
  }
  exposeRouteChoice();
  for (const kind of ['orthogonal', 'diagonal']) {
    for (const el of routeModeElements(kind)) {
      if (el.tagName === 'INPUT') el.checked = kind === wanted;
      el.setAttribute('aria-pressed', kind === wanted ? 'true' : 'false');
    }
  }
  const select = ['routing-mode', 'route-mode', 'route-mode-select', 'route-choice']
    .map((id) => document.getElementById(id)).find((el) => el?.tagName === 'SELECT');
  if (announce) logLine(`route mode: ${wanted}${hasWireDraft() ? ' (active wire draft updated)' : ''}`);
  render();
}

function toggleRouteMode() {
  exposeRouteChoice();
  setRouteMode(routeMode === 'orthogonal' ? 'diagonal' : 'orthogonal');
}

function bindInteractionControls() {
  const actions = {
    normal: activateSelect,
    place: activatePlace,
    wire: activateWire,
    visual: activateVisual,
    move: () => activateMove('connected'),
    'move-detached': () => activateMove('detached'),
    'detach-move': () => activateMove('detached'),
    copy: activateCopy,
    delete: activateDelete,
    'send-back': () => restackSelected('back'),
    'bring-front': () => restackSelected('front'),
    'net-label': activateNetLabel,
    annotation: activateAnnotation,
    arrow: () => activateShapeAnnotation('arrow'),
    box: () => activateShapeAnnotation('box'),
    line: () => activateShapeAnnotation('line'),
    rotate: () => selectedTransform('rotate'),
    'mirror-x': () => selectedTransform('mirror-x'),
    'mirror-y': () => selectedTransform('mirror-y'),
    check: runCheck,
    save: saveCircuit,
  };
  for (const [action, fn] of Object.entries(actions)) {
    for (const el of toolbarElements(action)) {
      if (el.dataset.interactionBound) continue;
      el.dataset.interactionBound = 'true';
      el.addEventListener('click', (ev) => { ev.preventDefault(); fn(); });
    }
  }

  for (const kind of ['orthogonal', 'diagonal']) {
    for (const el of routeModeElements(kind)) {
      if (el.tagName === 'INPUT' && el.checked) routeMode = kind;
      if (el.dataset.routeBound) continue;
      el.dataset.routeBound = 'true';
      el.addEventListener('click', (ev) => { ev.preventDefault(); setRouteMode(kind); });
      if (el.tagName === 'INPUT') el.addEventListener('change', () => { if (el.checked) setRouteMode(kind); });
    }
  }
  const select = ['routing-mode', 'route-mode', 'route-mode-select', 'route-choice'].map((id) => document.getElementById(id)).find((el) => el?.tagName === 'SELECT');
  if (select && !select.dataset.routeBound) {
    if (select.value === 'diagonal' || select.value === 'orthogonal') routeMode = select.value;
    select.dataset.routeBound = 'true';
    select.addEventListener('change', () => setRouteMode(select.value));
  }
  for (const el of ['btn-route-mode', 'route-mode-toggle', 'btn-route-choice', 'route-mode']
    .map((id) => document.getElementById(id)).filter(Boolean)) {
    if (el.dataset.routeBound) continue;
    el.dataset.routeBound = 'true';
    el.addEventListener('click', (ev) => { ev.preventDefault(); toggleRouteMode(); });
  }
  // Normalize every route control after reading the initial choice so the
  // selector, radio/button affordances, and the persistent draft state start
  // from one value.
  setRouteMode(routeMode, false);
}

bindInteractionControls();
for (const [id, field] of [['style-color', 'color'], ['style-line', 'lineStyle'], ['style-width', 'width']]) {
  document.getElementById(id)?.addEventListener('change', (ev) => applySelectedStyle(field, ev.target.value));
}

clearCheckButtonEl?.addEventListener('click', () => {
  clearCheckReport();
  render();
});

if (deleteDialog) {
  deleteDialog.addEventListener('close', () => {
    if (deleteDialog.returnValue === 'confirm') deleteSavedCircuit();
  });
}
if (switchDialog) {
  switchDialog.addEventListener('close', () => {
    const name = pendingCircuitLoad;
    pendingCircuitLoad = null;
    if (switchDialog.returnValue === 'discard' && name) loadCircuit(name);
    else circuitSelectEl.value = currentCircuitName;
  });
}

document.getElementById('btn-new-circuit').addEventListener('click', () => {
  circuitNameEl.value = '';
  currentCircuitName = '';
  history.push(snapshot());
  future.length = 0;
  circuit = new Circuit();
  resetCheckState();
  directWire = null;
  wire = null;
  moveMode = null;
  copyMode = false;
  deleteMode = false;
  movePending = false;
  copyPending = false;
  labelMode = null;
  setSelection([]);
  selectedNets.clear();
  cursor = { x: 0, y: 0 };
  view = viewFromCenter(0, 0);
  render();
  circuitNameEl.focus();
  logLine('Started a new circuit. Enter a name and save to create its files.');
});

document.getElementById('btn-load-circuit').addEventListener('click', () => requestCircuitLoad());
deleteCircuitBtn?.addEventListener('click', askDeleteCircuit);
exportCircuitBtn?.addEventListener('click', exportCircuit);
circuitNameEl.addEventListener('input', renderSaveState);
circuitSelectEl.addEventListener('change', () => requestCircuitLoad(circuitSelectEl.value));


document.getElementById('btn-help').addEventListener('click', () => {
  showHelp();
});

// ----- theme (dark mode) ---------------------------------------------

const THEME_KEY = 'schematic-spawner:theme';
const themeBtn = document.getElementById('btn-theme');

function applyTheme(dark) {
  document.documentElement.classList.toggle('dark', dark);
  setButtonLabel(themeBtn, dark ? 'Light' : 'Dark');
  if (themeBtn) themeBtn.title = dark ? 'Switch to light theme' : 'Switch to dark theme';
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
    setButtonLabel(gridBtn, showGrid ? 'Grid' : 'Grid off');
    gridBtn.title = showGrid ? 'Hide the placement grid (#)' : 'Show the placement grid (#)';
  }
  render();
  logLine(showGrid ? 'grid shown' : 'grid hidden');
}

if (gridBtn) {
  gridBtn.addEventListener('click', () => setGrid(!showGrid));
  setButtonLabel(gridBtn, showGrid ? 'Grid' : 'Grid off');
  gridBtn.title = 'Hide the placement grid (#)';
}

// Crosshair visibility is independent from pointer presence: the pointer
// leaving the canvas hides it, while this toggle controls whether it may
// render when the pointer is inside.
const crosshairBtn = document.getElementById('btn-crosshair');
function setCrosshair(on, announce = true) {
  crosshairVisible = !!on;

  if (crosshairBtn) {
    crosshairBtn.classList.toggle('off', !crosshairVisible);
    setButtonLabel(crosshairBtn, crosshairVisible ? 'Crosshair' : 'Crosshair off');
    crosshairBtn.title = crosshairVisible ? 'Hide the crosshair (C)' : 'Show the crosshair (C)';
  }
  render();
  if (announce) logLine(crosshairVisible ? 'crosshair shown' : 'crosshair hidden');
}
if (crosshairBtn) {
  crosshairBtn.addEventListener('click', () => setCrosshair(!crosshairVisible));
  crosshairBtn.classList.toggle('off', !crosshairVisible);
  setButtonLabel(crosshairBtn, crosshairVisible ? 'Crosshair' : 'Crosshair off');
  crosshairBtn.title = crosshairVisible ? 'Hide the crosshair (C)' : 'Show the crosshair (C)';
}

// ----- keyboard -------------------------------------------------------------

window.addEventListener('keydown', (ev) => {
  if (helpDialog?.open) {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      helpDialog.close();
      return;
    }
    if (ev.target !== helpSearch) {
      if (helpSearch && ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        helpSearch.focus();
        const start = helpSearch.selectionStart ?? helpSearch.value.length;
        const end = helpSearch.selectionEnd ?? start;
        helpSearch.setRangeText(ev.key, start, end, 'end');
        renderHelpSearch();
        ev.preventDefault();
      }
      return;
    }
  }

  const tag = (ev.target && ev.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    if (ev.target === cmdInput && ev.key === 'Escape') {
      cmdInput.value = '';
      cmdInput.blur();
    }
    return;
  }

  // `dd` is a consecutive-key chord. Any intervening key or handled command
  // cancels the first d, except for an unmodified second d within the normal
  // mode timeout window. This also covers global commands such as Ctrl+A,
  // which are handled before onNormalKey below.
  const isDeleteContinuation = ev.key === 'd' && !ev.ctrlKey && !ev.metaKey && !ev.altKey
    && mode === 'normal' && !visual && !wire && !directWire
    && pendingKey?.key === 'd' && Date.now() - pendingKey.at < 800;
  if (ev.metaKey || ev.ctrlKey) {
    const k = ev.key.toLowerCase();
    if (k === 'i' || k === 'b') {
      ev.preventDefault();
      toggleSelectedLabelFont(k === 'i' ? 'italic' : 'bold');
    } else if (k === 'z') {
      ev.preventDefault();
      if (drag?.mode === 'copyghost') cancelDrag();
      undo();
    } else if (k === 'y') {
      ev.preventDefault();
      redo();
    } else if (k === 'r' && !ev.shiftKey) {
      ev.preventDefault();
      if (mode === 'insert' && pendingPlace?.kind === 'component') {
        transformPendingComponent('mirrorY');
        render();
      } else {
        selectedTransform('mirror-y');
      }
    } else if (k === 'a') {
      ev.preventDefault();
      // Preserve the component selection while adding labels: the selection
      // setters are exclusive by default, so Ctrl+A must explicitly request a
      // mixed selection. Wire segments are not separately selected here;
      // non-empty nets cover the complete drawing for delete/copy operations.
      setSelection([...circuit.components.keys()], undefined, true);
      setLabelSelection([...circuit.labels.keys()], undefined, true);
      selectedWire = null;
      selectedWires.clear();
      // Select every non-empty net too, so Ctrl+A grabs the whole drawing.
      selectedNets = new Set(
        [...circuit.nets.values()]
          .filter((n) => n.paths().some((path) => path.length >= 2))
          .map((n) => n.id)
      );
      render();
    } else if (k === 'c') {
      ev.preventDefault();
      copySelection();
    } else if (k === 'v' && ev.shiftKey) {
      ev.preventDefault();
      pasteStyle();
    } else if (k === 'v') {
      ev.preventDefault();
      pasteClipboard();
    } else if (k === 's') {
      ev.preventDefault();
      saveCircuit();
    }
    return;
  }

  const key = ev.key;
  if (key === 'F3') {
    ev.preventDefault();
    toggleRouteMode();
    return;
  }
  if (key.startsWith('F') && /^F\d+$/.test(key)) return;

  // Escape cancels an in-progress mouse drag (e.g. a stuck wire re-route).
  if (key === 'Escape' && drag) {
    ev.preventDefault();
    const wasCopyGhost = drag.mode === 'copyghost';
    cancelDrag();
    if (wasCopyGhost) {
      copyMode = true;
      moveMode = null;
      movePending = false;
      copyPending = false;
      render();
      return;
    }
    if (movePending || copyPending) {
      moveMode = null;
      copyMode = false;
      movePending = false;
      copyPending = false;
      render();
    }
    return;
  }

  // Layering is available only in idle normal mode. The helper keeps arrow
  // keys available to active interactions and text controls.
  const layerAction = layerActionForKey({
    key, shiftKey: ev.shiftKey, ctrlKey: ev.ctrlKey, metaKey: ev.metaKey, altKey: ev.altKey,
    mode, wire: !!wire, directWire: !!directWire, visual: !!visual, drag: !!drag,
    moveMode, copyMode, deleteMode, labelMode,
  });
  if (layerAction) {
    ev.preventDefault();
    restackSelected(layerAction === 'bring-front' ? 'front' : 'back');
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

  if (directWire) {
    if (key === 'u') {
      undo();
      return;
    } else if (key === 'U') {
      redo();
      return;
    } else if (key === 'Escape') {
      directWire = null;
      logLine('direct wire cancelled');
    } else if (key === 'Backspace') {
      if (directWire.points.length) directWire.points.pop();
    } else if (key === 'Enter') {
      commitDirectAtCursor();
    }
    render();
  } else if (wire) {
    onWireKey(key);
  } else if (mode === 'insert') {
    onInsertKey(key, ev.shiftKey);
  } else if (visual) {
    onVisualKey(key);
  } else {
    onNormalKey(key, ev.shiftKey);
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

// The footer also has a native CSS resize affordance. This small handle adds
// keyboard access and keeps its separator value useful to assistive tech.
function consoleHeightBounds() {
  if (!consoleEl) return { min: 92, max: 420 };
  const style = getComputedStyle(consoleEl);
  const min = Number.parseFloat(style.minHeight) || 92;
  const maxValue = Number.parseFloat(style.maxHeight);
  return { min, max: Number.isFinite(maxValue) ? Math.max(min, maxValue) : Math.max(min, window.innerHeight) };
}

function syncConsoleResizer() {
  if (!consoleEl || !consoleResizerEl) return;
  const { min, max } = consoleHeightBounds();
  const height = Math.round(consoleEl.getBoundingClientRect().height);
  consoleResizerEl.setAttribute('aria-valuemin', String(Math.round(min)));
  consoleResizerEl.setAttribute('aria-valuemax', String(Math.round(max)));
  consoleResizerEl.setAttribute('aria-valuenow', String(Math.max(Math.round(min), Math.min(Math.round(max), height))));
  consoleResizerEl.setAttribute('aria-valuetext', `${height} pixels`);
}

function setConsoleHeight(height) {
  if (!consoleEl) return;
  const { min, max } = consoleHeightBounds();
  consoleEl.style.height = `${Math.max(min, Math.min(max, height))}px`;
  syncConsoleResizer();
}

if (consoleResizerEl && consoleEl) {
  let resizeStart = null;
  consoleResizerEl.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    resizeStart = { y: ev.clientY, height: consoleEl.getBoundingClientRect().height };
    consoleResizerEl.setPointerCapture?.(ev.pointerId);
    consoleResizerEl.classList.add('dragging');
    ev.preventDefault();
  });
  consoleResizerEl.addEventListener('pointermove', (ev) => {
    if (!resizeStart) return;
    setConsoleHeight(resizeStart.height - ev.clientY + resizeStart.y);
    ev.preventDefault();
  });
  const endConsoleResize = (ev) => {
    if (!resizeStart) return;
    resizeStart = null;
    consoleResizerEl.classList.remove('dragging');
    if (ev.pointerId !== undefined) consoleResizerEl.releasePointerCapture?.(ev.pointerId);
  };
  consoleResizerEl.addEventListener('pointerup', endConsoleResize);
  consoleResizerEl.addEventListener('pointercancel', endConsoleResize);
  consoleResizerEl.addEventListener('keydown', (ev) => {
    const { min, max } = consoleHeightBounds();
    const step = ev.shiftKey ? 64 : 16;
    if (ev.key === 'ArrowUp') setConsoleHeight(consoleEl.getBoundingClientRect().height + step);
    else if (ev.key === 'ArrowDown') setConsoleHeight(consoleEl.getBoundingClientRect().height - step);
    else if (ev.key === 'Home') setConsoleHeight(min);
    else if (ev.key === 'End') setConsoleHeight(max);
    else return;
    ev.preventDefault();
  });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(syncConsoleResizer).observe(consoleEl);
  window.addEventListener('resize', syncConsoleResizer);
  syncConsoleResizer();
}
