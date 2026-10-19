/**
 * The Atlas view: every design in the workspace laid out at its real
 * size on one zoomable desk. It is a viewing mode, not a file picker -- no
 * tools, only looking: pan and zoom as in the editor, pick a design, open it.
 *
 * Drawing follows a map viewer. One canvas paints every tile from baked
 * images (a small one and a large one per design, kept in IndexedDB by file
 * revision), so a hundred designs pan as smoothly as one. The few tiles that
 * fill the screen get their live SVG on top, crisp at any zoom. Entering and
 * leaving fly a design between the editor, at the screen, and its place on
 * the desk behind it (drawFlight).
 */

import { loadDocument, relinkDocumentState } from '../core/document.js';
import { brokenLinks } from '../core/workspace-check.js';
import { element as el } from './dom.js';
import { svgString } from '../core/render.js';
import { designIndex, parseTags, searchDesign, tagsText } from '../core/design-index.js';
import { DRAWING_EXPORT_OPTIONS } from '../core/selection-drawing.js';
import { symbolSheet } from '../core/symbol-sheet.js';
import { GRID } from '../core/grid.js';
import { applyExportDarkTheme, withEmbeddedMathFont } from './drawing-export.js';
import { relatednessOf } from '../core/design-related.js';
import { linkArrow, linkCurve, linkDepths, linkGraph } from '../core/design-links.js';
import { ATLAS_CAPTION, ATLAS_GAP, DESK_KEY, LARGE_PX, SMALL_PX, floatClear, layoutAtlas, layoutAtlasShaped, neighborTile, rectsIntersect, reshapedPlaces, throughDepth, tileAt, tileDetail, viewFitting, viewFittingIn, viewShowing } from './atlas-layout.js';
import { INDEX_CACHE, bakeTiles, cacheGet, cachePut, renderingKey, trimCache } from './atlas-cache.js';
import { easeOutCubic, wheelIntent, lerpView } from './gestures.js';
import { editor } from './editor-state.js';
import {
  addDocumentFiles, allowFolderAccess, renameDesign, chooseWorkspaceFolder, hasUnsavedChanges, onDocumentListChange, openDocumentDialog, persistence, openDocumentPath, requestDocumentAction, saveCircuit, startNewDocument,
  deleteDocuments,
} from './document-session.js';
import { fittedView } from './canvas-view.js';
import { closeToolbarMenu, scheduleToolbarFit, toggleTheme, toolbarMenus } from './toolbar-ui.js';
import { logLine } from './status-bar-ui.js';
import { canvasEl } from './elements.js';
import { commit, render, setLabelSelection, setSelection } from './main.js';
import { setDocumentTags } from './tags-ui.js';
import { revealStartup } from './startup.js';
import { exportAtlasSheet } from './export-ui.js';
import { atlasSheetSvg, sheetCaption } from './atlas-sheet.js';
import { writeDrawingToClipboard } from './clipboard.js';
import { slideChrome } from './chrome-slide.js';
import { formatModifiedTime, revisionTime } from './modified-time.js';
import { reducedMotion } from './motion.js';
import { showHelp } from './help.js';
import { appendContextItem, openMenuAt } from './context-menu.js';
import { onAccentChange } from './accent.js';

const rootEl = document.getElementById('atlas');
const deskEl = document.getElementById('atlas-desk');
const overlayEl = document.getElementById('atlas-overlays');
const titleEl = document.getElementById('atlas-title');
const statusEl = document.getElementById('atlas-status');
const backEl = document.getElementById('atlas-close');
const hintEl = document.getElementById('atlas-hint');
const searchEl = document.getElementById('atlas-search');
const newCircuitEl = document.getElementById('atlas-new-circuit');
const openFolderEl = document.getElementById('atlas-open-folder');
const openFilesEl = document.getElementById('atlas-open-files');
const exportEl = document.getElementById('atlas-export');
const linksEl = document.getElementById('atlas-links');
const checkEl = document.getElementById('atlas-check');
const checkMenuEl = document.getElementById('atlas-check-menu');
const listEl = document.getElementById('atlas-list');
const listPanelEl = document.getElementById('atlas-list-panel');
const LIST_SORT_KEY = 'mosfeteer.atlas.listSort';
const LINKS_KEY = 'mosfeteer.atlas.links';
// The cached drawings' and images' versions: bump them when the renderer
// draws designs differently, or the desk keeps showing the old drawings
// until each file changes.
const DRAWING_CACHE = 'svg-v4';
const IMAGE_CACHE = 'v5';
// The editor's Settings (theme, animations, scrolling, ...) and where they live.
const settingsEl = document.getElementById('btn-settings')?.closest('.toolbar-popover') || null;
const settingsHome = settingsEl?.parentElement || null;

/** The workspace search outlives one visit, so a design found, opened, and
 *  left can be followed by the next match. Session state only. */
let lastQuery = '';

const HINTS = {
  // The few keys that get around; Learn (?) lists them all.
  workspace: 'Drag to move · double-click opens · / searches · F fits all · Shift+Backspace returns · ? every key',
  symbols: 'Every symbol · drag to move · F fits all · Esc returns · ? every key',
};

/** Live SVGs at most at once; the rest stay on their large images. */
const MAX_VECTOR_TILES = 6;
/** Large images decoded at once (each is up to ~6 MB of pixels). */
const MAX_LARGE_BITMAPS = 24;
const ZOOM_IN_PX_PER_UNIT = 3; // the editor's closest zoom: 120 px per grid cell
/** Each design's own reveal: it fades and grows in this long, after a delay
 *  that ripples out from the middle of the view (REVEAL_STEP_MS a design,
 *  at most REVEAL_SPREAD_MS), so the desk assembles rather than blinks on. */
const REVEAL_MS = 340;
const REVEAL_STEP_MS = 28;
const REVEAL_SPREAD_MS = 520;
/** A wheel zoom counts as motion until the wheel has been still this long. */
const WHEEL_SETTLE_MS = 150;
/** A design's image arriving after the desk shows fades in this long. */
const ARRIVE_MS = 160;
/** The desk's fade into the editor (style.css .atlas.leaving). */
const LEAVE_MS = 180;
/** A search packs the designs it found together once typing pauses this
 *  long; each keystroke only marks and fades. */
const ARRANGE_DELAY_MS = 400;
const ARRANGE_MS = 300;

let state = null;

export function atlasOpen() {
  return !!state;
}

/** What the desk shows, read-only, for tests and tools (it is drawn on a
 *  canvas): each design's name and place, whether it is the open one, the
 *  pick, matched by the search, how far it is lifted, and how far it has
 *  floated clear of the pick (drawing units); the view; a design in
 *  flight between the desk and the screen (its depth, 1 at the screen);
 *  and where the last frame's
 *  link beams landed, with the card each landed on (screen pixels); null
 *  when closed. */
export function atlasSnapshot() {
  if (!state) return null;
  return {
    source: state.source,
    busy: !!(state.entering || state.closing || state.opening),
    search: state.matches ? [...state.matches.keys()] : null,
    arranged: state.arranged,
    view: { ...state.view },
    flight: state.flight ? { id: state.flight.id, depth: state.flight.depth } : null,
    beams: state.beams || [],
    accent: state.colors?.accent || null,
    tiles: state.tiles.map((tile) => {
      const entry = state.entries.get(tile.id);
      return {
        id: tile.id, name: entry?.name, x: tile.x, y: tile.y, w: tile.w, h: tile.h, screen: worldToScreen(tile),
        current: !!entry?.current, selected: state.selected === tile.id || !!state.picked?.has(tile.id),
        lift: liftOf(tile.id).lift, dim: liftOf(tile.id).dim,
        float: { dx: liftOf(tile.id).dx || 0, dy: liftOf(tile.id).dy || 0 },
      };
    }),
  };
}

// ----- geometry ---------------------------------------------------------------

/** The Atlas's size, measured once per open and on resize: reading it from
 *  the DOM in every frame forces a layout each time. */
function paneSize() {
  if (state?.pane) return state.pane;
  const pane = { w: rootEl.clientWidth || window.innerWidth, h: rootEl.clientHeight || window.innerHeight };
  if (state) state.pane = pane;
  return pane;
}

/** CSS pixels per world unit at the current view. */
function scale() {
  return paneSize().w / state.view.w;
}

function clientToWorld(clientX, clientY) {
  const box = rootEl.getBoundingClientRect();
  const k = scale();
  return { x: state.view.x + (clientX - box.left) / k, y: state.view.y + (clientY - box.top) / k };
}

/** A desk point in client pixels, for tests that click the canvas. */
export function atlasWorldToClient(x, y) {
  const box = rootEl.getBoundingClientRect();
  const k = scale();
  return { x: box.left + (x - state.view.x) * k, y: box.top + (y - state.view.y) * k };
}

function worldToScreen(rect) {
  const k = scale();
  return { x: (rect.x - state.view.x) * k, y: (rect.y - state.view.y) * k, w: rect.w * k, h: rect.h * k };
}

function clampView(view) {
  const pane = paneSize();
  const minW = pane.w / ZOOM_IN_PX_PER_UNIT;
  const maxW = Math.max(40 * 1000, (state.bounds.w + state.bounds.h) * 4);
  const w = Math.min(Math.max(view.w, minW), maxW);
  const f = w / view.w;
  const cx = view.x + view.w / 2;
  const cy = view.y + view.h / 2;
  return { x: cx - w / 2, y: cy - (view.h * f) / 2, w, h: view.h * f };
}

/** The Atlas view that shows a design's tile exactly where the editor
 *  canvas shows the design, so switching between them does not move it. */
function editorEquivalentView(tile, entry, view = editor.view) {
  const pane = document.querySelector('.canvas-pane')?.getBoundingClientRect();
  if (!pane || !view?.w) return null;
  const k = pane.width / view.w;
  const root = rootEl.getBoundingClientRect();
  const dx = tile.x - entry.box.x;
  const dy = tile.y - entry.box.y;
  const { w, h } = paneSize();
  return { x: view.x + dx - (pane.left - root.left) / k, y: view.y + dy - (pane.top - root.top) / k, w: w / k, h: h / k };
}

/** The pixels the top bar and the hint bar take at the pane's top and
 *  bottom, with a little air: what is fitted stays clear of them. Read
 *  when fitting or packing, never per frame. */
function chromeInsets() {
  const { h } = paneSize();
  const head = rootEl.querySelector('.atlas-head');
  const top = head?.offsetHeight ? head.offsetTop + head.offsetHeight + 8 : 0;
  const bottom = hintEl?.offsetHeight ? h - hintEl.offsetTop + 8 : 0;
  // A very short window keeps most of itself for the desk.
  return top + bottom < h / 2 ? { top, bottom } : { top: 0, bottom: 0 };
}

function fitAllView() {
  const { w, h } = paneSize();
  return viewFittingIn({ ...state.bounds, h: state.bounds.h + ATLAS_CAPTION }, w, h, chromeInsets(), 0.05);
}

// ----- the drawings -------------------------------------------------------------

const cellFloor = (value) => Math.floor(value / GRID) * GRID;
const cellCeil = (value) => Math.ceil(value / GRID) * GRID;

/** Pack the designs by the whole grid cells they cover, then shift each
 *  drawing by whole cells into its slot: its grid lines continue the desk's.
 *  A tile is the drawing's rectangle on the desk. */
function placeDrawings(entries, previous = null) {
  const cells = new Map(entries.map((entry) => {
    const x = cellFloor(entry.box.x);
    const y = cellFloor(entry.box.y);
    return [entry.id, { x, y, w: cellCeil(entry.box.x + entry.box.w) - x, h: cellCeil(entry.box.y + entry.box.h) - y }];
  }));
  const boxes = new Map(entries.map((entry) => [entry.id, entry.box]));
  // A part linking to another design links the two designs (by name).
  const idsByName = new Map(entries.map((entry) => [entry.name, entry.id]));
  const linksOf = (entry) => (entry.index?.links || []).map((name) => idsByName.get(name)).filter(Boolean);
  const related = relatednessOf(entries.map((entry) => ({ id: entry.id, name: entry.name, dir: entry.dir, tags: entry.index?.tags || [], index: entry.index, links: linksOf(entry) })));
  // The ball takes the shape of the window's room for designs (between the
  // top bar and the hint bar): a narrow window packs tall.
  const pane = paneSize();
  const { top, bottom } = chromeInsets();
  const aspect = Math.min(3, Math.max(1 / 3, pane.w / (pane.h - top - bottom) || 1.6));
  // Remembered places keep the arrangement, stretched to the window if it
  // is another shape now (narrower, wider) than when they were packed. A
  // fresh packing holds the shape, kinship's pull notwithstanding.
  const places = reshapedPlaces(previous, aspect);
  const keep = !places?.reshaped;
  const items = entries.map((entry) => ({ id: entry.id, w: cells.get(entry.id).w, h: cells.get(entry.id).h }));
  const options = { previous: places, keep, related, aspect };
  const layout = places && keep ? layoutAtlas(items, options) : layoutAtlasShaped(items, options);
  const tiles = layout.tiles.map((slot) => {
    const box = boxes.get(slot.id);
    const cell = cells.get(slot.id);
    return { id: slot.id, x: box.x + slot.x - cell.x, y: box.y + slot.y - cell.y, w: box.w, h: box.h };
  });
  return { tiles, slots: layout.slots, bounds: layout.bounds };
}

// Where each design of a workspace sat on the desk last time, so the desk
// stays put between visits: only a new design, or one that no longer fits
// its old spot, is placed again. Kept per viewer, in this browser.

function rememberedSlots(folder) {
  try {
    const saved = JSON.parse(localStorage.getItem(DESK_KEY + folder) || 'null');
    return saved && typeof saved === 'object' ? new Map(Object.entries(saved)) : null;
  } catch { return null; }
}

function rememberSlots(folder, slots) {
  try {
    if (slots) localStorage.setItem(DESK_KEY + folder, JSON.stringify(Object.fromEntries(slots)));
    else localStorage.removeItem(DESK_KEY + folder);
  } catch { /* the desk still packs; it just is not remembered */ }
}

function viewBoxOf(svg) {
  const match = svg.match(/viewBox="([-\d.e]+)[ ,]+([-\d.e]+)[ ,]+([-\d.e]+)[ ,]+([-\d.e]+)"/);
  if (!match) return null;
  const [x, y, w, h] = match.slice(1).map(Number);
  return { x, y, w, h };
}

/** The design on transparent ground: the desk is the paper, one sheet for
 *  the whole workspace. */
function drawingSvg(circuit) {
  // An empty design is blank paper with its caption (the renderer's
  // "empty schematic" card would be a white box on the desk).
  if (!circuit.components.size && !circuit.labels.size) return EMPTY_SVG;
  return svgString(circuit, { ...DRAWING_EXPORT_OPTIONS, background: false, emptyHint: false });
}

const EMPTY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${8 * GRID}" height="${4 * GRID}" viewBox="0 0 ${8 * GRID} ${4 * GRID}"></svg>`;

/** The design as it stands: the open one from the editor, unsaved edits and
 *  all; the others from their files, through the cache. */
/**
 * The open design as the desk draws it: through its saved form, as its file
 * would be drawn. The browser measures an open design's math labels tighter
 * than the boxes a file keeps for them, so drawn live a design would take
 * another size on the desk while open -- and a design whose size changes
 * gives up its place, moving the desk around it.
 */
function openDesignAsSaved() {
  return loadDocument(editor.circuit.toJSON());
}

/** A design's drawing and index: from the editor for the open design with
 *  unsaved changes (`edited`), else from its file (cached by revision). */
async function drawingFor(documentInfo, edited) {
  if (edited) {
    const circuit = openDesignAsSaved();
    return { svg: drawingSvg(circuit), index: designIndex(circuit), revision: null };
  }
  const key = documentInfo.revision && renderingKey(documentInfo.path, documentInfo.revision, DRAWING_CACHE);
  const indexKey = documentInfo.revision && renderingKey(documentInfo.path, documentInfo.revision, INDEX_CACHE);
  const [cached, cachedIndex] = key ? await Promise.all([cacheGet(key), cacheGet(indexKey)]) : [null, null];
  if (cached && cachedIndex) return { svg: cached, index: cachedIndex, revision: documentInfo.revision };
  const data = await persistence.load(documentInfo.path);
  const circuit = loadDocument(data.state);
  const svg = cached || drawingSvg(circuit);
  const index = designIndex(circuit);
  if (key) await Promise.all([cached ? null : cachePut(key, svg), cachePut(indexKey, index)]);
  return { svg, index, revision: documentInfo.revision };
}

/** The symbol reference: one sheet, built from the registry on the spot. */
function loadSymbols() {
  titleEl.textContent = 'Symbols';
  titleEl.title = '';
  const sheet = symbolSheet();
  const svg = drawingSvg(sheet);
  const box = viewBoxOf(svg);
  const entry = { id: 'symbols', name: 'Symbols', path: null, revision: null, current: false, svg, box };
  state.entries = new Map([[entry.id, entry]]);
  state.tiles = [{ id: entry.id, x: box.x, y: box.y, w: box.w, h: box.h }];
  state.bounds = { ...box };
  statusEl.textContent = `${sheet.components.size} symbols`;
  return true;
}

async function loadWorkspace(generation) {
  statusEl.textContent = 'Reading the workspace…';
  const workspace = await persistence.workspace();
  if (!state || state.generation !== generation) return false;
  const folder = workspace.workspace || '';
  state.folder = folder;
  titleEl.textContent = folder.split(/[\\/]/).filter(Boolean).pop() || 'Workspace';
  titleEl.title = folder;
  // A browser-only file waiting for permission again cannot be read yet.
  const documents = (workspace.documents || []).filter((doc) => doc.kind === 'circuit' && !doc.locked && !doc.missing);
  const entries = [];
  const unreadable = [];
  for (const [index, doc] of documents.entries()) {
    const current = doc.path === editor.currentDocumentPath;
    try {
      // The open design without unsaved changes is drawn from its file, as
      // when it is not open: its size on the desk, and so its place, never
      // depend on whether it is (openDesignAsSaved).
      const edited = current && hasUnsavedChanges();
      const { svg, index, revision } = edited && state.entries.get(doc.path) || await drawingFor(doc, edited);
      const box = viewBoxOf(svg);
      if (box) entries.push({ id: doc.path, name: doc.name, names: doc.names || [], path: doc.path, dir: doc.dir, revision, modified: revisionTime(doc.revision), current, svg, box, index });
    } catch (err) {
      unreadable.push(doc.name);
      logLine(`Atlas: could not draw ${doc.name}: ${err.message}`, 'error');
    }
    if (!state || state.generation !== generation) return false;
    if (index % 4 === 3) {
      statusEl.textContent = `Drawing ${index + 1} of ${documents.length}…`;
      await new Promise((resolve) => setTimeout(resolve));
    }
  }
  // An on-going search shows only what it finds from the start.
  const provisional = state.tiles[0];
  state.entries = new Map(entries.map((entry) => [entry.id, entry]));
  state.unreadable = unreadable;
  applySearch(lastQuery, { arrange: 'instant' });
  const { tiles, bounds } = state;
  // The open design stayed on screen while the rest loaded: move the view
  // with it to its place in the layout, so it does not jump. Without one
  // (an unsaved or empty design) the view is bare paper and grid, so it can
  // move by whole cells to the middle of the desk unseen.
  const placed = provisional && tiles.find((tile) => tile.id === provisional.id);
  if (placed) state.view = { ...state.view, x: state.view.x + placed.x - provisional.x, y: state.view.y + placed.y - provisional.y };
  else if (tiles.length) {
    const cell = (value) => Math.round(value / GRID) * GRID;
    state.view = {
      ...state.view,
      x: state.view.x + cell(bounds.x + bounds.w / 2 - (state.view.x + state.view.w / 2)),
      y: state.view.y + cell(bounds.y + bounds.h / 2 - (state.view.y + state.view.h / 2)),
    };
  }
  state.revealAt = performance.now();
  void trimCache();
  return true;
}

