import { blockConnectorJunctions } from './block-router.js';
import { GRID } from './grid.js';
import { LABEL_FONT_SIZE, parseLabelRuns } from './model.js';
import { escapeSvg, resolveColor, styleAttrs, themeInkSvg } from './style.js';
import { defaultArrowhead, polylineArrowheads } from './line-style.js';

const n = (v) => Number.isInteger(v) ? v : Number(v.toFixed(2));
const point = (p) => `${n(p.x)} ${n(p.y)}`;
const same = (a, b) => a.x === b.x && a.y === b.y;
const pathD = (points) => points.map((p, i) => `${i ? 'L' : 'M'} ${point(p)}`).join(' ');

function arrowheadsSvg(heads, color) {
  return heads.map((head) => `<polygon points="${point(head.tip)} ${point(head.left)} ${point(head.right)}" fill="${escapeSvg(resolveColor(color || '#111'))}" stroke="none"/>`).join('');
}

function styledPolylineSvg(points, style, base, fallback = 'none') {
  const geometry = polylineArrowheads(points, style?.arrowhead, { fallback });
  if (geometry.shaftPoints.length < 2) return '';
  return `<path d="${pathD(geometry.shaftPoints)}" fill="none" ${styleAttrs(style, base)}/>${arrowheadsSvg(geometry.heads, style?.color)}`;
}

function labelText(label, selected = false) {
  const p = label.textPos ? label.textPos() : { x: label.anchor.x, y: label.anchor.y, anchor: 'middle' };
  const style = label.style || {};
  const clsName = label.connectorId ? 'block-net-label' : 'block-label';
  const cls = selected ? ` class="${clsName} selected"` : ` class="${clsName}"`;
  const runs = parseLabelRuns(label.text);
  const lines = [[]];
  for (const run of runs) {
    const parts = String(run.text).split('\n');
    parts.forEach((part, index) => {
      if (part) lines.at(-1).push({ ...run, text: part });
      if (index < parts.length - 1) lines.push([]);
    });
  }
  const renderRuns = (line) => line.map((run) => run.sub || run.super
    ? `<tspan ${run.sub ? 'baseline-shift="-6px"' : 'baseline-shift="6px"'} font-size="0.62em">${escapeSvg(run.text)}</tspan>`
    : escapeSvg(run.text)).join('');
  const body = lines.length === 1
    ? renderRuns(lines[0])
    : lines.map((line, lineIndex) => `<tspan x="${n(p.x)}" dy="${lineIndex ? LABEL_FONT_SIZE : 0}">${renderRuns(line)}</tspan>`).join('');
  return `<text data-label-id="${escapeSvg(label.id)}"${cls} x="${n(p.x)}" y="${n(p.y)}" text-anchor="${p.anchor || 'middle'}" dominant-baseline="middle" font-family="sans-serif" font-size="${style.width === 'thin' ? 32 : style.width === 'thick' ? 44 : 38}" font-weight="${style.bold === false ? 'normal' : 'bold'}" font-style="${style.italic === false ? 'normal' : 'italic'}" fill="${escapeSvg(resolveColor(style.color || '#111'))}">${body}</text>`;
}

function annotationHandles(label) {
  const points = ['arrow', 'line'].includes(label.kind)
    ? label.points.map((p, index) => [`vertex:${index}`, p])
    : label.kind === 'box'
      ? (() => {
          const x0 = Math.min(label.anchor.x, label.end.x); const x1 = Math.max(label.anchor.x, label.end.x);
          const y0 = Math.min(label.anchor.y, label.end.y); const y1 = Math.max(label.anchor.y, label.end.y);
          return [['corner:top-left', { x: x0, y: y0 }], ['corner:top-right', { x: x1, y: y0 }], ['corner:bottom-right', { x: x1, y: y1 }], ['corner:bottom-left', { x: x0, y: y1 }]];
        })()
      : [['start', label.anchor], ['end', label.end]];
  return `<g class="block-annotation-handles" data-annotation-handle-id="${escapeSvg(label.id)}">${points.map(([name, p]) => `<circle data-annotation-endpoint="${escapeSvg(`${label.id}:${name}`)}" cx="${n(p.x)}" cy="${n(p.y)}" r="8" fill="var(--accent, #4f9cf9)" stroke="var(--paper, #fff)" stroke-width="2"/>`).join('')}</g>`;
}

