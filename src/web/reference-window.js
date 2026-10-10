/**
 * Reference windows: another design of the workspace shown beside the
 * drawing, to keep its context in view while editing this one -- the bias
 * generator next to the amplifier it feeds. Each is a floating window
 * (floating-window.js), moved by its title bar and resized from its corner,
 * holding a read-only picture of the design that zooms (wheel, or pinch)
 * and pans (drag) on its own, right-drag zooming to a box. Its title picks
 * another design, and its swap button trades places with the editor: the
 * design opens there and the one that was open moves into the window. It
 * follows the design's file as it is saved.
 *
 * A picture pasted (Ctrl+V) with the pointer over a window shows there
 * instead of a design: a datasheet figure, a sketch, a scope capture. The
 * copy button (or Ctrl+C with the pointer over the window) puts what the
 * window shows back on the clipboard as a picture.
 *
 * Which designs (or pictures) the windows show is saved with the design
 * being edited (`Circuit#windows`, window-state.js): another design opens
 * with its own windows, or none. `Shift+V` shows or hides them, opening a
 * first one (with its design picker) when there is none.
 */

import { loadDocument } from '../core/document.js';
import { svgString } from '../core/render.js';
import { DRAWING_EXPORT_OPTIONS } from '../core/selection-drawing.js';
import { applyExportDarkTheme, withEmbeddedMathFont } from './drawing-export.js';
import { floatingWindow } from './floating-window.js';
import { wheelIntent } from './gestures.js';
import { buttonIcon } from './icons.js';
import { editor } from './editor-state.js';
import { persistence, openDocumentPath } from './document-session.js';
import { appendDesignChoices, workspaceDesigns } from './hierarchy.js';
import { openMenuAt } from './context-menu.js';
import { storedImage, takePastedPictures } from './copy-paste.js';
import { logLine } from './status-bar-ui.js';
import { markSettingsChanged, onDocumentShown } from './main.js';
import { MAX_WINDOW_PICTURE } from '../core/window-state.js';
import { pngDataUrlBlob, writeDrawingToClipboard } from './clipboard.js';

/** How often a shown window asks whether its design's file changed. */
const POLL_MS = 2000;
/** The closest zoom, in screen pixels per drawing unit (the editor's). */
const MAX_SCALE = 3;
const FIT_MARGIN = 0.06;

const windows = []; // { el, slot, doc | pasted, picture, view, fitted, etag, revision, chrome }
let hidden = false;
let pollTimer = null;

const dataUrl = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const dark = () => document.documentElement.classList.contains('dark');

// ----- remembering ------------------------------------------------------------------

let restoring = false;

/** Keep what the windows show in the design, a settings change when it is new. */
function remember() {
  if (restoring) return;
  const entry = (win) => (win.doc ? { path: win.doc.path, name: win.doc.name }
    : win.pasted && win.pasted.src.length <= MAX_WINDOW_PICTURE ? { picture: win.pasted } : null);
  const items = windows.map(entry).filter(Boolean);
  const next = items.length || hidden ? { items, ...(hidden ? { hidden: true } : {}) } : null;
  const state = editor.circuit.windows;
  if (JSON.stringify(next) === JSON.stringify(state.references || null)) return;
  if (next) state.references = next;
  else delete state.references;
  markSettingsChanged();
}

/** The open design's windows, as it was saved: the ones shown now close. */
function restoreWindows() {
  restoring = true;
  try {
    for (const win of [...windows]) closeWindow(win);
    const saved = editor.circuit.windows.references;
    hidden = !!saved?.hidden;
    for (const entry of saved?.items || []) {
      if (entry.picture) {
        const win = createWindow();
        if (win) setPicture(win, entry.picture);
      } else {
        // A design moved with the workspace is found again by its name.
        const found = workspaceDesigns().find((doc) => doc.path === entry.path) || workspaceDesigns().find((doc) => doc.name === entry.name);
        createWindow(found ? { path: found.path, name: found.name } : entry);
      }
    }
  } finally {
    restoring = false;
  }
  syncButton();
}

// ----- the picture ------------------------------------------------------------------

/** The whole design as drawn by its export, in both themes. */
async function pictureOf(circuit) {
  if (!circuit.components.size && !circuit.labels.size) return null;
  const svg = svgString(circuit, { ...DRAWING_EXPORT_OPTIONS, background: false, emptyHint: false });
  const match = svg.match(/viewBox="([-\d.e]+)[ ,]+([-\d.e]+)[ ,]+([-\d.e]+)[ ,]+([-\d.e]+)"/);
  if (!match) return null;
  const [light, darkSvg] = await Promise.all([withEmbeddedMathFont(svg), withEmbeddedMathFont(applyExportDarkTheme(svg))]);
  const [x, y, w, h] = match.slice(1).map(Number);
  return { svg, box: { x, y, w, h }, href: { light: dataUrl(light), dark: dataUrl(darkSvg) } };
}

