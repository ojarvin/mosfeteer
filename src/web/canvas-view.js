/**
 * The canvas view: the world window the pane shows, its zoom limits, fitting
 * and animating it, and converting between screen and world coordinates.
 */

import { linkBubbleFrames } from './hierarchy.js';
import { circuitPageGuideFrame } from '../core/page-guide.js';
import { viewportFrame, viewportGridPath } from '../core/render.js';
import { snap, GRID } from '../core/grid.js';
import { viewFollowingCursor, worldAndCursorFromClient } from './interaction.js';
import { lerpView } from './gestures.js';
import { editor } from './editor-state.js';
import { render, selectedComps } from './main.js';
import { reducedMotion } from './motion.js';
import { fitPlacement } from './fit-area.js';

// The pane's size, measured once and kept until the pane resizes. Reading
// layout after the render has written the canvas forces the browser to lay
// the page out again on the spot, every frame of a drag; a ResizeObserver says
// when the measurement is stale instead. (It is created on the first
// measurement, before main.js's own observer, so it always runs first.)
let paneMeasured = null;
let paneWatched = false;

function watchPane(pane) {
  if (paneWatched || typeof ResizeObserver === 'undefined') return paneWatched;
  new ResizeObserver(() => { paneMeasured = null; }).observe(pane);
  window.addEventListener('resize', () => { paneMeasured = null; });
  paneWatched = true;
  return true;
}

export function paneSize() {
  if (paneMeasured) return paneMeasured;
  const pane = document.querySelector('.canvas-pane');
  if (!pane) return null;
  const r = pane.getBoundingClientRect();
  if (r.width < 10 || r.height < 10) return null;
  const size = { w: r.width, h: r.height };
  if (watchPane(pane)) paneMeasured = size;
  return size;
}

/** Build a view of the current pane size (grid-aligned) centered on (cx,cy). */
export function viewFromCenter(cx, cy) {
  const p = paneSize();
  const w = p ? Math.ceil((p.w / editor.zoom) / 40) * 40 : 1280;
  const h = p ? Math.ceil((p.h / editor.zoom) / 40) * 40 : 960;
  return { x: snap(cx - w / 2), y: snap(cy - h / 2), w, h };
}

/** Re-fit the fixed window to the pane size exactly (keeps top-left AND scale). */
export function resizeView() {
  const p = paneSize();
  if (!p) return;
  if (refitIfFitted()) return;
  const pxPerUnit = (editor.viewPane?.w || p.w) / editor.view.w;
  editor.view.w = p.w / pxPerUnit;
  editor.view.h = p.h / pxPerUnit;
  clampViewScale();
  editor.viewPane = p;
}

/** Called by render(): a pane that changed since the last layout re-fits first. */
export function syncViewToPane() {
  const p = paneSize();
  if (!p) return;
  if (editor.viewPane && (Math.abs(p.w - editor.viewPane.w) > 0.5 || Math.abs(p.h - editor.viewPane.h) > 0.5)) resizeView();
  editor.viewPane = p;
}

/** Zoom limits: never zoom in so close that a grid cell (40 units) exceeds
 *  ~120px on screen — beyond that the grid-snapped cursor can sit a screen away
 *  from the mouse with no way to bring it back. And never zoom out so far that
 *  the drawn grid line count explodes (keeps the SVG light over a huge canvas). */
export function minViewW() {
  const p = paneSize();
  const cellPx = 120;
  return Math.max(p ? (40 * p.w) / cellPx : 320, 320);
}

export function maxViewW() {
  return 40 * 1000; // at most ~1000 grid cells across, ~1000 grid lines per axis
}

/** Clamp view.w/h into the zoom range, preserving the center (and aspect). */
function clampViewScale() {
  const min = minViewW();
  const max = maxViewW();
  if (editor.view.w < min || editor.view.w > max) {
    const cx = editor.view.x + editor.view.w / 2;
    const cy = editor.view.y + editor.view.h / 2;
    const nw = Math.min(Math.max(editor.view.w, min), max);
    const f = nw / editor.view.w;
    editor.view.w = nw;
    editor.view.h *= f;
    editor.view.x = cx - editor.view.w / 2;
    editor.view.y = cy - editor.view.h / 2;
  }
}