// ----- baked images --------------------------------------------------------------

function theme() {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/** What the desk's colors are read for: the theme and the accent. */
function colorsKey() {
  return `${theme()}|${document.documentElement.dataset.accent || ''}`;
}

function bitmapKey(entry, level) {
  return `${entry.id}\n${entry.revision ?? 'live'}\n${theme()}\n${level}`;
}

async function rasterize(entry, level) {
  const svg = await withEmbeddedMathFont(theme() === 'dark' ? applyExportDarkTheme(entry.svg) : entry.svg);
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('could not draw the design'));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
  const longest = level === 'small' ? SMALL_PX : LARGE_PX;
  const k = longest / Math.max(entry.box.w, entry.box.h);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(entry.box.w * k));
  canvas.height = Math.max(1, Math.round(entry.box.h * k));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Decode (or bake and store) one image. */
async function bake(entry, level) {
  const cacheKey = entry.revision && renderingKey(entry.path, entry.revision, `${theme()}-${level}-${IMAGE_CACHE}`);
  const blob = cacheKey && await cacheGet(cacheKey);
  if (blob) return createImageBitmap(blob);
  // Drawing an SVG into a bitmap blocks the page; let a zoom finish first.
  while (state?.animation) await new Promise((resolve) => setTimeout(resolve, 50));
  if (!state) throw new Error('closed');
  const canvas = await rasterize(entry, level);
  if (cacheKey) {
    canvas.toBlob((png) => { if (png) void cachePut(cacheKey, png); }, 'image/png');
  }
  return createImageBitmap(canvas);
}

/** Load every cached small image, for at most `budget` ms. */
async function warmSmallImages(generation, budget) {
  // The open design's images are never cached: bake both now, so the
  // flight back can show them.
  const current = state.tiles.map((tile) => state.entries.get(tile.id)).find((entry) => entry.current);
  const baking = current ? ['small', 'large'].map(async (level) => {
    const key = bitmapKey(current, level);
    if (!state.bitmaps.has(key)) state.bitmaps.set(key, await bake(current, level));
  }) : [];
  // Every design's small image, from the cache or drawn now: the desk is
  // still, so drawing costs no frames, and the flight shows them all.
  const loads = state.tiles.map(async (tile) => {
    const entry = state.entries.get(tile.id);
    const key = bitmapKey(entry, 'small');
    if (!entry.revision || state.bitmaps.has(key)) return;
    const bitmap = await bake(entry, 'small').catch(() => null);
    if (!bitmap || !state || state.generation !== generation || state.bitmaps.has(key)) return;
    state.bitmaps.set(key, bitmap);
  });
  // The open design's own images always finish: the flight draws it from
  // them. The rest are given `budget` ms.
  await Promise.all([
    Promise.allSettled(baking),
    Promise.race([Promise.allSettled(loads), new Promise((resolve) => setTimeout(resolve, budget))]),
  ]);
}

/** Startup has no editor drawing to bridge from: prepare the desk before revealing it. */
async function prepareStartupImages(generation, target) {
  await document.fonts.ready;
  const k = paneSize().w / target.w * (window.devicePixelRatio || 1);
  await bakeTiles(state.tiles.map((tile) => ({ tile, entry: state.entries.get(tile.id) })), {
    levels: ({ tile }) => (tileDetail(Math.max(tile.w, tile.h) * k) === 'small' ? ['small'] : ['small', 'large']),
    bake: ({ entry }, level) => bake(entry, level),
    keep: ({ entry }, level, bitmap) => state.bitmaps.set(bitmapKey(entry, level), bitmap),
    failed: ({ entry }, level) => state.failed.add(bitmapKey(entry, level)),
    stale: () => !state || state.generation !== generation,
  });
}

/** Bake what the frame asked for, nearest the middle of the screen first. */
async function pump() {
  if (!state || state.baking) return;
  state.baking = true;
  try {
    while (state && state.wanted.length) {
      const { entry, level, key } = state.wanted.shift();
      if (state.bitmaps.has(key) || state.failed.has(key)) continue;
      const generation = state.generation;
      try {
        const bitmap = await bake(entry, level);
        if (!state || state.generation !== generation) return;
        state.bitmaps.set(key, bitmap);
        // An image that arrives once the desk shows fades in (see draw); the
        // open design is on it from the start, as the editor showed it.
        if (!entry.current && !rootEl.classList.contains('preparing')) state.arrived.set(key, performance.now());
        if (level === 'large') evictLargeBitmaps(key);
        requestDraw();
      } catch {
        state?.failed.add(key);
      }
    }
  } finally {
    if (state) state.baking = false;
  }
}

function evictLargeBitmaps(keep) {
  const large = [...state.bitmaps.keys()].filter((key) => key.endsWith('\nlarge'));
  for (const key of large.slice(0, Math.max(0, large.length - MAX_LARGE_BITMAPS))) {
    if (key === keep) continue;
    state.bitmaps.get(key)?.close?.();
    state.bitmaps.delete(key);
  }
}

// ----- painting --------------------------------------------------------------------

let drawQueued = false;

function requestDraw() {
  if (drawQueued || !state) return;
  drawQueued = true;
  requestAnimationFrame(() => {
    drawQueued = false;
    if (state) draw();
  });
}

function colors() {
  const style = getComputedStyle(rootEl);
  const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
  return {
    paper: read('--paper', '#fff'),
    grid: read('--grid', '#e9e9e9'),
    faint: read('--svg-faint', '#7a7d85'),
    text: read('--text', '#17181c'),
    dim: read('--text-dim', '#5a6372'),
    accent: read('--accent', '#0e7c7b'),
    // A lifted design's card -- the paper its drawing was rendered on, so
    // what the drawing fills with paper (a plot, a block) blends in -- and
    // the shadow it casts.
    card: read('--paper', '#fff'),
    shadow: document.documentElement.classList.contains('dark') ? 'rgba(0, 0, 0, 0.7)' : 'rgba(20, 24, 34, 0.28)',
  };
}

/** The hint bar names the pick -- the design Enter opens, with its tags --
 *  and the keys for it; with nothing picked it shows the keys that get around. */
function syncHint() {
  if (!hintEl) return;
  const ids = state.source === 'workspace' ? pickedIds() : [];
  const names = ids.map((id) => state.entries.get(id)).filter(Boolean);
  // The design under the pointer, when it is not the pick, has the bar
  // while the pointer is on it: named as a pick is, with what a click does.
  const hovered = state.source === 'workspace' && state.hover && !ids.includes(state.hover) ? state.entries.get(state.hover) : null;
  const describe = (entry) => `${entry.name}:${entry.index?.tags?.join(',') || ''}`;
  const key = `${state.source}|${hovered ? `hover:${describe(hovered)}` : names.map(describe).join('|')}`;
  if (state.hintKey === key) return;
  state.hintKey = key;
  const name = (entry) => Object.assign(document.createElement('b'), { className: 'atlas-hint-name', textContent: entry.name });
  const tagsOf = (entry) => {
    const tags = entry.index?.tags || [];
    return tags.length ? [' ', Object.assign(document.createElement('span'), { className: 'atlas-hint-tags', textContent: tags.map((tag) => `#${tag}`).join(' ') })] : [];
  };
  if (hovered) {
    hintEl.replaceChildren(name(hovered), ...tagsOf(hovered), ' · click picks · double-click opens');
    return;
  }
  if (!names.length) {
    hintEl.textContent = HINTS[state.source];
    return;
  }
  const parts = [];
  if (names.length === 1) {
    parts.push(name(names[0]), ...tagsOf(names[0]));
    parts.push(' · Enter opens · Z zooms to it · Esc clears');
  } else {
    const shown = names.slice(0, 3);
    shown.forEach((entry, i) => parts.push(...(i ? [', '] : []), name(entry)));
    if (names.length > shown.length) parts.push(` and ${names.length - shown.length} more`);
    parts.push(' · Ctrl+Shift+C copies them · Esc clears');
  }
  hintEl.replaceChildren(...parts);
}

/** The header's way back names the design the editor returns to, and says so when
 *  that design is not on the desk (a new drawing, or one from elsewhere). */
function syncBackButton() {
  if (!backEl || state.opening) return;
  const name = editor.currentCircuitName || 'Untitled';
  const onDesk = state.tiles.some((tile) => state.entries.get(tile.id)?.current);
  const label = `Back to ${name}${onDesk || state.source === 'symbols' ? '' : ' (not in this workspace)'}`;
  if (backEl.textContent !== label) {
    backEl.textContent = label;
    backEl.title = `Back to ${name} (Shift+Backspace)`;
  }
}

function draw() {
  syncBackButton();
  syncHint();
  const { w, h } = paneSize();
  const dpr = window.devicePixelRatio || 1;
  if (deskEl.width !== Math.round(w * dpr) || deskEl.height !== Math.round(h * dpr)) {
    deskEl.width = Math.round(w * dpr);
    deskEl.height = Math.round(h * dpr);
  }
  const ctx = deskEl.getContext('2d');
  // A theme change repaints everything: the palette, and the live SVGs.
  if (state.colorsKey !== colorsKey()) {
    state.colors = colors();
    state.colorsKey = colorsKey();
    overlayEl.replaceChildren();
    state.overlays.clear();
  }
  const palette = state.colors;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = palette.paper;
  ctx.fillRect(0, 0, w, h);
  drawGrid(ctx, palette, w, h);

  const screen = { x: state.view.x, y: state.view.y, w: state.view.w, h: state.view.h };
  // Mid-rearrangement, designs glide; those joining fade in, those leaving out.
  const progress = motionProgress();
  if (state.motion && progress >= 1) state.motion = null;
  const shown = state.tiles.map((tile) => ({ tile: shownTile(tile), alpha: state.motion && !state.motion.from.has(tile.id) ? progress : 1 }));
  if (state.motion) {
    for (const tile of state.motion.leaving) shown.push({ tile, alpha: 1 - progress });
    requestDraw();
  }
  // A design counts where it lies and where its card has floated to.
  const visible = shown.filter(({ tile }) => {
    const { dx = 0, dy = 0 } = liftOf(tile.id);
    return rectsIntersect(screen, { ...tile, h: tile.h + ATLAS_CAPTION }) || ((dx || dy) && rectsIntersect(screen, { ...tile, x: tile.x + dx, y: tile.y + dy, h: tile.h + ATLAS_CAPTION }));
  });
  const wanted = [];
  const center = { x: state.view.x + state.view.w / 2, y: state.view.y + state.view.h / 2 };
  const placed = visible.map(({ tile, alpha }) => {
    const rect = worldToScreen(tile);
    return { tile, alpha, rect, detail: tileDetail(Math.max(rect.w, rect.h) * dpr) };
  });
  // The tiles that fill the screen are drawn live; their images would only
  // blur the vector lines through the transparent paper. Not while the view
  // animates, though: a live SVG changing size is redrawn whole every frame.
  const moving = !!state.animation || !!state.motion || performance.now() - (state.wheelAt || 0) < WHEEL_SETTLE_MS;
  const vector = moving ? [] : placed.filter((item) => item.detail === 'vector')
    .sort((a, b) => b.rect.w * b.rect.h - a.rect.w * a.rect.h)
    .slice(0, MAX_VECTOR_TILES);
  const live = new Set(vector.map((item) => item.tile.id));
  updateLifts();
  // Lifted designs are drawn last, over the ones lying flat -- ordered by
  // where each is heading, so two trading places do not swap mid-way.
  placed.sort((a, b) => (liftOf(a.tile.id).target ?? 0) - (liftOf(b.tile.id).target ?? 0) || liftOf(a.tile.id).lift - liftOf(b.tile.id).lift);
  for (const { tile, alpha, rect: flatRect, detail } of placed) {
    // A design in flight is drawn over everything else (drawFlight); its
    // images are still asked for here.
    const flying = tile.id === state.flight?.id;
    const reveal = tileReveal(tile);
    const { lift, dim } = liftOf(tile.id);
    const placedRect = lifted(flatRect, tile.id);
    // Revealing, a design grows into its place from a little smaller.
    const grow = 0.9 + 0.1 * easeOutBack(reveal);
    const rect = reveal < 1 ? {
      x: placedRect.x + (placedRect.w * (1 - grow)) / 2, y: placedRect.y + (placedRect.h * (1 - grow)) / 2,
      w: placedRect.w * grow, h: placedRect.h * grow,
    } : placedRect;
    if (lift > 0.004 && !flying) drawCard(ctx, tile, placedRect, lift, palette);
    const entry = state.entries.get(tile.id);
    const found = state.matches?.get(tile.id);
    // A search fades every design it does not find; what it finds in one is
    // marked under the drawing, like a highlighter, while the search box has
    // focus -- away from it, the marks step aside and the drawings read clean.
    const fade = (state.matches && !found ? 0.18 : 1) * alpha * (1 - 0.72 * dim);
    ctx.globalAlpha = alpha;
    if (found?.hits.length && document.activeElement === searchEl) drawHits(ctx, tile, entry, found.hits, palette);
    ctx.globalAlpha = (entry.current ? 1 : Math.min(1, reveal * 1.6)) * fade;
    const level = detail === 'small' ? 'small' : 'large';
    const bitmap = state.bitmaps.get(bitmapKey(entry, level)) ||
      state.bitmaps.get(bitmapKey(entry, level === 'large' ? 'small' : 'large'));
    if (bitmap && !flying && !(live.has(tile.id) && state.overlays.get(tile.id)?.dataset.ready)) {
      // Best filtering at rest; in motion the cheap one, which no one sees.
      ctx.imageSmoothingQuality = moving ? 'low' : 'high';
      // A design whose image has only just arrived fades in; it does not pop.
      const since = state.arrived.get(bitmapKey(entry, 'small'));
      const arriving = since === undefined ? 1 : Math.min(1, (performance.now() - since) / ARRIVE_MS);
      if (arriving < 1) requestDraw();
      ctx.globalAlpha *= arriving;
      ctx.drawImage(bitmap, rect.x, rect.y, rect.w, rect.h);
    }
    const distance = Math.hypot(tile.x + tile.w / 2 - center.x, tile.y + tile.h / 2 - center.y);
    // Mid-animation only small images are fetched: decoding a large one
    // would drop frames, and the view does not rest here anyway.
    for (const need of level === 'large' && !moving ? ['small', 'large'] : ['small']) {
      const key = bitmapKey(entry, need);
      if (!state.bitmaps.has(key)) wanted.push({ entry, level: need, key, distance });
    }
    ctx.globalAlpha = alpha * Math.min(1, reveal * 1.6) * (1 - 0.6 * dim);
    if (!flying) drawCaption(ctx, tile, entry, placedRect, palette);
  }
  ctx.globalAlpha = 1;
  drawRipple(ctx, palette);
  drawLinks(ctx, palette, shown);
  if (state.flight) drawFlight(ctx, palette, w, h);
  drawZoomBox(ctx, palette);
  // Every small image first (the whole desk becomes recognizable), then large.
  wanted.sort((a, b) => (a.level === b.level ? a.distance - b.distance : a.level === 'small' ? -1 : 1));
  state.wanted = wanted;
  void pump();
  syncVectorOverlays(vector, moving);
}

// ----- lifting the picked designs ------------------------------------------------
//
// With nothing picked every design lies flat, at its true size, for
// comparison. A picked design lifts off the desk as a card -- a touch
// larger, brighter, on a soft shadow, an accent rim -- the designs it links
// to and those using it lift only part way, and the rest dim. Each design
// eases toward its own state, so picking and letting go animate.

const LIFT_GROW = 0.12;
const RELATED_LIFT = 0.3;
/** How far each level of the hierarchy lifts and dims: the pick, the
 *  designs it links to and those using it, then their children and theirs
 *  -- each lower than the one above, so the chain reads as depth. */
const LEVEL_LIFT = [1, RELATED_LIFT, 0.13, 0.055];
const LEVEL_DIM = [0, 0, 0.25, 0.45];

/** Every design's lift (0 flat .. 1 picked) and dim (0 .. 1), eased toward
 *  what the pick asks for; asks for frames while any is on its way. */
function updateLifts() {
  const now = performance.now();
  const dt = Math.min(100, now - (state.liftAt || now));
  state.liftAt = now;
  state.lifts ||= new Map();
  // Through a transition too the pick stays lifted, its kin part way, and
  // the rest dimmed: a design flies up from (or down to) the desk as it is.
  const focus = state.source === 'workspace' ? new Set([state.selected, ...(state.picked || [])].filter(Boolean)) : new Set();
  // With the links hidden the pick lifts alone: its kin lie flat with the rest.
  const depths = !focus.size ? new Map() : linksShown() ? hierarchyOf(focus).depths : new Map([...focus].map((id) => [id, 0]));
  const floats = floatTargets(depths);
  const rate = reducedMotion() ? 1 : 1 - Math.exp(-dt / 85);
  let moving = false;
  for (const tile of state.tiles) {
    const float = floats.get(tile.id) || { dx: 0, dy: 0 };
    const level = depths.get(tile.id);
    const target = { lift: level === undefined ? 0 : LEVEL_LIFT[level], dim: !focus.size ? 0 : level === undefined ? 1 : LEVEL_DIM[level], dx: float.dx, dy: float.dy };
    const now = state.lifts.get(tile.id) || { lift: 0, dim: 0, dx: 0, dy: 0 };
    const next = {};
    for (const key of ['lift', 'dim', 'dx', 'dy']) {
      const value = now[key] + (target[key] - now[key]) * rate;
      next[key] = Math.abs(value - target[key]) < (key === 'dx' || key === 'dy' ? 0.5 : 0.004) ? target[key] : value;
      if (next[key] !== target[key]) moving = true;
    }
    next.target = target.lift;
    // The height its card turns solid at: the lowest it rests at on the
    // way up, kept on the way down so a card fades as it lands.
    next.solidAt = target.lift ? Math.min(RELATED_LIFT, target.lift) : now.solidAt ?? RELATED_LIFT;
    state.lifts.set(tile.id, next);
  }
  if (moving) requestDraw();
}

const liftOf = (id) => state.lifts?.get(id) || { lift: 0, dim: 0, dx: 0, dy: 0 };

/** The picked designs' place in the hierarchy (linkDepths), three levels down. */
function hierarchyOf(focus) {
  return linkDepths(deskLinks(), focus, LEVEL_LIFT.length - 1);
}

/** Where the designs lifted with the pick float to (id -> { dx, dy }, in
 *  drawing units): grown on their cards they would overlap the picked one
 *  or each other, so each steps clear (floatClear), a level at a time down
 *  the hierarchy. Kept while the pick and the desk stay the same. */
