/**
 * The Atlas view: every design in the workspace laid out at its real
 * size on one zoomable desk. It is a viewing mode, not a file picker -- no
 * tools, only looking: pan and zoom as in the editor, pick a design, open it.
 *
 * Drawing follows a map viewer. One canvas paints every tile from baked
 * images (a small one and a large one per design, kept in IndexedDB by file
 * revision), so a hundred designs pan as smoothly as one. The few tiles that
 * fill the screen get their live SVG on top, crisp at any zoom. Entering and
 * leaving zoom between the editor's view and the design's tile, which works
 * because a tile is the drawing at its real size.
 */

import { loadDocument } from '../core/document.js';
import { svgString } from '../core/render.js';
import { designIndex, parseTags, searchDesign, tagsText } from '../core/design-index.js';
import { DRAWING_EXPORT_OPTIONS } from '../core/selection-drawing.js';
import { symbolSheet } from '../core/symbol-sheet.js';
import { GRID } from '../core/grid.js';
import { applyExportDarkTheme, withEmbeddedMathFont } from './drawing-export.js';
import { ATLAS_CAPTION, ATLAS_GAP, LARGE_PX, SMALL_PX, layoutAtlas, neighbourTile, rectsIntersect, tileAt, tileDetail, viewFitting } from './atlas-layout.js';
import { cacheGet, cachePut, renderingKey, trimCache } from './atlas-cache.js';
import { wheelIntent, lerpView } from './gestures.js';
import { editor } from './editor-state.js';
import { persistence, openDocumentPath } from './document-session.js';
import { toggleTheme } from './toolbar-ui.js';
import { logLine } from './status-bar-ui.js';
import { canvasEl } from './elements.js';
import { render, setLabelSelection, setSelection } from './main.js';
import { setDocumentTags } from './tags-ui.js';

const rootEl = document.getElementById('atlas');
const deskEl = document.getElementById('atlas-desk');
const overlayEl = document.getElementById('atlas-overlays');
const titleEl = document.getElementById('atlas-title');
const statusEl = document.getElementById('atlas-status');
const hintEl = document.getElementById('atlas-hint');
const searchEl = document.getElementById('atlas-search');

/** The workspace search outlives one visit, so a design found, opened, and
 *  left can be followed by the next match. Session state only. */
let lastQuery = '';

const HINTS = {
  workspace: 'Drag or scroll to move · right-drag zooms to a box · click picks · double-click or Enter opens · / or Ctrl+F searches · # tags · Z zooms to it · F fits all · Esc clears the search, then returns',
  symbols: 'Every symbol, drawn from the registry as it is now · drag or scroll to move · right-drag zooms to a box · F fits all · Esc returns',
};

/** Live SVGs at most at once; the rest stay on their large images. */
const MAX_VECTOR_TILES = 6;
/** Large images decoded at once (each is up to ~6 MB of pixels). */
const MAX_LARGE_BITMAPS = 24;
const ZOOM_IN_PX_PER_UNIT = 3; // the editor's closest zoom: 120 px per grid cell
const ENTER_MS = 650;
const REVEAL_MS = 350;
/** A wheel zoom counts as motion until the wheel has been still this long. */
const WHEEL_SETTLE_MS = 150;
const OPEN_MS = 450;

let state = null;

