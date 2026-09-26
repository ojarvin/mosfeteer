/**
 * Mosfeteer — keyboard-driven schematic editor.
 *
 * Modes:
 *   NORMAL   arrows move (selected comp or cursor), l line annotation, r rotate, Shift+R mirror,
 *            Shift+Up/Down layer, dd delete, y/p copy-paste, Ctrl+Shift+V paste style, Ctrl+I/B
 *            toggle italic/bold on selected labels, w single managed wire mode, Tab cycle, Enter select-at-cursor,
 *   INSERT   type to fuzzy-search a component/label, Enter picks a ghost, arrows move cursor, Esc back.
 *   VISUAL   arrows grow a selection box, Enter commits it (like a marquee).
 *   WIRE     terminal letters pick/complete connections.
 */

import { Circuit, INTERFACE_PIN_TYPES, LABEL_FONT_SIZE, containedWireSegments, diagonalDraftPath, extractWireFragments, isReferenceMarker, isReferenceMarkerGlobalName, netTerminalPositionKey, referenceMarkerIsLocal, transformComponentWorld, transformWorldPoints } from '../core/model.js';
import { getSymbol, seriesTerminalNames } from '../core/components/index.js';
import { runCommand, evaluate } from '../core/commands.js';
import { hiddenSupplyBarLabels, supplyBars } from '../core/supply-bars.js';
import { addTerminalStubs } from '../core/stubs.js';
import { addPinRail } from '../core/pin-rails.js';
import { circuitPageGuideFrame, normalizePageGuide, pageGuideCaption } from '../core/page-guide.js';
import { editorOverlay, svgString } from '../core/render.js';
import { themeInkSvg } from '../core/style.js';
import { loadDocument } from '../core/document.js';
import { snap, GRID } from '../core/grid.js';
import { applyTransform, distanceToSegment } from '../core/geometry.js';
import { smartRoute } from '../core/router.js';
import { moveJunctionEndpoint, wireRunAt, moveWireRun } from '../core/wireedit.js';
import { crossNetOverlaps, pointOnPath } from '../core/wiring.js';
import { selectedSetMoveSource, completeSelectedNetIds as selectedCompleteNetIds, chooseWireHitCandidate, nextStackedSelection, componentPressSelection } from './selection.js';
import { buildWireHitIndex, queryWireHitIndex } from './wire-index.js';
import { layerActionForKey, layoutAlignKey, naturalCompare } from './toolbar.js';
import { alignedAnchorShift, attachedEdgeShift, compatibilityMoveFilter, constrainAxis, isKeyboardSurfaceTarget, isPrimaryPointerEvent, isSelectionModifier, moveAnnotationEndpoint, nearestPoint, resizeRect, shouldForwardCanvasMove, shouldPanTouch, symmetryOperation, worldAndCursorFromClient } from './interaction.js';
import { isPinDragCandidate, spliceCandidate, wheelIntent } from './gestures.js';
import { LOG_DRAWER_CLOSED } from './status-bar.js';
import { alignmentPlan, componentLayoutItem, distributionPlan, ghostLayoutItem, labelLayoutItem, placementGuides } from './layout.js';
import { editor } from './editor-state.js';
import {
  canvasEl,
  cmdInput,
  statusZoomEl,
  clearCheckButtonEl,
  helpDialog,
  helpSearch,
  paneEl,
} from './elements.js';
import { installIcons } from './icons.js';
import { noteTip, tutorialTargetRects, syncTutorial, offerTutorial, installOnboarding } from './onboarding.js';
import { ALIGN_SOURCE_HINT, worldPerPixel, alignOverlay, keptAlignSelection, alignMouseDown, installAlignPanel } from './align-tool.js';
import { renderHelpSearch, showHelp, installHelp } from './help.js';
import { openRadialMenu, highlightRadial, closeRadialMenu, finishRadialMenu } from './radial-menu.js';
import { logLine, hintLine, applyLogDrawerEvent, openCommandLine, logCommand, announce, noteActionPrevented, renderStatus, installStatusBar } from './status-bar-ui.js';
import { resetCheckState, clearCheckReport, clearDiagnosticFocus, renderCheckSummary, runCheck, installDesignCheckUi } from './design-check-ui.js';
import { paneSize, viewFromCenter, resizeView, syncViewToPane, minViewW, maxViewW, followCursor, cancelViewAnimation, fitView, applyCanvasViewport, clientToWorld, worldToClient, worldRect, rectContained, zoomToWorldRect } from './canvas-view.js';
import { syncAnalysisDock, setAnalysisPick, completeAnalysisPick, installAnalysisUi, toggleAnalysisDock } from './analysis-ui.js';
import { installModelFigure } from './model-figure.js';
import { closeComponentContextMenu, openContextMenuAt, installContextMenu } from './context-menu.js';
import { boxState, restoreBoxState, openComponentChildLabelEditor, inlineEditLabel } from './label-editor.js';
import { activeBeatIndex, activeBeatView, rememberBeatObjects, introduceNewBeatObjects, stepBeat, toggleBeatStrip, addBeatHere, deleteBeats, selectedBeatIndices, toggleSelectionInBeat, flipSelectedSwitches, renderBeatStrip, openPresenter, onPresenterKey, installBeatsUi } from './beats-ui.js';
import { persistDraft, flushDraft, restoreDraft, restoreStartup, saveCircuit, openDocumentDialog, renderSaveState, syncActiveCircuit, startSessionHeartbeat, installDocumentSession } from './document-session.js';
import { copyAsImage, exportCircuit, installExportUi } from './export-ui.js';
import { queueCommitFeedback, flushPendingCommitFeedback, mountCommitFeedback } from './commit-flash.js';
import { renderComponents, renderNets, renderDetail, toggleSidePanel, installSidePanel, sidePanelVisible, setSidePanelVisible } from './side-panel.js';
import { installFindReplace, openFind, openReplace, renderTextMatches } from './find-replace-ui.js';
import { installCommandLine } from './command-line-ui.js';
import { atlasOpen, installAtlas, onAtlasKey, openAtlas } from './atlas.js';
import { toggleSelectedLabelFont, updateStyleControls, installStyleControls } from './style-controls.js';
import { onInsertKey, rememberInsertType, updateInsertMenu, openQuickAdd, closeQuickAdd, openSwapPicker } from './insert-menu.js';
import { toggleRouteMode, toggleTheme, setGrid, setCrosshair, setGuides, syncModeToolbarOverflow, installToolbarUi } from './toolbar-ui.js';
import { shortNetsAtPlacedSolder, askNameForNewNetNameConflict } from './net-names.js';
import { moveLabelSafely, placeAnnotationAt, placeEquationAt, draftPointAt, commitLineAnnotation, commitArrowAnnotation, placeShapeAnnotation, highlightNetAt, removeAllNetHighlights, placeNetLabelAt, beginNetLabelPaste, clearNetLabelPaste, netLabelPastePreview } from './annotation-tools.js';
import { refreshCopyGhostBase, copySelection, startCopyGhost, moveCopyGhost, dropCopyGhostMirror, commitCopyGhost, publishObjectClipboard, armObjectPaste, pasteClipboard, installCopyPaste } from './copy-paste.js';
import { netMarkerRefs, setHoverTarget, updateCanvasHover } from './hover-preview.js';
import { syncSnapPulse, annotationReach, cutAlong, withGestureOverlay } from './gesture-overlay.js';

// Accessors for the state the split-out modules share (see editor-state.js).
Object.defineProperties(editor, {
  activeBeatId: { get: () => activeBeatId, set: (value) => { activeBeatId = value; } },
  activePlacementGuides: { get: () => activePlacementGuides, set: (value) => { activePlacementGuides = value; } },
  activeSymmetryCells: { get: () => activeSymmetryCells, set: (value) => { activeSymmetryCells = value; } },
  activeSyncSuspended: { get: () => activeSyncSuspended, set: (value) => { activeSyncSuspended = value; } },
  alignTool: { get: () => alignTool, set: (value) => { alignTool = value; } },
  altHeld: { get: () => altHeld, set: (value) => { altHeld = value; } },
  analysisPick: { get: () => analysisPick, set: (value) => { analysisPick = value; } },
  annotationPoints: { get: () => annotationPoints, set: (value) => { annotationPoints = value; } },
  annotationStart: { get: () => annotationStart, set: (value) => { annotationStart = value; } },
  beatAnchorId: { get: () => beatAnchorId, set: (value) => { beatAnchorId = value; } },
  beatKnown: { get: () => beatKnown, set: (value) => { beatKnown = value; } },
  beatStripActive: { get: () => beatStripActive, set: (value) => { beatStripActive = value; } },
  beatStripKey: { get: () => beatStripKey, set: (value) => { beatStripKey = value; } },
  beatStripOpen: { get: () => beatStripOpen, set: (value) => { beatStripOpen = value; } },
  beatViewCache: { get: () => beatViewCache, set: (value) => { beatViewCache = value; } },
  beatViewsCache: { get: () => beatViewsCache, set: (value) => { beatViewsCache = value; } },
  canvasSvgEl: { get: () => canvasSvgEl, set: (value) => { canvasSvgEl = value; } },
  circuit: { get: () => circuit, set: (value) => { circuit = value; } },
  clipboard: { get: () => clipboard, set: (value) => { clipboard = value; } },
  clipboardNotice: { get: () => clipboardNotice, set: (value) => { clipboardNotice = value; } },
  committedCanvasKey: { get: () => committedCanvasKey, set: (value) => { committedCanvasKey = value; } },
  componentRangeAnchor: { get: () => componentRangeAnchor, set: (value) => { componentRangeAnchor = value; } },
  contextMenuDismiss: { get: () => contextMenuDismiss, set: (value) => { contextMenuDismiss = value; } },
  copyMode: { get: () => copyMode, set: (value) => { copyMode = value; } },
  copyPending: { get: () => copyPending, set: (value) => { copyPending = value; } },
  crosshairVisible: { get: () => crosshairVisible, set: (value) => { crosshairVisible = value; } },
  currentCircuitName: { get: () => currentCircuitName, set: (value) => { currentCircuitName = value; } },
  currentDocumentDir: { get: () => currentDocumentDir, set: (value) => { currentDocumentDir = value; } },
  currentDocumentPath: { get: () => currentDocumentPath, set: (value) => { currentDocumentPath = value; } },
  cursor: { get: () => cursor, set: (value) => { cursor = value; } },
  deleteInFlight: { get: () => deleteInFlight, set: (value) => { deleteInFlight = value; } },
  deleteMode: { get: () => deleteMode, set: (value) => { deleteMode = value; } },
  diagnosticSelection: { get: () => diagnosticSelection, set: (value) => { diagnosticSelection = value; } },
  directWire: { get: () => directWire, set: (value) => { directWire = value; } },
  draftReady: { get: () => draftReady, set: (value) => { draftReady = value; } },
  draftRestored: { get: () => draftRestored, set: (value) => { draftRestored = value; } },
  draftTimer: { get: () => draftTimer, set: (value) => { draftTimer = value; } },
  drag: { get: () => drag, set: (value) => { drag = value; } },
  equationAnnotationLayout: { get: () => equationAnnotationLayout, set: (value) => { equationAnnotationLayout = value; } },
  equationEmphasis: { get: () => equationEmphasis, set: (value) => { equationEmphasis = value; } },
  future: { get: () => future, set: (value) => { future = value; } },
  guidesVisible: { get: () => guidesVisible, set: (value) => { guidesVisible = value; } },
  history: { get: () => history, set: (value) => { history = value; } },
  hoverAnnotationId: { get: () => hoverAnnotationId, set: (value) => { hoverAnnotationId = value; } },
  hoverFromPanel: { get: () => hoverFromPanel, set: (value) => { hoverFromPanel = value; } },
  hoverPinsRef: { get: () => hoverPinsRef, set: (value) => { hoverPinsRef = value; } },
  hoverTarget: { get: () => hoverTarget, set: (value) => { hoverTarget = value; } },
  inlineInput: { get: () => inlineInput, set: (value) => { inlineInput = value; } },
  insertQuery: { get: () => insertQuery, set: (value) => { insertQuery = value; } },
  labelMode: { get: () => labelMode, set: (value) => { labelMode = value; } },
  lastCheckReport: { get: () => lastCheckReport, set: (value) => { lastCheckReport = value; } },
  lastCircuitTag: { get: () => lastCircuitTag, set: (value) => { lastCircuitTag = value; } },
  lastComponentClick: { get: () => lastComponentClick, set: (value) => { lastComponentClick = value; } },
  lastLabelClick: { get: () => lastLabelClick, set: (value) => { lastLabelClick = value; } },
  lastLineClick: { get: () => lastLineClick, set: (value) => { lastLineClick = value; } },
  lastNetClick: { get: () => lastNetClick, set: (value) => { lastNetClick = value; } },
  lastSavedSnapshot: { get: () => lastSavedSnapshot, set: (value) => { lastSavedSnapshot = value; } },
  lastSeenRevision: { get: () => lastSeenRevision, set: (value) => { lastSeenRevision = value; } },
  latestSmallSignalModel: { get: () => latestSmallSignalModel, set: (value) => { latestSmallSignalModel = value; } },
  layoutPreviewRects: { get: () => layoutPreviewRects, set: (value) => { layoutPreviewRects = value; } },
  logDrawerState: { get: () => logDrawerState, set: (value) => { logDrawerState = value; } },
  mode: { get: () => mode, set: (value) => { mode = value; } },
  modelRevision: { get: () => modelRevision, set: (value) => { modelRevision = value; } },
  moveMode: { get: () => moveMode, set: (value) => { moveMode = value; } },
  movePending: { get: () => movePending, set: (value) => { movePending = value; } },
  multi: { get: () => multi, set: (value) => { multi = value; } },
  netRangeAnchor: { get: () => netRangeAnchor, set: (value) => { netRangeAnchor = value; } },
  netWarnings: { get: () => netWarnings, set: (value) => { netWarnings = value; } },
  pageGuide: { get: () => pageGuide, set: (value) => { pageGuide = value; } },
  panelStateKey: { get: () => panelStateKey, set: (value) => { panelStateKey = value; } },
  pendingFeedbackSnapshot: { get: () => pendingFeedbackSnapshot, set: (value) => { pendingFeedbackSnapshot = value; } },
  pendingNetNameChoice: { get: () => pendingNetNameChoice, set: (value) => { pendingNetNameChoice = value; } },
  pendingPlace: { get: () => pendingPlace, set: (value) => { pendingPlace = value; } },
  presenter: { get: () => presenter, set: (value) => { presenter = value; } },
  previewRevision: { get: () => previewRevision, set: (value) => { previewRevision = value; } },
  previewTransaction: { get: () => previewTransaction, set: (value) => { previewTransaction = value; } },
  quickAdd: { get: () => quickAdd, set: (value) => { quickAdd = value; } },
  radialMenuEl: { get: () => radialMenuEl, set: (value) => { radialMenuEl = value; } },
  remoteConflictLogged: { get: () => remoteConflictLogged, set: (value) => { remoteConflictLogged = value; } },
  restoredDraftPath: { get: () => restoredDraftPath, set: (value) => { restoredDraftPath = value; } },
  routeChoiceExposed: { get: () => routeChoiceExposed, set: (value) => { routeChoiceExposed = value; } },
  routeMode: { get: () => routeMode, set: (value) => { routeMode = value; } },
  saveInFlight: { get: () => saveInFlight, set: (value) => { saveInFlight = value; } },
  scrollScheme: { get: () => scrollScheme, set: (value) => { scrollScheme = value; } },
  selLabels: { get: () => selLabels, set: (value) => { selLabels = value; } },
  selected: { get: () => selected, set: (value) => { selected = value; } },
  selectedBeatIds: { get: () => selectedBeatIds, set: (value) => { selectedBeatIds = value; } },
  selectedNets: { get: () => selectedNets, set: (value) => { selectedNets = value; } },
  selectedWire: { get: () => selectedWire, set: (value) => { selectedWire = value; } },
  selectedWires: { get: () => selectedWires, set: (value) => { selectedWires = value; } },
  showGrid: { get: () => showGrid, set: (value) => { showGrid = value; } },
  snapLayerEl: { get: () => snapLayerEl, set: (value) => { snapLayerEl = value; } },
  snapPulseKey: { get: () => snapPulseKey, set: (value) => { snapPulseKey = value; } },
  suppressContextMenuUntil: { get: () => suppressContextMenuUntil, set: (value) => { suppressContextMenuUntil = value; } },
  suppressNetNameChoice: { get: () => suppressNetNameChoice, set: (value) => { suppressNetNameChoice = value; } },
  symmetry: { get: () => symmetry, set: (value) => { symmetry = value; } },
  syncGeneration: { get: () => syncGeneration, set: (value) => { syncGeneration = value; } },
  syncInFlight: { get: () => syncInFlight, set: (value) => { syncInFlight = value; } },
  terminalSnap: { get: () => terminalSnap, set: (value) => { terminalSnap = value; } },
  toolbarFitKey: { get: () => toolbarFitKey, set: (value) => { toolbarFitKey = value; } },
  tutorial: { get: () => tutorial, set: (value) => { tutorial = value; } },
  view: { get: () => view, set: (value) => { view = value; } },
  viewPane: { get: () => viewPane, set: (value) => { viewPane = value; } },
  visual: { get: () => visual, set: (value) => { visual = value; } },
  wire: { get: () => wire, set: (value) => { wire = value; } },
  workspaceState: { get: () => workspaceState, set: (value) => { workspaceState = value; } },
  zoom: { get: () => zoom, set: (value) => { zoom = value; } },
});

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