function floatTargets(depths) {
  const key = [...depths].map(([id, level]) => `${id}:${level}`).sort().join('|');
  if (state.floats?.key === key && state.floats.tiles === state.tiles) return state.floats.offsets;
  const card = (tile, lift) => {
    const grow = 1 + LIFT_GROW * lift;
    const pad = ATLAS_GAP * 0.3;
    const w = tile.w * grow;
    const h = tile.h * grow;
    const level = depths.get(tile.id);
    return { id: tile.id, x: tile.x + (tile.w - w) / 2 - pad, y: tile.y + (tile.h - h) / 2 - pad, w: w + 2 * pad, h: h + 2 * pad + ATLAS_CAPTION, fixed: level === 0, rank: level };
  };
  const cards = state.tiles.filter((tile) => depths.has(tile.id)).map((tile) => card(tile, LEVEL_LIFT[depths.get(tile.id)]));
  const offsets = cards.some((c) => !c.fixed) ? floatClear(cards, 2 * ATLAS_GAP) : new Map();
  state.floats = { key, tiles: state.tiles, offsets };
  return offsets;
}

/** A design's screen rect as lifted: grown about its center, and floated clear. */
function lifted(rect, id) {
  const { lift, dx = 0, dy = 0 } = liftOf(id);
  const grow = 1 + LIFT_GROW * lift;
  if (grow === 1 && !dx && !dy) return rect;
  const k = scale();
  return { x: rect.x + (rect.w * (1 - grow)) / 2 + dx * k, y: rect.y + (rect.h * (1 - grow)) / 2 + dy * k, w: rect.w * grow, h: rect.h * grow };
}

/** A screen point on a design, where its lift has carried it. */
function liftedPoint(point, flat, id) {
  const { lift, dx = 0, dy = 0 } = liftOf(id);
  const grow = 1 + LIFT_GROW * lift;
  const k = scale();
  const cx = flat.x + flat.w / 2;
  const cy = flat.y + flat.h / 2;
  return { x: cx + (point.x - cx) * grow + dx * k, y: cy + (point.y - cy) * grow + dy * k };
}

/** The design under a world point as the desk shows it: a lifted card
 *  first, where it floats, then the designs lying flat. */
function tileUnder(point) {
  const raised = state.tiles.filter((tile) => liftOf(tile.id).lift > 0.01)
    .sort((a, b) => liftOf(b.id).lift - liftOf(a.id).lift);
  for (const tile of raised) {
    const { lift, dx = 0, dy = 0 } = liftOf(tile.id);
    const grow = 1 + LIFT_GROW * lift;
    const w = tile.w * grow;
    const h = tile.h * grow;
    const x = tile.x + (tile.w - w) / 2 + dx;
    const y = tile.y + (tile.h - h) / 2 + dy;
    if (point.x >= x && point.x <= x + w && point.y >= y && point.y <= y + h + ATLAS_CAPTION) return tile;
  }
  return tileAt(state.tiles, point);
}

/** The card a lifted design lies on, on screen: its drawing `rect` with a
 *  margin, and its name below when the name shows. */
function cardFrame(rect) {
  const k = scale();
  const pad = Math.max(4, ATLAS_GAP * 0.3 * k);
  const caption = Math.min(13, ATLAS_CAPTION * k * 0.45) >= 7 ? Math.min(13, ATLAS_CAPTION * k * 0.45) * 2.1 : 0;
  return { x: rect.x - pad, y: rect.y - pad, w: rect.w + 2 * pad, h: rect.h + 2 * pad + caption };
}

/** The corner radius of a card on screen. */
const cardRadius = () => Math.max(3, Math.min(16, GRID * 0.6 * scale()));

/** The card a lifted design rests on: the drawing's own paper, raised on a
 *  shadow that deepens and spreads as it rises; its rim a hairline in
 *  drawing units, so it stays fine however far out the desk is zoomed (the
 *  picked one's in the accent). */
function drawCard(ctx, tile, rect, lift, palette) {
  const k = scale();
  const { x, y, w, h } = cardFrame(rect);
  const radius = cardRadius();
  const picked = state.selected === tile.id || !!state.picked?.has(tile.id);
  // Solid from the height it rests at up: a lower card is nearer the desk
  // (a smaller shadow), never see-through.
  const solid = Math.min(1, lift / (liftOf(tile.id).solidAt ?? RELATED_LIFT));
  ctx.save();
  ctx.globalAlpha = solid;
  // Two shadows: a wide soft one far below, a tighter one close under it.
  ctx.fillStyle = palette.card;
  for (const [blur, drop, alpha] of [[70 * lift, 34 * lift, 1], [16 * lift, 6 * lift, 0.6]]) {
    ctx.shadowColor = palette.shadow;
    ctx.shadowBlur = blur;
    ctx.shadowOffsetY = drop;
    ctx.globalAlpha = solid * alpha;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.fill();
  }
  ctx.shadowColor = 'transparent';
  ctx.globalAlpha = solid;
  ctx.fill();
  ctx.globalAlpha = picked ? lift * 0.9 : solid * 0.3;
  ctx.strokeStyle = picked ? palette.accent : palette.dim;
  ctx.lineWidth = Math.max(0.5, Math.min(1.5, 3 * k));
  ctx.stroke();
  ctx.restore();
}

/** How far a design's reveal has come (1 at rest): designs nearer the
 *  middle of the view (or `state.revealFrom`, where a design lands) go
 *  first, the rest after them in turn. */
function tileReveal(tile) {
  if (!state.revealAt) return 1;
  if (!state.revealOrder || state.revealOrder.at !== state.revealAt) {
    const center = state.revealFrom || { x: state.view.x + state.view.w / 2, y: state.view.y + state.view.h / 2 };
    const ranked = [...state.tiles].sort((a, b) => Math.hypot(a.x + a.w / 2 - center.x, a.y + a.h / 2 - center.y) - Math.hypot(b.x + b.w / 2 - center.x, b.y + b.h / 2 - center.y));
    state.revealOrder = { at: state.revealAt, delay: new Map(ranked.map((t, i) => [t.id, Math.min(i * REVEAL_STEP_MS, REVEAL_SPREAD_MS)])) };
  }
  const t = (performance.now() - state.revealAt - (state.revealOrder.delay.get(tile.id) ?? 0)) / REVEAL_MS;
  if (t < 1) requestDraw();
  return Math.max(0, Math.min(1, t));
}

/** Out past 1 and back: a small overshoot as a design settles. */
function easeOutBack(t) {
  const c = 1.4;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
}

// ----- links -------------------------------------------------------------------

/** Whether the desk draws its links, a viewer's choice kept in this browser. */
function linksShown() {
  try { return localStorage.getItem(LINKS_KEY) !== 'off'; } catch { return true; }
}

function toggleLinks() {
  const show = !linksShown();
  try { localStorage.setItem(LINKS_KEY, show ? 'on' : 'off'); } catch { /* shown for this visit only */ }
  syncLinksButton();
  requestDraw();
}

function syncLinksButton() {
  linksEl?.setAttribute('aria-pressed', String(linksShown()));
}

/** The desk's link graph, built again only when a design's links change
 *  (the open design's index is refreshed in place). */
function deskLinks() {
  const designs = [...state.entries.values()].map((entry) => ({ id: entry.id, name: entry.name, links: entry.index?.links || [] }));
  const key = JSON.stringify(designs);
  if (state.links?.key !== key) state.links = { key, graph: linkGraph(designs) };
  return state.links.graph;
}

/**
 * The picked designs' links, drawn the way a reader follows them: a beam
 * of light (drawBeam) from the part that links to the design it names,
 * which is lifted (drawCard),
 * the curve arriving square to the side facing the part with a clear head.
 * A design using a picked one is linked to it the same way, from its part.
 * Below them the hierarchy goes on (hierarchyOf): each child's own links
 * to its children, fainter a level at a time, as lifted as they are.
 * Each curve runs over a halo of the paper, so it reads cleanly across
 * drawings. Nothing is drawn with no design picked, nor while the desk is
 * in a transition (its names and picks are gone then too).
 */
function drawLinks(ctx, palette, shown) {
  state.beams = [];
  if (state.source !== 'workspace' || state.quiet || !linksShown()) return;
  const focus = new Set([state.selected, ...(state.picked || [])].filter(Boolean));
  if (!focus.size) return;
  const edges = [
    ...deskLinks().edges.filter(({ from, to }) => focus.has(from) || focus.has(to)).map((edge) => ({ ...edge, depth: 1 })),
    ...hierarchyOf(focus).chain,
  ];
  if (!edges.length) return;
  const tiles = new Map(shown.map(({ tile, alpha }) => [tile.id, { tile, alpha }]));
  // The drawing and its name on screen, a little out from them.
  const PAD = 10;
  // Where a design's lift has carried it (lifted designs float larger).
  const frameOf = (tile) => {
    const r = lifted(worldToScreen({ ...tile, h: tile.h + ATLAS_CAPTION }), tile.id);
    return { x: r.x - PAD, y: r.y - PAD, w: r.w + 2 * PAD, h: r.h + 2 * PAD };
  };
  const fadedOf = (from, to) => !!state.matches && !(state.matches.has(from) && state.matches.has(to));
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([]);
  for (const { from, to, depth } of edges) {
    const a = tiles.get(from);
    const b = tiles.get(to);
    if (!a || !b) continue;
    const source = state.entries.get(from);
    const target = state.entries.get(to);
    // From each part that links (an index from before parts kept their
    // links: from the design's frame, toward the other).
    const parts = (source?.index?.items || []).filter((item) => item.kind === 'part' && item.link === target?.name && item.boxes?.[0]);
    const dx = a.tile.x - (source?.box?.x ?? a.tile.x);
    const dy = a.tile.y - (source?.box?.y ?? a.tile.y);
    const flat = worldToScreen(a.tile);
    // Each part that links, on screen where the lift has carried it: its
    // center and its box.
    const starts = parts.length
      ? parts.map((item) => {
        const box = item.boxes[0];
        const corner = (x, y) => liftedPoint(worldToScreen({ x: x + dx, y: y + dy, w: 0, h: 0 }), flat, from);
        const p0 = corner(box.x, box.y);
        const p1 = corner(box.x + box.w, box.y + box.h);
        return { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2, box: { x: p0.x, y: p0.y, w: p1.x - p0.x, h: p1.y - p0.y } };
      })
      : (() => { const arrow = linkArrow(frameOf(a.tile), frameOf(b.tile), 0); return arrow ? [{ x: arrow.x1, y: arrow.y1, box: null }] : []; })();
    // The beams come up with the lift, and go with it; down the chain each
    // level's are fainter.
    const rising = depth === 1 ? Math.max(liftOf(from).lift, liftOf(to).lift)
      : (depth === 2 ? 0.55 : 0.32) * Math.min(1, liftOf(to).lift / LEVEL_LIFT[depth]);
    ctx.globalAlpha = Math.min(a.alpha, b.alpha) * (fadedOf(from, to) ? 0.3 : 1) * rising;
    // It lands on the edge of the card the design is lifted on.
    const card = cardFrame(lifted(worldToScreen(b.tile), to));
    for (const start of starts) {
      const end = drawBeam(ctx, start, card, palette);
      if (end) state.beams.push({ from, to, depth, end, card });
    }
  }
  ctx.restore();
}

/** A color as CSS with `alpha` (a hex color; anything else as it is). */
function withAlpha(color, alpha) {
  const hex = String(color).trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!hex) return color;
  const digits = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * A link as a beam of light: a curved band that leaves the linking part --
 * lit by a soft spotlight, never covered -- and widens and fades as it
 * reaches the design it names, ending flush on that design's card edge
 * rather than in a head; which way it goes reads from its taper. Its width is in
 * drawing units, so it keeps its proportion to the drawings at any zoom.
 * Drawn additively on a dark desk, so where beams cross they brighten, as
 * light does. Returns where it lands (null when the part is inside).
 */