export function atlasOpen() {
  return !!state;
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
function editorEquivalentView(tile, entry) {
  const pane = document.querySelector('.canvas-pane')?.getBoundingClientRect();
  const view = editor.view;
  if (!pane || !view?.w) return null;
  const k = pane.width / view.w;
  const root = rootEl.getBoundingClientRect();
  const dx = tile.x - entry.box.x;
  const dy = tile.y - entry.box.y;
  const { w, h } = paneSize();
  return { x: view.x + dx - (pane.left - root.left) / k, y: view.y + dy - (pane.top - root.top) / k, w: w / k, h: h / k };
}

function fitAllView() {
  const { w, h } = paneSize();
  return viewFitting({ ...state.bounds, h: state.bounds.h + ATLAS_CAPTION }, w, h, 0.05);
}

// ----- the drawings -------------------------------------------------------------

const cellFloor = (value) => Math.floor(value / GRID) * GRID;
const cellCeil = (value) => Math.ceil(value / GRID) * GRID;

/** Pack the designs by the whole grid cells they cover, then shift each
 *  drawing by whole cells into its slot: its grid lines continue the desk's.
 *  A tile is the drawing's rectangle on the desk. */
function placeDrawings(entries) {
  const cells = new Map(entries.map((entry) => {
    const x = cellFloor(entry.box.x);
    const y = cellFloor(entry.box.y);
    return [entry.id, { x, y, w: cellCeil(entry.box.x + entry.box.w) - x, h: cellCeil(entry.box.y + entry.box.h) - y }];
  }));
  const boxes = new Map(entries.map((entry) => [entry.id, entry.box]));
  const layout = layoutAtlas(entries.map((entry) => ({ id: entry.id, w: cells.get(entry.id).w, h: cells.get(entry.id).h })));
  const tiles = layout.tiles.map((slot) => {
    const box = boxes.get(slot.id);
    const cell = cells.get(slot.id);
    return { id: slot.id, x: box.x + slot.x - cell.x, y: box.y + slot.y - cell.y, w: box.w, h: box.h };
  });
  return { tiles, bounds: layout.bounds };
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
async function drawingFor(documentInfo, current) {
  if (current) return { svg: drawingSvg(editor.circuit), index: designIndex(editor.circuit), revision: null };
  const key = documentInfo.revision && renderingKey(documentInfo.path, documentInfo.revision, 'svg-v3');
  const indexKey = documentInfo.revision && renderingKey(documentInfo.path, documentInfo.revision, 'index-v1');
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
  titleEl.textContent = folder.split(/[\\/]/).filter(Boolean).pop() || 'Workspace';
  titleEl.title = folder;
  const documents = (workspace.documents || []).filter((doc) => doc.kind === 'circuit');
  const entries = [];
  for (const [index, doc] of documents.entries()) {
    const current = doc.path === editor.currentDocumentPath;
    try {
      const { svg, index, revision } = current && state.entries.get(doc.path) || await drawingFor(doc, current);
      const box = viewBoxOf(svg);
      if (box) entries.push({ id: doc.path, name: doc.name, path: doc.path, revision, current, svg, box, index });
    } catch (err) {
      logLine(`Atlas: could not draw ${doc.name}: ${err.message}`, 'error');
    }
    if (!state || state.generation !== generation) return false;
    if (index % 4 === 3) {
      statusEl.textContent = `Drawing ${index + 1} of ${documents.length}…`;
      await new Promise((resolve) => setTimeout(resolve));
    }
  }
  const { tiles, bounds } = placeDrawings(entries);
  // The open design stayed on screen while the rest loaded: move the view
  // with it to its place in the layout, so it does not jump. Without one
  // (an unsaved or empty design) the view is bare paper and grid, so it can
  // move by whole cells to the middle of the desk unseen.
  const provisional = state.tiles[0];
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
  state.entries = new Map(entries.map((entry) => [entry.id, entry]));
  state.tiles = tiles;
  state.bounds = bounds;
  state.revealAt = performance.now();
  statusEl.textContent = `${entries.length} design${entries.length === 1 ? '' : 's'}`;
  applySearch(lastQuery);
  void trimCache();
  return true;
}

// ----- baked images --------------------------------------------------------------

function theme() {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
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
  const cacheKey = entry.revision && renderingKey(entry.path, entry.revision, `${theme()}-${level}-v3`);
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
  // The open design is drawn live, never cached: bake both its images now,
  // so the zoom out can show them instead of its live drawing.
  const current = state.tiles.map((tile) => state.entries.get(tile.id)).find((entry) => entry.current);
  const baking = current ? ['small', 'large'].map(async (level) => {
    const key = bitmapKey(current, level);
    if (!state.bitmaps.has(key)) state.bitmaps.set(key, await bake(current, level));
  }) : [];
  const loads = state.tiles.map(async (tile) => {
    const entry = state.entries.get(tile.id);
    const key = bitmapKey(entry, 'small');
    if (!entry.revision || state.bitmaps.has(key)) return;
    const blob = await cacheGet(renderingKey(entry.path, entry.revision, `${theme()}-small-v3`));
    if (!blob || !state || state.generation !== generation) return;
    state.bitmaps.set(key, await createImageBitmap(blob));
  });
  await Promise.race([Promise.allSettled([...baking, ...loads]), new Promise((resolve) => setTimeout(resolve, budget))]);
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
    accent: read('--accent', '#1a56db'),
  };
}

function draw() {
  const { w, h } = paneSize();
  const dpr = window.devicePixelRatio || 1;
  if (deskEl.width !== Math.round(w * dpr) || deskEl.height !== Math.round(h * dpr)) {
    deskEl.width = Math.round(w * dpr);
    deskEl.height = Math.round(h * dpr);
  }
  const ctx = deskEl.getContext('2d');
  // A theme change repaints everything: the palette, and the live SVGs.
  if (state.colorsTheme !== theme()) {
    state.colors = colors();
    state.colorsTheme = theme();
    overlayEl.replaceChildren();
    state.overlays.clear();
  }
  const palette = state.colors;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = palette.paper;
  ctx.fillRect(0, 0, w, h);
  drawGrid(ctx, palette, w, h);

  const screen = { x: state.view.x, y: state.view.y, w: state.view.w, h: state.view.h };
  const visible = state.tiles.filter((tile) => rectsIntersect(screen, { ...tile, h: tile.h + ATLAS_CAPTION }));
  const wanted = [];
  const centre = { x: state.view.x + state.view.w / 2, y: state.view.y + state.view.h / 2 };
  const placed = visible.map((tile) => {
    const rect = worldToScreen(tile);
    return { tile, rect, detail: tileDetail(Math.max(rect.w, rect.h) * dpr) };
  });
  // The tiles that fill the screen are drawn live; their images would only
  // blur the vector lines through the transparent paper. Not while the view
  // animates, though: a live SVG changing size is redrawn whole every frame.
  const moving = !!state.animation || performance.now() - (state.wheelAt || 0) < WHEEL_SETTLE_MS;
  const vector = moving ? [] : placed.filter((item) => item.detail === 'vector')
    .sort((a, b) => b.rect.w * b.rect.h - a.rect.w * a.rect.h)
    .slice(0, MAX_VECTOR_TILES);
  const live = new Set(vector.map((item) => item.tile.id));
  const reveal = state.revealAt ? Math.min(1, (performance.now() - state.revealAt) / REVEAL_MS) : 1;
  if (reveal < 1) requestDraw();
  for (const { tile, rect, detail } of placed) {
    const entry = state.entries.get(tile.id);
    const found = state.matches?.get(tile.id);
    // A search fades every design it does not find; what it finds in one is
    // marked under the drawing, like a highlighter.
    const fade = state.matches && !found ? 0.18 : 1;
    if (found?.hits.length) drawHits(ctx, tile, entry, found.hits, palette);
    ctx.globalAlpha = (entry.current ? 1 : reveal) * fade;
    const level = detail === 'small' ? 'small' : 'large';
    const bitmap = state.bitmaps.get(bitmapKey(entry, level)) ||
      state.bitmaps.get(bitmapKey(entry, level === 'large' ? 'small' : 'large'));
    if (bitmap && !(live.has(tile.id) && state.overlays.get(tile.id)?.dataset.ready)) {
      // Best filtering at rest; in motion the cheap one, which no one sees.
      ctx.imageSmoothingQuality = moving ? 'low' : 'high';
      ctx.drawImage(bitmap, rect.x, rect.y, rect.w, rect.h);
    }
    const distance = Math.hypot(tile.x + tile.w / 2 - centre.x, tile.y + tile.h / 2 - centre.y);
    // Mid-animation only small images are fetched: decoding a large one
    // would drop frames, and the view does not rest here anyway.
    for (const need of level === 'large' && !moving ? ['small', 'large'] : ['small']) {
      const key = bitmapKey(entry, need);
      if (!state.bitmaps.has(key)) wanted.push({ entry, level: need, key, distance });
    }
    drawCaption(ctx, tile, entry, rect, palette);
  }
  ctx.globalAlpha = 1;
  drawZoomBox(ctx, palette);
  // Every small image first (the whole desk becomes recognizable), then large.
  wanted.sort((a, b) => (a.level === b.level ? a.distance - b.distance : a.level === 'small' ? -1 : 1));
  state.wanted = wanted;
  void pump();
  syncVectorOverlays(vector, moving);
}

/** A search's hits in one design: a translucent mark under each. */
function drawHits(ctx, tile, entry, hits, palette) {
  const dx = tile.x - entry.box.x;
  const dy = tile.y - entry.box.y;
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = palette.accent;
  for (const hit of hits) {
    for (const b of hit.boxes) {
      const rect = worldToScreen({ x: b.x + dx, y: b.y + dy, w: b.w, h: b.h });
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    }
  }
  ctx.restore();
}

// ----- search ---------------------------------------------------------------

/** Search the designs for `query` (core/design-index.js); an empty query
 *  shows every design again. */
function applySearch(query) {
  if (!state || state.source !== 'workspace') return;
  lastQuery = query;
  const text = query.trim();
  if (!text) {
    state.matches = null;
    statusEl.textContent = `${state.tiles.length} design${state.tiles.length === 1 ? '' : 's'}`;
    for (const el of state.overlays.values()) el.style.opacity = '';
    requestDraw();
    return;
  }
  state.matches = new Map();
  for (const tile of state.tiles) {
    const entry = state.entries.get(tile.id);
    const found = searchDesign(entry.index, entry.name, text);
    if (found) state.matches.set(tile.id, found);
  }
  const count = state.matches.size;
  statusEl.textContent = count
    ? `${count} of ${state.tiles.length} design${state.tiles.length === 1 ? '' : 's'} · Enter steps through them`
    : 'No design matches';
  for (const [id, el] of state.overlays) el.style.opacity = state.matches.has(id) ? '' : '0.18';
  // One design left is the one being looked for: pick it, so Esc and Enter
  // open it.
  if (count === 1) {
    const only = tileById([...state.matches.keys()][0]);
    if (only && state.selected !== only.id) focusTile(only);
  }
  requestDraw();
}

// ----- tags ---------------------------------------------------------------------

/** `#` on a picked design: its tags in a field at its caption. Enter saves
 *  them -- into the editor for the open design, straight into the file for
 *  any other -- and Escape or clicking away leaves them as they were. */
function openTagEditor(tile) {
  const entry = state.entries.get(tile.id);
  if (!entry || state.tagEditor) return;
  const rect = worldToScreen(tile);
  const pane = paneSize();
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'atlas-tags glass';
  input.value = tagsText(entry.index?.tags);
  input.placeholder = 'tags, separated by spaces · Enter saves';
  input.setAttribute('aria-label', `Tags of ${entry.name}`);
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
      void saveTags(entry, text);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      close();
    }
  });
  input.addEventListener('blur', close);
}