function annotationSvg(label, selected) {
  const cls = selected ? ' selected' : '';
  if (label.kind === 'line' || label.kind === 'arrow') {
    const points = label.points?.length ? label.points : [label.anchor, label.end];
    const base = label.kind === 'line' ? 'wire' : 'symbol';
    return `<g data-label-id="${escapeSvg(label.id)}" class="block-annotation block-${label.kind}${cls}">${styledPolylineSvg(points, label.style, base, defaultArrowhead(label.kind))}</g>`;
  }
  const style = styleAttrs(label.style, 'symbol');
  const a = label.anchor; const b = label.end;
  if (label.kind === 'box') {
    const x = Math.min(a.x, b.x); const y = Math.min(a.y, b.y);
    return `<rect data-label-id="${escapeSvg(label.id)}" class="block-annotation block-box${cls}" x="${n(x)}" y="${n(y)}" width="${n(Math.abs(b.x - a.x))}" height="${n(Math.abs(b.y - a.y))}" fill="none" ${style}/>`;
  }
  return `<g data-label-id="${escapeSvg(label.id)}" class="block-annotation block-box${cls}"><rect x="${n(Math.min(a.x, b.x))}" y="${n(Math.min(a.y, b.y))}" width="${n(Math.abs(b.x - a.x))}" height="${n(Math.abs(b.y - a.y))}" fill="none" ${style}/></g>`;
}

function arrowSvg(arrow, selected, omitHead = false, selectedSegments = new Set()) {
  const g = polylineArrowheads(arrow.points, arrow.style?.arrowhead, { fallback: 'end' });
  const attrs = styleAttrs(arrow.style, 'annotation');
  const cls = selected ? ' selected' : '';
  const paths = [];
  for (let i = 1; i < g.shaftPoints.length; i++) {
    const a = g.shaftPoints[i - 1]; const b = g.shaftPoints[i];
    if (same(a, b)) continue;
    const key = `${arrow.id}:${i}`;
    paths.push(`<path data-arrow-segment="${escapeSvg(key)}"${selectedSegments.has(key) ? ' class="selected"' : ''} d="M ${point(a)} L ${point(b)}" fill="none" ${attrs}/>`);
  }
  return `<g data-arrow-id="${escapeSvg(arrow.id)}" class="block-connector${cls}">${paths.join('')}${omitHead ? '' : arrowheadsSvg(g.heads, arrow.style?.color)}</g>`;
}

