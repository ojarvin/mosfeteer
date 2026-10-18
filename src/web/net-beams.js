/**
 * Net beams (Settings → Display → Net beams): while the pointer is over a
 * net, or a port, supply, ground, or VCM on it, a beam from the cursor
 * (snapped to the grid, as wires are drawn; a supply, ground, or VCM's own
 * terminal) to each other net its name connects it to
 * (src/core/net-beams.js). A browser preference, like the theme. The beams
 * have a layer of their own, written only when they change.
 */

import { GRID } from '../core/grid.js';
import { beamShape, netBeams } from '../core/net-beams.js';
import { netBeamsButton } from './elements.js';
import { hintLine } from './status-bar-ui.js';
import { worldPerPixel } from './align-tool.js';
import { editor } from './editor-state.js';

const SETTING_KEY = 'mosfeteer.netBeams';
// A ground or supply net can have many names' worth of partners; past this
// many the beams are a blur, and the nearest ones say enough.
const MOST = 48;

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
}

function beamsSvg(from) {
  const target = editor.hoverTarget;
  if (!on || !from || editor.drag || editor.hoverFromPanel || target?.kind !== 'net' || target.ids.length < 2) return '';
  const px = worldPerPixel();
  const size = { narrow: Math.max(2 * px, 0.08 * GRID), wide: Math.max(6 * px, 0.3 * GRID) };
  const dot = Math.max(3 * px, 0.1 * GRID);
  const f = (v) => String(Math.round(v * 10) / 10);
  return netBeams(editor.circuit, target.ids, target.source, from).slice(0, MOST).map(({ to }, i) => {
    const shape = beamShape(from, to, size);
    if (!shape) return '';
    const ends = `gradientUnits="userSpaceOnUse" x1="${f(from.x)}" y1="${f(from.y)}" x2="${f(to.x)}" y2="${f(to.y)}"`;
    return `<linearGradient id="net-beam-${i}" ${ends}><stop offset="0" class="net-beam-end"/><stop offset="0.5" class="net-beam-mid"/><stop offset="1" class="net-beam-end"/></linearGradient>`
      + `<linearGradient id="net-beam-core-${i}" ${ends}><stop offset="0" class="net-beam-core-end"/><stop offset="0.5" class="net-beam-core-mid"/><stop offset="1" class="net-beam-core-end"/></linearGradient>`
      + `<path class="net-beam" d="${shape.outline}" fill="url(#net-beam-${i})"/>`
      + `<path class="net-beam-core" d="${shape.core}" stroke="url(#net-beam-core-${i})" vector-effect="non-scaling-stroke"/>`
      + `<circle class="net-beam-landing" cx="${f(to.x)}" cy="${f(to.y)}" r="${f(dot)}"/>`;
  }).join('');
}

/** Draw the beams from the cursor, or clear them. */
export function syncNetBeams() {
  if (!layerEl) return;
  const svg = beamsSvg(editor.hoverTarget?.anchor || editor.cursor);
  if (svg === layerKey) return;
  layerKey = svg;
  layerEl.innerHTML = svg;
}

export function installNetBeams() {
  netBeamsButton?.addEventListener('click', () => setNetBeams(!on));
  netBeamsButton?.setAttribute('aria-checked', String(on));
}