function drawBeam(ctx, start, frame, palette) {
  const curve = linkCurve({ x: start.x, y: start.y }, frame, 0);
  if (!curve) return null;
  const k = scale();
  const narrow = Math.max(0.8, 0.12 * GRID * k);
  const wide = Math.max(4, Math.min(1.6 * GRID * k, (Math.abs(curve.direction.x) > 0 ? frame.h : frame.w) * 0.2));
  // It comes in straight for a while, longer as it is wider, so its sides
  // do not fold over each other where it turns to meet the card.
  const { start: p0, c1, end: p3, direction } = curve;
  const length = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  const reach = Math.min(Math.max(Math.hypot(curve.c2.x - p3.x, curve.c2.y - p3.y), wide * 2.5), length * 0.7);
  const c2 = { x: p3.x - direction.x * reach, y: p3.y - direction.y * reach };
  const bezier = (t) => {
    const u = 1 - t;
    return {
      x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y,
    };
  };
  // Its heading at `t`: square to the card where it lands.
  const tangent = (t) => {
    const u = 1 - t;
    return {
      x: 3 * u * u * (c1.x - p0.x) + 6 * u * t * (c2.x - c1.x) + 3 * t * t * (p3.x - c2.x),
      y: 3 * u * u * (c1.y - p0.y) + 6 * u * t * (c2.y - c1.y) + 3 * t * t * (p3.y - c2.y),
    };
  };
  // The beam begins where it leaves the part's box: the part stays clear.
  const box = start.box;
  const inside = (p) => box && p.x > box.x && p.x < box.x + box.w && p.y > box.y && p.y < box.y + box.h;
  const steps = 48;
  let first = 0;
  while (first < steps - 4 && inside(bezier(first / steps))) first += 1;
  const points = [];
  for (let i = first; i <= steps; i++) points.push({ t: (i - first) / (steps - first), u: i / steps, ...bezier(i / steps) });
  const left = [];
  const right = [];
  points.forEach((p) => {
    const d = p.u === 1 ? direction : tangent(p.u);
    const len = Math.hypot(d.x, d.y) || 1;
    const nx = -d.y / len;
    const ny = d.x / len;
    const half = (narrow + (wide - narrow) * p.t ** 1.6) / 2;
    left.push({ x: p.x + nx * half, y: p.y + ny * half });
    right.push({ x: p.x - nx * half, y: p.y - ny * half });
  });
  const dark = theme() === 'dark';
  const from = points[0];
  ctx.save();
  if (dark) ctx.globalCompositeOperation = 'lighter';
  // The spotlight: a soft pool of light over the part that links, its
  // center as faint as its edge is gone, so the symbol reads through it.
  if (box) {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const r = Math.max(box.w, box.h) * 0.75 + 4;
    const pool = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    pool.addColorStop(0, withAlpha(palette.accent, dark ? 0.16 : 0.1));
    pool.addColorStop(0.6, withAlpha(palette.accent, dark ? 0.1 : 0.06));
    pool.addColorStop(1, withAlpha(palette.accent, 0));
    ctx.fillStyle = pool;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * Math.max(0.6, box.w / Math.max(box.w, box.h)) + 4, r * Math.max(0.6, box.h / Math.max(box.w, box.h)) + 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Nothing of it crosses the card's edge: it ends there, cut clean.
  ctx.beginPath();
  const far = 1e5;
  const along = { x: -direction.y, y: direction.x };
  ctx.moveTo(p3.x + along.x * far, p3.y + along.y * far);
  ctx.lineTo(p3.x - along.x * far, p3.y - along.y * far);
  ctx.lineTo(p3.x - along.x * far - direction.x * far, p3.y - along.y * far - direction.y * far);
  ctx.lineTo(p3.x + along.x * far - direction.x * far, p3.y + along.y * far - direction.y * far);
  ctx.closePath();
  ctx.clip();
  const gradient = ctx.createLinearGradient(from.x, from.y, curve.end.x, curve.end.y);
  gradient.addColorStop(0, withAlpha(palette.accent, dark ? 0.55 : 0.4));
  gradient.addColorStop(0.55, withAlpha(palette.accent, dark ? 0.24 : 0.16));
  // A little light left where it meets the design, so it lands there.
  gradient.addColorStop(1, withAlpha(palette.accent, dark ? 0.12 : 0.08));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (const p of left.slice(1)) ctx.lineTo(p.x, p.y);
  for (const p of right.reverse()) ctx.lineTo(p.x, p.y);
  ctx.closePath();
  ctx.fill();
  // Its bright core, fading sooner.
  const core = ctx.createLinearGradient(from.x, from.y, curve.end.x, curve.end.y);
  core.addColorStop(0, withAlpha(palette.accent, 0.75));
  core.addColorStop(0.6, withAlpha(palette.accent, 0.12));
  core.addColorStop(1, withAlpha(palette.accent, 0));
  ctx.strokeStyle = core;
  ctx.lineWidth = Math.max(0.6, Math.min(1.4, 0.05 * GRID * k));
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.stroke();
  ctx.restore();
  return curve.end;
}

/** A search's hits in one design: a translucent mark under each. */
function drawHits(ctx, tile, entry, hits, palette) {
  const dx = tile.x - entry.box.x;
  const dy = tile.y - entry.box.y;
  ctx.save();
  ctx.globalAlpha *= 0.28;
  ctx.fillStyle = palette.accent;
  for (const hit of hits) {
    for (const b of hit.boxes) {
      const rect = worldToScreen({ x: b.x + dx, y: b.y + dy, w: b.w, h: b.h });
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    }
  }
  ctx.restore();
}

// ----- the workspace check --------------------------------------------------------
//
// What in the workspace needs a hand: links naming a design no file is
// called (core/workspace-check.js finds the design one most likely meant:
// the one saved under that name, renamed outside the editor), the editor's
// unsaved changes, and files the desk could not read. The Check button
// turns amber while there is any; its menu (a toolbar menu, toolbar-ui.js) relinks, opens a
// design at the parts concerned, or saves.

/** What the check finds on the desk now. */
function workspaceFindings() {
  const designs = [...state.entries.values()].map((entry) => ({
    id: entry.id, name: entry.name, names: entry.names || [],
    parts: (entry.index?.items || []).filter((item) => item.kind === 'part' && item.link).map((item) => ({ id: item.id, link: item.link })),
  }));
  return {
    links: brokenLinks(designs),
    unsaved: hasUnsavedChanges() ? { name: editor.currentCircuitName || '', saved: !!editor.currentDocumentPath } : null,
    unreadable: state.unreadable || [],
  };
}

/** The Check button's count and its menu, from what the desk shows now. */
function syncCheck() {
  const wrap = checkEl?.closest('.atlas-check');
  if (!wrap) return;
  const shown = state?.source === 'workspace' && state.tiles.length > 0;
  wrap.hidden = !shown;
  if (!shown) return;
  const found = workspaceFindings();
  const count = found.links.length + (found.unsaved ? 1 : 0) + found.unreadable.length;
  // Something to look at turns the button amber; the count is in its title.
  checkEl.classList.toggle('atlas-check-findings', count > 0);
  checkEl.dataset.findings = String(count);
  checkEl.title = count ? `Check the workspace: ${count} to look at` : 'Check the workspace';
  // Redrawn under the keyboard (after a relink), the menu keeps the focus.
  const focused = checkMenuEl.contains(document.activeElement);
  checkMenuEl.replaceChildren(...checkMenuItems(found));
  if (focused) {
    checkMenuEl.tabIndex = -1;
    checkMenuEl.focus({ preventScroll: true });
  }
}

const parts = (refs) => refs.join(', ');

function checkMenuItems({ links, unsaved, unreadable }) {
  const items = [];
  const heading = (text) => el('p', { class: 'toolbar-menu-heading', text });
  const note = (text) => el('p', { class: 'toolbar-menu-note', text });
  const item = (text, title, onclick) => el('button', { type: 'button', role: 'menuitem', title, text, onclick });
  if (links.length) {
    items.push(heading('Broken links'));
    for (const broken of links) {
      const where = `${broken.name}: ${parts(broken.parts)} → ${broken.link}`;
      if (broken.to) {
        items.push(item(`Relink ${where} to ${broken.to}`, `No design is called ${broken.link} now; ${broken.to} was saved under that name`, () => void relinkOnDesk([broken])));
      } else {
        const why = broken.candidates.length
          ? `No design is called ${broken.link} now; ${broken.candidates.join(' and ')} were all saved under that name, so pick one`
          : `No design in the workspace is or was called ${broken.link}`;
        items.push(item(`Open ${where}`, `${why}: opens ${broken.name} with ${parts(broken.parts)} selected (right-click, Link to design)`, () => void openAtParts(broken)));
      }
    }
    const fixable = links.filter((broken) => broken.to);
    if (fixable.length > 1) items.push(item(`Relink all ${fixable.length}`, 'Relink each to the design saved under its name', () => void relinkOnDesk(fixable)));
  }
  if (unsaved) {
    items.push(heading('Unsaved changes'));
    if (unsaved.saved) items.push(item(`Save ${unsaved.name}`, `${unsaved.name}, open in the editor, has changes not saved yet`, () => void saveFromDesk()));
    else items.push(note(`The drawing in the editor has not been saved as a design yet${unsaved.name ? ` (${unsaved.name})` : ''}.`));
  }
  if (unreadable.length) {
    items.push(heading('Could not be read'));
    items.push(note(`${unreadable.join(', ')}: not a drawing this version can open (the log says why).`));
  }
  if (!items.length) items.push(note('Nothing to fix: every link finds its design, every file reads, and nothing is unsaved.'));
  return items;
}

/** Relink each finding's parts to the design saved under its name: in the
 *  editor when the design is open there (one undo step, then unsaved),
 *  else in its file. The desk's own index follows at once. */
async function relinkOnDesk(findings) {
  const done = [];
  for (const broken of findings) {
    const entry = state?.entries.get(broken.design);
    if (!entry || !broken.to) continue;
    try {
      if (entry.current) {
        commit(() => {
          for (const ref of broken.parts) if (editor.circuit.components.get(ref)?.link === broken.link) editor.circuit.setLink(ref, broken.to);
        });
        render();
      } else {
        const loaded = await persistence.load(entry.path);
        if (relinkDocumentState(loaded.state, broken.link, broken.to)) await persistence.save({ path: entry.path }, loaded.state, { overwrite: true, force: true });
      }
    } catch (err) {
      logLine(`Could not relink ${entry.name}: ${err.message}`, 'error');
      continue;
    }
    if (!state) return;
    for (const item of entry.index?.items || []) if (item.kind === 'part' && item.link === broken.link) item.link = broken.to;
    if (entry.index) entry.index.links = [...new Set(entry.index.items.map((item) => item.link).filter(Boolean))];
    done.push(`${entry.name} (${parts(broken.parts)} → ${broken.to})`);
  }
  if (done.length) logLine(`Relinked ${done.join(', ')}.`);
  if (!state) return;
  syncCheck();
  requestDraw();
}

/** Open a broken link's design with its parts selected, to relink by hand. */
async function openAtParts(broken) {
  const tile = tileById(broken.design);
  if (tile) await openTile(tile, { select: broken.parts });
}

async function saveFromDesk() {
  await saveCircuit();
  if (state) syncCheck();
}

// ----- the listing ------------------------------------------------------------------
//
// Every design on the desk in one table, to keep a workspace's names and
// tags in order: its name, when it was last saved, its tags, and whether it
// holds beats, a timing diagram, or links. Sorted by name or by date, either
// way round (the choice kept in this browser). A click picks the design and
// shows it on the desk; a double-click on its name renames it as the editor
// does (renameDesign: other designs' links follow).

function listSort() {
  try {
    const saved = JSON.parse(localStorage.getItem(LIST_SORT_KEY) || 'null');
    if (saved && (saved.by === 'name' || saved.by === 'date')) return { by: saved.by, reverse: !!saved.reverse };
  } catch { /* the default */ }
  return { by: 'name', reverse: false };
}

function setListSort(by) {
  const now = listSort();
  const next = { by, reverse: now.by === by ? !now.reverse : false };
  try { localStorage.setItem(LIST_SORT_KEY, JSON.stringify(next)); } catch { /* this visit only */ }
  syncList();
}

/** The designs in the listing's order: by name A to Z, or by date newest
 *  first; reversed on a second click. */
function listedEntries() {
  const { by, reverse } = listSort();
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  const compare = by === 'date' ? (a, b) => (b.modified ?? 0) - (a.modified ?? 0) || byName(a, b) : byName;
  const entries = [...state.entries.values()].sort(compare);
  return reverse ? entries.reverse() : entries;
}

/** The List button and its table, from what the desk holds now. */
function syncList() {
  const wrap = listEl?.closest('.atlas-list');
  if (!wrap) return;
  const shown = state?.source === 'workspace' && state.tiles.length > 0;
  wrap.hidden = !shown;
  if (!shown) return;
  const { by, reverse } = listSort();
  const sortHeader = (key, text) => {
    const active = by === key;
    const ascending = key === 'name' ? !reverse : reverse;
    return el('th', { scope: 'col', 'aria-sort': active ? (ascending ? 'ascending' : 'descending') : 'none' }, [
      el('button', { type: 'button', class: 'atlas-list-sort', title: `Sort by ${key}`, onclick: () => setListSort(key) }, [
        text, active ? el('span', { class: 'atlas-list-arrow', text: ascending ? ' ▲' : ' ▼' }) : '',
      ]),
    ]);
  };
  const flag = (on, what) => el('td', { class: 'atlas-list-flag', 'aria-label': on ? what : `no ${what}` }, on ? [el('span', { class: 'atlas-list-check', text: '✓' })] : []);
  const rows = listedEntries().map((entry) => {
    const modified = entry.modified ? formatModifiedTime(entry.modified) : '';
    const name = el('span', { class: 'atlas-list-name', title: 'Rename (F2)', text: entry.name });
    const nameCell = el('td', { class: 'atlas-list-name-cell' }, [name, entry.current ? el('span', { class: 'atlas-list-open', text: 'open' }) : '']);
    name.addEventListener('dblclick', (ev) => { ev.stopPropagation(); startRename(nameCell, entry); });
    const tagsCell = el('td', { class: 'atlas-list-tags', title: 'Tags (#)', text: (entry.index?.tags || []).map((tag) => `#${tag}`).join(' ') });
    tagsCell.addEventListener('dblclick', (ev) => { ev.stopPropagation(); startTagEdit(tagsCell, entry); });
    const row = el('tr', { 'data-id': entry.id }, [
      nameCell,
      el('td', { class: 'atlas-list-date', title: entry.modified ? new Date(entry.modified).toLocaleString() : '', text: modified }),
      tagsCell,
      flag(!!entry.index?.beats, 'beats'),
      flag(!!entry.index?.timing, 'timing diagram'),
      flag(!!entry.index?.links?.length, 'links'),
    ]);
    // A click shows the design on the desk, picked; a double-click (off its
    // name and tags) opens it.
    row.addEventListener('contextmenu', (ev) => {
      if (ev.target.closest('input')) return;
      ev.preventDefault();
      if (!pickedIds().includes(entry.id)) pickListRow(row);
      openDesignMenu(tileById(entry.id), ev.clientX, ev.clientY);
    });
    row.addEventListener('click', (ev) => {
      if (ev.target.closest('input')) return;
      if (ev.shiftKey) pickListRange(row);
      else if (ev.ctrlKey || ev.metaKey) toggleListRow(row);
      else pickListRow(row);
    });
    row.addEventListener('dblclick', (ev) => {
      if (!ev.target.closest('input')) void openListRow(row);
    });
    return row;
  });
  const table = el('table', { class: 'atlas-list-table' }, [
    el('thead', {}, [el('tr', {}, [
      sortHeader('name', 'Name'),
      sortHeader('date', 'Saved'),
      el('th', { scope: 'col', text: 'Tags' }),
      el('th', { scope: 'col', class: 'atlas-list-flag', text: 'Beats' }),
      el('th', { scope: 'col', class: 'atlas-list-flag', text: 'Timing' }),
      el('th', { scope: 'col', class: 'atlas-list-flag', text: 'Links' }),
    ])]),
    el('tbody', {}, rows),
  ]);
  listPanelEl.replaceChildren(table);
  markListRows();
  // Once it shows (toolbar-ui.js opens it after this), it moves left as far
  // as it takes to stay inside the window.
  requestAnimationFrame(placeListPanel);
}

function placeListPanel() {
  if (listPanelEl.hidden) return;
  // A row scrolled to stops below the header that stays on top, not under it.
  listPanelEl.style.scrollPaddingTop = `${listPanelEl.querySelector('thead')?.offsetHeight || 0}px`;
  listPanelEl.style.left = '0px';
  const box = listPanelEl.getBoundingClientRect();
  const margin = 12;
  const over = box.right - (window.innerWidth - margin);
  if (over > 0) listPanelEl.style.left = `${-Math.min(over, box.left - margin)}px`;
}

/** A cell of the listing edited in place: it becomes a field holding
 *  `value`; Enter gives the text to `commit` (unless unchanged), Esc or
 *  leaving the field keeps what was there. The listing keeps the keys. */
function editCell(cell, { value, label, placeholder = '', commit }) {
  const input = el('input', { type: 'text', class: 'atlas-list-edit', value, placeholder, 'aria-label': label, spellcheck: 'false', autocomplete: 'off' });
  let done = false;
  const finish = async (apply) => {
    if (done) return;
    done = true;
    const text = input.value.trim();
    if (apply && text !== value.trim()) {
      input.disabled = true;
      await commit(text);
    }
    if (!state) return;
    syncList();
    listPanelEl.focus({ preventScroll: true });
  };
  input.addEventListener('keydown', (ev) => {
    // The field's own keys: never the desk's, nor the listing's, nor the
    // menu's Esc.
    ev.stopPropagation();
    if (ev.key === 'Enter') { ev.preventDefault(); void finish(true); }
    else if (ev.key === 'Escape') { ev.preventDefault(); void finish(false); }
  });
  input.addEventListener('blur', () => void finish(false));
  cell.replaceChildren(input);
  input.focus();
  input.select();
}

/** Rename a design from the listing, as the editor renames. */
function startRename(cell, entry) {
  editCell(cell, {
    value: entry.name,
    label: `New name for ${entry.name}`,
    commit: async (name) => {
      if (!name) return;
      const saved = await renameDesign(entry.path, name, entry.dir ? { dir: entry.dir } : {});
      if (state && saved) await reloadDesk({ quiet: true, pick: saved.path });
    },
  });
}

/** Edit a design's tags from the listing, as # does on the desk; with
 *  several designs picked (`many`), add tags to each of them instead. */
function startTagEdit(cell, entry, many = null) {
  if (many?.length > 1) {
    editCell(cell, {
      value: '',
      label: `Tags to add to ${many.length} designs`,
      placeholder: `tags to add to ${many.length} designs`,
      commit: (text) => addTags(many, text),
    });
    return;
  }
  editCell(cell, {
    value: tagsText(entry.index?.tags),
    label: `Tags of ${entry.name}`,
    placeholder: 'tags, separated by spaces',
    commit: (text) => saveTags(entry, text),
  });
}

/** Add tags to several designs at once: each keeps its own, and gains the
 *  new ones it does not already have (never a tag twice). */
async function addTags(entries, text) {
  const added = parseTags(text);
  if (!added.length) return;
  for (const entry of entries) {
    if (!state) return;
    await saveTags(entry, tagsText([...(entry.index?.tags || []), ...added]));
  }
}

/** The listing's rows marked from the pick: every picked design, and the
 *  last one picked (where the keys go on from) as the cursor. */
function markListRows() {
  const picked = new Set(pickedIds());
  for (const row of listPanelEl.querySelectorAll('tbody tr')) {
    row.classList.toggle('picked', picked.has(row.dataset.id));
    row.classList.toggle('cursor', state.selected === row.dataset.id);
  }
}

/** Pick only a row's design and show it on the desk; it anchors a range. */
function pickListRow(row) {
  const tile = tileById(row.dataset.id);
  if (!tile) return;
  state.picked = null;
  state.listAnchor = tile.id;
  focusTile(tile);
  markListRows();
  row.scrollIntoView({ block: 'nearest' });
}

/** Ctrl/Cmd+click: a row's design into the pick, or out of it. */
function toggleListRow(row) {
  const id = row.dataset.id;
  state.picked = new Set(pickedIds());
  if (state.picked.has(id)) {
    state.picked.delete(id);
    state.selected = [...state.picked].at(-1) || null;
  } else {
    state.picked.add(id);
    state.selected = id;
  }
  state.listAnchor = id;
  markListRows();
  requestDraw();
}

/** Shift+click or Shift+arrow: every design from the anchor row to `row`
 *  picked, `row` the cursor; shown on the desk. */
function pickListRange(row) {
  const rows = [...listPanelEl.querySelectorAll('tbody tr')];
  const anchor = rows.findIndex((r) => r.dataset.id === (state.listAnchor || state.selected));
  const to = rows.indexOf(row);
  if (anchor < 0) {
    pickListRow(row);
    return;
  }
  const [from, end] = anchor < to ? [anchor, to] : [to, anchor];
  state.picked = new Set(rows.slice(from, end + 1).map((r) => r.dataset.id));
  const tile = tileById(row.dataset.id);
  if (tile) focusTile(tile);
  else state.selected = row.dataset.id;
  markListRows();
  row.scrollIntoView({ block: 'nearest' });
}

/** Open a row's design, the listing closed first. */
async function openListRow(row) {
  const tile = tileById(row.dataset.id);
  if (!tile) return;
  closeToolbarMenu(listEl, listPanelEl);
  await openTile(tile);
}

/** Shift+L: the listing, opened (holding the keys) or closed. */
function toggleList() {
  if (!listEl || listEl.closest('.atlas-list')?.hidden) return;
  listEl.click();
  if (!listPanelEl.hidden) {
    listPanelEl.tabIndex = -1;
    listPanelEl.focus({ preventScroll: true });
  }
}

/** The listing's keys: ↑/↓ (Home/End) step through the designs, picking
 *  each; Enter opens the picked one; F2 renames it, # edits its tags. */
function onListKey(ev) {
  if (ev.target.closest?.('input') || !state) return;
  const rows = [...listPanelEl.querySelectorAll('tbody tr')];
  if (!rows.length) return;
  // The keys go on from the cursor: the design picked last.
  const at = rows.findIndex((row) => row.dataset.id === state.selected);
  const step = { ArrowDown: 1, ArrowUp: -1 }[ev.key];
  let target = null;
  if (step) target = rows[at < 0 ? (step > 0 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, at + step))];
  else if (ev.key === 'Home') target = rows[0];
  else if (ev.key === 'End') target = rows.at(-1);
  if (target) {
    ev.preventDefault();
    ev.stopPropagation();
    // Shift extends the pick from its anchor, as Shift+click does.
    if (ev.shiftKey && at >= 0) pickListRange(target);
    else pickListRow(target);
    return;
  }
  // A key the listing takes goes no further: closed by it, the listing
  // would otherwise hand the same key on to the desk.
  const take = () => { ev.preventDefault(); ev.stopPropagation(); };
  if (ev.key === 'L') {
    take();
    toggleList();
    return;
  }
  const row = rows[at];
  if (!row) return;
  const entry = state.entries.get(row.dataset.id);
  if (ev.key === 'Enter') {
    take();
    void openListRow(row);
  } else if (ev.key === 'F2' && entry) {
    take();
    startRename(row.querySelector('.atlas-list-name-cell'), entry);
  } else if (ev.key === 'Delete' && entry) {
    take();
    void deletePicked();
  } else if (ev.key === '#' && entry) {
    take();
    const many = pickedIds().map((id) => state.entries.get(id)).filter(Boolean);
    startTagEdit(row.querySelector('.atlas-list-tags'), entry, many);
  }
}

// ----- search ---------------------------------------------------------------

/** Search the designs for `query` (core/design-index.js); an empty query
 *  shows every design again. What it finds is marked at once and the rest
 *  fade; `arrange` says when the desk is packed again with only the designs
 *  found: 'soon' (once typing pauses), 'now' (animated), or 'instant'. */
function applySearch(query, { arrange = 'soon' } = {}) {
  if (!state || state.source !== 'workspace') return;
  lastQuery = query;
  const text = query.trim();
  const total = state.entries.size;
  const designs = `${total} design${total === 1 ? '' : 's'}`;
  if (!text) {
    state.matches = null;
    statusEl.textContent = designs;
  } else {
    state.matches = new Map();
    for (const entry of state.entries.values()) {
      const found = searchDesign(entry.index, entry.name, text);
      if (found) state.matches.set(entry.id, found);
    }
    const count = state.matches.size;
    statusEl.textContent = count ? `${count} of ${designs} · Enter steps through them` : 'No design matches';
  }
  for (const [id, el] of state.overlays) el.style.opacity = !state.matches || state.matches.has(id) ? '' : '0.18';
  // One design left is the one being looked for: pick it, so Enter opens it. Packing the desk around it brings it into view.
  if (state.matches?.size === 1) state.selected = [...state.matches.keys()][0];
  clearTimeout(state.arrangeTimer);
  state.arrangeTimer = null;
  if (arrange === 'soon') {
    const generation = state.generation;
    state.arrangeTimer = setTimeout(() => {
      if (state?.generation === generation) arrangeDesk();
    }, ARRANGE_DELAY_MS);
  } else arrangeDesk({ animate: arrange === 'now' });
  requestDraw();
}

/** Pack the desk with the designs the search found (all, with no search).
 *  A search that finds nothing leaves the desk as it was, faded. The
 *  designs glide to their new places while the view fits them. */
function arrangeDesk({ animate = true } = {}) {
  if (!state) return;
  clearTimeout(state.arrangeTimer);
  state.arrangeTimer = null;
  const ids = state.matches ? [...state.matches.keys()] : [...state.entries.keys()];
  if (!ids.length && state.arranged !== null) return;
  const shown = ids.length ? ids : [...state.entries.keys()];
  const key = [...shown].sort().join('\n');
  if (key === state.arranged) return;
  state.arranged = key;
  // The same designs always pack the same way: keep recent packings, so
  // stepping back (clearing the search) is immediate.
  let layout = state.layouts.get(key);
  // The whole workspace keeps its remembered places; what a search finds
  // packs tight.
  const whole = state.source === 'workspace' && !state.matches;
  if (!layout) {
    layout = placeDrawings(shown.map((id) => state.entries.get(id)), whole ? rememberedSlots(state.folder) : null);
    if (state.layouts.size >= 16) state.layouts.delete(state.layouts.keys().next().value);
  }
  if (whole) rememberSlots(state.folder, layout.slots);
  state.layouts.delete(key);
  state.layouts.set(key, layout);
  const from = new Map(state.tiles.map((tile) => [tile.id, shownTile(tile)]));
  state.tiles = layout.tiles;
  state.bounds = layout.bounds;
  const kept = new Set(layout.tiles.map((tile) => tile.id));
  if (state.selected && !kept.has(state.selected)) state.selected = null;
  const reduced = reducedMotion();
  if (!animate || reduced) {
    state.motion = null;
    if (animate) setView(fitAllView());
    requestDraw();
    return;
  }
  state.motion = { from, leaving: [...from.values()].filter((tile) => !kept.has(tile.id)), start: performance.now() };
  void animateView(clampView(fitAllView()), ARRANGE_MS);
}