/** Give a design new tags. Another design's file is rewritten with only its
 *  tags changed; its cached drawing moves to the new revision as it is. */
async function saveTags(entry, text) {
  const tags = parseTags(text);
  if (tagsText(tags) === tagsText(entry.index?.tags)) return;
  try {
    if (entry.current) {
      setDocumentTags(text);
      entry.index = designIndex(editor.circuit);
    } else {
      const data = await persistence.load(entry.path);
      const document = { ...data.state };
      if (tags.length) document.tags = tags;
      else delete document.tags;
      const saved = await persistence.save({ path: entry.path }, document, { overwrite: true });
      const index = { ...(entry.index || designIndex(loadDocument(document))), tags };
      const revision = saved?.revision || null;
      if (revision) {
        await cachePut(renderingKey(entry.path, revision, 'svg-v3'), entry.svg);
        await cachePut(renderingKey(entry.path, revision, 'index-v1'), index);
        for (const level of ['small', 'large']) {
          const bitmap = state?.bitmaps.get(bitmapKey(entry, level));
          if (bitmap) state.bitmaps.set(`${entry.id}\n${revision}\n${theme()}\n${level}`, bitmap);
        }
      }
      entry.revision = revision;
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
  const tiles = navigableTiles();
  if (state.matches && tiles.length && !state.matches.has(state.selected)) focusTile(tiles[0]);
  rootEl.focus({ preventScroll: true });
  requestDraw();
}

/** Esc on the desk drops a search before it leaves the Atlas. */
function clearSearch() {
  if (searchEl) searchEl.value = '';
  applySearch('');
}

/** The designs a search found, in desk order (or all, with no search). */
function navigableTiles() {
  return state.matches ? state.tiles.filter((tile) => state.matches.has(tile.id)) : state.tiles;
}

/** Enter in the search: the next (Shift: previous) design it found, zoomed
 *  to so its marks are readable. */
function stepMatch(step) {
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
 *  shrink to a few pixels instead of turning into a grey wash. */
function drawGrid(ctx, palette, w, h) {
  if (!editor.showGrid) return;
  const k = scale();
  const spacing = GRID * k;
  const alpha = Math.min(1, (spacing - 3) / 6);
  if (alpha <= 0) return;
  const { x, y } = state.view;
  // Whole device pixels: a line straddling two pixels would antialias into
  // a fainter, wider one, and the grid would shimmer unevenly.
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(k * dpr));
  const offset = width % 2 ? 0.5 : 0;
  const crisp = (value) => (Math.round(value * dpr) + offset) / dpr;
  ctx.save();
  // A line thinner than a pixel shows as a fainter one-pixel line, as the
  // editor's one-unit grid does.
  ctx.globalAlpha = alpha * Math.min(1, (k * dpr) / width);
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
  if (state.source === 'symbols') return;
  const selected = state.selected === tile.id;
  const hovered = state.hover === tile.id;
  // The pick is a corner bracket hugging the design's top-left corner, the
  // hover a faint frame. Both sit in the gap around the design, measured in
  // drawing units, so they scale with the zoom and never reach a neighbour.
  const k = scale();
  const inset = ATLAS_GAP * 0.35 * k;
  if (hovered && !selected) {
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = 1;
    ctx.strokeRect(rect.x - inset, rect.y - inset, rect.w + 2 * inset, rect.h + 2 * inset);
    ctx.restore();
  }
  if (selected) {
    const arm = Math.min(ATLAS_GAP * 1.5, Math.min(tile.w, tile.h) * 0.25) * k;
    ctx.save();
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = Math.max(1, Math.min(2.5, inset * 0.6));
    ctx.lineCap = 'square';
    ctx.beginPath();
    ctx.moveTo(rect.x - inset, rect.y - inset + arm);
    ctx.lineTo(rect.x - inset, rect.y - inset);
    ctx.lineTo(rect.x - inset + arm, rect.y - inset);
    ctx.stroke();
    ctx.restore();
  }
  // The caption may run on into the gap after its tile; its size follows
  // the caption band, so zoomed far out it gives way instead of crowding.
  const size = Math.min(13, ATLAS_CAPTION * k * 0.45);
  if (size < 7) return;
  const room = (tile.w + ATLAS_GAP * 0.8) * k;
  const marker = entry.current ? '● ' : '';
  ctx.font = `${selected ? 600 : 500} ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.fillStyle = selected || hovered ? palette.text : palette.dim;
  ctx.textBaseline = 'top';
  const tags = entry.index?.tags?.length ? `   ${entry.index.tags.map((tag) => `#${tag}`).join(' ')}` : '';
  ctx.fillText(fitText(ctx, `${marker}${entry.name}${tags}`, room), rect.x, rect.y + rect.h + size * 0.6);
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
      if (state.matches && !state.matches.has(tile.id)) el.style.opacity = '0.18';
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
    el.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
    el.style.width = `${rect.w}px`;
    el.style.height = `${rect.h}px`;
  }
}

// ----- view motion -------------------------------------------------------------

function setView(view) {
  state.view = clampView(view);
  requestDraw();
}

function animateView(target, duration = 320) {
  if (state.animation) cancelAnimationFrame(state.animation.frame);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || duration <= 0) {
    setView(target);
    return Promise.resolve();
  }
  const from = { ...state.view };
  const start = performance.now();
  return new Promise((resolve) => {
    const step = (now) => {
      if (!state) { resolve(); return; }
      const t = Math.min(1, (now - start) / duration);
      state.view = lerpView(from, target, t);
      draw();
      if (t < 1) state.animation = { frame: requestAnimationFrame(step) };
      else {
        state.animation = null;
        draw(); // settled: the live drawings return
        resolve();
      }
    };
    state.animation = { frame: requestAnimationFrame(step) };
  });
}

function stopAnimation() {
  if (state?.animation) {
    cancelAnimationFrame(state.animation.frame);
    state.animation = null;
  }
}

function zoomAbout(factor, clientX, clientY) {
  stopAnimation();
  const anchor = clientToWorld(clientX, clientY);
  const view = state.view;
  const next = clampView({ ...view, w: view.w * factor, h: view.h * factor });
  const f = next.w / view.w;
  setView({ x: anchor.x - (anchor.x - view.x) * f, y: anchor.y - (anchor.y - view.y) * f, w: next.w, h: next.h });
}

function centreOf() {
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
    void animateView(viewFitting(tile, w, h, 0.1));
    return;
  }
  // Keep the pick in sight without changing the zoom.
  const view = state.view;
  const margin = 0.1;
  const inside = tile.x >= view.x + view.w * margin && tile.x + tile.w <= view.x + view.w * (1 - margin) &&
    tile.y >= view.y + view.h * margin && tile.y + tile.h <= view.y + view.h * (1 - margin);
  if (inside) requestDraw();
  else void animateView({ ...view, x: tile.x + tile.w / 2 - view.w / 2, y: tile.y + tile.h / 2 - view.h / 2 });
}

// ----- entering and leaving ---------------------------------------------------------

/** Shift+Backspace: step back from the drawing to the whole workspace. */
export async function openAtlas({ source = 'workspace' } = {}) {
  if (state || !rootEl) return;
  const generation = (openAtlas.generation = (openAtlas.generation || 0) + 1);
  state = {
    generation, view: { x: 0, y: 0, w: 1, h: 1 }, entries: new Map(), tiles: [], bounds: { x: 0, y: 0, w: 0, h: 0 },
    bitmaps: new Map(), failed: new Set(), wanted: [], overlays: new Map(), baking: false,
    selected: null, hover: null, drag: null, animation: null, colors: null, colorsTheme: null, source,
  };
  if (hintEl) hintEl.textContent = HINTS[source];
  if (searchEl) {
    searchEl.hidden = source !== 'workspace';
    searchEl.value = source === 'workspace' ? lastQuery : '';
  }
  rootEl.hidden = false;
  rootEl.classList.remove('leaving');
  rootEl.focus({ preventScroll: true });
  if (source === 'workspace') showOpenDesign();
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
  if (!state.tiles.length) {
    statusEl.textContent = 'No designs in the workspace yet. Esc returns to the editor.';
  }
  const currentTile = state.tiles.find((tile) => state.entries.get(tile.id).current);
  // The open design starts picked; otherwise nothing is until you choose.
  state.selected = source === 'symbols' ? null : currentTile?.id || null;
  if (!state.tiles.length) {
    if (!state.fromEditor) state.view = { x: -500, y: -500, w: 1000, h: 1000 * paneSize().h / paneSize().w };
    requestDraw();
    return;
  }
  if (state.fromEditor) {
    draw();
    // Decode the small images first, while the view still matches the
    // editor: decoding in the middle of the zoom would stall its frames.
    await warmSmallImages(generation, 400);
    if (!state || state.generation !== generation) return;
    await animateView(clampView(fitAllView()), ENTER_MS);
  } else {
    setView(fitAllView());
  }
}

/** Put the open design on the desk at once, exactly where the editor shows
 *  it, before the rest of the workspace has loaded. */
function showOpenDesign() {
  const path = editor.currentDocumentPath;
  const svg = drawingSvg(editor.circuit);
  const box = viewBoxOf(svg);
  // Without a design to carry over, start from the editor's own view of
  // the paper: the grid lines stay put and the desk grows out of them.
  const view = editorEquivalentView({ x: 0, y: 0 }, { box: { x: 0, y: 0 } });
  if (!view) return;
  state.view = view;
  state.fromEditor = true;
  if (path && box && svg !== EMPTY_SVG) {
    const entry = { id: path, name: editor.currentCircuitName || '', path, revision: null, current: true, svg, box, index: designIndex(editor.circuit) };
    state.entries = new Map([[path, entry]]);
    state.tiles = [{ id: path, x: box.x, y: box.y, w: box.w, h: box.h }];
    state.bounds = { ...box };
  }
  draw();
}

/** Leave for the editor. The open design zooms back into place. */
export async function closeAtlas({ animate = true } = {}) {
  if (!state) return;
  const currentTile = state.tiles.find((tile) => state.entries.get(tile.id)?.current);
  const back = animate && currentTile && editorEquivalentView(currentTile, state.entries.get(currentTile.id));
  if (back) await animateView(back, OPEN_MS);
  finishClose();
}

function finishClose() {
  if (!state) return;
  stopAnimation();
  for (const bitmap of state.bitmaps.values()) bitmap.close?.();
  state = null;
  overlayEl.replaceChildren();
  rootEl.classList.add('leaving');
  // A short fade covers what differs between a tile and the live canvas
  // (the grid, pin dots): the drawing itself stays where it is.
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hide = () => {
    rootEl.hidden = true;
    rootEl.classList.remove('leaving');
  };
  if (still) hide();
  else setTimeout(hide, 160);
  canvasEl.focus({ preventScroll: true });
}

export function toggleAtlas() {
  if (state) void closeAtlas();
  else void openAtlas();
}

/** Settings → Symbols (and `:symbols`): every symbol, in the Atlas viewer. */
export function toggleSymbolSheet() {
  if (state) void closeAtlas();
  else void openAtlas({ source: 'symbols' });
}

async function openTile(tile) {
  if (state.source === 'symbols') {
    focusTile(tile, { zoom: true });
    return;
  }
  const entry = state.entries.get(tile.id);
  state.selected = tile.id;
  const hits = state.matches?.get(tile.id)?.hits || [];
  if (entry.current) {
    await closeAtlas();
    selectHits(hits);
    return;
  }
  const { w, h } = paneSize();
  await animateView(viewFitting(tile, w, h, 0.1), OPEN_MS);
  const generation = state?.generation;
  const opened = await openDocumentPath(entry.path);
  if (!state || state.generation !== generation) return;
  if (!opened) {
    requestDraw();
    return;
  }
  // The editor fitted the design; settle the tile exactly there, then go.
  const exact = editorEquivalentView(tile, entry);
  if (exact) await animateView(exact, 220);
  finishClose();
  selectHits(hits);
}

/** What the search found in the design just opened becomes the selection. */
function selectHits(hits) {
  if (!hits.length) return;
  const circuit = editor.circuit;
  const parts = hits.filter((hit) => hit.kind === 'part' && circuit.components.has(hit.id)).map((hit) => hit.id);
  const labels = hits.filter((hit) => hit.kind === 'text' && circuit.labels.has(hit.id)).map((hit) => hit.id);
  const nets = hits.filter((hit) => hit.kind === 'net' && circuit.nets.has(hit.id)).map((hit) => hit.id);
  setSelection(parts);
  setLabelSelection(labels, undefined, true);
  editor.selectedNets = new Set(nets);
  logLine(`${hits.length} match${hits.length === 1 ? '' : 'es'} for "${lastQuery.trim()}" selected`);
  render();
}

// ----- input --------------------------------------------------------------------------

export function onAtlasKey(ev) {
  if (!state) return;
  const key = ev.key;
  const arrows = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
  const selected = state.selected && tileById(state.selected);
  if (key === '/' || ((ev.ctrlKey || ev.metaKey) && key.toLowerCase() === 'f')) focusSearch();
  else if (key === 'Escape' && state.matches) clearSearch();
  else if (key === 'Escape' || key === 'Backspace') void closeAtlas();
  else if (key === 'Enter' && selected) void openTile(selected);
  else if (arrows[key]) {
    // While a search is on, the arrows and Tab move among what it found.
    const tiles = navigableTiles();
    const next = selected && tiles.includes(selected) ? neighbourTile(tiles, selected, arrows[key]) : tiles[0];
    if (next) focusTile(next);
  } else if (key === 'Tab' && navigableTiles().length) {
    const tiles = navigableTiles();
    const index = selected ? tiles.indexOf(selected) : -1;
    const step = ev.shiftKey ? -1 : 1;
    focusTile(tiles[(index + step + tiles.length) % tiles.length]);
  } else if (key === '#' && selected && state.source === 'workspace') openTagEditor(selected);
  else if ((key === 'z' || key === ' ') && selected) focusTile(selected, { zoom: true });
  else if (key === 'f' || key === 'F') void animateView(clampView(fitAllView()));
  else if (key === '+' || key === '=') zoomAbout(1 / 1.5, centreOf().x, centreOf().y);
  else if (key === '-' || key === '_') zoomAbout(1.5, centreOf().x, centreOf().y);
  else if (key === 'D' || (key === 'd' && ev.shiftKey)) toggleTheme();
  else return;
  ev.preventDefault();
}

function onWheel(ev) {
  ev.preventDefault();
  if (!state) return;
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
  if (!state || ev.target.closest?.('.atlas-head, .atlas-tags')) return;
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
    const hit = tileAt(state.tiles, clientToWorld(ev.clientX, ev.clientY));
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
  const hit = tileAt(state.tiles, clientToWorld(ev.clientX, ev.clientY));
  state.selected = hit?.id || null;
  requestDraw();
}

function onDoubleClick(ev) {
  if (!state) return;
  const hit = tileAt(state.tiles, clientToWorld(ev.clientX, ev.clientY));
  if (hit) void openTile(hit);
}

export function installAtlas() {
  if (!rootEl) return;
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
  document.getElementById('atlas-close')?.addEventListener('click', () => void closeAtlas());
  searchEl?.addEventListener('input', () => applySearch(searchEl.value));
  searchEl?.addEventListener('keydown', (ev) => {
    // The desk's own keys (z, f, arrows) are text here.
    ev.stopPropagation();
    if (ev.key === 'Enter') {
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