function showMessage(win, text) {
  win.message.textContent = text || '';
  win.message.hidden = !text;
  win.image.hidden = !!text || !win.picture;
}

/** Read the window's design from its file (or, unchanged, keep it). */
async function loadInto(win, { force = false } = {}) {
  const doc = win.doc;
  if (!doc) return;
  try {
    if (persistence.browserOnly && !force && win.revision) {
      const revision = await persistence.revision?.(doc.path);
      if (!revision || revision === win.revision) return;
    }
    const data = await persistence.load(doc.path, force || !win.etag ? {} : { ifNoneMatch: win.etag });
    if (win.doc !== doc || data.notModified) return;
    const picture = await pictureOf(loadDocument(data.state));
    if (win.doc !== doc) return;
    win.etag = data.etag || null;
    win.revision = data.revision || null;
    const first = !win.picture;
    win.picture = picture;
    if (!picture) {
      showMessage(win, `${doc.name} is empty`);
      return;
    }
    showMessage(win, '');
    if (first || win.fitted) fit(win);
    else draw(win);
  } catch (err) {
    if (win.doc !== doc) return;
    win.picture = null;
    showMessage(win, err.status === 404 ? `${doc.name} is no longer in the workspace` : `${doc.name} could not be read: ${err.message}`);
  }
}

// ----- the view ---------------------------------------------------------------------

function viewportSize(win) {
  return { w: win.viewport.clientWidth, h: win.viewport.clientHeight };
}

/** The whole design in the window, centred. */
function fit(win) {
  const box = win.picture?.box;
  const { w, h } = viewportSize(win);
  if (!box || !w || !h) return;
  const s = Math.min(MAX_SCALE, Math.min(w / box.w, h / box.h) * (1 - 2 * FIT_MARGIN));
  win.view = { s, x: box.x + box.w / 2 - w / 2 / s, y: box.y + box.h / 2 - h / 2 / s };
  win.fitted = true;
  draw(win);
}

/** Lay the picture out at the view: sized to the screen, so the vector
 *  image is drawn crisp at every zoom. */
function draw(win) {
  const picture = win.picture;
  if (!picture || !win.view) return;
  const { s, x, y } = win.view;
  const href = picture.href[dark() ? 'dark' : 'light'];
  if (win.image.getAttribute('src') !== href) win.image.setAttribute('src', href);
  win.image.style.left = `${(picture.box.x - x) * s}px`;
  win.image.style.top = `${(picture.box.y - y) * s}px`;
  win.image.style.width = `${picture.box.w * s}px`;
  win.image.style.height = `${picture.box.h * s}px`;
}

function zoomAbout(win, factor, clientX, clientY) {
  if (!win.view || !win.picture) return;
  const rect = win.viewport.getBoundingClientRect();
  const px = clientX - rect.left;
  const py = clientY - rect.top;
  const { s, x, y } = win.view;
  const box = win.picture.box;
  // Out no further than a quarter of the fitted size.
  const minScale = Math.min(rect.width / box.w, rect.height / box.h) / 4;
  const next = Math.min(MAX_SCALE, Math.max(minScale, s * factor));
  win.view = { s: next, x: x + px / s - px / next, y: y + py / s - py / next };
  win.fitted = false;
  draw(win);
}

/** Right-drag: a box to zoom to, as on the drawing. */
function startZoomBox(win, ev) {
  const { viewport, zoomBox } = win;
  ev.preventDefault();
  viewport.setPointerCapture(ev.pointerId);
  const rect = viewport.getBoundingClientRect();
  const from = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  let to = null;
  const move = (e) => {
    const at = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    to = Math.hypot(at.x - from.x, at.y - from.y) >= 4 ? at : null;
    zoomBox.hidden = !to;
    if (!to) return;
    Object.assign(zoomBox.style, {
      left: `${Math.min(from.x, to.x)}px`, top: `${Math.min(from.y, to.y)}px`,
      width: `${Math.abs(to.x - from.x)}px`, height: `${Math.abs(to.y - from.y)}px`,
    });
  };
  const end = () => {
    viewport.removeEventListener('pointermove', move);
    zoomBox.hidden = true;
    if (!to || !win.view) return;
    const { s, x, y } = win.view;
    const box = { x: x + Math.min(from.x, to.x) / s, y: y + Math.min(from.y, to.y) / s, w: Math.abs(to.x - from.x) / s, h: Math.abs(to.y - from.y) / s };
    const next = Math.min(MAX_SCALE, Math.min(rect.width / box.w, rect.height / box.h));
    win.view = { s: next, x: box.x + box.w / 2 - rect.width / 2 / next, y: box.y + box.h / 2 - rect.height / 2 / next };
    win.fitted = false;
    draw(win);
  };
  viewport.addEventListener('pointermove', move);
  viewport.addEventListener('pointerup', end, { once: true });
  viewport.addEventListener('pointercancel', end, { once: true });
}

