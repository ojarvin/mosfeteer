/**
 * Net beams (Settings → Display → Net beams): while the pointer is over a
 * net, or a port, supply, ground, or VCM on it, a beam from the cursor
 * (snapped to the grid, as wires are drawn; a supply, ground, or VCM's own
 * terminal) to each other net its name connects it to
 * (src/core/net-beams.js). A browser preference, like the theme. They are
 * drawn by a shader (gpu.js) on a canvas over the drawing, or, without a GPU,
 * in an SVG layer of their own; either only when they change.
 */

import { GRID } from '../core/grid.js';
import { beamShape, netBeams } from '../core/net-beams.js';
import { canvasEl, netBeamsButton } from './elements.js';
import { createShapes, gpuContext } from './gpu.js';
import { hintLine } from './status-bar-ui.js';
import { worldPerPixel } from './align-tool.js';
import { editor } from './editor-state.js';
import { beamGrowth } from './atlas-layout.js';
import { reducedMotion } from './motion.js';

const SETTING_KEY = 'mosfeteer.netBeams';
// A ground or supply net can have many names' worth of partners; past this
// many the beams are a blur, and the nearest ones say enough.
const MOST = 48;
/** How many times quicker than the Atlas's beams these grow and pulse. */
const GROWTH_SPEED = 2.5;

let on = (() => {
  try { return globalThis.localStorage?.getItem(SETTING_KEY) === '1'; } catch { return false; }
})();
let layerEl = null;
let layerKey = '';

export function netBeamsShown() {
  return on;
}

export function setNetBeams(next) {
  on = !!next;
  try { globalThis.localStorage?.setItem(SETTING_KEY, on ? '1' : ''); } catch { /* per-session only */ }
  netBeamsButton?.setAttribute('aria-checked', String(on));
  hintLine(on ? 'net beams on' : 'net beams off');
  syncNetBeams();
}

/** A fresh layer in a newly built canvas, above the editor overlay. */
export function mountNetBeams(svgEl) {
  layerEl = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  layerEl.setAttribute('class', 'net-beams');
  layerEl.setAttribute('pointer-events', 'none');
  svgEl.appendChild(layerEl);
  layerKey = '';
  // A rebuilt canvas empties the pane; the beams' canvas stays on top of it.
  if (gpu) canvasEl.appendChild(gpu.canvas);
}

/** What to draw from the cursor: each beam's end and shape, in world units. */
function currentBeams(from) {
  const target = editor.hoverTarget;
  if (!on || !from || editor.drag || editor.hoverFromPanel || target?.kind !== 'net' || target.ids.length < 2) return null;
  const px = worldPerPixel();
  const size = { narrow: Math.max(2 * px, 0.08 * GRID), wide: Math.max(6 * px, 0.3 * GRID) };
  const beams = netBeams(editor.circuit, target.ids, target.source, from).slice(0, MOST)
    .map(({ to }) => ({ to, shape: beamShape(from, to, size) }))
    .filter(({ shape }) => shape);
  return beams.length ? { from, beams, dot: Math.max(3 * px, 0.1 * GRID) } : null;
}

function beamsSvg(drawn) {
  if (!drawn) return '';
  const { from, beams, dot } = drawn;
  const f = (v) => String(Math.round(v * 10) / 10);
  return beams.map(({ to, shape }, i) => {
    const ends = `gradientUnits="userSpaceOnUse" x1="${f(from.x)}" y1="${f(from.y)}" x2="${f(to.x)}" y2="${f(to.y)}"`;
    return `<linearGradient id="net-beam-${i}" ${ends}><stop offset="0" class="net-beam-end"/><stop offset="0.5" class="net-beam-mid"/><stop offset="1" class="net-beam-end"/></linearGradient>`
      + `<linearGradient id="net-beam-core-${i}" ${ends}><stop offset="0" class="net-beam-core-end"/><stop offset="0.5" class="net-beam-core-mid"/><stop offset="1" class="net-beam-core-end"/></linearGradient>`
      + `<path class="net-beam" d="${shape.outline}" fill="url(#net-beam-${i})"/>`
      + `<path class="net-beam-core" d="${shape.core}" stroke="url(#net-beam-core-${i})" vector-effect="non-scaling-stroke"/>`
      + `<circle class="net-beam-landing" cx="${f(to.x)}" cy="${f(to.y)}" r="${f(dot)}"/>`;
  }).join('');
}