let clipboardNotice = '';
installExportUi();
/**
 * Equation to schematic highlighting. Hovering a term lights the devices it
 * came from; clicking locks that highlight, and clicking the locked term again
 * widens the selection to the enclosing sub-expression, so a term buried inside
 * a fraction can still be grabbed whole.
 */
let equationEmphasis = [];

let latestSmallSignalModel = null;

let analysisPick = null;
installAnalysisUi();

installIcons();
// The first-drawing tutorial while it runs: { startedAt, skipped, cheered, finishedAt }.
let tutorial = null;
installOnboarding();
// ----- editor state ----------------------------------------------

installDocumentSession();
let circuit = new Circuit();
let mode = 'normal'; // 'normal' | 'insert'
let labelMode = null; // null | 'net' | 'annotation' | 'equation' | 'arrow' | 'box' | 'line'
let annotationStart = null;
let annotationPoints = [];
let moveMode = null; // null | 'connected' | 'detached' (armed one-shot move)
let copyMode = false; // armed one-shot copy placement
let deleteMode = false; // persistent one-shot delete tool
let alignTool = null; // Align to: { source, hover } while the tool is active
let movePending = false;
let copyPending = false;
let routeMode = 'orthogonal'; // 'orthogonal' | 'diagonal'; applies when w starts
let routeChoiceExposed = false;
let lastCheckReport = null;
let diagnosticSelection = { components: new Set(), nets: new Set(), labels: new Set() };

installDesignCheckUi();
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
// The page guide preset ({ preset, textPt }) or null; see core/page-guide.js.
let pageGuide = (() => {
  try { return normalizePageGuide(localStorage.getItem('mosfeteer.pageGuide')); } catch { return null; }
})();
let visual = null; // visual mode: anchor grid point {x,y} the selection box starts from
let insertQuery = ''; // insert-mode fuzzy-search string
let wire = null; // { source: {refdes, term} | null, points: [{x,y}] } — a wire being drawn in segments
let wirePreview = null;
let wirePreviewStale = false;
let terminalSnap = false; // Alt-held wiring cursor: snap to the nearest terminal
let spaceHeld = false; // Space turns a left drag into a pan
let stackedClick = null; // { candidates, pressKey } for the press in progress: a still click cycles
let spaceTap = false; // Space went down and nothing used it yet: its release stubs the selection
// 'mouse': the wheel zooms. 'trackpad': two-finger scroll pans, pinch zooms.
// A per-machine preference, so it lives in browser storage, not the document.
let scrollScheme = (() => {
  try { return localStorage.getItem('mosfeteer.scrollScheme') === 'trackpad' ? 'trackpad' : 'mouse'; } catch { return 'mouse'; }
})();
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
let committedViewKey = '';
let canvasSvgEl = null;
let overlayEl = null;
let labelMetricsRenderPending = false;
// Cross-net collinear wire overlaps (B4): highlighted spans + status warning.
let netWarnings = []; // [{ key, otherKey, x0, y0, x1, y1 }]
let wiresDirty = true; // set when wire geometry may have changed; recomputes netWarnings
// Beats (see core/beats.js and the beats section below). The beat on screen
// is editor state, never saved: the document holds only the beats.
let activeBeatId = null;
let beatStripOpen = false; // closed at start; Shift+B, More → Beats, or picking a beat opens it
let beatViewCache = null; // { circuit, key, view }
let beatViewsCache = null; // every beat, for the strip's visibility dots
let beatKnown = { circuit: null, objects: new WeakSet(), ids: new Set() };
let beatStripKey = '';
// Beats picked in the strip (ids), for Delete; the anchor for Shift-ranges.
// Delete acts on them while the strip was the last thing clicked.
let selectedBeatIds = new Set();
let beatAnchorId = null;
let beatStripActive = false;
let presenter = null; // { index, blank, fullscreen }

/**
 * Derive the one interaction state used by the toolbar, canvas, and status
 * line. Keeping this small and pure also makes the keyboard vocabulary usable
 * by alternate (Virtuoso-style) control surfaces without duplicating mode
 * precedence rules.
 */
/** Nets Ctrl+A selects: every net with drawn wire, and every net that joins
 * pins directly (touching terminals have a connection but no wire length). */
export function selectAllNetIds(model) {
  return [...model.nets.values()]
    .filter((net) => net.paths().some((path) => path.length >= 2) || net.terminals.length >= 2)
    .map((net) => net.id);
}

export function deriveInteractionState({ mode = 'normal', labelMode = null, wire = null, directWire = null, visual = null, moveMode = null, copyMode = false, deleteMode = false, alignMode = false, movePending = false, copyPending = false, routeMode = 'orthogonal' } = {}) {
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
  if (labelMode === 'highlight') return { key: 'highlight', canvasClass: 'mode-highlight', toolbar: 'highlight', label: 'HIGHLIGHT' };
  if (labelMode === 'annotation') return { key: 'annotation', canvasClass: 'mode-annotation', toolbar: 'annotation', label: 'ANNOTATION' };
  if (labelMode === 'equation') return { key: 'equation', canvasClass: 'mode-annotation', toolbar: 'annotation', label: 'EQUATION' };
  if (labelMode === 'line') return { key: 'line', canvasClass: 'mode-annotation', toolbar: 'line', label: 'LINE' };
  if (labelMode === 'arrow') return { key: 'arrow', canvasClass: 'mode-annotation', toolbar: 'arrow', label: 'ARROW' };
  if (labelMode === 'box') return { key: 'box', canvasClass: 'mode-annotation', toolbar: 'box', label: 'BOX' };
  if (mode === 'insert') return { key: 'place', canvasClass: 'mode-place', toolbar: 'place', label: 'PLACE' };
  if (copyMode) return { key: 'copy', canvasClass: 'mode-copy', toolbar: 'copy', label: 'COPY' };
  if (deleteMode) return { key: 'delete', canvasClass: 'mode-delete', toolbar: 'delete', label: 'DELETE' };
  if (alignMode) return { key: 'align', canvasClass: 'mode-align', toolbar: 'align', label: 'ALIGN' };
  if (moveMode === 'detached') return { key: 'detached-move', canvasClass: 'mode-detached-move', toolbar: 'move-detached', label: 'DETACHED MOVE' };
  if (moveMode === 'connected') return { key: 'move', canvasClass: 'mode-move', toolbar: 'move', label: 'MOVE' };
  return { key: 'normal', canvasClass: 'mode-normal', toolbar: 'normal', label: 'NORMAL' };
}

// The pane size the current view was laid out for. When the pane changes
// (window resize, side panel drag, analysis dock) the view keeps its scale and
// its top-left corner, so the drawing neither jumps nor rescales.
let viewPane = null;
// ----- status bar and log drawer ------------------------------------
// The log is an overlay drawer; the status bar's message chip always shows
// the latest line. Guidance that merely repeats the live status hint goes
// through hintLine() and never enters the log.

let logDrawerState = LOG_DRAWER_CLOSED;
installStatusBar();

// ----- history --------------------------------------------------------

export function markModelChanged(wires = true) {
  if (previewTransaction) {
    previewRevision += 1;
    circuit.invalidateRoutingCache();
    if (wires) wiresDirty = true;
    return;
  }
  modelRevision += 1;
  circuit.invalidateRoutingCache();
  if (wires) wiresDirty = true;
  introduceNewBeatObjects();
  persistDraft();
}

export function commit(fn) {
  const before = snapshot();
  let result;
  try {
    result = fn();
  } catch (error) {
    // Model edits such as an unsafe reroute roll themselves back before
    // returning here.  Do not turn that rejected action into an undo entry.
    noteActionPrevented(error);
    return false;
  }
  if (snapshot() === before) return result;
  recordHistoryEntry(before, true, 'defer');
  markModelChanged();
  return result;
}

export function snapshot() {
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
  introduceNewBeatObjects();
  persistDraft();
  return true;
}

