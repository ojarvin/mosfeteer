import { blockArrowGeometry } from './block-router.js';
import { GRID } from './grid.js';
import { parseLabelRuns } from './model.js';
import { resolveColor, styleAttrs } from './style.js';

const esc = (s) => String(s).replace(/[&<>\"]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
const n = (v) => Number.isInteger(v) ? v : Number(v.toFixed(2));
const point = (p) => `${n(p.x)} ${n(p.y)}`;
const same = (a, b) => a.x === b.x && a.y === b.y;

function labelText(label, selected = false) {
  const p = label.textPos ? label.textPos() : { x: label.anchor.x, y: label.anchor.y, anchor: 'middle' };
  const style = label.style || {};
  const clsName = label.connectorId ? 'block-net-label' : 'block-label';
  const cls = selected ? ` class="${clsName} selected"` : ` class="${clsName}"`;
  const runs = parseLabelRuns(label.text);
  const body = runs.map((run) => run.sub || run.super
    ? `<tspan ${run.sub ? 'baseline-shift="-6px"' : 'baseline-shift="6px"'} font-size="0.62em">${esc(run.text)}</tspan>`
    : esc(run.text)).join('');
  return `<text data-label-id="${esc(label.id)}"${cls} x="${n(p.x)}" y="${n(p.y)}" text-anchor="${p.anchor || 'middle'}" dominant-baseline="middle" font-family="sans-serif" font-size="${style.width === 'thin' ? 32 : style.width === 'thick' ? 44 : 38}" font-weight="${style.bold === false ? 'normal' : 'bold'}" font-style="${style.italic === false ? 'normal' : 'italic'}" fill="${esc(resolveColor(style.color || '#111'))}">${body}</text>`;
}

function annotationHandles(label) {
  const points = label.kind === 'line'
    ? label.points.map((p, index) => [`vertex:${index}`, p])
    : label.kind === 'box'
      ? (() => {
          const x0 = Math.min(label.anchor.x, label.end.x); const x1 = Math.max(label.anchor.x, label.end.x);
          const y0 = Math.min(label.anchor.y, label.end.y); const y1 = Math.max(label.anchor.y, label.end.y);
          return [['corner:top-left', { x: x0, y: y0 }], ['corner:top-right', { x: x1, y: y0 }], ['corner:bottom-right', { x: x1, y: y1 }], ['corner:bottom-left', { x: x0, y: y1 }]];
        })()
      : [['start', label.anchor], ['end', label.end]];
  return `<g class="block-annotation-handles" data-annotation-handle-id="${esc(label.id)}">${points.map(([name, p]) => `<circle data-annotation-endpoint="${esc(`${label.id}:${name}`)}" cx="${n(p.x)}" cy="${n(p.y)}" r="8" fill="var(--accent, #4f9cf9)" stroke="var(--paper, #fff)" stroke-width="2"/>`).join('')}</g>`;
}

function annotationSvg(label, selected) {
  const style = styleAttrs(label.style, label.kind === 'line' ? 'wire' : 'symbol');
  const cls = selected ? ' selected' : '';
  if (label.kind === 'line') {
    const d = label.points.map((p, i) => `${i ? 'L' : 'M'} ${point(p)}`).join(' ');
    return `<path data-label-id="${esc(label.id)}" class="block-annotation block-line${cls}" d="${d}" fill="none" ${style}/>`;
  }
  const a = label.anchor; const b = label.end;
  if (label.kind === 'box') {
    const x = Math.min(a.x, b.x); const y = Math.min(a.y, b.y);
    return `<rect data-label-id="${esc(label.id)}" class="block-annotation block-box${cls}" x="${n(x)}" y="${n(y)}" width="${n(Math.abs(b.x - a.x))}" height="${n(Math.abs(b.y - a.y))}" fill="none" ${style}/>`;
  }
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const shaft = { x: b.x - 32 * Math.cos(angle), y: b.y - 32 * Math.sin(angle) };
  const left = { x: shaft.x + 18 * Math.sin(angle), y: shaft.y - 18 * Math.cos(angle) };
  const right = { x: shaft.x - 18 * Math.sin(angle), y: shaft.y + 18 * Math.cos(angle) };
  const color = esc(resolveColor(label.style?.color || '#111'));
  return `<g data-label-id="${esc(label.id)}" class="block-annotation block-arrow${cls}"><path d="M ${point(a)} L ${point(shaft)}" fill="none" ${style}/><polygon points="${point(b)} ${point(left)} ${point(right)}" fill="${color}" stroke="none"/></g>`;
}

function arrowSvg(arrow, selected) {
  const g = blockArrowGeometry(arrow.points);
  const attrs = styleAttrs(arrow.style, 'wire');
  const cls = selected ? ' selected' : '';
  const paths = [];
  for (let i = 1; i < g.shaftPoints.length; i++) {
    const a = g.shaftPoints[i - 1]; const b = g.shaftPoints[i];
    if (same(a, b)) continue;
    paths.push(`<path data-arrow-segment="${esc(`${arrow.id}:${i}`)}" d="M ${point(a)} L ${point(b)}" fill="none" ${attrs}/>`);
  }
  const color = esc(resolveColor(arrow.style?.color || '#111'));
  return `<g data-arrow-id="${esc(arrow.id)}" class="block-connector${cls}">${paths.join('')}<polygon points="${point(g.tip)} ${point(g.left)} ${point(g.right)}" fill="${color}" stroke="none"/></g>`;
}

/** Render a block document. Browser interaction options intentionally control
 * terminal visibility and handles; exports can leave both at their defaults. */
export function blockSvgString(diagram, options = {}) {
  const b = diagram.bounds(); const pad = options.padding ?? GRID;
  const x = options.viewport?.x ?? b.x - pad; const y = options.viewport?.y ?? b.y - pad;
  const w = options.viewport?.w ?? Math.max(GRID * 4, b.w + pad * 2); const h = options.viewport?.h ?? Math.max(GRID * 3, b.h + pad * 2);
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${n(w)}" height="${n(h)}" viewBox="${n(x)} ${n(y)} ${n(w)} ${n(h)}">`];
  if (options.background !== false) out.push(`<rect class="block-background" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${options.backgroundColor || 'var(--paper, #fff)'}"/>`);
  if (options.grid) {
    const id = `block-grid-${Math.abs(Math.round(x + y + w + h))}`;
    out.push(`<defs><pattern id="${id}" width="${GRID}" height="${GRID}" patternUnits="userSpaceOnUse"><path d="M ${GRID} 0H0V ${GRID}" fill="none" stroke="var(--grid, #ddd)" stroke-width="1"/></pattern></defs>`);
    out.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="url(#${id})"/>`);
  }
  if (options.cursor && options.cursorCrosshair) {
    const v = options.cursorCrosshair; const c = options.cursor;
    out.push(`<path class="editor-cursor-crosshair" d="M ${n(v.x)} ${n(c.y)} L ${n(v.x + v.w)} ${n(c.y)} M ${n(c.x)} ${n(v.y)} L ${n(c.x)} ${n(v.y + v.h)}" fill="none"/>`);
  }
  if (options.rubber) {
    const r = options.rubber;
    out.push(`<rect class="editor-rubber-band" x="${n(r.x0)}" y="${n(r.y0)}" width="${n(r.x1 - r.x0)}" height="${n(r.y1 - r.y0)}" fill="none" stroke="${esc(r.color || 'var(--accent, #4f9cf9)')}" stroke-width="3" stroke-dasharray="8 6"/>`);
  }
  const selectedArrows = options.selectedArrows instanceof Set ? options.selectedArrows : new Set(options.selectedArrows || []);
  const selectedBlocks = options.selectedBlocks instanceof Set ? options.selectedBlocks : new Set(options.selectedBlocks || []);
  const selectedLabels = options.selectedLabels instanceof Set ? options.selectedLabels : new Set(options.selectedLabels || []);
  const labels = [...(diagram.labels?.values?.() || [])];
  const preview = options.annotationPreview;
  if (preview?.kind === 'line' && preview.points?.length > 1) {
    out.push(`<path class="annotation-preview block-line" d="${preview.points.map((p, i) => `${i ? 'L' : 'M'} ${point(p)}`).join(' ')}" fill="none" stroke="var(--accent, #4f9cf9)" stroke-width="4" stroke-dasharray="8 6"/>`);
  } else if (preview?.a && preview?.b) {
    const a = preview.a; const b = preview.b;
    if (preview.kind === 'box') out.push(`<rect class="annotation-preview block-box" x="${n(Math.min(a.x, b.x))}" y="${n(Math.min(a.y, b.y))}" width="${n(Math.abs(b.x - a.x))}" height="${n(Math.abs(b.y - a.y))}" fill="none" stroke="var(--accent, #4f9cf9)" stroke-width="4" stroke-dasharray="8 6"/>`);
    else out.push(`<path class="annotation-preview block-arrow" d="M ${point(a)} L ${point(b)}" fill="none" stroke="var(--accent, #4f9cf9)" stroke-width="4" stroke-dasharray="8 6"/>`);
  }
  for (const label of labels.filter((item) => ['arrow', 'box', 'line'].includes(item.kind)).sort((a, b) => a.drawOrder - b.drawOrder)) {
    const selected = selectedLabels.has(label.id);
    out.push(annotationSvg(label, selected));
    if (label.kind !== 'line') out.push(labelText(label, selected));
    for (const child of labels.filter((item) => item.parent === label.id)) out.push(labelText(child, selectedLabels.has(child.id) || selected));
    if (selected) out.push(annotationHandles(label));
  }
  const connectorPreview = options.connectorPreview;
  if (connectorPreview?.source && connectorPreview?.cursor) {
    const points = [connectorPreview.source, ...(connectorPreview.points || []), connectorPreview.cursor];
    if (points.length > 1) out.push(`<path class="connector-preview" d="${points.map((p, i) => `${i ? 'L' : 'M'} ${point(p)}`).join(' ')}" fill="none" stroke="var(--accent, #4f9cf9)" stroke-width="4" stroke-dasharray="8 6" stroke-linecap="round"/>`);
  }
  for (const arrow of [...diagram.arrows.values()].sort((a, b) => a.drawOrder - b.drawOrder)) {
    if (arrow.points?.length >= 2) out.push(arrowSvg(arrow, selectedArrows.has(arrow.id)));
  }
  const showTerminals = options.terminals !== false;
  for (const block of [...diagram.blocks.values()].sort((a, b) => a.drawOrder - b.drawOrder)) {
    const r = block.rect; const color = esc(resolveColor(block.style?.color || '#111'));
    const selected = selectedBlocks.has(block.id);
    out.push(`<g data-block-id="${esc(block.id)}"><rect class="block-node${selected ? ' selected' : ''}" x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}" fill="var(--paper, #fff)" ${styleAttrs(block.style)}/>`);
    if (showTerminals) for (const terminal of block.terminals.values()) {
      const p = terminal.point(r);
      out.push(`<circle data-block-terminal="${esc(`${block.id}.${terminal.id}`)}" cx="${n(p.x)}" cy="${n(p.y)}" r="6" fill="${color}"/>`);
    }
    const p = block.labelPosition(); const style = block.style || {};
    out.push(`<text x="${n(p.x)}" y="${n(p.y)}" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="38" font-weight="${style.bold === false ? 'normal' : 'bold'}" font-style="${style.italic === false ? 'normal' : 'italic'}" fill="${color}">${esc(block.text)}</text></g>`);
    if (selected && options.resizeHandles !== false) {
      const handles = [
        ['nw', r.x, r.y], ['n', r.x + r.w / 2, r.y], ['ne', r.x + r.w, r.y],
        ['e', r.x + r.w, r.y + r.h / 2], ['se', r.x + r.w, r.y + r.h],
        ['s', r.x + r.w / 2, r.y + r.h], ['sw', r.x, r.y + r.h], ['w', r.x, r.y + r.h / 2],
      ];
      out.push(`<g class="block-resize-handles" data-block-resize-id="${esc(block.id)}">${handles.map(([name, hx, hy]) => `<rect data-block-handle="${name}" x="${n(hx - 7)}" y="${n(hy - 7)}" width="14" height="14" rx="2" fill="var(--accent, #4f9cf9)" stroke="var(--paper, #fff)" stroke-width="2"/>`).join('')}</g>`);
    }
  }
  for (const label of labels.filter((item) => item.kind === 'label' && !item.parent)) out.push(labelText(label, selectedLabels.has(label.id)));
  const ghostLabels = options.ghostLabels || [];
  for (const label of ghostLabels) out.push(`<g class="block-ghost block-label-ghost" opacity="0.38">${labelText(label, false)}</g>`);
  const ghostArrows = options.ghostArrows || [];
  for (const arrow of ghostArrows) {
    if (arrow.points?.length >= 2) out.push(`<g class="block-ghost block-connector-ghost" opacity="0.38">${arrowSvg({ ...arrow, id: `ghost-${arrow.id || 'connector'}` }, false).replace(/ data-arrow-id="[^"]*"/, '')}</g>`);
  }
  const ghosts = options.ghostBlocks?.length ? options.ghostBlocks : options.ghostBlock ? [options.ghostBlock] : [];
  for (const ghost of ghosts) {
    const r = ghost.rect; out.push(`<g class="block-ghost"><rect x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}" fill="var(--paper, #fff)" stroke="var(--accent, #4f9cf9)" stroke-width="4" stroke-dasharray="8 6"/><text x="${n(r.x + r.w / 2)}" y="${n(r.y + r.h / 2)}" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="38" font-weight="bold">${esc(ghost.text || 'Block')}</text></g>`);
  }
  out.push('</svg>'); return out.join('\n');
}
export const renderBlockDiagram = blockSvgString;