function blockShape(block) {
  const r = block.rect;
  return `<rect class="block-node" x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}" fill="var(--paper, #fff)" ${styleAttrs(block.style)}/>`;
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
    out.push(`<rect class="editor-rubber-band" x="${n(r.x0)}" y="${n(r.y0)}" width="${n(r.x1 - r.x0)}" height="${n(r.y1 - r.y0)}" fill="none" stroke="${escapeSvg(r.color || 'var(--accent, #4f9cf9)')}" stroke-width="3" stroke-dasharray="8 6"/>`);
  }
  const selectedArrows = options.selectedArrows instanceof Set ? options.selectedArrows : new Set(options.selectedArrows || []);
  const selectedBlocks = options.selectedBlocks instanceof Set ? options.selectedBlocks : new Set(options.selectedBlocks || []);
  const selectedLabels = options.selectedLabels instanceof Set ? options.selectedLabels : new Set(options.selectedLabels || []);
  const selectedArrowSegments = options.selectedArrowSegments instanceof Set ? options.selectedArrowSegments : new Set(options.selectedArrowSegments || []);
  const labels = [...(diagram.labels?.values?.() || [])];
  const preview = options.annotationPreview;
  if (preview?.kind === 'line' && preview.points?.length > 1) {
    out.push(`<path class="annotation-preview block-line" d="${preview.points.map((p, i) => `${i ? 'L' : 'M'} ${point(p)}`).join(' ')}" fill="none" stroke="var(--accent, #4f9cf9)" stroke-width="4" stroke-dasharray="8 6"/>`);
  } else if (preview?.kind === 'arrow' && preview.points?.length > 1) {
    const route = preview.points;
    const a = route.at(-2); const b = route.at(-1);
    const angle = Math.atan2(b.y - a.y, b.x - a.x); const base = { x: b.x - 32 * Math.cos(angle), y: b.y - 32 * Math.sin(angle) };
    const left = { x: base.x + 18 * Math.sin(angle), y: base.y - 18 * Math.cos(angle) }; const right = { x: base.x - 18 * Math.sin(angle), y: base.y + 18 * Math.cos(angle) };
    out.push(`<g class="annotation-preview block-arrow"><path d="${route.slice(0, -1).map((p, i) => `${i ? 'L' : 'M'} ${point(p)}`).join(' ')} L ${point(base)}" fill="none" stroke="var(--accent, #4f9cf9)" stroke-width="4" stroke-dasharray="8 8"/><polygon points="${point(b)} ${point(left)} ${point(right)}" fill="var(--accent, #4f9cf9)"/></g>`);
  } else if (preview?.a && preview?.b) {
    const a = preview.a; const b = preview.b;
    if (preview.kind === 'box') out.push(`<rect class="annotation-preview block-box" x="${n(Math.min(a.x, b.x))}" y="${n(Math.min(a.y, b.y))}" width="${n(Math.abs(b.x - a.x))}" height="${n(Math.abs(b.y - a.y))}" fill="none" stroke="var(--accent, #4f9cf9)" stroke-width="4" stroke-dasharray="8 8"/>`);
    else {
      const angle = Math.atan2(b.y - a.y, b.x - a.x); const base = { x: b.x - 32 * Math.cos(angle), y: b.y - 32 * Math.sin(angle) };
      const left = { x: base.x + 18 * Math.sin(angle), y: base.y - 18 * Math.cos(angle) }; const right = { x: base.x - 18 * Math.sin(angle), y: base.y + 18 * Math.cos(angle) };
      out.push(`<g class="annotation-preview block-arrow"><path d="M ${point(a)} L ${point(base)}" fill="none" stroke="var(--accent, #4f9cf9)" stroke-width="4" stroke-dasharray="8 8"/><polygon points="${point(b)} ${point(left)} ${point(right)}" fill="var(--accent, #4f9cf9)"/></g>`);
    }
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
    if (arrow.points?.length >= 2) out.push(arrowSvg(arrow, selectedArrows.has(arrow.id), false, selectedArrowSegments));
  }
  for (const junction of blockConnectorJunctions(diagram)) {
    out.push(`<circle class="block-connector-junction" cx="${n(junction.x)}" cy="${n(junction.y)}" r="12" fill="var(--text, #111)"/>`);
  }
  const showTerminals = options.terminals !== false;
  for (const block of [...diagram.blocks.values()].sort((a, b) => a.drawOrder - b.drawOrder)) {
    const r = block.rect; const color = escapeSvg(resolveColor(block.style?.color || '#111'));
    const selected = selectedBlocks.has(block.id);
    out.push(`<g data-block-id="${escapeSvg(block.id)}">${blockShape(block).replace('class="block-node', `class="block-node${selected ? ' selected' : ''}`)}`);
    if (showTerminals) for (const terminal of block.terminals.values()) {
      const p = terminal.point(r);
      out.push(`<circle data-block-terminal="${escapeSvg(`${block.id}.${terminal.id}`)}" cx="${n(p.x)}" cy="${n(p.y)}" r="6" fill="${color}"/>`);
    }
    const p = block.labelPosition(); const style = block.style || {};
    const lines = String(block.text).split('\n');
    const firstY = p.y - ((lines.length - 1) * 38) / 2;
    const textBody = lines.length === 1
      ? escapeSvg(lines[0])
      : lines.map((line, index) => `<tspan x="${n(p.x)}" dy="${index ? 38 : 0}">${escapeSvg(line)}</tspan>`).join('');
    out.push(`<text x="${n(p.x)}" y="${n(firstY)}" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="38" font-weight="${style.bold === false ? 'normal' : 'bold'}" font-style="${style.italic === false ? 'normal' : 'italic'}" fill="${color}">${textBody}</text>`);
    out.push('</g>');
    if (selected && options.resizeHandles !== false) {
      const handles = [
        ['nw', r.x, r.y], ['n', r.x + r.w / 2, r.y], ['ne', r.x + r.w, r.y],
        ['e', r.x + r.w, r.y + r.h / 2], ['se', r.x + r.w, r.y + r.h],
        ['s', r.x + r.w / 2, r.y + r.h], ['sw', r.x, r.y + r.h], ['w', r.x, r.y + r.h / 2],
      ];
      out.push(`<g class="block-resize-handles" data-block-resize-id="${escapeSvg(block.id)}">${handles.map(([name, hx, hy]) => `<rect data-block-handle="${name}" x="${n(hx - 7)}" y="${n(hy - 7)}" width="14" height="14" rx="2" fill="var(--accent, #4f9cf9)" stroke="var(--paper, #fff)" stroke-width="2"/>`).join('')}</g>`);
    }
  }
  for (const label of labels.filter((item) => item.kind === 'label' && !item.parent)) out.push(labelText(label, selectedLabels.has(label.id)));
  for (const label of labels) {
    if (label.kind !== 'label' || (!selectedLabels.has(label.id) && options.editingLabel !== label.id)) continue;
    const box = label.bbox();
    const anchor = label.anchorWorld ? label.anchorWorld() : label.anchor;
    out.push(`<g class="block-label-bbox"><rect x="${n(box.x)}" y="${n(box.y)}" width="${n(box.w)}" height="${n(box.h)}" rx="2" fill="none" stroke="var(--accent, #2563eb)" stroke-width="2"/><circle cx="${n(anchor.x)}" cy="${n(anchor.y)}" r="3.5" fill="#e3970b"/></g>`);
  }
  const ghostLabels = options.ghostLabels || [];
  for (const label of ghostLabels) {
    const body = ['arrow', 'box', 'line'].includes(label.kind)
      ? annotationSvg(label, false)
      : labelText(label, false);
    out.push(`<g class="block-ghost block-label-ghost" opacity="0.38">${body}</g>`);
  }
  const ghostArrows = options.ghostArrows || [];
  for (const arrow of ghostArrows) {
    if (arrow.points?.length >= 2) out.push(`<g class="block-ghost block-connector-ghost" opacity="0.38">${arrowSvg({ ...arrow, id: `ghost-${arrow.id || 'connector'}` }, false).replace(/ data-arrow-id="[^"]*"/, '')}</g>`);
  }
  const ghosts = options.ghostBlocks?.length ? options.ghostBlocks : options.ghostBlock ? [options.ghostBlock] : [];
  for (const ghost of ghosts) {
    const r = ghost.rect;
    out.push(`<g class="block-ghost"><rect x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}" fill="var(--paper, #fff)" stroke="var(--accent, #4f9cf9)" stroke-width="4" stroke-dasharray="8 6"/><text x="${n(r.x + r.w / 2)}" y="${n(r.y + r.h / 2)}" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="38" font-weight="bold">${escapeSvg(ghost.text || 'Block')}</text></g>`);
  }
  out.push('</svg>'); return options.themeInk ? themeInkSvg(out.join('\n')) : out.join('\n');
}