function installViewport(win) {
  const { viewport } = win;
  viewport.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    if (!win.view) return;
    const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1;
    if (wheelIntent(ev, editor.scrollScheme) === 'pan') {
      win.view = { ...win.view, x: win.view.x + (ev.deltaX * unit) / win.view.s, y: win.view.y + (ev.deltaY * unit) / win.view.s };
      win.fitted = false;
      draw(win);
      return;
    }
    // The editor's zoom rates: pinch arrives as a ctrl-wheel with small deltas.
    zoomAbout(win, Math.pow(ev.ctrlKey && editor.scrollScheme === 'trackpad' ? 1.01 : 1.0016, -ev.deltaY * unit), ev.clientX, ev.clientY);
  }, { passive: false });
  viewport.addEventListener('contextmenu', (ev) => ev.preventDefault());
  viewport.addEventListener('pointerdown', (ev) => {
    if (ev.button === 2 && win.view) {
      startZoomBox(win, ev);
      return;
    }
    if ((ev.button !== 0 && ev.button !== 1) || !win.view) return;
    ev.preventDefault();
    viewport.setPointerCapture(ev.pointerId);
    viewport.classList.add('panning');
    const start = { x: ev.clientX, y: ev.clientY, view: { ...win.view } };
    const move = (e) => {
      win.view = { ...start.view, x: start.view.x - (e.clientX - start.x) / start.view.s, y: start.view.y - (e.clientY - start.y) / start.view.s };
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 2) win.fitted = false;
      draw(win);
    };
    const end = () => {
      viewport.removeEventListener('pointermove', move);
      viewport.classList.remove('panning');
    };
    viewport.addEventListener('pointermove', move);
    viewport.addEventListener('pointerup', end, { once: true });
    viewport.addEventListener('pointercancel', end, { once: true });
  });
  // Double-click fits the whole design again.
  viewport.addEventListener('dblclick', () => fit(win));
  // A resized window keeps a fitted design fitted, else its centre.
  if (typeof ResizeObserver === 'function') {
    let last = null;
    new ResizeObserver(() => {
      const size = viewportSize(win);
      if (win.fitted) fit(win);
      else if (last && win.view) {
        win.view = { ...win.view, x: win.view.x + (last.w - size.w) / 2 / win.view.s, y: win.view.y + (last.h - size.h) / 2 / win.view.s };
        draw(win);
      }
      last = size;
    }).observe(viewport);
  }
}

// ----- windows ----------------------------------------------------------------------

function headerButton(className, icon, label, title) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `reference-button ${className}`;
  button.setAttribute('aria-label', label);
  button.title = title;
  button.append(buttonIcon(icon));
  return button;
}

function freeSlot() {
  let slot = 1;
  while (windows.some((win) => win.slot === slot)) slot += 1;
  return slot;
}