/** Shift+T: pack the whole desk afresh, related designs together, forgetting
 *  where they sat. */
function repackDesk() {
  if (!state) return;
  rememberSlots(state.folder, null);
  state.layouts.clear();
  state.arranged = null;
  if (state.matches) clearSearch();
  arrangeDesk({ animate: true });
  logLine('Atlas: packed the desk afresh, related designs together (tags, names, links, parts)');
}

/** Search keys that act on what was found pack the desk first. */
function arrangePending() {
  if (state?.arrangeTimer) arrangeDesk();
}

/** How far the desk's current rearrangement has come, eased; 1 at rest. */
function motionProgress() {
  if (!state.motion) return 1;
  const t = Math.min(1, (performance.now() - state.motion.start) / ARRANGE_MS);
  return t * t * (3 - 2 * t);
}

/** Where a tile is drawn now: on its way from its old place mid-rearrangement. */
function shownTile(tile) {
  const from = state.motion?.from.get(tile.id);
  const t = from ? motionProgress() : 1;
  const placed = from ? { ...tile, x: from.x + (tile.x - from.x) * t, y: from.y + (tile.y - from.y) * t } : tile;
  return placed;
}

// ----- export ---------------------------------------------------------------------

/** Export: the designs on the desk -- what a search found, or all of them --
 *  as one sheet at their real sizes and places (atlas-sheet.js). */
function exportDesk() {
  if (!state) return;
  arrangePending();
  if (state.matches && !state.matches.size) {
    statusEl.textContent = 'No design matches the search: nothing to export';
    return;
  }
  const symbols = state.source === 'symbols';
  const items = state.tiles.map((tile) => {
    const entry = state.entries.get(tile.id);
    return { ...tile, svg: entry.svg, box: entry.box, caption: symbols ? '' : sheetCaption(entry.name, entry.index?.tags || []) };
  });
  if (!items.length) {
    statusEl.textContent = 'No designs to export';
    return;
  }
  const count = items.length;
  const query = lastQuery.trim();
  const summary = symbols
    ? 'The symbol reference sheet, on one page.'
    : `${state.matches ? `The ${count} design${count === 1 ? '' : 's'} found by “${query}”` : `All ${count} design${count === 1 ? '' : 's'}`}, at real size on one page.`;
  const generation = state.generation;
  exportAtlasSheet({
    name: symbols ? 'symbols' : `${titleEl.textContent}-atlas`,
    key: symbols ? 'atlas:symbols' : `atlas:${titleEl.title}`,
    summary,
    build: ({ grid }) => ({ ...atlasSheetSvg(items, { grid }), count }),
    onStatus: (text) => {
      if (state?.generation === generation) statusEl.textContent = text;
    },
  });
}

// ----- copy as image ----------------------------------------------------------------

/** The designs picked: the multi-pick with the picked one, else that one. */
function pickedIds() {
  const ids = new Set(state.picked || []);
  if (state.selected) ids.add(state.selected);
  return [...ids].filter((id) => state.tiles.some((tile) => tile.id === id));
}

/** Ctrl+Shift+C: the picked designs as one image on the clipboard, packed
 *  together at their real sizes with their captions, as the sheet export
 *  draws them -- to share a few designs at once. */
async function copyPickedAsImage() {
  if (!state || state.source !== 'workspace') return;
  const ids = pickedIds();
  if (!ids.length) {
    statusEl.textContent = 'Pick a design (Ctrl- or Shift-click for several), then Ctrl+Shift+C copies them';
    return;
  }
  const tiles = ids.map((id) => state.tiles.find((tile) => tile.id === id));
  const packed = layoutAtlas(tiles.map((tile) => ({ id: tile.id, w: tile.w, h: tile.h })));
  const items = packed.tiles.map((tile) => {
    const entry = state.entries.get(tile.id);
    return { ...tile, svg: entry.svg, box: entry.box, caption: sheetCaption(entry.name, entry.index?.tags || []) };
  });
  const { svg } = atlasSheetSvg(items);
  // A few designs at real size can be a large picture: keep it within what
  // a clipboard and a paste target handle.
  const { w, h } = packed.bounds;
  const scale = Math.min(2, 6000 / Math.max(w, h, 1));
  statusEl.textContent = `Copying ${ids.length} design${ids.length === 1 ? '' : 's'}…`;
  try {
    await writeDrawingToClipboard(svg, { scale });
    statusEl.textContent = `Copied ${ids.length} design${ids.length === 1 ? '' : 's'} as an image — paste into another app`;
  } catch (err) {
    statusEl.textContent = `Could not copy the image: ${err.message}`;
  }
}

// ----- tags ---------------------------------------------------------------------

/** A field at a design's caption (its tags, its new name): Enter commits
 *  what is typed, Escape or clicking away leaves things as they were. */
function openCaptionField(tile, { value, placeholder, label, commit }) {
  if (state.tagEditor) return;
  const rect = worldToScreen(tile);
  const pane = paneSize();
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'atlas-tags glass';
  input.value = value;
  input.placeholder = placeholder;
  input.setAttribute('aria-label', label);
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.style.left = `${Math.max(8, Math.min(rect.x, pane.w - 280))}px`;
  input.style.top = `${Math.max(56, Math.min(rect.y + rect.h + 6, pane.h - 80))}px`;
  rootEl.appendChild(input);
  state.tagEditor = input;
  input.focus();
  input.select();
  let closed = false;
  // Removing the field blurs it, which calls this again.
  const close = () => {
    if (closed) return;
    closed = true;
    input.remove();
    if (state?.tagEditor === input) state.tagEditor = null;
    rootEl.focus({ preventScroll: true });
  };
  input.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') {
      ev.preventDefault();
      const text = input.value;
      close();
      void commit(text);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      close();
    }
  });
  input.addEventListener('blur', close);
}

/** `#` on a picked design: its tags in a field at its caption. Enter saves
 *  them -- into the editor for the open design, straight into the file for
 *  any other. Several designs picked: tags typed are added to each. */
function openTagEditor(tile) {
  const entry = state.entries.get(tile.id);
  if (!entry) return;
  const many = pickedIds().map((id) => state.entries.get(id)).filter(Boolean);
  const adding = many.length > 1;
  openCaptionField(tile, {
    value: adding ? '' : tagsText(entry.index?.tags),
    placeholder: adding ? `tags to add to ${many.length} designs · Enter adds` : 'tags, separated by spaces · Enter saves',
    label: adding ? `Tags to add to ${many.length} designs` : `Tags of ${entry.name}`,
    commit: (text) => (adding ? addTags(many, text) : saveTags(entry, text)),
  });
}

/** F2 on a picked design: its name in a field at its caption. */
function openRenameField(tile) {
  const entry = state.entries.get(tile.id);
  if (!entry) return;
  openCaptionField(tile, {
    value: entry.name,
    placeholder: 'new name · Enter renames',
    label: `New name for ${entry.name}`,
    commit: async (text) => {
      const name = text.trim();
      if (!name || name === entry.name) return;
      const saved = await renameDesign(entry.path, name, entry.dir ? { dir: entry.dir } : {});
      if (state && saved) await reloadDesk({ quiet: true, pick: saved.path });
    },
  });
}

/** Delete the picked designs, after the editor's confirmation. */
async function deletePicked() {
  const entries = pickedIds().map((id) => state.entries.get(id)).filter(Boolean);
  if (!entries.length || state.source !== 'workspace') return;
  if (!(await deleteDocuments(entries.map((entry) => entry.path)))) return;
  state.picked = null;
  state.selected = null;
  if (state) await reloadDesk({ quiet: true });
}

/** A design's menu, as the editor's right-click menu: for one design Edit,
 *  Rename, Tags, Delete; for several picked ones only Tags and Delete. A
 *  design right-clicked outside the pick becomes the pick. */
function openDesignMenu(tile, clientX, clientY) {
  if (!state || state.source !== 'workspace' || !tile) return;
  if (!pickedIds().includes(tile.id)) {
    state.picked = null;
    state.selected = tile.id;
    requestDraw();
  }
  const entries = pickedIds().map((id) => state.entries.get(id)).filter(Boolean);
  if (!entries.length) return;
  const one = entries.length === 1;
  const menu = openMenuAt(clientX, clientY, one ? entries[0].name : `${entries.length} designs`);
  if (!menu) return;
  // A field opened from the menu waits for the menu to close (it takes focus back).
  const later = (run) => () => setTimeout(run, 0);
  const group = el('div', { class: 'context-menu-group' });
  if (one) {
    appendContextItem(group, 'Edit', later(() => void openTile(tile)), { shortcut: 'Enter' });
    appendContextItem(group, 'Rename…', later(() => openRenameField(tile)), { shortcut: 'F2' });
  }
  appendContextItem(group, one ? 'Tags…' : 'Add tags…', later(() => openTagEditor(tile)), { shortcut: '#' });
  const danger = el('div', { class: 'context-menu-group context-menu-end' });
  appendContextItem(danger, one ? 'Delete…' : `Delete ${entries.length} designs…`, later(() => void deletePicked()), { shortcut: 'Del', danger: true });
  menu.append(group, danger);
  menu.querySelector('button:not(:disabled)')?.focus();
}

/** Give a design new tags. Another design's file is rewritten with only its
 *  tags changed; its cached drawing moves to the new revision as it is. */
async function saveTags(entry, text) {
  const tags = parseTags(text);
  if (tagsText(tags) === tagsText(entry.index?.tags)) return;
  try {
    if (entry.current) {
      // The open design is saved with its new tags as any other would be:
      // whole when nothing else is unsaved, else only its tags go to the file.
      const clean = !hasUnsavedChanges();
      setDocumentTags(text);
      entry.index = designIndex(editor.circuit);
      if (!editor.currentDocumentPath) logLine(`${entry.name}: tags set; save the design to keep them`);
      else if (clean) await saveCircuit();
      else {
        editor.syncGeneration += 1;
        const data = await persistence.load(editor.currentDocumentPath);
        const document = { ...data.state };
        if (tags.length) document.tags = tags;
        else delete document.tags;
        const saved = await persistence.save({ path: editor.currentDocumentPath }, document, { overwrite: true });
        editor.lastSeenRevision = saved?.revision || null;
        editor.lastCircuitTag = saved?.etag || null;
        editor.syncGeneration += 1;
        logLine(`${entry.name}: ${tags.length ? tags.map((tag) => `#${tag}`).join(' ') : 'tags cleared'} (saved to the file; the design's other changes are still unsaved)`);
      }
    } else {
      const data = await persistence.load(entry.path);
      const document = { ...data.state };
      if (tags.length) document.tags = tags;
      else delete document.tags;
      const saved = await persistence.save({ path: entry.path }, document, { overwrite: true });
      const index = { ...(entry.index || designIndex(loadDocument(document))), tags };
      const revision = saved?.revision || null;
      if (revision) {
        await cachePut(renderingKey(entry.path, revision, DRAWING_CACHE), entry.svg);
        await cachePut(renderingKey(entry.path, revision, INDEX_CACHE), index);
        for (const level of ['small', 'large']) {
          const bitmap = state?.bitmaps.get(bitmapKey(entry, level));
          if (bitmap) state.bitmaps.set(`${entry.id}\n${revision}\n${theme()}\n${level}`, bitmap);
        }
      }
      entry.revision = revision;
      entry.modified = revisionTime(revision) ?? entry.modified;
      entry.index = index;
      logLine(`${entry.name}: ${tags.length ? tags.map((tag) => `#${tag}`).join(' ') : 'tags cleared'} (saved)`);
    }
  } catch (err) {
    logLine(`Could not tag ${entry.name}: ${err.message || err}`, 'error');
    return;
  }
  if (!state) return;
  applySearch(lastQuery);
  requestDraw();
}

/** Esc in the search: back to the desk with the search still on and a found
 *  design picked, so Enter opens it. */
function leaveSearch() {
  arrangePending();
  const tiles = navigableTiles();
  if (state.matches && tiles.length && !state.matches.has(state.selected)) focusTile(tiles[0]);
  rootEl.focus({ preventScroll: true });
  requestDraw();
}

/** Esc on the desk drops a search before it clears the pick. */
function clearSearch() {
  if (searchEl) searchEl.value = '';
  applySearch('', { arrange: 'now' });
}

/** The designs a search found, in desk order (or all, with no search). */
function navigableTiles() {
  return state.matches ? state.tiles.filter((tile) => state.matches.has(tile.id)) : state.tiles;
}

/** Enter in the search: the next (Shift: previous) design it found, zoomed
 *  to so its marks are readable. */
function stepMatch(step) {
  arrangePending();
  const tiles = navigableTiles();
  if (!tiles.length) return;
  const index = tiles.findIndex((tile) => tile.id === state.selected);
  const next = tiles[index < 0 ? (step > 0 ? 0 : tiles.length - 1) : (index + step + tiles.length) % tiles.length];
  focusTile(next, { zoom: true });
}

function focusSearch() {
  if (!searchEl || state?.source !== 'workspace') return;
  searchEl.focus();
  searchEl.select();
}

/** The editor's grid: one-unit lines every cell, fading out as the cells
 *  shrink to a few pixels instead of turning into a gray wash. */
function drawGrid(ctx, palette, w, h, { x, y } = state.view, k = scale()) {
  if (!editor.showGrid) return;
  const spacing = GRID * k;
  const alpha = Math.min(1, (spacing - 3) / 6);
  if (alpha <= 0) return;
  // Whole device pixels: a line straddling two pixels would antialias into
  // a fainter, wider one, and the grid would shimmer unevenly.
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(k * dpr));
  const offset = width % 2 ? 0.5 : 0;
  const crisp = (value) => (Math.round(value * dpr) + offset) / dpr;
  ctx.save();
  // A line thinner than a pixel shows as a fainter one-pixel line, as the
  // editor's one-unit grid does.
  ctx.globalAlpha *= alpha * Math.min(1, (k * dpr) / width);
  ctx.strokeStyle = palette.grid;
  ctx.lineWidth = width / dpr;
  ctx.beginPath();
  for (let gx = Math.ceil(x / GRID) * GRID; (gx - x) * k <= w; gx += GRID) {
    const sx = crisp((gx - x) * k);
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, h);
  }
  for (let gy = Math.ceil(y / GRID) * GRID; (gy - y) * k <= h; gy += GRID) {
    const sy = crisp((gy - y) * k);
    ctx.moveTo(0, sy);
    ctx.lineTo(w, sy);
  }
  ctx.stroke();
  ctx.restore();
}

/** Right-drag: the editor's dashed zoom box. */
function drawZoomBox(ctx, palette) {
  const box = state.drag?.zoomBox;
  if (!box?.to) return;
  const x = Math.min(box.from.x, box.to.x);
  const y = Math.min(box.from.y, box.to.y);
  const w = Math.abs(box.to.x - box.from.x);
  const h = Math.abs(box.to.y - box.from.y);
  ctx.save();
  ctx.fillStyle = palette.faint;
  ctx.globalAlpha = 0.12;
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = palette.faint;
  ctx.lineWidth = 1.4;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

function drawCaption(ctx, tile, entry, rect, palette) {
  // In a transition the desk shows only the drawings (state.quiet).
  if (state.source === 'symbols' || state.quiet) return;
  const selected = state.selected === tile.id || !!state.picked?.has(tile.id);
  const hovered = state.hover === tile.id;
  // The pick lifts the design on a card (drawCard); the hover is a faint
  // frame in the gap around a design lying flat, measured in drawing units,
  // so it scales with the zoom and never reaches a neighbor.
  const k = scale();
  const inset = ATLAS_GAP * 0.35 * k;
  // The caption may run on into the gap after its tile; its size follows
  // the caption band, so zoomed far out it gives way instead of crowding.
  const size = Math.min(13, ATLAS_CAPTION * k * 0.45);
  const captioned = size >= 7;
  // Frame and bracket take in the caption, so no line runs through it.
  const bottom = captioned ? rect.y + rect.h + size * 1.9 + inset * 0.6 : rect.y + rect.h + inset;
  if (hovered && !selected && liftOf(tile.id).lift < 0.01) {
    ctx.save();
    ctx.globalAlpha *= 0.3;
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = 1;
    ctx.strokeRect(rect.x - inset, rect.y - inset, rect.w + 2 * inset, bottom - rect.y + inset);
    ctx.restore();
  }
  if (!captioned) return;
  let room = (tile.w + ATLAS_GAP * 0.8) * k;
  let x = rect.x;
  const y = rect.y + rect.h + size * 0.6;
  // The open design -- where the editor returns to -- carries an Open badge before its
  // name, whichever design is picked or hovered.
  if (entry.current) {
    ctx.font = `700 ${size * 0.8}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    const pad = size * 0.4;
    const w = ctx.measureText('OPEN').width + 2 * pad;
    ctx.fillStyle = palette.accent;
    ctx.beginPath();
    ctx.roundRect(x, y - size * 0.1, w, size * 1.2, size * 0.3);
    ctx.fill();
    ctx.fillStyle = palette.paper;
    ctx.textBaseline = 'middle';
    ctx.fillText('OPEN', x + pad, y + size * 0.5);
    x += w + size * 0.45;
    room -= w + size * 0.45;
  }
  ctx.font = `${selected || entry.current ? 600 : 500} ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.fillStyle = selected || hovered || entry.current ? palette.text : palette.dim;
  ctx.textBaseline = 'top';
  const tags = entry.index?.tags?.length ? `   ${entry.index.tags.map((tag) => `#${tag}`).join(' ')}` : '';
  ctx.fillText(fitText(ctx, `${entry.name}${tags}`, room), x, y);
}

/** `text`, cut with an ellipsis to fit `width` pixels. */
function fitText(ctx, text, width) {
  if (ctx.measureText(text).width <= width) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= width) low = mid;
    else high = mid - 1;
  }
  return low ? `${text.slice(0, low)}…` : '';
}

/** Crisp vector drawings for the tiles that fill the screen. */
function syncVectorOverlays(list, moving = false) {
  const keep = new Set(list.map(({ tile }) => tile.id));
  for (const [id, el] of state.overlays) {
    if (keep.has(id)) continue;
    // Mid-animation the drawing only steps aside: it comes back when the
    // view settles, without parsing its SVG again.
    if (moving) {
      el.hidden = true;
      delete el.dataset.ready;
      continue;
    }
    el.remove();
    state.overlays.delete(id);
  }
  for (const { tile, rect } of list) {
    let el = state.overlays.get(tile.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'atlas-vector';
      const { svg: drawing } = state.entries.get(tile.id);
      el.innerHTML = theme() === 'dark' ? applyExportDarkTheme(drawing) : drawing;
      const svg = el.querySelector('svg');
      svg?.removeAttribute('width');
      svg?.removeAttribute('height');
      overlayEl.appendChild(el);
      state.overlays.set(tile.id, el);
      // Until the SVG has painted once, its image stands in for it.
      requestAnimationFrame(() => {
        el.dataset.ready = '1';
        requestDraw();
      });
    }
    if (el.hidden) {
      el.hidden = false;
      requestAnimationFrame(() => {
        el.dataset.ready = '1';
        requestDraw();
      });
    }
    // Lifted as its image is: grown about its center; dimmed with the rest.
    const { lift, dim, dx = 0, dy = 0 } = liftOf(tile.id);
    const grow = 1 + LIFT_GROW * lift;
    const k = scale();
    el.style.transformOrigin = 'center';
    el.style.transform = `translate(${rect.x + dx * k}px, ${rect.y + dy * k}px)${grow !== 1 ? ` scale(${grow})` : ''}`;
    el.style.width = `${rect.w}px`;
    el.style.height = `${rect.h}px`;
    const searched = state.matches && !state.matches.has(tile.id) ? 0.18 : 1;
    el.style.opacity = String(searched * (1 - 0.72 * dim));
  }
}

