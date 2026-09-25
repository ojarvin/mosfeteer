/**
 * The canvas view: the world window the pane shows, its zoom limits, fitting
 * and animating it, and converting between screen and world coordinates.
 */

import { circuitPageGuideFrame } from '../core/page-guide.js';
import { viewportFrame, viewportGridPath } from '../core/render.js';
import { snap, GRID } from '../core/grid.js';
import { viewFollowingCursor, worldAndCursorFromClient } from './interaction.js';
import { lerpView } from './gestures.js';
import { editor } from './editor-state.js';
import { render, selectedComps } from './main.js';

export function paneSize() {
  const pane = document.querySelector('.canvas-pane');
  if (!pane) return null;
  const r = pane.getBoundingClientRect();
  if (r.width < 10 || r.height < 10) return null;
  return { w: r.width, h: r.height };
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
let viewAnimation = 0;

export function prefersReducedMotion() {
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export function cancelViewAnimation() {
  if (viewAnimation) cancelAnimationFrame(viewAnimation);
  viewAnimation = 0;
}

export function animateViewTo(target, ms = 200) {
  cancelViewAnimation();
  const from = { ...editor.view };
  const to = { x: target.x, y: target.y, w: target.w, h: target.h };
  if (prefersReducedMotion() || document.hidden) {
    Object.assign(editor.view, to);
    render();
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const t = (now - start) / ms;
    Object.assign(editor.view, lerpView(from, to, t));
    viewAnimation = t < 1 ? requestAnimationFrame(step) : 0;
    render();
  };
  viewAnimation = requestAnimationFrame(step);
}

export function fitView({ animate = false } = {}) {
  cancelViewAnimation();
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
  target.w = tw;
  target.h = th;
  target.x = (x0 + x1) / 2 - tw * usableCenterPx / paneW;
  target.y = (y0 + y1) / 2 - th * usableCenterPy / paneH;
  editor.viewPane = paneSize();
  if (animate) {
    animateViewTo(target);
    return;
  }
  Object.assign(editor.view, target);
  render();
}

/** Re-frame the committed drawing for the current view: root size, background,
 * and grid. Same output as a full svgString rebuild at this viewport. */
export function applyCanvasViewport() {
  const vp = { x: editor.view.x, y: editor.view.y, w: editor.view.w, h: editor.view.h };
  const frame = viewportFrame(vp);
  editor.canvasSvgEl.setAttribute('width', frame.width);
  editor.canvasSvgEl.setAttribute('height', frame.height);
  editor.canvasSvgEl.setAttribute('viewBox', frame.viewBox);
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
