/**
 * The workspace collage: every design in the workspace laid out at its real
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
import { DRAWING_EXPORT_OPTIONS } from '../core/selection-drawing.js';
import { applyExportDarkTheme, withEmbeddedMathFont } from './drawing-export.js';
import { COLLAGE_CAPTION, COLLAGE_GAP, LARGE_PX, SMALL_PX, layoutCollage, neighbourTile, rectsIntersect, tileAt, tileDetail, viewFitting } from './collage-layout.js';
import { cacheGet, cachePut, renderingKey, trimCache } from './collage-cache.js';
import { wheelIntent, lerpView } from './gestures.js';
import { editor } from './editor-state.js';
import { persistence, openDocumentPath } from './document-session.js';
import { toggleTheme } from './toolbar-ui.js';
import { logLine } from './status-bar-ui.js';
import { canvasEl } from './elements.js';

const rootEl = document.getElementById('collage');
const deskEl = document.getElementById('collage-desk');
const overlayEl = document.getElementById('collage-overlays');
const titleEl = document.getElementById('collage-title');
const statusEl = document.getElementById('collage-status');

/** Live SVGs at most at once; the rest stay on their large images. */
const MAX_VECTOR_TILES = 6;
/** Large images decoded at once (each is up to ~6 MB of pixels). */
const MAX_LARGE_BITMAPS = 24;
const ZOOM_IN_PX_PER_UNIT = 3; // the editor's closest zoom: 120 px per grid cell
const ENTER_MS = 650;
const OPEN_MS = 450;

let state = null;

export function collageOpen() {
  return !!state;
}

// ----- geometry ---------------------------------------------------------------

function paneSize() {
  return { w: rootEl.clientWidth || window.innerWidth, h: rootEl.clientHeight || window.innerHeight };
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

/** The collage view that shows a design's tile exactly where the editor
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
  return viewFitting({ ...state.bounds, h: state.bounds.h + COLLAGE_CAPTION }, w, h, 0.05);
}

// ----- the drawings -------------------------------------------------------------

function viewBoxOf(svg) {
  const match = svg.match(/viewBox="([-\d.e]+)[ ,]+([-\d.e]+)[ ,]+([-\d.e]+)[ ,]+([-\d.e]+)"/);
  if (!match) return null;
  const [x, y, w, h] = match.slice(1).map(Number);
  return { x, y, w, h };
}

function drawingSvg(circuit) {
  return svgString(circuit, { ...DRAWING_EXPORT_OPTIONS, emptyHint: false });
}

/** The design as it stands: the open one from the editor, unsaved edits and
 *  all; the others from their files, through the cache. */
async function drawingFor(documentInfo, current) {
  if (current) return { svg: drawingSvg(editor.circuit), revision: null };
  const key = documentInfo.revision && renderingKey(documentInfo.path, documentInfo.revision, 'svg');
  const cached = key && await cacheGet(key);
  if (cached) return { svg: cached, revision: documentInfo.revision };
  const data = await persistence.load(documentInfo.path);
  const svg = drawingSvg(loadDocument(data.state));
  if (key) await cachePut(key, svg);
  return { svg, revision: documentInfo.revision };
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
      const { svg, revision } = current && state.entries.get(doc.path) || await drawingFor(doc, current);
      const box = viewBoxOf(svg);
      if (box) entries.push({ id: doc.path, name: doc.name, path: doc.path, revision, current, svg, box });
    } catch (err) {
      logLine(`Collage: could not draw ${doc.name}: ${err.message}`, 'error');
    }
    if (!state || state.generation !== generation) return false;
    if (index % 4 === 3) {
      statusEl.textContent = `Drawing ${index + 1} of ${documents.length}…`;
      await new Promise((resolve) => setTimeout(resolve));
    }
  }
  const { tiles, bounds } = layoutCollage(entries.map((entry) => ({ id: entry.id, w: entry.box.w, h: entry.box.h })));
  // The open design stayed on screen while the rest loaded: move the view
  // with it to its place in the layout, so it does not jump.
  const provisional = state.tiles[0];
  const placed = provisional && tiles.find((tile) => tile.id === provisional.id);
  if (placed) state.view = { ...state.view, x: state.view.x + placed.x - provisional.x, y: state.view.y + placed.y - provisional.y };
  state.entries = new Map(entries.map((entry) => [entry.id, entry]));
  state.tiles = tiles;
  state.bounds = bounds;
  statusEl.textContent = `${entries.length} design${entries.length === 1 ? '' : 's'}`;
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
  const cacheKey = entry.revision && renderingKey(entry.path, entry.revision, `${theme()}-${level}`);
  const blob = cacheKey && await cacheGet(cacheKey);
  if (blob) return createImageBitmap(blob);
  const canvas = await rasterize(entry, level);
  if (cacheKey) {
    canvas.toBlob((png) => { if (png) void cachePut(cacheKey, png); }, 'image/png');
  }
  return createImageBitmap(canvas);
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
    desk: read('--collage-desk', '#e8ebf0'),
    paper: read('--paper', '#fff'),
    edge: read('--border', '#d3dae4'),
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
  ctx.fillStyle = palette.desk;
  ctx.fillRect(0, 0, w, h);

  const screen = { x: state.view.x, y: state.view.y, w: state.view.w, h: state.view.h };
  const visible = state.tiles.filter((tile) => rectsIntersect(screen, { ...tile, h: tile.h + COLLAGE_CAPTION }));
  const wanted = [];
  const vector = [];
  const centre = { x: state.view.x + state.view.w / 2, y: state.view.y + state.view.h / 2 };
  for (const tile of visible) {
    const entry = state.entries.get(tile.id);
    const rect = worldToScreen(tile);
    const detail = tileDetail(Math.max(rect.w, rect.h) * dpr);
    ctx.fillStyle = palette.paper;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    if (detail !== 'sheet') {
      const level = detail === 'small' ? 'small' : 'large';
      const bitmap = state.bitmaps.get(bitmapKey(entry, level)) ||
        state.bitmaps.get(bitmapKey(entry, level === 'large' ? 'small' : 'large'));
      if (bitmap) {
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bitmap, rect.x, rect.y, rect.w, rect.h);
      }
      const distance = Math.hypot(tile.x + tile.w / 2 - centre.x, tile.y + tile.h / 2 - centre.y);
      for (const need of level === 'large' ? ['small', 'large'] : ['small']) {
        const key = bitmapKey(entry, need);
        if (!state.bitmaps.has(key)) wanted.push({ entry, level: need, key, distance });
      }
      if (detail === 'vector') vector.push({ tile, rect, area: rect.w * rect.h });
    }
    ctx.strokeStyle = palette.edge;
    ctx.lineWidth = 1;
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
    drawCaption(ctx, tile, entry, rect, palette);
  }
  // Every small image first (the whole desk becomes recognizable), then large.
  wanted.sort((a, b) => (a.level === b.level ? a.distance - b.distance : a.level === 'small' ? -1 : 1));
  state.wanted = wanted;
  void pump();
  syncVectorOverlays(vector.sort((a, b) => b.area - a.area).slice(0, MAX_VECTOR_TILES));
}

