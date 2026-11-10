/**
 * A design shown in the editor greets with one sweep of light along its
 * wires, left to right: its wires (the drawing's own wire ink) drawn again in
 * the accent, soft, seen only through a band that runs across the drawing.
 * Its own layer over the drawing, following its frame, gone when it is done.
 * Reduced motion skips it.
 */

import { canvasEl } from './elements.js';
import { editor } from './editor-state.js';
import { afterRender, onDocumentShown } from './main.js';
import { reducedMotion } from './motion.js';
import { easeInOut } from './easing.js';

const SVG = 'http://www.w3.org/2000/svg';
/** How long the light takes to cross, and how long after the design shows it starts. */
const SWEEP_MS = 1800;
const SWEEP_DELAY_MS = 220;
/** How wide its band is, as a part of the drawing's width. */
const BAND = 0.18;

let sweep = null;

function stop() {
  if (!sweep) return;
  cancelAnimationFrame(sweep.frame);
  clearTimeout(sweep.timer);
  sweep.layer?.remove();
  sweep.unwatch?.();
  sweep = null;
}

/** The layer takes the drawing's frame, as the math labels' layer does. */
function follow() {
  const drawing = editor.canvasSvgEl;
  if (!sweep?.layer || !drawing) return;
  for (const name of ['width', 'height', 'viewBox']) sweep.layer.setAttribute(name, drawing.getAttribute(name));
}

function begin() {
  const ink = editor.canvasSvgEl?.querySelector('path.wire-ink');
  const d = ink?.getAttribute('d');
  if (!d) {
    stop();
    return;
  }
  const box = ink.getBBox();
  if (!(box.width > 0)) {
    stop();
    return;
  }
  const width = parseFloat(ink.getAttribute('stroke-width')) || 6;
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4f9cf9';
  const layer = document.createElementNS(SVG, 'svg');
  layer.setAttribute('class', 'wire-sweep');
  layer.setAttribute('aria-hidden', 'true');
  layer.innerHTML = `<defs>
      <linearGradient id="wire-sweep-band" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="${accent}" stop-opacity="0"/>
        <stop offset="0.5" stop-color="${accent}" stop-opacity="1"/>
        <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
      </linearGradient>
      <filter id="wire-sweep-glow" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="${width * 1.2}"/></filter>
    </defs>
    <path d="${d}" fill="none" stroke="url(#wire-sweep-band)" stroke-width="${width * 3}" stroke-linecap="round" stroke-linejoin="round" opacity="0.55" filter="url(#wire-sweep-glow)"/>
    <path d="${d}" fill="none" stroke="url(#wire-sweep-band)" stroke-width="${width}" stroke-linecap="square" stroke-linejoin="miter"/>`;
  canvasEl.appendChild(layer);
  sweep.layer = layer;
  follow();
  const gradient = layer.querySelector('linearGradient');
  const band = Math.max(box.width * BAND, width * 12);
  const from = box.x - band;
  const to = box.x + box.width + band;
  const started = performance.now();
  const step = (now) => {
    if (!sweep || sweep.layer !== layer) return;
    const t = Math.min(1, (now - started) / SWEEP_MS);
    const middle = from + (to - from) * easeInOut(t);
    gradient.setAttribute('x1', String(middle - band / 2));
    gradient.setAttribute('x2', String(middle + band / 2));
    if (t < 1) sweep.frame = requestAnimationFrame(step);
    else stop();
  };
  sweep.frame = requestAnimationFrame(step);
}

/** Sweep the wires of the design now shown. */
export function sweepWires() {
  stop();
  if (reducedMotion()) return;
  sweep = { layer: null, frame: 0, timer: 0, unwatch: afterRender(follow) };
  sweep.timer = setTimeout(begin, SWEEP_DELAY_MS);
}

export function installWireSweep() {
  onDocumentShown(sweepWires);
}
