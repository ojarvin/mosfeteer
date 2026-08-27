import { applyTransform, transformToSvg } from './geometry.js';
import { ceilGrid, floorGrid, GRID } from './grid.js';
import { autoRoute } from './router.js';
import { strokeAttrs } from './style.js';

function fmt(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
function pt(x, y) {
  return `${fmt(x)} ${fmt(y)}`;
}

function graphicsToSvg(g) {
  switch (g.kind) {
    case 'path':
      return `<path d="${g.d}" fill="none" ${strokeAttrs(g.style)}/>`;
    case 'circle':
      return `<circle cx="${fmt(g.cx)}" cy="${fmt(g.cy)}" r="${fmt(g.r)}" fill="#fff" ${strokeAttrs(g.style)}/>`;
    case 'rect':
      return `<rect x="${fmt(g.x)}" y="${fmt(g.y)}" width="${fmt(g.w)}" height="${fmt(g.h)}" fill="#fff" ${strokeAttrs(g.style)}/>`;
    case 'dot':
      // Solder dot: a plain black dot marking a connection at a wire crossing.
      return `<circle cx="${fmt(g.cx)}" cy="${fmt(g.cy)}" r="${fmt(g.r)}" fill="${g.fill || '#111'}" stroke="none"/>`;
    default:
      return '';
  }
}

function textEl(x, y, text, anchor, size, fill) {
  return `<text x="${fmt(x)}" y="${fmt(y)}" text-anchor="${anchor || 'middle'}" font-family="sans-serif" font-size="${size || 12}" fill="${fill || '#111'}" stroke="none">${text}</text>`;
}

/**
 * Render a Circuit to an SVG string.
 * opts.grid: draw the coarse 40-unit grid. opts.terminals / opts.junctions:
 * draw terminal dots / net junction dots. opts.background: white rect.
 * opts.netNames: label nets by name. opts.includeBBox: draw component bboxes.
 * opts.viewport {x,y,w,h}: fixed world window to render (infinite canvas). When
 * absent, the view auto-fits the circuit contents (used for exports / PNG).
 */
export function svgString(circuit, opts = {}) {
  const o = { grid: false, terminals: true, junctions: true, background: true, netNames: false, includeBBox: false, ...opts };
  const b = circuit.bounds(o.grid || o.background ? 0 : 20);
  const vp = o.viewport;
  const empty = b.w <= 0 && b.h <= 0;
  if (empty && !vp) {
    const w = 400;
    const h = 200;
    const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`];
    parts.push(`<rect width="${w}" height="${h}" fill="#fff"/>`);
    if (o.grid) {
      for (let x = 0; x <= w; x += GRID) parts.push(`<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="#eee" stroke-width="1"/>`);
      for (let y = 0; y <= h; y += GRID) parts.push(`<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="#eee" stroke-width="1"/>`);
    }
    parts.push(textEl(w / 2, h / 2, 'empty schematic', 'middle', 16, '#999'));
    parts.push('</svg>');
    return parts.join('\n');
  }

  // Extents to draw (in world units). With a viewport the window is the exact
  // view (so free panning never rescales the drawing); without one, the view
  // auto-fits the circuit contents (exports / PNG).
  const pad = o.grid && !vp ? 0 : 40;
  const x0 = vp ? vp.x : floorGrid(b.x) - pad;
  const y0 = vp ? vp.y : floorGrid(b.y) - pad;
  const x1 = vp ? vp.x + vp.w : ceilGrid(b.x + b.w) + pad;
  const y1 = vp ? vp.y + vp.h : ceilGrid(b.y + b.h) + pad;
  const W = x1 - x0;
  const H = y1 - y0;

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${fmt(x0)} ${fmt(y0)} ${fmt(W)} ${fmt(H)}">`,
  ];

  if (o.background) parts.push(`<rect x="${fmt(x0)}" y="${fmt(y0)}" width="${fmt(W)}" height="${fmt(H)}" fill="#fff"/>`);

  if (empty) parts.push(textEl(x0 + W / 2, y0 + H / 2, 'empty schematic', 'middle', 16, '#999'));

  if (o.grid) {
    if (vp) {
      for (let x = ceilGrid(vp.x); x <= ceilGrid(vp.x + vp.w); x += GRID) {
        parts.push(`<line x1="${fmt(x)}" y1="${fmt(y0)}" x2="${fmt(x)}" y2="${fmt(y1)}" stroke="#e9e9e9" stroke-width="1"/>`);
      }
      for (let y = ceilGrid(vp.y); y <= ceilGrid(vp.y + vp.h); y += GRID) {
        parts.push(`<line x1="${fmt(x0)}" y1="${fmt(y)}" x2="${fmt(x1)}" y2="${fmt(y)}" stroke="#e9e9e9" stroke-width="1"/>`);
      }
    } else {
      for (let x = x0; x <= x1; x += GRID) {
        parts.push(`<line x1="${fmt(x)}" y1="${fmt(y0)}" x2="${fmt(x)}" y2="${fmt(y1)}" stroke="#e9e9e9" stroke-width="1"/>`);
      }
      for (let y = y0; y <= y1; y += GRID) {
        parts.push(`<line x1="${fmt(x0)}" y1="${fmt(y)}" x2="${fmt(x1)}" y2="${fmt(y)}" stroke="#e9e9e9" stroke-width="1"/>`);
      }
    }
  }

  // Nets first so components draw on top of wire ends.
  for (const net of circuit.nets.values()) {
    const pts = net.points();
    if (pts.length < 2) continue;
    const d = pts.map((p, i) => (i === 0 ? `M ${pt(p.x, p.y)}` : `L ${pt(p.x, p.y)}`)).join(' ');
    parts.push(`<path d="${d}" fill="none" ${strokeAttrs()}/>`);
    if (o.netNames && net.name) {
      const mid = pts[Math.floor(pts.length / 2)];
      parts.push(textEl(mid.x + 6, mid.y - 6, net.name, 'start', 11, '#666'));
    }
  }

  // Junction dots at multi-terminal net connection points.
  if (o.junctions) {
    for (const net of circuit.nets.values()) {
      if (net.terminals.length < 3) continue;
      for (const { comp, term } of net.terminals) {
        const c = circuit.components.get(comp);
        if (!c) continue;
        const p = c.terminalWorld(term);
        parts.push(`<circle cx="${fmt(p.x)}" cy="${fmt(p.y)}" r="3.5" fill="#292929"/>`);
      }
    }
  }

  // Components.
  const comps = [...circuit.components.values()].sort((a, b) => a.refdes.localeCompare(b.refdes));
  for (const c of comps) {
    const t = c.transform;
    parts.push(`<g transform="${transformToSvg(t)}"><g class="sym" data-ref="${c.refdes}">`);
    for (const g of c.def.graphics) parts.push(graphicsToSvg(g));
    parts.push('</g></g>');
    if (o.includeBBox) {
      const r = c.bboxWorld();
      parts.push(`<rect x="${fmt(r.x)}" y="${fmt(r.y)}" width="${fmt(r.w)}" height="${fmt(r.h)}" fill="none" stroke="#0a8" stroke-dasharray="4 4" stroke-width="1"/>`);
    }
  }

  // Terminal dots.
  if (o.terminals) {
    for (const c of comps) {
      for (const { x, y } of c.worldTerminals()) {
        parts.push(`<circle cx="${fmt(x)}" cy="${fmt(y)}" r="3" fill="#111"/>`);
      }
    }
  }

  // Labels (drawn upright, never mirrored).
  for (const c of comps) {
    const def = c.def;
    if (def.refPrefix && def.refPos) {
      const p = applyTransform(c.transform, def.refPos.x, def.refPos.y);
      parts.push(textEl(p.x, p.y, c.refdes, def.refPos.anchor, 12));
    }
    if (def.textPos && c.value !== undefined && c.value !== '') {
      const p = applyTransform(c.transform, def.textPos.x, def.textPos.y);
      parts.push(textEl(p.x, p.y, c.value, def.textPos.anchor, 12, '#333'));
    }
  }

  parts.push('</svg>');
  return parts.join('\n');
}

/**
 * Editor-only overlays rendered on top of svgString output.
 * opts.cursor {x,y}: grid cursor (small gray circle). opts.selection [refdes]:
 * halos around each selected component's bbox. opts.nets [net]: highlight
 * (select) net routes. opts.rubber {x0,y0,x1,y1,color}: marquee/zoom box.
 * opts.wirePreview {from:{x,y},to:{x,y}}: dashed routed preview line.
 */
export function editorOverlay(circuit, opts = {}) {
  const parts = [];
  const halo = (r) =>
    `<rect x="${fmt(r.x)}" y="${fmt(r.y)}" width="${fmt(r.w)}" height="${fmt(r.h)}" fill="none" stroke="#4f9cf9" stroke-width="2" rx="3"/>`;

  for (const ref of opts.selection || []) {
    const c = circuit.components.get(ref);
    if (c) parts.push(halo(c.bboxWorld()));
  }

  for (const net of opts.nets || []) {
    const pts = net && typeof net.points === 'function' ? net.points() : net;
    if (!pts || pts.length < 2) continue;
    const d = pts.map((p, i) => (i === 0 ? `M ${pt(p.x, p.y)}` : `L ${pt(p.x, p.y)}`)).join(' ');
    parts.push(`<path d="${d}" fill="none" stroke="#4f9cf9" stroke-width="6" opacity="0.25"/>`);
    parts.push(`<path d="${d}" fill="none" stroke="#4f9cf9" stroke-width="1.6"/>`);
  }

  if (opts.rubber) {
    const r = opts.rubber;
    const x = Math.min(r.x0, r.x1);
    const y = Math.min(r.y0, r.y1);
    const w = Math.abs(r.x1 - r.x0);
    const h = Math.abs(r.y1 - r.y0);
    const color = r.color || '#4f9cf9';
    parts.push(`<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" fill="${color}" opacity="0.12" stroke="${color}" stroke-width="1.4" stroke-dasharray="5 4"/>`);
  }

  if (opts.wirePreview) {
    const from = opts.wirePreview.from;
    const pts = opts.wirePreview.pts || autoRoute([{ x: from.x, y: from.y }, { x: opts.wirePreview.to.x, y: opts.wirePreview.to.y }]);
    if (pts && pts.length >= 2) {
      const d = pts.map((p, i) => (i === 0 ? `M ${pt(p.x, p.y)}` : `L ${pt(p.x, p.y)}`)).join(' ');
      parts.push(`<path d="${d}" fill="none" stroke="#4f9cf9" stroke-width="2" stroke-dasharray="6 5"/>`);
    }
    parts.push(`<circle cx="${fmt(from.x)}" cy="${fmt(from.y)}" r="4.5" fill="#4f9cf9"/>`);
  }

  if (opts.cursor) {
    const { x, y } = opts.cursor;
    parts.push(`<circle cx="${fmt(x)}" cy="${fmt(y)}" r="4" fill="#7a7d85" stroke="#3d4046" stroke-width="1.5"/>`);
  }

  return parts.join('\n');
}