// The same beams in a shader, on a canvas of their own over the drawing;
// the context is only asked for once there is a beam to draw. Without one
// the SVG layer draws them.
let gpu = null;
let gpuTried = false;

function startGpu() {
  gpuTried = true;
  const canvas = document.createElement('canvas');
  canvas.className = 'net-beams-gpu';
  canvas.setAttribute('aria-hidden', 'true');
  const gl = gpuContext(canvas);
  if (!gl) return;
  const build = () => {
    gpu = { canvas, gl, shapes: createShapes(gl), key: '' };
  };
  try {
    build();
  } catch {
    gpu = null;
    return;
  }
  canvas.addEventListener('webglcontextlost', (ev) => {
    ev.preventDefault();
    gpu = null;
    canvas.hidden = true;
    syncNetBeams();
  });
  canvas.addEventListener('webglcontextrestored', () => {
    try { build(); } catch { return; }
    canvas.hidden = false;
    syncNetBeams();
  });
  canvasEl.appendChild(canvas);
}

/** How far the beams have grown since the pointer reached this net. */
function growthNow(drawn) {
  const net = drawn ? editor.hoverTarget?.source : null;
  if (net !== gpu.net) {
    gpu.net = net;
    gpu.netAt = performance.now();
  }
  return drawn && !reducedMotion() ? beamGrowth((performance.now() - gpu.netAt) * GROWTH_SPEED) : { reach: 1, pulse: -1, moving: false };
}

function drawGpu(drawn) {
  const { canvas, gl, shapes } = gpu;
  const growth = growthNow(drawn);
  if (growth.moving && !gpu.frame) {
    gpu.frame = requestAnimationFrame(() => {
      if (gpu) gpu.frame = 0;
      syncNetBeams();
    });
  }
  const { x: vx, y: vy, w: vw } = editor.view;
  const w = canvasEl.clientWidth;
  const h = canvasEl.clientHeight;
  const key = drawn ? JSON.stringify([vx, vy, vw, w, h, document.documentElement.className, drawn.from, drawn.beams.map(({ to }) => to), growth.reach, growth.pulse]) : '';
  if (key === gpu.key) return;
  gpu.key = key;
  canvas.dataset.beams = String(drawn?.beams.length ?? 0);
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  if (!drawn) return;
  shapes.frame(w, h, dpr);
  const k = w / vw;
  const screen = (p) => ({ x: (p.x - vx) * k, y: (p.y - vy) * k });
  const color = getComputedStyle(canvasEl).getPropertyValue('--accent').trim() || '#0e7c7b';
  const dark = document.documentElement.classList.contains('dark');
  const end = dark ? 0.55 : 0.4;
  const mid = dark ? 0.26 : 0.18;
  const from = screen(drawn.from);
  for (const { to, shape } of drawn.beams) {
    const at = screen(to);
    shapes.beam({
      spine: shape.spine.map((p) => ({ ...screen(p), nx: p.nx, ny: p.ny, half: p.half * k })),
      from,
      to: at,
      color,
      band: { stops: [end, mid, end], mid: 0.5 },
      core: { stops: [0.7, 0.25, 0.7], mid: 0.5 },
      coreWidth: 1.2,
      reach: growth.reach,
      pulse: growth.pulse,
    });
    const r = drawn.dot * k;
    // The landing shows once the beam has got there.
    if (growth.reach > 0.95) shapes.box({ rect: { x: at.x - r, y: at.y - r, w: 2 * r, h: 2 * r }, radius: r, fill: color, fillAlpha: 0.45 });
  }
}

/** Draw the beams from the cursor, or clear them. */
export function syncNetBeams() {
  if (!layerEl) return;
  const drawn = currentBeams(editor.hoverTarget?.anchor || editor.cursor);
  if (drawn && !gpuTried) startGpu();
  if (gpu) {
    drawGpu(drawn);
    if (layerKey) layerEl.innerHTML = layerKey = '';
    return;
  }
  const svg = beamsSvg(drawn);
  if (svg === layerKey) return;
  layerKey = svg;
  layerEl.innerHTML = svg;
}

export function installNetBeams() {
  netBeamsButton?.addEventListener('click', () => setNetBeams(!on));
  netBeamsButton?.setAttribute('aria-checked', String(on));
}