// ----- view motion -------------------------------------------------------------

function setView(view) {
  state.view = clampView(view);
  requestDraw();
}

/** Run `frame(t)` for t from 0 to 1 over `duration` ms, drawing after
 *  each; resolves when done or cut short (stopAnimation). */
function animate(duration, frame) {
  stopAnimation();
  if (reducedMotion() || duration <= 0 || state.hurry) {
    frame(1);
    requestDraw();
    return Promise.resolve();
  }
  const start = performance.now();
  const animation = { frame: 0, t: 0 };
  return new Promise((resolve) => {
    // One cut short (another flight, a wheel) still lets its waiter go on.
    animation.resolve = resolve;
    const step = (now) => {
      if (!state) { resolve(); return; }
      // Hurried (any input in a transition), it jumps to its end.
      const t = state.hurry ? 1 : Math.min(1, (now - start) / duration);
      animation.t = t;
      frame(t);
      draw();
      if (t < 1) animation.frame = requestAnimationFrame(step);
      else {
        if (state.animation === animation) state.animation = null;
        draw(); // settled: the live drawings return
        resolve();
      }
    };
    animation.frame = requestAnimationFrame(step);
    state.animation = animation;
  });
}

/** Animate the view to `target`. */
function animateView(target, duration = 320) {
  const from = { ...state.view };
  return animate(duration, (t) => { state.view = lerpView(from, target, t); });
}

/** Resolve after `count` frames: time for the editor behind to settle. */
function nextFrames(count) {
  return new Promise((resolve) => {
    const step = (left) => (left ? requestAnimationFrame(() => step(left - 1)) : resolve());
    step(count);
  });
}

function stopAnimation() {
  if (state?.animation) {
    cancelAnimationFrame(state.animation.frame);
    state.animation.resolve?.();
    state.animation = null;
  }
}

/** In a transition -- a design flying back from the editor, up into it, or
 *  up to another -- the desk takes no input: a key or a scroll then would
 *  cut the flight short and leave a design in flight. */
const inTransition = () => !!(state?.entering || state?.closing || state?.opening);

/**
 * Input never waits for a transition. A key, scroll, or click in one hurries
 * it: what is left of its flight (and the slides and warm-ups around it)
 * happens at once. The keys are kept and replayed where the transition
 * arrives -- on the desk once a design has landed, in the editor once one
 * has opened -- so typing ahead works as if there were no animation.
 */
function hurry() {
  if (!state || state.hurry) return;
  state.hurry = true;
  state.onHurry?.();
}

/** Resolves when the transition under way is hurried. */
function hurried() {
  if (!state || state.hurry) return Promise.resolve();
  return (state.hurryPromise ||= new Promise((resolve) => { state.onHurry = resolve; }));
}

/** The transition is over: input acts directly again. */
function settle() {
  if (!state) return;
  state.hurry = false;
  state.hurryPromise = null;
  state.onHurry = null;
}

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock']);

/** Whether a key pressed in a transition finishes it at once: Esc, or a
 *  key that starts an animation of its own where the transition is going
 *  -- on the desk opening, leaving, fitting, zooming, stepping, or packing
 *  it; in the editor fitting, or diving through a linked part. */
function hurries(ev) {
  const key = ev.key;
  if (key === 'Escape') return true;
  if (state.entering) {
    return ['Enter', 'Backspace', ' ', 'Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'f', 'F', 'z', 'Z', 'T'].includes(key);
  }
  return key === 'f' || key === 'F' || (ev.altKey && (key === 'ArrowUp' || key === 'ArrowDown'));
}

/** A key pressed in a transition, kept to replay where it arrives. */
function keepKey(ev) {
  if (ev.repeat || MODIFIER_KEYS.has(ev.key)) return;
  const { key, code, shiftKey, ctrlKey, metaKey, altKey } = ev;
  (state.queued ||= []).push({ key, code, shiftKey, ctrlKey, metaKey, altKey });
}

/** Shift+Backspace (Shift+Esc where the browser passes it on): the key
 *  between the editor and the Atlas, either way. */
const isAtlasToggle = (ev) => (ev.key === 'Backspace' || ev.key === 'Escape') && ev.shiftKey && !ev.ctrlKey && !ev.metaKey && !ev.altKey;

/**
 * The Atlas's key in a transition turns it around from where it is, rather
 * than finishing it and starting the way back: the design in flight
 * reverses (steer), or, not yet set off, does not go. The editor-to-Atlas
 * flight returns to the editor; a flight up to the editor returns to the
 * desk, a design being opened never let in. Pressed again, it turns once
 * more. Returns whether it turned (not with reduced motion, nor once a
 * design is already open behind the desk).
 */
function turnBack() {
  if (!state || reducedMotion() || state.committed) return false;
  // The way back is not hurried, and keys typed toward the other end are
  // forgotten.
  settle();
  state.queued = null;
  const flight = state.flight;
  if (state.entering) {
    if (!flight) return false;
    // Not flying yet: the editor's page never left the glass.
    if (flight.goal === undefined) finishClose({ animate: true });
    else steer(flight.goal === 0 ? 1 : 0);
    return true;
  }
  if (state.closing || state.opening) {
    // Not flying yet (the toolbars sliding away): it does not set off.
    if (!flight || flight.goal === undefined) state.turnBack = !state.turnBack;
    else steer(flight.goal === 1 ? 0 : 1);
    return true;
  }
  return false;
}

/** A flight up to the editor turned back has landed on the desk: the desk
 *  is as it was, its names and toolbars back. */
function stayOnDesk() {
  landFlight({ ripple: false });
  state.closing = false;
  state.opening = false;
  state.turnBack = false;
  settle();
  state.queued = null;
  state.quiet = false;
  void slideChrome(rootEl, false);
  requestDraw();
}

/** Press the kept keys on `target`, as typed. */
function replayKeys(target, keys) {
  for (const init of keys) target.dispatchEvent(new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true }));
}

function zoomAbout(factor, clientX, clientY) {
  stopAnimation();
  const anchor = clientToWorld(clientX, clientY);
  const view = state.view;
  const next = clampView({ ...view, w: view.w * factor, h: view.h * factor });
  const f = next.w / view.w;
  setView({ x: anchor.x - (anchor.x - view.x) * f, y: anchor.y - (anchor.y - view.y) * f, w: next.w, h: next.h });
}

function centerOf() {
  const box = rootEl.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

function tileById(id) {
  return state.tiles.find((tile) => tile.id === id) || null;
}

function focusTile(tile, { zoom = false } = {}) {
  state.selected = tile.id;
  const { w, h } = paneSize();
  if (zoom) {
    void animateView(viewFittingIn(tile, w, h, chromeInsets(), 0.1));
    return;
  }
  // Keep the pick and its caption in sight without changing the zoom,
  // moving only as far as that takes.
  const next = viewShowing(state.view, { ...tile, h: tile.h + ATLAS_CAPTION });
  if (next === state.view) requestDraw();
  else void animateView(next);
}

// ----- the flight between the desk and the screen ---------------------------
//
// The screen is a pane of glass and the desk lies some way behind it. The
// editor is a design brought right up to the glass; the Atlas is the desk,
// seen through it. Leaving the editor, the design flies back, away from the
// eye, on its sheet of paper -- the whole editor page, which narrows into the
// design's card as it goes -- and lands on its place on the desk, picked
// (floating a little above it), with a ripple of light. Opening a design
// carries its card on up to the glass, where the editor takes over. The desk
// itself hardly moves: it sinks into shadow and draws back a little while a
// design is near the eye (state.flight; throughDepth projects the path).

/** How far the desk draws back while a design is at the glass. */
const FLIGHT_PUSH = 0.1;
const RIPPLE_MS = 650;
/** The desk view left last in this page, per workspace: coming back from the
 *  editor, the design lands on the desk as it was left. */
let lastDesk = null;

const smoothstep = (t) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };

/** A screen rect grown about its center by `lift` (as a picked card is) and
 *  moved by `dx`, `dy` drawing units. */
function liftedBy(rect, lift, dx = 0, dy = 0) {
  const grow = 1 + LIFT_GROW * lift;
  const k = scale();
  return { x: rect.x + (rect.w * (1 - grow)) / 2 + dx * k, y: rect.y + (rect.h * (1 - grow)) / 2 + dy * k, w: rect.w * grow, h: rect.h * grow };
}

/** Where `rect` (desk units) shows on screen in `view`. */
function rectInView(rect, view) {
  const k = paneSize().w / view.w;
  return { x: (rect.x - view.x) * k, y: (rect.y - view.y) * k, w: rect.w * k, h: rect.h * k };
}

/** The view the desk rests at for a design landing on it: as it was left in
 *  this workspace (else the whole desk), moved as little as it takes to show
 *  the design's card. */
function restingView(tile) {
  const { w, h } = paneSize();
  let base = clampView(fitAllView());
  if (lastDesk?.folder === state.folder) {
    const v = lastDesk.view;
    base = clampView({ x: v.x, y: v.y + v.h / 2 - (v.w * h / w) / 2, w: v.w, h: v.w * h / w });
  }
  if (!tile) return base;
  const grow = LIFT_GROW / 2;
  const pad = ATLAS_GAP * 0.3;
  return viewShowing(base, { x: tile.x - tile.w * grow - pad, y: tile.y - tile.h * grow - pad, w: tile.w * (1 + LIFT_GROW) + 2 * pad, h: tile.h * (1 + LIFT_GROW) + 2 * pad + ATLAS_CAPTION });
}

function rememberDesk() {
  if (state?.source === 'workspace' && state.folder !== undefined) lastDesk = { folder: state.folder, view: { ...(state.flight?.rest || state.view) } };
}

/** The desk drawn back about `about` (a desk point) as far as `depth` asks. */
function pushedView(rest, depth, about) {
  const f = 1 + FLIGHT_PUSH * smoothstep(depth);
  return { x: about.x - (about.x - rest.x) * f, y: about.y - (about.y - rest.y) * f, w: rest.w * f, h: rest.h * f };
}

/** Lift `tile` off the desk toward the glass, where it will show at `screen`
 *  (screen pixels). It starts as it lies now. */
function startFlight(tile, screen) {
  const { lift, dx = 0, dy = 0 } = liftOf(tile.id);
  state.flight = {
    id: tile.id, depth: 0, screen, from: { lift, dx, dy },
    rest: { ...state.view }, about: { x: tile.x + tile.w / 2, y: tile.y + tile.h / 2 },
  };
}

/**
 * Fly the design toward `goal` (0 the desk, 1 the glass). Resolves with the
 * end it reaches: the goal, the other end when it was turned back on the
 * way (turnBack), or null when the desk went away meanwhile.
 */
function flyTo(goal) {
  const flight = state.flight;
  return new Promise((resolve) => {
    flight.arrive = resolve;
    steer(goal);
  });
}

/** Aim the flight at `goal` from wherever it is now: a flight turned back
 *  reverses from that point, in the time the distance left takes. */
function steer(goal) {
  const flight = state.flight;
  flight.goal = goal;
  const from = flight.depth;
  const duration = flightMs(flight) * Math.max(0.3, Math.min(1, Math.abs(goal - from)));
  const ease = goal === 0 ? settleEase : riseEase;
  void animate(duration, (t) => {
    if (state.flight !== flight) return;
    flight.depth = from + (goal - from) * ease(t);
    if (flight.rest) state.view = pushedView(flight.rest, flight.depth, flight.about);
  }).then(() => {
    // Steered again meanwhile, a newer aim answers.
    if (state?.flight === flight && flight.goal !== goal) return;
    flight.arrive?.(state?.flight === flight ? goal : null);
  });
}

/** How much nearer the eye the glass is than the desk, for the flight. */
function flightRatio(flight) {
  const tile = flight.id && tileById(flight.id);
  if (!tile) return 4;
  const k = paneSize().w / (flight.rest || state.view).w;
  return Math.max(1, flight.screen.w / (tile.w * k * (1 + LIFT_GROW * (flight.from?.lift ?? 1))));
}

/** A flight takes longer the farther it goes, so a long one does not rush. */
const flightMs = (flight) => Math.round(Math.min(650, 400 + 60 * Math.log2(flightRatio(flight))));

/** Away from the glass: it lets go gently, sweeps back, and settles onto the
 *  desk with a small bounce (a little past it, and back). */
function settleEase(t) {
  const x = t * t * (2 - t);
  const c = 1.1;
  return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2;
}

/** Up to the glass: straight up from where it floats, slowing into place. */
function riseEase(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** The design has landed: it lies picked on the desk, and the desk rings. */
function landFlight({ ripple = true } = {}) {
  const flight = state.flight;
  if (!flight) return;
  state.flight = null;
  if (flight.rest) state.view = flight.rest;
  if (flight.id) {
    state.lifts ||= new Map();
    const lift = flight.from?.lift ?? 1;
    state.lifts.set(flight.id, { lift, dim: 0, dx: flight.from?.dx || 0, dy: flight.from?.dy || 0, target: lift });
    if (ripple) state.ripple = { id: flight.id, at: performance.now() };
  }
  requestDraw();
}

/**
 * The design in flight, over the desk: the desk darkens behind it, and the
 * design rides on its sheet of paper -- the editor's page at the glass, its
 * card on the desk, its grid fading as it recedes -- casting a shadow that
 * spreads and softens the higher it is.
 */
function drawFlight(ctx, palette, w, h) {
  const flight = state.flight;
  const near = Math.max(0, Math.min(1, flight.depth));
  const dark = theme() === 'dark';
  const tile = flight.id ? tileById(flight.id) : null;
  const entry = tile && state.entries.get(tile.id);
  ctx.save();
  ctx.fillStyle = dark ? '#000' : 'rgb(20, 24, 34)';
  ctx.globalAlpha = (dark ? 0.62 : 0.32) * smoothstep(near);
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  const pane = { x: 0, y: 0, w, h };
  let design = null;
  let card;
  let ratio;
  if (tile) {
    const from = flight.from || { lift: 1, dx: 0, dy: 0 };
    const desk = liftedBy(worldToScreen(tile), from.lift, from.dx, from.dy);
    ratio = Math.max(1, flight.screen.w / desk.w);
    design = throughDepth(desk, flight.screen, flight.depth, ratio);
    card = cardFrame(desk);
  } else {
    // Bare paper (an unsaved or empty drawing) shrinks away into the desk.
    card = { x: w * 0.42, y: h * 0.42, w: w * 0.16, h: h * 0.16 };
    ratio = w / card.w;
  }
  const sheet = throughDepth(card, pane, flight.depth, ratio);
  const radius = cardRadius() * (1 - near);
  const alpha = tile ? 1 : smoothstep(near * 1.4);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = palette.card;
  ctx.shadowColor = palette.shadow;
  ctx.shadowBlur = 30 + 150 * near;
  ctx.shadowOffsetY = 10 + 80 * near;
  ctx.beginPath();
  ctx.roundRect(sheet.x, sheet.y, sheet.w, sheet.h, radius);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  // The editor's grid rides on the sheet, fixed to the drawing.
  let grid = null;
  if (design) {
    const k = design.w / tile.w;
    grid = { x: tile.x - design.x / k, y: tile.y - design.y / k, k };
  } else if (flight.grid) {
    const k = flight.grid.k * sheet.w / w;
    grid = { x: flight.grid.x - sheet.x / k, y: flight.grid.y - sheet.y / k, k };
  }
  if (grid) {
    ctx.save();
    ctx.clip();
    ctx.globalAlpha = alpha * smoothstep(near * 1.25);
    drawGrid(ctx, palette, w, h, grid, grid.k);
    ctx.restore();
  }
  if (design) {
    const bitmap = state.bitmaps.get(bitmapKey(entry, 'large')) || state.bitmaps.get(bitmapKey(entry, 'small'));
    if (bitmap) {
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, design.x, design.y, design.w, design.h);
    }
  }
  // In flight its edge catches the light, most of all midway.
  const glow = Math.sin(Math.PI * near) * (dark ? 0.55 : 0.35);
  if (glow > 0.01) {
    ctx.save();
    if (dark) ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha * glow;
    ctx.strokeStyle = palette.accent;
    ctx.shadowColor = palette.accent;
    ctx.shadowBlur = 24;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(sheet.x, sheet.y, sheet.w, sheet.h, radius);
    ctx.stroke();
    ctx.restore();
  }
  // The picked card's accent rim, there on the desk and gone at the glass.
  ctx.globalAlpha = alpha * 0.9 * (1 - smoothstep(near * 2));
  if (ctx.globalAlpha > 0.01) {
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = Math.max(0.5, Math.min(1.5, 3 * scale()));
    ctx.beginPath();
    ctx.roundRect(sheet.x, sheet.y, sheet.w, sheet.h, radius);
    ctx.stroke();
  }
  ctx.restore();
}

/** A landing's ripple: two rings of light run out across the desk from the
 *  card, lighting the grid as they pass. */
function drawRipple(ctx, palette) {
  const ripple = state.ripple;
  if (!ripple) return;
  const t = (performance.now() - ripple.at) / RIPPLE_MS;
  const tile = tileById(ripple.id);
  if (t >= 1 || !tile || reducedMotion()) {
    state.ripple = null;
    return;
  }
  requestDraw();
  const card = cardFrame(lifted(worldToScreen(tile), tile.id));
  const reach = 50 + 0.3 * Math.max(card.w, card.h);
  const { w, h } = paneSize();
  const dark = theme() === 'dark';
  const ring = (grow) => {
    const g = Math.max(0, grow);
    ctx.roundRect(card.x - g, card.y - g, card.w + 2 * g, card.h + 2 * g, cardRadius() + g);
  };
  ctx.save();
  if (dark) ctx.globalCompositeOperation = 'lighter';
  for (const [delay, weight] of [[0, 1], [0.2, 0.55]]) {
    const local = (t - delay) / (1 - delay);
    if (local <= 0) continue;
    const grow = reach * easeOutCubic(local);
    const fade = (1 - local) ** 2;
    // The grid lit in a band behind the ring.
    ctx.save();
    ctx.beginPath();
    ring(grow);
    ring(grow - 36);
    ctx.clip('evenodd');
    ctx.globalAlpha = weight * fade * (dark ? 0.9 : 0.6);
    drawGrid(ctx, { ...palette, grid: palette.accent }, w, h);
    ctx.restore();
    // The ring itself, glowing.
    ctx.globalAlpha = weight * fade * 0.7;
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = 1 + 4 * (1 - local);
    ctx.shadowColor = palette.accent;
    ctx.shadowBlur = 16 * (1 - local);
    ctx.beginPath();
    ring(grow);
    ctx.stroke();
  }
  ctx.restore();
}

// ----- entering and leaving ---------------------------------------------------------