function drawCaption(ctx, tile, entry, rect, palette) {
  const selected = state.selected === tile.id;
  const hovered = state.hover === tile.id;
  if (selected || hovered) {
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = selected ? 2 : 1;
    ctx.strokeRect(rect.x - 3, rect.y - 3, rect.w + 6, rect.h + 6);
  }
  // The caption may run on into the gap after its tile; its size follows
  // the caption band, so zoomed far out it gives way instead of crowding.
  const k = scale();
  const size = Math.min(13, COLLAGE_CAPTION * k * 0.45);
  if (size < 7) return;
  const room = (tile.w + COLLAGE_GAP * 0.8) * k;
  const marker = entry.current ? '● ' : '';
  ctx.font = `${selected ? 600 : 500} ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.fillStyle = selected || hovered ? palette.text : palette.dim;
  ctx.textBaseline = 'top';
  ctx.fillText(fitText(ctx, `${marker}${entry.name}`, room), rect.x, rect.y + rect.h + size * 0.6);
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
function syncVectorOverlays(list) {
  const keep = new Set(list.map(({ tile }) => tile.id));
  for (const [id, el] of state.overlays) {
    if (!keep.has(id)) {
      el.remove();
      state.overlays.delete(id);
    }
  }
  for (const { tile, rect } of list) {
    let el = state.overlays.get(tile.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'collage-vector';
      const { svg: drawing } = state.entries.get(tile.id);
      el.innerHTML = theme() === 'dark' ? applyExportDarkTheme(drawing) : drawing;
      const svg = el.querySelector('svg');
      svg?.removeAttribute('width');
      svg?.removeAttribute('height');
      overlayEl.appendChild(el);
      state.overlays.set(tile.id, el);
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

/** Shift+Esc: step back from the drawing to the whole workspace. */
export async function openCollage() {
  if (state || !rootEl) return;
  const generation = (openCollage.generation = (openCollage.generation || 0) + 1);
  state = {
    generation, view: { x: 0, y: 0, w: 1, h: 1 }, entries: new Map(), tiles: [], bounds: { x: 0, y: 0, w: 0, h: 0 },
    bitmaps: new Map(), failed: new Set(), wanted: [], overlays: new Map(), baking: false,
    selected: null, hover: null, drag: null, animation: null, colors: null, colorsTheme: null,
  };
  rootEl.hidden = false;
  rootEl.classList.remove('leaving');
  rootEl.focus({ preventScroll: true });
  showOpenDesign();
  let ready = false;
  try {
    ready = await loadWorkspace(generation);
  } catch (err) {
    logLine(`Could not show the workspace: ${err.message}`, 'error');
  }
  if (!ready || !state) {
    closeCollage({ animate: false });
    return;
  }
  if (!state.tiles.length) {
    statusEl.textContent = 'No designs in the workspace yet. Esc returns to the editor.';
  }
  const currentTile = state.tiles.find((tile) => state.entries.get(tile.id).current);
  state.selected = currentTile?.id || state.tiles[0]?.id || null;
  if (!state.tiles.length) {
    state.view = { x: -500, y: -500, w: 1000, h: 1000 * paneSize().h / paneSize().w };
    requestDraw();
    return;
  }
  if (currentTile) {
    draw();
    await animateView(clampView(fitAllView()), ENTER_MS);
  } else {
    setView(fitAllView());
  }
}

/** Put the open design on the desk at once, exactly where the editor shows
 *  it, before the rest of the workspace has loaded. */
function showOpenDesign() {
  const path = editor.currentDocumentPath;
  if (!path) return;
  const svg = drawingSvg(editor.circuit);
  const box = viewBoxOf(svg);
  if (!box) return;
  const entry = { id: path, name: editor.currentCircuitName || '', path, revision: null, current: true, svg, box };
  const tile = { id: path, x: 0, y: 0, w: box.w, h: box.h };
  const view = editorEquivalentView(tile, entry);
  if (!view) return;
  state.entries = new Map([[path, entry]]);
  state.tiles = [tile];
  state.bounds = { x: 0, y: 0, w: box.w, h: box.h };
  state.view = view;
  draw();
}

/** Leave for the editor. The open design zooms back into place. */
export async function closeCollage({ animate = true } = {}) {
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

export function toggleCollage() {
  if (state) void closeCollage();
  else void openCollage();
}

async function openTile(tile) {
  const entry = state.entries.get(tile.id);
  state.selected = tile.id;
  if (entry.current) {
    await closeCollage();
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
}

// ----- input --------------------------------------------------------------------------

export function onCollageKey(ev) {
  if (!state) return;
  const key = ev.key;
  const arrows = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
  const selected = state.selected && tileById(state.selected);
  if (key === 'Escape') void closeCollage();
  else if (key === 'Enter' && selected) void openTile(selected);
  else if (arrows[key]) {
    const next = selected ? neighbourTile(state.tiles, selected, arrows[key]) : state.tiles[0];
    if (next) focusTile(next);
  } else if (key === 'Tab' && state.tiles.length) {
    const index = selected ? state.tiles.indexOf(selected) : -1;
    const step = ev.shiftKey ? -1 : 1;
    focusTile(state.tiles[(index + step + state.tiles.length) % state.tiles.length]);
  } else if ((key === 'z' || key === ' ') && selected) focusTile(selected, { zoom: true });
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
  // The editor's zoom rates: pinch arrives as a ctrl-wheel with small deltas.
  zoomAbout(Math.pow(ev.ctrlKey && editor.scrollScheme === 'trackpad' ? 1.01 : 1.0016, ev.deltaY * unit), ev.clientX, ev.clientY);
}

function onPointerDown(ev) {
  if (!state || (ev.button !== 0 && ev.button !== 1)) return;
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
  state.pointers?.delete(ev.pointerId);
  const drag = state.drag;
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

export function installCollage() {
  if (!rootEl) return;
  rootEl.addEventListener('wheel', onWheel, { passive: false });
  rootEl.addEventListener('pointerdown', onPointerDown);
  rootEl.addEventListener('pointermove', onPointerMove);
  rootEl.addEventListener('pointerup', onPointerUp);
  rootEl.addEventListener('pointercancel', onPointerUp);
  rootEl.addEventListener('dblclick', onDoubleClick);
  rootEl.addEventListener('pointerleave', () => {
    if (state && state.hover) {
      state.hover = null;
      requestDraw();
    }
  });
  window.addEventListener('resize', () => {
    if (!state) return;
    const { w, h } = paneSize();
    setView({ ...state.view, h: (state.view.w * h) / w });
  });
  document.getElementById('collage-close')?.addEventListener('click', () => void closeCollage());
  // The theme flips inside a view transition, a frame after the key.
  new MutationObserver(() => requestDraw()).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
}