/** Arrow keys can walk the cursor (and any ghost or selection riding it) past
 * the edge of the view, so the view follows it out rather than leaving the
 * work off-screen. Mouse-driven cursor moves need no help: the pointer cannot
 * leave the canvas. */
export function followCursor() {
  const origin = viewFollowingCursor(editor.view, editor.cursor, GRID);
  if (!origin) return false;
  editor.view = { ...editor.view, ...origin };
  return true;
}

// Fit, zoom-to-box, and jump-to-issue ease the view over a few frames so the
// eye can follow where the drawing went. Any direct pan/zoom cancels it.
// While a pan is held, press to release, the root carries
// data-view-moving and the glass over the drawing drops its blur
// (style.css): blurring what moves behind it every frame is what makes a
// pan lag. The pan dims that chrome too (chrome-quiet.js), which hides the
// change, and at the release both come back over one transition. A wheel
// or a view animation leaves the blur alone: undimmed, its return would
// show.
let viewHeld = false;

/** A pan pressed (true) or released (false). */
export function holdViewMoving(held) {
  viewHeld = held;
  globalThis.document?.documentElement?.toggleAttribute('data-view-moving', held);
}
// A release that never reaches the pan (the Atlas gone mid-drag, the
// button let go outside the window) still ends the hold.
globalThis.window?.addEventListener('pointerup', (ev) => { if (viewHeld && !ev.buttons) holdViewMoving(false); }, true);
globalThis.window?.addEventListener('blur', () => { if (viewHeld) holdViewMoving(false); });

let viewAnimation = 0;
// Where the view animation under way lands, and what follows its landing.
let viewLanding = null;

/** Stop the view where it is (a wheel zooms on from there). */
export function cancelViewAnimation() {
  if (viewAnimation) cancelAnimationFrame(viewAnimation);
  viewAnimation = 0;
  viewLanding = null;
}

/** A press or a key never waits for the view: it lands at once. */
export function finishViewAnimation() {
  if (!viewAnimation || !viewLanding) return;
  const { to, landed } = viewLanding;
  cancelViewAnimation();
  Object.assign(editor.view, to);
  landed();
  render();
}

export function animateViewTo(target, ms = 120, landed = () => {}) {
  cancelViewAnimation();
  const from = { ...editor.view };
  const to = { x: target.x, y: target.y, w: target.w, h: target.h };
  viewLanding = { to, landed };
  if (reducedMotion() || document.hidden) {
    Object.assign(editor.view, to);
    landed();
    render();
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const t = (now - start) / ms;
    Object.assign(editor.view, lerpView(from, to, t));
    viewAnimation = t < 1 ? requestAnimationFrame(step) : 0;
    if (t >= 1) { viewLanding = null; landed(); }
    render();
  };
  viewAnimation = requestAnimationFrame(step);
}

// The view fitView last left, while nothing else has moved it. A drawing
// that is fitted stays fitted: when the pane resizes (the side panel shown or
// hidden, the beat strip coming up) or labels are measured and change the
// drawing's extent, it fits again instead of keeping its old corner.
let fittedSnapshot = null;

/** Fit again if the view is still the one fitView left; true if it did. */
export function refitIfFitted() {
  const v = editor.view;
  if (!fittedSnapshot || ['x', 'y', 'w', 'h'].some((key) => Math.abs(v[key] - fittedSnapshot[key]) > 1e-6)) {
    fittedSnapshot = null;
    return false;
  }
  Object.assign(editor.view, fitTarget());
  editor.viewPane = paneSize();
  fittedSnapshot = { ...editor.view };
  return true;
}

export function fitView({ animate = false } = {}) {
  cancelViewAnimation();
  const target = fitTarget();
  editor.viewPane = paneSize();
  if (animate) {
    // Fitted once it lands: a view still on its way is not yet the fit.
    fittedSnapshot = null;
    animateViewTo(target, undefined, () => { fittedSnapshot = { ...editor.view }; });
    return;
  }
  Object.assign(editor.view, target);
  fittedSnapshot = { ...editor.view };
  render();
}