function deskState(generation, source, startup = false) {
  return {
    generation, view: { x: 0, y: 0, w: 1, h: 1 }, entries: new Map(), tiles: [], bounds: { x: 0, y: 0, w: 0, h: 0 },
    bitmaps: new Map(), failed: new Set(), wanted: [], overlays: new Map(), baking: startup,
    selected: null, hover: null, drag: null, animation: null, colors: null, colorsKey: null, source,
    arranged: null, arrangeTimer: null, motion: null, layouts: new Map(),
    arrived: new Map(), flight: null, ripple: null, opening: false,
  };
}

/** Lay the desk out again from the document list, after another folder or
 *  more files were opened over it. Resolves false when the Atlas is closed. */
/** `quiet` (after a rename from the listing): the view, the pick (`pick`,
 *  an id), and the designs stay as they are, without a reveal. */
async function reloadDesk({ quiet = false, pick = null } = {}) {
  if (!state || state.source !== 'workspace') return false;
  stopAnimation();
  clearTimeout(state.arrangeTimer);
  for (const bitmap of state.bitmaps.values()) bitmap.close?.();
  overlayEl.replaceChildren();
  const generation = (openAtlas.generation += 1);
  state = { ...deskState(generation, 'workspace'), view: state.view };
  let ready = false;
  try {
    ready = await loadWorkspace(generation);
  } catch (err) {
    logLine(`Could not show the workspace: ${err.message}`, 'error');
  }
  if (!ready || !state || state.generation !== generation) return true;
  state.selected = (pick && tileById(pick)?.id) || state.tiles.find((tile) => state.entries.get(tile.id).current)?.id || null;
  showEmptyDesk();
  if (quiet) {
    state.revealAt = 0;
    requestDraw();
  } else if (!state.tiles.length) {
    requestDraw();
  } else {
    void animateView(clampView(fitAllView()));
  }
  return true;
}

/**
 * An empty desk asks what to do, rather than showing nothing. Browser-only
 * with no folder yet, it leads with the folder -- one folder for every
 * design is what makes saving quiet and the desk whole next time -- and
 * says up front when this browser cannot save in place. Else a new design,
 * a design file, or another folder (and the browser's permission again for
 * a folder it no longer may read), and back to the drawing on screen when it
 * has anything in it. The header's export and way back and the hint bar,
 * which have nothing to act on yet, step aside. Gone as soon as the desk has
 * a design.
 */
function showEmptyDesk() {
  rootEl.querySelector('.atlas-empty')?.remove();
  const empty = !!state && state.source === 'workspace' && !state.tiles.length;
  rootEl.classList.toggle('atlas-is-empty', empty);
  syncCheck();
  syncList();
  if (!empty) return;
  const folder = editor.workspaceState?.folder;
  const drawn = editor.circuit.components.size || editor.circuit.labels.size;
  const savesInPlace = typeof window.showDirectoryPicker === 'function';
  const button = (text, title, action, primary = false) => {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = text;
    node.title = title;
    if (primary) node.className = 'primary-action';
    node.addEventListener('click', () => void action());
    return node;
  };
  const box = document.createElement('div');
  box.className = 'atlas-empty glass';
  const heading = document.createElement('h2');
  const text = document.createElement('p');
  const actions = document.createElement('div');
  actions.className = 'atlas-empty-actions';
  const newButton = (primary) => button('New design', 'New design', newDesign, primary);
  const openButton = () => button('Open design…', 'Open (Ctrl/Cmd+O)', openDesign);
  const folderButton = (primary) => button(persistence.browserOnly ? 'Open folder…' : 'Change folder…', 'Workspace folder', () => openOntoDesk('folder'), primary);
  if (folder?.locked) {
    heading.textContent = `Allow access to “${folder.name}”`;
    text.textContent = 'The browser asks for permission on each visit.';
    actions.append(button(`Allow access to “${folder.name}”…`, 'Allow access', allowFolderAccess, true), newButton(false), folderButton(false));
  } else if (persistence.browserOnly && !folder) {
    heading.textContent = 'Keep your designs in one folder';
    titleEl.textContent = 'No folder yet';
    text.textContent = savesInPlace
      ? 'Each design is a .json file. Open a folder to keep them together; new designs save into it.'
      : 'Each design is a .json file. This browser can read a folder but not save into it, so Save downloads a copy. Chrome and Edge save in place.';
    actions.append(folderButton(true), newButton(false), openButton());
  } else {
    heading.textContent = folder?.name || !persistence.browserOnly ? `No designs in “${folder?.name || titleEl.textContent}” yet` : 'No designs open yet';
    text.textContent = persistence.browserOnly && !folder?.writable
      ? 'New designs download when saved: this browser cannot write to the folder.'
      : 'New designs save into this folder and lay out here.';
    actions.append(newButton(true), ...(persistence.browserOnly ? [openButton()] : []), folderButton(false));
  }
  box.append(heading, text, actions);
  if (drawn) {
    const back = document.createElement('p');
    back.className = 'atlas-empty-back';
    back.append(button(`Back to ${editor.currentCircuitName ? `“${editor.currentCircuitName}”` : 'the unsaved drawing'}`, 'Back to the editor (Shift+Backspace)', () => closeAtlas()));
    box.append(back);
  }
  statusEl.textContent = '';
  rootEl.append(box);
}

function newDesign() {
  if (state?.source !== 'workspace') return;
  requestDocumentAction('Starting a new circuit', () => {
    finishClose();
    startNewDocument();
  });
}

/** Open one design: browser-only files join the desk (and one opens
 *  straight away); with a server, the file dialog opens it in the editor. */
async function openDesign() {
  if (state?.source !== 'workspace') return;
  if (!persistence.browserOnly) {
    await closeAtlas();
    await openDocumentDialog();
    return;
  }
  const added = await addDocumentFiles();
  if (added && state?.tiles.length === 1) await openTile(state.tiles[0]);
  else rootEl.focus({ preventScroll: true });
}

/** The header's Folder and Open buttons (and Ctrl/Cmd+O): another
 *  workspace, or browser-only files from anywhere, onto the desk. */
async function openOntoDesk(kind) {
  if (state?.source !== 'workspace') return;
  if (kind === 'files' && persistence.browserOnly) await addDocumentFiles();
  else await chooseWorkspaceFolder();
  rootEl.focus({ preventScroll: true });
}

/** Shift+Backspace: step back from the drawing to the whole workspace. */
/** The Atlas borrows the editor's Settings while it is open (`on`) and
 *  hands them back: what is set once -- the theme, animations, scrolling --
 *  is set from either view, in the same place at the end of its top bar. */
function lendSettings(on) {
  if (!settingsEl || !settingsHome) return;
  for (const [button, menu] of toolbarMenus) closeToolbarMenu(button, menu);
  if (on) backEl.before(settingsEl);
  else if (settingsEl.parentElement !== settingsHome) {
    settingsHome.append(settingsEl);
    scheduleToolbarFit();
  }
}

export async function openAtlas({ source = 'workspace', animate = true, startup = false, focus = null } = {}) {
  if (state || !rootEl) return;
  const generation = (openAtlas.generation = (openAtlas.generation || 0) + 1);
  state = deskState(generation, source, startup);
  // Until it has landed and its toolbars are back (inTransition).
  state.entering = true;
  if (hintEl) hintEl.textContent = HINTS[source];
  state.hintKey = null;
  if (newCircuitEl) newCircuitEl.hidden = source !== 'workspace';
  if (openFolderEl) {
    openFolderEl.hidden = source !== 'workspace';
    openFolderEl.title = persistence.browserOnly ? 'Workspace folder' : 'Workspace folder (Ctrl/Cmd+O)';
  }
  // Node mode opens single files in the editor; browser-only mode can add
  // files from anywhere to the desk.
  if (openFilesEl) openFilesEl.hidden = source !== 'workspace' || !persistence.browserOnly;
  if (linksEl) linksEl.hidden = source !== 'workspace';
  if (searchEl) {
    searchEl.hidden = source !== 'workspace';
    searchEl.value = source === 'workspace' ? lastQuery : '';
  }
  // With reduced motion the design does not fly back: the desk is laid
  // out unseen, then fades in over the editor (style.css .atlas.preparing).
  // Startup keeps its own cover and reveal. The class goes on before the
  // desk shows: focusing it restyles at once, and a visible first style
  // would fade out and back in.
  const reduced = reducedMotion();
  // A transition the user starts runs in three steps: the editor's toolbars
  // slide away, the design flies, the Atlas's slide in (chrome-slide.js).
  // On startup the editor's are simply not there yet.
  const choreographed = !reduced && !startup && animate;
  // From here until the editor is back, its toolbars and panels stand above
  // the desk and its drawing shows only itself (style.css body.chrome-over):
  // the focus hairline and selection go first.
  document.body.classList.add('chrome-over');
  // Flying the open design back, the desk takes the drawing's place
  // unseen and the toolbars slide off over it (openDesk); otherwise they go
  // before the desk shows.
  const overDesk = choreographed && source === 'workspace';
  if (!overDesk) await Promise.race([slideChrome(document.body, true, { animate: choreographed }), hurried()]);
  if (state?.generation !== generation) return;
  // Settings move over once the editor's toolbar is off screen: unseen.
  if (!overDesk) lendSettings(true);
  void slideChrome(rootEl, choreographed, { animate: false });
  state.quiet = choreographed;
  if (reduced && !startup) rootEl.classList.add('preparing');
  // Flying the open design back, the desk shows only once it has drawn
  // that design: fading in over the editor without it, the design would
  // blink out for a moment (see openDesk).
  const bridging = !reduced && !startup && animate && source === 'workspace';
  if (bridging) {
    rootEl.style.animation = 'none';
    rootEl.classList.add('preparing');
  }
  // On startup the cover's fade is the reveal: a fade of the desk's own
  // under it would let the editor's drawing show through both.
  if (startup) rootEl.style.animation = 'none';
  rootEl.hidden = false;
  rootEl.classList.remove('leaving', 'passing');
  rootEl.focus({ preventScroll: true });
  if (reduced && !startup) {
    try {
      await openDesk(generation, source, false, false);
      focusNamed(generation, focus);
      // The designs appear together, not one by one as they decode, and the
      // desk's own fade stands in for the others' reveal around the open one.
      if (state?.generation === generation && state.tiles.length) await warmSmallImages(generation, 400);
      if (state?.generation === generation) state.revealAt = 0;
    } finally {
      requestAnimationFrame(() => rootEl.classList.remove('preparing'));
      if (state?.generation === generation) state.entering = false;
    }
    return;
  }
  try {
    await openDesk(generation, source, animate, startup);
    if (state?.generation !== generation) return;
    focusNamed(generation, focus);
    // Landed: the names and the pick come back with the toolbars, and the
    // desk takes input at once -- first the keys typed on the way.
    state.quiet = false;
    requestDraw();
    state.entering = false;
    settle();
    const keys = state.queued || [];
    state.queued = null;
    void slideChrome(rootEl, false);
    replayKeys(rootEl, keys);
  } finally {
    if (state?.generation === generation) {
      state.entering = false;
      settle();
    }
  }
}

/** Pick the design called `name` and zoom to it (a linked part's "Show in
 *  the Atlas"). */
function focusNamed(generation, name) {
  if (!name || state?.generation !== generation) return;
  const key = String(name).toLowerCase();
  const tile = state.tiles.find((candidate) => state.entries.get(candidate.id)?.name?.toLowerCase() === key);
  if (tile) focusTile(tile, { zoom: true });
}

/** Lay out the desk just opened and bring it into view. */
async function openDesk(generation, source, animate, startup) {
  if (source === 'workspace' && animate && !startup) {
    showOpenDesign();
    await Promise.race([bakeOpenDesign(250), hurried()]);
    if (!state || state.generation !== generation) return;
    // Now the desk can fade in over the editor: the same design, in place.
    rootEl.classList.remove('preparing');
    rootEl.style.animation = '';
    draw();
    // The editor's toolbars slide off over it; the flight waits for them.
    state.editorAway = slideChrome(document.body, true).then(() => { if (state?.generation === generation) lendSettings(true); });
  }
  let ready = false;
  try {
    ready = source === 'symbols' ? loadSymbols() : await loadWorkspace(generation);
  } catch (err) {
    logLine(`Could not show the workspace: ${err.message}`, 'error');
  }
  if (!ready || !state) {
    closeAtlas({ animate: false });
    return;
  }
  showEmptyDesk();
  const currentTile = state.tiles.find((tile) => state.entries.get(tile.id).current);
  // The open design starts picked; otherwise nothing is until you choose.
  state.selected = source === 'symbols' ? null : currentTile?.id || null;
  if (!state.tiles.length) {
    // An empty desk shows its own card: the paper stays where it is.
    state.flight = null;
    if (!state.fromEditor) state.view = { x: -500, y: -500, w: 1000, h: 1000 * paneSize().h / paneSize().w };
    requestDraw();
    return;
  }
  if (startup) {
    const target = clampView(fitAllView());
    await prepareStartupImages(generation, target);
    if (!state || state.generation !== generation) return;
    state.baking = false;
    // Start farther out around the same center, then approach the fitted desk.
    const factor = 1.8;
    state.view = clampView({
      x: target.x - target.w * (factor - 1) / 2,
      y: target.y - target.h * (factor - 1) / 2,
      w: target.w * factor, h: target.h * factor,
    });
    // The designs assemble as the camera settles.
    state.revealAt = performance.now();
    draw();
    await Promise.race([Promise.all([revealStartup(), animateView(target, 760)]), hurried()]);
  } else if (state.fromEditor) {
    // The design flies back from the glass and lands on its place on the
    // desk, which rests as it was left; the other designs appear around it,
    // nearest first, as its page uncovers them.
    const openTile = state.tiles.find((tile) => state.entries.get(tile.id)?.current) || null;
    const flight = state.flight;
    flight.id = openTile?.id ?? null;
    // Drawn from its file now, its box may differ from the editor's copy
    // the desk first showed: it still starts exactly where the editor has it.
    const openEntry = openTile && state.entries.get(openTile.id);
    const exact = openEntry && editorEquivalentView(openTile, openEntry);
    if (exact) flight.screen = rectInView(openTile, exact);
    flight.rest = restingView(openTile);
    flight.about = openTile ? { x: openTile.x + openTile.w / 2, y: openTile.y + openTile.h / 2 } : { x: flight.rest.x + flight.rest.w / 2, y: flight.rest.y + flight.rest.h / 2 };
    state.view = pushedView(flight.rest, 1, flight.about);
    draw();
    // Decode the small images first, while the page still covers the desk:
    // decoding in the middle of the flight would stall its frames.
    await Promise.race([Promise.all([warmSmallImages(generation, 400), state.editorAway]), hurried()]);
    if (!state || state.generation !== generation) return;
    state.revealFrom = flight.about;
    state.revealAt = performance.now() + 140;
    const reached = await flyTo(0);
    if (!state || state.generation !== generation) return;
    // Turned back on the way (turnBack): at the glass again, the editor's.
    if (reached === 1) {
      finishClose({ animate: true });
      return;
    }
    landFlight();
  } else {
    setView(fitAllView());
  }
}

/** Draw the open design's images (it is drawn live, never cached), for at
 *  most `budget` ms: the desk fades in with the design already on it. */
async function bakeOpenDesign(budget) {
  const entry = state.tiles.map((tile) => state.entries.get(tile.id)).find((candidate) => candidate?.current);
  if (!entry) return;
  const jobs = ['small', 'large'].map(async (level) => {
    const key = bitmapKey(entry, level);
    if (state.bitmaps.has(key)) return;
    const bitmap = await bake(entry, level).catch(() => null);
    if (bitmap && state && !state.bitmaps.has(key)) state.bitmaps.set(key, bitmap);
  });
  await Promise.race([Promise.allSettled(jobs), new Promise((resolve) => setTimeout(resolve, budget))]);
}

/** Put the open design on the desk at once, exactly where the editor shows
 *  it, before the rest of the workspace has loaded. */
function showOpenDesign() {
  const path = editor.currentDocumentPath;
  const saved = openDesignAsSaved();
  const svg = drawingSvg(saved);
  const box = viewBoxOf(svg);
  // Without a design to carry over, start from the editor's own view of
  // the paper: the grid lines stay put and the desk grows out of them.
  const view = editorEquivalentView({ x: 0, y: 0 }, { box: { x: 0, y: 0 } });
  if (!view) return;
  state.view = view;
  state.fromEditor = true;
  // The editor's page, at the glass, ready to fly back (drawFlight).
  const { w, h } = paneSize();
  state.flight = { id: null, depth: 1, screen: { x: 0, y: 0, w, h }, grid: { x: view.x, y: view.y, k: w / view.w } };
  if (path && box && svg !== EMPTY_SVG) {
    const entry = { id: path, name: editor.currentCircuitName || '', path, revision: null, current: true, svg, box, index: designIndex(saved) };
    state.entries = new Map([[path, entry]]);
    state.tiles = [{ id: path, x: box.x, y: box.y, w: box.w, h: box.h }];
    state.bounds = { ...box };
    state.flight.id = path;
    state.flight.screen = rectInView(box, view);
  }
  draw();
}

/** Leave for the editor. The open design flies up to the glass, into its place. */
export async function closeAtlas({ animate = true } = {}) {
  if (!state || state.closing) return;
  state.closing = true;
  clearTimeout(state.arrangeTimer);
  const currentTile = state.tiles.find((tile) => state.entries.get(tile.id)?.current);
  // With reduced motion the desk just fades from where it is.
  const reduced = reducedMotion();
  const back = animate && !reduced && currentTile && editorEquivalentView(currentTile, state.entries.get(currentTile.id));
  if (back) {
    state.quiet = true;
    requestDraw();
    await Promise.race([slideChrome(rootEl, true), hurried()]);
    if (!state) return;
    if (state.turnBack) {
      stayOnDesk();
      return;
    }
    startFlight(currentTile, rectInView(currentTile, back));
    const reached = await flyTo(1);
    if (!state) return;
    // Turned back on the way: it lands on the desk again.
    if (reached === 0) {
      stayOnDesk();
      return;
    }
  }
  finishClose({ animate: !!back });
}

/** Hand back to the editor; its toolbars slide in (at once without
 *  `animate`). */
function finishClose({ animate = true } = {}) {
  if (!state) return;
  rememberDesk();
  stopAnimation();
  clearTimeout(state.arrangeTimer);
  for (const bitmap of state.bitmaps.values()) bitmap.close?.();
  // The keys typed on the way go to the editor (an Enter would only open
  // what has just opened), once whatever follows the close has run.
  const keys = (state.queued || []).filter((init) => init.key !== 'Enter');
  state = null;
  if (keys.length) setTimeout(() => { if (!state) replayKeys(canvasEl, keys); });
  // From here the editor takes the pointer, though the desk still shows,
  // and its Settings go back to its toolbar to slide in with it.
  rootEl.classList.add('passing');
  lendSettings(false);
  overlayEl.replaceChildren();
  rootEl.querySelector('.atlas-empty')?.remove();
  rootEl.style.animation = '';
  canvasEl.focus({ preventScroll: true });
  // The editor's toolbars slide back in over the desk; then the desk gives
  // way to the editor beneath, the same drawing in the same place. A short
  // fade covers what differs between a tile and the live canvas (the grid,
  // pin dots); with reduced motion it is the whole transition. Reopened
  // meanwhile, the Atlas keeps its desk.
  void slideChrome(document.body, false, { animate }).then(() => {
    if (state) return;
    rootEl.classList.add('leaving');
    setTimeout(() => {
      if (state) return;
      rootEl.hidden = true;
      rootEl.classList.remove('leaving', 'passing');
      document.body.classList.remove('chrome-over');
    }, LEAVE_MS);
  });
}