function createWindow(doc = null) {
  const pane = document.querySelector('.canvas-pane');
  if (!pane) return null;
  const slot = freeSlot();
  const el = document.createElement('section');
  el.className = 'floating-window reference-window';
  el.dataset.editorEdge = 'right';
  el.setAttribute('aria-label', 'Reference design');
  const header = document.createElement('header');
  header.className = 'floating-window-header';
  const title = document.createElement('button');
  title.type = 'button';
  title.className = 'reference-title floating-window-title';
  title.title = 'Show another design in this window';
  const fitButton = headerButton('reference-fit', 'fit', 'Fit', 'Fit the whole design in the window (f with the pointer over it, or double-click it); right-drag zooms to a box');
  const swap = headerButton('reference-swap', 'repeat', 'Swap with the editor', 'Swap: open this design in the editor, and show the one open now in this window');
  const copy = headerButton('reference-copy', 'copy', 'Copy the picture', 'Copy what this window shows to the clipboard as a picture (Ctrl+C with the pointer over it)');
  const another = headerButton('reference-new', 'plus', 'Another reference window', 'Open another reference window');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'floating-window-close';
  close.setAttribute('aria-label', 'Close the reference window');
  close.title = 'Close this reference window';
  close.textContent = '×';
  header.append(title, fitButton, copy, swap, another, close);
  const viewport = document.createElement('div');
  viewport.className = 'reference-viewport';
  const image = document.createElement('img');
  image.className = 'reference-picture';
  image.alt = '';
  image.draggable = false;
  image.hidden = true;
  const message = document.createElement('p');
  message.className = 'reference-message';
  const zoomBox = document.createElement('div');
  zoomBox.className = 'reference-zoom-box';
  zoomBox.hidden = true;
  viewport.append(image, message, zoomBox);
  el.append(header, viewport);
  el.hidden = hidden;
  pane.appendChild(el);

  const win = { el, slot, doc: null, picture: null, view: null, fitted: true, etag: null, revision: null, title, viewport, image, message, zoomBox, swap };
  win.chrome = floatingWindow(el, {
    key: `reference-${slot}`,
    resizable: true,
    onClose: () => closeWindow(win),
    // Down the right side, each further window a step lower.
    place: (paneSize, size) => ({ x: paneSize.w - size.w - 52, y: 56 + (slot - 1) * 36 }),
  });
  title.addEventListener('click', () => openPicker(win));
  another.addEventListener('click', () => {
    const next = createWindow();
    if (next) openPicker(next);
  });
  fitButton.addEventListener('click', () => fit(win));
  copy.addEventListener('click', () => copyPicture(win));
  swap.addEventListener('click', () => void swapWithEditor(win));
  installViewport(win);
  el.addEventListener('pointerenter', () => { hovered = win; });
  el.addEventListener('pointerleave', () => { if (hovered === win) hovered = null; });
  windows.push(win);
  setDocument(win, doc);
  win.chrome.place();
  ensurePolling();
  syncButton();
  return win;
}

/** Show a pasted picture ({ src, aspect, width }) in the window. */
function setPicture(win, image) {
  win.doc = null;
  win.pasted = { src: image.src, aspect: image.aspect, width: image.width };
  const w = image.width || 800;
  win.picture = { box: { x: 0, y: 0, w, h: w / image.aspect }, href: { light: image.src, dark: image.src } };
  win.etag = null;
  win.revision = null;
  win.title.textContent = 'Pasted picture ▾';
  win.swap.disabled = true;
  showMessage(win, '');
  fit(win);
  remember();
}

function setDocument(win, doc) {
  win.pasted = null;
  win.swap.disabled = false;
  win.doc = doc ? { path: doc.path, name: doc.name } : null;
  win.picture = null;
  win.etag = null;
  win.revision = null;
  win.fitted = true;
  win.title.textContent = doc ? doc.name : 'Pick a design…';
  win.title.append(document.createTextNode(' ▾'));
  showMessage(win, doc ? 'Loading…' : 'Click the title to pick a design, or paste a picture (Ctrl+V)');
  if (doc) void loadInto(win, { force: true });
  remember();
}

/** Open the window's design in the editor, and show the design that was
 *  open there in the window instead: the two trade places. */
async function swapWithEditor(win) {
  const shown = win.doc;
  if (!shown) {
    if (win.pasted) logLine('A pasted picture is not a design: there is nothing to open in the editor.');
    return;
  }
  const path = editor.currentDocumentPath;
  if (!path) {
    logLine('Save this design first, so the reference window can hold it when the two swap.', 'error');
    return;
  }
  if (path === shown.path) return;
  const current = { path, name: editor.currentCircuitName };
  // The windows come along: the same ones, this one now showing the design
  // that was open (opening another design would show its own windows).
  const index = windows.indexOf(win);
  const carried = windows.map((other, i) => (i === index ? { ...current }
    : other.doc ? { path: other.doc.path, name: other.doc.name }
      : other.pasted && other.pasted.src.length <= MAX_WINDOW_PICTURE ? { picture: other.pasted } : null)).filter(Boolean);
  if (!await openDocumentPath(shown.path)) return;
  editor.circuit.windows.references = { items: carried };
  markSettingsChanged();
  restoreWindows();
}

/** A picture as a PNG blob: a PNG as it is, any other kind drawn into a
 *  canvas at its own size. */
async function pngOf(src) {
  if (src.startsWith('data:image/png;base64,')) return pngDataUrlBlob(src);
  const image = new Image();
  image.src = src;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext('2d').drawImage(image, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('could not encode the picture'))), 'image/png'));
}

/** Put what the window shows on the clipboard: its design as the drawing's
 *  own copy draws it, or the pasted picture. */