/** The view that fits the drawing (its ink, a page guide, the selection). */
export function fitTarget() {
  const target = { ...editor.view };
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
  // The ink piece by piece, so the rail may float over an empty corner.
  const rects = editor.circuit.inkRects();
  const b = editor.circuit.inkBounds();
  if (b.w > 0 || b.h > 0) {
    add(b.x, b.y);
    add(b.x + b.w, b.y + b.h);
    // A page guide is part of what the figure will be: fit its edges too.
    if (editor.pageGuide) {
      const frame = circuitPageGuideFrame(editor.circuit, editor.pageGuide);
      add(frame.x, b.y);
      add(frame.x + frame.width, b.y + b.h);
    }
  }
  // Open linked-design bubbles are part of what is on show.
  for (const frame of linkBubbleFrames()) {
    add(frame.x, frame.y);
    add(frame.x + frame.w, frame.y + frame.h);
    rects.push(frame);
  }
  for (const c of selectedComps()) {
    const r = c.bboxWorld();
    add(r.x, r.y);
    add(r.x + r.w, r.y + r.h);
    rects.push(r);
  }
  if (!Number.isFinite(x0)) {
    // An empty canvas has no content to fit. Give it a wider default window so
    // the grid is useful for planning instead of opening at the zoom limit.
    x0 = -600;
    y0 = -600;
    x1 = 600;
    y1 = 600;
  }
  return Object.assign(target, fittedView({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, rects));
}

// Pixels kept between a fitted drawing and the pane's edges, the rail, and windows.
const FIT_MARGIN = 24;

/** What floats over the canvas and would cover a fitted drawing: the tool
 *  rail and the open floating windows, as rectangles in pane pixels. */
function paneObstacles(paneRect, floating) {
  const obstacles = [];
  for (const el of floating) {
    if (!el || el.closest('[hidden]')) continue;
    const r = el.getBoundingClientRect();
    const x0 = Math.max(0, r.left - paneRect.left);
    const y0 = Math.max(0, r.top - paneRect.top);
    const x1 = Math.min(paneRect.width, r.right - paneRect.left);
    const y1 = Math.min(paneRect.height, r.bottom - paneRect.top);
    if (x1 - x0 >= 1 && y1 - y0 >= 1) obstacles.push({ x0, y0, x1, y1 });
  }
  return obstacles;
}

/** The editor view that fits world rectangle `bounds` as F does: as large as
 *  it can be with its ink (`rects`, piece by piece; the whole rectangle when
 *  none are given) clear of the tool rail and the open windows, and at that
 *  size as near the pane's middle as it can be (`fitPlacement`); with no
 *  window open, on the pane's middle line. The Atlas
 *  uses it to aim at where a design will land. */
export function fittedView(bounds, rects = []) {
  const paneRect = document.querySelector('.canvas-pane')?.getBoundingClientRect();
  const paneW = paneRect?.width || 1;
  const paneH = paneRect?.height || 1;
  const box = { x: bounds.x, y: bounds.y, w: Math.max(1, bounds.w), h: Math.max(1, bounds.h) };
  const rail = paneRect ? paneObstacles(paneRect, [document.querySelector('.mode-toolbar')]) : [];
  const windows = paneRect ? paneObstacles(paneRect, document.querySelectorAll('.canvas-pane .floating-window')) : [];
  const { scale, cx, cy } = fitPlacement(paneW, paneH, [...rail, ...windows], box, rects, FIT_MARGIN, { centred: !windows.length });
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
  return {
    x: box.x + box.w / 2 - tw * cx / paneW,
    y: box.y + box.h / 2 - th * cy / paneH,
    w: tw,
    h: th,
  };
}

// ----- the painted frame ------------------------------------------------------------
//
// While the view pans, the drawing is painted beyond the pane by a margin on
// every side (PAN_MARGIN of the view), and moving the view only slides what
// is painted (a compositor move, nothing painted again) until the view nears
// the margin's edge: then it is painted again round the view. Every layer of
// the drawing (the drawing, its math labels, the commit feedback, the wire
// sweep: each an svg in the canvas) takes the same frame and the same slide.

/** How far beyond the pane the drawing is painted while it pans, as a part of the view. */
export const PAN_MARGIN = 0.25;
let paintMargin = 0;

/** Paint the drawing with a margin beyond the pane (`PAN_MARGIN`) or without (0). */
export function setPaintMargin(margin) {
  paintMargin = margin;
}

export function paintMarginNow() {
  return paintMargin;
}

/** The world the drawing is painted over: the view, and the margin round it. */
export function paintedFrame(view = editor.view) {
  const m = paintMargin;
  return { x: view.x - m * view.w, y: view.y - m * view.h, w: view.w * (1 + 2 * m), h: view.h * (1 + 2 * m) };
}

/** The drawing's layers: every svg in the canvas. */
export function drawingLayers() {
  return editor.canvasSvgEl?.parentNode ? [...editor.canvasSvgEl.parentNode.querySelectorAll(':scope > svg')] : [];
}

/** A layer laid over the pane and its margin. */
export function placeLayer(layer) {
  const m = paintMargin;
  layer.style.position = m ? 'absolute' : '';
  layer.style.left = m ? `${-m * 100}%` : '';
  layer.style.top = m ? `${-m * 100}%` : '';
  layer.style.width = m ? `${(1 + 2 * m) * 100}%` : '';
  layer.style.height = m ? `${(1 + 2 * m) * 100}%` : '';
}

/** Slide every layer by `dx`, `dy` (CSS pixels), or put them back (null). */
export function slideLayers(offset) {
  for (const layer of drawingLayers()) {
    layer.style.willChange = offset ? 'transform' : '';
    layer.style.transform = offset ? `translate(${offset.dx}px, ${offset.dy}px)` : '';
  }
}

/** Another layer (math labels, feedback) framed as the drawing is. */
export function frameLike(layer) {
  const drawing = editor.canvasSvgEl;
  if (!drawing) return;
  for (const name of ['width', 'height', 'viewBox']) layer.setAttribute(name, drawing.getAttribute(name));
  placeLayer(layer);
  layer.style.transform = drawing.style.transform;
  layer.style.willChange = drawing.style.willChange;
}

/** Re-frame the committed drawing for the current view: root size, background,
 * and grid. Same output as a full svgString rebuild at this viewport. */
export function applyCanvasViewport() {
  const vp = paintedFrame();
  const frame = viewportFrame(vp);
  editor.canvasSvgEl.setAttribute('width', frame.width);
  editor.canvasSvgEl.setAttribute('height', frame.height);
  editor.canvasSvgEl.setAttribute('viewBox', frame.viewBox);
  placeLayer(editor.canvasSvgEl);
  // The other layers (math labels, feedback, the wire sweep) follow the drawing's frame.
  for (const layer of drawingLayers()) if (layer !== editor.canvasSvgEl) frameLike(layer);
  const background = editor.canvasSvgEl.firstElementChild;
  if (background?.tagName !== 'rect') return;
  for (const [name, value] of Object.entries(frame.background)) background.setAttribute(name, value);
  editor.canvasSvgEl.querySelector(':scope > .grid-line')?.setAttribute('d', viewportGridPath(vp));
}

/** Convert client (pane-relative) coordinates to world, using `refView` for the
 *  mapping. During a pan/zoom drag the reference must be the view captured at
 *  mousedown — mapping against the *live* view creates feedback and makes the
 *  pan stick/stutter. */
export function clientToWorld(clientX, clientY, refView = editor.view) {
  const pane = document.querySelector('.canvas-pane');
  return worldAndCursorFromClient(clientX, clientY, pane.getBoundingClientRect(), refView).world;
}

export function worldToClient(wx, wy, refView = editor.view) {
  const pane = document.querySelector('.canvas-pane');
  const r = pane.getBoundingClientRect();
  return {
    x: r.left + ((wx - refView.x) / refView.w) * r.width,
    y: r.top + ((wy - refView.y) / refView.h) * r.height,
  };
}

export function worldRect(a, b) {
  return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
}

/** True when rect `r` lies COMPLETELY inside `box` (touching an edge counts
 *  as inside). Marquee selection uses containment, not mere intersection, so
 *  a box only captures whole objects. */
export function rectContained(r, box) {
  return r.x >= box.x0 && r.x + r.w <= box.x1 && r.y >= box.y0 && r.y + r.h <= box.y1;
}

export function zoomToWorldRect(r) {
  const pad = 60;
  const aspect = editor.view.w / editor.view.h;
  let tw = r.x1 - r.x0 + pad * 2;
  let th = r.y1 - r.y0 + pad * 2;
  if (tw / th > aspect) th = tw / aspect;
  else tw = th * aspect;
  tw = Math.min(Math.max(tw, minViewW()), maxViewW());
  th = tw / aspect;
  animateViewTo({ x: (r.x0 + r.x1) / 2 - tw / 2, y: (r.y0 + r.y1) / 2 - th / 2, w: tw, h: th });
}