/** Leave the desk at once, for something that starts in the editor (a
 *  tutorial from Learn): no flight back, as New does. */
export function leaveAtlasNow() {
  if (state) finishClose();
}

export function toggleAtlas() {
  if (state) void closeAtlas();
  else void openAtlas();
}

/** Learn → Symbols → full sheet (and `:symbols`): every symbol, in the Atlas viewer. */
export function toggleSymbolSheet() {
  if (state) void closeAtlas();
  else void openAtlas({ source: 'symbols' });
}

/** Open `tile`'s design. What the search found in it becomes the
 *  selection there, or the parts `select` names (the workspace check's). */
async function openTile(tile, { select = null } = {}) {
  clearTimeout(state.arrangeTimer);
  if (state.source === 'symbols') {
    focusTile(tile, { zoom: true });
    return;
  }
  const entry = state.entries.get(tile.id);
  state.selected = tile.id;
  const hits = select ? select.map((id) => ({ kind: 'part', id })) : state.matches?.get(tile.id)?.hits || [];
  const found = select ? `${select.join(', ')} selected: ${select.length === 1 ? 'its link is' : 'their links are'} broken · right-click, Link to design` : null;
  if (entry.current) {
    await closeAtlas();
    selectHits(hits, found);
    return;
  }
  if (state.opening) return;
  const generation = state.generation;
  const reduced = reducedMotion();
  // The header keeps naming the design it came from until the Atlas is gone.
  state.opening = true;
  const landed = () => state?.generation === generation;
  let opened;
  if (reduced) {
    // No flight: the design opens behind the desk, and the desk fades away.
    opened = await openDocumentPath(entry.path);
  } else if (hasUnsavedChanges()) {
    // The discard prompt comes first; the flight follows the answer. Once
    // the design is open, there is no turning back to the desk.
    opened = await openDocumentPath(entry.path);
    if (landed()) state.committed = !!opened;
    if (opened) await nextFrames(2);
    if (opened && landed()) {
      const exact = editorEquivalentView(tile, entry);
      if (exact) {
        state.quiet = true;
        requestDraw();
        await Promise.race([slideChrome(rootEl, true), hurried()]);
        startFlight(tile, rectInView(tile, exact));
        await flyTo(1);
      }
    }
  } else {
    // Read the file while the design flies up to where the editor will fit
    // it -- the tile is that drawing with one cell of export padding -- and
    // let it in only once the flight lands, so loading never costs the
    // flight a frame. A page guide can widen the fit: then the last stretch
    // glides to the real place.
    let land;
    const gate = new Promise((resolve) => { land = resolve; });
    const loading = openDocumentPath(entry.path, { gate });
    const pad = DRAWING_EXPORT_OPTIONS.padding;
    const predicted = editorEquivalentView(tile, entry, fittedView({
      x: entry.box.x + pad, y: entry.box.y + pad, w: entry.box.w - 2 * pad, h: entry.box.h - 2 * pad,
    }));
    let reached = 1;
    if (predicted) {
      state.quiet = true;
      requestDraw();
      await Promise.race([slideChrome(rootEl, true), hurried()]);
      if (landed() && !state.turnBack) {
        startFlight(tile, rectInView(tile, predicted));
        reached = await flyTo(1);
      }
    }
    // Turned back on the way (or before it set off): the file read meanwhile
    // is never let in, and the design lands on the desk again.
    if (!landed() || state.turnBack || reached !== 1) {
      land(false);
      await loading;
      if (landed()) stayOnDesk();
      return;
    }
    land(true);
    opened = await loading;
    // Let the editor measure its labels and fit to them before the last look.
    if (opened) await nextFrames(2);
    if (opened && landed() && state.flight) {
      const exact = editorEquivalentView(tile, entry);
      if (exact && predicted && Math.abs(exact.w - predicted.w) + Math.abs(exact.x - predicted.x) + Math.abs(exact.y - predicted.y) > 0.5) {
        const flight = state.flight;
        const from = flight.screen;
        const to = rectInView(tile, exact);
        await animate(200, (t) => {
          const e = easeOutCubic(t);
          flight.screen = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, w: from.w + (to.w - from.w) * e, h: from.h + (to.h - from.h) * e };
        });
      }
    }
  }
  if (!landed()) return;
  state.opening = false;
  if (!opened) {
    // Staying on the desk: the design sinks back to it.
    if (state.flight && !reduced) {
      await flyTo(0);
      if (!landed()) return;
    }
    stayOnDesk();
    return;
  }
  finishClose({ animate: !reduced });
  selectHits(hits, found);
}

/** What the search found in the design just opened becomes the selection. */
function selectHits(hits, message = null) {
  if (!hits.length) return;
  const circuit = editor.circuit;
  const parts = hits.filter((hit) => hit.kind === 'part' && circuit.components.has(hit.id)).map((hit) => hit.id);
  const labels = hits.filter((hit) => hit.kind === 'text' && circuit.labels.has(hit.id)).map((hit) => hit.id);
  const nets = hits.filter((hit) => hit.kind === 'net' && circuit.nets.has(hit.id)).map((hit) => hit.id);
  setSelection(parts);
  setLabelSelection(labels, undefined, true);
  editor.selectedNets = new Set(nets);
  logLine(message || `${hits.length} match${hits.length === 1 ? '' : 'es'} for "${lastQuery.trim()}" selected`);
  render();
}

// ----- input --------------------------------------------------------------------------

export function onAtlasKey(ev) {
  if (!state) return;
  // The export dialog (and its folder picker) over the desk types its own keys.
  if (ev.target.closest?.('dialog')) return;
  // A header button keeps focus after a click (or a dialog it opened hands
  // it back): it takes the keys that press or leave it, the desk the rest.
  if (ev.target.closest?.('.atlas-head button, .atlas-empty button') && (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Tab')) return;
  // An open menu (Settings) takes its own keys: arrows, and Esc to close it.
  if (ev.target.closest?.('[role="menu"]') || toolbarMenus.some(([, menu]) => !menu.hidden)) return;
  if (inTransition()) {
    ev.preventDefault();
    if (MODIFIER_KEYS.has(ev.key)) return;
    // The Atlas's own key turns a transition around; Esc, or a key that
    // starts another animation where it is going, finishes it at once; any
    // other key waits for it. Each acts where it arrives (keepKey).
    if (isAtlasToggle(ev) && !ev.repeat && turnBack()) return;
    if (hurries(ev)) hurry();
    keepKey(ev);
    return;
  }
  const key = ev.key;
  const arrows = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
  const selected = state.selected && tileById(state.selected);
  if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && key.toLowerCase() === 'c') void copyPickedAsImage();
  // Esc takes things back one at a time and never leaves: the pick of
  // several, then a search, then the pick (and its link arrows) itself.
  else if (key === 'Escape' && state.picked?.size) {
    state.picked = null;
    requestDraw();
  } else if (key === '/' || ((ev.ctrlKey || ev.metaKey) && key.toLowerCase() === 'f')) focusSearch();
  // Learn opens over the desk as it does over the drawing.
  else if (key === '?') showHelp();
  else if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && !ev.altKey && key.toLowerCase() === 'e') exportDesk();
  else if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && !ev.altKey && key.toLowerCase() === 'o' && state.source === 'workspace') void openOntoDesk('files');
  else if (key === 'Escape' && state.matches) clearSearch();
  // The symbol sheet is a reference glanced at: Esc closes it.
  else if (key === 'Escape' && state.source === 'symbols') void closeAtlas();
  else if (key === 'Escape') {
    state.selected = null;
    requestDraw();
  } else if (key === 'Backspace') void closeAtlas();
  // Enter opens the picked design; with none picked, back to the editor.
  else if (key === 'Enter') void (selected ? openTile(selected) : closeAtlas());
  else if (arrows[key]) {
    // While a search is on, the arrows and Tab move among what it found.
    const tiles = navigableTiles();
    const next = selected && tiles.includes(selected) ? neighborTile(tiles, selected, arrows[key]) : tiles[0];
    if (next) focusTile(next);
  } else if (key === 'Tab' && navigableTiles().length) {
    const tiles = navigableTiles();
    const index = selected ? tiles.indexOf(selected) : -1;
    const step = ev.shiftKey ? -1 : 1;
    focusTile(tiles[(index + step + tiles.length) % tiles.length]);
  } else if (key === '#' && selected && state.source === 'workspace') openTagEditor(selected);
  else if (key === 'F2' && selected && state.source === 'workspace' && !state.picked?.size) openRenameField(selected);
  else if (key === 'Delete' && selected && state.source === 'workspace') void deletePicked();
  else if ((key === 'z' || key === ' ') && selected) focusTile(selected, { zoom: true });
  else if (key === 'f' || key === 'F') void animateView(clampView(fitAllView()));
  else if (key === 'T' && state.source === 'workspace') repackDesk();
  else if (key === 'L' && state.source === 'workspace') toggleList();
  else if (key === 'l' && state.source === 'workspace') toggleLinks();
  else if (key === '+' || key === '=') zoomAbout(1 / 1.5, centerOf().x, centerOf().y);
  else if (key === '-' || key === '_') zoomAbout(1.5, centerOf().x, centerOf().y);
  else if (key === 'D' || (key === 'd' && ev.shiftKey)) toggleTheme();
  else return;
  ev.preventDefault();
}

function onWheel(ev) {
  // A menu or the listing over the desk scrolls itself.
  if (ev.target.closest?.('.toolbar-menu')) return;
  ev.preventDefault();
  if (!state) return;
  if (inTransition()) {
    hurry();
    return;
  }
  stopAnimation();
  const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1;
  if (wheelIntent(ev, editor.scrollScheme) === 'pan') {
    const k = scale();
    setView({ ...state.view, x: state.view.x + (ev.deltaX * unit) / k, y: state.view.y + (ev.deltaY * unit) / k });
    return;
  }
  // Zooming rescales every frame: images only, until the wheel rests.
  state.wheelAt = performance.now();
  clearTimeout(state.wheelSettle);
  state.wheelSettle = setTimeout(requestDraw, WHEEL_SETTLE_MS + 10);
  // The editor's zoom rates: pinch arrives as a ctrl-wheel with small deltas.
  zoomAbout(Math.pow(ev.ctrlKey && editor.scrollScheme === 'trackpad' ? 1.01 : 1.0016, ev.deltaY * unit), ev.clientX, ev.clientY);
}

function onPointerDown(ev) {
  // The header, tag editor, and an empty desk's prompt take their own clicks.
  if (!state || ev.target.closest?.('.atlas-head, .atlas-tags, .atlas-empty')) return;
  if (inTransition()) {
    hurry();
    return;
  }
  if (ev.button === 2) {
    ev.preventDefault();
    stopAnimation();
    rootEl.setPointerCapture?.(ev.pointerId);
    const box = rootEl.getBoundingClientRect();
    state.drag = { zoomBox: { from: { x: ev.clientX - box.left, y: ev.clientY - box.top }, to: null } };
    return;
  }
  if (ev.button !== 0 && ev.button !== 1) return;
  ev.preventDefault();
  stopAnimation();
  rootEl.setPointerCapture?.(ev.pointerId);
  const pointers = state.pointers || (state.pointers = new Map());
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  state.drag = { startX: ev.clientX, startY: ev.clientY, view: { ...state.view }, moved: false, pinch: pointers.size === 2 ? pinchOf(pointers) : null };
}

function pinchOf(pointers) {
  const [a, b] = [...pointers.values()];
  return { distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, view: { ...state.view } };
}

function onPointerMove(ev) {
  if (!state) return;
  state.pointers?.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  const drag = state.drag;
  if (drag?.zoomBox) {
    const box = rootEl.getBoundingClientRect();
    const to = { x: ev.clientX - box.left, y: ev.clientY - box.top };
    const { from } = drag.zoomBox;
    drag.zoomBox.to = Math.hypot(to.x - from.x, to.y - from.y) >= 4 ? to : null;
    requestDraw();
    return;
  }
  if (!drag) {
    const hit = tileUnder(clientToWorld(ev.clientX, ev.clientY));
    const hover = hit?.id || null;
    if (hover !== state.hover) {
      state.hover = hover;
      rootEl.style.cursor = hover ? 'pointer' : '';
      requestDraw();
    }
    return;
  }
  if (drag.pinch && state.pointers.size === 2) {
    const now = pinchOf(state.pointers);
    const factor = drag.pinch.distance / now.distance;
    const k = paneSize().w / drag.pinch.view.w;
    const box = rootEl.getBoundingClientRect();
    const anchor = { x: drag.pinch.view.x + (drag.pinch.mid.x - box.left) / k, y: drag.pinch.view.y + (drag.pinch.mid.y - box.top) / k };
    const w = drag.pinch.view.w * factor;
    const h = drag.pinch.view.h * factor;
    const k2 = paneSize().w / w;
    setView({ x: anchor.x - (now.mid.x - box.left) / k2, y: anchor.y - (now.mid.y - box.top) / k2, w, h });
    drag.moved = true;
    return;
  }
  const dx = ev.clientX - drag.startX;
  const dy = ev.clientY - drag.startY;
  if (!drag.moved && Math.hypot(dx, dy) < 4) return;
  drag.moved = true;
  rootEl.classList.add('panning');
  const k = paneSize().w / drag.view.w;
  setView({ ...drag.view, x: drag.view.x - dx / k, y: drag.view.y - dy / k });
}

function onPointerUp(ev) {
  if (!state) return;
  const drag = state.drag;
  if (drag?.zoomBox) {
    state.drag = null;
    const { from, to } = drag.zoomBox;
    if (!to) {
      // A right click (no box dragged) on a design: its menu.
      const hit = tileUnder(clientToWorld(ev.clientX, ev.clientY));
      if (hit) openDesignMenu(hit, ev.clientX, ev.clientY);
      requestDraw();
      return;
    }
    // Zoom to the box, as the editor does, keeping the pane's shape.
    const k = scale();
    const rect = {
      x: state.view.x + Math.min(from.x, to.x) / k, y: state.view.y + Math.min(from.y, to.y) / k,
      w: Math.abs(to.x - from.x) / k, h: Math.abs(to.y - from.y) / k,
    };
    const pane = paneSize();
    void animateView(clampView(viewFitting(rect, pane.w, pane.h, 0.02)));
    return;
  }
  state.pointers?.delete(ev.pointerId);
  if (state.pointers?.size) {
    // One finger of a pinch lifted: carry on panning with the other.
    const [rest] = state.pointers.values();
    state.drag = { startX: rest.x, startY: rest.y, view: { ...state.view }, moved: true, pinch: null };
    return;
  }
  state.drag = null;
  rootEl.classList.remove('panning');
  if (!drag || drag.moved || ev.button !== 0) return;
  const hit = tileUnder(clientToWorld(ev.clientX, ev.clientY));
  // Ctrl- or Shift-click adds a design to the pick or takes it out; a plain
  // click picks one.
  if ((ev.ctrlKey || ev.metaKey || ev.shiftKey) && hit && state.source === 'workspace') {
    state.picked ||= new Set();
    if (state.selected && state.selected !== hit.id) state.picked.add(state.selected);
    if (state.picked.has(hit.id)) {
      state.picked.delete(hit.id);
      state.selected = [...state.picked].at(-1) || null;
    } else {
      state.picked.add(hit.id);
      state.selected = hit.id;
    }
    const count = pickedIds().length;
    statusEl.textContent = `${count} design${count === 1 ? '' : 's'} picked · Ctrl+Shift+C copies ${count === 1 ? 'it' : 'them'} as an image`;
  } else {
    state.picked = null;
    state.selected = hit?.id || null;
  }
  requestDraw();
}

function onDoubleClick(ev) {
  if (!state || inTransition() || ev.target.closest?.('.atlas-empty')) return;
  const hit = tileUnder(clientToWorld(ev.clientX, ev.clientY));
  if (hit) void openTile(hit);
}

export function installAtlas() {
  // A new accent shows on the desk at once (the pick's rim, the link beams).
  onAccentChange(() => { if (state) requestDraw(); });
  if (!rootEl) return;
  // The check runs afresh each time its menu opens (before the menu does:
  // a capture listener on the button itself goes first).
  checkEl?.addEventListener('click', () => { if (state) syncCheck(); }, { capture: true });
  listEl?.addEventListener('click', () => { if (state) syncList(); }, { capture: true });
  // Capture: before the menus' own arrow keys (toolbar-ui.js).
  listPanelEl?.addEventListener('keydown', onListKey, { capture: true });
  rootEl.addEventListener('wheel', onWheel, { passive: false });
  rootEl.addEventListener('pointerdown', onPointerDown);
  rootEl.addEventListener('pointermove', onPointerMove);
  rootEl.addEventListener('pointerup', onPointerUp);
  rootEl.addEventListener('pointercancel', onPointerUp);
  rootEl.addEventListener('dblclick', onDoubleClick);
  rootEl.addEventListener('contextmenu', (ev) => ev.preventDefault());
  rootEl.addEventListener('pointerleave', () => {
    if (state && state.hover) {
      state.hover = null;
      requestDraw();
    }
  });
  window.addEventListener('resize', () => {
    if (!state) return;
    state.pane = null;
    const { w, h } = paneSize();
    setView({ ...state.view, h: (state.view.w * h) / w });
  });
  backEl?.addEventListener('click', () => void closeAtlas());
  document.getElementById('atlas-mark')?.addEventListener('click', () => void closeAtlas());
  document.getElementById('app-mark')?.addEventListener('click', () => void openAtlas());
  document.getElementById('btn-atlas')?.addEventListener('click', () => void openAtlas());
  exportEl?.addEventListener('click', exportDesk);
  linksEl?.addEventListener('click', toggleLinks);
  syncLinksButton();
  // A click on a header button leaves the keys with the desk (and a dialog
  // it opens hands them back there); Tab still reaches the buttons.
  rootEl.querySelector('.atlas-head')?.addEventListener('mousedown', (ev) => {
    if (ev.target.closest('button')) ev.preventDefault();
  });
  openFolderEl?.addEventListener('click', () => void openOntoDesk('folder'));
  openFilesEl?.addEventListener('click', () => void openOntoDesk('files'));
  onDocumentListChange(reloadDesk);
  newCircuitEl?.addEventListener('click', newDesign);
  searchEl?.addEventListener('input', () => applySearch(searchEl.value));
  // The highlighter marks show only while the search box has focus.
  searchEl?.addEventListener('focus', () => requestDraw());
  searchEl?.addEventListener('blur', () => requestDraw());
  searchEl?.addEventListener('keydown', (ev) => {
    // The desk's own keys (z, f, arrows) are text here.
    ev.stopPropagation();
    if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === 'e') {
      ev.preventDefault();
      exportDesk();
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      stepMatch(ev.shiftKey ? -1 : 1);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      leaveSearch();
    } else if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      rootEl.focus({ preventScroll: true });
      stepMatch(1);
    }
  });
  document.getElementById('btn-symbols')?.addEventListener('click', () => void openAtlas({ source: 'symbols' }));
  // The theme flips inside a view transition, a frame after the key.
  new MutationObserver(() => requestDraw()).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
}
