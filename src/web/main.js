/**
 * Mosfeteer — keyboard-driven schematic editor.
 *
 * Modes:
 *   NORMAL   arrows move (selected comp or cursor), l line annotation, r rotate, Shift+r mirror,
 *            Shift+Up/Down layer, dd delete, y/p copy-paste, Ctrl+Shift+V paste style, Ctrl+I/B
 *            toggle italic/bold on selected labels, w single managed wire mode, Tab cycle, Enter select-at-cursor,
 *   INSERT   type to fuzzy-search a component/label, Enter picks a ghost, arrows move cursor, Esc back.
 *   VISUAL   arrows grow a selection box, Enter commits it (like a marquee).
 *   WIRE     terminal letters pick/complete connections.
 */

import { Circuit, INTERFACE_PIN_TYPES, LABEL_FONT_SIZE, componentLabelText, containedWireSegments, diagonalDraftPath, extractWireFragments, isReferenceMarker, isReferenceMarkerGlobalName, normalizeComponentRefdes, parseLabelRuns, referenceMarkerInfo, referenceMarkerIsLocal, stripMathDelimiters, transformComponentWorld, transformWorldPoints } from '../core/model.js';
import { getSymbol, symbolTypeNames } from '../core/components/index.js';
import { runCommand, commandHelp, evaluate } from '../core/commands.js';
import { analyzeSmallSignalV2 } from '../core/analysis/engine.js';
import { adaptCombinedReport } from '../core/analysis/report-adapter.js';
import { smallSignalSchematic } from '../core/analysis/model-schematic.js';
import { editorOverlay, svgString, texToMathML } from '../core/render.js';
import { componentsOfSymbols } from '../core/analysis/provenance.js';
import { themeInkSvg } from '../core/style.js';
import { defaultArrowhead, polylineArrowheadStyles, polylineArrowheadValue, arrowheadEnds } from '../core/line-style.js';
import { createDocument, loadDocument, renderDocument } from '../core/document.js';
import { snap, GRID } from '../core/grid.js';
import { resolveCopySelection } from '../core/selection.js';
import { DRAWING_EXPORT_OPTIONS, selectionDrawing } from '../core/selection-drawing.js';
import { svgToPngDataUrl, applyExportDarkTheme, withEmbeddedMathFont } from './drawing-export.js';
import { writeDrawingToClipboard } from './clipboard.js';
import { distanceToSegment } from '../core/geometry.js';
import { applyMarkup } from '../core/model.js';
import { smartRoute } from '../core/router.js';
import { moveJunctionEndpoint, wireRunAt, moveWireRun } from '../core/wireedit.js';
import { crossNetOverlaps, pointOnPath } from '../core/wiring.js';
import { copyableLabelPayload, selectedSetMoveSource, completeSelectedNetIds as selectedCompleteNetIds, chooseWireHitCandidate } from './selection.js';
import { buildWireHitIndex, queryWireHitIndex } from './wire-index.js';
import { commitFeedbackDiff, commitFeedbackSvg, isEmptyFeedback } from './commit-feedback.js';
import { INSERT_RECENT_LIMIT, PLACEMENT_LABELS, componentPaletteItems, editorKeymap, layerActionForKey, minimalRevealScroll, naturalCompare, placementSearchScore, withRecentType } from './toolbar.js';
import { createPersistenceAdapter, defaultExportDirectory, validDocumentName } from './persistence.js';
import { confirmChoice, showFileDialog } from './file-dialog.js';
import { analysisOptionDefaults, migrateAnalysisFormState, normalizeAnalysisOptions } from './analysis-options.js';
import { analysisFormDefaults, analysisFormStorageKey, analysisNetOptionText, formatAnalysisDeviceRegions, pruneAnalysisDeviceRegions, pruneAnalysisNetValues } from './analysis-state.js';
import { alignedAnchorShift, constrainAxis, isKeyboardSurfaceTarget, isPrimaryPointerEvent, isSelectionModifier, moveAnnotationEndpoint, nearestPoint, shouldForwardCanvasMove, shouldPanTouch, symmetryOperation, viewFollowingCursor, worldAndCursorFromClient } from './interaction.js';
import { alignmentPlan, componentLayoutItem, describeGuides, distributionPlan, ghostLayoutItem, labelLayoutItem, placementGuides } from './layout.js';

// ----- boot failure surface --------------------------------------
// If the module fails to load/parse/import, show the problem instead of a dead page.

const banner = () => document.getElementById('boot-banner');

window.addEventListener('error', (ev) => {
  const b = banner();
  if (b) {
    b.textContent = `App failed to start: ${ev.message || 'unknown error'} — use the browser-only release or start the local server.`;
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
const accessibilityAnnouncementEl = document.getElementById('accessibility-announcement');
const logEl = document.getElementById('log');
const cmdInput = document.getElementById('cmd-input');
const consoleEl = document.getElementById('console-panel');
const consoleResizerEl = document.getElementById('console-resizer');
const circuitSelectEl = document.getElementById('circuit-select');
const circuitNameEl = document.getElementById('circuit-name');
const newDocumentButton = document.getElementById('btn-new-document');
const deleteCircuitBtn = document.getElementById('btn-delete-circuit');
const revealDocumentBtn = document.getElementById('btn-reveal-document');
const exportCircuitBtn = document.getElementById('btn-export');
const analysisButton = document.getElementById('btn-analysis');
const deleteDialog = document.getElementById('delete-dialog');
const deleteDialogMessage = document.getElementById('delete-dialog-message');
const switchDialog = document.getElementById('switch-dialog');
const switchDialogMessage = document.getElementById('switch-dialog-message');
const exportDialog = document.getElementById('export-dialog');
const exportForm = document.getElementById('export-form');
const exportCancel = document.getElementById('export-cancel');
const exportGridInput = exportForm?.querySelector('input[name="grid"]');
const exportDarkInput = exportForm?.querySelector('input[name="dark"]');
const checkSummaryBodyEl = document.getElementById('check-summary-body');
const clearCheckButtonEl = document.getElementById('btn-clear-check');
const helpDialog = document.getElementById('help-dialog');
const helpDialogContent = document.getElementById('help-dialog-content');
const helpSearch = document.getElementById('help-search');
const analysisDialog = document.getElementById('analysis-dialog');
const analysisForm = document.getElementById('analysis-form');
const analysisTarget = document.getElementById('analysis-target');
const analysisReference = document.getElementById('analysis-reference');
const analysisInput = document.getElementById('analysis-input');
const analysisAcGrounds = document.getElementById('analysis-ac-grounds');
const analysisDeviceRegions = document.getElementById('analysis-device-regions');
const analysisApproxRo = document.getElementById('analysis-approx-ro');
const analysisApproxBody = document.getElementById('analysis-approx-body');
const analysisApproxMiller = document.getElementById('analysis-approx-miller');
const analysisParasitics = document.getElementById('analysis-parasitics');
const analysisApproxGmRo = document.getElementById('analysis-approx-gmro');
const analysisApproxDominantPole = document.getElementById('analysis-approx-dominant-pole');
const analysisResult = document.getElementById('analysis-result');
const analysisEquation = document.getElementById('analysis-equation');
const analysisDetails = document.getElementById('analysis-details');
const analysisNetlistPanel = document.getElementById('analysis-panel-netlist');
const analysisNetlist = document.getElementById('analysis-netlist');
const analysisModelPanel = document.getElementById('analysis-panel-model');
const analysisModelEl = document.getElementById('analysis-model');
const analysisModelOpen = document.getElementById('analysis-model-open');
const modelDialog = document.getElementById('model-dialog');
const modelDialogTitle = document.getElementById('model-dialog-title');
const modelDialogFigure = document.getElementById('model-dialog-figure');
const modelDialogNotes = document.getElementById('model-dialog-notes');
const modelDialogRubber = document.getElementById('model-dialog-rubber');
const analysisTabButtons = [...document.querySelectorAll('[data-analysis-tab]')];
const analysisTabPanels = new Map([...document.querySelectorAll('.analysis-tab-panel')]
  .map((panel) => [panel.id.replace(/^analysis-panel-/, ''), panel]));
const analysisCancel = document.getElementById('analysis-cancel');
const analysisAnnotate = document.getElementById('analysis-annotate');

function setAnalysisResultTab(name = 'equations') {
  const requested = analysisTabPanels.has(name) ? name : 'equations';
  for (const button of analysisTabButtons) {
    const active = button.dataset.analysisTab === requested;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  }
  for (const [key, panel] of analysisTabPanels) panel.hidden = key !== requested;
}

for (const button of analysisTabButtons) {
  button.addEventListener('click', () => setAnalysisResultTab(button.dataset.analysisTab));
  button.addEventListener('keydown', (ev) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key)) return;
    ev.preventDefault();
    const enabled = analysisTabButtons.filter((tab) => !tab.disabled);
    const index = enabled.indexOf(button);
    const next = ev.key === 'Home' ? 0
      : ev.key === 'End' ? enabled.length - 1
        : (index + (ev.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length;
    enabled[next]?.focus();
    if (enabled[next]) setAnalysisResultTab(enabled[next].dataset.analysisTab);
  });
}
setAnalysisResultTab();

// Small line icons keep the compact tool rail scannable without a dependency.
// Button text and existing aria labels remain the accessible names.
const ICON_PATHS = {
  'folder-open': '<path d="M3 6.5h6l2 2h10v9H3z"/><path d="M3 6.5V5h7l2 2h9"/>',
  folder: '<path d="M3 6.5h6l2 2h10v10H3z" fill="currentColor" fill-opacity=".16"/><path d="M3 6.5V5h7l2 2"/>',
  workspace: '<path d="M4 5h16v14H4z" fill="currentColor" fill-opacity=".16"/><path d="M4 9h16"/>',
  'file-plus': '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h4M12 11v6M9 14h6"/>',
  trash: '<path d="M4 6.5h16M9.5 6.5V4.5h5v2"/><path d="M6.5 6.5l1 13h9l1-13" fill="currentColor" fill-opacity=".16"/><path d="M10.5 10.5v6M13.5 10.5v6"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  analysis: '<path d="M4 19h16M6 16l4-5 3 3 5-7"/><path d="M6 19V5m6 14V9m6 10V4"/>',
  save: '<path d="M5 4h12l3 3v13H4V4zM8 4v6h8V4M8 20v-6h8v6"/>',
  download: '<path d="M12 3v12m0 0 5-5m-5 5-5-5M4 20h16"/>',
  grid: '<path d="M4 4h16v16H4zM4 10h16M4 16h16M10 4v16M16 4v16"/>',
  crosshair: '<circle cx="12" cy="12" r="6"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>',
  guides: '<path d="M5 4v16M12 4v16M19 4v16" stroke-dasharray="3 2.4"/><path d="M5 12h7M12 12h7"/><path d="M5 9.5v5M12 9.5v5M19 9.5v5"/>',
  moon: '<path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  'align-left': '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>',
  'align-center': '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>',
  'align-right': '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>',
  more: '<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3"/>',
  'route-orthogonal': '<path d="M4 18h8V6h8"/>',
  'route-diagonal': '<path d="M4 18h5l6-12h5"/>',
  cursor: '<path d="M6 3.5 18.5 12l-5.8 1.4L9.5 19.5z" fill="currentColor" fill-opacity=".16"/>',
  plus: '<rect x="3.5" y="3.5" width="17" height="17" rx="4" fill="currentColor" fill-opacity=".16"/><path d="M12 8v8M8 12h8"/>',
  'wire-diagonal': '<path d="M5 18h4l6-12h4"/><circle cx="5" cy="18" r="2.2" fill="currentColor" stroke="none"/><circle cx="19" cy="6" r="2.2" fill="currentColor" stroke="none"/>',
  wire: '<path d="M5 18h6V6h8"/><circle cx="5" cy="18" r="2.2" fill="currentColor" stroke="none"/><circle cx="19" cy="6" r="2.2" fill="currentColor" stroke="none"/>',
  'box-select': '<rect x="3.5" y="3.5" width="14" height="14" rx="2" stroke-dasharray="3 2.4"/><path d="m12.5 12.5 8 3-3.4 1.2-1.2 3.4z" fill="currentColor" stroke="none"/>',
  move: '<path d="M12 5v14M5 12h14"/><path d="m12 2 3.2 3.8H8.8zM12 22l-3.2-3.8h6.4zM2 12l3.8-3.2v6.4zM22 12l-3.8 3.2V8.8z" fill="currentColor" stroke="none"/>',
  detach: '<rect x="8" y="6.5" width="8" height="11" rx="1.8" fill="currentColor" fill-opacity=".16"/><path d="M2.5 12H5M19 12h2.5"/><path d="m5.5 9-1 6M19.5 9l-1 6"/>',
  copy: '<rect x="3.5" y="3.5" width="11" height="11" rx="2"/><rect x="9.5" y="9.5" width="11" height="11" rx="2" fill="currentColor" fill-opacity=".16"/>',
  tag: '<path d="M3.5 4.5v7l9 9 8-8-9-9h-7z" fill="currentColor" fill-opacity=".16"/><circle cx="8" cy="8.5" r="1.6" fill="currentColor" stroke="none"/>',
  text: '<path d="M5 6.5V4.5h14v2M12 4.5v15M9 19.5h6"/>',
  arrow: '<path d="M5 19 16 8"/><path d="M20 4l-1.6 9-7.4-7.4z" fill="currentColor" stroke="none"/>',
  rectangle: '<rect x="3.5" y="5.5" width="17" height="13" rx="2" fill="currentColor" fill-opacity=".16"/>',
  line: '<path d="M6 18 18 6"/><circle cx="5" cy="19" r="2" fill="currentColor" stroke="none"/><circle cx="19" cy="5" r="2" fill="currentColor" stroke="none"/>',
  front: '<rect x="3.5" y="3.5" width="11" height="11" rx="2" stroke-dasharray="2.6 2.2"/><rect x="9.5" y="9.5" width="11" height="11" rx="2" fill="currentColor" fill-opacity=".45"/>',
  back: '<rect x="9.5" y="9.5" width="11" height="11" rx="2" stroke-dasharray="2.6 2.2"/><rect x="3.5" y="3.5" width="11" height="11" rx="2" fill="currentColor" fill-opacity=".45"/>',
  'x-circle': '<circle cx="12" cy="12" r="8"/><path d="m9 9 6 6m0-6-6 6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1.2.8-1.5 1.3-1.5 2.5M12 17h.01"/>',
  // Line-style choices are shown as the pattern itself, using the same
  // dash ratios as styleAttrs() in core/style.js, scaled to the icon grid.
  'line-solid': '<path d="M2 12h20"/>',
  'line-dashed': '<path d="M2 12h20" stroke-dasharray="5 4"/>',
  'line-dash-dot': '<path d="M2 12h20" stroke-dasharray="6 3 1 3"/>',
  'line-dotted': '<path d="M2 12h20" stroke-linecap="round" stroke-dasharray="0.1 4"/>',
  'width-thin': '<path d="M3 12h18" stroke-width="2"/>',
  'width-normal': '<path d="M3 12h18" stroke-width="3.5"/>',
  'width-thick': '<path d="M3 12h18" stroke-width="5.5"/>',
  'arrow-start': '<path d="M20 12H7"/><path d="M4 12l5.5-4v8z" fill="currentColor" stroke="none"/>',
  'arrow-end': '<path d="M4 12h13"/><path d="M20 12l-5.5-4v8z" fill="currentColor" stroke="none"/>',
};

// The canvas pointer is the select arrow, badged with the active tool's rail
// icon so the current mode reads where the eye already is. Cursors are data
// URIs built from the same ICON_PATHS the rail draws, cached per icon/theme.
const CURSOR_ARROW = 'M1.5 1 1.5 18.5 6.1 14.3 9 20.6 11.9 19.2 9.1 13.2 15 12.7Z';

const TOOL_CURSOR_ICONS = {
  normal: null,
  place: 'plus',
  visual: 'box-select',
  move: 'move',
  'detached-move': 'detach',
  copy: 'copy',
  delete: 'trash',
  'net-label': 'tag',
  annotation: 'text',
  equation: 'text',
  arrow: 'arrow',
  box: 'rectangle',
  line: 'line',
};

const toolCursorCache = new Map();

/** One `cursor` value: arrow plus optional tool badge, outlined so it stays
 * legible on light paper, dark paper, and over drawn ink. */
function toolCursorValue(icon, { dark = false, danger = false } = {}) {
  const key = `${icon || ''}|${dark}|${danger}`;
  const cached = toolCursorCache.get(key);
  if (cached) return cached;
  const ink = dark ? '#f4f5f7' : '#16181d';
  const halo = dark ? '#16181d' : '#ffffff';
  const badgeInk = danger ? (dark ? '#ff8f85' : '#c33b2e') : ink;
  const glyph = ICON_PATHS[icon] || '';
  const badge = glyph
    ? `<g transform="translate(14 14) scale(.7)" fill="none" stroke-linecap="round" stroke-linejoin="round">`
      + `<g style="color:${halo}" stroke="${halo}" stroke-width="4.8">${glyph}</g>`
      + `<g style="color:${badgeInk}" stroke="${badgeInk}" stroke-width="2.2">${glyph}</g></g>`
    : '';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">'
    + `<path d="${CURSOR_ARROW}" fill="${ink}" stroke="${halo}" stroke-width="1.4" stroke-linejoin="round"/>`
    + `${badge}</svg>`;
  // The hotspot is the arrow tip, so the pointer still picks the exact grid point.
  const value = `url("data:image/svg+xml,${encodeURIComponent(svg)}") 2 1, default`;
  toolCursorCache.set(key, value);
  preloadToolCursorImage(value);
  return value;
}

function cursorIconFor(state) {
  if (state.key === 'wire') return routeMode === 'diagonal' ? 'wire-diagonal' : 'wire';
  return TOOL_CURSOR_ICONS[state.key] ?? null;
}

let appliedToolCursor = null;

/** Point `.canvas` at the cursor for the live tool; CSS inherits it into the SVG. */
function syncToolCursor(state = interactionState()) {
  const dark = document.documentElement.classList.contains('dark');
  const value = toolCursorValue(cursorIconFor(state), { dark, danger: state.key === 'delete' });
  if (value === appliedToolCursor) return; // every render calls this; only real changes touch style
  appliedToolCursor = value;
  canvasEl?.style.setProperty('--tool-cursor', value);
}

// Chromium paints an image cursor only once its bitmap has loaded, so every
// variant is fetched up front and its Image kept alive to hold the decoded
// bitmap in the memory cache: a swap never waits on a fetch. This does not
// make a tool change visible under a parked pointer — the compositor repaints
// the cursor on the next pointer motion — which is out of the page's reach.
const toolCursorImages = [];

function preloadToolCursorImage(value) {
  const image = new Image();
  image.src = value.slice(value.indexOf('"') + 1, value.lastIndexOf('"'));
  toolCursorImages.push(image);
}

/** Build (and so fetch) every cursor the editor can switch to, in both themes. */
function preloadToolCursors() {
  const icons = new Set([...Object.values(TOOL_CURSOR_ICONS), 'wire', 'wire-diagonal']);
  for (const dark of [false, true]) {
    for (const icon of icons) toolCursorValue(icon, { dark });
    toolCursorValue(TOOL_CURSOR_ICONS.delete, { dark, danger: true });
  }
}

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

installButtonIcons();
preloadToolCursors();
const modeToolbarEl = document.querySelector('.mode-toolbar');
// ----- editor state ----------------------------------------------

const persistence = createPersistenceAdapter();

function configureBrowserOnlyUi() {
  if (!persistence.browserOnly) return;
  // These actions depend on the local server's filesystem. Browser mode uses
  // native file pickers and downloads instead of pretending that a browser can
  // browse or reveal arbitrary folders.
  for (const id of ['btn-workspace', 'btn-reveal-document']) document.getElementById(id)?.setAttribute('hidden', '');
  const forget = document.getElementById('btn-delete-circuit');
  if (forget) {
    forget.textContent = 'Forget from browser…';
    forget.title = 'Remove the current document from this browser\'s cached document list';
  }
  const deleteTitle = document.getElementById('delete-dialog-title');
  if (deleteTitle) deleteTitle.textContent = 'Forget browser document?';
  const confirmDelete = document.getElementById('confirm-delete');
  if (confirmDelete) confirmDelete.textContent = 'Forget document';
  const pdf = exportForm?.querySelector('input[name="format"][value="pdf"]');
  if (pdf) {
    pdf.checked = false;
    pdf.disabled = true;
    pdf.closest('label')?.setAttribute('title', 'PDF export is not available in browser-only mode; use the browser print command.');
  }
}

configureBrowserOnlyUi();

let circuit = new Circuit();
let mode = 'normal'; // 'normal' | 'insert'
let labelMode = null; // null | 'net' | 'annotation' | 'equation' | 'arrow' | 'box' | 'line'
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
// Symmetric placement. While Alt is held with a component ghost armed, its
// origin becomes a mirror axis and a second, mirrored ghost follows on the
// far side of it, so a differential pair or any other mirrored structure is
// placed in one gesture. Releasing Alt drops the twin; nothing about the
// primary ghost changes while it is held.
let symmetry = null; // { pin:{x,y}, operation:'mirrorX'|'mirrorY'|null, settled }
// An axis a pair was actually placed about is an axis of the drawing, so it
// outlives the Alt press and is resumed by the next one. Dropping the ghost
// forgets it. Without this, stepping off Ctrl for one transform -- the only
// way to reach the vertical mirror while Alt is the hold key -- would lose
// the axis the structure is being built about.
let symmetryMemory = null; // { pin, operation } while the same ghost is armed
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
let layoutPreviewRects = [];
// The guides the last canvas paint drew, so the status line can name in words
// what the dimension lines measure. Set by renderCanvas, read by renderStatus.
let activePlacementGuides = [];
// How far the mirrored pair the last paint dimensioned stands from its axis,
// in grid cells. Set by renderCanvas beside the guides, read by renderStatus.
let activeSymmetryCells = null;
let cursor = { x: 0, y: 0 };
let cursorInCanvas = false;
// Off by default: the placement guides now say where an object lines up, and
// a full-window crosshair on top of them is more ink than help. `C` brings it
// back for anyone who reads position off the rulers.
let crosshairVisible = false;
// Spacing and alignment guides. On by default; `G` and #btn-guides turn them
// off for a drawing being laid out by hand, without touching the symmetry
// axis, which is armed deliberately rather than offered.
let guidesVisible = true;
let visual = null; // visual mode: anchor grid point {x,y} the selection box starts from
let insertQuery = ''; // insert-mode fuzzy-search string
let wire = null; // { source: {refdes, term} | null, points: [{x,y}] } — a wire being drawn in segments
let wirePreview = null;
let terminalSnap = false; // Alt-held wiring cursor: snap to the nearest terminal
let altHeld = false;
let directWire = null; // protected direct wire: { source:{refdes,term}, points:[] }
let counts = 0;
let pendingKey = null; // { key, at } for dd chord
let showGrid = true; // '#' toggles the placement grid
let history = []; // undo stack (JSON blobs)
let future = []; // redo stack
let zoom = 0.7; // px per world unit (a 40-unit cell renders as 28px)
let view = { x: -640, y: -480, w: 1280, h: 960 }; // fixed world window (infinite canvas)
let currentCircuitName = '';
// Documents are files. A new, never-saved document has no path; saving it
// by name puts it in the workspace folder.
let currentDocumentPath = null;
let currentDocumentDir = null;
let workspaceState = null; // { workspace, documents, recent } from the server
let lastSavedSnapshot = '';
let draftReady = false;
let draftRestored = false;
let deleteInFlight = false;
const DRAFT_KEY = 'mosfeteer:draft';
let restoredDraftPath = null;
let remoteConflictLogged = false;
let lastSeenRevision = null;
let lastCircuitTag = null;
let syncInFlight = null;
let syncGeneration = 0;
// An explicitly created/dropped unsaved document is a user-owned editing
// session. Do not let the server's CLI active-document mirror replace it;
// resume active syncing once it is saved or another document is opened.
let activeSyncSuspended = false;
let saveInFlight = false;
let draftTimer = null;
let renderFrame = null;
let panelStateKey = '';
let modelRevision = 0;
// Drag previews run against a disposable document clone. Keeping the
// committed instance here means a cancelled/no-op gesture never persists a
// half-edited model or pollutes undo history.
let previewTransaction = null; // { baseCircuit, startSnapshot }
let previewRevision = 0;
let sortedCompsCache = null;
let visibleNetsCache = null;
let labelCache = null;
let wireHitIndex = null;
let wireHitIndexRevision = -1;
let committedCanvasKey = '';
let canvasSvgEl = null;
let overlayEl = null;
let labelMetricsRenderPending = false;
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
    label: directWire.routeMode === 'diagonal' ? 'DIAGONAL WIRE' : 'FIXED WIRE',
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
  if (labelMode === 'equation') return { key: 'equation', canvasClass: 'mode-annotation', toolbar: 'annotation', label: 'EQUATION' };
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
  if (cls === 'error' || cls === 'status') announce(text);
}

function announce(text) {
  if (!accessibilityAnnouncementEl) return;
  accessibilityAnnouncementEl.textContent = '';
  requestAnimationFrame(() => { accessibilityAnnouncementEl.textContent = text; });
}

function logCommand(line) {
  logLine(`> ${line}`, 'cmd');
}

// ----- history --------------------------------------------------------

function markModelChanged(wires = true) {
  if (previewTransaction) {
    previewRevision += 1;
    circuit.invalidateRoutingCache();
    if (wires) wiresDirty = true;
    return;
  }
  modelRevision += 1;
  circuit.invalidateRoutingCache();
  if (wires) wiresDirty = true;
  persistDraft();
}

function commit(fn) {
  recordHistoryEntry(snapshot(), true, 'defer');
  fn();
  markModelChanged();
}

function snapshot() {
  return JSON.stringify(circuit.toJSON());
}

function beginPreviewTransaction(startSnapshot = snapshot()) {
  if (previewTransaction) return false;
  previewTransaction = {
    baseCircuit: circuit,
    startSnapshot,
  };
  circuit = loadDocument(JSON.parse(startSnapshot));
  previewRevision += 1;
  circuit.invalidateRoutingCache();
  return true;
}

function commitPreviewTransaction() {
  if (!previewTransaction) return false;
  previewTransaction = null;
  modelRevision += 1;
  previewRevision += 1;
  circuit.invalidateRoutingCache();
  wiresDirty = true;
  persistDraft();
  return true;
}

function cancelPreviewTransaction() {
  if (!previewTransaction) return false;
  const tx = previewTransaction;
  circuit = tx.baseCircuit;
  // Preview diagnostics are computed against the clone. Recompute them for
  // the restored document even when the committed document was previously
  // clean, otherwise a cancelled drag could leave stale overlap warnings.
  wiresDirty = true;
  previewTransaction = null;
  previewRevision += 1;
  return true;
}

const HISTORY_LIMIT = 200;

function rememberHistory(state, trim = true) {
  history.push(state);
  if (trim && history.length > HISTORY_LIMIT) history.shift();
}

/**
 * Record an undoable edit. `feedback` says when the committed result can be
 * compared with `startSnapshot`: 'now' for callers that record after mutating,
 * 'defer' for callers that record before the mutation or gesture finishes, and
 * 'none' for direct-manipulation wire drags, which get no flash.
 */
function recordHistoryEntry(startSnapshot, trim = true, feedback = 'now') {
  if (!startSnapshot) return;
  rememberHistory(startSnapshot, trim);
  future.length = 0;
  queueCommitFeedback(startSnapshot, feedback);
}

// ----- commit feedback ----------------------------------------------------
// A brief green "landed" flash over whatever an undoable edit added or
// changed (see commit-feedback.js). It lives in its own SVG layer so overlay
// redraws do not restart it; a canvas rebuild remounts it mid-animation.

const COMMIT_FEEDBACK_MS = 650;
let pendingFeedbackSnapshot = null;
let commitFeedbackBursts = [];
let commitFeedbackSeq = 0;

function queueCommitFeedback(startSnapshot, when) {
  if (when === 'none') {
    // Wire drags already show the wire under the pointer the whole time; a
    // flash on drop only flickers.
    pendingFeedbackSnapshot = null;
    return;
  }
  const base = pendingFeedbackSnapshot || startSnapshot;
  if (when === 'defer') {
    pendingFeedbackSnapshot = base;
    return;
  }
  pendingFeedbackSnapshot = null;
  playCommitFeedback(base);
}

function flushPendingCommitFeedback() {
  if (!pendingFeedbackSnapshot || drag || previewTransaction) return;
  const base = pendingFeedbackSnapshot;
  pendingFeedbackSnapshot = null;
  playCommitFeedback(base);
}

function playCommitFeedback(beforeSnapshot) {
  let diff;
  try {
    diff = commitFeedbackDiff(Circuit.fromJSON(JSON.parse(beforeSnapshot)), circuit);
  } catch {
    return; // feedback is decoration; never let it break a commit
  }
  if (isEmptyFeedback(diff)) return;
  if (window.__commitFeedbackLog) window.__commitFeedbackLog.push(Object.fromEntries(Object.entries(diff).map(([key, list]) => [key, list.length])));
  const burst = { id: ++commitFeedbackSeq, ...commitFeedbackSvg(diff), start: performance.now() };
  commitFeedbackBursts.push(burst);
  setTimeout(() => {
    commitFeedbackBursts = commitFeedbackBursts.filter((b) => b !== burst);
    for (const el of canvasSvgEl?.querySelectorAll(`[data-burst="${burst.id}"]`) || []) el.remove();
  }, COMMIT_FEEDBACK_MS);
  mountCommitFeedback(true);
}

function mountCommitFeedback(force = false) {
  if (!canvasSvgEl) return;
  let layer = canvasSvgEl.querySelector(':scope > .commit-feedback');
  const underlay = canvasSvgEl.querySelector(':scope > .editor-underlay');
  if (layer && !force) {
    // Keep it above the overlay, but never move it needlessly: re-inserting a
    // node restarts its CSS animations, which flickered on every pointer move.
    if (canvasSvgEl.lastElementChild !== layer) canvasSvgEl.appendChild(layer);
    return;
  }
  if (!commitFeedbackBursts.length) {
    layer?.remove();
    underlay?.replaceChildren();
    return;
  }
  if (!layer) {
    layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    layer.setAttribute('class', 'commit-feedback');
    layer.setAttribute('aria-hidden', 'true');
  }
  // Negative delays resume each burst where it was if the canvas was rebuilt.
  const now = performance.now();
  const groups = (part) => commitFeedbackBursts
    .map((b) => `<g data-burst="${b.id}" style="--landing-elapsed:${-Math.round(now - b.start)}ms">${b[part]}</g>`)
    .join('');
  layer.innerHTML = groups('over');
  if (underlay) underlay.innerHTML = groups('under');
  if (canvasSvgEl.lastElementChild !== layer) canvasSvgEl.appendChild(layer);
}

function persistDraft() {
  if (!draftReady || draftTimer || previewTransaction) return;
  draftTimer = setTimeout(flushDraft, 150);
}
function flushDraft() {
  if (draftTimer) { clearTimeout(draftTimer); draftTimer = null; }
  if (!draftReady) return;
  try {
    // A tab can close during a pointer gesture. Persist only the committed
    // document, never the disposable preview clone.
    const committed = previewTransaction?.baseCircuit || circuit;
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      name: currentCircuitName,
      path: currentDocumentPath,
      dir: currentDocumentDir,
      pendingName: circuitNameEl.value,
      state: committed.toJSON(),
      savedSnapshot: lastSavedSnapshot,
      view: { x: view.x, y: view.y, w: view.w, h: view.h },
    }));
  } catch (err) { logLine(`Could not preserve local draft: ${err.message}`, 'error'); }
}
function scheduleInteractionRender() {
  wirePreview = wire ? draftWirePreview(wire) : null;
  if (renderFrame !== null) return;
  renderFrame = requestAnimationFrame(() => { renderFrame = null; render(); });
}
function restoreDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (!draft || !draft.state) {
      lastSavedSnapshot = snapshot();
      return;
    }
    applyJson(JSON.stringify(draft.state));
    draftRestored = true;
    currentCircuitName = draft.name || '';
    currentDocumentPath = typeof draft.path === 'string' && draft.path ? draft.path : null;
    currentDocumentDir = typeof draft.dir === 'string' && draft.dir ? draft.dir : null;
    circuitNameEl.value = typeof draft.pendingName === 'string' ? draft.pendingName : currentCircuitName;
    const savedView = draft.view;
    if (savedView && [savedView.x, savedView.y, savedView.w, savedView.h].every(Number.isFinite) && savedView.w > 0 && savedView.h > 0) {
      view = { x: savedView.x, y: savedView.y, w: savedView.w, h: savedView.h };
    }
    lastSavedSnapshot = draft.savedSnapshot || snapshot();
    restoredDraftPath = currentDocumentPath;
    activeSyncSuspended = !currentDocumentPath;
  } catch (err) {
    logLine(`Could not restore local draft: ${err.message}`, 'error');
    lastSavedSnapshot = snapshot();
  }
}

function displayPath(path) {
  const home = workspaceState?.home;
  return home && path && (path === home || path.startsWith(home + (workspaceState.sep || '/')))
    ? `~${path.slice(home.length)}`
    : path || '';
}

function documentNameForPath(path) {
  const known = [...(workspaceState?.documents || []), ...(workspaceState?.recent || [])].find((document) => document.path === path);
  if (known) return known.name;
  return String(path).split(/[\\/]/).pop().replace(/\.schematic\.json$/i, '').replace(/\.json$/i, '');
}

const PICKER_OPEN_FILE = '__open-file__';
const PICKER_WORKSPACE = '__workspace__';

async function refreshCircuitList() {
  try {
    workspaceState = await persistence.workspace();
  } catch (err) {
    logLine(`Could not list documents: ${err.message}`, 'error');
    return;
  }
  const { documents = [], recent = [] } = workspaceState;
  const label = (document) => document.name;
  const known = new Set([...documents, ...recent].map((document) => document.path));
  const recentEntries = currentDocumentPath && !known.has(currentDocumentPath)
    ? [{ name: currentCircuitName || documentNameForPath(currentDocumentPath), path: currentDocumentPath, kind: 'circuit' }, ...recent]
    : recent;
  const groups = [
    [persistence.browserOnly ? 'Documents available in this browser' : `Workspace · ${displayPath(workspaceState.workspace)}`, documents],
    ['Recent elsewhere', recentEntries],
  ];
  const signature = JSON.stringify([groups.map(([name, items]) => [name, items.map((item) => [label(item), item.path])])]);
  if (circuitSelectEl.dataset.signature !== signature) {
    const children = [new Option(documents.length || recentEntries.length ? 'Open document…' : 'No documents yet', '')];
    for (const [name, items] of groups) {
      if (!items.length) continue;
      const group = document.createElement('optgroup');
      group.label = name;
      for (const item of items) {
        const option = new Option(label(item), item.path);
        option.title = item.path;
        group.append(option);
      }
      children.push(group);
    }
    const actions = document.createElement('optgroup');
    actions.label = 'More';
    actions.append(new Option('Browse for a file… (Ctrl/Cmd+O)', PICKER_OPEN_FILE));
    if (!persistence.browserOnly) actions.append(new Option('Change workspace folder…', PICKER_WORKSPACE));
    children.push(actions);
    circuitSelectEl.replaceChildren(...children);
    circuitSelectEl.dataset.signature = signature;
  }
  circuitSelectEl.value = currentDocumentPath || '';
  circuitSelectEl.title = currentDocumentPath
    ? currentDocumentPath
    : persistence.browserOnly ? 'Open a document file' : `Open a document from ${workspaceState.workspace}`;
}

async function restoreStartup() {
  const listPromise = refreshCircuitList();
  const params = new URLSearchParams(window.location.search);
  const openPath = params.get('open');
  if (openPath) window.history.replaceState(null, '', window.location.pathname);
  await listPromise;
  if (openPath && openPath !== currentDocumentPath) requestCircuitLoad(openPath);
}

async function saveCircuit({ saveAs = false } = {}) {
  let name = circuitNameEl.value.trim();
  let target;
  if (saveAs) {
    let choice;
    try {
      choice = await showFileDialog(persistence, {
        mode: 'save',
        dir: currentDocumentDir || workspaceState?.workspace || '',
        name: validDocumentName(name) || currentCircuitName || '',
      });
    } catch (err) {
      logLine(`Could not choose a save file: ${err.message}`, 'error');
      return;
    }
    if (!choice) return;
    ({ name } = choice);
    target = choice;
  } else if (currentDocumentPath && name === currentCircuitName) {
    target = { path: currentDocumentPath };
  } else {
    target = { ...(currentDocumentDir ? { dir: currentDocumentDir } : {}), name };
  }
  if (!validDocumentName(name)) {
    logLine('Enter a document name. Names cannot start with "." or contain / \\ : * ? " < > |.', 'error');
    circuitNameEl.focus();
    return;
  }
  syncGeneration += 1;
  saveInFlight += 1;
  renderSaveState();
  const previousScope = analysisFormScope();
  try {
    const state = circuit.toJSON();
    let data;
    try {
      data = await persistence.save(target, state, { overwrite: !!target.path });
    } catch (err) {
      if (err.code !== 'exists') throw err;
      const replace = await confirmChoice({
        title: 'Replace existing document?',
        message: `A document named "${name}" already exists in ${displayPath(target.dir || currentDocumentDir || workspaceState?.workspace)}. Replacing it overwrites its contents.`,
        confirmLabel: 'Replace',
        danger: true,
      });
      if (!replace) {
        logLine('Save canceled.');
        return;
      }
      data = await persistence.save(target, state, { overwrite: true });
    }
    currentCircuitName = data.name;
    currentDocumentPath = data.path;
    currentDocumentDir = data.dir;
    activeSyncSuspended = false;
    migrateAnalysisFormStorage(previousScope, analysisFormScope());
    circuitNameEl.value = data.name;
    lastSeenRevision = data.revision || null;
    lastCircuitTag = data.etag || null;
    lastSavedSnapshot = snapshot();
    persistDraft();
    await refreshCircuitList();
    logLine(`Saved ${displayPath(data.path)}.`);
  } catch (err) {
    logLine(`Could not save document: ${err.message}`, 'error');
  } finally {
    saveInFlight -= 1;
    syncGeneration += 1;
    renderSaveState();
  }
}

function copySelectionSource() {
  const wireKeys = new Set(selectedWires);
  if (selectedWire) wireKeys.add(`${selectedWire.netId}:${selectedWire.branch}:${selectedWire.segment}`);
  return {
    refs: multi, labels: selectedLabels(), netIds: selectedNets, wireKeys,
  };
}

let clipboardNotice = '';
let clipboardNoticeTimer = null;
let imageCopyInFlight = false;
const EXPORT_PNG_SCALE = 3;

function reportImageCopy(text, error = false) {
  clipboardNotice = text;
  clearTimeout(clipboardNoticeTimer);
  logLine(text, error ? 'error' : 'status');
  renderStatus();
  clipboardNoticeTimer = setTimeout(() => { clipboardNotice = ''; renderStatus(); }, 8000);
}

async function copyAsImage() {
  if (imageCopyInFlight) return;
  imageCopyInFlight = true;
  try {
    // Capture the selected model synchronously; ClipboardItem's promised
    // payloads let the write start within this same user gesture.
    const svg = selectionDrawing(circuit, copySelectionSource());
    const write = writeDrawingToClipboard(svg);
    reportImageCopy('Copying image…');
    await write;
    reportImageCopy('Copied image — paste into another app.');
  } catch (err) {
    reportImageCopy(`Could not copy image: ${err.message}`, true);
  } finally {
    imageCopyInFlight = false;
  }
}

async function runExport({ dir, name, formats, grid = false, dark = false }) {
  const supportedFormats = persistence.supportedExportFormats || new Set(formats);
  const unsupported = formats.filter((format) => !supportedFormats.has(format));
  if (unsupported.length) {
    logLine(`Could not export: ${unsupported.join(', ')} export is unavailable in this mode.`, 'error');
    return;
  }
  try {
    logLine(`Exporting ${formats.map((format) => `${name}.${format}`).join(', ')}…`);
    // Reserve a native PNG save target while the submit event still carries
    // user activation. Rasterization below is asynchronous and may otherwise
    // make a later download click get blocked by the browser.
    const prepared = persistence.prepareExport
      ? await persistence.prepareExport({ name, formats })
      : null;
    // A MathML label can acquire its final browser-sized box after the last
    // canvas paint. Sync it before taking bounds for the exported viewBox.
    for (let attempt = 0; attempt < 3 && syncRenderedLabelMetrics(); attempt += 1) {
      committedCanvasKey = '';
      render();
    }
    const renderedSvg = renderDocument(circuit, {
      ...DRAWING_EXPORT_OPTIONS,
      grid,
    });
    const svg = await withEmbeddedMathFont(dark ? applyExportDarkTheme(renderedSvg) : renderedSvg);
    const request = { dir, name, formats, svg };
    if (formats.includes('png') || formats.includes('pdf')) request.png = await svgToPngDataUrl(svg, EXPORT_PNG_SCALE);
    let result;
    try {
      result = await persistence.exportFiles(request, { prepared });
    } catch (err) {
      if (err.code !== 'exists') throw err;
      const files = (err.existing || []).map((path) => path.split(/[\\/]/).pop());
      const replace = await confirmChoice({
        title: files.length === 1 ? 'Replace existing file?' : 'Replace existing files?',
        message: `${files.join(', ')} already ${files.length === 1 ? 'exists' : 'exist'} in ${displayPath(dir)}. Replacing overwrites ${files.length === 1 ? 'it' : 'them'}.`,
        confirmLabel: 'Replace',
        danger: true,
      });
      if (!replace) {
        logLine('Export canceled.');
        return;
      }
      result = await persistence.exportFiles({ ...request, overwrite: true }, { prepared });
    }
    logLine(`Exported ${result.paths.map((path) => path.split(/[\\/]/).pop()).join(', ')} to ${displayPath(result.dir)}.`);
    for (const note of result.notes || []) logLine(note);
  } catch (err) {
    logLine(`Could not export: ${err.message}`, 'error');
  }
}

const EXPORT_SETTINGS_KEY = 'mosfeteer:export';
let exportFolder = '';

function renderExportLocation() {
  const folderEl = document.getElementById('export-folder');
  if (folderEl) {
    folderEl.textContent = displayPath(exportFolder) || 'Choose a folder';
    folderEl.title = exportFolder;
  }
  const formats = [...exportForm.querySelectorAll('input[name="format"]:checked')].map((input) => `.${input.value}`);
  const extensions = document.getElementById('export-extensions');
  if (extensions) extensions.textContent = formats.join(' ');
  const submit = document.getElementById('export-submit');
  if (submit) submit.disabled = !formats.length || !exportFolder || !validDocumentName(document.getElementById('export-name')?.value);
}

/**
 * Exports default to print-ready output (light, no grid) in the OS Pictures
 * folder in Node mode, or the browser download location in browser-only mode.
 * Formats, appearance, and a folder chosen for this document are remembered.
 */
function exportCircuit() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(EXPORT_SETTINGS_KEY) || 'null'); } catch { /* storage unavailable */ }
  if (exportGridInput) exportGridInput.checked = saved?.grid === true;
  if (exportDarkInput) exportDarkInput.checked = saved?.dark === true;
  if (Array.isArray(saved?.formats)) {
    for (const input of exportForm.querySelectorAll('input[name="format"]')) {
      const supported = persistence.supportedExportFormats?.has(input.value) ?? true;
      input.checked = supported && saved.formats.includes(input.value);
    }
  }
  const documentKey = currentDocumentPath || '';
  const defaultFolder = defaultExportDirectory(workspaceState, { browserOnly: persistence.browserOnly });
  exportFolder = (saved?.folders && saved.folders[documentKey]) || defaultFolder;
  const nameInput = document.getElementById('export-name');
  if (nameInput) nameInput.value = validDocumentName(circuitNameEl.value) || currentCircuitName || 'circuit';
  renderExportLocation();
  exportDialog?.showModal();
}

async function loadCircuit(path, quiet = false, options = {}) {
  if (!path) return false;
  const { syncGeneration: expectedGeneration, ...loadOptions } = options;
  try {
    const data = await persistence.load(path, loadOptions);
    if (expectedGeneration !== undefined && (saveInFlight || expectedGeneration !== syncGeneration)) return false;
    if (data.notModified) {
      if (data.revision) lastSeenRevision = data.revision;
      if (data.etag) lastCircuitTag = data.etag;
      return true;
    }
    // A document owns its undo history. Navigation must not make Undo
    // restore a different document kind.
    history = [];
    future = [];
    applyJson(JSON.stringify(data.state));
    clearLatestAnalysisResult();
    setSelection([]);
    cursor = { x: 0, y: 0 };
    currentCircuitName = data.name;
    currentDocumentPath = data.path;
    currentDocumentDir = data.dir;
    activeSyncSuspended = false;
    remoteConflictLogged = false;
    circuitNameEl.value = data.name;
    lastSavedSnapshot = snapshot();
    lastSeenRevision = data.revision || null;
    lastCircuitTag = data.etag || null;
    fitView();
    renderSaveState();
    void refreshCircuitList();
    logLine(`Opened ${displayPath(data.path)}.`);
    return true;
  } catch (err) {
    // A transient load failure (active circuit whose file does not exist yet)
    // is retried by syncActiveCircuit on the next poll — log only the first.
    if (!quiet) logLine(`Could not open document: ${err.message}`, 'error');
    return false;
  }
}

/** Open document contents that have no file path (a dropped file). Saving puts it in the workspace. */
function openUnsavedDocument(state, name) {
  history = [];
  future = [];
  applyJson(JSON.stringify(state));
  clearLatestAnalysisResult();
  setSelection([]);
  cursor = { x: 0, y: 0 };
  currentCircuitName = '';
  currentDocumentPath = null;
  currentDocumentDir = null;
  activeSyncSuspended = true;
  remoteConflictLogged = false;
  lastSeenActive = null;
  lastSeenRevision = null;
  lastCircuitTag = null;
  circuitNameEl.value = validDocumentName(name) || '';
  circuitSelectEl.value = '';
  lastSavedSnapshot = snapshot();
  fitView();
  renderSaveState();
  persistDraft();
  logLine(`Imported "${name}". Save (Ctrl/Cmd+S) to keep it in your workspace, or Save as to choose a folder.`);
}

function hasUnsavedChanges() {
  return snapshot() !== lastSavedSnapshot ||
    (!currentDocumentPath && !!validDocumentName(circuitNameEl.value));
}

let pendingDocumentAction = null;

/** Run an action that replaces the open document, asking first when that would discard unsaved changes. */
function requestDocumentAction(description, run) {
  if (!hasUnsavedChanges()) {
    run();
    return;
  }
  pendingDocumentAction = run;
  if (switchDialogMessage) {
    switchDialogMessage.textContent = `${description} will discard the unsaved changes in "${currentCircuitName || circuitNameEl.value.trim() || 'this design'}".`;
  }
  circuitSelectEl.value = currentDocumentPath || '';
  switchDialog?.showModal();
}

function requestCircuitLoad(path) {
  if (!path) return;
  requestDocumentAction(`Opening "${documentNameForPath(path)}"`, () => loadCircuit(path, false, { open: true }));
}

async function openDocumentDialog() {
  try {
    const choice = await showFileDialog(persistence, { mode: 'open', dir: currentDocumentDir || workspaceState?.workspace || '' });
    if (choice) requestCircuitLoad(choice.path);
  } catch (err) {
    logLine(`Could not choose an open file: ${err.message}`, 'error');
  }
}

async function chooseWorkspaceFolder() {
  if (persistence.browserOnly) {
    logLine('Browser-only mode uses the browser download location instead of a workspace folder.');
    return;
  }
  const choice = await showFileDialog(persistence, { mode: 'folder', dir: workspaceState?.workspace || '' });
  if (!choice) return;
  try {
    workspaceState = await persistence.setWorkspace(choice.path);
    circuitSelectEl.dataset.signature = '';
    await refreshCircuitList();
    logLine(`Workspace folder is now ${displayPath(workspaceState.workspace)}. New documents are saved there.`);
  } catch (err) {
    logLine(`Could not change the workspace folder: ${err.message}`, 'error');
  }
}

async function revealCurrentDocument() {
  if (!currentDocumentPath) return;
  if (persistence.browserOnly) {
    logLine('Browser-only mode cannot reveal files in the operating-system file manager.');
    return;
  }
  try {
    await persistence.reveal(currentDocumentPath);
  } catch (err) {
    logLine(`Could not show the document folder: ${err.message}`, 'error');
  }
}

function renderSaveState() {
  const dirty = hasUnsavedChanges();
  if (deleteCircuitBtn) deleteCircuitBtn.disabled = !currentDocumentPath || deleteInFlight;
  if (revealDocumentBtn) revealDocumentBtn.disabled = persistence.browserOnly || !currentDocumentPath;
  circuitNameEl.title = currentDocumentPath
    ? `${currentDocumentPath}\nRename and save to create a copy next to it.`
    : persistence.browserOnly ? 'Name used when saving this document as a browser download' : 'Name used when saving this document to the workspace folder';
  const saveButton = document.getElementById('btn-save');
  if (saveButton) {
    saveButton.disabled = !dirty || saveInFlight > 0;
    saveButton.title = dirty
      ? 'Save unsaved changes, including designs with issues (Ctrl/Cmd+S or Shift+x)'
      : currentDocumentPath ? `All changes saved to ${currentDocumentPath}` : 'Nothing to save yet';
  }
}

async function deleteSavedCircuit() {
  const path = currentDocumentPath;
  if (!path || deleteInFlight) return;
  deleteInFlight = true;
  renderSaveState();
  try {
    await persistence.delete(path);
    const name = currentCircuitName;

    history = [];
    future = [];
    cancelPreviewTransaction();
    circuit = new Circuit();
    clearLatestAnalysisResult();
    markModelChanged(false);
    resetCheckState();
    directWire = null;
    wire = null;
    terminalSnap = false;
    clearSymmetry();
    drag = null;
    moveMode = null;
    copyMode = false;
    deleteMode = false;
    movePending = false;
    copyPending = false;
    visual = null;
    pendingPlace = null;
    clearSymmetry();
    labelMode = null;
    annotationPoints = [];
    setSelection([]);
    selectedNets.clear();
    cursor = { x: 0, y: 0 };
    view = viewFromCenter(0, 0);
    currentCircuitName = '';
    currentDocumentPath = null;
    currentDocumentDir = null;
    activeSyncSuspended = true;
    circuitNameEl.value = '';
    circuitSelectEl.value = '';
    lastSavedSnapshot = snapshot();
    lastSeenActive = null;
    lastFailedActive = null;
    lastSeenRevision = null;
    lastCircuitTag = null;
    restoredDraftPath = null;
    remoteConflictLogged = false;
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* storage unavailable */ }
    render();
    await refreshCircuitList();
    logLine(`${persistence.browserOnly ? 'Forgot' : 'Deleted'} "${name}" (${displayPath(path)}).`);
  } catch (err) {
    logLine(`Could not delete document: ${err.message}`, 'error');
  } finally {
    deleteInFlight = false;
    renderSaveState();
  }
}

function askDeleteCircuit() {
  const path = currentDocumentPath;
  if (!path || !deleteDialog) return;
  if (persistence.browserOnly) {
    deleteDialogMessage.textContent = hasUnsavedChanges()
      ? `This removes ${displayPath(path)} from this browser's cached document list and discards its unsaved editor changes. It does not delete a file already downloaded to disk.`
      : `This removes ${displayPath(path)} from this browser's cached document list. It does not delete a file already downloaded to disk.`;
  } else {
    deleteDialogMessage.textContent = hasUnsavedChanges()
      ? `This permanently deletes ${displayPath(path)} and discards its unsaved editor changes. This cannot be undone.`
      : `This permanently deletes ${displayPath(path)}. This cannot be undone.`;
  }
  deleteDialog.showModal();
}

let lastSeenActive = null;
let lastFailedActive = null; // active circuit path whose load failed (retry silently)
async function syncActiveCircuitOnce() {
  if (!persistence.liveSync) return;
  const generation = syncGeneration;
  // First, follow the server's "active circuit" — the CLI drives it, the
  // browser mirrors it. Only auto-load on a CHANGE of the server's active
  // circuit (lastSeenActive), not on every poll where it merely differs from
  // the open document — otherwise a manual open gets clobbered by the next tick.
  let active = null;
  let activeRevision = null;
  let activeResponseSucceeded = false;
  try {
    const data = await persistence.active();
    if (typeof data.active === 'string') {
      active = data.active ? data.path : '';
      activeRevision = data.revision || null;
      activeResponseSucceeded = true;
    }
  } catch {
    // server restart — keep going with the content sync below
  }

  if (saveInFlight || generation !== syncGeneration) return;

  if (activeSyncSuspended) {
    // Consume the current active identity while the explicit blank/dropped
    // document owns the editor. This prevents the next poll from treating an
    // already-active file as a change and replacing the unsaved document.
    if (activeResponseSucceeded) {
      lastSeenActive = active;
      lastSeenRevision = activeRevision;
      lastFailedActive = null;
    }
    return;
  }

  // Seed the active revision without replacing the restored local draft.
  if (activeResponseSucceeded && restoredDraftPath && currentDocumentPath === restoredDraftPath) {
    lastSeenActive = active;
    lastSeenRevision = activeRevision;
    restoredDraftPath = null;
    return;
  }
  if (activeResponseSucceeded && restoredDraftPath && currentDocumentPath !== restoredDraftPath) {
    restoredDraftPath = null;
  }

  if (active !== lastSeenActive) {
    // The server only sends a revision for an active circuit whose file exists.
    // Wait silently for a missing one (not yet written, or deleted) instead of
    // requesting it and reporting a load error on every poll.
    if (active && active !== currentDocumentPath && activeResponseSucceeded && !activeRevision) return;
    if (active && active !== currentDocumentPath) {
      // A failed load must NOT advance lastSeenActive — otherwise the poll
      // would never retry once the file appears.
      const quietRetry = active === lastFailedActive;
      await loadCircuit(active, quietRetry, { syncGeneration: generation });
      if (currentDocumentPath === active) {
        lastSeenActive = active;
        lastFailedActive = null;
      } else {
        lastFailedActive = active;
      }
      return; // loadCircuit already re-rendered + fit (or logged the failure)
    }
    lastSeenActive = active;
  }
  if (!currentDocumentPath) return;
  // Avoid a document GET and model parse when the active revision is unchanged.
  if (active === currentDocumentPath && activeRevision && activeRevision === lastSeenRevision) return;
  try {
    const data = await persistence.load(currentDocumentPath, { ifNoneMatch: lastCircuitTag });
    if (saveInFlight || generation !== syncGeneration) return;
    if (data.notModified) {
      if (data.revision) lastSeenRevision = data.revision;
      if (data.etag) lastCircuitTag = data.etag;
      return;
    }
    // The model normalizes loaded state (notably reducible net geometry), so
    // compare and record the canonical representation rather than the raw
    // JSON on disk. Otherwise a clean design can become permanently dirty
    // after the first poll of a normalized save.
    const remoteSnapshot = JSON.stringify(loadDocument(data.state).toJSON());
    const remoteRevision = data.revision || activeRevision;
    const remoteTag = data.etag || lastCircuitTag;
    const currentSnapshot = snapshot();
    lastSeenRevision = remoteRevision || null;
    lastCircuitTag = remoteTag || null;
    if (remoteSnapshot === currentSnapshot) return;
    if (currentSnapshot !== lastSavedSnapshot) {
      if (!remoteConflictLogged) {
        logLine(`${currentCircuitName} changed on disk, but this window has unsaved changes. Saving will overwrite the other version.`, 'error');
        remoteConflictLogged = true;
      }
      return;
    }
    applyJson(remoteSnapshot);
    lastSavedSnapshot = snapshot();
    remoteConflictLogged = false;
    fitView();
    logLine(`Reloaded ${currentCircuitName}: the file changed on disk.`);
  } catch {
    // A missing file or a server restart should not interrupt editing.
  }
}

async function syncActiveCircuit() {
  if (!persistence.liveSync || document.hidden) return;
  if (syncInFlight) return syncInFlight;
  syncInFlight = syncActiveCircuitOnce().finally(() => { syncInFlight = null; });
  return syncInFlight;
}

function applyJson(blob) {
  if (previewTransaction) cancelPreviewTransaction();
  // Loads, undo, and redo replace the document; they are not new commits.
  pendingFeedbackSnapshot = null;
  // A draft endpoint belongs to the currently visible circuit. Never carry it
  // across loads, undo/redo, or remote replacement.
  directWire = null;
  wire = null;
  terminalSnap = false;
  clearSymmetry();
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
  circuit = loadDocument(JSON.parse(blob));
  markModelChanged(); // wire geometry may have changed under any wholesale load
  // A wholesale replacement has no compatible editor selection.
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
  rememberHistory(snapshot(), false);
  applyJson(future.pop());
  restoreToolState(toolState);
  render();
}

// ----- helpers ---------------------------------------------------------

const clonePoint = (p) => ({ ...p });
/** Copy a point list, optionally through a translation. */
function clonePoints(points, move = clonePoint) {
  return (points || []).map(move);
}
/** Copy fixed-path entries so a drag snapshot shares nothing with the live net. */
function cloneFixedPaths(entries, move = clonePoint) {
  return (entries || []).map((entry) => ({
    points: clonePoints(entry.points, move),
    start: entry.start ? { ...entry.start } : null,
    end: entry.end ? { ...entry.end } : null,
  }));
}
/** Fixed geometry of one net, detached from the live model. */
function captureFixedGeometry(net) {
  return { fixedPaths: cloneFixedPaths(net.fixedPaths), junctions: clonePoints(net.junctions) };
}
/** Managed route geometry of one net, detached from the live model. */
function captureRouteGeometry(net, move = clonePoint) {
  return {
    route: net.route ? clonePoints(net.route, move) : null,
    branches: net.branches ? net.branches.map((path) => clonePoints(path, move)) : null,
    junctions: clonePoints(net.junctions, move),
  };
}

function sortedComps() {
  if (!sortedCompsCache || sortedCompsCache.revision !== modelRevision) {
    sortedCompsCache = { revision: modelRevision, value: [...circuit.components.values()].sort((a, b) => naturalCompare(a.refdes, b.refdes)) };
  }
  return sortedCompsCache.value;
}

function transientCopyGhost() {
  return drag?.mode === 'copyghost' ? drag.ghost : null;
}

function isTransientCopyGhostRef(refdes) {
  const ghost = transientCopyGhost();
  return !!ghost && (ghost.refs.includes(refdes) || ghost.mirror?.refs?.includes(refdes));
}

function transientCopyGhostNetIds() {
  const ghost = transientCopyGhost();
  return new Set([...(ghost?.netIds || []), ...(ghost?.mirror?.netIds || [])]);
}

function isTransientCopyGhostNet(id) {
  const ghost = transientCopyGhost();
  return !!ghost && (ghost.netIds.includes(id) || ghost.mirror?.netIds?.includes(id));
}

function unnamedReferenceInfoForNet(net) {
  if (!net) return null;
  for (const terminal of net.terminals || []) {
    const component = circuit.components.get(terminal.comp);
    if (!isReferenceMarker(component) || referenceMarkerIsLocal(component)) continue;
    const info = referenceMarkerInfo(component.type);
    if (info?.terminal === terminal.term && isReferenceMarkerGlobalName(info, net.name)) return info;
  }
  return null;
}

function referenceGroupNets(netOrInfo) {
  const info = netOrInfo?.globalName ? netOrInfo : unnamedReferenceInfoForNet(netOrInfo);
  if (!info) return netOrInfo?.id ? [netOrInfo] : [];
  return [...circuit.nets.values()].filter((candidate) => unnamedReferenceInfoForNet(candidate)?.globalName === info.globalName);
}

function namedNetGroupKey(net) {
  if (!net?.id) return '';
  const info = unnamedReferenceInfoForNet(net);
  return `name:${info?.globalName || net.name || net.id}`;
}

function namedGroupNets(net) {
  if (!net?.id) return referenceGroupNets(net);
  const key = namedNetGroupKey(net);
  return [...circuit.nets.values()].filter((candidate) => namedNetGroupKey(candidate) === key);
}

function visibleNets() {
  if (!visibleNetsCache || visibleNetsCache.revision !== modelRevision) {
    const grouped = new Map();
    const nets = [...circuit.nets.values()]
      .filter((net) => !isTransientCopyGhostNet(net.id))
      .filter((net) => net.terminals.length || net.paths().some((path) => path.length >= 2));
    for (const net of nets) {
      const key = namedNetGroupKey(net);
      if (!grouped.has(key)) grouped.set(key, net);
    }
    visibleNetsCache = {
      revision: modelRevision,
      value: [...grouped.values()]
        .sort((a, b) => naturalCompare(a.name || a.id, b.name || b.id) || naturalCompare(a.id, b.id)),
    };
  }
  return visibleNetsCache.value;
}

function labels() {
  if (!labelCache || labelCache.revision !== modelRevision) {
    labelCache = { revision: modelRevision, value: [...circuit.labels.values()] };
  }
  return labelCache.value;
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
function nearestTerminal(w, { anyDistance = false } = {}) {
  const p = paneSize();
  const pxPerUnit = p ? view.w / p.w : 1;
  const tol = Math.max(GRID / 2, 12 / pxPerUnit);
  const candidates = sortedComps().flatMap((c) => c.worldTerminals()
    .map((t) => ({ refdes: c.refdes, term: t.name, x: t.x, y: t.y })));
  const best = nearestPoint(w, candidates);
  return best && (anyDistance || best.distance <= tol) ? best : null;
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
  const onSegment = (a, b) => pointOnPath(point, [a, b]);
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
        if ((a.x === b.x && a.y === b.y) || !onSegment(a, b) || distanceToSegment(w, a, b) > tol) continue;
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
  const selectableIds = ids.filter((id) => circuit.labels.get(id)?.selectable !== false);
  if (!preserveMixed) {
    selected = null;
    multi.clear();
    selectedWire = null;
    selectedWires.clear();
    selectedNets.clear();
  }
  selLabels = new Set(selectableIds);
  selLabel = selectableIds.length
    ? (selectableIds.includes(primary) ? primary : selectableIds[0])
    : null;
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

/** One selection gesture for every document kind and selectable role.
 * A plain click replaces the complete mixed selection. Shift/Ctrl/Cmd toggles
 * only the clicked identity and preserves every other selected role. */
function applyEditorSelection(target, extend = false) {
  clearDiagnosticFocus();
  if (!extend) {
    selected = null; multi.clear();
    selLabel = null; selLabels.clear();
    selectedWire = null; selectedWires.clear(); selectedNets.clear();
  }
  const toggle = (set, id) => {
    if (extend && set.has(id)) { set.delete(id); return false; }
    set.add(id); return true;
  };
  if (target.kind === 'component') {
    const added = toggle(multi, target.id);
    selected = added ? target.id : (selected === target.id ? multi.values().next().value || null : selected);
  } else if (target.kind === 'label') {
    const added = toggle(selLabels, target.id);
    selLabel = added ? target.id : (selLabel === target.id ? selLabels.values().next().value || null : selLabel);
  } else if (target.kind === 'wire') {
    toggle(selectedWires, target.id);
    syncSelectedWire();
  }
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

function isDiagonalWireKey(key) {
  const w = keyToWire(key);
  const path = circuit.nets.get(w.netId)?.paths()?.[w.branch];
  const a = path?.[w.segment - 1];
  const b = path?.[w.segment];
  return !!(a && b && a.x !== b.x && a.y !== b.y);
}

/** Start a rigid drag of one diagonal segment (see Circuit#moveDiagonalSegment).
 * Returns false when the hit segment is not diagonal. */
function diagonalSegmentDragAt(hit, startWorld, startClient, ev, { modal = false, doubleWireClick = false } = {}) {
  const key = `${hit.net.id}:${hit.branch}:${hit.seg}`;
  if (!isDiagonalWireKey(key)) return false;
  const startSnapshot = snapshot();
  beginPreviewTransaction(startSnapshot);
  cursor = { x: snap(startWorld.x), y: snap(startWorld.y) };
  drag = {
    mode: 'diagonalseg', modal, key, netId: hit.net.id, branch: hit.branch, seg: hit.seg,
    startWorld, startClient, startSnapshot, shift: ev.shiftKey, moved: false, delta: { dx: 0, dy: 0 },
    tried: { dx: 0, dy: 0 }, doubleWireClick, rubber: null,
  };
  return true;
}

/** Re-apply the diagonal drag from the pre-drag document for the current delta. */
function updateDiagonalSegmentDrag(world) {
  const dx = snap(world.x) - snap(drag.startWorld.x);
  const dy = snap(world.y) - snap(drag.startWorld.y);
  if (dx === drag.tried?.dx && dy === drag.tried?.dy) return;
  drag.tried = { dx, dy };
  cursor = { x: snap(world.x), y: snap(world.y) };
  const previous = circuit;
  circuit = loadDocument(JSON.parse(drag.startSnapshot));
  if (circuit.moveDiagonalSegment(drag.netId, drag.branch, drag.seg, { dx, dy })) {
    drag.delta = { dx, dy };
  } else {
    // No safe route at this position: keep showing the last position that
    // worked, so the segment stops instead of jumping back to its origin.
    circuit = previous;
  }
  markModelChanged();
}

function finishDiagonalSegmentDrag() {
  const { key, doubleWireClick } = drag;
  if (!drag.moved || (!drag.delta.dx && !drag.delta.dy)) {
    cancelPreviewTransaction();
    drag = null;
    setSelection([]);
    if (doubleWireClick) selectedNets = new Set([keyToWire(key).netId]);
    else {
      selectedWires = new Set([key]);
      selectedWire = keyToWire(key);
    }
    render();
    return;
  }
  const collision = newCrossNetOverlap(drag.startSnapshot, new Set([drag.netId]));
  if (collision) {
    cancelPreviewTransaction();
    logLine(`wire drag cancelled: the wire would overlap net ${collision}`, 'error');
  } else if (snapshot() !== drag.startSnapshot) {
    recordHistoryEntry(drag.startSnapshot, true, 'none');
    commitPreviewTransaction();
  } else {
    cancelPreviewTransaction();
  }
  drag = null;
  render();
}

function selectedLabels() {
  return [...selLabels]
    .map((id) => circuit.labels.get(id))
    .filter((label) => label && label.selectable !== false);
}

function selectedLabel() {
  return selLabel && circuit.labels.has(selLabel) ? circuit.labels.get(selLabel) : null;
}
/** Move each recorded label from its origin, parents before children; a
 *  parent's move already carries its descendants, so skip those. */
function moveLabelTree(origins, move) {
  const pending = new Map(origins);
  while (pending.size) {
    const entry = [...pending].find(([id]) => {
      const label = circuit.labels.get(id);
      return !label?.parent || !pending.has(label.parent);
    });
    if (!entry) break;
    const [id, origin] = entry;
    const label = circuit.labels.get(id);
    if (label) {
      move(label, origin);
      for (const [childId] of pending) {
        let parent = circuit.labels.get(childId)?.parent;
        while (parent) {
          if (parent === id) { pending.delete(childId); break; }
          parent = circuit.labels.get(parent)?.parent;
        }
      }
    }
    pending.delete(id);
  }
}

function moveLabelOriginsOnce(origins, dx, dy) {
  moveLabelTree(origins, (label, origin) => moveLabelSafely(label, origin.x + dx, origin.y + dy));
}
/** Text-bearing selection: labels and annotation captions. */
function selectedTextTargets() {
  const labels = new Map();
  for (const label of selectedLabels()) {
    if (label.kind === 'label') labels.set(label.id, label);
    if (['arrow', 'box', 'line'].includes(label.kind)) {
      for (const child of circuit.labels.values()) {
        if (child.parent === label.id) labels.set(child.id, child);
      }
    }
  }
  // Keep the result shape used by the shared text-style controls.  Schematic
  // block text is no longer a separate selection role, but the panel still
  // asks for this collection while deciding whether its row is visible.
  return { labels: [...labels.values()], blocks: [] };
}

function selectedFontState(field) {
  const { labels } = selectedTextTargets();
  return labels.length > 0 && labels.every((label) => label.style?.[field] !== false);
}

function setSelectedLabelFont(field, on) {
  const { labels } = selectedTextTargets();
  if (!labels.length) return;
  commit(() => {
    for (const label of labels) label.style[field] = on;
  });
  render();
}

function toggleSelectedLabelFont(field) {
  setSelectedLabelFont(field, !selectedFontState(field));
}

function setSelectedLabelAlign(align) {
  const { labels } = selectedTextTargets();
  if (!labels.length) return;
  commit(() => labels.forEach((label) => label.setAlign(align)));
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
  return field === 'color' ? '#111' : field === 'lineStyle' ? 'solid' : field === 'arrowhead' ? 'none' : 'normal';
}

function arrowheadKind(object) {
  if (object?.kind === 'arrow' || object?.kind === 'line') return object.kind;
  if (object?.routingMode) return 'wire';
  return null;
}

function supportsArrowhead(object) {
  return !!arrowheadKind(object);
}

/** Combine the two independent start/end toggle buttons into the one shared
 * arrowhead value the model stores. */
function combineArrowheadEnds(start, end) {
  return start && end ? 'both' : start ? 'start' : end ? 'end' : 'none';
}

const LINE_STYLE_ICONS = { solid: 'line-solid', dashed: 'line-dashed', 'dash-dot': 'line-dash-dot', dotted: 'line-dotted' };

function singlePathArrowheadValue(net) {
  const path = net?.paths?.()[0];
  if (!path || path.length < 2) return defaultArrowhead('wire');
  return polylineArrowheadValue(net.wireStyles, 0, path, net.style?.arrowhead);
}

function wireStyleValue(net, key, field) {
  const wire = keyToWire(`${net?.id || ''}:${key}`);
  if (field === 'arrowhead' && net?.paths?.().length === 1 && wire.branch === 0) {
    return singlePathArrowheadValue(net);
  }
  return net?.wireStyles?.[key]?.[field] ?? net?.style?.[field] ?? styleDefaults(field);
}

function objectStyleValue(object, field) {
  if (field === 'arrowhead' && supportsArrowhead(object)) {
    if (object?.routingMode) {
      return object.paths?.().length === 1
        ? singlePathArrowheadValue(object)
        : object.style?.arrowhead || defaultArrowhead('wire');
    }
    return object.style?.arrowhead || defaultArrowhead(arrowheadKind(object));
  }
  return object?.style?.[field] || styleDefaults(field);
}

/** Put a shared arrowhead on the two endpoints of a one-path wire. */
function setSinglePathArrowhead(net, value) {
  const path = net?.paths?.()[0];
  if (!path || path.length < 2) return false;
  net.wireStyles = polylineArrowheadStyles(net.wireStyles, 0, path, value);
  // Segment styles now carry the endpoint-only placement. Leaving a net-wide
  // value here would make the renderer inherit it at every segment.
  delete net.style.arrowhead;
  return true;
}

function applyNetStyle(net, style) {
  const next = { ...style };
  if (next.arrowhead !== undefined && net.paths?.().length === 1) {
    setSinglePathArrowhead(net, next.arrowhead);
    delete next.arrowhead;
  }
  net.style = { ...(net.style || {}), ...next };
}

function applyWireTargetStyle(net, key, style) {
  const wire = keyToWire(`${net.id}:${key}`);
  const next = { ...style };
  if (next.arrowhead !== undefined && net.paths?.().length === 1 && wire.branch === 0) {
    setSinglePathArrowhead(net, next.arrowhead);
    delete next.arrowhead;
  }
  if (Object.keys(next).length) {
    net.wireStyles[key] = { ...(net.wireStyles[key] || {}), ...next };
  }
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
  if (nets.length === 1) {
    const net = nets[0];
    return {
      kind: 'object',
      style: {
        ...(net.style || {}),
        ...(net.paths?.().length === 1 ? { arrowhead: singlePathArrowheadValue(net) } : {}),
      },
    };
  }
  const wire = keyToWire(wireKeys[0]);
  const net = circuit.nets.get(wire.netId);
  if (!net) return null;
  return {
    kind: 'wire',
    style: {
      ...(net.wireStyles?.[`${wire.branch}:${wire.segment}`] || net.style || {}),
      arrowhead: wireStyleValue(net, `${wire.branch}:${wire.segment}`, 'arrowhead'),
    },
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
      for (const field of ['color', 'lineStyle', 'width', 'arrowhead']) {
        if (style[field] !== undefined && (field !== 'lineStyle' || ['arrow', 'box', 'line'].includes(obj.kind) || obj.routingMode) &&
            (field !== 'arrowhead' || supportsArrowhead(obj))) {
          next[field] = style[field];
        }
      }
      if (style.color !== undefined && typeof obj.setColor === 'function') obj.setColor(style.color);
      if (obj.routingMode) applyNetStyle(obj, next);
      else obj.style = { ...(obj.style || {}), ...next };
    }
    for (const { net, key } of wireTargets) {
      applyWireTargetStyle(net, key, style);
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
      if (field === 'arrowhead' && !supportsArrowhead(obj)) continue;
      if (field === 'color' && typeof obj.setColor === 'function') obj.setColor(next);
      else if (obj.routingMode) applyNetStyle(obj, { [field]: next });
      else obj.style = { ...(obj.style || {}), [field]: next };
    }
    for (const { net, key } of wireTargets) {
      applyWireTargetStyle(net, key, { [field]: next });
    }
  });
  render();
}
function syncTextStyleControls() {
  const row = document.getElementById('style-text-row');
  if (!row) return;
  const { labels, blocks } = selectedTextTargets();
  row.hidden = !labels.length && !blocks.length;
  if (row.hidden) return;
  const align = labels.length && labels.every((label) => label.align === labels[0].align) ? labels[0].align : null;
  for (const button of row.querySelectorAll('[data-style-align]')) {
    button.hidden = !labels.length;
    button.setAttribute('aria-pressed', String(button.dataset.styleAlign === align));
  }
  for (const button of row.querySelectorAll('[data-style-font]')) {
    button.setAttribute('aria-pressed', String(selectedFontState(button.dataset.styleFont)));
  }
}

/** Reflect a (possibly mixed) selection style; the panel only exists while something is styleable. */
function updateStyleControls() {
  const panel = document.getElementById('style-panel');
  const lineRow = document.getElementById('style-line-row');
  const linePattern = document.getElementById('style-line-pattern');
  const lineMenuButtons = [...document.querySelectorAll('#style-line-menu [data-line-style]')];
  const arrowStart = document.getElementById('style-arrow-start');
  const arrowEnd = document.getElementById('style-arrow-end');
  const widthButtons = [...document.querySelectorAll('#style-width-row [data-width]')];
  const swatches = [...document.querySelectorAll('#style-color .swatch')];
  if (!panel || !lineRow || !linePattern || !arrowStart || !arrowEnd) return;
  const show = (colorValue, lineValue, arrowheadValue, widthValue, supportsLine, supportsArrowhead) => {
    panel.hidden = false;
    syncTextStyleControls();
    lineRow.hidden = !supportsLine;
    linePattern.disabled = !supportsLine;
    arrowStart.hidden = arrowEnd.hidden = !supportsArrowhead;
    arrowStart.disabled = arrowEnd.disabled = !supportsArrowhead;
    const ends = arrowheadEnds(arrowheadValue);
    arrowStart.setAttribute('aria-pressed', String(ends.start));
    arrowEnd.setAttribute('aria-pressed', String(ends.end));
    const icon = linePattern.querySelector('.button-icon');
    if (icon) icon.innerHTML = ICON_PATHS[LINE_STYLE_ICONS[lineValue] || 'line-solid'];
    for (const button of lineMenuButtons) button.setAttribute('aria-pressed', String(button.dataset.lineStyle === lineValue));
    for (const button of widthButtons) button.setAttribute('aria-pressed', String(button.dataset.width === widthValue));
    for (const swatch of swatches) swatch.setAttribute('aria-checked', String(swatch.dataset.value === colorValue));
  };
  const common = (values) => (values.length && values.every((v) => v === values[0]) ? values[0] : '');
  const wireTargets = selectedWireTargets();
  if (selectedWire) {
    const net = circuit.nets.get(selectedWire.netId);
    if (net) wireTargets.push({ net, key: `${selectedWire.branch}:${selectedWire.segment}` });
  }
  const objects = [...selectedComps(), ...selectedLabels(), ...[...selectedNets].map((id) => circuit.nets.get(id)).filter(Boolean)];
  if (!objects.length && !wireTargets.length) { panel.hidden = true; return; }
  const hasWireSelection = wireTargets.length > 0 || selectedWire || selectedWires.size > 0 || selectedNets.size > 0;
  const supportsLine = hasWireSelection || objects.some((o) => ['arrow', 'box', 'line'].includes(o.kind));
  const hasArrowheadSelection = hasWireSelection || objects.some(supportsArrowhead);
  const pick = (field) => common([
    ...objects.map((o) => objectStyleValue(o, field)),
    ...wireTargets.map(({ net, key }) => wireStyleValue(net, key, field)),
  ]);
  show(pick('color'), pick('lineStyle'), pick('arrowhead'), pick('width'), supportsLine, hasArrowheadSelection);
}

/** Match a world point against label bboxes (labels draw on top of everything). */
function pickLabel(w) {
  const x = snap(w.x);
  const y = snap(w.y);
  for (const label of labels()) {
    if (label.selectable === false) continue;
    if (['arrow', 'box', 'line'].includes(label.kind)) continue;
    const r = label.bbox();
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return label;
  }
  return null;
}

function annotationTextAt(world) {
  const p = { x: snap(world.x), y: snap(world.y) };
  for (const label of labels()) {
    if (!['arrow', 'box'].includes(label.kind)) continue;
    const w = Math.max(GRID, label.colWidth() * GRID) / 2;
    const h = Math.max(GRID, label.rowHeight() * GRID) / 2;
    if (Math.abs(p.x - label.textAnchor.x) <= w && Math.abs(p.y - label.textAnchor.y) <= h) return label;
  }
  return null;
}

function annotationGeometryAt(world) {
  const p = { x: snap(world.x), y: snap(world.y) };
  const near = (a, b) => distanceToSegment(p, a, b) <= GRID / 2;
  for (const label of labels()) {
    if (label.kind === 'line' && label.points.some((point, i) => i > 0 && near(label.points[i - 1], point))) return label;
    if (label.kind === 'arrow' && label.points?.some((point, i) => i > 0 && near(label.points[i - 1], point))) return label;
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
  for (const label of labels()) {
    if (['arrow', 'line'].includes(label.kind)) {
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
  const near = (a, b) => distanceToSegment(p, a, b) <= GRID / 2;
  for (const label of labels()) {
    if (!['arrow', 'line'].includes(label.kind)) continue;
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

/** The Align panel never silently drops a selected electrical object. Owned
 * labels ride their component; net labels and wires need different movement
 * semantics and therefore make the whole layout action unavailable. */
function layoutSelection() {
  const components = selectedComps();
  const labels = selectedLabels().filter((label) => !label.owner || !multi.has(label.owner));
  const eligibleLabels = labels.filter((label) => !label.owner && !label.netId && !label.parent);
  const items = [
    ...components.map(componentLayoutItem),
    ...eligibleLabels.map(labelLayoutItem),
  ];
  const wireCount = selectedWires.size || (selectedWire ? 1 : 0);
  const count = components.length + labels.length + selectedNets.size + wireCount;
  const blocked = labels.length !== eligibleLabels.length || selectedNets.size > 0 || wireCount > 0;
  return { items, count, blocked };
}

function layoutPlan(action, measure = 'gaps') {
  const selection = layoutSelection();
  if (selection.blocked) return { ok: false, reason: 'Select only components or free annotations; wires and net labels cannot be aligned this way.' };
  return action === 'x' || action === 'y'
    ? distributionPlan(selection.items, action, measure)
    : alignmentPlan(selection.items, action);
}

function updateAlignControls() {
  const panel = document.getElementById('align-panel');
  if (!panel) return;
  const selection = layoutSelection();
  panel.hidden = selection.count < 2;
  if (panel.hidden) { layoutPreviewRects = []; return; }
  document.getElementById('align-count').textContent = `${selection.count} selected`;
  const measure = document.getElementById('align-measure')?.value || 'gaps';
  const note = document.getElementById('align-note');
  note.textContent = selection.blocked
    ? 'Wires, net labels, and owned labels cannot be moved by these controls.'
    : selection.items.length < 3 ? 'Select three or more objects to distribute.'
      : 'Outer objects stay fixed when distributing.';
  for (const button of panel.querySelectorAll('[data-layout-align], [data-layout-distribute]')) {
    const plan = layoutPlan(button.dataset.layoutAlign || button.dataset.layoutDistribute, measure);
    button.disabled = !plan.ok;
    if (!plan.ok) button.title = plan.reason;
  }
}

function applyLayoutPlan(plan) {
  if (!plan.ok) { logLine(plan.reason, 'error'); return false; }
  const moves = plan.deltas.filter(({ dx, dy }) => dx || dy);
  if (!moves.length) { logLine('selection is already aligned'); return false; }
  const before = snapshot();
  const original = circuit;
  circuit = Circuit.fromJSON(JSON.parse(before));
  try {
    const refs = moves.filter(({ id }) => circuit.components.has(id)).map(({ id }) => id);
    const touched = netsTouching(refs);
    for (const { id, dx, dy } of moves) {
      const component = circuit.components.get(id);
      if (component) {
        component.transform.x += dx;
        component.transform.y += dy;
      } else {
        const label = circuit.labels.get(id);
        if (label) {
          const anchor = label.anchorWorld();
          label.moveTo(anchor.x + dx, anchor.y + dy);
        }
      }
    }
    if (refs.length) {
      circuit.connectCoincident(refs);
      circuit.reconnectCoincidentNets();
      circuit.ensureUniqueTerminals(refs);
    }
    for (const id of netsTouching(refs)) touched.add(id);
    for (const id of touched) {
      const net = circuit.nets.get(id);
      if (net && circuit.rerouteNet(net, 'refresh') === false) throw new Error(`unable to reroute net ${id}`);
    }
    circuit.syncJunctionSolders();
    circuit.invalidateRoutingCache();
    recordHistoryEntry(before);
    markModelChanged();
    layoutPreviewRects = [];
    logLine(plan.exact === false ? 'distributed on grid; adjacent intervals differ by at most one cell' : 'aligned selection');
    render();
    return true;
  } catch (err) {
    circuit = original;
    layoutPreviewRects = [];
    logLine(`alignment cancelled: ${err.message}`, 'error');
    render();
    return false;
  }
}

function previewLayoutPlan(plan) {
  const items = layoutSelection().items;
  layoutPreviewRects = plan.ok ? plan.deltas.filter(({ dx, dy }) => dx || dy).map(({ id, dx, dy }) => {
    const item = items.find((candidate) => candidate.id === id);
    return item && { x: item.bbox.x + dx, y: item.bbox.y + dy, w: item.bbox.w, h: item.bbox.h };
  }).filter(Boolean) : [];
  renderCanvas(previewTransaction ? `${modelRevision}:preview:${previewRevision}` : modelRevision);
}

const alignPanelEl = document.getElementById('align-panel');
alignPanelEl?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-layout-align], [data-layout-distribute]');
  if (!button || button.disabled) return;
  const action = button.dataset.layoutAlign || button.dataset.layoutDistribute;
  const measure = document.getElementById('align-measure')?.value || 'gaps';
  applyLayoutPlan(layoutPlan(action, measure));
});
alignPanelEl?.addEventListener('pointerover', (event) => {
  const button = event.target.closest('[data-layout-align], [data-layout-distribute]');
  if (!button || button.disabled) return;
  previewLayoutPlan(layoutPlan(button.dataset.layoutAlign || button.dataset.layoutDistribute,
    document.getElementById('align-measure')?.value || 'gaps'));
});
alignPanelEl?.addEventListener('pointerout', (event) => {
  if (!event.target.closest('[data-layout-align], [data-layout-distribute]')) return;
  layoutPreviewRects = [];
  renderCanvas(previewTransaction ? `${modelRevision}:preview:${previewRevision}` : modelRevision);
});
alignPanelEl?.querySelector('#align-measure')?.addEventListener('change', () => {
  layoutPreviewRects = [];
  updateAlignControls();
  render();
});

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

function mirroredCopyGhostOperation(operation) {
  if (operation === 'rotate') return 'rotateCCW';
  if (operation === 'rotateCCW') return 'rotate';
  return operation;
}

/** Keep the secondary copy as the exact symmetric image of a transformed
 * primary copy. Keyboard transforms do not pass through moveCopyGhost(), so
 * the mirror must be transformed in the same event instead of waiting for a
 * later pointer move to rebuild it. */
function refreshCopyGhostMirror({ operation = null, pivot = null, translation = null } = {}) {
  const ghost = drag?.ghost;
  const mirror = ghost?.mirror;
  if (!ghost || !mirror || !symmetry?.operation) return true;
  if (translation) {
    const dx = symmetry.operation === 'mirrorX' ? -translation.dx : translation.dx;
    const dy = symmetry.operation === 'mirrorY' ? -translation.dy : translation.dy;
    translateCopyGhost(mirror, dx, dy);
  } else if (operation && pivot) {
    const mirrorPivot = transformWorldPoints([pivot], symmetry.pin, symmetry.operation)[0];
    restoreCopyGhostSelection(mirror);
    const changed = transformMixedSelection(mirroredCopyGhostOperation(operation), {
      recordHistory: false,
      center: mirrorPivot,
    });
    restoreCopyGhostSelection(ghost);
    if (!changed) return false;
  }
  mirror.baseGeometry = captureCopyGhostGeometry(mirror);
  return true;
}

function refreshCopyGhostBase(transform = {}) {
  if (drag?.mode === 'copyghost' && drag.ghost) {
    refreshCopyGhostMirror(transform);
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
  circuit.invalidateRoutingCache();
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
 * Rotate a selection about the copy point or selected component origin.
 * Copy ghosts and mixed selections share transformMixedSelection so their
 * mirrored halves follow the same world-space operation.
 */
function moveGhostActive() {
  return drag?.mode === 'move' && drag.modal;
}

function recordMoveGhostMutation() {
  if (!drag || !moveGhostActive()) return;
  if (!drag.committed) {
    recordHistoryEntry(drag.startSnapshot || snapshot(), true, 'defer');
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
  const turns = ((deg % 360) + 360) % 360;
  const operation = turns === 180 ? 'rotate180' : turns === 270 ? 'rotateCCW' : 'rotate';
  if (inCopyGhost || multi.size > 1 || selectedWires.size || selectedWire || selectedNets.size || selectedLabels().some((l) => !l.owner)) {
    const changed = transformMixedSelection(
      operation,
      { recordHistory: !(inCopyGhost || inMoveGhost), center: pivot },
    );
    if (changed && inCopyGhost) {
      refreshCopyGhostBase({ operation, pivot });
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
  if (inMoveGhost) {
    apply();
    cursor = pivot;
    recordMoveGhostMutation();
  } else {
    commit(apply);
  }
}

/**
 * Mirror a selection about a world vertical (x) or horizontal (y) axis.
 * Copy ghosts and mixed selections share transformMixedSelection so their
 * mirrored halves follow the same world-space operation.
 */
function mirrorSelectionAbout(axis) {
  const inCopyGhost = drag?.mode === 'copyghost';
  const inMoveGhost = moveGhostActive();
  const pivot = inCopyGhost || inMoveGhost ? { x: snap(cursor.x), y: snap(cursor.y) } : null;
  const operation = axis === 'x' ? 'mirrorX' : 'mirrorY';
  if (inCopyGhost || multi.size > 1 || selectedWires.size || selectedWire || selectedNets.size || selectedLabels().some((l) => !l.owner)) {
    const changed = transformMixedSelection(
      operation,
      { recordHistory: !(inCopyGhost || inMoveGhost), center: pivot },
    );
    if (changed && inCopyGhost) {
      refreshCopyGhostBase({ operation, pivot });
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
  if (inMoveGhost) {
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
function transformMixedSelection(operation, { recordHistory = true, center: pivot = null, translation = null } = {}) {
  const delta = translation && Number.isFinite(translation.dx) && Number.isFinite(translation.dy)
    ? { dx: snap(translation.dx), dy: snap(translation.dy) }
    : null;
  if (translation && (!delta || (delta.dx === 0 && delta.dy === 0))) return false;
  validateSelectedWires();
  // A component-set move ghost owns complete attached nets.
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
    const deferredNetLabels = [];
    for (const c of selectedComps()) {
      c.transform = delta
        ? { ...c.transform, x: c.transform.x + delta.dx, y: c.transform.y + delta.dy }
        : transformComponentWorld(c.transform, center, operation);
    }
    const mapPoints = (points) => delta
      ? points.map((point) => ({ x: point.x + delta.dx, y: point.y + delta.dy }))
      : transformWorldPoints(points, center, operation);
    for (const l of selectedLabels()) {
      if (l.parent && selectedAnnotationIds.has(l.parent)) continue;
      if (l.owner && selectedRefSet.has(l.owner)) continue;
      const p = mapPoints([l.anchorWorld()])[0];
      if (l.netId) {
        if (delta && !geometryNetIds.has(l.netId)) {
          deferredNetLabels.push({ label: l, point: p });
        } else {
          // Net geometry is transformed above; assign the corresponding anchor
          // directly so moveTo cannot reject the valid transformed path.
          l.anchor = { x: snap(p.x), y: snap(p.y) };
        }
      } else if (['arrow', 'box', 'line'].includes(l.kind)) {
        l.anchor = p;
        l.end = mapPoints([l.end])[0];
        if (l.points) l.points = mapPoints(l.points);
        l.textAnchor = mapPoints([l.textAnchor])[0];
        for (const child of circuit.labels.values()) {
          if (child.parent === l.id) child.anchor = mapPoints([child.anchor])[0];
        }
      } else {
        l.moveTo(p.x, p.y);
      }
    }
    for (const id of geometryNetIds) {
      const net = circuit.nets.get(id); if (!net) continue;
      if (net.routingMode === 'fixed') {
        net.fixedPaths = net.fixedPaths.map((e) => ({ ...e, points: mapPoints(e.points) }));
      } else {
        const paths = net.paths().map((p) => mapPoints(p));
        net.branches = paths; net.route = paths[0] || null;
      }
      net.junctions = net.junctions.map((p) => mapPoints([p])[0]);
    }
    if (delta && refs.length) {
      circuit.connectCoincident(refs);
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
    if (delta) circuit.reconnectCoincidentNets();
    for (const { label, point } of deferredNetLabels) {
      if (!moveLabelSafely(label, point.x, point.y)) throw new Error(`unable to move net label ${label.id} safely`);
    }
    circuit.syncJunctionSolders();
    circuit.invalidateRoutingCache();
    if (recordHistory) recordHistoryEntry(before);
    markModelChanged();
    return true;
  } catch (err) {
    const keepMoveGhost = moveGhostActive() && !recordHistory;
    if (keepMoveGhost) {
      // Restore only the circuit payload so the move ghost can continue.
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
    markModelChanged();
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
    // Net deletion may also remove captured junction solder components.
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
  markModelChanged();
  return true;
}

function moveCursor(cellsX, cellsY) {
  const next = { x: snap(cursor.x + cellsX * 40), y: snap(cursor.y + cellsY * 40) };
  cursor = wire && terminalSnap ? terminalSnapWorld(next) : next;
  followCursor();
}

/** Arrow keys can walk the cursor (and any ghost or selection riding it) past
 * the edge of the view, so the view follows it out rather than leaving the
 * work off-screen. Mouse-driven cursor moves need no help: the pointer cannot
 * leave the canvas. */
function followCursor() {
  const origin = viewFollowingCursor(view, cursor, GRID);
  if (!origin) return false;
  view = { ...view, ...origin };
  return true;
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
    // An empty canvas has no content to fit. Give it a wider default window so
    // the grid is useful for planning instead of opening at the zoom limit.
    x0 = -600;
    y0 = -600;
    x1 = 600;
    y1 = 600;
  }
  const pane = document.querySelector('.canvas-pane');
  const rail = document.querySelector('.mode-toolbar');
  const paneRect = pane?.getBoundingClientRect();
  const railRect = rail?.getBoundingClientRect();
  const paneW = paneRect?.width || 1;
  const paneH = paneRect?.height || 1;
  // The rail floats over the canvas, so the drawing is fitted beside it. It is
  // a vertical column at the left on a wide window but a horizontal strip
  // across the top on a narrow one, so reserve the axis it is thin along:
  // reserving width for a full-width strip leaves no usable pane at all and
  // fits the drawing into a 1 px box, which reads as F having stopped working.
  const railIsColumn = railRect ? railRect.width <= railRect.height : false;
  const leftPx = railRect && railIsColumn
    ? Math.max(0, Math.min(paneW - 1, railRect.right - (paneRect?.left || 0)))
    : 0;
  const topPx = railRect && !railIsColumn
    ? Math.max(0, Math.min(paneH - 1, railRect.bottom - (paneRect?.top || 0)))
    : 0;
  const usableW = Math.max(1, paneW - leftPx);
  const usableH = Math.max(1, paneH - topPx);
  const usableCenterPx = leftPx + usableW / 2;
  const usableCenterPy = topPx + usableH / 2;
  const marginPx = 16;
  const fitW = Math.max(1, usableW - marginPx * 2);
  const fitH = Math.max(1, usableH - marginPx * 2);
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
  view.y = (y0 + y1) / 2 - th * usableCenterPy / paneH;
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

/** Return the drawable wire candidates under a label-placement click.  A
 * snapped crossing may belong to several physical nets; keep those identities
 * separate so the selected/highlighted-net rule below can resolve it without
 * relying on render order. */
function netLabelCandidatesAt(world) {
  const point = { x: snap(world.x), y: snap(world.y) };
  const candidates = new Map();
  const onSegment = (a, b) => pointOnPath(point, [a, b]);
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

function interfacePortNet(component) {
  if (!component || !INTERFACE_PIN_TYPES.has(component.type)) return null;
  try { return circuit.netOfTerminal({ comp: component.refdes, term: 'p' }); }
  catch { return null; }
}

function sameNamedConnection(left, right) {
  const a = String(left ?? '').trim();
  const b = String(right ?? '').trim();
  return !!a && !!b && (a === b || normalizeComponentRefdes(a) === normalizeComponentRefdes(b));
}

/** Find named nets or interface ports that a new name would virtually join. */
function namedConnectionConflicts(name, { netId = null, ownerRefdes = null } = {}) {
  const wanted = String(name ?? '').trim();
  if (!wanted) return [];
  const owner = ownerRefdes ? circuit.components.get(ownerRefdes) : null;
  const targetNet = netId ? circuit.nets.get(netId) : interfacePortNet(owner);
  const targetMembers = new Set(targetNet?.terminals?.map((terminal) => terminal.comp) || []);
  const conflicts = [];
  const seen = new Set();
  for (const component of circuit.components.values()) {
    if (!INTERFACE_PIN_TYPES.has(component.type) || component.refdes === ownerRefdes) continue;
    const label = circuit.labelOf(component.refdes);
    const portName = label?.text || component.refdes;
    if (!sameNamedConnection(portName, wanted)) continue;
    const portNet = interfacePortNet(component);
    if (targetNet && portNet?.id === targetNet.id) continue;
    const key = `port:${component.refdes}`;
    if (seen.has(key)) continue;
    seen.add(key);
    conflicts.push({ kind: 'port', component, net: portNet });
  }
  for (const net of circuit.nets.values()) {
    if (net.id === targetNet?.id || !net.name || !sameNamedConnection(net.name, wanted)) continue;
    if (net.terminals.some((terminal) => targetMembers.has(terminal.comp))) continue;
    const key = `net:${net.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    conflicts.push({ kind: 'net', net });
  }
  return conflicts;
}

/** A port's label is its identity, exactly like every other component's, so a
 * name another port already carries is a collision rather than a connection.
 * Nets are joined virtually by naming the NET, not by repeating a port name. */
function portNameConflict(conflicts, ownerRefdes) {
  const owner = ownerRefdes ? circuit.components.get(ownerRefdes) : null;
  if (!owner || !INTERFACE_PIN_TYPES.has(owner.type)) return null;
  return conflicts.find((conflict) => conflict.kind === 'port' && conflict.component) || null;
}

function reportPortNameConflict(conflict, name) {
  logLine(`Port name "${name}" is already used by ${conflict.component.refdes}. `
    + 'Draw a stub and name that net instead of repeating a port name.', 'error');
}

async function confirmNamedConnection(name, conflicts) {
  const port = conflicts.find((conflict) => conflict.kind === 'port')?.component;
  const target = port ? `port ${port.refdes}` : 'an existing named net';
  return confirmChoice({
    title: 'Connect named nets?',
    message: `The name ${name} is already used by ${target}. Connect this net virtually to the existing name?`,
    confirmLabel: 'Connect',
    cancelLabel: 'Keep separate',
  });
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

/** Place a math-capable ordinary label and open its editor with the caret
 * between the two dollar delimiters. The persisted object remains a normal
 * LabelInstance, with only `math:true` changing its renderer. */
function placeEquationAt(world) {
  const point = { x: snap(world.x), y: snap(world.y) };
  let label;
  commit(() => { label = circuit.addLabel({ text: '$$', x: point.x, y: point.y, align: 'center', math: true }); });
  setSelection([]);
  setLabelSelection([label.id]);
  labelMode = null;
  logLine(`placed equation @ (${point.x},${point.y})`);
  render();
  inlineEditLabel(label, { equationDraft: true });
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

function commitArrowAnnotation(includeCursor = true) {
  if (annotationPoints.length < 2) return false;
  const points = annotationPoints.map((point) => ({ ...point }));
  const tail = points.at(-1);
  if (includeCursor && (!tail || tail.x !== cursor.x || tail.y !== cursor.y)) points.push({ ...cursor });
  if (points.length < 2) return false;
  let annotation;
  commit(() => { annotation = circuit.addAnnotation('arrow', { points, text: 'label' }); });
  setSelection([]);
  setLabelSelection([annotation.id]);
  logLine(`placed arrow with ${points.length} points`);
  annotationPoints = [];
  annotationStart = null;
  labelMode = null;
  render();
  const annotationLabel = [...circuit.labels.values()].find((label) => label.parent === annotation.id);
  inlineEditLabel(annotationLabel, { removeOnEmpty: true });
  return true;
}

function placeShapeAnnotation(world, endOverride = null) {
  const point = { x: snap(world.x), y: snap(world.y) };
  let annotation;
  let annotationLabel;
  if (labelMode === 'arrow') {
    if (!annotationStart) {
      annotationStart = point;
      annotationPoints = [point];
      logLine('ARROW: choose intermediate/end points; press Enter to commit');
      render();
      return false;
    }
    if (!annotationPoints.length) annotationPoints = [annotationStart];
    const next = endOverride || point;
    const previous = annotationPoints.at(-1);
    if (!previous || previous.x !== next.x || previous.y !== next.y) annotationPoints.push(next);
    logLine(`arrow point ${annotationPoints.length}; press Enter to commit`);
    render();
    return false;
  }
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
  return true;
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
      markModelChanged(false);
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
/** The world transform of the armed component ghost. */
function pendingTransform() {
  if (pendingPlace?.kind !== 'component') return null;
  let def;
  try { def = getSymbol(pendingPlace.type); } catch { return null; }
  return {
    x: cursor.x,
    y: cursor.y,
    rotation: pendingPlace.rotation || 0,
    mirrorX: pendingPlace.mirrorX !== null ? !!pendingPlace.mirrorX : !!def.defaultMirrorX,
    mirrorY: pendingPlace.mirrorY !== null ? !!pendingPlace.mirrorY : !!def.defaultMirrorY,
  };
}

/** The mirrored twin of one ghost transform, or null when symmetry is not
 *  armed, has no direction yet, or the ghost sits on the axis itself -- there
 *  is no pair to place when both halves would land on the same square. */
/** The axis in the drawing's own terms, e.g. `x=0`. */
function symmetryAxisText() {
  if (!symmetry?.operation) return '';
  return symmetry.operation === 'mirrorX' ? `x=${symmetry.pin.x}` : `y=${symmetry.pin.y}`;
}

function symmetryTwin(base = pendingTransform()) {
  if (!base || !symmetry?.operation) return null;
  const twin = transformComponentWorld(base, symmetry.pin, symmetry.operation);
  return twin.x === base.x && twin.y === base.y ? null : twin;
}

/** Copy ghosts preserve the pointer as their drag anchor, but symmetry should
 *  read from the copied component set: a single device uses its origin, while
 *  a multi-device copy uses the midpoint of its component origins. For a
 *  non-component selection there is no symbol origin, so keep the pointer
 *  anchor as the sensible fallback. */
function copyGhostSymmetryPin() {
  const components = (drag?.ghost?.refs || [])
    .map((ref) => circuit.components.get(ref))
    .filter(Boolean);
  if (components.length === 1) {
    return { x: components[0].transform.x, y: components[0].transform.y };
  }
  if (components.length > 1) {
    const x0 = Math.min(...components.map((component) => component.transform.x));
    const x1 = Math.max(...components.map((component) => component.transform.x));
    const y0 = Math.min(...components.map((component) => component.transform.y));
    const y1 = Math.max(...components.map((component) => component.transform.y));
    return { x: snap((x0 + x1) / 2), y: snap((y0 + y1) / 2) };
  }
  return { ...cursor };
}

/** Point the mirror at whichever way the cursor has travelled since Alt went
 *  down. Called from the render path, so it follows the cursor however it
 *  moved -- pointer, arrow keys, or a view change.
 *
 *  Placing a pair settles it: a symmetric circuit has one axis, and the next
 *  pair of a differential stage goes above or below the first -- which is
 *  movement along the axis, and would otherwise turn the mirror ninety
 *  degrees just as the second pair is being positioned. Until a pair is
 *  committed it still follows the cursor, so a first move in the wrong
 *  direction costs nothing. */
function syncSymmetryOperation() {
  if (!symmetry || symmetry.settled) return;
  if (symmetry.waitingForMotion) return;
  // A copy can be armed from an arbitrary point in a multi-device selection.
  // Choose the axis from the post-Alt drag direction, not from that click's
  // offset to the selection centre or first component.
  const directionPin = symmetry.armedCursor || symmetry.pin;
  symmetry.operation = symmetryOperation(directionPin, cursor, symmetry.operation);
  // A copy ghost is already committed, so the first move off the axis says
  // where the mirror goes; a later turn must not swing it.
  if (symmetry.operation && drag?.mode === 'copyghost') symmetry.settled = true;
}

/** Drop the mirrored ghost and forget the axis it was about. Releasing the
 *  modifier only does the first half; this is for a dropped ghost. */
function clearSymmetry() {
  dropCopyGhostMirror();
  symmetry = null;
  symmetryMemory = null;
}

/** Arm or drop symmetric placement. It belongs to a component ghost only.
 *  Releasing the modifier takes the twin away but keeps a settled axis, so a
 *  transform between two pairs costs nothing: the next press resumes it. */
function setSymmetry(on) {
  const armed = (mode === 'insert' && pendingPlace?.kind === 'component')
    || drag?.mode === 'copyghost';
  if (on && armed && !symmetry) {
    const pin = drag?.mode === 'copyghost' ? copyGhostSymmetryPin() : { ...cursor };
    symmetry = symmetryMemory
      ? { pin: { ...symmetryMemory.pin }, operation: symmetryMemory.operation, settled: true }
      : {
          pin,
          operation: null,
          waitingForMotion: drag?.mode === 'copyghost',
          armedCursor: drag?.mode === 'copyghost' ? { ...cursor } : null,
        };
    logLine(symmetryMemory
      ? `symmetry axis resumed about ${symmetryAxisText()}`
      : `symmetry axis at (${cursor.x},${cursor.y}) · move off it to mirror · release Alt to drop`);
  } else if (!on && symmetry) {
    dropCopyGhostMirror();
    symmetry = null;
  } else return false;
  render();
  return true;
}

/** While Alt is held in managed Wire mode, the pointer cursor follows the
 * nearest component terminal. It is a hold-only aid and never changes the
 * committed document. */
function setTerminalSnap(on) {
  const next = !!on && !!wire;
  if (terminalSnap === next) return false;
  terminalSnap = next;
  render();
  return true;
}

function placePending() {
  if (!pendingPlace) return;
  if (pendingPlace.kind === 'label') {
    const label = circuit.addLabel({ text: 'label', x: cursor.x, y: cursor.y, align: 'center' });
    setSelection([]);
    setLabelSelection([label.id]);
    logLine(`placed label @ (${label.anchor.x},${label.anchor.y})`);
    rememberInsertType('label');
  } else {
    // One placement, or a mirrored pair while symmetry is armed. Both halves
    // land in the same commit, so the pair is one undo.
    const twin = symmetryTwin();
    const placements = [pendingTransform(), ...(twin ? [twin] : [])].filter(Boolean);
    const placed = placements.map((t) => circuit.addComponent(pendingPlace.type, {
      x: t.x,
      y: t.y,
      rotation: t.rotation,
      mirrorX: t.mirrorX,
      mirrorY: t.mirrorY,
      noLabel: false,
    }));
    // Treat a committed insertion exactly like a component move/copy that
    // lands on existing connectivity. `addComponent` joins coincident pins,
    // while the follow-up pass also attaches a new terminal to a wire endpoint
    // and repairs any split net pieces at the landing point.
    for (const comp of placed) circuit.connectCoincident(comp.refdes);
    circuit.reconnectCoincidentNets();
    circuit.ensureUniqueTerminals(placed.map((comp) => comp.refdes));
    // A solder dot placed on a crossing shorts the nets there. With several
    // given names the dot waits (unsynced) for the user's name choice.
    const awaitingName = placed.some((comp) => comp.type === 'solder' && shortNetsAtPlacedSolder(comp));
    if (!awaitingName) circuit.syncJunctionSolders();
    // A committed placement is acknowledged by the landing flash; it does not
    // take over the selection, so repeated placement never carries a halo.
    setSelection([]);
    if (placed.length > 1) {
      symmetry.settled = true;
      symmetryMemory = { pin: { ...symmetry.pin }, operation: symmetry.operation };
    }
    logLine(placed.length > 1
      ? `placed ${placed.map((comp) => comp.refdes).join(' and ')} (${pendingPlace.type}) mirrored about ${symmetryAxisText()}`
      : `placed ${placed[0].refdes} (${pendingPlace.type}) @ (${cursor.x},${cursor.y})`);
    rememberInsertType(pendingPlace.type);
  }
  if (pendingPlace) pendingPlace.startWorld = { ...cursor };
}

// ----- render -----------------------------------------------------------

/** Recompute collinear overlaps between different nets' wires (B4). Runs only
 *  when `wiresDirty` says the wire geometry changed since the last frame. */
function updateNetWarnings() {
  const nets = [...circuit.nets.values()].map((n) => ({ id: n.id, paths: n.paths() }));
  netWarnings = crossNetOverlaps(nets);
}

function syncDocumentSurface() {
  for (const element of document.querySelectorAll('[data-doc-kind]')) {
    element.hidden = false;
  }
  const heading = document.getElementById('mode-heading');
  if (heading) heading.textContent = 'Schematic tools';
  if (cmdInput) cmdInput.placeholder = 'Schematic command (e.g. add resistor, move R1 120 80, connect R1.a R2.a)';
  const netLabelButton = document.getElementById('btn-mode-net-label');
  if (netLabelButton) {
    netLabelButton.title = 'Place a label on a physical wire (L)';
    netLabelButton.setAttribute('aria-label', 'Place a label on a physical wire');
  }
}

function selectionCenterBounds() {
  let bounds = null;
  const includeRect = (rect) => {
    if (!rect || ![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite)) return;
    const x0 = rect.x;
    const y0 = rect.y;
    const x1 = rect.x + rect.w;
    const y1 = rect.y + rect.h;
    if (!bounds) bounds = { x: x0, y: y0, w: rect.w, h: rect.h };
    else {
      const bx1 = bounds.x + bounds.w;
      const by1 = bounds.y + bounds.h;
      bounds.x = Math.min(bounds.x, x0);
      bounds.y = Math.min(bounds.y, y0);
      bounds.w = Math.max(bx1, x1) - bounds.x;
      bounds.h = Math.max(by1, y1) - bounds.y;
    }
  };
  const includePoint = (point) => point && includeRect({ x: point.x, y: point.y, w: 0, h: 0 });

  const refs = new Set([...multi, ...(selected ? [selected] : [])]);
  for (const ref of refs) includeRect(circuit.components.get(ref)?.bboxWorld());
  for (const id of selLabels) includeRect(circuit.labels.get(id)?.bbox());

  for (const id of selectedNets) {
    const net = circuit.nets.get(id);
    if (!net) continue;
    const paths = net.paths();
    for (const path of paths) for (const point of path || []) includePoint(point);
    if (!paths.length) for (const point of net.terminalWorlds?.() || []) includePoint(point);
  }

  const wireKeys = new Set(selectedWires);
  if (selectedWire) wireKeys.add(`${selectedWire.netId}:${selectedWire.branch}:${selectedWire.segment}`);
  for (const key of wireKeys) {
    const wire = keyToWire(key);
    const path = circuit.nets.get(wire.netId)?.paths()?.[wire.branch];
    const a = path?.[wire.segment - 1];
    const b = path?.[wire.segment];
    if (!a || !b) continue;
    includeRect({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
  }
  return bounds;
}

function syncEmptyState() {
  const card = document.getElementById('empty-state');
  if (!card) return;
  const empty = !circuit.components.size && !circuit.labels.size && !circuit.nets.size;
  card.hidden = !empty || mode === 'insert' || !!wire || !!labelMode;
  if (card.hidden) return;
  card.querySelector('.empty-state-title').textContent = 'Empty schematic';
  card.querySelector('[data-empty-action="wire"] .empty-state-text').textContent = 'Draw a wire';
  card.querySelector('[data-empty-action="place"] .empty-state-text').textContent = 'Insert a component';
}

function render() {
  syncDocumentSurface();
  syncEmptyState();
  // A context menu is independent of canvas repainting. Closing it here made
  // it vanish on the first pointer move after opening it.
  syncSelectedNetSolders();
  updateStyleControls();
  updateAlignControls();
  validateSelectedWires();
  if (wiresDirty) {
    updateNetWarnings();
    wiresDirty = false;
  }
  const modelKey = modelRevision;
  const canvasModelKey = previewTransaction ? `${modelKey}:preview:${previewRevision}` : modelKey;
  renderCanvas(canvasModelKey);
  const nextPanelStateKey = `${modelKey}|${selected || ''}|${selLabel || ''}|${[...multi].join(',')}|${[...selLabels].join(',')}|${[...selectedNets].join(',')}`;
  if (nextPanelStateKey !== panelStateKey) {
    panelStateKey = nextPanelStateKey;
    renderComponents();
    renderNets();
    renderDetail();
  }
  renderCheckSummary();
  syncAnalysisDock();
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
  const env = circuit._netEnv(sourceNetId);
  // Diagonal drafts use the model's own geometry: literal legs between clicked
  // points, auto-routed legs at pins.
  if (allowDiagonal) return diagonalDraftPath(circuit, endpoints, env) || undefined;
  const path = [endpoints[0]];
  for (let i = 1; i < endpoints.length; i++) {
    // Keep the interactive suggestion centered when several safe orthogonal
    // channels are otherwise equivalent; Enter commits this same path.
    const leg = smartRoute(endpoints[i - 1], endpoints[i], {
      ...env, allowDiagonal: false, preferMidpoint: true,
    });
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

function clientRectToSvgBounds(svg, rect) {
  if (!svg || !rect || !(rect.width > 0) || !(rect.height > 0)) return null;
  const inverse = svg.getScreenCTM?.()?.inverse?.();
  const point = svg.createSVGPoint?.();
  if (!inverse || !point) return null;
  const map = (x, y) => {
    point.x = x;
    point.y = y;
    return point.matrixTransform(inverse);
  };
  const corners = [
    map(rect.left, rect.top),
    map(rect.right, rect.top),
    map(rect.left, rect.bottom),
    map(rect.right, rect.bottom),
  ];
  const x = Math.min(...corners.map((p) => p.x));
  const y = Math.min(...corners.map((p) => p.y));
  const x1 = Math.max(...corners.map((p) => p.x));
  const y1 = Math.max(...corners.map((p) => p.y));
  return { x, y, w: x1 - x, h: y1 - y };
}

/** Measure the tight glyph rectangle emitted by the live SVG. SVG <text>
 * exposes getBBox() directly; MathML lives in a foreignObject, so use a Range
 * around its rendered contents and map the screen rectangle back into the
 * SVG's world coordinates. */
function renderedLabelTextBounds(group) {
  if (!group || !canvasSvgEl) return null;
  const text = group.querySelector('text');
  if (text?.getBBox) {
    try {
      const box = text.getBBox();
      if (box.width > 0 && box.height > 0) return { x: box.x, y: box.y, w: box.width, h: box.height };
    } catch { /* an unfitted/hidden SVG text node can reject getBBox */ }
  }
  const math = group.querySelector('.schematic-math-label');
  if (!math) return null;
  try {
    const mathNodes = [...math.querySelectorAll('math')];
    // Measure each line's intrinsic MathML contents. A Range around the
    // multiline flex wrapper includes its full-width line containers, which
    // feeds the old bbox back into the next measurement. Rounding can then
    // add/remove two cells and move left-aligned assumptions by one cell.
    const rects = mathNodes.map((node) => {
      const client = node.getBoundingClientRect?.();
      if (client?.width > 0 && client.height > 0) return client;
      const range = document.createRange();
      range.selectNodeContents(node);
      return range.getBoundingClientRect();
    }).filter((rect) => rect.width > 0 && rect.height > 0);
    if (!rects.length) return null;
    const tight = {
      left: Math.min(...rects.map((rect) => rect.left)),
      top: Math.min(...rects.map((rect) => rect.top)),
      right: Math.max(...rects.map((rect) => rect.right)),
      bottom: Math.max(...rects.map((rect) => rect.bottom)),
    };
    tight.width = tight.right - tight.left;
    tight.height = tight.bottom - tight.top;
    // The foreignObject reserves six CSS pixels of padding around the math;
    // include that rendered inset so the measured box cannot clip the glyphs.
    const css = getComputedStyle(math);
    // Computed padding is in foreignObject/world units; Range rectangles are
    // in screen pixels. Convert before expanding, otherwise zoom changes the
    // measured bbox (and a fraction's vertical position after reload).
    const matrix = canvasSvgEl.getScreenCTM();
    const scaleX = Math.hypot(matrix.a, matrix.b);
    const scaleY = Math.hypot(matrix.c, matrix.d);
    const px = (Number.parseFloat(css.paddingLeft) || 0) * scaleX;
    const py = (Number.parseFloat(css.paddingTop) || 0) * scaleY;
    const pr = (Number.parseFloat(css.paddingRight) || 0) * scaleX;
    const pb = (Number.parseFloat(css.paddingBottom) || 0) * scaleY;
    const expanded = {
      left: tight.left - px,
      top: tight.top - py,
      right: tight.right + pr,
      bottom: tight.bottom + pb,
      width: tight.width + px + pr,
      height: tight.height + py + pb,
    };
    return clientRectToSvgBounds(canvasSvgEl, expanded);
  } catch { return null; }
}

// Equation annotations are initially positioned with the model estimate. Once
// MathML dimensions are available, the layout is recalculated below the figure.
let equationAnnotationLayout = null;

function reflowEquationAnnotations() {
  const layout = equationAnnotationLayout;
  if (!layout) return false;
  const equations = layout.equationIds
    .map((id) => circuit.labels.get(id))
    .filter(Boolean);
  if (equations.length !== layout.equationIds.length) {
    equationAnnotationLayout = null;
    return false;
  }
  // Do not reflow until every equation has a real browser measurement. The
  // model fallback is intentionally conservative, but mixing fallback and
  // measured heights would make the centerline pitch unstable.
  if (!equations.every((label) => label._renderedTextBounds?.w > 0 && label._renderedTextBounds?.h > 0)) return false;

  const assumptions = layout.assumptionsId ? circuit.labels.get(layout.assumptionsId) : null;
  const signature = [
    ...equations.map((label) => {
      const box = label.bbox();
      return `${box.w}x${box.h}`;
    }),
    assumptions ? (() => {
      const box = assumptions.bbox();
      return `${box.w}x${box.h}`;
    })() : '',
  ].join('|');
  if (signature === layout.signature) return false;
  layout.signature = signature;

  // Equal centerline spacing with the smallest possible bbox gap is governed
  // by the largest adjacent half-sum, not simply by the tallest equation. A
  // pair touching at that pitch has a zero gap; any narrower neighboring pair
  // naturally leaves more room.
  const heights = equations.map((label) => label.bbox().h);
  const pitch = heights.length < 2
    ? heights[0]
    : Math.max(...heights.slice(1).map((height, index) => (heights[index] + height) / 2));
  const left = snap(layout.leftEdge);
  const top = snap(layout.bottomEdge + layout.topGap);
  let moved = false;
  equations.forEach((label, index) => {
    const box = label.bbox();
    const x = snap(left + box.w / 2);
    const y = snap(top + pitch / 2 + index * pitch);
    const anchor = label.anchorWorld();
    if (anchor.x !== x || anchor.y !== y) moved = true;
    label.moveTo(x, y);
  });

  if (assumptions) {
    const box = assumptions.bbox();
    const x = snap(left + box.w / 2);
    const y = snap(top + pitch * equations.length + GRID + box.h / 2);
    const anchor = assumptions.anchorWorld();
    if (anchor.x !== x || anchor.y !== y) moved = true;
    assumptions.moveTo(x, y);
  }
  if (moved) markModelChanged();
  return moved;
}

// A math label is measured once per text, and its size comes from the math
// font's metrics — so measuring before that webfont arrives locks in a box
// built from the fallback (or from the invisible `font-display: block`
// period), which then clips the glyphs for the rest of the session. Hold math
// measurement until the face is ready, then let every math label measure
// again. Without the Font Loading API, measure as before.
const MATH_FONT_PROBE = `${LABEL_FONT_SIZE}px "Latin Modern Math"`;
let mathFontReady = !document.fonts || document.fonts.check(MATH_FONT_PROBE);

if (!mathFontReady) {
  const releaseMathMeasurement = () => {
    if (mathFontReady) return;
    mathFontReady = true;
    for (const label of circuit.labels.values()) if (label.math) label.clearMeasuredTextBounds();
    scheduleMeasuredLabelRender();
  };
  // Release on failure too: a fallback-metric box beats never measuring.
  document.fonts.load(MATH_FONT_PROBE).then(releaseMathMeasurement, releaseMathMeasurement);
}

// A label's anchor is the center of its box, but for an aligned free
// annotation the meaning is its aligned edge: analysis annotations are placed
// flush with the figure's left edge. Re-measuring — a font change, new browser
// metrics — then slides that edge by half the width change, which is what
// makes a saved equation stack drift sideways when it is reopened. Box widths
// are even cell multiples, so half a change stays on the grid.
function keepAlignedEdge(label, before) {
  if (label.netId || label.owner) return; // anchored to a wire or a component
  const shift = alignedAnchorShift(label.align, before.w, label.bbox().w);
  if (!shift) return;
  const anchor = label.anchorWorld();
  label.moveTo(anchor.x + shift, anchor.y);
}

function syncRenderedLabelMetrics() {
  if (!canvasSvgEl) return false;
  const groups = new Map([...canvasSvgEl.querySelectorAll('[data-label-id]')]
    .map((group) => [group.getAttribute('data-label-id'), group]));
  let changed = false;
  for (const label of circuit.labels.values()) {
    if (label.kind !== 'label') continue;
    // Generated symbol-sheet category labels are already placed against a
    // shared grid right edge. Their fallback boxes intentionally stay stable;
    // replacing them with browser glyph metrics would make labels whose text
    // crosses a cell boundary jump one square left on every reload.
    if (label.id.startsWith('category_')) continue;
    if (label.math && !mathFontReady) continue;
    const group = groups.get(label.id);
    const bounds = renderedLabelTextBounds(group);
    if (!bounds) continue;
    // A measured bbox is a one-time model resize for the current text. Do not
    // feed a later container-size measurement back into the model or a
    // foreignObject can resize itself forever. Text edits clear this runtime
    // metric and allow one fresh pass.
    if (label._renderedTextBounds) continue;
    const before = label.bbox();
    if (!label.setRenderedTextBounds(bounds.w, bounds.h)) continue;
    keepAlignedEdge(label, before);
    changed = true;
  }
  return reflowEquationAnnotations() || changed;
}

function scheduleMeasuredLabelRender() {
  if (labelMetricsRenderPending) return;
  labelMetricsRenderPending = true;
  requestAnimationFrame(() => {
    labelMetricsRenderPending = false;
    committedCanvasKey = '';
    render();
  });
}

function renderCanvas(modelKey) {
  // Fixed-net editing preserves literal geometry.
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
    for (const ref of drag.ghost.mirror?.refs || []) ghostRefs.add(ref);
    for (const id of drag.ghost.mirror?.labels || []) ghostLabels.add(id);
    for (const id of drag.ghost.mirror?.netIds || []) ghostNets.add(id);
  } else if (drag?.mode === 'move') {
    for (const ref of drag.origins?.keys?.() || []) ghostRefs.add(ref);
    for (const id of drag.labelOrigins?.keys?.() || []) ghostLabels.add(id);
    if (!drag.detached) {
      for (const id of netsTouching([...ghostRefs])) ghostNets.add(id);
    }
  } else if (drag?.mode === 'labelmove') {
    for (const id of drag.startAnchors?.keys?.() || []) ghostLabels.add(id);
  }
  const editingLabelId = inlineInput?.dataset.labelId || '';
  const canvasKey = `${modelKey}|${showGrid}|${view.x},${view.y},${view.w},${view.h}|${editingLabelId}|${[...ghostRefs].join(',')}|${[...ghostLabels].join(',')}|${[...ghostNets].join(',')}`;
  const canvasRebuilt = canvasKey !== committedCanvasKey;
  if (canvasRebuilt) {
    committedCanvasKey = canvasKey;
    canvasEl.innerHTML = svgString(circuit, {
      themeInk: true,
      underlay: true,
      grid: showGrid,
      terminals: false,
      junctions: false,
      background: true,
      emptyHint: false,
      viewport: { x: view.x, y: view.y, w: view.w, h: view.h },
      ghostRefs,
      ghostLabels,
      ghostNets,
      editingLabel: editingLabelId,
    });
    canvasSvgEl = canvasEl.querySelector('svg');
    if (syncRenderedLabelMetrics()) scheduleMeasuredLabelRender();
    overlayEl = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    overlayEl.setAttribute('class', 'editor-overlay');
    canvasSvgEl.appendChild(overlayEl);
  }
  // Design-check focus is drawn separately (error color); only real selection is blue.
  const nets = [...selectedNets].map((id) => circuit.nets.get(id)).filter(Boolean);
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
  syncSymmetryOperation();
  const ghostTwin = ghost?.def ? (() => {
    const twin = symmetryTwin();
    return twin ? { ...ghost, ...twin } : null;
  })() : null;
  const movingLayoutItem = ghost?.def ? ghostLayoutItem(ghost)
    : (drag?.mode === 'move' || drag?.mode === 'copyghost') && ghostRefs.size
      ? (() => {
          const ref = selected && ghostRefs.has(selected) ? selected : [...ghostRefs][0];
          const component = circuit.components.get(ref);
          return component ? componentLayoutItem(component) : null;
        })()
      : null;
  // The axis carries the point it is measuring away from, so the overlay can
  // dimension the pair while it is being pulled apart: a ghost measures from
  // its layout anchor (a device's conduction column, not its bbox), a wire
  // draft from the cursor, which is the end being mirrored.
  const symmetryAxis = symmetry && ghost?.def
    ? {
        operation: symmetry.operation,
        pin: symmetry.pin,
        from: ghost?.def ? movingLayoutItem?.anchor : { ...cursor },
      }
    : null;
  activeSymmetryCells = (() => {
    if (!symmetryAxis?.operation || !symmetryAxis.from) return null;
    const axis = symmetryAxis.operation === 'mirrorX' ? 'x' : 'y';
    const offset = Math.abs(symmetryAxis.from[axis] - symmetryAxis.pin[axis]);
    return offset > 1e-6 ? Math.round((offset / GRID) * 100) / 100 : null;
  })();
  const placementGuide = movingLayoutItem
    ? {
        moving: movingLayoutItem,
        guides: guidesVisible ? placementGuides([...circuit.components.values()]
          .filter((component) => !ghostRefs.has(component.refdes) && component.type !== 'solder')
          .map(componentLayoutItem), movingLayoutItem) : [],
      }
    : null;
  activePlacementGuides = placementGuide?.guides || [];
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
    selection: [...multi],
    emphasis: equationEmphasis,
    diagnostic: diagnosticSelection,
    resizeBlocks: [...multi].filter((ref) => {
      const component = circuit.components.get(ref);
      return component?.type === 'block' && component.transform.rotation % 360 === 0 && !component.transform.mirrorX && !component.transform.mirrorY;
    }),
    ghostTwin,
    symmetryAxis,
    centerGuides: placementGuide?.guides.length ? null : selectionCenterBounds(),
    layoutPreviewRects,
    placementGuide,
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
    selLabels: [...selLabels],
    nets,
    previewSelection,
    // Keep the committed clicks visible while a line is being drafted.
    annotationPreview: labelMode === 'line' && (annotationPoints.length || drag?.mode === 'annotationlineplace')
      ? { kind: 'line', points: [...annotationPoints, ...(drag?.previewEnd ? [drag.previewEnd] : [cursor])] }
      : (drag?.mode === 'annotationplace' && (annotationStart || drag.previewEnd))
        || (['arrow', 'box'].includes(labelMode) && annotationStart)
        ? labelMode === 'arrow'
          ? { kind: 'arrow', points: [...annotationPoints, drag?.previewEnd || cursor] }
          : { kind: labelMode, a: annotationStart || drag?.startWorld, b: drag?.previewEnd || cursor }
        : undefined,
    warnOverlaps: netWarnings,
    rubber: visual
      ? { x0: Math.min(visual.x, cursor.x), y0: Math.min(visual.y, cursor.y), x1: Math.max(visual.x, cursor.x), y1: Math.max(visual.y, cursor.y) }
      : drag && drag.rubber
        ? drag.rubber
        : undefined,
    wirePreview: wire ? wirePreview : null,
    directWirePreview: directPreview,
    wireMode: !!wire || !!directWire,
    wireSource: (wire || directWire)?.source ? { ...(wire || directWire).source } : undefined,
    terminalSnapTarget: terminalSnap ? nearestTerminal(cursor, { anyDistance: true }) : null,
    ghost,
    cursorCrosshair: crosshairVisible && cursorInCanvas ? view : null,
  });
  // Ghosts and previews use the same theme-aware ink as the committed drawing.
  overlayEl.innerHTML = themeInkSvg(overlay);
  flushPendingCommitFeedback();
  mountCommitFeedback(canvasRebuilt);
}

// ----- mouse ------------------------------------------------------------

const DRAG_THRESH = 6; // px before a press becomes a drag
let drag = null;
let inlineInput = null; // the active inline-edit <input>, if any

/** Standard inline-editor keys: Enter or blur commits, Escape cancels, and
 *  Shift+Enter inserts a line break where the field accepts one. Extra keys
 *  are handled first and may claim the event by returning true. */
function bindInlineEditorKeys(input, done, { multiline = true, extraKeys = null } = {}) {
  input.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (extraKeys?.(ev)) return;
    if (multiline && ev.key === 'Enter' && ev.shiftKey) return;
    if (ev.key === 'Enter') { ev.preventDefault(); done(true); }
    else if (ev.key === 'Escape') { ev.preventDefault(); done(false); }
  });
  input.addEventListener('blur', () => done(true));
}

let lastLabelClick = null; // { id, x, y, at } of the previous label click (for double-click fallback)
let lastLineClick = null;
let lastWireClick = null; // { key, x, y, at } of the previous wire click (for double-click fallback)
let lastNetClick = null; // { netId, x, y, at } of the previous nets-list click (for double-click fallback)
let lastComponentClick = null; // { refdes, x, y, at } of the previous component-list click
let lastSchematicComponentClick = null; // { refdes, x, y, at } for canvas double-click fallback

/** A press becomes a drag once the pointer has moved BOTH more than the pixel
 *  threshold (a few px of click jitter is never a drag) AND more than half a
 *  grid cell in world units (zoom-independent — at any zoom a click that stays
 *  within a cell is a plain click, never a drag). */
function dragMoved(startWorld, startClient, w, ev) {
  const world = Math.hypot(w.x - startWorld.x, w.y - startWorld.y);
  const client = Math.hypot(ev.clientX - startClient.x, ev.clientY - startClient.y);
  return world > GRID / 2 && client > DRAG_THRESH;
}

/** Name of a net that `touchedNetIds` newly overlap (collinearly) compared
 * with the `beforeSnapshot` document, or null. Pre-existing overlaps are
 * reported by Design check and do not block unrelated edits. */
function newCrossNetOverlap(beforeSnapshot, touchedNetIds) {
  const pairs = (doc) => {
    const out = new Map();
    const nets = [...doc.nets.values()].map((net) => ({ id: net.id, paths: net.paths() }));
    for (const overlap of crossNetOverlaps(nets)) {
      const a = overlap.key.split(':')[0];
      const b = overlap.otherKey.split(':')[0];
      if (!touchedNetIds.has(a) && !touchedNetIds.has(b)) continue;
      out.set([a, b].sort().join('|'), touchedNetIds.has(a) ? b : a);
    }
    return out;
  };
  const before = pairs(Circuit.fromJSON(JSON.parse(beforeSnapshot)));
  for (const [pair, other] of pairs(circuit)) {
    if (!before.has(pair)) {
      const net = circuit.nets.get(other);
      return net?.name ? `${net.name} (${net.id})` : other;
    }
  }
  return null;
}

/** Name a new wire-through-body violation on the nets changed by a drag.
 * Existing violations are tolerated so an unrelated pre-existing error does
 * not make this gesture impossible; a newly created geometry violation still
 * rejects the final drop. */
function newWireBodyViolation(beforeSnapshot, touchedNetIds) {
  const bodyIssues = (doc) => evaluate(doc).issues
    .filter((issue) => issue.kind === 'wire-through-body' && touchedNetIds.has(issue.netId));
  const issueKey = (issue) => JSON.stringify([issue.netId, issue.refs || [], issue.points || []]);
  const before = new Set(bodyIssues(Circuit.fromJSON(JSON.parse(beforeSnapshot))).map(issueKey));
  return bodyIssues(circuit).find((issue) => !before.has(issueKey(issue)))?.message || null;
}

/** Abort an in-progress mouse drag. A cancelled wire run is restored to its
 *  pre-drag polyline so nothing is left half-edited. */
function cancelDrag() {
  if (drag?.mode === 'blockresize') {
    if (drag.startSnapshot) circuit = loadDocument(JSON.parse(drag.startSnapshot));
    drag = null;
    render();
    return;
  }
  if (drag?.mode === 'copyghost') {
    circuit = Circuit.fromJSON(JSON.parse(drag.ghost.beforeSnapshot));
    markModelChanged();
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
  if (previewTransaction) {
    cancelPreviewTransaction();
    drag = null;
    movePending = false;
    copyPending = false;
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
    markModelChanged();
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
    markModelChanged();
  }
  if (drag && drag.mode === 'fixedwire') {
    for (const [net, saved] of drag.fixedSnapshots) {
      net.fixedPaths = cloneFixedPaths(saved.fixedPaths);
      net.junctions = clonePoints(saved.junctions);
    }
    circuit.syncJunctionSolders();
    markModelChanged();
  }
  if (drag && drag.mode === 'fixedendpoint') {
    circuit.restoreFixedGeometry(drag.net, drag.saved.fixedPaths, drag.saved.junctions);
    markModelChanged();
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
  return worldAndCursorFromClient(clientX, clientY, pane.getBoundingClientRect(), refView).world;
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
    if (label.selectable !== false && rectContained(label.bbox(), box)) labels.push(label.id);
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

/** `matchAt` for an unsnapped world point. */
function pickAt(w) {
  return matchAt(snap(w.x), snap(w.y));
}

/** Pick the nearest net route within a forgiving screen-sized hit area.
 *  Considers EVERY drawn branch of a multi-way net, so a joined/connected wire
 *  is selectable and draggable anywhere along it. */
function pickWire(w) {
  const p = paneSize();
  const pxPerUnit = p ? view.w / p.w : 1;
  const tol = 12 / pxPerUnit;
  const snapped = { x: snap(w.x), y: snap(w.y) };
  if (wireHitIndexRevision !== modelRevision) {
    wireHitIndex = buildWireHitIndex(circuit.nets.values());
    wireHitIndexRevision = modelRevision;
  }
  const candidates = queryWireHitIndex(wireHitIndex, w, snapped, tol);
  return chooseWireHitCandidate({
    candidates,
    selectedNets,
    diagnosticNets: diagnosticSelection.nets,
  });
}

function fixedWireDragAt(hit, w, startClient, ev) {
  const startSnapshot = snapshot();
  const points = hit.net.fixedPaths?.[hit.branch]?.points || hit.pts || [];
  if (points.length < 2) return false;
  beginPreviewTransaction(startSnapshot);
  const previewNet = circuit.nets.get(hit.net.id);
  if (!previewNet) {
    cancelPreviewTransaction();
    return false;
  }
  hit = { ...hit, net: previewNet, pts: previewNet.fixedPaths?.[hit.branch]?.points || hit.pts || [] };
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
    fixedSnapshots.set(net, captureFixedGeometry(net));
  }
  drag = {
    mode: 'fixedwire', net: hit.net, branch: hit.branch, seg: hit.seg,
    vertex, junction, startWorld: w, startClient, moved: false, committed: false,
    fixedSnapshots, startSnapshot, rubber: null,
  };
  cursor = { x: snap(w.x), y: snap(w.y) };
  logLine(junction >= 0 ? 'fixed junction — drag to move its dot' : vertex >= 0 ? 'fixed vertex — drag to move it' : 'fixed path — drag to move its segment');
  render();
  return true;
}

function fixedEndpointDragAt(endpoint, startWorld, startClient) {
  const startSnapshot = snapshot();
  const net = circuit.nets.get(endpoint.netId);
  if (!net) return false;
  beginPreviewTransaction(startSnapshot);
  const previewNet = circuit.nets.get(endpoint.netId);
  if (!previewNet) {
    cancelPreviewTransaction();
    return false;
  }
  endpoint = { ...endpoint, netId: previewNet.id };
  const activeNet = previewNet;
  const saved = captureFixedGeometry(activeNet);
  drag = {
    mode: 'fixedendpoint', endpoint, net: activeNet, startWorld, startClient,
    moved: false, committed: false, startSnapshot, saved,
  };
  cursor = { x: snap(startWorld.x), y: snap(startWorld.y) };
  logLine('fixed open endpoint — drag to move, or use Wire to extend');
  render();
  return true;
}

function commitFixedEndpointDraft(source, target, points, mode) {
  if (!source || !target) return false;
  const before = snapshot();
  const net = circuit.nets.get(source.netId);
  if (!net) return false;
  const saved = captureFixedGeometry(net);
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
    recordHistoryEntry(before);
    markModelChanged();
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
  const startSnapshot = snapshot();
  beginPreviewTransaction(startSnapshot);
  const previewNet = circuit.nets.get(hit.net.id);
  if (!previewNet) {
    cancelPreviewTransaction();
    return false;
  }
  hit = { ...hit, net: previewNet };
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
    if (count !== live.length - 1) {
      cancelPreviewTransaction();
      return false; // Partial selection uses the regular drag path.
    }
    if (!fragments.some((f) => f.net === net && f.branch === w.branch)) {
      fragments.push({ net, branch: w.branch, orig: live.map((p) => ({ ...p })), fixed: net.routingMode === 'fixed' });
    }
  }
  if (!fragments.length) {
    cancelPreviewTransaction();
    return false;
  }
  drag = {
    mode: 'floatingwire', fragments, startWorld, startClient, moved: false,
    committed: false, startSnapshot, shift: ev.shiftKey,
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
    for (const t of c.terminalDefs) {
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
    const def = c?.terminalDefs.find((t) => t.name === terminal.term);
    return {
      type: 'terminal', comp: terminal.comp, term: terminal.term, point: { ...point },
      dir: c && def ? circuit._pinDir(c, def, point.x, point.y) : null,
    };
  }
  if (net.junctions.some((p) => p.x === point.x && p.y === point.y)) return { type: 'junction', point: { ...point } };
  return { type: 'free', point: { ...point } };
}
/** Restore a collapsed interior run from transient editor state. */
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

/** Propagate a moved managed junction endpoint to incident branches. */
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
    // legs; unbounded bridge moves propagate the junction.
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

/** Keep the single-route view in sync with explicit managed branches. */
function syncManagedRoute(net) {
  if (net.routingMode !== 'managed' || !net.branches) return;
  net.route = net.branches[0] ? net.branches[0].map((p) => ({ ...p })) : null;
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

function terminalSnapWorld(point) {
  const hit = nearestTerminal(point, { anyDistance: true });
  return hit ? { x: hit.x, y: hit.y } : snappedWorld(point);
}

function cursorWorld(point) {
  return wire && terminalSnap ? terminalSnapWorld(point) : snappedWorld(point);
}

function connectTwo(src, dst, points) {
  const before = snapshot();
  const meet = circuit.components.get(dst.refdes).terminalWorld(dst.term);
  const net = circuit.wireTo(`${src.refdes}.${src.term}`, meet, points, wireRouteOptions());
  markModelChanged(); // wireTo grew / spliced a net
  recordHistoryEntry(before, false);
  // Stay in wiring mode so the next click can start another connection.
  wire = newWireDraft();
  // Like every wire commit, highlight the net; the target pin's component is
  // not selected.
  setSelection([]);
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
  const directKind = directWire?.routeMode === 'diagonal' ? 'diagonal' : 'fixed';
  try {
    const net = circuit.wireDirectTo(
      `${directWire.source.refdes}.${directWire.source.term}`,
      `${dst.refdes}.${dst.term}`,
      directWire.points,
    );
    recordHistoryEntry(before);
    markModelChanged();
    directWire = { source: null, points: [] };
    setSelection([]);
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
  return directWire?.routeMode === 'diagonal' ? 'DIAGONAL WIRE' : 'FIXED WIRE';
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
        joinWireToNet(wireHit, target);
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
    markModelChanged();
    recordHistoryEntry(before, false);
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
  // Commit the same centered route shown in the preview, even when the user
  // did not click an explicit waypoint. Passing no waypoints would make
  // Circuit#wireTo autoroute the connection a second time with its defaults.
  const draftPath = draftRoutePath(wire, end);
  if (!draftPath || draftPath.length < 2) {
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
  markModelChanged(); // a draft spliced into the target net
  recordHistoryEntry(before, false);
  wire = newWireDraft();
  selectedNets = new Set([net.id]);
  logLine(`wired into net ${net.id} at ${dst.refdes}.${dst.term}; len=${net.length()}`);
}

/** Join the draft wire into an existing net at the cursor's point on that net's
 *  route. Junction solder dots are derived from the resulting geometry. */
function joinWireToNet(wireHit, selectedTarget = null) {
  const src = wire.source;
  let targetIdentity = selectedTarget;
  let P;
  let k;
  if (targetIdentity) {
    if (targetIdentity.netId !== wireHit.net.id || targetIdentity.pathIndex !== wireHit.branch) {
      logLine('wire target must be on the selected wire');
      return;
    }
    P = targetIdentity.point;
    k = targetIdentity.segmentIndex - 1;
  } else if (wire.routeStyle === 'diagonal') {
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
    if (k >= 0) targetIdentity = {
      netId: wireHit.net.id,
      pathIndex: wireHit.branch,
      segmentIndex: k + 1,
      point: { ...P },
    };
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
  markModelChanged(); // a draft joined into an existing net
  recordHistoryEntry(before, false);
  wire = newWireDraft();
  selectedNets = new Set([net.id]);
  logLine(`joined into net ${net.id} at (${P.x},${P.y})`);
}

function managedWireDragAt(wireHit, startWorld, startClient, ev, modal = false) {
  // A diagonal segment moves rigidly on its own; orthogonal runs keep the
  // sideways run drag below and never carry selected diagonal segments.
  if (diagonalSegmentDragAt(wireHit, startWorld, startClient, ev, { modal })) return true;
  const startSnapshot = snapshot();
  const sourceNetId = wireHit.net.id;
  const key = `${sourceNetId}:${wireHit.branch}:${wireHit.seg}`;
  const moveKeys = ev.shiftKey || selectedWires.has(key)
    ? new Set([...selectedWires, key])
    : new Set([key]);
  for (const selectedKey of [...moveKeys]) if (isDiagonalWireKey(selectedKey)) moveKeys.delete(selectedKey);
  const runs = [];
  beginPreviewTransaction(startSnapshot);
  const net = circuit.nets.get(sourceNetId);
  if (!net) {
    cancelPreviewTransaction();
    return false;
  }
  const previewPath = net.paths()[wireHit.branch] || net.paths()[0];
  wireHit = { ...wireHit, net, pts: previewPath };
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
      allowPastNeighbors: true,
      preserveDiagonalNeighbors: true,
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
  if (!primary) {
    cancelPreviewTransaction();
    return false;
  }
  const dragRuns = runs.filter((r) => r.orient === primary.orient);
  const netSnapshots = captureRunNetGeometry(dragRuns);
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
    startSnapshot,
    netSnapshots,
  };
  render();
  return true;
}

function canvasMouseDown(ev) {
  if (analysisPick && ev.button === 0) {
    ev.preventDefault();
    completeAnalysisPick(clientToWorld(ev.clientX, ev.clientY));
    return;
  }
  if (document.activeElement === cmdInput) cmdInput.blur();
  const b = ev.button;
  const rawStartWorld = clientToWorld(ev.clientX, ev.clientY);
  const startWorld = b === 0 && wire && terminalSnap ? terminalSnapWorld(rawStartWorld) : rawStartWorld;
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
    const hit = pickAt(startWorld);
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
  const blockHandle = ev.target.closest?.('[data-component-handle]');
  if (blockHandle) {
    const refdes = blockHandle.closest?.('[data-component-resize-id]')?.dataset.componentResizeId;
    const component = refdes && circuit.components.get(refdes);
    if (component?.type === 'block') {
      const origin = component.bboxWorld();
      setSelection([refdes]);
      setLabelSelection([]);
      drag = {
        mode: 'blockresize', refdes, handle: blockHandle.dataset.componentHandle,
        startWorld, startClient, origin, startSnapshot: snapshot(), moved: false,
      };
      try { canvasEl.setPointerCapture?.(ev.pointerId); } catch {}
      render();
      return;
    }
  }
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
    drag.shift = ev.shiftKey;
    const point = constrainedWorld(drag.startWorld, startWorld, ev.shiftKey);
    cursor = snappedWorld(point);
    moveCopyGhost(point);
    commitCopyGhost();
    return;
  }
  // Modal move/copy destination clicks must win over object picking. This
  // keeps a destination on a label, wire, or terminal from being treated as a
  // new source.
  if (drag?.modal && (movePending || copyPending)) {
    drag.commitPoint = { world: { ...startWorld }, client: { ...startClient } };
    drag.shift = ev.shiftKey;
    const point = constrainedWorld(drag.startWorld, startWorld, ev.shiftKey);
    drag.commitPoint.world = { ...point };
    cursor = snappedWorld(point);
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
    // With an active managed draft, an interior-wire click is another route
    // point. Without a draft, leave it to normal picking so wire clicks still
    // select and drag editable segments.
    if (wire.source && !terminalHit && wireHit) {
      drag = { mode: 'wirepick', startClient, startWorld, rubber: null };
      return;
    }
    // Defer a managed interior-wire click until mouseup. A stationary click
    // starts a draft on that wire; a real drag falls through to segment editing.
    if (!wire.source && !terminalHit && wireHit && wireHit.net.routingMode === 'managed') {
      drag = { mode: 'wirepick', startClient, startWorld, rubber: null, wireHit };
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
      beginPreviewTransaction(before);
      const previewHitNet = circuit.nets.get(moveWireHit.net.id);
      if (!previewHitNet) {
        cancelPreviewTransaction();
        return;
      }
      const previewHit = { ...moveWireHit, net: previewHitNet };
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
      if (detachedKeys.size && floatingWireDragAt(previewHit, startWorld, startClient, ev, detachedKeys)) {
        drag.startSnapshot = before;
        drag.modal = true;
        movePending = true;
        return;
      }
      cancelPreviewTransaction();
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
    const moveHit = pickAt(startWorld);
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
    if (!isSelectionModifier(ev)) {
      setSelection([]);
      setLabelSelection([annotationText.id]);
    }
    if (isSelectionModifier(ev)) {
      applyEditorSelection({ kind: 'label', id: annotationText.id }, true);
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
    if (isSelectionModifier(ev)) {
      applyEditorSelection({ kind: 'label', id: annotationGeometry.id }, true);
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
    cursor = snappedWorld(placementWorld(startWorld, ev.shiftKey));
    commit(() => placePending());
    render();
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
    if (isSelectionModifier(ev)) {
      applyEditorSelection({ kind: 'label', id: labelHit.id }, true);
      render();
      return;
    }
    const selectedMember = selLabels.has(labelHit.id);
    const duplicateLabel = false;
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
  const componentHit = hit?.refdes ? circuit.components.get(hit.refdes) : null;
  if (componentHit && !termHit) {
    const now = Date.now();
    const previous = lastSchematicComponentClick;
    const doubleClick = ev.detail >= 2 || (previous && previous.refdes === componentHit.refdes &&
      now - previous.at < 500 && Math.abs(startWorld.x - previous.x) <= GRID &&
      Math.abs(startWorld.y - previous.y) <= GRID);
    lastSchematicComponentClick = { refdes: componentHit.refdes, x: startWorld.x, y: startWorld.y, at: now };
    if (doubleClick) {
      lastSchematicComponentClick = null;
      setSelection([componentHit.refdes]);
      setLabelSelection([]);
      render();
      // The canvas SVG is regenerated during the click sequence, so defer the
      // editor until mouseup has finished. This fallback also covers drivers
      // that do not dispatch a native `dblclick` after the SVG replacement.
      setTimeout(() => openComponentChildLabelEditor(componentHit), 0);
      return;
    }
  } else {
    lastSchematicComponentClick = null;
  }
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
      const floatingKeys = isSelectionModifier(ev) || selectedWires.has(floatingKey)
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
      drag.fixedShift = isSelectionModifier(ev);
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
    if (!isSelectionModifier(ev) && diagonalSegmentDragAt(wireHit, startWorld, startClient, ev, { doubleWireClick })) return;
    const moveKeys = isSelectionModifier(ev) || selectedWires.has(key)
      ? new Set([...selectedWires, key])
      : new Set([key]);
    for (const selectedKey of [...moveKeys]) if (isDiagonalWireKey(selectedKey)) moveKeys.delete(selectedKey);
    if (!moveKeys.size) {
      // Shift-clicking a diagonal toggles it in the selection without a drag.
      if (selectedWires.has(key)) selectedWires.delete(key);
      else selectedWires.add(key);
      syncSelectedWire();
      render();
      return;
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
        // This is a reversible preview.  The pointer must be able to carry
        // the run through intermediate overlaps; the final geometry is
        // checked when the gesture is released.
        allowPastNeighbors: true,
        preserveDiagonalNeighbors: true,
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
    const netSnapshots = captureRunNetGeometry(dragRuns);
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
  const startSnapshot = snapshot();
  // Copy mode owns its own paste transaction. Normal connected/detached moves
  // get an isolated preview document from the first pointer down instead.
  if (!options.duplicate) beginPreviewTransaction(startSnapshot);
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
    startSnapshot,
  };
  movePending = !!options.modal;
  render();
}

/** Select the component (or shift-toggle the multi-selection) and arm a move
 *  drag. Shared by exact-terminal hits and bbox fallback picks. */
function beginComponentDrag(hit, startWorld, startClient, ev, options = {}) {
  cursor = { x: snap(startWorld.x), y: snap(startWorld.y) };
  if (isSelectionModifier(ev)) {
    applyEditorSelection({ kind: 'component', id: hit.refdes }, true);
    render();
    return;
  }
  // A click on an existing member confirms the complete mixed selection;
  // clicking a new component starts a component-only selection.
  const refs = multi.has(hit.refdes) ? [...multi] : [hit.refdes];
  const labels = multi.has(hit.refdes) ? [...selLabels] : [];
  beginObjectMove(refs, labels, startWorld, startClient, { duplicate: false, detached: options.detached });
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
    ...captureRouteGeometry(net),
    fixedPaths: net.routingMode === 'fixed' ? cloneFixedPaths(net.fixedPaths) : null,
    // Segment styles are keyed by route position. A component drag restores
    // this geometry before each preview reroute, so restore the styles with
    // it or a previous preview's endpoint arrowhead can be read as the wrong
    // logical endpoint on the next mousemove.
    wireStyles: Object.fromEntries(Object.entries(net.wireStyles || {}).map(([key, style]) => [key, { ...style }])),
  };
}
/** One route snapshot per distinct net behind a set of dragged wire runs. */
function captureRunNetGeometry(runs) {
  const snapshots = new Map();
  for (const run of runs) {
    if (snapshots.has(run.net.id)) continue;
    snapshots.set(run.net.id, {
      id: run.net.id,
      net: run.net,
      ...captureRouteGeometry(run.net),
      wireStyles: Object.fromEntries(Object.entries(run.net.wireStyles || {}).map(([key, style]) => [key, { ...style }])),
    });
  }
  return snapshots;
}

function snappedDragDelta(startWorld, currentWorld) {
  return {
    dx: snap(currentWorld.x - startWorld.x),
    dy: snap(currentWorld.y - startWorld.y),
  };
}

function translateNetGeometry(net, saved, dx, dy) {
  const move = (p) => ({ x: p.x + dx, y: p.y + dy });
  Object.assign(net, captureRouteGeometry(saved, move));
  if (net.routingMode === 'fixed' && saved.fixedPaths) net.fixedPaths = cloneFixedPaths(saved.fixedPaths, move);
  if (saved.wireStyles) {
    net.wireStyles = Object.fromEntries(Object.entries(saved.wireStyles).map(([key, style]) => [key, { ...style }]));
  }
}

function armModalLabelMove(label, startWorld, startClient) {
  const startSnapshot = snapshot();
  beginPreviewTransaction(startSnapshot);
  label = circuit.labels.get(label.id) || label;
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
    startSnapshot,
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
    markModelChanged();
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
  markModelChanged();
}

function commitModalMove() {
  if (!drag?.modal) return false;
  if (drag.mode === 'labelmove') {
    if (drag.moved && previewTransaction && snapshot() !== drag.startSnapshot) {
      recordHistoryEntry(drag.startSnapshot);
      commitPreviewTransaction();
    } else if (previewTransaction) {
      cancelPreviewTransaction();
    }
    drag = null;
    movePending = false;
    render();
    return true;
  }
  const point = drag.commitPoint || (() => {
    const world = constrainedWorld(drag.startWorld, cursor, drag.shift);
    return { world, client: worldToClient(world.x, world.y) };
  })();
  if (drag.mode === 'diagonalseg') {
    canvasMouseMove({ clientX: point.client.x, clientY: point.client.y, shiftKey: drag.shift });
    drag.modal = false;
    drag.moved = true;
    finishDiagonalSegmentDrag();
    movePending = false;
    return true;
  }
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
  if (drag.moved) {
    finishMoveMutation(drag);
    if (previewTransaction) {
      if (snapshot() !== drag.startSnapshot) recordHistoryEntry(drag.startSnapshot, true, 'none');
      commitPreviewTransaction();
    }
  } else {
    cancelPreviewTransaction();
  }
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
    const hit = pickAt(startWorld);
    if (annotation) {
      setLabelSelection([annotation.id]);
    } else if (label?.netId) {
      setLabelSelection([label.id]);
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
  const hitComp = pickAt(world);
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
    markModelChanged();
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

function updateCursorFromEvent(ev) {
  const pane = document.querySelector('.canvas-pane');
  const { world: w } = worldAndCursorFromClient(
    ev.clientX, ev.clientY, pane.getBoundingClientRect(), view,
  );
  const nextCursor = cursorWorld(w);
  const cursorChanged = nextCursor.x !== cursor.x || nextCursor.y !== cursor.y;
  cursor = nextCursor;
  return { w, cursorChanged };
}

function constrainedWorld(start, current, shiftKey) {
  return constrainAxis(start, current, shiftKey);
}

function snappedWorld(point) {
  return { x: snap(point.x), y: snap(point.y) };
}

function placementWorld(current, shiftKey) {
  return pendingPlace?.startWorld
    ? constrainedWorld(pendingPlace.startWorld, current, shiftKey)
    : current;
}

function canvasMouseMove(ev) {
  const { w, cursorChanged } = updateCursorFromEvent(ev);

  if (!drag) {
    // The cursor follows the mouse, always snapped to the nearest grid point.
    // The view never pans on its own — pan manually with the middle button.
    const point = mode === 'insert' && pendingPlace ? placementWorld(w, ev.shiftKey) : w;
    const nextCursor = cursorWorld(point);
    const changed = nextCursor.x !== cursor.x || nextCursor.y !== cursor.y;
    cursor = nextCursor;
    if (cursorChanged || changed) scheduleInteractionRender();
    return;
  }

  const movedOut = dragMoved(drag.startWorld, drag.startClient, w, ev);
  const movedWorld = constrainedWorld(drag.startWorld, w, ev.shiftKey);
  if (drag.modal) drag.shift = ev.shiftKey;
  if (movedOut) lastSchematicComponentClick = null;
  if (drag.mode === 'blockresize') {
    if (!movedOut) return;
    drag.moved = true;
    try {
      // Rebuild each preview from the immutable pointer-down snapshot. This
      // keeps corner drags reversible and avoids accumulating grid rounding.
      circuit = loadDocument(JSON.parse(drag.startSnapshot));
      const rect = blockResizeRect(drag.origin, drag.handle, movedWorld);
      circuit.resizeBlock(drag.refdes, rect);
      drag.invalid = false;
      drag.previewRevision = (drag.previewRevision || 0) + 1;
      renderCanvas(`${modelRevision}:blockresize:${drag.previewRevision}`);
    } catch (error) {
      circuit = loadDocument(JSON.parse(drag.startSnapshot));
      drag.invalid = true;
      drag.invalidReason = error.message;
      drag.previewRevision = (drag.previewRevision || 0) + 1;
      renderCanvas(`${modelRevision}:blockresize:${drag.previewRevision}`);
    }
    return;
  }
  if (drag.mode === 'diagonalseg') {
    if (movedOut || drag.modal) drag.moved = drag.moved || movedOut;
    if (drag.moved) updateDiagonalSegmentDrag(movedWorld);
    scheduleInteractionRender();
    return;
  }
  if (drag.mode === 'wirepick' && drag.wireHit && movedOut) {
    const hit = drag.wireHit;
    if (hit.net.terminals.length === 0 && floatingWireDragAt(hit, drag.startWorld, drag.startClient, ev, new Set([`${hit.net.id}:${hit.branch}:${hit.seg}`]))) {
      canvasMouseMove(ev);
    } else if (managedWireDragAt(hit, drag.startWorld, drag.startClient, ev, false)) {
      canvasMouseMove(ev);
    } else {
      drag = null;
    }
    return;
  }
  if (drag.mode === 'annotationlineplace') {
    if (movedOut) drag.moved = true;
    drag.previewEnd = snappedWorld(movedWorld);
    cursor = { ...drag.previewEnd };
    scheduleInteractionRender();
    return;
  }
  if (drag.mode === 'annotationplace') {
    if (movedOut) drag.moved = true;
    if (annotationStart || drag.moved) {
      drag.previewEnd = snappedWorld(movedWorld);
      cursor = { ...drag.previewEnd };
      scheduleInteractionRender();
    }
    return;
  }
  if (drag.mode === 'annotationtextmove') {
    if (movedOut) drag.moved = true;
    if (drag.moved) {
      const dx = snap(movedWorld.x) - snap(drag.startWorld.x);
      const dy = snap(movedWorld.y) - snap(drag.startWorld.y);
      drag.label.textAnchor = { x: drag.startText.x + dx, y: drag.startText.y + dy };
      cursor = { ...drag.label.textAnchor };
      markModelChanged(false);
      scheduleInteractionRender();
    }
    return;
  }
  if (drag.mode === 'annotationsegment') {
    if (movedOut) drag.moved = true;
    if (drag.moved) {
      const dx = snap(movedWorld.x) - snap(drag.startWorld.x);
      const dy = snap(movedWorld.y) - snap(drag.startWorld.y);
      drag.label.points = drag.startPoints.map((point) => ({ ...point }));
      drag.label.moveSegment(drag.segment, dx, dy);
      cursor = { ...cursor };
      markModelChanged(false);
      scheduleInteractionRender();
    }
    return;
  }
  if (drag.mode === 'annotationendpoint') {
    if (movedOut) drag.moved = true;
    if (drag.moved) {
      const point = snappedWorld(movedWorld);
      moveAnnotationEndpoint(drag.label, drag.endpoint, point);
      cursor = point;
      markModelChanged(false);
      scheduleInteractionRender();
    }
    return;
  }
  if (drag.mode === 'copyghost') {
    drag.moved = movedOut || drag.moved;
    drag.shift = ev.shiftKey;
    moveCopyGhost(movedWorld);
    scheduleInteractionRender();
    return;
  }

  if (drag.mode === 'pan') {
    // Map the pointer back against the mousedown view (startView) so the pan
    // delta equals the raw pointer movement — no feedback from prior moves.
    const p = clientToWorld(ev.clientX, ev.clientY, drag.startView);
    view.x = drag.startView.x - (p.x - drag.startWorld.x);
    view.y = drag.startView.y - (p.y - drag.startWorld.y);
    scheduleInteractionRender();
    return;
  }

  if (drag.mode === 'zoom' || drag.mode === 'marquee' || drag.mode === 'deletemarquee') {
    if (movedOut) drag.moved = true;
    const r = worldRect(drag.startWorld, w);
    drag.rubber = { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1, color: drag.mode === 'zoom' ? 'neutral' : undefined };
    if (!movedOut) drag.rubber = null;
    scheduleInteractionRender();
    return;
  }

  if (drag.mode === 'wireseg') {
    if (movedOut) drag.moved = true;
    if (drag.moved) {
      cursor = snappedWorld(movedWorld);
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
      const axis = drag.orient === 'h' ? movedWorld.y : movedWorld.x;
      const delta = axis - drag.startAxis;
      for (const r of drag.runs) {
        const target = r.startLine + delta;
        moveManagedWireRun(r, target);
      }
      markModelChanged(); // live re-route changes wire geometry every frame
      scheduleInteractionRender();
    }
    return;
  }

  if (drag.mode === 'floatingwire') {
    if (movedOut) drag.moved = true;
    if (drag.moved) {
      const dx = snap(movedWorld.x) - snap(drag.startWorld.x);
      const dy = snap(movedWorld.y) - snap(drag.startWorld.y);
      for (const f of drag.fragments) {
        const points = f.orig.map((p) => ({ x: p.x + dx, y: p.y + dy }));
        if (f.fixed) f.net.fixedPaths[f.branch].points = points;
        else {
          if (f.net.branches?.[f.branch]) f.net.branches[f.branch] = points;
          if (f.branch === 0) f.net.route = points;
        }
      }
      cursor = snappedWorld(movedWorld);
      markModelChanged();
    }
    scheduleInteractionRender();
    return;
  }

  if (drag.mode === 'fixedwire') {
    if (movedOut) drag.moved = true;
    if (drag.moved) {
      const dx = snap(movedWorld.x) - snap(drag.startWorld.x);
      const dy = snap(movedWorld.y) - snap(drag.startWorld.y);
      for (const [net, saved] of drag.fixedSnapshots) {
        net.fixedPaths = cloneFixedPaths(saved.fixedPaths);
        net.junctions = clonePoints(saved.junctions);
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
      cursor = snappedWorld(movedWorld);
      markModelChanged();
      scheduleInteractionRender();
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
          recordHistoryEntry(snapshot(), true, 'defer');
        }
        drag.committed = true;
      }
      const delta = snappedDragDelta(drag.startWorld, movedWorld);
      moveLabelOriginsOnce(drag.startAnchors, delta.dx, delta.dy);
      const primary = circuit.labels.get(drag.labelId);
      if (primary) {
        const a = primary.anchorWorld();
        cursor = { x: a.x, y: a.y };
      }
      markModelChanged(false);
    }
    scheduleInteractionRender();
    return;
  }
  if (drag.mode === 'move') {
    if (movedOut) drag.moved = true;
    if (drag.moved) {
      const moved = new Map();
      if (!drag.committed) {
        if (drag.duplicate) {
          // Paste at the selection anchor so the whole gesture stays atomic.
          copySelection();
          const anchor = clipboard?.anchor;
          if (anchor) {
            cursor = { ...anchor };
            pasteClipboard();
          }
          drag.origins = new Map(selectedComps().map((c) => [c.refdes, { x: c.transform.x, y: c.transform.y }]));
          drag.labelOrigins = new Map(selectedLabels().map((l) => [l.id, { x: l.anchorWorld().x, y: l.anchorWorld().y }]));
          logLine('duplicated selection — dragging the copy');
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
      const delta = snappedDragDelta(drag.startWorld, movedWorld);
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
        moveLabelOriginsOnce(new Map([...drag.labelOrigins].filter(([id]) => {
          const label = circuit.labels.get(id);
          return label && !label.owner && !label.netId;
        })), delta.dx, delta.dy);
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
      markModelChanged();
    }
    scheduleInteractionRender();
    return;
  }
}

function canvasMouseUp(ev) {
  if (!drag) return;
  const releaseWorld = clientToWorld(ev.clientX, ev.clientY);
  const movedOut = dragMoved(drag.startWorld, drag.startClient, releaseWorld, ev);
  const w = wire && terminalSnap ? terminalSnapWorld(releaseWorld) : releaseWorld;
  const movedWorld = constrainedWorld(drag.startWorld, w, ev.shiftKey);
  if (drag.mode === 'blockresize') {
    if (drag.moved && !drag.invalid && snapshot() !== drag.startSnapshot) {
      recordHistoryEntry(drag.startSnapshot);
      markModelChanged();
      logLine(`resized ${drag.refdes}`);
    } else if (drag.invalid || !drag.moved) {
      circuit = loadDocument(JSON.parse(drag.startSnapshot));
    }
    drag = null;
    render();
    return;
  }
  if (drag.mode === 'pan') {
    if (ev.button !== 1 && drag.pointerId !== ev.pointerId && ev.pointerType === 'mouse') return;
    drag = drag.resume || null;
    render();
    return;
  }
  if (drag.mode === 'copyghost') {
    render();
    return;
  }

  if (drag.mode === 'diagonalseg') {
    if (drag.modal) {
      render();
      return;
    }
    finishDiagonalSegmentDrag();
    return;
  }
  // Repaints replace the SVG beneath the pointer while a wire is being
  // dragged, so the final mousemove can be missed. Apply the release point
  // once more before validating; otherwise a legal drop beyond an obstacle
  // can be rejected using the last intermediate overlap instead.
  if (drag.mode === 'wireseg' && !drag.modal && movedOut) canvasMouseMove(ev);
  if (drag.mode === 'zoom') {
    if (drag.moved) zoomToWorldRect(worldRect(drag.startWorld, w));
  } else if (drag.mode === 'wireseg') {
    if (drag.modal) {
      render();
      return;
    }
    const anyMoved = drag.runs.some((r) => JSON.stringify(r.pts) !== JSON.stringify(r.orig));
    if (!drag.moved || !anyMoved) {
      cancelPreviewTransaction();
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
        // A segment drag can collapse a corner, changing the segment indexes
        // that carry endpoint arrowheads. Re-anchor from the pointer-down
        // geometry before rerouting/reducing the edited path, otherwise the
        // head can remain on a removed segment and disappear.
        const saved = drag.netSnapshots?.get(id);
        if (saved?.wireStyles) {
          net.wireStyles = Object.fromEntries(
            Object.entries(saved.wireStyles).map(([key, style]) => [key, { ...style }]),
          );
          const previousPaths = saved.branches || (saved.route ? [saved.route] : []);
          circuit._reanchorWireArrowheads(net, previousPaths, net.paths(), saved.wireStyles);
        }
        if (!literalNets.has(id)) {
          rerouteNet(net); // re-anchor ordinary terminal legs
        }
        circuit._reduceNet(net); // merge any run dragged onto a same-net wire
        if (literalNets.has(id)) syncManagedRoute(net);
        for (const expected of expectedJunctions.get(id) || []) {
          const point = expected.point;
          const moved = point.x !== expected.from.x || point.y !== expected.from.y;
          if (!moved) continue;
          // moveManagedJunction may insert a conformity elbow, so the edited
          // endpoint is not necessarily the final junction coordinate. The
          // helper owns that topology update; only reject a pin collision.
          if ([...circuit.components.values()].some((c) => c.worldTerminals().some((t) => t.x === point.x && t.y === point.y))) {
            throw new Error(`managed bridge junction landed on a component pin on ${id}`);
          }
        }
      }
      circuit.syncJunctionSolders();
      // Cross-net collinear overlap is an electrical violation that is never
      // merged: a drop that creates one is rejected, not committed.
      const collision = newCrossNetOverlap(drag.startSnapshot, touchedNets);
      if (collision) throw new Error(`the wire would overlap net ${collision}`);
      const bodyViolation = newWireBodyViolation(drag.startSnapshot, touchedNets);
      if (bodyViolation) throw new Error(bodyViolation);
      if (snapshot() !== drag.startSnapshot) {
        markModelChanged(); // committed wire drag changed net geometry
        recordHistoryEntry(drag.startSnapshot, true, 'none');
        commitPreviewTransaction();
      } else {
        cancelPreviewTransaction();
      }
    } catch (err) {
      // Plain wire drags edit the live document (no preview clone), so
      // discarding a preview alone would keep the rejected geometry.
      if (previewTransaction) cancelPreviewTransaction();
      else {
        circuit = Circuit.fromJSON(JSON.parse(drag.startSnapshot));
        markModelChanged();
      }
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
      cancelPreviewTransaction();
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
      if (snapshot() !== drag.startSnapshot) {
        markModelChanged();
        recordHistoryEntry(drag.startSnapshot, true, 'none');
        commitPreviewTransaction();
      } else {
        cancelPreviewTransaction();
      }
    }
  } else if (drag.mode === 'fixedwire') {
    if (drag.modal) {
      render();
      return;
    }
    if (!drag.moved) {
      cancelPreviewTransaction();
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
        recordHistoryEntry(drag.startSnapshot, true, 'none');
        markModelChanged();
        logLine(drag.junction >= 0 ? 'moved fixed junction dot' : 'moved fixed wire geometry');
        commitPreviewTransaction();
      } else {
        cancelPreviewTransaction();
        logLine('fixed endpoint has no movable geometry');
      }
    }
  } else if (drag.mode === 'fixedendpoint') {
    if (!drag.moved) {
      cancelPreviewTransaction();
      const path = drag.net.paths()[drag.endpoint.pathIndex];
      const segment = drag.endpoint.endpointIndex === 0 ? 1 : path.length - 1;
      setSelection([]);
      selectedWires = new Set([`${drag.net.id}:${drag.endpoint.pathIndex}:${segment}`]);
      syncSelectedWire();
      selectedNets.clear();
    } else {
      const point = snappedWorld(movedWorld);
      const terminalHits = sortedComps().flatMap((c) => c.worldTerminals()
        .filter((t) => t.x === point.x && t.y === point.y)
        .map((t) => ({ refdes: c.refdes, term: t.name })));
      let target = null;
      if (terminalHits.length === 1) target = `${terminalHits[0].refdes}.${terminalHits[0].term}`;
      else if (terminalHits.length > 1) logLine('fixed endpoint target is ambiguous — choose one terminal');
      else {
        const wireTarget = exactWireTargetAt(movedWorld, null, drag.endpoint);
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
        recordHistoryEntry(drag.startSnapshot, true, 'none');
        markModelChanged();
        logLine(target ? 'attached fixed endpoint' : 'moved fixed endpoint');
        commitPreviewTransaction();
      } else {
        cancelPreviewTransaction();
      }
    }
  } else if (drag.mode === 'labelmove') {
    if (drag.modal) {
      if (!drag.moved) {
        render();
        return;
      }
      drag.modal = false;
    }
    if (drag.moved && previewTransaction && snapshot() !== drag.startSnapshot) {
      recordHistoryEntry(drag.startSnapshot);
      commitPreviewTransaction();
    } else if (previewTransaction) {
      cancelPreviewTransaction();
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
      recordHistoryEntry(drag.startSnapshot);
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
      recordHistoryEntry(drag.startSnapshot);
    }
  } else if (drag.mode === 'wirepick') {
    if (!movedOut) {
      const clicked = { x: snap(w.x), y: snap(w.y) };
      doWireClick(clicked.x, clicked.y, drag.terminalHit, drag.fixedEndpoint, drag.fixedTarget);
    }
  } else if (drag.mode === 'directpick') {
    if (!movedOut) doDirectWireClick(snap(w.x), snap(w.y), drag.fixedEndpoint);
  } else if (drag.mode === 'annotationplace') {
    if (drag.moved) {
      if (!annotationStart) annotationStart = { x: snap(drag.startWorld.x), y: snap(drag.startWorld.y) };
      placeShapeAnnotation(movedWorld, snappedWorld(movedWorld));
    } else {
      placeShapeAnnotation(w);
    }
  } else if (drag.mode === 'labelplace') {
    if (!movedOut) {
      if (labelMode === 'net') placeNetLabelAt(w);
      else if (labelMode === 'annotation') placeAnnotationAt(w);
      else if (labelMode === 'equation') placeEquationAt(w);
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
    if (drag.moved) {
      finishMoveMutation(drag);
      if (previewTransaction) {
        if (snapshot() !== drag.startSnapshot) recordHistoryEntry(drag.startSnapshot);
        commitPreviewTransaction();
      }
    } else {
      cancelPreviewTransaction();
    }
  }
  drag = null;
  render();
}
canvasEl.addEventListener('mousedown', canvasMouseDown);
canvasEl.addEventListener('mousemove', canvasMouseMove);
canvasEl.addEventListener('pointermove', canvasMouseMove);

// SVG objects are keyboard-addressable even though the committed scene is
// regenerated during edits.  The semantic hit is resolved from data-* attrs,
// then routed through the same role-aware selection state as pointer clicks.
canvasEl.addEventListener('keydown', (ev) => {
  if (!['Enter', ' '].includes(ev.key)) return;
  const target = ev.target?.closest?.('[data-ref],[data-label-id],[data-net-id]');
  if (!target) return;
  const refdes = target.dataset.ref;
  const labelId = target.dataset.labelId;
  const netId = target.dataset.netId;
  if (refdes && circuit.components.has(refdes)) {
    setSelection([refdes]);
    setLabelSelection([]);
    const component = circuit.components.get(refdes);
    cursor = { x: component.transform.x, y: component.transform.y };
    announce(`Selected component ${refdes}, ${component.type}`);
  } else if (labelId && circuit.labels.has(labelId)) {
    setSelection([]);
    setLabelSelection([labelId]);
    const label = circuit.labels.get(labelId);
    cursor = label.anchorWorld();
    announce(`Selected ${label.owner ? 'instance label' : label.netId ? 'net label' : 'annotation'} ${label.text}`);
  } else if (netId && circuit.nets.has(netId)) {
    setSelection([]);
    setLabelSelection([]);
    selectedNets = new Set([netId]);
    const net = circuit.nets.get(netId);
    const point = net.points()[0];
    if (point) cursor = { ...point };
    announce(`Selected net ${net.name || netId}`);
  }
  render();
  ev.preventDefault();
  ev.stopPropagation();
});

// Pointer Events provide capture and cancellation for pen/touch.  Mouse
// compatibility events continue to support existing automation and browsers.
canvasEl.addEventListener('pointerdown', (ev) => {
  if (ev.pointerType === 'mouse' || !isPrimaryPointerEvent(ev)) return;
  if (shouldPanTouch({ pointerType: ev.pointerType, hasHit: hasSelectableObjectAt(clientToWorld(ev.clientX, ev.clientY)), mode })) {
    const startClient = { x: ev.clientX, y: ev.clientY };
    drag = { mode: 'pan', pointerId: ev.pointerId, startClient, startWorld: clientToWorld(ev.clientX, ev.clientY), startView: { ...view }, rubber: null, resume: drag };
    canvasEl.setPointerCapture?.(ev.pointerId);
    ev.preventDefault();
    return;
  }
  canvasMouseDown(ev);
  canvasEl.setPointerCapture?.(ev.pointerId);
});
window.addEventListener('pointerup', (ev) => {
  if (ev.pointerType === 'mouse') return;
  canvasMouseUp(ev);
  if (ev.pointerId !== undefined) canvasEl.releasePointerCapture?.(ev.pointerId);
});
window.addEventListener('pointercancel', (ev) => {
  if (ev.pointerType === 'mouse') return;
  cancelDrag();
  if (ev.pointerId !== undefined) canvasEl.releasePointerCapture?.(ev.pointerId);
});
// Replacing the SVG during a repaint can move the pointer off the old target
// before the bubbling event reaches the canvas. Feed that event through the
// same cursor/preview path used by both document kinds.
function forwardCanvasMove(ev) {
  if (!shouldForwardCanvasMove(ev.target, canvasEl)) return;
  const r = document.querySelector('.canvas-pane')?.getBoundingClientRect();
  if (!r || ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) return;
  canvasMouseMove(ev);
}
window.addEventListener('pointermove', forwardCanvasMove, true);
window.addEventListener('mousemove', forwardCanvasMove, true);
canvasEl.addEventListener('mouseenter', () => {
  cursorInCanvas = true;
  scheduleInteractionRender();
});
canvasEl.addEventListener('mouseleave', () => {
  cursorInCanvas = false;
  scheduleInteractionRender();
});
function contextStyleValue(target, field) {
  if (target?.kind === 'wire') {
    const { net, branch, segment } = target.value;
    return wireStyleValue(net, `${branch}:${segment}`, field);
  }
  return target?.value?.style?.[field] || styleDefaults(field);
}

function contextTargetType(target) {
  return ['component', 'net'].includes(target.kind)
    ? target.kind
    : target.kind === 'wire' ? 'wire' : 'label';
}

function contextMatches(target, candidate, criterion) {
  if (criterion === 'type' && contextTargetType(target) !== contextTargetType(candidate)) return false;
  if (criterion === 'type') {
    if (target.kind === 'component') return candidate.value.type === target.value.type;
    if (target.kind === 'net') return candidate.value.name === target.value.name;
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
  // A menu that is a pending question (e.g. the solder net-name choice)
  // treats any close without a pick as a cancellation.
  const dismiss = contextMenuDismiss;
  contextMenuDismiss = null;
  if (dismiss) dismiss();
  componentContextTarget = null;
  componentContextSubmenu = null;
  if (componentContextMenuEl) {
    componentContextMenuEl.hidden = true;
    componentContextMenuEl.classList.remove('analysis-attribute-menu', 'opens-left');
    componentContextMenuEl.replaceChildren();
  }
}

function contextCandidates(target, criterion) {
  if (criterion === 'color' || criterion === 'lineStyle') {
    return [
      ...[...circuit.components.values()].map((value) => ({ kind: 'component', value })),
      ...[...circuit.labels.values()]
        .filter((value) => value.selectable !== false)
        .map((value) => ({ kind: 'label', value })),
      ...wireCandidates(),
    ];
  }
  if (target.kind === 'component') {
    return [...circuit.components.values()].map((value) => ({ kind: 'component', value }));
  }
  if (target.kind === 'label') {
    return [...circuit.labels.values()]
      .filter((value) => value.selectable !== false)
      .map((value) => ({ kind: 'label', value }));
  }
  if (target.kind === 'net') {
    return [...circuit.nets.values()].map((value) => ({ kind: 'net', value }));
  }
  return wireCandidates();
}

/** Every drawn wire segment as a context-menu candidate. */
function wireCandidates() {
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
  const nets = candidates.filter(({ kind }) => kind === 'net').map(({ value }) => value.id);
  const wires = candidates.filter(({ kind }) => kind === 'wire')
    .map(({ value }) => `${value.net.id}:${value.branch}:${value.segment}`);
  setSelection(refs, target.kind === 'component' ? target.value.refdes : refs[0], true);
  setLabelSelection(labels, target.kind === 'label' ? target.value.id : labels[0], true);
  if (target.kind === 'net') {
    selectedNets = new Set(nets);
    selectedWire = null;
  }
  selectedWires = new Set(wires);
  syncSelectedWire();
  closeComponentContextMenu();
  render();
}

function portNetIds(nets, type, role) {
  return nets
    .filter((net) => net.terminals?.some((terminal) => {
      const component = circuit.components.get(terminal.comp);
      return component?.type === type || component?.analysis?.role === role;
    }))
    .map((net) => net.id);
}

function fillAnalysisDialog(targetNetId) {
  if (!analysisTarget || !analysisReference) return;
  const nets = visibleNets();
  const defaults = analysisFormDefaults(nets, {
    targetNetId,
    componentInputNetIds: portNetIds(nets, 'input', 'input'),
    componentOutputNetIds: portNetIds(nets, 'output', 'output'),
  });
  analysisTarget.replaceChildren();
  for (const net of nets) {
    const option = document.createElement('option');
    option.value = net.id;
    option.textContent = analysisNetOptionText(net);
    analysisTarget.appendChild(option);
  }
  if (defaults.target) analysisTarget.value = defaults.target;

  analysisReference.replaceChildren();
  const automatic = document.createElement('option');
  automatic.value = '';
  automatic.textContent = 'Automatic AC reference (marker group)';
  analysisReference.appendChild(automatic);
  for (const net of nets) {
    const option = document.createElement('option');
    option.value = net.id;
    option.textContent = analysisNetOptionText(net);
    analysisReference.appendChild(option);
  }

  if (analysisInput) {
    analysisInput.replaceChildren();
    for (const net of nets) {
      const option = document.createElement('option');
      option.value = net.id;
      option.textContent = analysisNetOptionText(net);
      analysisInput.appendChild(option);
    }
    if (defaults.input) analysisInput.value = defaults.input;
  }
  return defaults;
}

function parseAnalysisList(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

let latestAnalysisReport = null;

function clearLatestAnalysisResult() {
  latestAnalysisReport = null;
  if (analysisResult) {
    analysisResult.hidden = true;
    if (analysisEquation) analysisEquation.replaceChildren();
    if (analysisDetails) analysisDetails.textContent = '';
    if (analysisNetlist) analysisNetlist.textContent = '';
    if (analysisNetlistPanel) analysisNetlistPanel.hidden = true;
  }
  if (analysisAnnotate) analysisAnnotate.hidden = true;
}

function analysisFormOptions() {
  return normalizeAnalysisOptions({
    neglectBodyEffect: !!analysisApproxBody?.checked,
    millerApproximation: !!analysisApproxMiller?.checked,
    parasitics: !!analysisParasitics?.checked,
    highIntrinsicGain: !!analysisApproxGmRo?.checked,
    neglectChannelLengthModulation: !!analysisApproxRo?.checked,
    dominantPole: !!analysisApproxDominantPole?.checked,
    deviceRegions: analysisDeviceRegions?.value || '',
  });
}

function analysisFormValues() {
  const { deviceRegions = {}, ...options } = analysisFormOptions();
  return {
    input: analysisInput?.value || '',
    output: analysisTarget?.value || '',
    reference: analysisReference?.value || '',
    acGrounds: analysisAcGrounds?.value || '',
    deviceRegions,
    options,
  };
}

function analysisDeviceOptions() {
  const devices = {};
  for (const component of sortedComps()) {
    if (!['nmos', 'pmos', 'nmosb', 'pmosb'].includes(component.type)) continue;
    const source = component.analysis || {};
    const options = {};
    if (typeof source.ignoreBodyEffect === 'boolean') options.neglectBodyEffect = source.ignoreBodyEffect;
    if (typeof source.gmroLarge === 'boolean') options.highIntrinsicGain = source.gmroLarge;
    if (source.channelLengthModulation === 'ignore') options.neglectChannelLengthModulation = true;
    if (source.channelLengthModulation === 'finite') options.neglectChannelLengthModulation = false;
    if (Object.keys(options).length) devices[component.refdes] = options;
  }
  return devices;
}

function migrateAnalysisFormStorage(previousName, nextName) {
  if (previousName === nextName) return;
  try {
    const fromKey = analysisFormStorageKey(previousName);
    const toKey = analysisFormStorageKey(nextName);
    const saved = localStorage.getItem(fromKey);
    if (saved && !localStorage.getItem(toKey)) localStorage.setItem(toKey, saved);
    if (saved) localStorage.removeItem(fromKey);
  } catch { /* storage unavailable */ }
}

/** Analysis settings belong to one document file; an unsaved document uses the "new" scope. */
function analysisFormScope() {
  return currentDocumentPath || '';
}

function persistAnalysisForm() {
  try { localStorage.setItem(analysisFormStorageKey(analysisFormScope()), JSON.stringify(analysisFormValues())); } catch { /* storage unavailable */ }
}

function restoreAnalysisForm(defaults = {}) {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(analysisFormStorageKey(analysisFormScope())) || 'null'); } catch { /* storage unavailable */ }
  if (!saved) {
    const options = analysisOptionDefaults();
    if (analysisReference) analysisReference.value = '';
    if (analysisAcGrounds) analysisAcGrounds.value = '';
    if (analysisDeviceRegions) analysisDeviceRegions.value = '';
    if (analysisApproxRo) analysisApproxRo.checked = options.neglectChannelLengthModulation;
    if (analysisApproxBody) analysisApproxBody.checked = options.neglectBodyEffect;
    if (analysisApproxMiller) analysisApproxMiller.checked = options.millerApproximation;
    if (analysisParasitics) analysisParasitics.checked = options.parasitics;
    if (analysisApproxGmRo) analysisApproxGmRo.checked = options.highIntrinsicGain;
    if (analysisApproxDominantPole) analysisApproxDominantPole.checked = options.dominantPole;
    return false;
  }
  const { state, diagnostics } = migrateAnalysisFormState(saved);
  for (const diagnostic of diagnostics) logLine(diagnostic.message, diagnostic.severity === 'error' ? 'error' : 'status');
  const setSelect = (el, value, force = false) => {
    if (!el || !value || ![...el.options].some((option) => option.value === value)) return;
    if (!force && value === '') return;
    el.value = value;
  };
  setSelect(analysisTarget, defaults.targetMarked ? defaults.target : state.output);
  setSelect(analysisReference, state.reference);
  setSelect(analysisInput, defaults.inputMarked ? defaults.input : state.input);
  if (analysisAcGrounds) analysisAcGrounds.value = pruneAnalysisNetValues(state.acGrounds, visibleNets());
  if (analysisDeviceRegions) {
    analysisDeviceRegions.value = formatAnalysisDeviceRegions(pruneAnalysisDeviceRegions(
      state.deviceRegions,
      sortedComps().map((component) => component.refdes),
    ));
  }
  if (analysisApproxRo) analysisApproxRo.checked = state.options.neglectChannelLengthModulation;
  if (analysisApproxBody) analysisApproxBody.checked = state.options.neglectBodyEffect;
  if (analysisApproxMiller) analysisApproxMiller.checked = state.options.millerApproximation;
  if (analysisParasitics) analysisParasitics.checked = state.options.parasitics;
  if (analysisApproxGmRo) analysisApproxGmRo.checked = state.options.highIntrinsicGain;
  if (analysisApproxDominantPole) analysisApproxDominantPole.checked = state.options.dominantPole;
  return true;
}

function prefillAnalysisAttributes() {
  const markedGrounds = visibleNets()
    .filter((net) => net.analysis?.acGround || net.analysis?.role === 'dc-bias')
    .map((net) => net.name || net.id);
  const groundValues = parseAnalysisList(analysisAcGrounds?.value);
  for (const value of markedGrounds) if (!groundValues.includes(value)) groundValues.push(value);
  if (analysisAcGrounds && groundValues.length) analysisAcGrounds.value = groundValues.join(', ');
  const regions = analysisFormOptions().deviceRegions || {};
  for (const component of sortedComps()) {
    if (component.analysis?.model === 'triode') regions[component.refdes] = { region: 'triode' };
  }
  if (analysisDeviceRegions) analysisDeviceRegions.value = formatAnalysisDeviceRegions(regions);
}

function analysisReportText(report) {
  const lines = [report?.complete ? 'All equations derived.' : report?.error || 'Some equations are unavailable.'];
  for (const { title, result } of report?.equationEntries || []) {
    if (result?.equation) lines.push(`${title}: ${result.equation}`);
    if (result?.exactEquation && result.exactEquation !== result.equation) {
      lines.push(`${title}, exact: ${result.exactEquation}`);
    }
  }
  for (const assumption of report?.assumptions || []) lines.push(`Assumption: ${assumption}`);
  const log = Array.isArray(report?.log) ? report.log.join('\n') : String(report?.log || '').trim();
  if (log) lines.push(log);
  return lines.join('\n');
}

/**
 * Solver messages name nodes by physical net id (`V(N4)`), which says nothing
 * to someone looking at a drawing. Give them back the net's own name so a
 * floating node can be found and grounded.
 */
function analysisMessageWithNetNames(message) {
  return String(message || '').replace(/\b([VI])\((N\d+)\)/g, (whole, quantity, id) => {
    const net = circuit.nets.get(id);
    const name = net?.name ? parseLabelRuns(net.name).map((run) => run.text).join('') : '';
    return name ? `${quantity}(${name})` : whole;
  });
}

function analysisEquationEntries(report) {
  return Array.isArray(report?.equationEntries) ? report.equationEntries : [];
}

function analysisAnnotationEntries(report) {
  return analysisEquationEntries(report).flatMap(({ title, result }) => (
    result?.ok && result.equation ? [{ title, equation: result.equation }] : []
  ));
}

/**
 * Tag each rendered sub-expression with the components it was derived from.
 *
 * `texToMathML` has already turned `present.js`'s provenance markers into
 * `data-node` attributes; this resolves each node's symbol names through the
 * report's `symbolProvenance` table. A node naming nothing on the canvas (a
 * bare number, or `s`) is left undecorated and stays inert.
 */
function decorateEquationProvenance(container, provenance, table) {
  if (!container || !provenance || !table) return;
  const symbols = new Map(provenance.nodes.map((node) => [String(node.id), node.symbols]));
  for (const element of container.querySelectorAll('[data-node]')) {
    const components = componentsOfSymbols(symbols.get(element.dataset.node) || [], table);
    if (components.length) element.dataset.components = components.join(' ');
  }
}

function renderEquationMath(container, equation, provenance = null, table = null) {
  if (!container) return;
  container.replaceChildren();
  const normalized = equationForDiagram(equation);
  container.setAttribute('aria-label', normalized);
  // The shared parser escapes literal text and emits only MathML markup. The
  // provenance render differs from the displayed one by markers alone, which
  // `analysis-provenance-v2.test.js` asserts against the whole golden corpus,
  // so rendering from it cannot change what the row looks like.
  container.innerHTML = texToMathML(provenance?.tex || equation);
  decorateEquationProvenance(container, provenance, table);
}

/**
 * Equation to schematic highlighting. Hovering a term lights the devices it
 * came from; clicking locks that highlight, and clicking the locked term again
 * widens the selection to the enclosing sub-expression, so a term buried inside
 * a fraction can still be grabbed whole.
 */
let equationEmphasis = [];
let equationLockedTerm = null;

function equationTermComponents(element) {
  return element?.dataset?.components ? element.dataset.components.split(' ') : [];
}

function setEquationEmphasis(element, { locked = false } = {}) {
  const root = analysisEquation;
  if (!root) return;
  if (locked) equationLockedTerm = element;
  const active = element || equationLockedTerm;
  for (const marked of root.querySelectorAll('.equation-term-hover, .equation-term-locked')) {
    marked.classList.remove('equation-term-hover', 'equation-term-locked');
  }
  if (equationLockedTerm?.isConnected) equationLockedTerm.classList.add('equation-term-locked');
  else equationLockedTerm = null;
  if (active?.isConnected && active !== equationLockedTerm) active.classList.add('equation-term-hover');
  const components = equationTermComponents(active?.isConnected ? active : equationLockedTerm);
  const changed = components.length !== equationEmphasis.length
    || components.some((ref, index) => ref !== equationEmphasis[index]);
  equationEmphasis = components;
  if (changed) render();
}

function clearEquationEmphasis() {
  equationLockedTerm = null;
  setEquationEmphasis(null);
}

if (analysisEquation) {
  analysisEquation.addEventListener('pointermove', (event) => {
    setEquationEmphasis(event.target.closest?.('[data-components]') || null);
  });
  analysisEquation.addEventListener('pointerleave', () => setEquationEmphasis(null));
  analysisEquation.addEventListener('click', (event) => {
    const term = event.target.closest?.('[data-components]');
    if (!term) { clearEquationEmphasis(); return; }
    // A second click on the locked term widens to the sub-expression that
    // contains it, one level per click, up to the whole equation.
    const next = term === equationLockedTerm
      ? term.parentElement?.closest('[data-components]') || term
      : term;
    setEquationEmphasis(next, { locked: true });
  });
}

let latestSmallSignalModel = null;

/**
 * Draw the small-signal model beside its equations. The primitives come from
 * the pipeline after its pre-solve transforms, so the figure shows the circuit
 * the displayed equations describe -- Miller shunts included -- rather than
 * the schematic they were derived from.
 */
function renderSmallSignalModel(report) {
  latestSmallSignalModel = null;
  if (!analysisModelEl) return false;
  analysisModelEl.replaceChildren();
  if (!report?.ok) return false;
  let model;
  try { model = smallSignalSchematic(report, { circuit }); }
  catch (error) { model = { ok: false, error: error.message }; }
  if (!model?.ok) {
    const message = document.createElement('div');
    message.className = 'analysis-equation-unavailable';
    message.textContent = model?.error || 'No small-signal model is available.';
    analysisModelEl.appendChild(message);
    return false;
  }
  latestSmallSignalModel = model;
  const figure = document.createElement('div');
  figure.className = 'analysis-model-figure';
  figure.innerHTML = svgString(model.circuit, {
    themeInk: true,
    grid: false,
    terminals: false,
    junctions: true,
    background: false,
    emptyHint: false,
  });
  const svg = figure.querySelector('svg');
  if (svg) {
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Small-signal equivalent circuit');
  }
  analysisModelEl.appendChild(figure);
  for (const entry of model.legend || []) {
    const row = document.createElement('div');
    row.className = 'analysis-equation-row';
    const heading = document.createElement('div');
    heading.className = 'analysis-equation-label';
    heading.textContent = entry.symbol.replace(/[_^]\{([^}]*)\}/g, '$1');
    const value = document.createElement('div');
    value.className = 'analysis-equation-value';
    renderEquationMath(value, `${entry.symbol} = ${entry.value}`);
    row.append(heading, value);
    analysisModelEl.appendChild(row);
  }
  const notes = [...(model.notes || [])];
  const count = model.correspondence?.size || 0;
  if (count > 15) notes.unshift(`${count} branches: open it full size to read the figure.`);
  if (notes.length) {
    const list = document.createElement('ul');
    list.className = 'analysis-model-notes';
    for (const note of notes) {
      const item = document.createElement('li');
      item.textContent = note;
      list.appendChild(item);
    }
    analysisModelEl.appendChild(list);
  }
  return true;
}

function renderAnalysisResult(report) {
  if (!analysisResult) return;
  analysisResult.hidden = !report;
  if (!report) {
    if (analysisEquation) analysisEquation.replaceChildren();
    if (analysisDetails) analysisDetails.textContent = '';
    if (analysisNetlist) analysisNetlist.textContent = '';
    if (analysisNetlistPanel) analysisNetlistPanel.hidden = true;
    renderSmallSignalModel(null);
    if (analysisModelPanel) analysisModelPanel.hidden = true;
    for (const id of ['analysis-tab-netlist', 'analysis-tab-model']) {
      const tab = document.getElementById(id);
      if (tab) tab.disabled = true;
    }
    setAnalysisResultTab('equations');
    return;
  }
  const text = analysisReportText(report);
  if (analysisEquation) {
    clearEquationEmphasis();
    analysisEquation.replaceChildren();
    const entries = analysisEquationEntries(report);
    if (entries.length) {
      for (const { title, result: child } of entries) {
        const row = document.createElement('div');
        row.className = 'analysis-equation-row';
        const heading = document.createElement('div');
        heading.className = 'analysis-equation-label';
        heading.textContent = title;
        row.appendChild(heading);
        if (child?.ok && child.equation) {
          const equation = document.createElement('div');
          equation.className = 'analysis-equation-value';
          // A definition row states several things at once; stack them so the
          // row reads down instead of scrolling sideways.
          if (child.definition && Array.isArray(child.lines) && child.lines.length > 1) {
            equation.classList.add('analysis-equation-lines');
            for (const line of child.lines) {
              const item = document.createElement('div');
              renderEquationMath(item, line);
              equation.appendChild(item);
            }
          } else renderEquationMath(equation, child.equation, child.equationProvenance, report.symbolProvenance);
          row.appendChild(equation);
        } else {
          const unavailable = document.createElement('div');
          unavailable.className = 'analysis-equation-unavailable';
          unavailable.textContent = `Unsupported: ${child?.error || 'analysis unavailable'}`;
          row.appendChild(unavailable);
        }
        analysisEquation.appendChild(row);
      }
      analysisEquation.setAttribute('aria-label', text);
    } else {
      const unavailable = document.createElement('div');
      unavailable.className = 'analysis-equation-unavailable analysis-error';
      unavailable.textContent = analysisMessageWithNetNames(report.error) || 'Analysis unavailable.';
      analysisEquation.appendChild(unavailable);
      analysisEquation.removeAttribute('aria-label');
    }
  }
  if (analysisDetails) analysisDetails.textContent = text;
  const netlist = report.smallSignalNetlist || '';
  if (analysisNetlistPanel) analysisNetlistPanel.hidden = !netlist;
  if (analysisNetlist) analysisNetlist.textContent = netlist || '';
  const netlistTab = document.getElementById('analysis-tab-netlist');
  if (netlistTab) {
    netlistTab.disabled = !netlist;
    if (!netlist && netlistTab.getAttribute('aria-selected') === 'true') setAnalysisResultTab('equations');
  }
  const drawn = renderSmallSignalModel(report);
  if (analysisModelPanel) analysisModelPanel.hidden = !drawn;
  const modelTab = document.getElementById('analysis-tab-model');
  if (modelTab) modelTab.disabled = !drawn;
  if (analysisModelOpen) analysisModelOpen.disabled = !drawn;
  const selectedTab = analysisTabButtons.find((button) => button.getAttribute('aria-selected') === 'true')?.dataset.analysisTab || 'equations';
  const stillAvailable = (selectedTab === 'netlist' && !netlist) || (selectedTab === 'model' && !drawn);
  setAnalysisResultTab(stillAvailable ? 'equations' : selectedTab);
}

function analysisAnnotationAssumptions(report) {
  const options = report?.analysisOptions || {};
  const lines = [];
  if (options.highIntrinsicGain) lines.push('g_{m}r_{o} \\gg 1');
  if (options.neglectChannelLengthModulation) lines.push('r_{o} = \\infty');
  if (options.neglectBodyEffect) lines.push('g_{mb} = 0');
  if (options.dominantPoleApplied) lines.push('\\text{Dominant-pole approximation}');
  for (const assumption of report?.assumptions || []) {
    if (assumption.startsWith('Miller approximation')) lines.push(`\\text{${assumption}}`);
  }
  return lines;
}

function openAnalysisDialog(targetNetId) {
  if (!analysisDialog) return;
  const defaults = fillAnalysisDialog(targetNetId);
  const restored = restoreAnalysisForm(defaults);
  prefillAnalysisAttributes();
  if (!restored) groundUnusedInputPorts(null, analysisInput?.value);
  analysisInputPrevious = analysisInput?.value || '';
  if (!restored && targetNetId && analysisTarget && [...analysisTarget.options].some((option) => option.value === targetNetId)) analysisTarget.value = targetNetId;
  persistAnalysisForm();
  renderAnalysisResult(latestAnalysisReport);
  if (analysisAnnotate) analysisAnnotate.hidden = !latestAnalysisReport?.ok;
  const context = document.getElementById('analysis-bias-context');
  if (context && (analysisAcGrounds?.value || analysisDeviceRegions?.value)) context.open = true;
  analysisDockRevision = modelRevision;
  analysisDialog.hidden = false;
  analysisButton?.setAttribute('aria-pressed', 'true');
  analysisInput?.focus();
}

let analysisInputPrevious = '';

/**
 * A stage is driven from one port; every other input port is held at AC
 * ground. That covers a differential pair, and it covers taking the input
 * somewhere else entirely -- a supply rail, say -- where every signal input
 * has to be quiet for the answer to mean anything.
 */
function groundUnusedInputPorts(previousInput, nextInput) {
  if (!analysisAcGrounds) return;
  const nets = visibleNets();
  const inputPorts = new Set(portNetIds(nets, 'input', 'input'));
  if (!inputPorts.size) return;
  const nameOf = (id) => {
    const net = circuit.nets.get(id);
    return net ? net.name || net.id : '';
  };
  let values = parseAnalysisList(analysisAcGrounds.value);
  const next = nameOf(nextInput);
  values = values.filter((value) => value !== next && value !== nextInput);
  const additions = previousInput
    ? (inputPorts.has(previousInput) ? [nameOf(previousInput)] : [])
    : [...inputPorts].filter((id) => id !== nextInput).map(nameOf);
  for (const value of additions) if (value && !values.includes(value)) values.push(value);
  analysisAcGrounds.value = values.join(', ');
}

function isAnalysisDockOpen() {
  return !!analysisDialog && !analysisDialog.hidden;
}

function closeAnalysisDock() {
  if (!isAnalysisDockOpen()) return;
  setAnalysisPick(null);
  // The equation-to-schematic highlight belongs to the dock: leaving it drawn
  // over the canvas with nothing to explain it is just a stuck selection.
  clearEquationEmphasis();
  analysisDialog.hidden = true;
  analysisButton?.setAttribute('aria-pressed', 'false');
  canvasEl.focus();
}

let analysisDockRevision = null;
let analysisReportRevision = null;
let analysisPick = null;

/** Keep dock selects in step with model edits while it stays open. */
function syncAnalysisDock() {
  if (!isAnalysisDockOpen() || analysisDockRevision === modelRevision) return;
  analysisDockRevision = modelRevision;
  const kept = [analysisInput, analysisTarget, analysisReference].map((el) => el?.value);
  fillAnalysisDialog();
  [analysisInput, analysisTarget, analysisReference].forEach((el, index) => {
    if (el && [...el.options].some((option) => option.value === kept[index])) el.value = kept[index];
  });
  const stale = document.getElementById('analysis-stale');
  if (stale) stale.hidden = !latestAnalysisReport || analysisReportRevision === modelRevision;
}

function setAnalysisPick(selectId) {
  analysisPick = selectId && document.getElementById(selectId) ? selectId : null;
  for (const button of document.querySelectorAll('[data-analysis-pick]')) {
    button.setAttribute('aria-pressed', String(button.dataset.analysisPick === analysisPick));
  }
  canvasEl.classList.toggle('mode-analysis-pick', !!analysisPick);
  renderStatus();
}

/** Resolve a canvas click to a net for the armed analysis field. */
function completeAnalysisPick(world) {
  const select = document.getElementById(analysisPick);
  if (!select) return setAnalysisPick(null);
  const terminal = nearestTerminal(world);
  const net = terminal
    ? circuit.netOfTerminal(`${terminal.refdes}.${terminal.term}`)
    : pickWire(world)?.net;
  const optionNet = net && [...select.options].find((option) => option.value === net.id)
    ? net
    : net && visibleNets().find((candidate) => namedGroupNets(candidate).some((member) => member.id === net.id));
  if (!optionNet) {
    logLine('Click a wire or a connected pin to choose a net.', 'error');
    return;
  }
  select.value = optionNet.id;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  logLine(`${select.labels?.[0]?.textContent || 'Analysis node'}: ${optionNet.name || optionNet.id}`, 'status');
  setAnalysisPick(null);
  selectedNets = new Set(namedGroupNets(optionNet).map((member) => member.id));
  render();
}

analysisForm?.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const output = analysisTarget?.value;
  const input = analysisInput?.value;
  if (!output || !input) {
    const error = !output
      ? 'Select an output node before deriving equations.'
      : 'Select an input node before deriving equations.';
    latestAnalysisReport = { query: 'combined', ok: false, complete: false, error, reports: {} };
    renderAnalysisResult(latestAnalysisReport);
    if (analysisAnnotate) analysisAnnotate.hidden = true;
    logLine(error, 'error');
    return;
  }
  persistAnalysisForm();
  const formOptions = analysisFormOptions();
  const devices = analysisDeviceOptions();
  const request = {
    ...formOptions,
    ...(Object.keys(devices).length ? { devices } : {}),
    input,
    output,
    reference: analysisReference?.value || undefined,
    acGrounds: parseAnalysisList(analysisAcGrounds?.value),
  };
  let report;
  try {
    report = adaptCombinedReport(analyzeSmallSignalV2(circuit, request));
    report.analysisOptions = {
      ...formOptions,
      devices,
      dominantPoleApplied: formOptions.dominantPole
        && report.assumptions?.includes('dominant-pole approximation'),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report = adaptCombinedReport({ ok: false, error: `analysis failed: ${message}` });
  }
  latestAnalysisReport = report;
  analysisReportRevision = modelRevision;
  const stale = document.getElementById('analysis-stale');
  if (stale) stale.hidden = true;
  renderAnalysisResult(report);
  if (analysisAnnotate) analysisAnnotate.hidden = !report.ok;
  requestAnimationFrame(() => analysisResult?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  logLine(report.complete ? 'derived input impedance, output impedance, and voltage transfer' : 'some requested analyses are unavailable', report.complete ? 'status' : 'error');
  for (const { title, result } of report.equationEntries || []) logLine(`${title}: ${result.equation}`, 'status');
  for (const assumption of report.assumptions || []) logLine(`Assumption: ${assumption}`, 'status');
});

analysisInput?.addEventListener('change', () => {
  if (analysisInput.value === analysisInputPrevious) return;
  groundUnusedInputPorts(analysisInputPrevious, analysisInput.value);
  analysisInputPrevious = analysisInput.value;
});

for (const control of [analysisTarget, analysisReference, analysisInput, analysisAcGrounds, analysisDeviceRegions, analysisApproxRo, analysisApproxBody, analysisApproxGmRo, analysisApproxDominantPole]) {
  control?.addEventListener('input', persistAnalysisForm);
  control?.addEventListener('change', persistAnalysisForm);
}

function equationForDiagram(equation) {
  return String(equation || '')
    .replace(/\\left|\\right/g, '')
    .replace(/\\Big\\Vert|\\Vert/g, '||')
    .replace(/\\\|\\\|/g, '||')
    .replace(/\\parallel/g, '||')
    .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1/$2)')
    .replace(/\bA_v\b/g, 'A_{v}')
    .replace(/\s+/g, ' ')
    // The live analysis preview is built from rich-text spans rather than
    // MathML. Apply these after whitespace normalization so the em-space is
    // not collapsed back to an ordinary space; persisted math labels are
    // handled by texToMathML in the SVG renderer.
    .replace(/\\qquad/g, '\u2003\u2003')
    .replace(/\\quad/g, '\u2003')
    .trim();
}

function equationForLabel(equation) {
  const normalized = String(equation || '')
    .replace(/\\parallel/g, '\\Vert')
    .replace(/\\Big\\\|\\\|/g, '\\Big\\Vert')
    .replace(/\\\|\\\|/g, '\\Vert')
    // Keep labels editable as valid TeX even if a legacy report or manually
    // entered equation still contains the plain `||` spelling.
    .replace(/(?<!\\)\|\|/g, '\\Vert')
    .replace(/\bA_v\b/g, 'A_{v}')
    .replace(/\s+/g, ' ')
    .trim();
  // A parallel operator sharing a line with a fraction needs the larger
  // delimiter form to reach the fraction's numerator/denominator height.
  return /\\frac\b/.test(normalized)
    ? normalized.replace(/(?<!\\Big)\\Vert/g, '\\Big\\Vert')
    : normalized;
}

function annotateAnalysisResult() {
  const report = latestAnalysisReport;
  if (!report?.ok) return;
  const entries = analysisAnnotationEntries(report);
  if (!entries.length) return;
  // Keep generated equations below the figure. Label boxes are centered on
  // their anchors, so place each center from the figure's left and bottom
  // edges after learning its model dimensions.
  const circuitBounds = circuit.bounds();
  const leftEdge = circuitBounds.w > 0 ? circuitBounds.x : cursor.x;
  const bottomEdge = circuitBounds.h > 0 ? circuitBounds.y + circuitBounds.h : cursor.y;
  const topGap = 2 * GRID;
  let nextTop = bottomEdge + topGap;
  const labels = [];
  const equationLabels = [];
  let assumptionsLabel = null;
  commit(() => {
    for (const entry of entries) {
      const label = circuit.addLabel({
        text: equationForLabel(`\\text{${entry.title}: }\\;${entry.equation}`),
        x: 0,
        y: 0,
        align: 'left',
        math: true,
      });
      const box = label.bbox();
      const left = snap(leftEdge);
      const x = snap(left + box.w / 2);
      const y = snap(nextTop + box.h / 2);
      label.moveTo(x, y);
      nextTop = label.bbox().y + label.bbox().h + GRID;
      labels.push(label);
      equationLabels.push(label);
    }
    const assumptions = analysisAnnotationAssumptions(report);
    if (assumptions.length) {
      const label = circuit.addLabel({
        text: ['\\text{Assumptions\\:}', ...assumptions].join('\n'),
        x: 0,
        y: 0,
        align: 'left',
        math: true,
      });
      const box = label.bbox();
      const left = snap(leftEdge);
      label.moveTo(snap(left + box.w / 2), snap(nextTop + box.h / 2));
      labels.push(label);
      assumptionsLabel = label;
    }
  });
  equationAnnotationLayout = {
    equationIds: equationLabels.map((label) => label.id),
    assumptionsId: assumptionsLabel?.id || null,
    leftEdge,
    bottomEdge,
    topGap,
    signature: null,
  };
  setLabelSelection(labels.map((label) => label.id), labels[0]?.id);
  const equationCount = entries.length;
  logLine(`annotated schematic with ${equationCount} equation${equationCount === 1 ? '' : 's'}${labels.length > equationCount ? ' and assumptions' : ''}`, 'status');
  fitView();
}

analysisAnnotate?.addEventListener('click', annotateAnalysisResult);

/** An explicit selection hints the output; otherwise the form defaults decide. */
function suggestedAnalysisTarget() {
  const selectedNet = [...selectedNets][0];
  if (selectedNet && circuit.nets.has(selectedNet)) return selectedNet;
  const component = selected && circuit.components.get(selected);
  if (component) {
    for (const term of ['d', 'o', 'y', 'a', 'b']) {
      const net = circuit.netOfTerminal({ comp: component.refdes, term });
      if (net) return net.id;
    }
  }
  return '';
}

analysisButton?.addEventListener('click', () => {
  if (isAnalysisDockOpen()) closeAnalysisDock();
  else openAnalysisDialog(suggestedAnalysisTarget());
});

const SMALL_SIGNAL_TRANSISTOR_TYPES = new Set(['nmos', 'pmos', 'nmosb', 'pmosb']);
const SMALL_SIGNAL_RESISTOR_TYPES = new Set(['resistor', 'variable_resistor']);
const SMALL_SIGNAL_PORT_TYPES = INTERFACE_PIN_TYPES;

/**
 * Resolve the component scope for a side-panel analysis menu. A context menu
 * opened on a selected component applies to every selected component of the
 * requested kind; opening it on an unselected row intentionally scopes the
 * action to that row so an old multi-selection cannot be changed by accident.
 */
function analysisComponentTargets(target, predicate = () => true) {
  const selectedRefs = new Set(selectedComps().map((comp) => comp.refdes));
  const refs = selectedRefs.has(target.refdes) ? selectedRefs : new Set([target.refdes]);
  return [...refs]
    .map((refdes) => circuit.components.get(refdes))
    .filter((component) => component && predicate(component));
}

/** Resolve the analogous scope for a side-panel net analysis menu. */
function analysisNetTargets(target) {
  const selectedIds = new Set(selectedNets);
  const ids = selectedIds.has(target.id) ? selectedIds : new Set([target.id]);
  return [...ids].map((id) => circuit.nets.get(id)).filter(Boolean);
}

function applyComponentAnalysis(target, attrs, predicate = () => true) {
  const components = analysisComponentTargets(target, predicate);
  if (!components.length) return;
  commit(() => {
    for (const component of components) circuit.setComponentAnalysis(component.refdes, attrs);
  });
  logLine(`applied small-signal attributes to ${components.length} component${components.length === 1 ? '' : 's'}`, 'status');
}

function applyNetAnalysis(target, attrs) {
  const nets = analysisNetTargets(target);
  if (!nets.length) return;
  commit(() => {
    for (const net of nets) circuit.setNetAnalysis(net, attrs);
  });
  logLine(`applied analysis attributes to ${nets.length} net${nets.length === 1 ? '' : 's'}`, 'status');
}

analysisCancel?.addEventListener('click', closeAnalysisDock);
for (const button of document.querySelectorAll('[data-analysis-pick]')) {
  button.addEventListener('click', () => setAnalysisPick(analysisPick === button.dataset.analysisPick ? null : button.dataset.analysisPick));
}
analysisDialog?.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape') return;
  ev.preventDefault();
  ev.stopPropagation();
  if (analysisPick) setAnalysisPick(null);
  else closeAnalysisDock();
});

function contextNet(target) {
  return target?.kind === 'wire' ? target.value.net : target?.kind === 'net' ? target.value : null;
}

function selectContextNet(target, { namedGroup = false, segment = false } = {}) {
  const net = contextNet(target);
  if (!net) return;
  const candidates = namedGroup && net.name
    ? [...circuit.nets.values()].filter((candidate) => candidate.name === net.name)
    : namedGroupNets(net);
  setSelection([], null, true);
  setLabelSelection([], null, true);
  selectedNets = new Set(candidates.flatMap((candidate) => namedGroupNets(candidate).map((item) => item.id)));
  selectedWire = null;
  selectedWires.clear();
  if (segment && target.kind === 'wire') {
    const { branch, segment: segmentIndex } = target.value;
    const key = `${net.id}:${branch}:${segmentIndex}`;
    selectedWires.add(key);
    selectedWire = { netId: net.id, branch, segment: segmentIndex };
  }
  syncSelectedWire();
  closeComponentContextMenu();
  render();
}

function appendContextItem(parent, label, action, { disabled = false, active = false, mixed = false, shortcut = '', danger = false } = {}) {
  const item = document.createElement('button');
  item.type = 'button';
  item.textContent = label;
  if (danger) item.classList.add('context-item-danger');
  if (shortcut) {
    const hint = document.createElement('kbd');
    hint.className = 'context-item-shortcut';
    hint.textContent = shortcut;
    item.appendChild(hint);
  }
  item.setAttribute('role', active || mixed ? 'menuitemradio' : 'menuitem');
  if (active || mixed) {
    item.classList.add(active ? 'context-item-active' : 'context-item-mixed');
    item.setAttribute('aria-checked', mixed ? 'mixed' : 'true');
    const state = document.createElement('span');
    state.className = 'context-item-state';
    state.textContent = active ? '✓' : '•';
    state.setAttribute('aria-hidden', 'true');
    item.appendChild(state);
  }
  item.disabled = disabled;
  item.addEventListener('click', () => {
    if (item.disabled) return;
    action();
    closeComponentContextMenu();
    render();
  });
  parent.appendChild(item);
  return item;
}

function analysisChoiceState(targets, read, expected) {
  const values = targets.map(read);
  const matches = values.filter((value) => value === expected).length;
  return {
    active: values.length > 0 && matches === values.length,
    mixed: matches > 0 && matches < values.length,
  };
}

/** Add one keyboard-accessible nested menu. The same helper is used for
 * selection, net roles, and device attributes so canvas and side-panel menus
 * have identical hierarchy and interaction semantics. */
function appendContextSubmenu(parent, label, build) {
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.textContent = label;
  trigger.setAttribute('aria-haspopup', 'true');
  trigger.setAttribute('aria-expanded', 'false');
  const arrow = document.createElement('span');
  arrow.textContent = '›';
  arrow.setAttribute('aria-hidden', 'true');
  trigger.appendChild(arrow);
  const submenu = document.createElement('div');
  submenu.className = 'context-submenu';
  submenu.setAttribute('role', 'menu');
  submenu.setAttribute('aria-label', label);
  build(submenu);
  const closeSiblings = () => {
    for (const sibling of parent.querySelectorAll(':scope > .context-submenu.open')) sibling.classList.remove('open');
    for (const siblingTrigger of parent.querySelectorAll(':scope > button[aria-expanded="true"]')) {
      siblingTrigger.setAttribute('aria-expanded', 'false');
      siblingTrigger.classList.remove('context-item-open');
    }
  };
  const open = () => {
    closeSiblings();
    submenu.classList.add('open');
    // Open level with the trigger row, then shift up only as far as needed to stay on screen.
    submenu.style.top = `${trigger.offsetTop - 5}px`;
    const overflow = submenu.getBoundingClientRect().bottom - (window.innerHeight - 8);
    if (overflow > 0) submenu.style.top = `${trigger.offsetTop - 5 - overflow}px`;
    componentContextSubmenu = submenu;
    trigger.setAttribute('aria-expanded', 'true');
    trigger.classList.add('context-item-open');
  };
  trigger.addEventListener('mouseenter', () => {
    trigger.focus({ preventScroll: true });
    open();
  });
  trigger.addEventListener('focus', open);
  trigger.addEventListener('click', open);
  trigger.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowLeft' || ev.key === 'Escape') {
      ev.preventDefault();
      submenu.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.classList.remove('context-item-open');
      trigger.focus();
      return;
    }
    if (ev.key === 'ArrowRight' || ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      open();
      submenu.querySelector('button:not(:disabled)')?.focus();
    }
  });
  parent.append(trigger, submenu);
  return submenu;
}

function appendContextSelectionMenu(menu, target) {
  appendContextSubmenu(menu, 'Select', (submenu) => {
    if (target.kind === 'component') {
      appendContextItem(submenu, 'Select this component', () => {
        setSelection([target.value.refdes]);
        setLabelSelection([], null, true);
      });
    } else if (target.kind === 'net' || target.kind === 'wire') {
      appendContextItem(submenu, 'Select this net', () => selectContextNet(target));
      if (target.kind === 'wire') appendContextItem(submenu, 'Select wire segment', () => selectContextNet(target, { segment: true }));
      const net = contextNet(target);
      if (target.kind === 'wire') {
        appendContextItem(submenu, 'Select same named nets', () => selectContextNet(target, { namedGroup: true }), { disabled: !net?.name });
      }
    }
    const typeLabel = target.kind === 'component' ? 'Same component type'
      : target.kind === 'wire' ? 'Same wire type'
        : target.kind === 'net' ? 'Same net name' : 'Same label type';
    const criteria = target.kind === 'net'
      ? [['type', typeLabel]]
      : [['type', typeLabel], ['color', 'Same color'], ['lineStyle', 'Same line style']];
    for (const [criterion, label] of criteria) {
      if (target.kind === 'net' && !target.value.name) continue;
      appendContextItem(submenu, label, () => selectSameTarget(criterion));
    }
  });
}

function appendSignalFlowPolarityMenu(menu, target) {
  const component = target.kind === 'component' ? target.value : null;
  const inputs = component?.terminalDefs?.filter((terminal) => terminal.signalRole === 'input') || [];
  if (!inputs.length) return;
  appendContextSubmenu(menu, 'Input polarity', (submenu) => {
    for (const terminal of inputs) {
      const routed = !!circuit.netOfTerminal({ comp: component.refdes, term: terminal.name });
      const negative = component.negativeInputs?.has(terminal.name) || false;
      const label = routed
        ? `${terminal.name} input: ${negative ? 'negative' : 'positive'}`
        : `${terminal.name} input (not routed)`;
      appendContextItem(submenu, label, () => {
        commit(() => circuit.setSignalInputNegative(component.refdes, terminal.name, !negative));
      }, { disabled: !routed, active: negative });
    }
  });
}

function appendContextSmallSignalMenu(menu, target) {
  const component = target.kind === 'component' ? target.value : null;
  const net = contextNet(target);
  if (target.kind !== 'component' && !net) return;
  if (net) {
    appendContextSubmenu(menu, 'Small-signal attributes', (submenu) => {
      const targets = analysisNetTargets(net);
      appendContextItem(submenu, 'DC bias / AC ground', () => applyNetAnalysis(net, { role: 'dc-bias', acGround: true }), analysisChoiceState(targets, (candidate) => candidate.analysis?.role === 'dc-bias' || candidate.analysis?.acGround, true));
      appendContextItem(submenu, 'Input node', () => applyNetAnalysis(net, { role: 'input', acGround: false }), analysisChoiceState(targets, (candidate) => candidate.analysis?.role, 'input'));
      appendContextItem(submenu, 'Output node', () => applyNetAnalysis(net, { role: 'output', acGround: false }), analysisChoiceState(targets, (candidate) => candidate.analysis?.role, 'output'));
      appendContextItem(submenu, 'Clear net role', () => applyNetAnalysis(net, { role: null, acGround: false }), {
        disabled: !targets.some((candidate) => candidate.analysis?.role || candidate.analysis?.acGround),
      });
    });
    return;
  }
  const transistor = SMALL_SIGNAL_TRANSISTOR_TYPES.has(component.type);
  const resistor = SMALL_SIGNAL_RESISTOR_TYPES.has(component.type);
  const port = SMALL_SIGNAL_PORT_TYPES.has(component.type);
  if (!transistor && !resistor && !port) return;
  appendContextSubmenu(menu, 'Small-signal attributes', (submenu) => {
    if (transistor) {
      const transistorTargets = analysisComponentTargets(component, (candidate) => SMALL_SIGNAL_TRANSISTOR_TYPES.has(candidate.type));
      appendContextSubmenu(submenu, 'Device model', (modelMenu) => {
        appendContextItem(modelMenu, 'Triode device (r_ds resistor)', () => applyComponentAnalysis(component, { model: 'triode' }, (candidate) => SMALL_SIGNAL_TRANSISTOR_TYPES.has(candidate.type)), analysisChoiceState(transistorTargets, (candidate) => candidate.analysis?.model, 'triode'));
        appendContextItem(modelMenu, 'Clear device model', () => applyComponentAnalysis(component, { model: null }, (candidate) => SMALL_SIGNAL_TRANSISTOR_TYPES.has(candidate.type)), {
          disabled: !transistorTargets.some((candidate) => candidate.analysis?.model),
        });
      });
      appendContextSubmenu(submenu, 'Output resistance', (roMenu) => {
        appendContextItem(roMenu, 'Ignore channel-length modulation (r_o → ∞)', () => applyComponentAnalysis(component, { channelLengthModulation: 'ignore' }, (candidate) => SMALL_SIGNAL_TRANSISTOR_TYPES.has(candidate.type)), analysisChoiceState(transistorTargets, (candidate) => candidate.analysis?.channelLengthModulation, 'ignore'));
        appendContextItem(roMenu, 'Retain finite r_o', () => applyComponentAnalysis(component, { channelLengthModulation: 'finite' }, (candidate) => SMALL_SIGNAL_TRANSISTOR_TYPES.has(candidate.type)), analysisChoiceState(transistorTargets, (candidate) => candidate.analysis?.channelLengthModulation, 'finite'));
        appendContextItem(roMenu, 'Clear r_o override', () => applyComponentAnalysis(component, { channelLengthModulation: null }, (candidate) => SMALL_SIGNAL_TRANSISTOR_TYPES.has(candidate.type)), {
          disabled: !transistorTargets.some((candidate) => candidate.analysis?.channelLengthModulation),
        });
      });
      appendContextSubmenu(submenu, 'Intrinsic gain', (gmroMenu) => {
        appendContextItem(gmroMenu, 'Assume g_m r_o ≫ 1', () => applyComponentAnalysis(component, { gmroLarge: true }, (candidate) => SMALL_SIGNAL_TRANSISTOR_TYPES.has(candidate.type)), analysisChoiceState(transistorTargets, (candidate) => candidate.analysis?.gmroLarge, true));
        appendContextItem(gmroMenu, 'Retain finite g_m r_o', () => applyComponentAnalysis(component, { gmroLarge: false }, (candidate) => SMALL_SIGNAL_TRANSISTOR_TYPES.has(candidate.type)), analysisChoiceState(transistorTargets, (candidate) => candidate.analysis?.gmroLarge, false));
        appendContextItem(gmroMenu, 'Clear g_m r_o override', () => applyComponentAnalysis(component, { gmroLarge: null }, (candidate) => SMALL_SIGNAL_TRANSISTOR_TYPES.has(candidate.type)), {
          disabled: !transistorTargets.some((candidate) => candidate.analysis?.gmroLarge !== null && candidate.analysis?.gmroLarge !== undefined),
        });
      });
      appendContextSubmenu(submenu, 'Body effect', (bodyMenu) => {
        appendContextItem(bodyMenu, 'Ignore body effect (V_BS = 0)', () => applyComponentAnalysis(component, { ignoreBodyEffect: true }, (candidate) => SMALL_SIGNAL_TRANSISTOR_TYPES.has(candidate.type)), analysisChoiceState(transistorTargets, (candidate) => candidate.analysis?.ignoreBodyEffect, true));
        appendContextItem(bodyMenu, 'Retain body effect', () => applyComponentAnalysis(component, { ignoreBodyEffect: false }, (candidate) => SMALL_SIGNAL_TRANSISTOR_TYPES.has(candidate.type)), analysisChoiceState(transistorTargets, (candidate) => candidate.analysis?.ignoreBodyEffect, false));
        appendContextItem(bodyMenu, 'Clear body-effect override', () => applyComponentAnalysis(component, { ignoreBodyEffect: null }, (candidate) => SMALL_SIGNAL_TRANSISTOR_TYPES.has(candidate.type)), {
          disabled: !transistorTargets.some((candidate) => candidate.analysis?.ignoreBodyEffect !== null && candidate.analysis?.ignoreBodyEffect !== undefined),
        });
      });
      // The device's own capacitances, per device: the analysis form carries
      // the same choice for the whole circuit.
      appendContextSubmenu(submenu, 'Device capacitances', (capMenu) => {
        appendContextItem(capMenu, 'Include C_gs and C_gd', () => applyComponentAnalysis(component, { parasitics: 'include' }, (candidate) => SMALL_SIGNAL_TRANSISTOR_TYPES.has(candidate.type)), analysisChoiceState(transistorTargets, (candidate) => candidate.analysis?.parasitics, 'include'));
        appendContextItem(capMenu, 'Omit device capacitances', () => applyComponentAnalysis(component, { parasitics: 'omit' }, (candidate) => SMALL_SIGNAL_TRANSISTOR_TYPES.has(candidate.type)), analysisChoiceState(transistorTargets, (candidate) => candidate.analysis?.parasitics, 'omit'));
        appendContextItem(capMenu, 'Follow the analysis form', () => applyComponentAnalysis(component, { parasitics: null }, (candidate) => SMALL_SIGNAL_TRANSISTOR_TYPES.has(candidate.type)), {
          disabled: !transistorTargets.some((candidate) => candidate.analysis?.parasitics),
        });
      });
    }
    if (resistor) {
      const resistorTargets = analysisComponentTargets(component, (candidate) => SMALL_SIGNAL_RESISTOR_TYPES.has(candidate.type));
      appendContextSubmenu(submenu, 'Resistance', (resistanceMenu) => {
        appendContextItem(resistanceMenu, 'Treat as R = ∞', () => applyComponentAnalysis(component, { resistance: 'infinite' }, (candidate) => SMALL_SIGNAL_RESISTOR_TYPES.has(candidate.type)), analysisChoiceState(resistorTargets, (candidate) => candidate.analysis?.resistance, 'infinite'));
        appendContextItem(resistanceMenu, 'Retain finite R', () => applyComponentAnalysis(component, { resistance: 'finite' }, (candidate) => SMALL_SIGNAL_RESISTOR_TYPES.has(candidate.type)), analysisChoiceState(resistorTargets, (candidate) => candidate.analysis?.resistance, 'finite'));
        appendContextItem(resistanceMenu, 'Clear resistance override', () => applyComponentAnalysis(component, { resistance: null }, (candidate) => SMALL_SIGNAL_RESISTOR_TYPES.has(candidate.type)), {
          disabled: !resistorTargets.some((candidate) => candidate.analysis?.resistance !== null && candidate.analysis?.resistance !== undefined),
        });
      });
    }
    if (port) {
      const portTargets = analysisComponentTargets(component, (candidate) => SMALL_SIGNAL_PORT_TYPES.has(candidate.type));
      appendContextSubmenu(submenu, 'Port role', (roleMenu) => {
        appendContextItem(roleMenu, 'DC bias / AC ground', () => applyComponentAnalysis(component, { role: 'dc-bias' }, (candidate) => SMALL_SIGNAL_PORT_TYPES.has(candidate.type)), analysisChoiceState(portTargets, (candidate) => candidate.analysis?.role, 'dc-bias'));
        appendContextItem(roleMenu, 'Input node', () => applyComponentAnalysis(component, { role: 'input' }, (candidate) => SMALL_SIGNAL_PORT_TYPES.has(candidate.type)), analysisChoiceState(portTargets, (candidate) => candidate.analysis?.role, 'input'));
        appendContextItem(roleMenu, 'Output node', () => applyComponentAnalysis(component, { role: 'output' }, (candidate) => SMALL_SIGNAL_PORT_TYPES.has(candidate.type)), analysisChoiceState(portTargets, (candidate) => candidate.analysis?.role, 'output'));
        appendContextItem(roleMenu, 'Clear port role', () => applyComponentAnalysis(component, { role: null }, (candidate) => SMALL_SIGNAL_PORT_TYPES.has(candidate.type)), {
          disabled: !portTargets.some((candidate) => candidate.analysis?.role),
        });
      });
    }
  });
}

function openComponentContextMenu(target, x, y) {
  if (!componentContextMenuEl || !target) return;
  closeComponentContextMenu();
  componentContextTarget = target;
  const menu = componentContextMenuEl;
  menu.classList.remove('analysis-attribute-menu');
  menu.hidden = false;
  if (x > window.innerWidth - 420) menu.classList.add('opens-left');
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - 250))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - 120))}px`;
  const heading = document.createElement('div');
  heading.className = 'context-menu-heading';
  const contextComponent = target.kind === 'component' ? target.value : null;
  const contextNetwork = contextNet(target);
  const scopeCount = contextComponent
    ? analysisComponentTargets(contextComponent).length
    : contextNetwork
      ? analysisNetTargets(contextNetwork).length
      : 1;
  const scopeSuffix = scopeCount > 1 ? ` (${scopeCount} selected)` : '';
  if (contextComponent) appendMarkupText(heading, componentDisplayName(contextComponent));
  else if (contextNetwork) appendMarkupText(heading, contextNetwork.name || '(unnamed net)');
  else heading.textContent = target.kind === 'label' ? 'Label' : 'Selection';
  const headingMeta = contextComponent ? contextComponent.type : contextNetwork ? contextNetwork.id : '';
  const meta = [headingMeta, scopeSuffix.trim()].filter(Boolean).join(' ');
  if (meta) heading.append(` · ${meta}`);
  menu.appendChild(heading);
  appendContextActions(menu, target);
  appendContextSelectionMenu(menu, target);
  appendSignalFlowPolarityMenu(menu, target);
  appendContextSmallSignalMenu(menu, target);
  if (target.kind !== 'component' && target.kind !== 'net' && target.kind !== 'wire') {
    appendContextItem(menu, 'Close', closeComponentContextMenu);
  }
  const rect = menu.getBoundingClientRect();
  if (rect.bottom > window.innerHeight - 4) menu.style.top = `${Math.max(4, window.innerHeight - 4 - rect.height)}px`;
  menu.querySelector('button:not(:disabled)')?.focus();
}

/** Right-clicking an unselected object makes it the selection, so menu actions have one clear scope. */
function selectContextTarget(target) {
  if (target.kind === 'component') {
    if (multi.has(target.value.refdes)) return;
    setSelection([target.value.refdes]);
    setLabelSelection([], null, true);
    selectedNets = new Set();
  } else if (target.kind === 'label') {
    if (selLabels.has(target.value.id)) return;
    setSelection([]);
    setLabelSelection([target.value.id]);
  } else if (target.kind === 'net' || target.kind === 'wire') {
    const net = contextNet(target);
    if (!net || selectedNets.has(net.id)) return;
    setSelection([]);
    setLabelSelection([]);
    selectedNets = new Set(namedGroupNets(net).map((member) => member.id));
  }
}

function renameFromPanel(listEl, selector, start) {
  const section = listEl.closest('.panel-group');
  if (section?.classList.contains('collapsed')) setPanelCollapsed(section.dataset.panel, false);
  let row = listEl.querySelector(selector);
  if (!row && panelFilterEl?.value) {
    panelFilterEl.value = '';
    panelFilterEl.dispatchEvent(new Event('input'));
    row = listEl.querySelector(selector);
  }
  const ref = row?.querySelector('.ref');
  if (!ref) return;
  row.scrollIntoView({ block: 'nearest' });
  start(ref);
}

function appendContextActions(menu, target) {
  const group = document.createElement('div');
  group.className = 'context-menu-group';
  const later = (fn) => () => setTimeout(fn, 0);
  if (target.kind === 'component') {
    const comp = target.value;
    const renamable = !isReferenceMarker(comp) && comp.type !== 'block' && comp.type !== 'solder';
    if (renamable) {
      appendContextItem(group, 'Rename…', later(() => renameFromPanel(componentsListEl, `[data-refdes="${CSS.escape(comp.refdes)}"]`, (ref) => startComponentRename(comp, ref))), { shortcut: 'dbl-click' });
    }
    appendContextItem(group, 'Rotate', () => selectedTransform('rotate'), { shortcut: 'R' });
    appendContextItem(group, 'Mirror horizontally', () => selectedTransform('mirror-x'), { shortcut: 'Shift+R' });
    appendContextItem(group, 'Mirror vertically', () => selectedTransform('mirror-y'), { shortcut: 'Ctrl+R' });
  } else if (target.kind === 'label') {
    if (target.value.kind === 'label') appendContextItem(group, 'Edit text…', later(() => inlineEditLabel(target.value)), { shortcut: 'T' });
  } else if (target.kind === 'net' || target.kind === 'wire') {
    const net = contextNet(target);
    appendContextItem(group, 'Rename net…', later(() => renameFromPanel(netsListEl, `#net-option-${CSS.escape(net.id)}`, (ref) => startNetRename(net, ref))));
  }
  if (target.kind !== 'net' && target.kind !== 'wire') {
    appendContextItem(group, 'Move', () => activateMove('connected'), { shortcut: 'M' });
    appendContextItem(group, 'Detached move', () => activateMove('detached'), { shortcut: 'Shift+M' });
    appendContextItem(group, 'Copy', activateCopy, { shortcut: 'C' });
    appendContextItem(group, 'Copy as image', copyAsImage, { shortcut: 'Ctrl/Cmd+Shift+C' });
    appendContextItem(group, 'Bring to front', () => restackSelected('front'), { shortcut: 'Shift+↑' });
    appendContextItem(group, 'Send to back', () => restackSelected('back'), { shortcut: 'Shift+↓' });
  }
  if (target.kind === 'net' || target.kind === 'wire') appendContextItem(group, 'Copy as image', copyAsImage, { shortcut: 'Ctrl/Cmd+Shift+C' });
  appendContextItem(group, 'Delete', deleteSelection, { shortcut: 'Del', danger: true });
  menu.appendChild(group);
}

canvasEl.addEventListener('contextmenu', (ev) => {
  const world = clientToWorld(ev.clientX, ev.clientY);
  const label = pickLabel(world);
  const annotation = annotationGeometryAt(world);
  const hit = pickAt(world);
  const wire = pickWire(world);
  const labelNet = label?.netId ? circuit.nets.get(label.netId) : null;
  const target = label
    ? labelNet ? { kind: 'net', value: labelNet } : { kind: 'label', value: label }
    : annotation
      ? { kind: 'label', value: annotation }
      : hit?.refdes && circuit.components.has(hit.refdes)
        ? { kind: 'component', value: circuit.components.get(hit.refdes) }
        : wire
          ? { kind: 'wire', value: { net: wire.net, branch: wire.branch, segment: wire.seg } }
          : null;
  ev.preventDefault();
  if (target) {
    selectContextTarget(target);
    render();
    openComponentContextMenu(target, ev.clientX, ev.clientY);
  } else closeComponentContextMenu();
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
// Releasing Alt drops the mirrored ghost or terminal-snap aid; so does losing the window, since no
// keyup arrives then and the twin would otherwise be stuck on screen.
window.addEventListener('keyup', (ev) => {
  if (ev.key !== 'Alt') return;
  altHeld = false;
  setSymmetry(false);
  if (terminalSnap) {
    terminalSnap = false;
    render();
  }
});
window.addEventListener('blur', () => {
  altHeld = false;
  setSymmetry(false);
  if (terminalSnap) {
    terminalSnap = false;
    render();
  }
});

function blockResizeRect(rect, handle, world) {
  const p = { x: snap(world.x), y: snap(world.y) };
  let x0 = rect.x; let y0 = rect.y; let x1 = rect.x + rect.w; let y1 = rect.y + rect.h;
  if (handle.includes('w')) x0 = Math.min(p.x, x1 - 2 * GRID);
  if (handle.includes('e')) x1 = Math.max(p.x, x0 + 2 * GRID);
  if (handle.includes('n')) y0 = Math.min(p.y, y1 - 2 * GRID);
  if (handle.includes('s')) y1 = Math.max(p.y, y0 + 2 * GRID);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}


function inlineEditSchematicBlock(component) {
  if (!component || component.type !== 'block' || inlineInput) return;
  const pane = document.querySelector('.canvas-pane');
  const paneRect = pane.getBoundingClientRect();
  const box = component.bboxWorld();
  const input = document.createElement('textarea');
  input.value = component.value || '';
  input.spellcheck = false;
  input.className = 'label-inline-editor block-inline-editor';
  input.style.position = 'absolute';
  input.style.zIndex = '30';
  input.style.left = `${paneRect.left + ((box.x - view.x) / view.w) * paneRect.width}px`;
  input.style.top = `${paneRect.top + ((box.y - view.y) / view.h) * paneRect.height}px`;
  input.style.width = `${(box.w / view.w) * paneRect.width}px`;
  input.style.height = `${(box.h / view.h) * paneRect.height}px`;
  input.style.textAlign = 'center';
  input.style.resize = 'none';
  input.style.whiteSpace = 'pre-wrap';
  input.style.overflow = 'hidden';
  document.body.appendChild(input);
  inlineInput = input;
  input.focus();
  input.select();
  let closed = false;
  const done = (apply) => {
    if (closed) return;
    closed = true;
    inlineInput = null;
    const text = input.value.trim();
    input.remove();
    if (apply && text && text !== component.value) commit(() => circuit.setValue(component.refdes, text));
    render();
  };
  bindInlineEditorKeys(input, done);
}
// Double-click edits the active document's object. Components edit their owned
// child label; reference markers create the same provisional child label when
// one is missing.
canvasEl.addEventListener('dblclick', (ev) => {
  const w = clientToWorld(ev.clientX, ev.clientY);
  const label = pickLabel(w);
  if (label) inlineEditLabel(label);
  else {
    const hit = pickAt(w);
    const component = hit?.refdes ? circuit.components.get(hit.refdes) : null;
    const wire = pickWire(w);
    if (component) openComponentChildLabelEditor(component);
    else if (wire) {
      selectedWire = null;
      selectedWires.clear();
      selectedNets = new Set([wire.net.id]);
      render();
    }
  }
});

function openComponentChildLabelEditor(component) {
  if (!component || inlineInput) return;
  if (isReferenceMarker(component)) {
    openReferenceMarkerEditor(component);
    return;
  }
  if (component.type === 'block') {
    inlineEditSchematicBlock(component);
    return;
  }
  let label = circuit.labelOf(component.refdes);
  if (label) {
    inlineEditLabel(label);
    return;
  }
  // Legacy/imported symbols can lack the owned label that current inserts get
  // automatically. Create it at the symbol's declared label offset, then use
  // a draft edit so Escape/blank restores the pre-edit circuit unchanged.
  if (!component.def?.labelOffset || !circuit._ensureComponentInstanceLabel) return;
  const before = snapshot();
  label = circuit._ensureComponentInstanceLabel(component);
  if (label) inlineEditLabel(label, { ownedLabelDraft: true, initialSnapshot: before });
}
function openReferenceMarkerEditor(component) {
  if (!component || inlineInput) return;
  const existing = circuit.labelOf(component.refdes);
  if (existing) {
    inlineEditLabel(existing, { removeOnEmpty: true });
    return;
  }
  const info = referenceMarkerInfo(component.type);
  if (!info) return;
  const before = snapshot();
  const label = circuit.addLabel({
    text: component.value || '',
    owner: component.refdes,
    offset: info.labelOffset,
    align: 'center',
    style: { color: component.style.color },
  });
  inlineEditLabel(label, { markerDraft: true, initialSnapshot: before, removeOnEmpty: true });
}
function inlineEditLabel(label, options = {}) {
  if (!label || label.role === 'signal-input-sign' || inlineInput) return;
  const provisional = !!options.provisional;
  const equationDraft = !!options.equationDraft;
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
  // Ordinary Enter commits. Shift+Enter is reserved for inserting a newline
  // and is shared by every LabelInstance editor, including connector labels.
  const input = document.createElement('textarea');
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
  input.style.resize = 'none';
  input.style.whiteSpace = 'pre-wrap';
  input.style.overflow = 'hidden';
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
    input.style.height = `${Math.max(sh, input.value.split('\n').length * parseFloat(input.style.fontSize || '12') * 1.2 + 8)}px`;
  };
  resize();
  input.addEventListener('input', resize);
  document.body.appendChild(input);
  inlineInput = input;
  render();
  input.focus();
  if (equationDraft) input.setSelectionRange(Math.min(1, input.value.length), Math.min(1, input.value.length));
  else input.select();
  let closed = false;
  let prompting = false;
  const done = async (applyText) => {
    if (closed || prompting) return;
    const v = input.value.trim();
    const owner = label.owner ? circuit.components.get(label.owner) : null;
    const namesNet = !!label.netId || !!(owner && INTERFACE_PIN_TYPES.has(owner.type));
    if (applyText && v && v !== label.text && namesNet) {
      const targetNet = label.netId ? circuit.nets.get(label.netId) : interfacePortNet(owner);
      const conflicts = namedConnectionConflicts(v, {
        netId: targetNet?.id || null,
        ownerRefdes: owner?.refdes || null,
      });
      const portConflict = portNameConflict(conflicts, owner?.refdes);
      if (portConflict) {
        reportPortNameConflict(portConflict, v);
        input.focus();
        input.select();
        return false;
      }
      if (conflicts.length) {
        prompting = true;
        const connect = await confirmNamedConnection(v, conflicts);
        prompting = false;
        if (!connect) {
          input.focus();
          input.select();
          return false;
        }
      }
    }
    closed = true;
    inlineInput = null;
    measure.remove();
    input.remove();
    if (provisional) {
      if (applyText && v) {
        try {
          renameLabelThroughModel(label, v);
          recordHistoryEntry(initialSnapshot || snapshot());
        } catch (err) {
          logLine(`net label edit cancelled: ${err.message}`, 'error');
          restoreProvisionalLabel(label, initialName);
        }
      } else {
        restoreProvisionalLabel(label, initialName);
      }
      markModelChanged(false);
    } else if (options.markerDraft) {
      if (applyText) {
        try {
          label.setText(v);
          if (!v) circuit.removeLabel(label.id);
          recordHistoryEntry(initialSnapshot || snapshot());
        } catch (err) {
          logLine(`reference marker label edit cancelled: ${err.message}`, 'error');
          circuit.removeLabel(label.id);
        }
      } else {
        circuit.removeLabel(label.id);
      }
      markModelChanged(false);
    } else if (options.ownedLabelDraft) {
      if (applyText && v) {
        try {
          if (v !== label.text) renameLabelThroughModel(label, v);
          recordHistoryEntry(initialSnapshot || snapshot());
        } catch (err) {
          logLine(`component label edit cancelled: ${err.message}`, 'error');
          circuit.removeLabel(label.id);
        }
      } else if (circuit.labels.has(label.id)) {
        circuit.removeLabel(label.id);
      }
      markModelChanged(false);
    } else if (equationDraft) {
      // A fresh equation starts as `$$`; Escape, blur without content, or an
      // untouched draft should not leave a literal delimiter label behind.
      if (applyText && stripMathDelimiters(v)) {
        if (v !== label.text) commit(() => renameLabelThroughModel(label, v));
      } else if (circuit.labels.has(label.id)) commit(() => circuit.removeLabel(label.id));
    } else if (applyText && v && v !== label.text) {
      const owner = label.owner ? circuit.components.get(label.owner) : null;
      // Interface pins validate exactly like every other instance label: the
      // label is the component's identity, and a port additionally names its
      // net through the same rename.
      const ordinaryOwner = owner && !isReferenceMarker(owner) && !label.math;
      if (ordinaryOwner) {
        const canonical = normalizeComponentRefdes(v);
        if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(canonical)) {
          logLine(`Invalid component name "${v}".`, 'error');
        } else if (canonical !== owner.refdes && circuit.components.has(canonical)) {
          logLine(`Component name "${canonical}" is already in use.`, 'error');
        } else {
          commit(() => renameLabelThroughModel(label, v));
        }
      } else {
        commit(() => renameLabelThroughModel(label, v));
      }
    }
    else if (options.removeOnEmpty && !v) commit(() => {
      if (label.owner && isReferenceMarker(circuit.components.get(label.owner))) label.setText('');
      circuit.removeLabel(label.id);
    });
    render();
    return true;
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
    if (provisional) {
      renameLabelThroughModel(label, res.text);
      markModelChanged(false);
    } else commit(() => renameLabelThroughModel(label, res.text));
    render();
  };
  bindInlineEditorKeys(input, done, {
    extraKeys: (ev) => {
      if (ev.key === 'Tab') {
        ev.preventDefault();
        done(true).then((committed) => {
          if (committed) cycleLabelSelection(ev.shiftKey ? -1 : 1, label.id);
        });
        return true;
      }
      if ((ev.ctrlKey || ev.metaKey) && (ev.key === ',' || ev.key === '.')) {
        ev.preventDefault();
        toggleMarkup(ev.key === ',' ? '_' : '^');
        return true;
      }
      return false;
    },
  });
}

// ----- mouse wheel
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

let panelFilter = '';
let lastRevealedRow = '';

function panelFilterMatches(...values) {
  if (!panelFilter) return true;
  return values.some((value) => value && String(value).replace(/[_^{}]/g, '').toLowerCase().includes(panelFilter));
}

function setPanelCount(id, shown, total) {
  const el = document.getElementById(id);
  if (el) el.textContent = shown === total ? String(total) : `${shown}/${total}`;
}

function componentDisplayName(comp) {
  if (isReferenceMarker(comp)) return comp.refdes;
  return circuit.labelOf(comp.refdes)?.text || componentLabelText(comp.refdes);
}

/** Render `_{…}`/`^{…}` label markup as sub/superscript DOM text. */
function appendMarkupText(el, text) {
  for (const run of parseLabelRuns(String(text))) {
    const node = run.sub || run.super ? document.createElement(run.sub ? 'sub' : 'sup') : document.createTextNode(run.text);
    if (run.sub || run.super) node.textContent = run.text;
    el.appendChild(node);
  }
}

/** Keep a newly selected row visible without jumping on unrelated re-renders. */
function revealSelectedRow(row, key) {
  if (key === lastRevealedRow) return;
  lastRevealedRow = key;
  requestAnimationFrame(() => row.isConnected && row.scrollIntoView({ block: 'nearest' }));
}

/** Arrow keys walk a side-panel listbox; Enter and Space activate the row. */
function bindListboxRowKeys(listEl, row) {
  row.addEventListener('keydown', (ev) => {
    const step = ev.key === 'ArrowDown' || ev.key === 'ArrowRight' ? 1
      : ev.key === 'ArrowUp' || ev.key === 'ArrowLeft' ? -1 : 0;
    if (step) {
      const rows = [...listEl.querySelectorAll('[role="option"]')];
      rows[(rows.indexOf(row) + step + rows.length) % rows.length]?.focus();
      ev.preventDefault();
      return;
    }
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    ev.preventDefault();
    row.click();
  });
}

function renderComponents() {
  componentsListEl.innerHTML = '';
  componentsListEl.setAttribute('role', 'listbox');
  componentsListEl.setAttribute('aria-label', 'Components');
  componentsListEl.setAttribute('aria-multiselectable', 'true');
  const allComps = componentPaletteItems(sortedComps())
    .filter((comp) => !isTransientCopyGhostRef(comp.refdes));
  const comps = allComps.filter((comp) => panelFilterMatches(componentDisplayName(comp), comp.refdes, comp.type));
  setPanelCount('components-count', comps.length, allComps.length);
  if (comps.length === 0) {
    componentsListEl.innerHTML = `<div class="no-items">${allComps.length ? 'No matching components' : 'No components'}</div>`;
    return;
  }
  const primaryRef = selected && multi.has(selected) ? selected : [...multi][0];
  for (const comp of comps) {
    const row = document.createElement('div');
    row.className = 'row' + (multi.has(comp.refdes) ? ' selected' : '');
    row.dataset.ref = comp.refdes;
    row.dataset.refdes = comp.refdes;
    row.dataset.type = comp.type;
    row.setAttribute('role', 'option');
    row.tabIndex = multi.has(comp.refdes) || (!multi.size && comp.refdes === comps[0]?.refdes) ? 0 : -1;
    row.id = `component-option-${CSS.escape(comp.refdes)}`;
    row.setAttribute('aria-selected', String(multi.has(comp.refdes)));

    const ref = document.createElement('span');
    ref.className = 'ref';
    appendMarkupText(ref, componentDisplayName(comp));
    ref.title = isReferenceMarker(comp)
      ? 'Double-click to edit its label'
      : comp.type === 'block'
        ? 'Double-click to edit block text'
        : 'Double-click to rename';

    const meta = document.createElement('span');
    meta.className = 'meta';
    const analysisTags = [];
    if (comp.analysis?.model === 'triode') analysisTags.push('triode');
    if (comp.analysis?.role) analysisTags.push(comp.analysis.role);
    if (comp.analysis?.resistance === 'infinite' || comp.analysis?.resistance === true) analysisTags.push('R=∞');
    if (comp.analysis?.resistance === 'finite') analysisTags.push('finite R');
    if (comp.analysis?.channelLengthModulation === 'ignore') analysisTags.push('r_o→∞');
    if (comp.analysis?.channelLengthModulation === 'finite') analysisTags.push('finite r_o');
    if (comp.analysis?.gmroLarge === true) analysisTags.push('g_mr_o≫1');
    if (comp.analysis?.gmroLarge === false) analysisTags.push('finite g_mr_o');
    if (comp.analysis?.ignoreBodyEffect === true) analysisTags.push('V_BS=0');
    if (comp.analysis?.ignoreBodyEffect === false) analysisTags.push('body effect');
    meta.textContent = `${comp.type}${analysisTags.map((tag) => ` · ${tag}`).join('')}`;

    row.appendChild(ref);
    row.appendChild(meta);

    row.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      selectContextTarget({ kind: 'component', value: comp });
      render();
      openComponentContextMenu({ kind: 'component', value: comp }, ev.clientX, ev.clientY);
    });

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
        if (isReferenceMarker(comp)) openReferenceMarkerEditor(comp);
        else if (comp.type === 'block') inlineEditSchematicBlock(comp);
        else startComponentRename(comp, ref);
        return;
      }
      if (ev.shiftKey) {
        const refs = rangeValues(comps, componentRangeAnchor, comp.refdes, (item) => item.refdes);
        const next = ev.ctrlKey || ev.metaKey ? new Set(multi) : new Set();
        for (const refdes of (refs.length ? refs : [comp.refdes])) next.add(refdes);
        setSelection([...next], comp.refdes);
      } else if (ev.ctrlKey || ev.metaKey) {
        const next = new Set(multi);
        if (next.has(comp.refdes)) next.delete(comp.refdes); else next.add(comp.refdes);
        setSelection([...next], next.has(comp.refdes) ? comp.refdes : [...next][0]);
      } else {
        setSelection([comp.refdes]);
      }
      if (!ev.shiftKey) componentRangeAnchor = comp.refdes;
      netRangeAnchor = null;
      render();
    });
    row.addEventListener('dblclick', () => {
      // Native dblclick backup for browsers that deliver it (manual detection
      // in the click handler covers row replacement during the first click).
      if (isReferenceMarker(comp)) openReferenceMarkerEditor(comp);
      else if (comp.type === 'block') inlineEditSchematicBlock(comp);
      else startComponentRename(comp, ref);
    });
    bindListboxRowKeys(componentsListEl, row);

    componentsListEl.appendChild(row);
    if (comp.refdes === primaryRef) revealSelectedRow(row, `component:${primaryRef}`);
  }
}

function renderNets() {
  netsListEl.innerHTML = '';
  netsListEl.setAttribute('role', 'listbox');
  netsListEl.setAttribute('aria-label', 'Electrical nets');
  netsListEl.setAttribute('aria-multiselectable', 'true');
  const hiddenNetIds = transientCopyGhostNetIds();
  const visibleGroupNets = (net) => namedGroupNets(net).filter((candidate) => !hiddenNetIds.has(candidate.id));
  const allNets = visibleNets();
  const nets = allNets.filter((net) => panelFilterMatches(net.name, net.id));
  setPanelCount('nets-count', nets.length, allNets.length);
  if (nets.length === 0) {
    netsListEl.innerHTML = `<div class="no-items">${allNets.length ? 'No matching nets' : 'No nets'}</div>`;
    return;
  }
  const primaryNet = nets.find((net) => visibleGroupNets(net).some((candidate) => selectedNets.has(candidate.id)));
  for (const net of nets) {
    const groupedNets = visibleGroupNets(net);
    const groupedIds = groupedNets.map((candidate) => candidate.id);
    const groupSelected = groupedIds.some((id) => selectedNets.has(id));
    const row = document.createElement('div');
    row.className = 'row' + (groupSelected ? ' selected' : '');
    row.setAttribute('role', 'option');
    row.tabIndex = groupSelected || (!selectedNets.size && net.id === nets[0]?.id) ? 0 : -1;
    row.id = `net-option-${CSS.escape(net.id)}`;
    row.setAttribute('aria-selected', String(groupSelected));

    const ref = document.createElement('span');
    ref.className = 'ref';
    appendMarkupText(ref, net.name || net.id);
    ref.title = 'Double-click to rename';

    const meta = document.createElement('span');
    meta.className = 'meta';
    const terminalKeys = new Set(groupedNets.flatMap((grouped) => grouped.terminals.map((terminal) => `${terminal.comp}.${terminal.term}`)));
    const pins = terminalKeys.size;
    const analysisNet = groupedNets.find((grouped) => grouped.analysis?.acGround || grouped.analysis?.role) || net;
    const analysisTag = analysisNet.analysis?.acGround ? ' · AC ground' : analysisNet.analysis?.role ? ` · ${analysisNet.analysis.role}` : '';
    meta.textContent = `${pins} ${pins === 1 ? 'pin' : 'pins'}${analysisTag}`;
    const wireLength = groupedNets.reduce((total, grouped) => total + grouped.length(), 0);
    row.title = `${groupedNets.map((grouped) => grouped.id).join(', ')} · ${pins} ${pins === 1 ? 'terminal' : 'terminals'} · ${wireLength} units of wire${analysisNet.analysis?.acGround ? ' · DC bias / AC ground' : ''}`;

    row.appendChild(ref);
    row.appendChild(meta);

    row.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      selectContextTarget({ kind: 'net', value: net });
      render();
      openComponentContextMenu({ kind: 'net', value: net }, ev.clientX, ev.clientY);
    });

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
        const ids = rangeValues(nets, netRangeAnchor, net.id, (item) => item.id);
        const next = ev.ctrlKey || ev.metaKey ? new Set(selectedNets) : new Set();
        for (const id of (ids.length ? ids : [net.id])) {
          for (const grouped of visibleGroupNets(circuit.nets.get(id))) next.add(grouped.id);
        }
        selectedNets = next;
      } else if (ev.ctrlKey || ev.metaKey) {
        const next = new Set(selectedNets);
        if (groupSelected) for (const id of groupedIds) next.delete(id);
        else for (const id of groupedIds) next.add(id);
        selectedNets = next;
      } else {
        selectedNets = new Set(groupedIds);
      }
      componentRangeAnchor = null;
      if (!ev.shiftKey) netRangeAnchor = net.id;
      const pt = net.points()[Math.floor(net.points().length / 2)];
      if (pt) cursor = { x: pt.x, y: pt.y };
      render();
    });

    row.addEventListener('dblclick', () => {
      // Native dblclick backup for browsers that deliver it (the manual
      // detection above covers the row-replacing re-render case).
      startNetRename(net, ref);
    });
    bindListboxRowKeys(netsListEl, row);

    netsListEl.appendChild(row);
    if (net === primaryNet) revealSelectedRow(row, `net:${net.id}`);
  }
}

/** Open the inline refdes editor for a component row. Invalid or occupied
 * names are rejected before commit, leaving the model and selection untouched. */
/** Ctrl/Cmd+, and Ctrl/Cmd+. toggle sub/superscript markup in a plain name field. */
function bindMarkupShortcuts(input) {
  input.addEventListener('keydown', (ev) => {
    if (!(ev.ctrlKey || ev.metaKey) || (ev.key !== ',' && ev.key !== '.')) return;
    ev.preventDefault();
    const res = applyMarkup(input.value, input.selectionStart, input.selectionEnd, ev.key === ',' ? '_' : '^');
    if (!res) return;
    input.value = res.text;
    input.setSelectionRange(res.selStart, res.selEnd);
  });
}

function startComponentRename(comp, ref) {
  if (!comp || inlineInput) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'rename-input';
  const ordinaryInstance = !isReferenceMarker(comp);
  const currentLabel = ordinaryInstance ? circuit.labelOf(comp.refdes) : null;
  input.value = currentLabel?.text || (ordinaryInstance ? componentLabelText(comp.refdes) : comp.refdes);
  input.placeholder = input.value;
  input.spellcheck = false;
  bindMarkupShortcuts(input);
  ref.replaceWith(input);
  inlineInput = input;
  input.focus();
  input.select();
  let closed = false;
  let prompting = false;
  const done = async (applyText) => {
    if (closed || prompting) return;
    const value = input.value.trim();
    const next = normalizeComponentRefdes(value);
    if (applyText && next && next !== comp.refdes && INTERFACE_PIN_TYPES.has(comp.type)) {
      const conflicts = namedConnectionConflicts(value, { ownerRefdes: comp.refdes });
      const portConflict = portNameConflict(conflicts, comp.refdes);
      if (portConflict) {
        reportPortNameConflict(portConflict, value);
        input.focus();
        input.select();
        return;
      }
      if (conflicts.length) {
        prompting = true;
        const connect = await confirmNamedConnection(value, conflicts);
        prompting = false;
        if (!connect) {
          input.focus();
          input.select();
          return;
        }
      }
    }
    closed = true;
    inlineInput = null;
    input.replaceWith(ref);
    if (applyText && next && next !== comp.refdes &&
        /^[A-Za-z][A-Za-z0-9_]*$/.test(next) && !circuit.components.has(next)) {
      const previous = comp.refdes;
      const displayLabel = value;
      commit(() => circuit.renameComponent(previous, next, { displayLabel }));
      if (componentRangeAnchor === previous) componentRangeAnchor = next;
      if (selected === previous) selected = next;
      if (multi.has(previous)) {
        multi.delete(previous);
        multi.add(next);
      }
    } else if (applyText && next && next !== comp.refdes) {
      logLine(!/^[A-Za-z][A-Za-z0-9_]*$/.test(next)
        ? `Invalid component name "${value}".`
        : `Component name "${next}" is already in use.`, 'error');
    }
    render();
  };
  bindInlineEditorKeys(input, done);
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
  bindMarkupShortcuts(input);
  ref.replaceWith(input);
  input.focus();
  input.select();
  let closed = false;
  let prompting = false;
  const done = async (applyText) => {
    if (closed || prompting) return;
    const v = input.value.trim();
    if (applyText && v && v !== net.name) {
      const conflicts = namedConnectionConflicts(v, { netId: net.id });
      if (conflicts.length) {
        prompting = true;
        const connect = await confirmNamedConnection(v, conflicts);
        prompting = false;
        if (!connect) {
          input.focus();
          input.select();
          return;
        }
      }
    }
    closed = true;
    input.replaceWith(ref);
    if (applyText && v && v !== net.name) {
      // A sole port names its net, so this rename can rename that port too.
      // Carry the selection across with it, exactly like a component rename.
      const ports = net.terminals
        .map(({ comp }) => circuit.components.get(comp))
        .filter((component) => component && INTERFACE_PIN_TYPES.has(component.type));
      const previous = ports.length === 1 ? ports[0].refdes : null;
      commit(() => {
        circuit.renameNet(net.id, v);
        // A side-panel rename is an intentional editor action: promote any
        // compatibility child label synthesized by the model to a real local
        // reference label so the renamed rail no longer groups with VSS/VDD.
        circuit._markReferenceLabelsLocal?.(net);
      });
      const renamed = previous && ports[0].refdes !== previous ? ports[0].refdes : null;
      if (renamed) {
        if (componentRangeAnchor === previous) componentRangeAnchor = renamed;
        if (selected === previous) selected = renamed;
        if (multi.has(previous)) {
          multi.delete(previous);
          multi.add(renamed);
        }
      }
    }
    render();
  };
  bindInlineEditorKeys(input, done, { multiline: false });
}

function renderDetail() {
  detailEl.innerHTML = '';
  const label = selectedLabel();
  if (label) {
    const a = label.anchorWorld();
    const role = label.isNetLabel?.() ? 'Net label' : label.owner ? 'Instance label' : 'Annotation';
    const rows = [['Role', role], ['Align', label.align], ['Anchor', `${a.x}, ${a.y}`]];
    if (label.owner) rows.push(['Owner', label.owner]);
    if (label.netId) rows.push(['Net', circuit.nets.get(label.netId)?.name || label.netId]);
    detailEl.appendChild(detailHeader(label.text || '(empty)', label.kind === 'label' ? '' : label.kind));
    const list = document.createElement('dl');
    list.className = 'detail-props';
    for (const [key, value] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = key;
      const dd = document.createElement('dd');
      dd.textContent = value;
      list.append(dt, dd);
    }
    detailEl.appendChild(list);
    return;
  }

  const comp = selectedComp();
  if (!comp) {
    detailEl.innerHTML = '<div class="no-items">Select a component or label to inspect it</div>';
    return;
  }
  if (isTransientCopyGhostRef(comp.refdes)) {
    detailEl.innerHTML = '<div class="no-items">Copy ghost — commit it to inspect its terminals</div>';
    return;
  }

  detailEl.appendChild(detailHeader(componentDisplayName(comp), comp.value ? `${comp.type} · ${comp.value}` : comp.type));
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Pin</th><th>Net</th><th>Position</th></tr>';
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const t of comp.worldTerminals()) {
    const tr = document.createElement('tr');
    const net = circuit.netOfTerminal(`${comp.refdes}.${t.name}`);
    const nameTd = document.createElement('td');
    nameTd.textContent = t.name;
    nameTd.className = 'pin-name';
    const netTd = document.createElement('td');
    if (net) {
      appendMarkupText(netTd, net.name || net.id);
      netTd.className = 'net-label';
      netTd.title = net.id;
    } else {
      netTd.textContent = 'unconnected';
      netTd.className = 'off-grid';
    }
    const posTd = document.createElement('td');
    posTd.textContent = `${t.x}, ${t.y}`;
    if (t.x % GRID !== 0 || t.y % GRID !== 0) {
      posTd.className = 'off-grid';
      posTd.title = 'Off the placement grid';
    }
    tr.append(nameTd, netTd, posTd);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  detailEl.appendChild(table);
}

function detailHeader(name, kind) {
  const header = document.createElement('div');
  header.className = 'detail-header';
  const title = document.createElement('span');
  title.className = 'detail-name';
  appendMarkupText(title, name);
  header.appendChild(title);
  if (kind) {
    const meta = document.createElement('span');
    meta.className = 'detail-kind';
    meta.textContent = kind;
    header.appendChild(meta);
  }
  return header;
}

const TERM_LETTERS = new Set(['a', 'b', 'c', 'd', 'e', 'g', 'p', 's']);

function onWireKey(key) {
  if (key === 'Escape') {
    wire = null;
    terminalSnap = false;
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
    } else if (!comp.terminalDefs.some((terminal) => terminal.name === key)) {
      logLine(`${comp.refdes} has no terminal "${key}" (${comp.terminalDefs.map((terminal) => terminal.name).join(',')})`);
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
  A: 'and2_gate',
  b: 'buffer',
  I: 'input',
  o: 'output',
  O: 'inputoutput',
  a: 'solder',
};

// Human-facing names keep the picker useful at a glance. Aliases stay out of
// the menu while the underlying type remains the stable placement value.
// The registry is the single source of truth for insertable components.
// Grouping is derived from the type name, so adding a symbol to symbolTypes
// automatically adds it to the appropriate menu section.
const INSERT_COMPONENT_TYPES = [...symbolTypeNames];
// Browse order is analog first, digital second, with the interface ports kept
// above both macros and the digital cells. A query reorders the groups by their
// best match instead, so this is the order of the unfiltered list.
const INSERT_CATEGORY_RULES = [
  ['Passives', /^(variable_)?(resistor|capacitor|inductor)$|^diode$/],
  ['Semiconductors / actives', /^(nmos|pmos|nmosb|pmosb|npn|pnp)$/],
  ['Switches', /^switch_/],
  ['Sources & power', /^(current_source|voltage_source|vccs|supply|ground|vcm)$/],
  ['Interfaces / ports', /^(input|output|inputoutput|port)$/],
  ['Macros', /^(opamp|opamp_diff|adc|dac)$/],
  ['Logic', /^(inverter|buffer|tristate_(inverter|buffer)|mux2|.*_gate)$/],
  ['Sequential', /^(?:dff|latch)(?:_|$)/],
  ['Blocks / shells', /^block$/],
  ['Signal flow', /^signal_(sum|multiply)$/],
];

/** Rank a component/label name against a fuzzy query (subsequence match).
 *  Returns a score >= 0 for a match (higher = better) or -1 for no match.
 *  Prefix hits beat substring hits, which beat pure subsequences; shorter
 *  names win ties. */
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

// Arrow-key highlight in the insert picker. It belongs to one query string, so
// typing or deleting a character returns the highlight to the best match.
let insertNav = { query: '', index: 0 };

function insertHighlightIndex(entries = insertMenuEntries()) {
  if (insertNav.query !== insertQuery || !entries.length) return 0;
  return Math.min(insertNav.index, entries.length - 1);
}

/** Up/Down step through matches; Left/Right jump to the previous/next category. */
function moveInsertHighlight(key) {
  const groups = insertMenuGroups();
  const entries = groups.flatMap((group) => group.entries);
  if (!entries.length) return;
  let index = insertHighlightIndex(entries);
  if (key === 'ArrowDown') index = (index + 1) % entries.length;
  else if (key === 'ArrowUp') index = (index - 1 + entries.length) % entries.length;
  else {
    const starts = [];
    let offset = 0;
    for (const group of groups) { starts.push(offset); offset += group.entries.length; }
    const current = starts.findLastIndex((start) => start <= index);
    if (key === 'ArrowRight') index = starts[(current + 1) % starts.length];
    else if (index !== starts[current]) index = starts[current];
    else index = starts[(current - 1 + starts.length) % starts.length];
  }
  insertNav = { query: insertQuery, index };
}

function selectInsertMatch() {
  const entries = insertMenuEntries();
  if (!entries.length) return false;
  return pickInsertType(entries[insertHighlightIndex(entries)]);
}

/** Arm the ghost for one picked entry.  Shared by Enter/Tab and menu clicks. */
function pickInsertType(type) {
  if (!type) return false;
  const startWorld = { ...cursor };
  insertNav = { query: '', index: 0 };
  pendingPlace = type === 'label'
    ? { kind: 'label', startWorld }
    : { kind: 'component', type, rotation: 0, mirrorX: null, mirrorY: null, startWorld };
  if (altHeld && pendingPlace.kind === 'component') setSymmetry(true);
  insertQuery = '';
  return true;
}

function onInsertKey(key, shiftKey = false) {
  if (key === 'u' && pendingPlace) {
    undo();
    return;
  }
  // Arrow keys browse the picker; once a ghost exists they move the cursor and ghost.
  const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key];
  if (arrow && !pendingPlace) {
    moveInsertHighlight(key);
    render();
    return;
  }
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

  // Escape peels one layer at a time: the mirror axis first, so a new one can
  // be started without losing the ghost, then the ghost, then insert mode.
  if (symmetry && key === 'Escape') {
    clearSymmetry();
    logLine('symmetry axis cleared');
    render();
    return;
  }

  // A placement ghost is pending: Enter/click commits it; Esc drops it back to
  // the search picker so a different component can be typed.
  if (pendingPlace) {
    if (key === 'Enter') {
      commit(() => placePending());
      render();
    } else if (key === 'Escape' || key === 'Backspace') {
      pendingPlace = null;
      clearSymmetry();
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
    insertNav = { query: '', index: 0 };
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
/** Looking at the drawing is not a mode. The grid, guides, crosshair, theme,
 *  fit and help change what is on screen rather than what is in the document,
 *  so they answer while a ghost is armed, a wire is half drawn, or a marquee
 *  is open -- the editor should never make someone finish an edit to turn a
 *  toggle. The one place they must not is insert mode before a ghost exists,
 *  where every printable key is search text. Returns true when handled. */
function viewKey(key, shiftKey = false) {
  if (mode === 'insert' && !pendingPlace) return false;
  if (key === 'F' || key === 'f') fitView();
  else if (key === '#') setGrid(!showGrid);
  else if (key === 'C' || (key === 'c' && shiftKey)) setCrosshair(!crosshairVisible);
  else if (key === 'G' || (key === 'g' && shiftKey)) setGuides(!guidesVisible);
  else if (key === 'D') toggleTheme();
  else if (key === '?') showHelp();
  else return false;
  return true;
}

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
    if (shiftKey) {
      const point = constrainedWorld(drag.startWorld, cursor, true);
      drag.shift = true;
      moveCopyGhost(point);
      cursor = snappedWorld(point);
    }
    commitCopyGhost();
    return;
  }
  if (movePending && key === 'Enter') {
    if (drag) drag.shift = shiftKey;
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
  if (key === 'Enter' && labelMode === 'arrow' && annotationPoints.length >= 2) {
    commitArrowAnnotation(true);
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

  if (key === 'e') {
    activateEquation();
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
    const hasWireSelection = selectedWires.size > 0 || !!selectedWire || selectedNets.size > 0;
    if (comps.length || labs.length || hasWireSelection) {
      const dx = nudgeKey[0] * count * GRID;
      const dy = nudgeKey[1] * count * GRID;
      const changed = transformMixedSelection('translate', { translation: { dx, dy } });
      const primary = comps.find((c) => c.refdes === selected) || comps[0];
      const a = labs.length ? labs[0].anchorWorld() : null;
      if (primary) cursor = { x: primary.transform.x, y: primary.transform.y };
      else if (a) cursor = { x: a.x, y: a.y };
      if (changed && drag?.mode === 'copyghost') refreshCopyGhostBase({ translation: { dx, dy } });
      followCursor();
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
      if (drag?.mode !== 'copyghost' && primary) cursor = { x: primary.transform.x, y: primary.transform.y };
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

let helpCommandText = '';

function helpKeyNodes(keys) {
  const container = document.createElement('span');
  container.className = 'help-keys';
  keys.split(' / ').forEach((alternative, index) => {
    if (index) container.append(document.createTextNode(' / '));
    const note = alternative.match(/^(.*?)\s+(\([^)]*\))$/);
    const combo = note ? note[1] : alternative;
    // Named gestures and console commands read as text; key combinations get caps.
    if (/\s/.test(combo) && !/^(Arrow keys)$/.test(combo)) {
      const code = document.createElement('code');
      code.textContent = combo;
      container.append(code);
    } else {
      combo.split(/\+(?=.)/).forEach((part, partIndex) => {
        if (partIndex) container.append(document.createTextNode('+'));
        const kbd = document.createElement('kbd');
        kbd.textContent = part;
        container.append(kbd);
      });
    }
    if (note) container.append(document.createTextNode(` ${note[2]}`));
  });
  return container;
}

function renderHelpSearch() {
  if (!helpDialogContent) return;
  const query = helpSearch?.value.trim().toLowerCase() || '';
  const matches = (...parts) => !query || parts.some((part) => part.toLowerCase().includes(query));
  helpDialogContent.replaceChildren();
  const grid = document.createElement('div');
  grid.className = 'help-sections';
  let count = 0;
  for (const [section, entries] of editorKeymap()) {
    const rows = entries.filter(([keys, description]) => matches(keys, description, section));
    if (!rows.length) continue;
    const block = document.createElement('section');
    block.className = 'help-section';
    const title = document.createElement('h3');
    title.textContent = section;
    block.appendChild(title);
    for (const [keys, description] of rows) {
      const row = document.createElement('div');
      row.className = 'help-row';
      const text = document.createElement('span');
      text.className = 'help-description';
      text.textContent = description;
      row.append(helpKeyNodes(keys), text);
      block.appendChild(row);
      count++;
    }
    grid.appendChild(block);
  }
  if (grid.childElementCount) helpDialogContent.appendChild(grid);
  const commandLines = helpCommandText.split('\n').filter((line) => matches(line));
  if (commandLines.length) {
    const commands = document.createElement('details');
    commands.className = 'help-commands';
    commands.open = !!query;
    const summary = document.createElement('summary');
    summary.textContent = 'Console commands';
    const pre = document.createElement('pre');
    pre.textContent = commandLines.join('\n');
    commands.append(summary, pre);
    helpDialogContent.appendChild(commands);
    count += commandLines.length;
  }
  if (!count) {
    const empty = document.createElement('p');
    empty.className = 'help-empty';
    empty.textContent = `Nothing matches "${helpSearch.value.trim()}".`;
    helpDialogContent.appendChild(empty);
  }
}

function showHelp() {
  if (!helpDialog) return;
  try {
    helpCommandText = commandHelp();
  } catch (err) {
    helpCommandText = String(err.message || err);
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

/** Copied selection. `nets` are complete electrical nets; `fragments` are
 * terminal-less geometric islands extracted from selected segments. A net label
 * selected on its own is stored in `labels` as a floating annotation. */
let clipboard = null;

function copySelection() {
  const parts = resolveCopySelection(circuit, copySelectionSource());
  const { comps, freeLabels } = parts;
  if (!comps.length && !freeLabels.length && !parts.nets.length && !parts.fragments.length) {
    logLine('nothing selected to copy');
    return false;
  }
  const nets = parts.nets.map((net) => ({
    id: net.id,
    name: net.name,
    routingMode: net.routingMode,
    drawOrder: net.drawOrder,
    terminals: net.terminals.map((t) => ({ comp: t.comp, term: t.term })),
    ...captureRouteGeometry(net),
    fixedPaths: net.routingMode === 'fixed' ? cloneFixedPaths(net.fixedPaths) : null,
    netLabels: circuit.netLabels(net).map((label) => ({
      netId: net.id,
      text: label.text,
      align: label.align,
      netSide: label.netSide,
      x: label.anchorWorld().x,
      y: label.anchorWorld().y,
    })),
  }));
  const fragments = parts.fragments.map(({ net, paths, junctions }) => ({
    name: net.name, routingMode: net.routingMode, allowDiagonal: net.allowDiagonal,
    drawOrder: net.drawOrder, paths, junctions,
  }));
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
      negativeInputs: c.negativeInputs ? [...c.negativeInputs] : [],
      style: { ...(c.style || {}) },
    })),
    labels: freeLabels.map(copyableLabelPayload),
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
      if (label.points) label.points = label.points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
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
  circuit.invalidateRoutingCache();
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
  markModelChanged();
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
  if (altHeld) setSymmetry(true);
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
  // Aim the axis from the new cursor and, the first time it has a direction,
  // arm the mirror while the primary is still sitting at its base.
  if (symmetry && !symmetry.settled) {
    cursor = { x: snap(w.x), y: snap(w.y) };
    if (symmetry.waitingForMotion) {
      const armed = symmetry.armedCursor || symmetry.pin;
      if (cursor.x !== armed.x || cursor.y !== armed.y) symmetry.waitingForMotion = false;
    }
    syncSymmetryOperation();
  }
  if (symmetry?.operation && !ghost.mirror) armCopyGhostMirror();
  const dx = snap(w.x) - snap(drag.startWorld.x);
  const dy = snap(w.y) - snap(drag.startWorld.y);
  translateCopyGhost(ghost, dx, dy);
  if (ghost.mirror) {
    restoreCopyGhostGeometry(ghost.mirror);
    // Reflecting a translated set is the same as translating the reflected
    // one by the reflected delta, so the mirror never has to be rebuilt.
    translateCopyGhost(ghost.mirror,
      symmetry?.operation === 'mirrorY' ? dx : -dx,
      symmetry?.operation === 'mirrorY' ? -dy : dy);
  }
  restoreCopyGhostSelection(ghost);
  cursor = { x: snap(w.x), y: snap(w.y) };
  markModelChanged();
}

/** Arm the mirrored half of a copy ghost. Duplicate the primary ghost's
 *  current state first, so an explicit rotate/mirror performed before Alt is
 *  preserved, then reflect that duplicate about the drag-selected axis.
 *  Keeping its own base geometry means every later pointer move is only a
 *  translation, since reflecting a translated set is the same as translating
 *  the reflected one by the reflected delta. */
function armCopyGhostMirror() {
  const ghost = drag?.ghost;
  if (!ghost || !symmetry?.operation || ghost.mirror || !clipboard) return false;
  const beforeSnapshot = snapshot();
  const existingNets = new Set(circuit.nets.keys());
  const existingComps = new Set(circuit.components.keys());
  const existingLabels = new Set(circuit.labels.keys());
  const savedCursor = { ...cursor };
  const savedClipboard = clipboard;
  // Re-copy the live primary ghost instead of using the original clipboard.
  // This carries its current component transforms, labels, and internal nets
  // into the new half before the symmetry transform is applied.
  restoreCopyGhostSelection(ghost);
  if (!copySelection()) {
    clipboard = savedClipboard;
    cursor = savedCursor;
    return false;
  }
  cursor = { ...clipboard.anchor };
  try {
    pasteClipboard({ recordHistory: false, connect: false });
  } finally {
    clipboard = savedClipboard;
    cursor = savedCursor;
  }
  const mirror = {
    refs: [...circuit.components.keys()].filter((ref) => !existingComps.has(ref)),
    labels: [...circuit.labels.keys()].filter((id) => !existingLabels.has(id)),
    netIds: [...circuit.nets.keys()].filter((id) => !existingNets.has(id)),
    wireKeys: [],
    beforeSnapshot,
  };
  if (!mirror.refs.length && !mirror.labels.length) {
    circuit = Circuit.fromJSON(JSON.parse(beforeSnapshot));
    cursor = savedCursor;
    return false;
  }
  restoreCopyGhostSelection(mirror);
  const moved = transformMixedSelection(symmetry.operation, { recordHistory: false, center: symmetry.pin });
  cursor = savedCursor;
  if (moved === false) {
    circuit = Circuit.fromJSON(JSON.parse(beforeSnapshot));
    restoreCopyGhostSelection(ghost);
    logLine('mirrored copy: this selection cannot be reflected whole', 'error');
    return false;
  }
  mirror.baseGeometry = captureCopyGhostGeometry(mirror);
  ghost.mirror = mirror;
  restoreCopyGhostSelection(ghost);
  markModelChanged();
  return true;
}

/** Drop the mirrored half, leaving the primary ghost exactly where it is.
 *  The mirror's snapshot is intentionally based at the ghost's original
 *  placement, so restore it and replay the primary ghost's current delta
 *  before removing the mirror. Otherwise releasing Alt snaps the primary
 *  ghost back onto the source component. */
function dropCopyGhostMirror() {
  const ghost = drag?.ghost;
  if (!ghost?.mirror) return;
  const dx = snap(cursor.x) - snap(drag.startWorld.x);
  const dy = snap(cursor.y) - snap(drag.startWorld.y);
  // The mirror snapshot has the primary ghost at its base position, which is
  // deliberately allowed to overlap the source while the ghost is transient.
  // A normal fromJSON() repairs that overlap into real electrical contacts;
  // keep this restore topology-only until the primary has been translated.
  const beforeMirror = JSON.parse(ghost.mirror.beforeSnapshot);
  beforeMirror.topologyOnly = true;
  circuit = Circuit.fromJSON(beforeMirror);
  ghost.mirror = null;
  translateCopyGhost(ghost, dx, dy);
  restoreCopyGhostSelection(ghost);
  markModelChanged();
}

function commitCopyGhost() {
  if (!drag?.ghost) return false;
  const ghost = drag.ghost;
  // The mirror was pasted after `beforeSnapshot`, so both halves already sit
  // inside the one history entry recorded below.
  const refs = [...ghost.refs, ...(ghost.mirror?.refs || [])];
  circuit.connectCoincident(refs);
  circuit.reconnectCoincidentNets();
  circuit.ensureUniqueTerminals(refs);
  circuit.syncJunctionSolders();
  recordHistoryEntry(ghost.beforeSnapshot);
  const anchorShift = ghost.anchorShift;
  const mirrored = !!ghost.mirror;
  drag = null;
  copyPending = false;
  startCopyGhost({ x: cursor.x, y: cursor.y }, { x: 0, y: 0 }, anchorShift);
  if (mirrored && symmetry?.operation) armCopyGhostMirror();
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
          negativeInputs: c.negativeInputs,
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
    recordHistoryEntry(before);
    markModelChanged(); // commands can re-route / splice nets or mutate block geometry
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

/** Short the nets crossing at a just-placed solder dot. Returns true when the
 * short is waiting for a net-name choice (the picker opens after render). */
function shortNetsAtPlacedSolder(comp) {
  const point = { x: comp.transform.x, y: comp.transform.y };
  try {
    const net = circuit.shortNetsAt(point);
    if (net) logLine(`solder joined nets at (${point.x},${point.y}) into ${net.name || net.id}`);
    return false;
  } catch (err) {
    if (err.code !== 'net-name-choice') throw err;
    pendingSolderNameChoice = { point, refdes: comp.refdes, names: err.names, historyLength: history.length };
    requestAnimationFrame(openSolderNameMenu);
    return true;
  }
}

let pendingSolderNameChoice = null;
let contextMenuDismiss = null;

/** Ask which given name the shorted net keeps. Escape or an outside click
 * cancels the whole placement, removing the dot. */
function openSolderNameMenu() {
  const choice = pendingSolderNameChoice;
  if (!choice || !componentContextMenuEl) return;
  closeComponentContextMenu();
  const menu = componentContextMenuEl;
  menu.hidden = false;
  const at = worldToClient(choice.point.x, choice.point.y);
  menu.style.left = `${Math.max(4, Math.min(at.x + 18, window.innerWidth - 220))}px`;
  menu.style.top = `${Math.max(4, at.y - 12)}px`;
  const heading = document.createElement('div');
  heading.className = 'context-menu-heading';
  heading.textContent = 'Keep net name';
  menu.appendChild(heading);
  for (const name of choice.names) {
    const item = appendContextItem(menu, '', () => {
      contextMenuDismiss = null;
      pendingSolderNameChoice = null;
      const before = snapshot();
      try {
        const net = circuit.shortNetsAt(choice.point, { name });
        markModelChanged();
        playCommitFeedback(before);
        logLine(`solder joined nets at (${choice.point.x},${choice.point.y}) into ${net?.name || net?.id}`);
      } catch (err) {
        logLine(`solder cancelled: ${err.message}`, 'error');
        cancelSolderPlacement(choice);
      }
    });
    const text = document.createElement('span');
    appendMarkupText(text, name);
    item.prepend(text);
  }
  contextMenuDismiss = () => {
    pendingSolderNameChoice = null;
    cancelSolderPlacement(choice);
    logLine('solder cancelled: no net name chosen');
    render();
  };
  const rect = menu.getBoundingClientRect();
  if (rect.bottom > window.innerHeight - 4) menu.style.top = `${Math.max(4, window.innerHeight - 4 - rect.height)}px`;
  menu.querySelector('button')?.focus();
}

function cancelSolderPlacement(choice) {
  if (history.length === choice.historyLength) {
    // The placement was the latest commit: undo it without a redo entry.
    circuit = Circuit.fromJSON(JSON.parse(history.pop()));
  } else {
    circuit.components.delete(choice.refdes);
    circuit.syncJunctionSolders();
  }
  markModelChanged();
}

/** Briefly pulse a rail button to confirm a tool or wire-shape change. */
function flashToolButton(button) {
  if (!button) return;
  button.classList.remove('tool-flash');
  void button.offsetWidth; // restart the animation when switching quickly
  button.classList.add('tool-flash');
  button.addEventListener('animationend', () => button.classList.remove('tool-flash'), { once: true });
}

let lastToolbarState = null;
let lastModeToolbarControl = null;

function modeToolbarControlFor(state) {
  if (!modeToolbarEl) return null;
  return toolbarElements(state.toolbar).find((el) => (
    el.classList.contains('mode-control')
    && !el.hidden
    && el.closest('.mode-toolbar') === modeToolbarEl
  )) || null;
}

/** Reveal a newly selected mode with the smallest possible rail scroll. */
function revealModeToolbarControl(control) {
  if (!modeToolbarEl || !control) return;
  const horizontal = getComputedStyle(modeToolbarEl).flexDirection === 'row';
  const rail = modeToolbarEl.getBoundingClientRect();
  const visibleLeft = rail.left + modeToolbarEl.clientLeft;
  const visibleTop = rail.top + modeToolbarEl.clientTop;
  const visibleRight = visibleLeft + modeToolbarEl.clientWidth;
  const visibleBottom = visibleTop + modeToolbarEl.clientHeight;
  const target = control.getBoundingClientRect();
  const nextScroll = horizontal
    ? minimalRevealScroll(visibleLeft, visibleRight, target.left, target.right, modeToolbarEl.scrollLeft, Math.max(0, modeToolbarEl.scrollWidth - modeToolbarEl.clientWidth))
    : minimalRevealScroll(visibleTop, visibleBottom, target.top, target.bottom, modeToolbarEl.scrollTop, Math.max(0, modeToolbarEl.scrollHeight - modeToolbarEl.clientHeight));
  if (horizontal) {
    if (Math.abs(nextScroll - modeToolbarEl.scrollLeft) > 0.5) modeToolbarEl.scrollLeft = nextScroll;
  } else {
    if (Math.abs(nextScroll - modeToolbarEl.scrollTop) > 0.5) modeToolbarEl.scrollTop = nextScroll;
  }
}

/** Apply all interaction affordances from one derived state. */
function syncInteractionUI() {
  const state = interactionState();
  const modeControl = modeToolbarControlFor(state);
  if (lastToolbarState !== null && state.toolbar !== lastToolbarState) {
    for (const el of toolbarElements(state.toolbar)) {
      if (el.classList.contains('mode-control') && !el.hidden) flashToolButton(el);
    }
  }
  if (modeControl && modeControl !== lastModeToolbarControl) revealModeToolbarControl(modeControl);
  lastToolbarState = state.toolbar;
  lastModeToolbarControl = modeControl;
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
  syncToolCursor(state);
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
  const parts = [analysisPick ? 'PICK NET' : interaction.label, `sel ${sel}`, `@${cursor.x},${cursor.y}`];
  if (analysisPick) parts.push('click a wire or pin for the analysis node · Esc cancel');
  if (visual) {
    parts.push('box from cursor · arrows grow · Enter select · Esc cancel');
  }
  if (mode === 'insert') {
    parts.push(pendingPlace ? `place ${pendingPlace.kind === 'label' ? 'label' : pendingPlace.type} @ click/Enter · arrows move · R/Shift+R/Ctrl+R · Alt symmetric · Esc cancel` : insertQuery ? `~${insertQuery} · Enter pick` : 'type or alias to filter · Esc exit');
  }
  if (symmetry) {
    const mirroring = drag?.mode === 'copyghost' ? !!drag.ghost?.mirror : !!symmetryTwin();
    parts.push(symmetry.operation
      ? `SYMMETRY about ${symmetryAxisText()}${symmetry.settled ? ' (held)' : ''}${activeSymmetryCells ? ` · ${activeSymmetryCells} ${activeSymmetryCells === 1 ? 'cell' : 'cells'} each side, ${activeSymmetryCells * 2} apart` : ''}${mirroring ? (drag?.mode === 'copyghost' ? ' · commits both' : ' · Enter places both') : ' · on the axis'}`
      : `SYMMETRY armed at (${symmetry.pin.x},${symmetry.pin.y}) · move to mirror`);
  }
  if (activePlacementGuides.length) parts.push(describeGuides(activePlacementGuides));
  if (labelMode === 'net') parts.push('click wire · selected/highlighted net resolves crossings · Esc cancel');
  if (labelMode === 'annotation') parts.push('click anywhere for free text · Esc cancel');
  if (labelMode === 'equation') parts.push('click anywhere for LaTeX equation · Enter/blur commit · Esc cancel');
  if (wire) {
    parts.push(
      `${terminalSnap ? 'TERMINAL SNAP · ' : ''}` + (wire.source
        ? wire.source.fixed
          ? `WIRE fixed endpoint @ (${wire.source.fixed.point.x},${wire.source.fixed.point.y}) → click points / target`
          : wire.source.refdes
            ? `WIRE ${wire.source.refdes}.${wire.source.term} → terminal click commits · other clicks guide · Enter commits`
            : `WIRE (${wire.source.x},${wire.source.y}) → terminal click commits · other clicks guide · Enter commits`
        : `WIRE (${wire.routeStyle || routeMode}): click a terminal or point to start`),
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
  if (clipboardNotice) parts.unshift(clipboardNotice);
  statusEl.textContent = parts.join('  ·  ');
  statusEl.className = `status ${interaction.key}`;
  if (directWire) statusEl.classList.add('direct-wire');
  else if (wire) statusEl.classList.add('wire');
  else if (mode === 'insert') statusEl.classList.add('insert');
}

// ----- insert-mode menu ----------------------------------------------------
// A dropdown listing every placable component, shown in insert mode until a
// ghost is armed. It is anchored where insert mode opened rather than dragged
// along by the pointer, so the mouse can reach it: hovering highlights an
// entry and clicking arms it, exactly like the keyboard highlight and Enter.
let insertMenu = null;
let insertMenuAnchor = null; // world point the menu hangs from
// The types most recently placed, newest first. It is session state, never
// persisted and never part of a document: it follows what is being drawn right
// now, so reopening a file does not inherit someone else's shortcuts.
let insertRecentTypes = [];

/** Record one committed placement at the head of the Recent group. */
function rememberInsertType(type) {
  insertRecentTypes = withRecentType(insertRecentTypes, type, INSERT_RECENT_LIMIT);
}
// Every registered symbol type appears in the menu automatically; the list is
// fuzzy-filtered by the live `insertQuery` while typing.
function insertMenuEntries() {
  return insertMenuGroups().flatMap((group) => group.entries);
}

function insertMenuGroups() {
  const availableTypes = INSERT_COMPONENT_TYPES;
  const groups = INSERT_CATEGORY_RULES.map(([title, rule]) => ({
    title,
    entries: availableTypes.filter((type) => rule.test(type)),
  }));
  groups.push({ title: 'Annotations', entries: ['solder', 'label'] });
  if (!insertQuery) {
    const placeable = new Set(groups.flatMap((group) => group.entries));
    const recent = insertRecentTypes.filter((type) => placeable.has(type));
    // The recents repeat their category entry rather than being moved out of
    // it, so the list below stays the complete, stable index it is browsed as.
    const listed = recent.length ? [{ title: 'Recent', entries: recent }, ...groups] : groups;
    return listed.filter((group) => group.entries.length);
  }
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

const symbolPreviewCache = new Map();

/** Small cached drawing of a placeable type for the insert menu. */
function symbolPreviewSvg(type) {
  if (symbolPreviewCache.has(type)) return symbolPreviewCache.get(type);
  let svg = '';
  if (type === 'label') {
    svg = '<svg viewBox="0 0 24 24"><path d="M5 5h14M12 5v14M8 19h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  } else if (type === 'block') {
    svg = '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  } else {
    try {
      const preview = new Circuit();
      preview.addComponent(type, { x: 0, y: 0, noLabel: true });
      const b = preview.bounds(6);
      svg = svgString(preview, { grid: false, terminals: false, junctions: false, background: false, themeInk: true })
        .replace(/viewBox="[^"]*"/, `viewBox="${b.x} ${b.y} ${b.w} ${b.h}" preserveAspectRatio="xMidYMid meet"`);
    } catch { svg = ''; }
  }
  symbolPreviewCache.set(type, svg);
  return svg;
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
    insertNav = { query: '', index: 0 };
    insertMenuAnchor = { ...cursor };
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
  const highlight = insertHighlightIndex(insertMenu._entries);
  const body = document.createElement('div');
  body.className = 'insert-menu-body';
  insertMenu.appendChild(body);
  const items = [];
  for (const group of groups) {
    const section = document.createElement('div');
    section.className = 'insert-menu-group';
    const heading = document.createElement('div');
    heading.className = 'insert-menu-category';
    heading.textContent = group.title;
    section.appendChild(heading);
    for (const type of group.entries) {
      const index = items.length;
      const item = document.createElement('div');
      item.className = `insert-menu-item${index === highlight ? ' active' : ''}`;
      const preview = document.createElement('span');
      preview.className = 'insert-menu-preview';
      preview.innerHTML = symbolPreviewSvg(type);
      const name = document.createElement('span');
      name.textContent = PLACEMENT_LABELS[type] || type;
      const hint = document.createElement('kbd');
      hint.textContent = 'Enter';
      item.append(preview, name, hint);
      // Hovering moves the same highlight the arrow keys move, in place: a
      // rebuild under the pointer would restart hover on every mouse move.
      item.addEventListener('mousemove', () => {
        if (insertNav.query === insertQuery && insertNav.index === index) return;
        insertNav = { query: insertQuery, index };
        for (const [i, el] of items.entries()) el.classList.toggle('active', i === index);
      });
      item.addEventListener('mousedown', (ev) => {
        ev.preventDefault(); // keep the canvas focused so keys still reach the editor
        if (!pickInsertType(type)) return;
        render();
      });
      items.push(item);
      section.appendChild(item);
    }
    body.appendChild(section);
  }
  insertMenu.style.display = 'block';
  // The body is one scrolling column, so most of the list is out of sight:
  // the highlight scrolls itself into view to stay reachable by keyboard.
  items[highlight]?.scrollIntoView({ block: 'nearest' });

  const p = worldToClient(insertMenuAnchor?.x ?? cursor.x, insertMenuAnchor?.y ?? cursor.y);
  const rect = insertMenu.getBoundingClientRect();
  let left = p.x + 14;
  let top = p.y - rect.height / 2;
  if (left + rect.width > window.innerWidth - 8) left = p.x - rect.width - 14;
  left = Math.max(8, Math.min(left, window.innerWidth - rect.width - 8));
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
  terminalSnap = false;
  pendingPlace = null;
  clearSymmetry();
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

function activateEquation() {
  activateLabelPlacement('equation');
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
  terminalSnap = false;
  pendingPlace = null;
  clearSymmetry();
  insertQuery = '';
  render();
}

function activateSelect() {
  if (hasWireDraft() || hasModalPlacement()) { logLine('finish or cancel the active interaction first'); return; }
  mode = 'normal';
  terminalSnap = false;
  pendingPlace = null;
  clearSymmetry();
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
  terminalSnap = false;
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
  terminalSnap = false;
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
  terminalSnap = !!altHeld;
  // F3 changes the route style of this same managed workflow.  Diagonal wires
  // never become direct/fixed nets.
  wire = newWireDraft();
  logLine(`wiring (${routeMode}): click a terminal or point to start; Alt snaps to the nearest terminal; terminal clicks commit, Enter commits elsewhere`);
  render();
}

function activateMove(kind = 'connected') {
  if (hasWireDraft() || hasModalPlacement()) { logLine('finish or cancel the active interaction before moving'); return; }
  mode = 'normal';
  terminalSnap = false;
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
  terminalSnap = false;
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
const CHECK_ISSUE_KINDS = {
  unconnectedTerminals: 'unconnected-terminal',
  overlappingBBoxes: 'component-overlap',
  wireThroughBBoxes: 'wire-through-body',
  diagonalWireSegments: 'managed-diagonal',
  gridViolations: 'grid-violation',
  crossNetOverlaps: 'cross-net-overlap',
  labelComponentOverlaps: 'label-component-overlap',
  labelOverlaps: 'label-overlap',
};

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
    const kind = CHECK_ISSUE_KINDS[key];
    const structured = kind ? (report.issues || []).filter((issue) => issue.kind === kind) : [];
    for (let index = 0; index < values.length; index++) {
      const value = values[index];
      const targets = checkIssueTargets(key, value, structured[index]);
      out.push({ category: key, label, value, detail: structured[index] || (report.issues || []).find((issue) => issue.kind === kind && issue.message === value), ...targets });
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

let renderedCheckReport;

function renderCheckSummary() {
  if (!checkSummaryBodyEl || renderedCheckReport === lastCheckReport) return;
  renderedCheckReport = lastCheckReport;
  checkSummaryBodyEl.replaceChildren();
  const countEl = document.getElementById('check-count');
  if (!lastCheckReport) {
    if (countEl) countEl.textContent = '';
    checkSummaryBodyEl.textContent = 'Not checked yet.';
    return;
  }
  const issues = checkIssues(lastCheckReport);
  if (countEl) {
    countEl.textContent = issues.length ? String(issues.length) : '✓';
    countEl.classList.toggle('issue', issues.length > 0);
  }
  const result = document.createElement('div');
  result.className = issues.length ? 'check-issues' : 'check-pass';
  result.textContent = issues.length ? `Issues found: ${issues.length}` : 'Pass: no issues found';
  checkSummaryBodyEl.appendChild(result);
  for (const [key, label] of CHECK_CATEGORIES) {
    const count = (lastCheckReport[key] || []).length;
    if (!count) continue;
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
    if (issue.detail?.hint) {
      button.title = issue.detail.hint;
      button.setAttribute('aria-label', `${button.textContent}. ${issue.detail.hint}`);
    }
    button.addEventListener('click', () => focusCheckIssue(issue));
    checkSummaryBodyEl.appendChild(button);
  }
}

function runCheck() {
  try {
    const report = evaluate(circuit);
    lastCheckReport = report;
    diagnosticFromReport(report);
    setPanelCollapsed('check-summary', false);
    renderCheckSummary();
    document.getElementById('check-summary')?.scrollIntoView({ block: 'nearest' });
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
  syncWireButtonRouteMode(announce);
  if (announce) logLine(`route mode: ${wanted}${hasWireDraft() ? ' (active wire draft updated)' : ''}`);
  render();
}

/** The Wire tool button shows the active wire shape; a change briefly highlights it. */
function syncWireButtonRouteMode(flash = false) {
  const button = document.getElementById('btn-mode-wire');
  if (!button) return;
  const icon = button.querySelector('.button-icon');
  if (icon) icon.innerHTML = ICON_PATHS[routeMode === 'diagonal' ? 'wire-diagonal' : 'wire'];
  button.dataset.routeShape = routeMode;
  button.title = `Draw an electrical wire (w) · hold Alt to snap to the nearest terminal · ${routeMode} shape · F3 or right-click to change`;
  if (flash) flashToolButton(button);
}

function openRouteModeMenu(x, y) {
  if (!componentContextMenuEl) return;
  closeComponentContextMenu();
  const menu = componentContextMenuEl;
  menu.hidden = false;
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - 220))}px`;
  menu.style.top = `${Math.max(4, y)}px`;
  const heading = document.createElement('div');
  heading.className = 'context-menu-heading';
  heading.textContent = 'Wire shape';
  menu.appendChild(heading);
  appendContextItem(menu, 'Orthogonal', () => setRouteMode('orthogonal'), { active: routeMode === 'orthogonal', shortcut: 'F3' });
  appendContextItem(menu, 'Diagonal', () => setRouteMode('diagonal'), { active: routeMode === 'diagonal', shortcut: 'F3' });
  const rect = menu.getBoundingClientRect();
  if (rect.bottom > window.innerHeight - 4) menu.style.top = `${Math.max(4, window.innerHeight - 4 - rect.height)}px`;
  menu.querySelector('.context-item-active')?.focus() || menu.querySelector('button')?.focus();
}

document.getElementById('btn-mode-wire')?.addEventListener('contextmenu', (ev) => {
  ev.preventDefault();
  const rect = ev.currentTarget.getBoundingClientRect();
  openRouteModeMenu(rect.right + 6, rect.top);
});

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
document.getElementById('style-line-row')?.addEventListener('click', (ev) => {
  const arrowButton = ev.target.closest?.('[data-arrow-end]');
  if (arrowButton) {
    if (arrowButton.disabled) return;
    const startOn = document.getElementById('style-arrow-start')?.getAttribute('aria-pressed') === 'true';
    const endOn = document.getElementById('style-arrow-end')?.getAttribute('aria-pressed') === 'true';
    const start = arrowButton.dataset.arrowEnd === 'start' ? !startOn : startOn;
    const end = arrowButton.dataset.arrowEnd === 'end' ? !endOn : endOn;
    applySelectedStyle('arrowhead', combineArrowheadEnds(start, end));
    return;
  }
  const lineStyleButton = ev.target.closest?.('[data-line-style]');
  if (lineStyleButton) applySelectedStyle('lineStyle', lineStyleButton.dataset.lineStyle);
});
document.getElementById('style-width-row')?.addEventListener('click', (ev) => {
  const widthButton = ev.target.closest?.('[data-width]');
  if (widthButton && !widthButton.disabled) applySelectedStyle('width', widthButton.dataset.width);
});
document.getElementById('style-text-row')?.addEventListener('click', (ev) => {
  const button = ev.target.closest?.('button');
  if (button?.dataset.styleAlign) setSelectedLabelAlign(button.dataset.styleAlign);
  else if (button?.dataset.styleFont) setSelectedLabelFont(button.dataset.styleFont, button.getAttribute('aria-pressed') !== 'true');
});
document.getElementById('style-color')?.addEventListener('click', (ev) => {
  const swatch = ev.target.closest?.('.swatch');
  if (swatch) applySelectedStyle('color', swatch.dataset.value);
});

// ----- side panel: collapsible sections, filter, resizable width ------------

const PANEL_COLLAPSED_KEY = 'mosfeteer:panel-collapsed';
const PANEL_WIDTH_KEY = 'mosfeteer:panel-width';
const collapsedPanels = new Set();
try {
  for (const name of JSON.parse(localStorage.getItem(PANEL_COLLAPSED_KEY) || '[]')) collapsedPanels.add(name);
} catch { /* storage unavailable */ }

function panelSection(name) {
  return document.querySelector(`.side-panel [data-panel="${CSS.escape(name)}"]`);
}

function setPanelCollapsed(name, collapsed) {
  const section = panelSection(name);
  if (!section) return;
  section.classList.toggle('collapsed', collapsed);
  section.querySelector('.panel-toggle')?.setAttribute('aria-expanded', String(!collapsed));
  if (collapsed) collapsedPanels.add(name); else collapsedPanels.delete(name);
  try { localStorage.setItem(PANEL_COLLAPSED_KEY, JSON.stringify([...collapsedPanels])); } catch { /* storage unavailable */ }
}

for (const toggle of document.querySelectorAll('.side-panel .panel-toggle')) {
  const section = toggle.closest('.panel-group');
  if (!section.dataset.panel) section.dataset.panel = toggle.getAttribute('aria-controls');
  const name = section.dataset.panel;
  setPanelCollapsed(name, collapsedPanels.has(name));
  toggle.addEventListener('click', () => setPanelCollapsed(name, !section.classList.contains('collapsed')));
}

const panelFilterEl = document.getElementById('panel-filter');
panelFilterEl?.addEventListener('input', () => {
  panelFilter = panelFilterEl.value.trim().replace(/[_^{}]/g, '').toLowerCase();
  panelStateKey = '';
  render();
});
panelFilterEl?.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape') return;
  ev.preventDefault();
  ev.stopPropagation();
  if (panelFilterEl.value) {
    panelFilterEl.value = '';
    panelFilterEl.dispatchEvent(new Event('input'));
  } else {
    canvasEl.focus();
  }
});

/** Drag/keyboard width control on a panel's left edge, persisted per panel. */
function bindPanelResizer(panel, handle, storageKey, cssVar, minWidth) {
  if (!panel || !handle) return;
  const setWidth = (width, persist = true) => {
    if (width == null) {
      panel.style.removeProperty(cssVar);
      try { localStorage.removeItem(storageKey); } catch { /* storage unavailable */ }
      return;
    }
    const max = Math.max(minWidth, Math.round(window.innerWidth * 0.6));
    const next = Math.round(Math.min(max, Math.max(minWidth, width)));
    panel.style.setProperty(cssVar, `${next}px`);
    handle.setAttribute('aria-valuenow', String(next));
    if (persist) {
      try { localStorage.setItem(storageKey, String(next)); } catch { /* storage unavailable */ }
    }
  };
  try {
    const saved = Number(localStorage.getItem(storageKey));
    if (saved) setWidth(saved, false);
  } catch { /* storage unavailable */ }
  handle.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    handle.setPointerCapture(ev.pointerId);
    const startX = ev.clientX;
    const startWidth = panel.getBoundingClientRect().width;
    panel.classList.add('resizing');
    const move = (moveEv) => setWidth(startWidth + startX - moveEv.clientX, false);
    const end = () => {
      panel.classList.remove('resizing');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      setWidth(panel.getBoundingClientRect().width);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  });
  handle.addEventListener('dblclick', () => setWidth(null));
  handle.addEventListener('keydown', (ev) => {
    const step = ev.shiftKey ? 64 : 16;
    const width = panel.getBoundingClientRect().width;
    if (ev.key === 'ArrowLeft') setWidth(width + step);
    else if (ev.key === 'ArrowRight') setWidth(width - step);
    else return;
    ev.preventDefault();
  });
}

bindPanelResizer(document.getElementById('side-panel'), document.getElementById('side-panel-resizer'), PANEL_WIDTH_KEY, '--side-panel-width', 180);
bindPanelResizer(analysisDialog, document.getElementById('analysis-dock-resizer'), 'mosfeteer:analysis-width', '--analysis-dock-width', 300);

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
    const run = pendingDocumentAction;
    pendingDocumentAction = null;
    if (switchDialog.returnValue === 'discard' && run) run();
    else circuitSelectEl.value = currentDocumentPath || '';
  });
}

function startNewDocument() {
  // A blank document is a new analysis session. Do not reuse free-text
  // references from an earlier unnamed schematic; named documents keep their
  // own scoped preferences and are restored when reopened.
  try { localStorage.removeItem(analysisFormStorageKey('new')); } catch { /* storage unavailable */ }
  syncGeneration += 1;
  activeSyncSuspended = true;
  circuitNameEl.value = '';
  circuitSelectEl.value = '';
  currentCircuitName = '';
  currentDocumentPath = null;
  currentDocumentDir = null;
  history = [];
  future = [];
  applyJson(JSON.stringify(createDocument().toJSON()));
  clearLatestAnalysisResult();
  lastSavedSnapshot = snapshot();
  lastSeenActive = null;
  lastSeenRevision = null;
  lastCircuitTag = null;
  remoteConflictLogged = false;
  cursor = { x: 0, y: 0 };
  view = viewFromCenter(0, 0);
  render();
  circuitNameEl.focus();
  renderSaveState();
  logLine(persistence.browserOnly
    ? 'Started a new schematic. Enter a name and save it as a browser download, or use Save as to choose a file name.'
    : 'Started a new schematic. Enter a name and save to store it in the workspace folder, or use Save as to choose a folder.');
}

/**
 * Show the drawn small-signal model over the whole drawing area. It is a
 * figure, not a document: closing it puts the schematic back exactly as it
 * was, because nothing was ever replaced.
 */
// ----- the full-size figure's own view -------------------------------------
// The figure reads like the canvas: wheel zooms about the pointer, the middle
// button pans, and a right-drag zooms to a box (a right-click alone zooms
// out). It is a view over one static drawing, so all of it is the SVG's own
// viewBox -- nothing re-renders, and the model is never mutated.

let modelFigureView = null;
let modelFigureFit = null;
let modelFigureDrag = null;

function modelFigureSvg() {
  return modelDialogFigure?.querySelector('svg') || null;
}

/** Client point in the figure's own world units, via its live transform. */
function modelFigureWorld(clientX, clientY) {
  const svg = modelFigureSvg();
  const ctm = svg?.getScreenCTM?.();
  if (!ctm) return null;
  const point = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  return { x: point.x, y: point.y };
}

function applyModelFigureView() {
  const svg = modelFigureSvg();
  if (!svg || !modelFigureView) return;
  const { x, y, w, h } = modelFigureView;
  svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
}

function readModelFigureView() {
  const box = modelFigureSvg()?.viewBox?.baseVal;
  modelFigureFit = box?.width && box?.height
    ? { x: box.x, y: box.y, w: box.width, h: box.height }
    : null;
  modelFigureView = modelFigureFit ? { ...modelFigureFit } : null;
  modelFigureDrag = null;
}

function fitModelFigure() {
  if (!modelFigureFit) return;
  modelFigureView = { ...modelFigureFit };
  applyModelFigureView();
}

/** Zoom limits: never past a whole cell per pixel, never past the whole drawing. */
function zoomModelFigure(factor, about) {
  if (!modelFigureView || !modelFigureFit) return;
  const min = Math.min(modelFigureFit.w / 64, 200);
  const max = modelFigureFit.w * 4;
  const width = Math.min(Math.max(modelFigureView.w * factor, min), max);
  const scale = width / modelFigureView.w;
  const anchor = about || {
    x: modelFigureView.x + modelFigureView.w / 2,
    y: modelFigureView.y + modelFigureView.h / 2,
  };
  modelFigureView = {
    x: anchor.x - (anchor.x - modelFigureView.x) * scale,
    y: anchor.y - (anchor.y - modelFigureView.y) * scale,
    w: width,
    h: modelFigureView.h * scale,
  };
  applyModelFigureView();
}

function zoomModelFigureToRect(rect) {
  if (!modelFigureView || rect.w < 4 || rect.h < 4) return;
  const aspect = modelFigureView.w / modelFigureView.h;
  let w = rect.w;
  let h = rect.h;
  if (w / h > aspect) h = w / aspect;
  else w = h * aspect;
  modelFigureView = { x: rect.x + rect.w / 2 - w / 2, y: rect.y + rect.h / 2 - h / 2, w, h };
  applyModelFigureView();
}

function modelFigureRubber(from, to) {
  if (!modelDialogRubber) return;
  const area = modelDialogFigure.getBoundingClientRect();
  modelDialogRubber.hidden = !from || !to;
  if (!from || !to) return;
  modelDialogRubber.style.left = `${Math.min(from.clientX, to.clientX) - area.left}px`;
  modelDialogRubber.style.top = `${Math.min(from.clientY, to.clientY) - area.top}px`;
  modelDialogRubber.style.width = `${Math.abs(to.clientX - from.clientX)}px`;
  modelDialogRubber.style.height = `${Math.abs(to.clientY - from.clientY)}px`;
}

function bindModelFigureView(container) {
  if (!container) return;
  container.addEventListener('wheel', (ev) => {
    if (!modelFigureView) return;
    ev.preventDefault();
    zoomModelFigure(Math.pow(1.0016, ev.deltaY), modelFigureWorld(ev.clientX, ev.clientY));
  }, { passive: false });

  container.addEventListener('contextmenu', (ev) => ev.preventDefault());

  container.addEventListener('pointerdown', (ev) => {
    if (!modelFigureView || (ev.button !== 1 && ev.button !== 2)) return;
    ev.preventDefault();
    const world = modelFigureWorld(ev.clientX, ev.clientY);
    if (!world) return;
    container.setPointerCapture?.(ev.pointerId);
    modelFigureDrag = {
      mode: ev.button === 1 ? 'pan' : 'zoom',
      pointerId: ev.pointerId,
      startWorld: world,
      startView: { ...modelFigureView },
      start: { clientX: ev.clientX, clientY: ev.clientY },
      moved: false,
    };
  });

  container.addEventListener('pointermove', (ev) => {
    const drag = modelFigureDrag;
    if (!drag || drag.pointerId !== ev.pointerId) return;
    if (Math.abs(ev.clientX - drag.start.clientX) > 3 || Math.abs(ev.clientY - drag.start.clientY) > 3) drag.moved = true;
    if (drag.mode === 'pan') {
      // The world point under the cursor stays there, so panning tracks the
      // pointer exactly however the viewBox is currently letterboxed.
      const world = modelFigureWorld(ev.clientX, ev.clientY);
      if (!world) return;
      modelFigureView.x += drag.startWorld.x - world.x;
      modelFigureView.y += drag.startWorld.y - world.y;
      applyModelFigureView();
      return;
    }
    modelFigureRubber(drag.start, { clientX: ev.clientX, clientY: ev.clientY });
  });

  const finish = (ev) => {
    const drag = modelFigureDrag;
    if (!drag || drag.pointerId !== ev.pointerId) return;
    modelFigureDrag = null;
    container.releasePointerCapture?.(ev.pointerId);
    modelFigureRubber(null, null);
    if (drag.mode !== 'zoom') return;
    const world = modelFigureWorld(ev.clientX, ev.clientY);
    if (!world) return;
    // A right-click that did not drag zooms out, as it does on the canvas.
    if (!drag.moved) {
      zoomModelFigure(2, world);
      return;
    }
    zoomModelFigureToRect({
      x: Math.min(drag.startWorld.x, world.x),
      y: Math.min(drag.startWorld.y, world.y),
      w: Math.abs(world.x - drag.startWorld.x),
      h: Math.abs(world.y - drag.startWorld.y),
    });
  };
  container.addEventListener('pointerup', finish);
  container.addEventListener('pointercancel', (ev) => {
    if (modelFigureDrag?.pointerId !== ev.pointerId) return;
    modelFigureDrag = null;
    modelFigureRubber(null, null);
  });
  container.addEventListener('dblclick', () => fitModelFigure());
}

bindModelFigureView(modelDialogFigure);

function openSmallSignalModelOverlay() {
  const model = latestSmallSignalModel;
  if (!model?.ok || !modelDialog) return;
  if (modelDialogTitle) {
    const name = currentCircuitName || circuitNameEl.value.trim();
    modelDialogTitle.textContent = name ? `Small-signal model — ${name}` : 'Small-signal model';
  }
  if (modelDialogFigure) {
    // Replace the drawing, not the container: the rubber-band element and the
    // view handlers bound to it outlive every redraw.
    modelDialogFigure.querySelector('svg')?.remove();
    const holder = document.createElement('div');
    holder.innerHTML = svgString(model.circuit, {
      themeInk: true,
      grid: false,
      terminals: false,
      junctions: true,
      background: false,
      emptyHint: false,
    });
    const figure = holder.querySelector('svg');
    if (figure) {
      figure.removeAttribute('width');
      figure.removeAttribute('height');
      figure.setAttribute('role', 'img');
      figure.setAttribute('aria-label', 'Small-signal equivalent circuit');
      modelDialogFigure.prepend(figure);
    }
  }
  if (modelDialogNotes) {
    modelDialogNotes.replaceChildren();
    for (const note of model.notes || []) {
      const item = document.createElement('li');
      item.textContent = note;
      modelDialogNotes.appendChild(item);
    }
    modelDialogNotes.hidden = !(model.notes || []).length;
  }
  if (!modelDialog.open) modelDialog.showModal();
  // The rendered viewBox is the fitted view the figure returns to.
  readModelFigureView();
}

analysisModelOpen?.addEventListener('click', openSmallSignalModelOverlay);

// Escape closes the figure, and closes only the figure: the handler stops the
// key here so it never reaches the analysis dock's own Escape behind it.
// Native <dialog> already cancels on Escape; owning it explicitly keeps that
// true whatever else is listening.
modelDialog?.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape' || !modelDialog.open) return;
  ev.preventDefault();
  ev.stopPropagation();
  modelDialog.close();
});
// A figure this size invites clicking beside it to dismiss it.
modelDialog?.addEventListener('click', (ev) => {
  if (ev.target === modelDialog) modelDialog.close();
});
// Hand the keyboard back to the drawing the figure was covering. The drawing
// goes; the rubber band and its handlers stay with the container.
modelDialog?.addEventListener('close', () => {
  modelDialogFigure?.querySelector('svg')?.remove();
  modelFigureView = null;
  modelFigureDrag = null;
  canvasEl.focus();
});

const toolbarMenus = [
  [document.getElementById('btn-document-menu'), document.getElementById('document-menu')],
  [document.getElementById('style-line-pattern'), document.getElementById('style-line-menu')],
].filter(([button, menu]) => button && menu);

function closeToolbarMenu(button, menu, focusButton = false) {
  if (menu.hidden) return;
  menu.hidden = true;
  button.setAttribute('aria-expanded', 'false');
  if (focusButton) button.focus();
}

for (const [button, menu] of toolbarMenus) {
  button.addEventListener('click', (ev) => {
    ev.preventDefault();
    if (!menu.hidden) { closeToolbarMenu(button, menu); return; }
    for (const [otherButton, otherMenu] of toolbarMenus) closeToolbarMenu(otherButton, otherMenu);
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    menu.querySelector('[role="menuitem"]:not(:disabled)')?.focus();
  });
  menu.addEventListener('click', (ev) => {
    if (ev.target.closest?.('[role="menuitem"]')) closeToolbarMenu(button, menu);
  });
  menu.addEventListener('keydown', (ev) => {
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    ev.preventDefault();
    const items = [...menu.querySelectorAll('[role="menuitem"]:not(:disabled)')];
    const next = items.indexOf(document.activeElement) + (ev.key === 'ArrowDown' ? 1 : -1);
    items[(next + items.length) % items.length]?.focus();
  });
}
function dismissToolbarMenusOutside(ev) {
  for (const [button, menu] of toolbarMenus) {
    if (!menu.contains(ev.target) && !button.contains(ev.target)) closeToolbarMenu(button, menu);
  }
}
window.addEventListener('pointerdown', dismissToolbarMenusOutside, true);
window.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape') return;
  const open = toolbarMenus.find(([, menu]) => !menu.hidden);
  if (!open) return;
  ev.preventDefault();
  closeToolbarMenu(open[0], open[1], true);
});

newDocumentButton?.addEventListener('click', () => {
  for (const [button, menu] of toolbarMenus) closeToolbarMenu(button, menu);
  startNewDocument();
});

deleteCircuitBtn?.addEventListener('click', askDeleteCircuit);
revealDocumentBtn?.addEventListener('click', revealCurrentDocument);
document.getElementById('btn-open-file')?.addEventListener('click', openDocumentDialog);
document.getElementById('btn-save-as')?.addEventListener('click', () => saveCircuit({ saveAs: true }));
document.getElementById('btn-workspace')?.addEventListener('click', chooseWorkspaceFolder);
exportCircuitBtn?.addEventListener('click', exportCircuit);
exportCancel?.addEventListener('click', () => exportDialog?.close());
exportForm?.addEventListener('input', renderExportLocation);
exportForm?.addEventListener('change', renderExportLocation);
document.getElementById('export-choose-folder')?.addEventListener('click', async () => {
  const choice = await showFileDialog(persistence, { mode: 'folder', dir: exportFolder, title: 'Choose export folder' });
  if (!choice) return;
  exportFolder = choice.path;
  renderExportLocation();
});
exportForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const formats = [...exportForm.querySelectorAll('input[name="format"]:checked')].map((input) => input.value);
  const name = validDocumentName(document.getElementById('export-name')?.value);
  if (!formats.length || !name || !exportFolder) return;
  exportDialog.close();
  const settings = { grid: exportGridInput?.checked === true, dark: exportDarkInput?.checked === true };
  try {
    const saved = JSON.parse(localStorage.getItem(EXPORT_SETTINGS_KEY) || 'null') || {};
    // Remember a folder only when it differs from the document's own folder.
    const folders = { ...(saved.folders || {}) };
    const documentKey = currentDocumentPath || '';
    const defaultFolder = defaultExportDirectory(workspaceState, { browserOnly: persistence.browserOnly });
    if (exportFolder === defaultFolder || exportFolder === currentDocumentDir) delete folders[documentKey];
    else folders[documentKey] = exportFolder;
    localStorage.setItem(EXPORT_SETTINGS_KEY, JSON.stringify({ ...settings, formats, folders }));
  } catch { /* storage unavailable */ }
  runExport({ dir: exportFolder, name, formats, ...settings });
});
circuitNameEl.addEventListener('input', renderSaveState);
circuitSelectEl.addEventListener('change', () => {
  const value = circuitSelectEl.value;
  circuitSelectEl.value = currentDocumentPath || '';
  if (value === PICKER_OPEN_FILE) openDocumentDialog();
  else if (value === PICKER_WORKSPACE) chooseWorkspaceFolder();
  else requestCircuitLoad(value);
});

// Dropping a document file (for example, one received by email) opens a copy.
function droppedFiles(ev) {
  return [...(ev.dataTransfer?.types || [])].includes('Files');
}
window.addEventListener('dragover', (ev) => {
  if (!droppedFiles(ev)) return;
  ev.preventDefault();
  ev.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('drop', async (ev) => {
  if (!droppedFiles(ev)) return;
  ev.preventDefault();
  const file = [...ev.dataTransfer.files].find((candidate) => /\.json$/i.test(candidate.name));
  if (!file) {
    logLine('Drop a .json document file to open it.', 'error');
    return;
  }
  let state;
  try {
    state = JSON.parse(await file.text());
    loadDocument(state);
  } catch (err) {
    logLine(`Could not open ${file.name}: ${err.message}`, 'error');
    return;
  }
  const name = file.name.replace(/\.schematic\.json$/i, '').replace(/\.json$/i, '');
  requestDocumentAction(`Opening "${file.name}"`, () => openUnsavedDocument(state, name));
});

document.getElementById('empty-state')?.addEventListener('click', (ev) => {
  const action = ev.target.closest?.('[data-empty-action]')?.dataset.emptyAction;
  if (action === 'place') activatePlace();
  else if (action === 'wire') activateWire();
  else if (action === 'open') openDocumentDialog();
  else if (action === 'help') showHelp();
  if (action && action !== 'open' && action !== 'help') canvasEl.focus();
});
// Documents created by the CLI, another window, or a file manager appear without a manual reload.
circuitSelectEl.addEventListener('focus', () => { void refreshCircuitList(); });

document.getElementById('btn-help').addEventListener('click', () => {
  showHelp();
});

// ----- theme (dark mode) ---------------------------------------------

const THEME_KEY = 'mosfeteer:theme';
const themeBtn = document.getElementById('btn-theme');

function applyTheme(dark) {
  document.documentElement.classList.toggle('dark', dark);
  syncToolCursor();
  if (themeBtn) {
    themeBtn.setAttribute('aria-pressed', String(dark));
    themeBtn.title = dark ? 'Switch to light theme (D)' : 'Switch to dark theme (D)';
    const icon = themeBtn.querySelector('.button-icon');
    if (icon) icon.innerHTML = ICON_PATHS[dark ? 'sun' : 'moon'];
  }
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
    gridBtn.setAttribute('aria-pressed', String(showGrid));
    gridBtn.title = showGrid ? 'Hide the placement grid (#)' : 'Show the placement grid (#)';
  }
  render();
  logLine(showGrid ? 'grid shown' : 'grid hidden');
}

if (gridBtn) {
  gridBtn.addEventListener('click', () => setGrid(!showGrid));
  gridBtn.setAttribute('aria-pressed', String(showGrid));
  gridBtn.title = showGrid ? 'Hide the placement grid (#)' : 'Show the placement grid (#)';
}

// Crosshair visibility is independent from pointer presence: the pointer
// leaving the canvas hides it, while this toggle controls whether it may
// render when the pointer is inside.
const crosshairBtn = document.getElementById('btn-crosshair');
function setCrosshair(on, announce = true) {
  crosshairVisible = !!on;

  if (crosshairBtn) {
    crosshairBtn.setAttribute('aria-pressed', String(crosshairVisible));
    crosshairBtn.title = crosshairVisible ? 'Hide the crosshair (C)' : 'Show the crosshair (C)';
  }
  render();
  if (announce) logLine(crosshairVisible ? 'crosshair shown' : 'crosshair hidden');
}
// Placement guides are advisory, so they are a view toggle like the grid and
// the crosshair rather than anything the document carries.
const guidesBtn = document.getElementById('btn-guides');
function setGuides(on, announce = true) {
  guidesVisible = !!on;
  if (guidesBtn) {
    guidesBtn.setAttribute('aria-pressed', String(guidesVisible));
    guidesBtn.title = guidesVisible ? 'Hide the spacing and alignment guides (G)' : 'Show the spacing and alignment guides (G)';
  }
  render();
  if (announce) logLine(guidesVisible ? 'placement guides shown' : 'placement guides hidden');
}
if (guidesBtn) {
  guidesBtn.addEventListener('click', () => setGuides(!guidesVisible));
  guidesBtn.setAttribute('aria-pressed', String(guidesVisible));
}

if (crosshairBtn) {
  crosshairBtn.addEventListener('click', () => setCrosshair(!crosshairVisible));
  crosshairBtn.setAttribute('aria-pressed', String(crosshairVisible));
  crosshairBtn.title = crosshairVisible ? 'Hide the crosshair (C)' : 'Show the crosshair (C)';
}

// ----- keyboard -------------------------------------------------------------

window.addEventListener('keydown', (ev) => {
  if (ev.key === 'F5') {
    ev.preventDefault();
    flushDraft();
    window.location.reload();
    return;
  }
  if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === 'o' && !inlineInput) {
    ev.preventDefault();
    openDocumentDialog();
    return;
  }
  if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === 's' && !inlineInput) {
    ev.preventDefault();
    saveCircuit({ saveAs: true });
    return;
  }
  if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === 'e' && !inlineInput) {
    ev.preventDefault();
    exportCircuit();
    return;
  }
  if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === 'f') {
    const filter = document.getElementById('panel-filter');
    if (filter && !filter.closest('[hidden]') && !inlineInput) {
      ev.preventDefault();
      filter.focus();
      filter.select();
      return;
    }
  }
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
  if (analysisPick && ev.key === 'Escape') {
    ev.preventDefault();
    setAnalysisPick(null);
    return;
  }

  const tag = (ev.target && ev.target.tagName) || '';
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) {
    if (ev.target === cmdInput && ev.key === 'Escape') {
      cmdInput.value = '';
      cmdInput.blur();
    }
    return;
  }
  // Toolbar buttons, listbox options, menus, and inline editors own their
  // keystrokes.  Without this guard a focused control could also trigger a
  // canvas command such as Delete, Wire, or a transform.
  if (isKeyboardSurfaceTarget(ev.target)) return;

  // Alt is a hold-only modifier. In managed Wire mode it turns on terminal
  // snapping; with a placement or copy ghost it arms the mirrored preview.
  // Track the physical hold separately so a ghost created by a mouse click
  // while Alt is already down receives the same behavior.
  if (ev.key === 'Alt') {
    altHeld = true;
    if (wire) setTerminalSnap(true);
    else if ((mode === 'insert' && pendingPlace?.kind === 'component') || drag?.mode === 'copyghost') setSymmetry(true);
    ev.preventDefault();
    return;
  }
  if (ev.altKey) {
    altHeld = true;
    if (wire) setTerminalSnap(true);
    else if ((mode === 'insert' && pendingPlace?.kind === 'component') || drag?.mode === 'copyghost') setSymmetry(true);
  }

  // cancels the first d, except for an unmodified second d within the normal
  // mode timeout window. This also covers global commands such as Ctrl+A,
  // which are handled before onNormalKey below.
  const isDeleteContinuation = ev.key === 'd' && !ev.ctrlKey && !ev.metaKey && !ev.altKey
    && mode === 'normal' && !visual && !wire && !directWire
    && pendingKey?.key === 'd' && Date.now() - pendingKey.at < 800;
  // Symmetric placement is held down, so the keys that drive and commit the
  // ghost have to survive the modifier branch below, which otherwise swallows
  // everything it does not itself bind. Neither is bound with Ctrl.
  // r/Shift+r would otherwise read as Ctrl+r and Ctrl+Shift+r here, so the
  // ghost could not be rotated or flipped without letting go of the modifier.
  // While symmetry is armed they mean what they mean in insert mode.
  const drivingSymmetry = symmetry
    && (ev.key === 'Enter' || ev.key === 'Escape' || ev.key.startsWith('Arrow') || ev.key.toLowerCase() === 'r');
  // Ctrl+r (vertical mirror) remains available while Alt symmetry is held.
  if (drivingSymmetry && (ev.metaKey || ev.ctrlKey) && !ev.shiftKey && ev.key.toLowerCase() === 'r') {
    ev.preventDefault();
    if (mode === 'insert' && pendingPlace?.kind === 'component') {
      transformPendingComponent('mirrorY');
      render();
    } else {
      selectedTransform('mirror-y');
    }
    return;
  }
  if ((ev.metaKey || ev.ctrlKey) && !drivingSymmetry) {
    const k = ev.key.toLowerCase();
    if (k === 'c' && ev.shiftKey) {
      ev.preventDefault();
      copyAsImage();
    } else if (k === 'i' || k === 'b') {
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
    } else if (k === 'c' && !ev.shiftKey) {
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

  // Shift+Left/Right set every selected label's alignment (cycle through
  // center).  The primary label determines the next target when the set is
  // mixed, while an already-uniform set cycles back to center.
  if (ev.shiftKey && !wire && mode === 'normal' && (key === 'ArrowLeft' || key === 'ArrowRight')) {
    const labels = selectedLabels();
    const primary = selectedLabel() || labels[0];
    if (primary && labels.length) {
      const align = key === 'ArrowRight' ? 'right' : 'left';
      const allAtTarget = labels.every((label) => label.align === align);
      const want = allAtTarget ? 'center' : align;
      commit(() => labels.forEach((label) => label.setAlign(want)));
      render();
      ev.preventDefault();
      return;
    }
  }

  if (viewKey(key, ev.shiftKey)) {
    ev.preventDefault();
    return;
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
  kind: 'circuit',
  comps: [...circuit.components.values()].map((c) => ({ refdes: c.refdes, type: c.type, x: c.transform.x, y: c.transform.y, rot: c.transform.rotation, mx: c.transform.mirrorX, my: c.transform.mirrorY })),
  nets: [...circuit.nets.values()].map((net) => ({ id: net.id, terminals: net.terminals.map((t) => t.comp + '.' + t.term), route: net.route, branches: net.branches, junctions: net.junctions, pts: net.points() })),
  labels: [...circuit.labels.values()].map((l) => ({ ...l.toJSON(), world: l.anchorWorld() })),
});

/** Tell the local server this window is open; the launcher stops the server after the last one closes. */
function startSessionHeartbeat() {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  const beat = () => persistence.heartbeat(id);
  beat();
  // Runs while hidden too; browsers throttle background timers to about once a minute.
  window.setInterval(beat, 20_000);
  window.addEventListener('pageshow', (ev) => { if (ev.persisted) beat(); });
  window.addEventListener('pagehide', () => {
    if (persistence.liveSync) {
      navigator.sendBeacon?.('/api/session', new Blob([JSON.stringify({ id, closing: true })], { type: 'application/json' }));
    }
  });
}

view = viewFromCenter(0, 0);
window.__app ||= { renders: [] };

try {
  restoreDraft();
  draftReady = true;
  // Paint the editor shell immediately. The native last-opened lookup and
  // document load continue in the background, so storage migration can never
  // leave the user staring at an unpainted/blank window.
  fitView();
  restoreStartup().catch((err) => logLine(`Could not restore the last document: ${err.message}`, 'error'));
  startSessionHeartbeat();
  syncActiveCircuit(); // pick up the agent's active circuit immediately
  window.setInterval(syncActiveCircuit, 500);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncActiveCircuit();
  });
  logLine('Mosfeteer ready. Press ? for the keymap. Normal: i to insert, w to wire, u undo.');
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
  flushDraft();
  if (snapshot() === lastSavedSnapshot) return;
  ev.preventDefault();
  ev.returnValue = 'You have unsaved schematic changes.';
});

const paneEl = document.querySelector('.canvas-pane');

function syncModeToolbarOverflow() {
  if (!modeToolbarEl) return;
  const styles = getComputedStyle(modeToolbarEl);
  const remaining = styles.flexDirection === 'row'
    ? modeToolbarEl.scrollWidth - modeToolbarEl.clientWidth - modeToolbarEl.scrollLeft
    : modeToolbarEl.scrollHeight - modeToolbarEl.clientHeight - modeToolbarEl.scrollTop;
  modeToolbarEl.toggleAttribute('data-overflow-end', remaining > 1);
}

if (modeToolbarEl) {
  modeToolbarEl.addEventListener('scroll', syncModeToolbarOverflow, { passive: true });
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(syncModeToolbarOverflow).observe(modeToolbarEl);
  }
  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver(syncModeToolbarOverflow).observe(modeToolbarEl, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'hidden', 'style'],
    });
  }
  syncModeToolbarOverflow();
}

if (paneEl && typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => {
    resizeView();
    syncModeToolbarOverflow();
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