function copyPicture(win) {
  if (!win.picture) {
    logLine('This window shows nothing to copy yet.');
    return;
  }
  const what = win.doc ? win.doc.name : 'the pasted picture';
  let write;
  try {
    if (win.pasted) {
      if (!navigator.clipboard?.write || typeof ClipboardItem !== 'function') throw new Error('image clipboard is unavailable in this browser');
      const png = pngOf(win.pasted.src);
      png.catch(() => {});
      write = navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    } else {
      write = writeDrawingToClipboard(win.picture.svg);
    }
  } catch (err) {
    logLine(`Could not copy ${what}: ${err.message}`, 'error');
    return;
  }
  write.then(() => logLine(`Copied ${what} as a picture`), (err) => logLine(`Could not copy ${what}: ${err.message}`, 'error'));
}

/** Ctrl+C over a reference window copies its picture. Returns whether it did. */
export function copyHoveredReference() {
  if (!hovered || hidden || !windows.includes(hovered) || !hovered.picture) return false;
  copyPicture(hovered);
  return true;
}

function closeWindow(win) {
  const index = windows.indexOf(win);
  if (index < 0) return;
  windows.splice(index, 1);
  if (hovered === win) hovered = null;
  win.chrome.dispose();
  win.el.remove();
  remember();
  syncButton();
}

/** The designs to show, by the window's title: typing narrows them. */
function openPicker(win) {
  const rect = win.title.getBoundingClientRect();
  const menu = openMenuAt(rect.left, rect.bottom + 4, 'Show in this window');
  if (!menu) return;
  const group = document.createElement('div');
  group.className = 'context-menu-group reference-picker';
  const search = appendDesignChoices(group, workspaceDesigns(), {
    current: win.doc?.name,
    label: 'Find a design to show',
    pick: (doc) => setDocument(win, doc),
  });
  menu.appendChild(group);
  search.focus();
}

// ----- following saves ----------------------------------------------------------------

function ensurePolling() {
  if (pollTimer || !windows.length) return;
  pollTimer = setInterval(() => {
    if (!windows.length) {
      clearInterval(pollTimer);
      pollTimer = null;
      return;
    }
    if (hidden || document.hidden) return;
    for (const win of windows) if (win.doc) void loadInto(win);
  }, POLL_MS);
}

// ----- the toggle ----------------------------------------------------------------------

function syncButton() {
  const button = document.getElementById('btn-window-reference');
  button?.setAttribute('aria-pressed', String(windows.length > 0 && !hidden));
}

// The window under the pointer, which `f` fits instead of the drawing.
let hovered = null;

/** `f` over a reference window fits its design, not the drawing. Returns
 *  whether it did. */
export function fitHoveredReference() {
  if (!hovered || hidden || !windows.includes(hovered) || !hovered.picture) return false;
  fit(hovered);
  return true;
}

/** Whether reference windows are open and shown. */
export function referenceWindowsShown() {
  return windows.length > 0 && !hidden;
}

/** Shift+V: show or hide the reference windows; with none, open one and
 *  its design picker. */
export function toggleReferenceWindows() {
  if (!windows.length) {
    hidden = false;
    const win = createWindow();
    if (win) openPicker(win);
    remember();
    return;
  }
  hidden = !hidden;
  for (const win of windows) {
    win.el.hidden = hidden;
    if (!hidden) {
      win.chrome.place();
      void loadInto(win);
    }
  }
  if (!hidden) for (const win of windows) if (win.fitted) fit(win);
  remember();
  syncButton();
  logLine(hidden ? 'Reference windows hidden (Shift+V shows them)' : 'Reference windows shown');
}

export function installReferenceWindows() {
  document.getElementById('btn-window-reference')?.addEventListener('click', () => toggleReferenceWindows());
  // Ctrl+V with the pointer over a window puts the picture there.
  takePastedPictures((file) => {
    const win = hovered && !hidden && windows.includes(hovered) ? hovered : null;
    if (!win) return false;
    showMessage(win, 'Pasting…');
    storedImage(file).then((image) => {
      if (windows.includes(win)) setPicture(win, image);
      logLine('Picture pasted into the reference window');
    }, (err) => {
      if (windows.includes(win)) showMessage(win, win.picture ? '' : 'Click the title to pick a design, or paste a picture (Ctrl+V)');
      logLine(`Could not paste the picture: ${err.message}`, 'error');
    });
    return true;
  });
  // A theme change swaps every picture for its other theme.
  new MutationObserver(() => windows.forEach(draw)).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  // Before window state was saved with designs, it was this browser's.
  try { localStorage.removeItem('mosfeteer.references'); } catch { /* storage unavailable */ }
  onDocumentShown(restoreWindows);
  syncButton();
}