export function cancelPreviewTransaction() {
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
// A pending "which net name survives" question (see askNetNameChoice).
let pendingNetNameChoice = null;
/** Set while scripted commands run, so an agent or CLI edit never waits on a
 * menu; their merges keep the model's name and report the conflict in Check. */
let suppressNetNameChoice = false;

export function recordHistoryEntry(startSnapshot, trim = true, feedback = 'now') {
  if (!startSnapshot) return;
  rememberHistory(startSnapshot, trim);
  future.length = 0;
  queueCommitFeedback(startSnapshot, feedback);
  askNameForNewNetNameConflict(startSnapshot);
}

// ----- commit feedback ----------------------------------------------------
// A brief green "landed" flash over whatever an undoable edit added or
// changed (see commit-feedback.js). It lives in its own SVG layer so overlay
// redraws do not restart it; a canvas rebuild remounts it mid-animation.

let pendingFeedbackSnapshot = null;
export function scheduleInteractionRender() {
  // Routing the draft is the costly part of a wire-mode repaint; do it once
  // per painted frame rather than once per input event.
  wirePreviewStale = true;
  if (renderFrame !== null) return;
  renderFrame = requestAnimationFrame(() => { renderFrame = null; render(); });
}

/** Copied selection. `nets` are complete electrical nets; `fragments` are
 * terminal-less geometric islands extracted from selected segments. A net label
 * selected on its own is stored in `labels` as a floating annotation. */
let clipboard = null;
installCopyPaste();
// ----- toolbar fitting -------------------------------------------------------------

let toolbarFitKey = '';

export function applyJson(blob) {
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
  if (alignTool) alignTool = { source: null, hover: null };
  movePending = false;
  copyPending = false;
  visual = null;
  mode = 'normal';
  labelMode = null;
  annotationPoints = [];
  resetCheckState();
  circuit = loadDocument(JSON.parse(blob));
  // Loads, undo, and redo bring objects back; none of them is newly drawn.
  rememberBeatObjects();
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

export function undo() {
  const cancelled = cancelDirectDraft();
  if (!history.length) {
    if (cancelled) render();
    else hintLine('nothing to undo');
    return;
  }
  const toolState = { copyMode, moveMode, deleteMode };
  const kept = alignTool && keptAlignSelection();
  future.push(snapshot());
  applyJson(history.pop());
  restoreToolState(toolState);
  if (kept) kept();
  render();
}

export function redo() {
  const cancelled = cancelDirectDraft();
  if (!future.length) {
    if (cancelled) render();
    else hintLine('nothing to redo');
    return;
  }
  const toolState = { copyMode, moveMode, deleteMode };
  const kept = alignTool && keptAlignSelection();
  rememberHistory(snapshot(), false);
  applyJson(future.pop());
  restoreToolState(toolState);
  if (kept) kept();
  render();
}

// ----- helpers ---------------------------------------------------------

const clonePoint = (p) => ({ ...p });
/** Copy a point list, optionally through a translation. */
function clonePoints(points, move = clonePoint) {
  return (points || []).map(move);
}
/** Copy fixed-path entries so a drag snapshot shares nothing with the live net. */
export function cloneFixedPaths(entries, move = clonePoint) {
  return (entries || []).map((entry) => ({
    points: clonePoints(entry.points, move),
    start: entry.start ? { ...entry.start } : null,
    end: entry.end ? { ...entry.end } : null,
  }));
}
function cloneWireStyles(styles) {
  return Object.fromEntries(Object.entries(styles || {}).map(([key, style]) => [key, { ...style }]));
}
/** Fixed geometry of one net, detached from the live model. */
function captureFixedGeometry(net) {
  return { fixedPaths: cloneFixedPaths(net.fixedPaths), junctions: clonePoints(net.junctions) };
}
/** Managed route geometry of one net, detached from the live model. */
export function captureRouteGeometry(net, move = clonePoint) {
  return {
    route: net.route ? clonePoints(net.route, move) : null,
    branches: net.branches ? net.branches.map((path) => clonePoints(path, move)) : null,
    junctions: clonePoints(net.junctions, move),
  };
}

export function sortedComps() {
  if (!sortedCompsCache || sortedCompsCache.revision !== modelRevision) {
    sortedCompsCache = { revision: modelRevision, value: [...circuit.components.values()].sort((a, b) => naturalCompare(a.refdes, b.refdes)) };
  }
  return sortedCompsCache.value;
}

function transientCopyGhost() {
  return drag?.mode === 'copyghost' ? drag.ghost : null;
}

export function isTransientCopyGhostRef(refdes) {
  const ghost = transientCopyGhost();
  return !!ghost && (ghost.refs.includes(refdes) || ghost.mirror?.refs?.includes(refdes));
}

export function transientCopyGhostNetIds() {
  const ghost = transientCopyGhost();
  return new Set([...(ghost?.netIds || []), ...(ghost?.mirror?.netIds || [])]);
}

function isTransientCopyGhostNet(id) {
  const ghost = transientCopyGhost();
  return !!ghost && (ghost.netIds.includes(id) || ghost.mirror?.netIds?.includes(id));
}

function unnamedReferenceInfoForNet(net) {
  return net ? circuit.unnamedReferenceInfo(net) : null;
}

function referenceGroupNets(netOrInfo) {
  const info = netOrInfo?.globalName ? netOrInfo : unnamedReferenceInfoForNet(netOrInfo);
  if (!info) return netOrInfo?.id ? [netOrInfo] : [];
  return [...circuit.nets.values()].filter((candidate) => unnamedReferenceInfoForNet(candidate)?.globalName === info.globalName);
}

function namedNetGroupKey(net) {
  return circuit.netGroupKey(net);
}

export function namedGroupNets(net) {
  if (!net?.id) return referenceGroupNets(net);
  const key = namedNetGroupKey(net);
  return [...circuit.nets.values()].filter((candidate) => namedNetGroupKey(candidate) === key);
}

export function visibleNets() {
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

export function rangeValues(items, anchor, value, getValue) {
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
export function nearestTerminal(w, { anyDistance = false } = {}) {
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

export function selectedComp() {
  return selected && circuit.components.has(selected) ? circuit.components.get(selected) : null;
}

/** Replace the selection. `primary` defaults to the first element. */
export function setSelection(refs, primary = refs[0], preserveMixed = false) {
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
export function setLabelSelection(ids, primary = ids[0], preserveMixed = false) {
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
export function keyToWire(key) {
  const [netId, branch, segment] = String(key).split(':');
  return { netId, branch: Number(branch), segment: Number(segment) };
}

/** Keep the primary segment pointer consistent with the selection set. */
export function syncSelectedWire() {
  const first = selectedWires.values().next().value;
  selectedWire = first ? keyToWire(first) : null;
}

/** One selection gesture for every document kind and selectable role.
 * A plain click replaces the complete mixed selection. Shift/Ctrl/Cmd toggles
 * only the clicked identity and preserves every other selected role. */
export function applyEditorSelection(target, extend = false) {
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
export function validateSelectedWires() {
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

export function selectedLabels() {
  return [...selLabels]
    .map((id) => circuit.labels.get(id))
    .filter((label) => label && label.selectable !== false);
}

export function selectedLabel() {
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
installStyleControls();

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

/** Match a world point against label bboxes (labels draw on top of everything). */
export function pickLabel(w) {
  return labelsAt(w)[0] || null;
}

/** Every text label whose box holds a point. A label whose visible text is
 * under the pointer comes first: an aligned label's box reaches past its text,
 * over a neighbour's text, and the text is what the user aims at. */
function labelsAt(w) {
  const x = snap(w.x);
  const y = snap(w.y);
  const p = paneSize();
  const tol = 4 / (p ? view.w / p.w : 1);
  const barHidden = hiddenSupplyBarLabels(circuit);
  const onText = [];
  const inBox = [];
  for (const label of labels()) {
    if (label.selectable === false || barHidden.has(label.id)) continue;
    if (['arrow', 'box', 'line'].includes(label.kind)) continue;
    const r = label.bbox();
    if (!(x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)) continue;
    const ink = label.inkRect();
    const inked = w.x >= ink.x - tol && w.x <= ink.x + ink.w + tol && w.y >= ink.y - tol && w.y <= ink.y + ink.h + tol;
    (inked ? onText : inBox).push(label);
  }
  return [...onText, ...inBox];
}

export function annotationTextAt(world) {
  const p = { x: snap(world.x), y: snap(world.y) };
  for (const label of labels()) {
    if (!['arrow', 'box'].includes(label.kind)) continue;
    const w = Math.max(GRID, label.colWidth() * GRID) / 2;
    const h = Math.max(GRID, label.rowHeight() * GRID) / 2;
    if (Math.abs(p.x - label.textAnchor.x) <= w && Math.abs(p.y - label.textAnchor.y) <= h) return label;
  }
  return null;
}

export function annotationGeometryAt(world) {
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

export function annotationEndpointAt(world) {
  const p = { x: snap(world.x), y: snap(world.y) };
  for (const label of labels()) {
    if (['arrow', 'line'].includes(label.kind)) {
      const index = label.points.findIndex((point) => Math.abs(p.x - point.x) <= GRID / 2 && Math.abs(p.y - point.y) <= GRID / 2);
      if (index >= 0) return { label, endpoint: `vertex:${index}` };
    }
    if (label.kind !== 'arrow') continue;
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

export function selectedComps() {
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
export function layoutSelection() {
  const components = selectedComps();
  const labels = selectedLabels().filter((label) => !label.owner || !multi.has(label.owner));
  // Free annotations and a box/arrow's own child labels line up like any
  // object; applyLayoutPlan keeps a child independent of its moving parent.
  const eligibleLabels = labels.filter((label) => !label.owner && !label.netId);
  const items = [
    ...components.map(componentLayoutItem),
    ...eligibleLabels.map(labelLayoutItem),
  ];
  const wireCount = selectedWires.size || (selectedWire ? 1 : 0);
  const count = components.length + labels.length + selectedNets.size + wireCount;
  const blocked = labels.length !== eligibleLabels.length || selectedNets.size > 0 || wireCount > 0;
  return { items, count, blocked };
}

export function layoutPlan(action, measure = 'gaps') {
  const selection = layoutSelection();
  if (selection.blocked) return { ok: false, reason: 'Select only components or free annotations; wires and net labels cannot be aligned this way.' };
  return action === 'x' || action === 'y'
    ? { ...distributionPlan(selection.items, action, measure), kind: 'distribute' }
    : { ...alignmentPlan(selection.items, action), kind: 'align' };
}

export function updateAlignControls() {
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
    button.dataset.title ??= button.title;
    button.disabled = !plan.ok;
    button.title = plan.ok ? button.dataset.title : plan.reason;
  }
}

export function applyLayoutPlan(plan) {
  if (!plan.ok) { logLine(plan.reason, 'error'); return false; }
  const moves = plan.deltas.filter(({ dx, dy }) => dx || dy);
  if (!moves.length) { logLine('selection is already aligned'); return false; }
  const before = snapshot();
  const original = circuit;
  circuit = Circuit.fromJSON(JSON.parse(before));
  try {
    const refs = moves.filter(({ id }) => circuit.components.has(id)).map(({ id }) => id);
    const touched = netsTouching(refs);
    // Every target is relative to where the object started. Moving a box or
    // arrow carries its child labels along, so place selected children after
    // their parents, from their original anchors -- including children that
    // should not move at all -- or a child would follow its parent.
    const isChild = ({ id }) => !!circuit.labels.get(id)?.parent;
    const children = plan.deltas.filter(isChild);
    const origins = new Map([...moves, ...children].map(({ id }) => [id, circuit.labels.get(id)?.anchorWorld()]));
    for (const { id, dx, dy } of [...moves.filter((move) => !isChild(move)), ...children]) {
      const component = circuit.components.get(id);
      if (component) {
        component.transform.x += dx;
        component.transform.y += dy;
      } else {
        const label = circuit.labels.get(id);
        const origin = origins.get(id);
        if (label && origin) label.moveTo(origin.x + dx, origin.y + dy);
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
    logLine(plan.exact !== false ? 'aligned selection'
      : plan.kind === 'distribute' ? 'distributed on grid; adjacent intervals differ by at most one cell'
        : 'aligned to the nearest grid point; exact alignment falls between grid points');
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

/** Ctrl/Cmd+Shift+arrow: align the selected set's edges. Once the set is
 * already aligned that way, the same key centres it on that axis instead. */
function alignSelectionByKey({ align, repeat }) {
  if (layoutSelection().count < 2) {
    hintLine('select two or more objects to align them');
    return;
  }
  let plan = layoutPlan(align);
  if (plan.ok && plan.deltas.every(({ dx, dy }) => !dx && !dy)) plan = layoutPlan(repeat);
  applyLayoutPlan(plan);
}

installAlignPanel();
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

export function restackSelected(direction) {
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
/** A modal move ghost, or a live mouse drag that has started moving: both
 * accept r / Shift+r / Ctrl+r about the cursor without dropping the drag. */
function moveGhostActive() {
  return drag?.mode === 'move' && (drag.modal || (drag.moved && drag.committed && !drag.duplicate));
}

function recordMoveGhostMutation() {
  if (!drag || !moveGhostActive()) return;
  // A live drag previews in its own document; its drop records the one entry.
  if (drag.modal && !drag.committed) {
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
  const beforeComponents = captureComponentTerminalPositions(refs);
  const beforeTerminals = captureNetTerminalPositions(refs);
  const apply = () => {
    for (const c of selectedComps()) {
      if (pivot) applySingletonWorldTransform(c, 'rotate', pivot);
      else circuit.setTransform(c.refdes, { rotation: (((c.transform.rotation + deg) % 360) + 360) % 360 });
    }
    rerouteTouchedNets(refs, null, true, beforeTerminals, componentTerminalMoves(refs, beforeComponents));
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
  const beforeComponents = captureComponentTerminalPositions(refs);
  const beforeTerminals = captureNetTerminalPositions(refs);
  const apply = () => {
    for (const c of selectedComps()) applySingletonWorldMirror(c, axis, pivot);
    rerouteTouchedNets(refs, null, true, beforeTerminals, componentTerminalMoves(refs, beforeComponents));
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
export function transformMixedSelection(operation, { recordHistory = true, center: pivot = null, translation = null } = {}) {
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
  const beforeComponents = captureComponentTerminalPositions(refs);
  const beforeTerminals = captureNetTerminalPositions(refs);
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
        const terminalsChanged = !beforeTerminals.has(id)
          || beforeTerminals.get(id) !== netTerminalPositionKey(circuit, net);
        const routeArg = net.routingMode === 'fixed'
          ? 'refresh'
          : componentTerminalMoves(refs, beforeComponents);
        if (terminalsChanged && rerouteNet(net, routeArg) === false) {
          throw new Error(`unable to reroute net ${id} safely`);
        }
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
    noteActionPrevented(err);
    return false;
  }
}

/** Re-route every net touching the given components (holistic, from terminals).
 *  `moved` (optional) is a Map of refdes -> {dx,dy} so drawn wire shapes are
 *  preserved instead of recomputed when a component is dragged. */
function captureNetTerminalPositions(refs) {
  const ids = netsTouching(refs);
  return new Map([...ids].map((id) => {
    const net = circuit.nets.get(id);
    return [id, netTerminalPositionKey(circuit, net)];
  }));
}

function captureComponentTerminalPositions(refs) {
  return new Map(refs.map((refdes) => {
    const component = circuit.components.get(refdes);
    return [refdes, {
      origin: component ? { x: component.transform.x, y: component.transform.y } : null,
      terminals: new Map(component?.worldTerminals().map((terminal) => [terminal.name, { x: terminal.x, y: terminal.y }]) || []),
    }];
  }));
}

function componentTerminalMoves(refs, before) {
  return new Map(refs.map((refdes) => {
    const component = circuit.components.get(refdes);
    const previous = before.get(refdes);
    const terminals = new Map(component?.worldTerminals().map((terminal) => [terminal.name, {
      before: previous?.terminals.get(terminal.name) || { x: terminal.x, y: terminal.y },
      after: { x: terminal.x, y: terminal.y },
    }]) || []);
    return [refdes, {
      dx: component && previous?.origin ? component.transform.x - previous.origin.x : 0,
      dy: component && previous?.origin ? component.transform.y - previous.origin.y : 0,
      terminals,
    }];
  }));
}

function rerouteTouchedNets(refs, moved, fresh = false, beforeTerminals = null, terminalMoves = null) {
  for (const id of netsTouching(refs)) {
    const net = circuit.nets.get(id);
    if (!net) continue;
    const unchanged = fresh && beforeTerminals?.has(id)
      && beforeTerminals.get(id) === netTerminalPositionKey(circuit, net);
    const routeArg = unchanged ? null
      : net.routingMode === 'fixed' ? (fresh ? 'refresh' : moved)
        : terminalMoves || (fresh ? 'refresh' : moved);
    if (rerouteNet(net, routeArg) === false) throw new Error(`unable to reroute net ${id} safely`);
  }
}

/** Delete all selected objects together in one undo step.  Selected whole nets
 *  are removed before segment cuts, so selecting both cannot leave fragments;
 *  touched-but-unselected nets are rerouted afterward. */
export function deleteSelection() {
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

/** A tap of Space: a labelled wire stub on every unconnected terminal of the
 * selected parts, skipping any that would short (core/stubs.js). */
export function stubSelection() {
  if (mode !== 'normal' || drag || hasWireDraft() || labelMode || moveMode || copyMode || deleteMode || visual) return;
  const refs = selectedComps().map((c) => c.refdes);
  if (!refs.length) {
    hintLine('Space: select parts to add wire stubs to their unconnected terminals');
    return;
  }
  const out = commit(() => addTerminalStubs(circuit, refs));
  if (!out) return;
  rememberAction('wire stubs', stubSelection);
  const added = out.stubs.length ? `added ${out.stubs.length} wire stub${out.stubs.length === 1 ? '' : 's'}` : 'no unconnected terminals to stub';
  logLine(`${added}${out.skipped.length ? `; skipped ${out.skipped.join(', ')} (would short)` : ''}`);
  render();
}
export function moveCursor(cellsX, cellsY) {
  const next = { x: snap(cursor.x + cellsX * 40), y: snap(cursor.y + cellsY * 40) };
  cursor = wire && terminalSnap ? terminalSnapWorld(next) : next;
  followCursor();
}

/** Fit the view to all contents (F), preserving the pane aspect ratio so the
 *  drawing always fills the space without distortion. */
// ----- view animation --------------------------------------------------------

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

export function cycleLabelSelection(dir, fromId = selectedLabel()?.id) {
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

// ----- beats ---------------------------------------------------------------------
// A beat is a view of the one drawing (core/beats.js). The editor shows one
// beat at a time: what it hides is faded but still selectable, and drawing
// edits still change the drawing, in every beat. View changes made on a beat
// -- h (show/hide), Shift+H (dim), s (switch position), the highlight tool --
// belong to that beat and carry on to the following beats that looked the same.

installBeatsUi();

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
export function symmetryAxisText() {
  if (!symmetry?.operation) return '';
  return symmetry.operation === 'mirrorX' ? `x=${symmetry.pin.x}` : `y=${symmetry.pin.y}`;
}

export function symmetryTwin(base = pendingTransform()) {
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
export function syncSymmetryOperation() {
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
export function clearSymmetry() {
  dropCopyGhostMirror();
  symmetry = null;
  symmetryMemory = null;
}

/** Arm or drop symmetric placement. It belongs to a component ghost only.
 *  Releasing the modifier takes the twin away but keeps a settled axis, so a
 *  transform between two pairs costs nothing: the next press resumes it. */
export function setSymmetry(on) {
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
    noteTip('symmetry');
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
  if (next) noteTip('terminal-snap');
  render();
  return true;
}

// ----- splice into wire -------------------------------------------------------
// A part whose two free series pins (both pins of a two-terminal part, or a
// transistor's drain/source or collector/emitter) land on one straight managed
// wire segment is inserted in series: the span between those pins is cut.

function managedWirePaths() {
  return [...circuit.nets.values()]
    .filter((net) => net.routingMode !== 'fixed')
    .flatMap((net) => net.paths().map((pts, branch) => ({ netId: net.id, branch, pts })));
}

/** World points of a part's series pins under `transform`, or null. */
function seriesPinPoints(def, transform) {
  const names = seriesTerminalNames(def);
  if (!names) return null;
  return def.terminals.filter((t) => names.includes(t.name)).map((t) => applyTransform(transform, t.x, t.y));
}

/** The segment a part's free series pins would splice into. For a placed part
 * (`refdes`), a series pin that is already connected rules the splice out. */
function spliceTargetFor(points, refdes = null) {
  if (points?.length !== 2) return null;
  if (refdes) {
    const names = seriesTerminalNames(circuit.components.get(refdes)?.def) || [];
    if (names.some((term) => circuit.netOfTerminal({ comp: refdes, term }))) return null;
  }
  return spliceCandidate(points, managedWirePaths());
}

function spliceIfOnWire(comp) {
  if (!comp) return false;
  const points = seriesPinPoints(comp.def, comp.transform);
  const target = spliceTargetFor(points, comp.refdes);
  if (!target) return false;
  const name = circuit.nets.get(target.netId)?.name || target.netId;
  circuit.spliceIntoSegment(comp.refdes, target.netId, target.branch, target.segment);
  logLine(`spliced ${comp.refdes} into ${name}`);
  return true;
}

/** Highlight for the wire a ghost or a dragged part would splice into. */
export function splicePreviewTarget(ghost) {
  if (ghost?.def) {
    const t = { x: ghost.x, y: ghost.y, rotation: ghost.rotation, mirrorX: ghost.mirrorX, mirrorY: ghost.mirrorY };
    return spliceTargetFor(seriesPinPoints(ghost.def, t));
  }
  if (drag?.mode === 'move' && drag.moved && !drag.detached && drag.origins?.size === 1) {
    const refdes = [...drag.origins.keys()][0];
    const comp = circuit.components.get(refdes);
    if (!comp) return null;
    return spliceTargetFor(seriesPinPoints(comp.def, comp.transform), refdes);
  }
  return null;
}

export function placePending() {
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
    const repeatType = !twin && [...circuit.components.values()].some((c) => c.type === pendingPlace.type);
    const placed = placements.map((t) => circuit.addComponent(pendingPlace.type, {
      x: t.x,
      y: t.y,
      rotation: t.rotation,
      mirrorX: t.mirrorX,
      mirrorY: t.mirrorY,
      noLabel: false,
    }));
    // A lone part dropped with its series pins along a wire is spliced into it.
    if (placed.length === 1) spliceIfOnWire(placed[0]);
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
    // A second part of a kind is where a mirrored twin would have helped.
    if (repeatType && !isReferenceMarker(placed[0]) && !INTERFACE_PIN_TYPES.has(pendingPlace.type)
      && !['solder', 'block'].includes(pendingPlace.type)) noteTip('place-repeat');
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

let documentSurfaceShown = false;

function syncDocumentSurface() {
  // Reveal the schematic surface once. Later visibility belongs to each
  // control's owner: unhiding here on every repaint flip-flopped the align
  // panel against updateAlignControls, re-laying out the side panel per frame.
  if (!documentSurfaceShown) {
    documentSurfaceShown = true;
    for (const element of document.querySelectorAll('[data-doc-kind]')) {
      element.hidden = false;
    }
  }
  // Every repaint calls this. Write only real changes: rewriting the toolbar
  // heading's text is a DOM mutation, and the toolbar's overflow observer
  // answers each one with a forced layout.
  const heading = document.getElementById('mode-heading');
  if (heading && heading.textContent !== 'Schematic tools') heading.textContent = 'Schematic tools';
  const placeholder = 'Schematic command (e.g. add resistor, move R1 120 80, connect R1.a R2.a)';
  if (cmdInput && cmdInput.placeholder !== placeholder) cmdInput.placeholder = placeholder;
  const netLabelButton = document.getElementById('btn-mode-net-label');
  if (netLabelButton && netLabelButton.title !== 'Place a label on a physical wire (Shift+L)') {
    netLabelButton.title = 'Place a label on a physical wire (Shift+L)';
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
  card.hidden = !empty || mode === 'insert' || !!wire || !!labelMode || !!tutorial;
  if (card.hidden) return;
  card.querySelector('.empty-state-title').textContent = 'Empty schematic';
  card.querySelector('[data-empty-action="wire"] .empty-state-text').textContent = 'Draw a wire';
  card.querySelector('[data-empty-action="place"] .empty-state-text').textContent = 'Insert a component';
}

export function render() {
  syncDocumentSurface();
  syncEmptyState();
  syncTutorial();
  syncViewToPane();
  // An open inline editor sits over its text at the current zoom and pan.
  inlineInput?.relayout?.();
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
    renderTextMatches();
    renderComponents();
    renderNets();
    renderDetail();
  }
  renderCheckSummary();
  syncAnalysisDock();
  renderBeatStrip();
  renderStatus();
  renderSaveState();
  updateInsertMenu();
  if (window.__app) {
    window.__app.renders.push({ t: performance.now(), view: { ...view } });
    if (window.__app.renders.length > 500) window.__app.renders.shift();
  }
}

export function draftRoutePath(draft, to = cursor) {
  if (!draft?.source) return undefined;
  const from = wireOrigin(draft.source);
  if (!from) return undefined;
  const endpoints = [from, ...(draft.points || []), to].map((p) => ({ x: snap(p.x), y: snap(p.y) }));
  const allowDiagonal = draft.routeStyle === 'diagonal';
  const sourceNetId = draft.source.netId ||
    (draft.source.refdes ? circuit.netOfTerminal(`${draft.source.refdes}.${draft.source.term}`)?.id : null);
  // The destination may already belong to a net while the source terminal is
  // still unconnected. Exclude both sides from the preview environment: a
  // same-net branch is allowed to meet its existing geometry, and the commit
  // path will splice it at the selected terminal/wire target. Without this,
  // the preview treats the destination net as an obstacle and rejects valid
  // terminal orders such as M3 -> M1 after M2 -> M1.
  // A free wire end is met at its tip, never along its wire, so a draft
  // from or to one keeps that wire as an obstacle.
  const openEnds = circuit.openWireEnds();
  const isOpenEnd = (p, netId) => openEnds.some((end) => end.netId === netId && end.point.x === p.x && end.point.y === p.y);
  const excludedNets = new Set(sourceNetId && !isOpenEnd(endpoints[0], sourceNetId) ? [sourceNetId] : []);
  for (const component of circuit.components.values()) {
    for (const terminal of component.worldTerminals()) {
      if (terminal.x !== endpoints.at(-1).x || terminal.y !== endpoints.at(-1).y) continue;
      const net = circuit.netOfTerminal({ comp: component.refdes, term: terminal.name });
      if (net) excludedNets.add(net.id);
    }
  }
  for (const net of circuit.nets.values()) {
    if (isOpenEnd(endpoints.at(-1), net.id)) continue;
    if (net.paths().some((path) => pointOnPath(endpoints.at(-1), path))) excludedNets.add(net.id);
  }
  const env = circuit._netEnv(excludedNets);
  // Diagonal drafts use the model's own geometry: literal legs between clicked
  // points, auto-routed legs at pins.
  if (allowDiagonal) return diagonalDraftPath(circuit, endpoints, env) || undefined;
  const path = [endpoints[0]];
  const route = (a, b) => smartRoute(a, b, { ...env, allowDiagonal: false, preferMidpoint: true });
  for (let i = 1; i < endpoints.length; i++) {
    // Keep the interactive suggestion centered when several safe orthogonal
    // channels are otherwise equivalent; Enter commits this same path.
    let leg = route(endpoints[i - 1], endpoints[i]);
    if (!leg) return undefined;
    if (draft.flipCorner && i === endpoints.length - 1) leg = flippedCornerLeg(leg, route) || leg;
    for (const point of leg.slice(1)) path.push({ ...point });
  }
  return path;
}

/** The same leg turning the other way first: through the opposite corner of
 * its bounding box. Null when that corner cannot be routed safely. */
function flippedCornerLeg(leg, route) {
  const a = leg[0];
  const b = leg.at(-1);
  if (a.x === b.x || a.y === b.y || leg.length < 2) return null;
  const firstHorizontal = leg[1].y === a.y;
  const corner = firstHorizontal ? { x: a.x, y: b.y } : { x: b.x, y: a.y };
  const first = route(a, corner);
  const second = route(corner, b);
  return first && second ? [...first, ...second.slice(1)] : null;
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
  const parent = label.parent ? circuit.labels.get(label.parent) : null;
  const reach = parent ? annotationReach(parent) : null;
  if (reach) {
    const { dx, dy } = attachedEdgeShift(before, label.bbox(), reach);
    if (dx || dy) label.moveTo(label.anchor.x + dx, label.anchor.y + dy);
    return;
  }
  const shift = alignedAnchorShift(label.align, before.w, label.bbox().w);
  if (!shift) return;
  const anchor = label.anchorWorld();
  label.moveTo(anchor.x + shift, anchor.y);
}

export function syncRenderedLabelMetrics() {
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
    // A measured bbox is a one-time model resize for the current text. Do not
    // feed a later container-size measurement back into the model or a
    // foreignObject can resize itself forever. Text edits clear this runtime
    // metric and allow one fresh pass. Checking first also spares the forced
    // layout that measuring costs on every rebuild.
    if (label._renderedTextBounds) continue;
    const group = groups.get(label.id);
    const bounds = renderedLabelTextBounds(group);
    if (!bounds) continue;
    // A caption's edge against its parent was set by the box it had before
    // this text: the placement estimate for new text, the last measurement
    // after an edit.
    const before = (label.parent && label._boxBeforeEdit) || label.bbox();
    label._boxBeforeEdit = null;
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

export function renderCanvas(modelKey) {
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
  const beatView = activeBeatView(modelKey);
  // The drawing is in world coordinates; only its frame depends on the view.
  // Pan and zoom therefore re-apply the frame and keep the drawing's DOM.
  const canvasKey = `${modelKey}|${showGrid}|${editingLabelId}|${beatView ? beatView.index : ''}|${[...ghostRefs].join(',')}|${[...ghostLabels].join(',')}|${[...ghostNets].join(',')}`;
  const viewKey = `${view.x},${view.y},${view.w},${view.h}`;
  const canvasRebuilt = canvasKey !== committedCanvasKey || !canvasSvgEl;
  if (!canvasRebuilt && viewKey !== committedViewKey) {
    committedViewKey = viewKey;
    applyCanvasViewport();
  }
  if (canvasRebuilt) {
    committedCanvasKey = canvasKey;
    committedViewKey = viewKey;
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
      ...(beatView ? { beat: { view: beatView, fade: true } } : {}),
    });
    canvasSvgEl = canvasEl.querySelector('svg');
    if (syncRenderedLabelMetrics()) scheduleMeasuredLabelRender();
    overlayEl = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    overlayEl.setAttribute('class', 'editor-overlay');
    canvasSvgEl.appendChild(overlayEl);
    // The snap pulse lives outside the per-frame overlay so its animation
    // plays once per new target instead of restarting on every repaint.
    snapLayerEl = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    snapLayerEl.setAttribute('class', 'snap-layer');
    snapLayerEl.setAttribute('pointer-events', 'none');
    canvasSvgEl.appendChild(snapLayerEl);
    snapPulseKey = '';
  }
  // Design-check focus is drawn separately (error color); only real selection is blue.
  const nets = [...selectedNets].map((id) => circuit.nets.get(id)).filter(Boolean);
  // Solder dots sitting on a highlighted net's junction points get a halo so
  // wire junctions on the net stand out. Device bodies are not highlighted,
  // but the parts that stand for the net itself are: reference markers
  // (ground, supply, VCM) and interface ports on it glow with its wires.
  const netSolder = [];
  const netMarkers = netMarkerRefs(nets);
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
    beatView: activeBeatView(previewTransaction ? `${modelRevision}:preview:${previewRevision}` : modelRevision),
    tutorialTargets: tutorialTargetRects(),
    pageGuide: pageGuide ? { frame: circuitPageGuideFrame(circuit, pageGuide), view, caption: pageGuideCaption(pageGuide) } : null,
    cursor,
    netLabelPaste: netLabelPastePreview(cursor),
    selection: [...multi],
    emphasis: equationEmphasis,
    diagnostic: diagnosticSelection,
    alignTool: alignOverlay(),
    resizeBlocks: alignTool ? [] : [...multi].filter((ref) => {
      const component = circuit.components.get(ref);
      return component?.type === 'block' && component.transform.rotation % 360 === 0 && !component.transform.mirrorX && !component.transform.mirrorY;
    }),
    resizeBoxes: alignTool ? [] : [...selLabels].filter((id) => circuit.labels.get(id)?.kind === 'box'),
    hoverAnnotation: drag || alignTool ? null : hoverAnnotationId,
    handleScale: worldPerPixel(),
    ghostTwin,
    symmetryAxis,
    centerGuides: placementGuide?.guides.length || alignTool ? null : selectionCenterBounds(),
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
    netSolder,
    netMarkers,
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
    wirePreview: wire ? currentWirePreview() : null,
    directWirePreview: directPreview,
    wireMode: !!wire || !!directWire,
    wireSource: (wire || directWire)?.source ? { ...(wire || directWire).source } : undefined,
    terminalSnapTarget: terminalSnap ? nearestSnapTarget(cursor) : null,
    ghost,
    cursorCrosshair: crosshairVisible && cursorInCanvas ? view : null,
  });
  // Ghosts and previews use the same theme-aware ink as the committed drawing.
  overlayEl.innerHTML = themeInkSvg(withGestureOverlay(overlay, ghost));
  syncSnapPulse();
  flushPendingCommitFeedback();
  mountCommitFeedback(canvasRebuilt);
}

function currentWirePreview() {
  if (wirePreviewStale) {
    wirePreview = wire ? draftWirePreview(wire) : null;
    wirePreviewStale = false;
  }
  return wirePreview;
}

// ----- hover preview -------------------------------------------------------------
// Hovering a wire or pin tints its whole net, and the matching side-panel row
// lights up; hovering a panel row does the same on the canvas.
let hoverTarget = null; // { kind:'net', ids } | { kind:'component', refdes }

let hoverFromPanel = false;

let hoverPinsRef = null; // component whose pins show drag handles in Select mode

let hoverAnnotationId = null; // arrow/line whose vertex handles show in Select mode

// ----- snap pulse ------------------------------------------------------------------
let snapLayerEl = null;

let snapPulseKey = '';

// ----- mouse ------------------------------------------------------------

const DRAG_THRESH = 6; // px before a press becomes a drag
let drag = null;
let inlineInput = null; // the active inline-edit <input>, if any

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
  if (drag?.mode === 'radialpending' || drag?.mode === 'radial') {
    window.clearTimeout(drag.holdTimer);
    closeRadialMenu();
    drag = null;
    render();
    return;
  }
  if (drag?.mode === 'pinwire' || drag?.mode === 'copygrab' || drag?.mode === 'knife') {
    drag = null;
    endGestureWire();
    render();
    return;
  }
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

export function beginMarqueeSelection(startWorld, startClient, ev) {
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
export function pickAt(w) {
  return matchAt(snap(w.x), snap(w.y));
}

/** A joined supply bar acts as one part: its supplies, or just `refdes`. */
export function supplyBarGroup(refdes) {
  if (circuit.components.get(refdes)?.type !== 'supply') return [refdes];
  return supplyBars(circuit).find((bar) => bar.refs.includes(refdes))?.refs || [refdes];
}

/** The joined bar under a pointer, as a hit on its first supply. The gap
 *  between two supplies belongs to no symbol, so it is tested separately
 *  (with the wire hit tolerance) rather than through `matchAt`. */
export function supplyBarHit(w) {
  const p = paneSize();
  const tol = Math.max(GRID / 4, 12 / (p ? view.w / p.w : 1));
  const bar = supplyBars(circuit).find(({ rect: r }) => w.x >= r.x - tol && w.x <= r.x + r.w + tol
    && w.y >= r.y - tol && w.y <= r.y + r.h + tol);
  return bar ? { refdes: bar.refs[0] } : null;
}

/** Every wire segment within the screen-sized hit area of a point. */
function wireHitsAt(w) {
  const p = paneSize();
  const tol = 12 / (p ? view.w / p.w : 1);
  if (wireHitIndexRevision !== modelRevision) {
    wireHitIndex = buildWireHitIndex(circuit.nets.values());
    wireHitIndexRevision = modelRevision;
  }
  return queryWireHitIndex(wireHitIndex, w, { x: snap(w.x), y: snap(w.y) }, tol);
}

// ----- click-to-cycle through stacked objects ----------------------------------
// Parts' boxes often meet along an edge where a wire or junction dot also
// sits. The first click there picks the topmost object as always; clicking
// the selected object again selects the next one under it.

/** Selection keys under a point, topmost first, in the order a click picks:
 * the labels (text under the pointer first), a part with a pin there, the
 * wires (one per net), junction dots, then the parts whose box holds the
 * point. */
function stackedSelectionCandidates(w) {
  const keys = [];
  const add = (key) => { if (!keys.includes(key)) keys.push(key); };
  for (const label of labelsAt(w)) add(`label:${label.id}`);
  const p = { x: snap(w.x), y: snap(w.y) };
  for (const c of sortedComps()) {
    if (c.worldTerminals().some((t) => t.x === p.x && t.y === p.y)) add(`component:${c.refdes}`);
  }
  const first = pickWire(w);
  const wires = first ? [first, ...wireHitsAt(w).sort((a, b) => a.distance - b.distance)] : [];
  const nets = new Set();
  for (const hit of wires) {
    if (nets.has(hit.net.id)) continue;
    nets.add(hit.net.id);
    add(`wire:${hit.net.id}:${hit.branch}:${hit.seg}`);
  }
  for (const c of sortedComps()) {
    if (c.type === 'solder' && c.transform.x === p.x && c.transform.y === p.y) add(`component:${c.refdes}`);
  }
  for (const c of sortedComps()) {
    const r = c.bboxWorld();
    if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) add(`component:${c.refdes}`);
  }
  return keys;
}

/** The selection as one stacked-selection key, or null when it is not a
 * single object (a joined supply bar counts as its clicked supply). */
function currentSelectionKey() {
  const wires = new Set(selectedWires);
  if (selectedWire) wires.add(`${selectedWire.netId}:${selectedWire.branch}:${selectedWire.segment}`);
  if (multi.size && !selLabels.size && !wires.size) {
    const group = supplyBarGroup(selected);
    const single = multi.size === 1 || (group.length === multi.size && group.every((ref) => multi.has(ref)));
    return single && selected ? `component:${selected}` : null;
  }
  if (selLabels.size === 1 && !multi.size && !wires.size) return `label:${selLabel}`;
  if (wires.size === 1 && !multi.size && !selLabels.size) return `wire:${[...wires][0]}`;
  return null;
}

function stackedKeyName(key) {
  const [kind, id] = key.split(':');
  if (kind === 'label') {
    const label = circuit.labels.get(key.slice('label:'.length));
    return label ? `${label.owner ? `${label.owner} label` : label.netId ? 'net label' : 'label'} "${label.text}"` : 'label';
  }
  return kind === 'wire' ? `wire of net ${id}` : `component ${id}`;
}

function selectStackedKey(key) {
  const [kind, ...rest] = key.split(':');
  const id = rest.join(':');
  selectedNets.clear();
  if (kind === 'component') setSelection(supplyBarGroup(id), id);
  else applyEditorSelection({ kind, id });
}

/** Pick the nearest net route within a forgiving screen-sized hit area.
 *  Considers EVERY drawn branch of a multi-way net, so a joined/connected wire
 *  is selectable and draggable anywhere along it. */
export function pickWire(w) {
  return chooseWireHitCandidate({
    candidates: wireHitsAt(w),
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
  hintLine(junction >= 0 ? 'fixed junction — drag to move its dot' : vertex >= 0 ? 'fixed vertex — drag to move it' : 'fixed path — drag to move its segment');
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
  hintLine('fixed open endpoint — drag to move, or use Wire to extend');
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

// ----- wire segment editing (see src/core/wireedit.js) ----------------------
// wireRunAt, collapseCollinear, findRunLine, moveWireRun are pure polyline
// helpers imported from src/core/wireedit.js (unit tested there).

// ----- smart net routing ----------------------------------------------------

/** Recompute the explicit route of a net (pairwise through its terminals in order). */
function rerouteNet(net, moved) {
  return circuit.rerouteNet(net, moved);
}

/** Ids of every net that touches any of the given components. */
export function netsTouching(refs) {
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

/** What the Alt-held wiring cursor snaps to: the nearest component terminal
 * or free wire end, so a floating wire or a stub continues like a pin. */
function nearestSnapTarget(point) {
  const ends = circuit.openWireEnds().map((end) => ({ x: end.point.x, y: end.point.y, wireEnd: end }));
  const terminal = nearestTerminal(point, { anyDistance: true });
  return nearestPoint(point, terminal ? [terminal, ...ends] : ends);
}

function terminalSnapWorld(point) {
  const hit = nearestSnapTarget(point);
  return hit ? { x: hit.x, y: hit.y } : snappedWorld(point);
}

function cursorWorld(point) {
  return wire && terminalSnap ? terminalSnapWorld(point) : snappedWorld(point);
}

function connectTwo(src, dst, points, before = snapshot()) {
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
    hintLine(`${activeDirectLabel()} from fixed open endpoint @ (${fixedEndpoint.point.x},${fixedEndpoint.point.y}) — click waypoints, then target`);
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
      hintLine(`${activeDirectLabel()} from ${hit.refdes}.${hit.term} — click points, then a target terminal`);
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
    hintLine(`direct point @ (${x},${y})`);
  } else {
    hintLine(`${activeDirectLabel()}: click a terminal or open fixed endpoint to start`);
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
    hintLine(`${activeDirectLabel()}: click a terminal or open fixed endpoint to start`);
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
    hintLine(`wire from fixed open endpoint @ (${fixedEndpoint.point.x},${fixedEndpoint.point.y}) — click points, then target`);
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
      hintLine(`wire from ${hit.refdes}.${hit.term} — terminal clicks commit; other clicks guide; Enter commits elsewhere`);
      noteWireToolStart();
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
    // A free wire end finishes the draft like a terminal: the wire joins it.
    const end = circuit.openWireEnds().find((e) => e.point.x === x && e.point.y === y);
    if (end && !(wire.source.x === x && wire.source.y === y)) {
      const net = circuit.nets.get(end.netId);
      const path = net.paths()[end.pathIndex];
      cursor = { x, y };
      joinWireToNet({ net, branch: end.pathIndex }, {
        netId: end.netId,
        pathIndex: end.pathIndex,
        segmentIndex: end.endpointIndex === 0 ? 1 : path.length - 1,
        point: { x, y },
      });
      render();
      return;
    }
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
    hintLine(`wire segment @ (${x},${y}) — click more points or commit`);
  } else {
    // Starting a wire needs no terminal: click any grid point (or a wire) and
    // the draft grows from there.
    startWireAt({ x, y });
    if (wire?.source) noteWireToolStart();
  }
  render();
}

/** A wire begun by clicking in the Wire tool: the situation both the Alt-snap
 *  and the pin-drag tips are about. The first tip that is due wins. */
function noteWireToolStart() {
  if (terminalSnap) return;
  noteTip('wire-start');
  noteTip('wire-tool-start');
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
    hintLine(`wire from net ${wireHit.net.id} @ (${P.x},${P.y}) — click points, then click/Enter on a target`);
  } else {
    wire.source = { x: snap(w.x), y: snap(w.y) };
    wire.points = [];
    cursor = { x: snap(w.x), y: snap(w.y) };
    hintLine('wire from a free point — click points, then commit');
  }
}

/** Pressing Enter in wire mode commits the draft wire: onto a terminal,
 *  another wire, or as an open-ended managed branch in empty space. */
export function commitWireAtCursor() {
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
export function connectWireToTerminal(dst, before = null) {
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
  noteTip('wire-commit');
  if (src.refdes) {
    connectTwo(src, dst, points, before || snapshot());
    return;
  }
  const start = before || snapshot();
  const net = circuit.wirePointTo({ x: src.x, y: src.y }, end, points, src.netId, wireRouteOptions());
  markModelChanged(); // a draft spliced into the target net
  recordHistoryEntry(start, false);
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

// ----- radial menu -------------------------------------------------------------
let radialMenuEl = null;

// ----- pin-drag wiring --------------------------------------------------------
// Dragging out of a pin draws a managed wire without entering Wire mode. The
// draft is the ordinary `wire` draft, so preview, routing, and commits are the
// Wire tool's own; the gesture only decides where the drop lands.

let gestureWire = false; // the current wire draft belongs to a pin drag

function beginPinWire(moveDrag, w) {
  cancelPreviewTransaction();
  setSelection([]);
  setLabelSelection([]);
  wire = newWireDraft();
  gestureWire = true;
  wire.source = { ...moveDrag.pinGrab };
  wire.points = [];
  drag = { mode: 'pinwire', startWorld: moveDrag.startWorld, startClient: moveDrag.startClient };
  noteTip('pin-drag');
  cursor = pinWireCursor(w);
  hintLine(`wire from ${wire.source.refdes}.${wire.source.term} — drop on a pin or wire, or in space to add a part`);
  render();
}

/** Drops snap to a nearby pin first, so a near miss still connects. */
function pinWireCursor(w) {
  const target = nearestTerminal(w);
  const source = wire?.source;
  if (target && !(source && target.refdes === source.refdes && target.term === source.term)) {
    return { x: target.x, y: target.y };
  }
  return snappedWorld(w);
}

/** Ctrl/Cmd-drag from inside a wire: a new branch grows from the grab point. */
function beginBranchWire(segDrag, w) {
  cancelPreviewTransaction();
  setSelection([]);
  setLabelSelection([]);
  selectedWire = null;
  selectedWires.clear();
  wire = newWireDraft();
  gestureWire = true;
  startWireAt(segDrag.startWorld);
  if (!wire.source) {
    endGestureWire();
    drag = null;
    render();
    return;
  }
  drag = { mode: 'pinwire', startWorld: segDrag.startWorld, startClient: segDrag.startClient };
  noteTip('pin-drag');
  cursor = pinWireCursor(w);
  hintLine('branch wire — drop on a pin or wire, or in space to add a part');
  render();
}

/** Ctrl/Cmd-drag on an object drags a copy; a plain Ctrl/Cmd-click still toggles selection. */
/** Ctrl/Cmd on a label arms a copy, as it does on a part: dragging copies
 * the label (with the rest of the selection it belongs to), and a click
 * without a drag toggles it in the selection. An owned label copies its part. */
function armLabelCopyGrab(label, startWorld, startClient, ev) {
  if (!(ev.ctrlKey || ev.metaKey) || ev.shiftKey) return false;
  cursor = { x: snap(startWorld.x), y: snap(startWorld.y) };
  const owner = label.owner ? circuit.components.get(label.owner) : null;
  drag = owner
    ? { mode: 'copygrab', hit: { refdes: owner.refdes }, startWorld, startClient }
    : { mode: 'copygrab', label: { id: label.id }, startWorld, startClient };
  return true;
}

function beginCopyDrag(grab, ev) {
  const { hit, startWorld, startClient } = grab;
  if (grab.label) {
    const member = selLabels.has(grab.label.id);
    // A net label copied on its own carries only its name: the drag drops it
    // on another wire, which that net then takes.
    const label = circuit.labels.get(grab.label.id);
    if (label?.netId && (!member || (!multi.size && [...selLabels].every((id) => circuit.labels.get(id)?.netId)))) {
      beginNetLabelPaste(label.text, { once: true });
      drag = { mode: 'netlabelpaste', startWorld, startClient, moved: true };
      canvasMouseMove(ev);
      return;
    }
    drag = null;
    beginObjectMove(member ? [...multi] : [], member ? [...selLabels] : [grab.label.id], startWorld, startClient, { duplicate: true });
    canvasMouseMove(ev);
    return;
  }
  // A joined supply bar moves (or copies) as one part.
  const refs = multi.has(hit.refdes) ? [...multi] : supplyBarGroup(hit.refdes);
  const labels = multi.has(hit.refdes) ? [...selLabels] : [];
  drag = null;
  setSelection(refs, hit.refdes, true);
  setLabelSelection(labels, labels[0], true);
  beginObjectMove(refs, labels, startWorld, startClient, { duplicate: true });
  canvasMouseMove(ev);
}

export function endGestureWire() {
  if (!gestureWire) return;
  gestureWire = false;
  wire = null;
  terminalSnap = false;
}

function finishPinWire(w, ev) {
  if (!wire?.source) {
    endGestureWire();
    render();
    return;
  }
  const source = wire.source;
  const target = nearestTerminal(w);
  if (target && !(target.refdes === source.refdes && target.term === source.term)) {
    cursor = { x: target.x, y: target.y };
    try { connectWireToTerminal(target); } catch (err) { logLine(String(err.message || err)); }
    endGestureWire();
    render();
    return;
  }
  const wireHit = pickWire(w);
  if (wireHit) {
    cursor = snappedWorld(w);
    joinWireToNet(wireHit);
    endGestureWire();
    render();
    return;
  }
  const origin = wireOrigin(source);
  cursor = snappedWorld(w);
  if (origin && origin.x === cursor.x && origin.y === cursor.y) {
    endGestureWire();
    render();
    return;
  }
  render();
  openQuickAdd({ clientX: ev.clientX, clientY: ev.clientY, point: { ...cursor }, fromWire: true });
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
  spaceTap = false;

  if (b === 1 || (b === 0 && spaceHeld)) {
    ev.preventDefault();
    drag = {
      mode: 'pan',
      spacePan: b === 0,
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
    if (hit?.refdes && circuit.components.has(hit.refdes) && !hasWireDraft() && !hasModalPlacement()) {
      ev.preventDefault();
      closeComponentContextMenu();
      drag = { mode: 'radialpending', refdes: hit.refdes, startClient, startWorld };
      drag.holdTimer = window.setTimeout(() => {
        if (drag?.mode === 'radialpending') openRadialMenu(drag);
      }, 280);
      return;
    }
    ev.preventDefault();
    drag = { mode: 'zoom', startClient, startWorld, moved: false, rubber: null };
    return;
  }
  if (alignTool && b === 0) {
    alignMouseDown(startWorld, startClient, ev);
    return;
  }
  if (b !== 0) return;
  const handle = ev.target.closest?.('[data-resize-handle]');
  const handleOwner = handle?.closest?.('[data-resize-id]');
  if (handleOwner?.dataset.resizeKind === 'component') {
    const refdes = handleOwner.dataset.resizeId;
    const component = circuit.components.get(refdes);
    if (component?.type === 'block') {
      const origin = component.bboxWorld();
      setSelection([refdes]);
      setLabelSelection([]);
      drag = {
        mode: 'blockresize', refdes, handle: handle.dataset.resizeHandle,
        startWorld, startClient, origin, startSnapshot: snapshot(), moved: false,
      };
      try { canvasEl.setPointerCapture?.(ev.pointerId); } catch {}
      render();
      return;
    }
  }
  if (handleOwner?.dataset.resizeKind === 'annotation') {
    const label = circuit.labels.get(handleOwner.dataset.resizeId);
    if (label?.kind === 'box') {
      setSelection([]);
      setLabelSelection([label.id]);
      drag = {
        mode: 'boxresize', label, handle: handle.dataset.resizeHandle,
        startWorld, startClient, origin: label.bbox(), startBox: boxState(label), startSnapshot: snapshot(), moved: false,
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
      // Shift-drag is a knife: it deletes everything the stroke cuts (see knifeTargets).
      knife: ev.shiftKey ? [{ x: startWorld.x, y: startWorld.y }] : null,
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
    cursor = draftPointAt(startWorld, ev.shiftKey);
    drag = { mode: 'annotationlineplace', startClient, startWorld, moved: false, previewEnd: { ...cursor }, rubber: null };
    return;
  }
  if (labelMode === 'arrow' || labelMode === 'box') {
    // Keep the cursor and preview anchored to the actual press. When a first
    // click has already established annotationStart, the next press begins
    // with its endpoint visible before any movement occurs.
    cursor = draftPointAt(startWorld, ev.shiftKey);
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
    hintLine(`${moveMode === 'detached' ? 'detached move' : 'move'}: click a component, label, or wire`);
    return;
  }
  const endpointHit = annotationEndpointAt(startWorld);
  const annotationSegment = endpointHit ? null : annotationSegmentAt(startWorld);
  const pickedLine = endpointHit?.label || annotationSegment?.label;
  if (pickedLine && armLabelCopyGrab(pickedLine, startWorld, startClient, ev)) return;
  if (pickedLine && isSelectionModifier(ev)) {
    applyEditorSelection({ kind: 'label', id: pickedLine.id }, true);
    render();
    return;
  }
  if (endpointHit) {
    setSelection([]);
    setLabelSelection([endpointHit.label.id]);
    drag = { mode: 'annotationendpoint', label: endpointHit.label, endpoint: endpointHit.endpoint, startClient, startWorld, startSnapshot: snapshot(), moved: false };
    return;
  }
  const annotationText = annotationTextAt(startWorld);
  if (annotationText) {
    if (armLabelCopyGrab(annotationText, startWorld, startClient, ev)) return;
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
    if (armLabelCopyGrab(annotationGeometry, startWorld, startClient, ev)) return;
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

  // A press on a selected object under the topmost one acts on the selected
  // object; a click that does not move then cycles to the next (canvasMouseUp).
  const stacked = stackedSelectionCandidates(startWorld);
  const pressKey = currentSelectionKey();
  stackedClick = !isSelectionModifier(ev) && ev.detail < 2 && stacked.length > 1
    ? { candidates: stacked, pressKey }
    : null;
  const preferred = stackedClick && stacked.indexOf(pressKey) > 0 ? pressKey : null;
  if (preferred?.startsWith('component:')) {
    lastLabelClick = null;
    lastWireClick = null;
    lastSchematicComponentClick = null;
    beginComponentDrag({ refdes: preferred.slice('component:'.length) }, startWorld, startClient, ev);
    return;
  }
  const preferredWire = preferred?.startsWith('wire:')
    ? wireHitsAt(startWorld).find((hit) => `wire:${hit.net.id}:${hit.branch}:${hit.seg}` === preferred) || null
    : null;

  // Labels draw on top of everything: picking one selects/drags it first.
  const labelHit = preferredWire ? null : pickLabel(startWorld);
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
    if (armLabelCopyGrab(labelHit, startWorld, startClient, ev)) return;
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
  const hit = preferredWire ? null : pickAt(startWorld) || (pickWire(startWorld) ? null : supplyBarHit(startWorld));
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
      setSelection(supplyBarGroup(componentHit.refdes), componentHit.refdes);
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
    // A drag that leaves a multi-terminal part's pin draws a wire from it
    // instead of moving the part; a plain click still selects.
    if (drag?.mode === 'move' && !isSelectionModifier(ev) && isPinDragCandidate(componentHit?.def)) {
      drag.pinGrab = { refdes: termHit.refdes, term: termHit.term };
    }
    return;
  }

  // Click/drag a wire: clicking selects its net, dragging edits a route run.
  const wireHit = preferredWire || pickWire(startWorld);
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
        hintLine(`selected fixed net ${net.id} — geometry is literal; open endpoints can be reconnected`);
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
      // Ctrl/Cmd-drag grows a new branch from this point instead of moving the run.
      branchGrab: (ev.ctrlKey || ev.metaKey) && !ev.shiftKey,
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
export function beginObjectMove(refs, labelIds, startWorld, startClient, options = {}) {
  const startSnapshot = snapshot();
  // Moves and Ctrl/Cmd-drag copies preview in an isolated document from the
  // first pointer down, so a cancelled drag leaves nothing behind and a drop
  // is one undo entry.
  beginPreviewTransaction(startSnapshot);
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
  if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && !options.detached) {
    drag = { mode: 'copygrab', hit, startWorld, startClient };
    return;
  }
  if (isSelectionModifier(ev)) {
    applyEditorSelection({ kind: 'component', id: hit.refdes }, true);
    render();
    return;
  }
  // A joined supply bar moves (or copies) as one part.
  const press = componentPressSelection({
    refdes: hit.refdes, selectedRefs: multi, selectedLabelIds: selLabels, group: supplyBarGroup(hit.refdes),
  });
  if (!press.keepMixed) setSelection([]);
  beginObjectMove(press.refs, press.labelIds, startWorld, startClient, { duplicate: false, detached: options.detached });
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

export function captureNetGeometry(net) {
  return {
    ...captureRouteGeometry(net),
    fixedPaths: net.routingMode === 'fixed' ? cloneFixedPaths(net.fixedPaths) : null,
    // Segment styles are keyed by route position, so snapshot them with the
    // geometry they decorate.
    wireStyles: cloneWireStyles(net.wireStyles),
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
      wireStyles: cloneWireStyles(run.net.wireStyles),
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

export function translateNetGeometry(net, saved, dx, dy) {
  const move = (p) => ({ x: p.x + dx, y: p.y + dy });
  Object.assign(net, captureRouteGeometry(saved, move));
  if (net.routingMode === 'fixed' && saved.fixedPaths) net.fixedPaths = cloneFixedPaths(saved.fixedPaths, move);
  if (saved.wireStyles) {
    net.wireStyles = cloneWireStyles(saved.wireStyles);
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

export function armModalMove(hit, startWorld, startClient) {
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
  if (!moveDrag.detached && refs.length === 1) spliceIfOnWire(circuit.components.get(refs[0]));
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
export function beginCopySource(startWorld, startClient) {
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
      hintLine('COPY: click a component, label, or wire source');
      return false;
    }
  }
  if (!copySelection()) return false;
  return startCopyGhost(startWorld, startClient);
}
/** A line or arrow vertex under `world` that Delete can remove on its own,
 * leaving the rest of the annotation: { label, index } or null. */
export function removableVertexAt(world) {
  const hit = annotationEndpointAt(world);
  const index = hit?.endpoint.startsWith('vertex:') ? Number(hit.endpoint.slice(7)) : -1;
  return index >= 0 && hit.label.canRemoveVertex(index) ? { label: hit.label, index } : null;
}

function deleteAtPoint(world) {
  noteTip('delete-click');
  const vertex = removableVertexAt(world);
  if (vertex) {
    commit(() => vertex.label.removeVertex(vertex.index));
    clearCheckReport();
    render();
    return true;
  }
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

export function snappedWorld(point) {
  return { x: snap(point.x), y: snap(point.y) };
}

function placementWorld(current, shiftKey) {
  return pendingPlace?.startWorld
    ? constrainedWorld(pendingPlace.startWorld, current, shiftKey)
    : current;
}

export function canvasMouseMove(ev) {
  // The quick-add menu is anchored at the drop point; the wire preview stays there.
  if (quickAdd) return;
  const { w, cursorChanged } = updateCursorFromEvent(ev);

  if (!drag) {
    updateCanvasHover(w);
    // The cursor follows the mouse, always snapped to the nearest grid point.
    // The view never pans on its own — pan manually with the middle button.
    const point = mode === 'insert' && pendingPlace ? placementWorld(w, ev.shiftKey)
      : labelMode === 'line' || labelMode === 'arrow' ? draftPointAt(w, ev.shiftKey) : w;
    const nextCursor = cursorWorld(point);
    const changed = nextCursor.x !== cursor.x || nextCursor.y !== cursor.y;
    cursor = nextCursor;
    if (cursorChanged || changed) scheduleInteractionRender();
    return;
  }

  const movedOut = dragMoved(drag.startWorld, drag.startClient, w, ev);
  const movedWorld = constrainedWorld(drag.startWorld, w, ev.shiftKey);
  if (drag.modal) drag.shift = ev.shiftKey;
  if (drag.mode === 'radialpending' || drag.mode === 'radial') {
    const dx = ev.clientX - drag.startClient.x;
    const dy = ev.clientY - drag.startClient.y;
    if (drag.mode === 'radialpending' && Math.hypot(dx, dy) > 10) openRadialMenu(drag);
    if (drag.mode === 'radial') highlightRadial(dx, dy);
    return;
  }
  if (drag.mode === 'move' && drag.pinGrab && !drag.moved && movedOut) {
    beginPinWire(drag, w);
    return;
  }
  if (drag.mode === 'pinwire') {
    // Repaint only when the snapped end moves, so the snap pulse can play.
    const next = pinWireCursor(w);
    cursor = next;
    const key = `${next.x},${next.y}`;
    if (drag.drawnEnd === key) return;
    drag.drawnEnd = key;
    scheduleInteractionRender();
    return;
  }
  if (drag.mode === 'wireseg' && drag.branchGrab && !drag.moved && movedOut) {
    beginBranchWire(drag, w);
    return;
  }
  if (drag.mode === 'copygrab') {
    if (movedOut) beginCopyDrag(drag, ev);
    return;
  }
  if (drag.mode === 'netlabelpaste') {
    cursor = cursorWorld(w);
    scheduleInteractionRender();
    return;
  }
  if (movedOut) lastSchematicComponentClick = null;
  if (drag.mode === 'blockresize') {
    if (!movedOut) return;
    drag.moved = true;
    const rect = resizeRect(drag.origin, drag.handle, movedWorld, { symmetric: ev.ctrlKey || ev.metaKey, step: 2 * GRID });
    const rectKey = `${rect.x},${rect.y},${rect.w},${rect.h}`;
    if (drag.appliedRect === rectKey) return; // same snapped rectangle as the last preview
    drag.appliedRect = rectKey;
    try {
      // Rebuild each preview from the immutable pointer-down snapshot. This
      // keeps corner drags reversible and avoids accumulating grid rounding.
      circuit = loadDocument(JSON.parse(drag.startSnapshot));
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
  if (drag.mode === 'boxresize') {
    if (!movedOut && !drag.moved) return;
    drag.moved = true;
    // Resize from the pointer-down state every frame, so child labels follow
    // the box without accumulating grid rounding.
    restoreBoxState(drag.label, drag.startBox);
    drag.label.resizeBox(resizeRect(drag.origin, drag.handle, movedWorld, { symmetric: ev.ctrlKey || ev.metaKey, min: GRID }));
    markModelChanged(false);
    scheduleInteractionRender();
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
    drag.previewEnd = draftPointAt(w, ev.shiftKey);
    cursor = { ...drag.previewEnd };
    scheduleInteractionRender();
    return;
  }
  if (drag.mode === 'annotationplace') {
    if (movedOut) drag.moved = true;
    if (annotationStart || drag.moved) {
      drag.previewEnd = labelMode === 'box' ? snappedWorld(movedWorld) : draftPointAt(w, ev.shiftKey);
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
      // Shift squares an end leg against its neighbor; an inner vertex has two
      // legs, so it keeps the move's axis lock instead.
      const index = Number(drag.endpoint.slice(7));
      const points = drag.label.points || [];
      const neighbor = drag.endpoint.startsWith('vertex:') && points.length > 1
        ? index === 0 ? points[1] : index === points.length - 1 ? points[index - 1] : null
        : null;
      const point = ev.shiftKey && neighbor ? constrainAxis(neighbor, snappedWorld(w)) : snappedWorld(movedWorld);
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

  if (drag.mode === 'deletemarquee' && drag.knife) {
    if (movedOut) drag.moved = true;
    const last = drag.knife.at(-1);
    if (Math.hypot(w.x - last.x, w.y - last.y) > GRID / 8) drag.knife.push({ x: w.x, y: w.y });
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
      const axis = drag.orient === 'h' ? movedWorld.y : movedWorld.x;
      const delta = axis - drag.startAxis;
      // Runs sit on grid lines and moveWireRun snaps its target, so a delta
      // within the same cell reproduces the previous frame exactly.
      if (drag.appliedDelta === snap(delta)) {
        scheduleInteractionRender();
        return;
      }
      drag.appliedDelta = snap(delta);
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
          hintLine('duplicated selection — dragging the copy');
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
          // Paste at the selection anchor inside the preview document, so the
          // whole gesture stays one atomic, cancellable edit. The user's own
          // clipboard is left as it was.
          const savedClipboard = clipboard;
          if (copySelection({ quiet: true })) {
            const anchor = clipboard?.anchor;
            if (anchor) {
              cursor = { ...anchor };
              pasteClipboard({ recordHistory: false, connect: false });
            }
          }
          clipboard = savedClipboard;
          drag.origins = new Map(selectedComps().map((c) => [c.refdes, { x: c.transform.x, y: c.transform.y }]));
          drag.labelOrigins = new Map(selectedLabels().map((l) => [l.id, { x: l.anchorWorld().x, y: l.anchorWorld().y }]));
          hintLine('duplicated selection — dragging the copy');
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
      // Most pointer events land in the same grid cell as the last one; the
      // re-anchored preview would be identical, so skip the reroute. A rebase
      // (rotate/mirror mid-drag) installs new origins and invalidates this.
      if (drag.appliedDelta?.origins === drag.origins &&
          drag.appliedDelta.dx === delta.dx && drag.appliedDelta.dy === delta.dy) return;
      drag.appliedDelta = { origins: drag.origins, dx: delta.dx, dy: delta.dy };
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

export function canvasMouseUp(ev) {
  const click = stackedClick;
  stackedClick = null;
  const still = !!drag && !dragMoved(drag.startWorld, drag.startClient, clientToWorld(ev.clientX, ev.clientY), ev);
  finishCanvasMouseUp(ev);
  if (!click || !still || ev.button !== 0 || drag) return;
  const next = nextStackedSelection(click.candidates, click.pressKey);
  if (!next) return;
  selectStackedKey(next);
  hintLine(`selected ${stackedKeyName(next)} (${click.candidates.indexOf(next) + 1}/${click.candidates.length}) · click again for the next object here`);
  render();
}

function finishCanvasMouseUp(ev) {
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
  if (drag.mode === 'pinwire') {
    drag = null;
    finishPinWire(releaseWorld, ev);
    return;
  }
  if (drag.mode === 'copygrab') {
    applyEditorSelection(drag.label ? { kind: 'label', id: drag.label.id } : { kind: 'component', id: drag.hit.refdes }, true);
    drag = null;
    render();
    return;
  }
  if (drag.mode === 'radialpending') {
    window.clearTimeout(drag.holdTimer);
    drag = null;
    suppressContextMenuUntil = Date.now() + 400;
    openContextMenuAt(ev.clientX, ev.clientY);
    return;
  }
  if (drag.mode === 'radial') {
    const radial = drag;
    drag = null;
    suppressContextMenuUntil = Date.now() + 400;
    finishRadialMenu(radial, { x: ev.clientX, y: ev.clientY });
    return;
  }
  if (drag.mode === 'pan') {
    if (ev.button !== 1 && !(ev.button === 0 && drag.spacePan) && drag.pointerId !== ev.pointerId && ev.pointerType === 'mouse') return;
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
          net.wireStyles = cloneWireStyles(saved.wireStyles);
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
  } else if (drag.mode === 'netlabelpaste') {
    placeNetLabelAt(w);
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
      const point = draftPointAt(w, ev.shiftKey);
      if (!annotationPoints.length || point.x !== annotationPoints.at(-1).x || point.y !== annotationPoints.at(-1).y) annotationPoints.push(point);
      const now = Date.now();
      const previous = lastLineClick;
      const doubleClick = ev.detail >= 2 || (previous && now - previous.at < 500 &&
        Math.abs(point.x - previous.x) <= GRID && Math.abs(point.y - previous.y) <= GRID);
      lastLineClick = { x: point.x, y: point.y, at: now };
      if (doubleClick) commitLineAnnotation(false);
    }
  } else if (drag.mode === 'annotationtextmove') {
    if (drag.moved && snapshot() !== drag.startSnapshot) {
      recordHistoryEntry(drag.startSnapshot);
    }
  } else if (drag.mode === 'deletemarquee' && drag.knife && drag.moved) {
    cutAlong([...drag.knife, { x: releaseWorld.x, y: releaseWorld.y }]);
  } else if (drag.mode === 'marquee' || drag.mode === 'deletemarquee') {
    if (drag.moved) {
      const box = worldRect(drag.startWorld, w);
      applyBoxSelection(box.x0, box.y0, box.x1, box.y1, drag.shift);
      if (drag.mode === 'deletemarquee' && copySelectionExists()) deleteSelection();
    } else if (drag.mode === 'deletemarquee') {
      if (copySelectionExists()) deleteSelection();
      else deleteAtPoint(w);
    }
  } else if (drag.mode === 'annotationsegment' || drag.mode === 'annotationendpoint' || drag.mode === 'boxresize') {
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
      placeShapeAnnotation(movedWorld, labelMode === 'box' ? snappedWorld(movedWorld) : draftPointAt(w, ev.shiftKey));
    } else {
      placeShapeAnnotation(w, labelMode === 'box' ? null : draftPointAt(w, ev.shiftKey));
    }
  } else if (drag.mode === 'labelplace') {
    if (!movedOut) {
      if (labelMode === 'net') placeNetLabelAt(w);
      else if (labelMode === 'highlight') highlightNetAt(w);
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
const isCompatibilityMove = compatibilityMoveFilter();
function canvasPointerMove(ev) {
  if (!isCompatibilityMove(ev)) canvasMouseMove(ev);
}
canvasEl.addEventListener('mousemove', canvasPointerMove);
canvasEl.addEventListener('pointermove', canvasPointerMove);

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
  beatStripActive = false;
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
  canvasPointerMove(ev);
}
window.addEventListener('pointermove', forwardCanvasMove, true);
window.addEventListener('mousemove', forwardCanvasMove, true);
canvasEl.addEventListener('mouseenter', () => {
  cursorInCanvas = true;
  scheduleInteractionRender();
});
canvasEl.addEventListener('mouseleave', () => {
  cursorInCanvas = false;
  if (!hoverFromPanel) setHoverTarget(null);
  scheduleInteractionRender();
});
// A right press on a component is either a tap (context menu on release), a
// hold or a drag (radial menu). Linux browsers send `contextmenu` on press, so
// the menu waits for the release while that press is still undecided; the
// release after a radial choice swallows a late (Windows-order) event.
let suppressContextMenuUntil = 0;
installContextMenu();
canvasEl.addEventListener('dragstart', (ev) => ev.preventDefault());
window.addEventListener('mouseup', canvasMouseUp);
// Releasing Alt drops the mirrored ghost or terminal-snap aid; so does losing the window, since no
// keyup arrives then and the twin would otherwise be stuck on screen.
window.addEventListener('keyup', (ev) => {
  if (ev.key === ' ') {
    spaceHeld = false;
    canvasEl.classList.remove('space-pan');
    if (spaceTap) {
      spaceTap = false;
      stubSelection();
    }
    return;
  }
  if (ev.key !== 'Alt') return;
  altHeld = false;
  setSymmetry(false);
  if (terminalSnap) {
    terminalSnap = false;
    render();
  }
});
window.addEventListener('blur', () => {
  spaceHeld = false;
  spaceTap = false;
  canvasEl.classList.remove('space-pan');
  altHeld = false;
  setSymmetry(false);
  if (terminalSnap) {
    terminalSnap = false;
    render();
  }
});


// Double-click edits the active document's object. Components edit their owned
// child label; reference markers create the same provisional child label when
// one is missing.
canvasEl.addEventListener('dblclick', (ev) => {
  const w = clientToWorld(ev.clientX, ev.clientY);
  const label = pickLabel(w);
  if (label) inlineEditLabel(label);
  else {
    const wire = pickWire(w);
    const hit = pickAt(w) || (wire ? null : supplyBarHit(w));
    const component = hit?.refdes ? circuit.components.get(hit.refdes) : null;
    if (component) openComponentChildLabelEditor(component);
    else if (wire) {
      selectedWire = null;
      selectedWires.clear();
      selectedNets = new Set([wire.net.id]);
      render();
    } else if (mode === 'normal' && !hasWireDraft() && !labelMode && !moveMode && !copyMode && !deleteMode && !visual
        && !hasSelectableObjectAt(w)) {
      // Double-clicking empty paper opens the insert menu right there.
      cursor = snappedWorld(w);
      activatePlace();
    }
  }
});

// ----- mouse wheel
canvasEl.addEventListener(
  'wheel',
  (ev) => {
    ev.preventDefault();
    cancelViewAnimation();
    const scale = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1;
    if (wheelIntent(ev, scrollScheme) === 'pan') {
      const p = paneSize();
      const unitsPerPx = p ? view.w / p.w : 1;
      view.x += ev.deltaX * scale * unitsPerPx;
      view.y += ev.deltaY * scale * unitsPerPx;
      scheduleInteractionRender();
      return;
    }
    // Pinch arrives as a ctrl-wheel with small deltas; give it a finer base.
    const f = Math.pow(ev.ctrlKey && scrollScheme === 'trackpad' ? 1.01 : 1.0016, ev.deltaY * scale);
    const nw = Math.min(Math.max(view.w * f, minViewW()), maxViewW());
    const factor = nw / view.w;
    const w = clientToWorld(ev.clientX, ev.clientY);
    view.x = w.x - (w.x - view.x) * factor;
    view.y = w.y - (w.y - view.y) * factor;
    view.w = nw;
    view.h *= factor;
    scheduleInteractionRender();
  },
  { passive: false }
);

installSidePanel();
installFindReplace();
const TERM_LETTERS = new Set(['a', 'b', 'c', 'd', 'e', 'g', 'p', 's']);

function onWireKey(key) {
  if (key === 'Escape') {
    wire = null;
    gestureWire = false;
    terminalSnap = false;
    selectedWire = null;
    selectedWires.clear();
    selectedNets.clear();
    hintLine('wiring cancelled');
  } else if (key === 'Backspace') {
    if (wire?.points?.length) {
      wire.points.pop();
      const last = wire.points[wire.points.length - 1] || wire.source;
      if (last && Number.isFinite(last.x) && Number.isFinite(last.y)) {
        cursor = { x: snap(last.x), y: snap(last.y) };
      }
      hintLine('removed last wire vertex');
    }
  } else if (key === 'Enter') {
    commitWireAtCursor();
  } else if (key === '/') {
    // Flip which way the corner of the leg under the cursor turns.
    if (wire) {
      wire.flipCorner = !wire.flipCorner;
      wirePreviewStale = true;
    }
    hintLine(wire?.flipCorner ? 'corner flipped' : 'corner restored');
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
      hintLine(`wire from ${comp.refdes}.${key} — click/type the target terminal`);
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

let quickAdd = null; // { point, fromWire, query, index, el, input, list }
/** Rank a component/label name against a fuzzy query (subsequence match).
 *  Returns a score >= 0 for a match (higher = better) or -1 for no match.
 *  Prefix hits beat substring hits, which beat pure subsequences; shorter
 *  names win ties. */
export function transformPendingComponent(operation) {
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

/** Arrow keys grow the selection box; Enter commits it and Escape cancels. */
/** Looking at the drawing is not a mode. The grid, guides, crosshair, theme,
 *  fit and help change what is on screen rather than what is in the document,
 *  so they answer while a ghost is armed, a wire is half drawn, or a marquee
 *  is open -- the editor should never make someone finish an edit to turn a
 *  toggle. The one place they must not is insert mode before a ghost exists,
 *  where every printable key is search text. Returns true when handled. */
function viewKey(key, shiftKey = false) {
  if (mode === 'insert' && !pendingPlace) return false;
  if (key === 'F' || key === 'f') fitView({ animate: true });
  else if (key === '#') setGrid(!showGrid);
  else if (key === 'C' || (key === 'c' && shiftKey)) setCrosshair(!crosshairVisible);
  else if (key === 'G' || (key === 'g' && shiftKey)) setGuides(!guidesVisible);
  else if (key === 'D') toggleTheme();
  else if (key === 'P') toggleSidePanel();
  // The canvas keeps focus, so a second Shift+S closes the dock again.
  else if (key === 'S') toggleAnalysisDock({ focus: false });
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

// The last repeatable edit, for `.`: how to do it again to whatever is
// selected (or pointed at) now. Session state; never part of a document.
let lastAction = null; // { label, run }

export function rememberAction(label, run) {
  lastAction = { label, run };
}

function repeatLastAction(count = 1) {
  if (!lastAction) {
    logLine('. repeats the last rotate, mirror, swap, rail, or stubs; nothing to repeat yet');
    return;
  }
  hintLine(`repeat: ${lastAction.label}${count > 1 ? ` ×${count}` : ''}`);
  for (let i = 0; i < count; i++) lastAction.run();
}

/** t / = / F2: edit the text of what is selected -- a label, a part's name
 *  (a switch's phase, a rail's name), a net's label -- else of what the
 *  cursor points at. Several switches or rails take the same edit. */
export function editSelectionText() {
  const editPart = (part) => {
    if (part.type === 'solder') hintLine('a junction dot has no text to edit');
    else openComponentChildLabelEditor(part);
  };
  const label = selectedLabel() || selectedLabels()[0];
  if (label) return inlineEditLabel(label);
  const part = selectedComp() || selectedComps()[0];
  if (part) return editPart(part);
  const netId = [...selectedNets][0] || selectedWire?.netId;
  if (netId) {
    const netLabel = circuit.nets.has(netId) && circuit.netLabels(netId)[0];
    if (netLabel) return inlineEditLabel(netLabel);
    hintLine('this net has no label to edit; Shift+L places one to name it');
    return;
  }
  const pointed = pickLabel(cursor);
  if (pointed) return inlineEditLabel(pointed);
  const hovered = compUnderCursor();
  if (hovered) return editPart(hovered);
  hintLine('t, =, or F2 edit the text of what is selected or pointed at; nothing is');
}

/** The parts q swaps: the selected ones, else the one under the cursor. */
export function swapTargets() {
  const comps = selectedComps();
  if (comps.length) return comps;
  const hovered = compUnderCursor();
  return hovered ? [hovered] : [];
}

function pinUnderCursor() {
  const hit = matchAt(cursor.x, cursor.y);
  return hit?.term ? hit : null;
}

/** What the footer's key strip needs to know that the editor state does not
 *  say directly: the edit `.` repeats and what the pointer rests on. */
export function keyHintContext() {
  const pin = pinUnderCursor();
  const part = pin ? null : compUnderCursor();
  return {
    repeat: lastAction?.label || null,
    hover: {
      pin: pin ? { connected: !!circuit.netOfTerminal({ comp: pin.refdes, term: pin.term }) } : null,
      part: part && part.type !== 'solder' ? part.type : null,
    },
  };
}

/** g / v: a ground or supply wired one cell out from the pin under the
 *  cursor (core/pin-rails.js). */
function railAtPointedPin(type) {
  const key = type === 'ground' ? 'g' : 'v';
  rememberAction(`${type} on a pin`, () => railAtPointedPin(type));
  const hit = pinUnderCursor();
  if (!hit) {
    hintLine(`${key}: point at an unconnected pin to wire a ${type} to it`);
    return;
  }
  const ref = { comp: hit.refdes, term: hit.term };
  if (circuit.netOfTerminal(ref)) {
    logLine(`${hit.refdes}.${hit.term} is already wired; ${key} adds a ${type} to an unconnected pin`);
    return;
  }
  const before = snapshot();
  try {
    const marker = addPinRail(circuit, ref, type);
    recordHistoryEntry(before, true);
    markModelChanged();
    logLine(`${marker.refdes} (${type}) on ${hit.refdes}.${hit.term}`);
  } catch (err) {
    applyJson(before);
    logLine(`Could not wire a ${type} to ${hit.refdes}.${hit.term}: ${err.message || err}`, 'error');
  }
  render();
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
  // 9 arms net highlighting and 8 removes every highlight, unless they
  // continue a count already being typed (e.g. 18 then an arrow).
  if (key === '9' && !counts) {
    activateHighlight();
    return;
  }
  if (key === '8' && !counts) {
    removeAllNetHighlights();
    return;
  }
  if (key === 'h' || key === 'H') {
    toggleSelectionInBeat(key === 'H' ? 'dim' : 'hide');
    return;
  }
  if (key === 's') {
    flipSelectedSwitches();
    return;
  }
  if (key === 'B') {
    toggleBeatStrip();
    return;
  }
  if (key === '+') {
    addBeatHere();
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
  if (key === 'Enter' && labelMode === 'arrow') {
    commitArrowAnnotation();
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

  if (key === '.') {
    repeatLastAction(count);
    return;
  }

  if (key === 'q') {
    openSwapPicker(swapTargets());
    return;
  }

  // g and v over an unconnected pin wire a ground or supply to it; elsewhere
  // v is visual mode.
  if (key === 'g' || (key === 'v' && pinUnderCursor())) {
    railAtPointedPin(key === 'g' ? 'ground' : 'supply');
    return;
  }

  // Normal-mode t edits only the primary selected label. Insert-mode t keeps
  // its separate label-placement behavior in onInsertKey.
  if (key === 't' || key === '=') {
    editSelectionText();
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
      rememberAction(count > 1 ? `rotate ${count}×` : 'rotate', () => {
        counts = count;
        onNormalKey('r');
      });
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
    if (copySelection()) publishObjectClipboard();
    return;
  }

  if (key === 'd') {
    if (pendingKey && pendingKey.key === 'd' && Date.now() - pendingKey.at < 800) {
      if (deleteSelection()) render();
      else hintLine('dd deletes the selection; select something first, or press Delete for the delete tool');
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

  if (key === 'i' || key === 'I') {
    activatePlace();
    return;
  }

  if (key === 'A') {
    activateAlign();
    return;
  }

  if (key === ':') {
    openCommandLine();
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
    } else {
      hintLine('Tab steps from one selected part or label to the next; select just one');
    }
    return;
  }

  // Backspace takes back the last clicked point, as it does for a wire draft.
  if (key === 'Backspace') {
    if ((labelMode === 'line' || labelMode === 'arrow') && annotationPoints.length) {
      annotationPoints.pop();
      if (!annotationPoints.length) annotationStart = null;
      lastLineClick = null;
      render();
    }
    return;
  }

  // Delete right after picking beats in the strip removes those beats.
  if (key === 'Delete' && beatStripActive && selectedBeatIds.size) {
    deleteBeats(selectedBeatIndices());
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

  // Escape in Align to drops a picked source first, then leaves the tool with
  // the selection intact.
  if (key === 'Escape' && alignTool) {
    if (alignTool.source) {
      alignTool = { source: null, hover: null };
      hintLine(ALIGN_SOURCE_HINT);
    } else {
      alignTool = null;
    }
    render();
    return;
  }

  // Escape first lets go of beats picked in the strip; the beat on screen stays.
  if (key === 'Escape' && selectedBeatIds.size > 1) {
    const active = circuit.beats[activeBeatIndex()];
    selectedBeatIds = new Set(active ? [active.id] : []);
    beatAnchorId = active?.id || null;
    beatStripActive = false;
    render();
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
  // Every bound key has returned by now: say so rather than doing nothing.
  if (key.length === 1 && key !== ' ') hintLine(`${key} does nothing here; ? lists every key`);
}

installHelp();

// ----- command console ---------------------------------------------------

/** Run one document command line; returns the error message when it fails. */
export function runLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return;

  logCommand(trimmed);

  const before = snapshot();
  let result;
  try {
    result = runCommand(circuit, trimmed);
  } catch (err) {
    const message = String(err.message || err);
    logLine(message);
    return message;
  }

  let output = result ? result.text : '';
  if (result && result.json !== undefined && result.json !== null) {
    output += output ? '\n' : '';
    output += JSON.stringify(result.json);
  }

  if (output) logLine(output);

  if (result && result.mutated) {
    if (trimmed.split(/\s+/)[0].toLowerCase() === 'clear') resetCheckState();
    suppressNetNameChoice = true;
    try { recordHistoryEntry(before); } finally { suppressNetNameChoice = false; }
    markModelChanged(); // commands can re-route / splice nets or mutate block geometry
    multi = new Set([...multi].filter((r) => circuit.components.has(r)));
    if (!circuit.components.has(selected)) selected = multi.size ? [...multi][0] : null;
  }
  render();
}

// ----- status -------------------------------------------------------------

export function interactionState() {
  return deriveInteractionState({ mode, labelMode, wire, directWire, visual, moveMode, copyMode, deleteMode, alignMode: !!alignTool, movePending, copyPending, routeMode });
}

let contextMenuDismiss = null;

// ----- annotation flyout ----------------------------------------------------

// ----- insert-mode menu ----------------------------------------------------

// ----- quick-add menu ---------------------------------------------------------

window.addEventListener('pointerdown', (ev) => {
  if (quickAdd && !quickAdd.el.contains(ev.target)) closeQuickAdd();
}, true);

// ----- Virtuoso-compatible toolbar actions ----------------------------------

export function hasWireDraft() {
  return !!wire || !!directWire;
}

function hasModalPlacement() {
  return !!drag?.modal && (movePending || copyPending);
}

/** Drop whatever the current tool has not committed -- a half-drawn wire, a
 *  placement ghost, a pending move or copy, a box selection -- as Escape would,
 *  so any tool can be picked straight from any other. */
function leaveActiveInteraction() {
  if (quickAdd) closeQuickAdd();
  if (hasModalPlacement() || drag?.mode === 'copyghost') cancelDrag();
  if (wire || directWire) {
    wire = null;
    directWire = null;
    gestureWire = false;
    selectedWire = null;
    selectedWires.clear();
    selectedNets.clear();
  }
  terminalSnap = false;
  pendingPlace = null;
  clearSymmetry();
  insertQuery = '';
  mode = 'normal';
  visual = null;
  alignTool = null;
}

/** A letter that picks a terminal in Wire mode: one the part under the cursor
 *  (or the selected part) actually has. */
function wireTerminalLetter(key) {
  if (!TERM_LETTERS.has(key)) return false;
  const comp = compUnderCursor() || selectedComp();
  return !!comp?.terminalDefs.some((terminal) => terminal.name === key);
}

/** The tool a key picks from inside another tool's interaction, or null.
 *  Idle normal mode handles tool keys in onNormalKey. The insert search keeps
 *  every letter as query text, and in Wire mode a letter naming a terminal of
 *  the part being pointed at still picks that terminal. */
function toolSwitchForKey(key, shiftKey = false) {
  const inside = wire || directWire || (mode === 'insert' && pendingPlace) || visual;
  if (!inside || (drag && !hasModalPlacement())) return null;
  if (key === 'w' && (wire || directWire)) return null;
  if (key === 'v' && visual) return null;
  if (wire && wireTerminalLetter(key)) return null;
  if (key === 'N' && shiftKey) return activateAnnotation;
  const tools = {
    i: activatePlace,
    I: activatePlace,
    w: activateWire,
    m: () => activateMove('connected'),
    M: () => activateMove('detached'),
    c: activateCopy,
    A: activateAlign,
    9: activateHighlight,
    a: () => activateShapeAnnotation('arrow'),
    b: () => activateShapeAnnotation('box'),
    l: () => activateShapeAnnotation('line'),
    L: activateNetLabel,
    e: activateEquation,
    v: activateVisual,
  };
  return tools[key] || null;
}

function activateLabelPlacement(kind) {
  leaveActiveInteraction();
  clearNetLabelPaste();
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
  hintLine(kind === 'net'
    ? 'NET LABEL: click a physical wire; stays active until Esc'
    : kind === 'highlight'
      ? 'HIGHLIGHT: click a net to cycle its color; 8 removes all; Esc exits'
    : kind === 'annotation'
      ? 'ANNOTATION: click anywhere to place free text; Esc cancels'
      : `${kind.toUpperCase()}: click start and end points; stays active until Esc`);
  render();
}

export function activateNetLabel() {
  activateLabelPlacement('net');
}

export function activateHighlight() {
  activateLabelPlacement('highlight');
}

export function activateAnnotation() {
  activateLabelPlacement('annotation');
}

function activateEquation() {
  activateLabelPlacement('equation');
}

export function activateShapeAnnotation(kind) {
  activateLabelPlacement(kind);
}

export function activatePlace() {
  leaveActiveInteraction();
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

export function activateSelect() {
  leaveActiveInteraction();
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
export function activateVisual() {
  leaveActiveInteraction();
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

export function activateDelete() {
  leaveActiveInteraction();
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

export function activateWire() {
  // Re-clicking Wire is intentionally harmless: a toolbar click must not lose
  // a partially drawn path, including its manually entered waypoints.
  if (hasWireDraft()) { logLine('active interaction retained'); render(); return; }
  leaveActiveInteraction();
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
  gestureWire = false;
  hintLine(`wiring (${routeMode}): click a terminal or point to start; Alt snaps to the nearest terminal; terminal clicks commit, Enter commits elsewhere`);
  render();
}

export function activateMove(kind = 'connected') {
  leaveActiveInteraction();
  noteTip('move-start');
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

export function activateCopy() {
  leaveActiveInteraction();
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
  hintLine('COPY: click an object, or use the existing selection; move the copy, then click/Enter (Esc exits)');
  render();
}

export function activateAlign() {
  leaveActiveInteraction();
  terminalSnap = false;
  moveMode = null;
  copyMode = false;
  deleteMode = false;
  movePending = false;
  copyPending = false;
  labelMode = null;
  annotationPoints = [];
  alignTool = { source: null, hover: null };
  hintLine(ALIGN_SOURCE_HINT);
  render();
}

export function selectedTransform(action) {
  clearDiagnosticFocus();
  if (hasWireDraft()) { logLine('finish or cancel the active wire before transforming'); return; }
  if (!selectedComps().length && !selectedLabels().length && !selectedWires.size && !selectedWire && !selectedNets.size) {
    logLine('nothing selected to transform');
    return;
  }
  if (action === 'rotate') rotateSelectionAbout(90);
  else mirrorSelectionAbout(action === 'mirror-x' ? 'x' : 'y');
  rememberAction(action === 'rotate' ? 'rotate' : `mirror ${action === 'mirror-x' ? 'horizontally' : 'vertically'}`, () => selectedTransform(action));
  render();
}

// ----- side panel: collapsible sections, filter, resizable width ------------


clearCheckButtonEl?.addEventListener('click', () => {
  clearCheckReport();
  render();
});

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

// The toolbar's initial sync renders, so it waits until the render state
// above has been declared.
installToolbarUi();
installModelFigure();

// ----- narrow-window folding --------------------------------------------------

// ----- side panel ----------------------------------------------------------------

document.getElementById('empty-state')?.addEventListener('click', (ev) => {
  const action = ev.target.closest?.('[data-empty-action]')?.dataset.emptyAction;
  if (action === 'place') activatePlace();
  else if (action === 'wire') activateWire();
  else if (action === 'open') openDocumentDialog();
  else if (action === 'help') showHelp();
  else if (action === 'tutorial') offerTutorial();
  if (action && !['open', 'help', 'tutorial'].includes(action)) canvasEl.focus();
});

document.getElementById('btn-help').addEventListener('click', () => {
  showHelp();
});

// ----- theme (dark mode) ---------------------------------------------

// ----- grid toggle button --------------------------------------------


// ----- keyboard -------------------------------------------------------------

window.addEventListener('keydown', (ev) => {
  // Presenting owns the keyboard until it ends; so does the Atlas view.
  if (presenter) {
    onPresenterKey(ev);
    return;
  }
  if (atlasOpen()) {
    onAtlasKey(ev);
    return;
  }
  // Shift+Backspace steps back from the drawing to the whole workspace.
  // (Shift+Esc too, where the browser lets it through: Chromium keeps it
  // for its task manager.)
  if ((ev.key === 'Backspace' || ev.key === 'Escape') && ev.shiftKey && !ev.ctrlKey && !ev.metaKey && !ev.altKey &&
      !inlineInput && !['INPUT', 'TEXTAREA', 'SELECT'].includes(ev.target?.tagName)) {
    ev.preventDefault();
    openAtlas();
    return;
  }
  if (ev.key === 'F5' && ev.shiftKey && !inlineInput) {
    ev.preventDefault();
    openPresenter();
    return;
  }
  // Alt+Left/Right (or PageUp/PageDown, as a presentation clicker sends)
  // steps through the beats. Alt+Left must not become browser Back.
  const beatStep = !ev.ctrlKey && !ev.metaKey && !ev.shiftKey && !inlineInput && !['INPUT', 'TEXTAREA', 'SELECT'].includes(ev.target?.tagName)
    ? (ev.altKey ? { ArrowRight: 1, ArrowLeft: -1 } : { PageDown: 1, PageUp: -1 })[ev.key]
    : undefined;
  if (beatStep && !drag && !wire && !directWire) {
    ev.preventDefault();
    stepBeat(beatStep);
    return;
  }
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
  if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === 'h' && !inlineInput) {
    const filter = document.getElementById('panel-filter');
    if (filter && !filter.closest('[hidden]')) {
      ev.preventDefault();
      openReplace();
      return;
    }
  }
  if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === 'f') {
    const filter = document.getElementById('panel-filter');
    if (filter && !filter.closest('[hidden]') && !inlineInput) {
      ev.preventDefault();
      openFind();
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
  if (ev.key === 'Escape' && logDrawerState.open) applyLogDrawerEvent({ type: 'dismiss' });
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

  // Holding Space turns a left drag into a pan (insert-menu queries keep their
  // spaces while no ghost is armed).
  if (ev.key === ' ' && !ev.ctrlKey && !ev.metaKey && !ev.altKey && !(mode === 'insert' && !pendingPlace)) {
    if (!spaceHeld) {
      spaceHeld = true;
      spaceTap = !ev.repeat;
      canvasEl.classList.add('space-pan');
    }
    ev.preventDefault();
    return;
  }

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
  // Ctrl/Cmd+Shift+arrows align the selected set, in the idle normal editor
  // only. Checked before the Ctrl/Cmd shortcuts below, which claim every
  // Ctrl/Cmd key.
  const alignKey = layoutAlignKey({
    key: ev.key, shiftKey: ev.shiftKey, ctrlKey: ev.ctrlKey, metaKey: ev.metaKey, altKey: ev.altKey,
    mode, wire: !!wire, directWire: !!directWire, visual: !!visual, drag: !!drag,
    moveMode, copyMode, deleteMode, labelMode,
  });
  if (alignKey) {
    ev.preventDefault();
    alignSelectionByKey(alignKey);
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
      selectedNets = new Set(selectAllNetIds(circuit));
      render();
    } else if (k === 'c' && !ev.shiftKey) {
      ev.preventDefault();
      if (copySelection()) publishObjectClipboard();
    } else if (k === 'v') {
      // Left to the browser, whose paste event carries the system clipboard.
      armObjectPaste(ev.shiftKey ? 'style' : 'objects');
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
  if (key === 'F2' && mode === 'normal' && !wire && !directWire && !visual && !labelMode && !drag) {
    ev.preventDefault();
    editSelectionText();
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

  // Shift+Left/Right set every selected label's alignment. A set already at
  // that alignment cycles back to each label's default: toward its part for
  // a part's label, center otherwise.
  if (ev.shiftKey && !wire && mode === 'normal' && (key === 'ArrowLeft' || key === 'ArrowRight')) {
    const labels = selectedLabels();
    const primary = selectedLabel() || labels[0];
    if (primary && labels.length) {
      const align = key === 'ArrowRight' ? 'right' : 'left';
      const allAtTarget = labels.every((label) => label.align === align);
      commit(() => labels.forEach((label) => label.setAlign(allAtTarget ? label.defaultAlign() : align)));
      render();
      ev.preventDefault();
      return;
    }
  }

  if (viewKey(key, ev.shiftKey)) {
    ev.preventDefault();
    return;
  }

  const toolSwitch = toolSwitchForKey(key, ev.shiftKey);
  if (toolSwitch) {
    ev.preventDefault();
    toolSwitch();
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
      hintLine('direct wire cancelled');
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

installCommandLine();
installAtlas();

// ----- boot ------------------------------------------------------------

window.__run = (line) => { runLine(line); };
window.__load = (json) => { applyJson(typeof json === 'string' ? json : JSON.stringify(json)); fitView(); };
window.__circuit = () => ({
  kind: 'circuit',
  comps: [...circuit.components.values()].map((c) => ({ refdes: c.refdes, type: c.type, x: c.transform.x, y: c.transform.y, rot: c.transform.rotation, mx: c.transform.mirrorX, my: c.transform.mirrorY })),
  nets: [...circuit.nets.values()].map((net) => ({ id: net.id, name: net.name || null, terminals: net.terminals.map((t) => t.comp + '.' + t.term), route: net.route, branches: net.branches, junctions: net.junctions, pts: net.points() })),
  labels: [...circuit.labels.values()].map((l) => ({ ...l.toJSON(), world: l.anchorWorld() })),
  beats: circuit.toJSON().beats || [],
  activeBeat: activeBeatIndex(),
});

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


if (paneEl && typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => {
    resizeView();
    syncModeToolbarOverflow();
    render();
  }).observe(paneEl);
}

statusZoomEl?.addEventListener('click', () => fitView({ animate: true }));

