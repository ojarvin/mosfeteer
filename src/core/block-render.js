import { blockArrowGeometry } from './block-router.js';
import { GRID } from './grid.js';
import { resolveColor, styleAttrs } from './style.js';

const esc = (s) => String(s).replace(/[&<>\"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
const n = v => Number.isInteger(v) ? v : Number(v.toFixed(2));
export function blockSvgString(diagram, options = {}) {
  const b = diagram.bounds(); const pad = options.padding ?? GRID;
  const x = options.viewport?.x ?? b.x - pad, y = options.viewport?.y ?? b.y - pad;
  const w = options.viewport?.w ?? Math.max(GRID * 4, b.w + pad * 2), h = options.viewport?.h ?? Math.max(GRID * 3, b.h + pad * 2);
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${n(w)}" height="${n(h)}" viewBox="${n(x)} ${n(y)} ${n(w)} ${n(h)}">`];
  if (options.background !== false) out.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="#fff"/>`);
  const arrows = [...diagram.arrows.values()].sort((a,b) => a.drawOrder-b.drawOrder);
  for (const a of arrows) { if (!a.points?.length) continue; const g = blockArrowGeometry(a.points); const d = g.shaftPoints.map((p,i)=>`${i?'L':'M'} ${n(p.x)} ${n(p.y)}`).join(' '); const c=resolveColor(a.style?.color||'#111'); const attrs = styleAttrs(a.style, 'wire'); out.push(`<path d="${d}" fill="none" ${attrs} stroke-linecap="round"/><polygon points="${n(g.tip.x)} ${n(g.tip.y)} ${n(g.left.x)} ${n(g.left.y)} ${n(g.right.x)} ${n(g.right.y)}" fill="${c}"/>`); }
  for (const block of [...diagram.blocks.values()].sort((a,b)=>a.drawOrder-b.drawOrder)) {
    const r=block.rect, c=resolveColor(block.style?.color||'#111'); out.push(`<rect x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}" fill="white" ${styleAttrs(block.style)}/>`);
    for (const t of block.terminals.values()) { const p=t.point(r); out.push(`<circle cx="${n(p.x)}" cy="${n(p.y)}" r="6" fill="${c}"/>`); }
    const p=block.labelPosition(); out.push(`<text x="${n(p.x)}" y="${n(p.y)}" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="38" font-weight="${block.style?.bold===false?'normal':'bold'}" font-style="${block.style?.italic===false?'normal':'italic'}" fill="${c}">${esc(block.text)}</text>`);
  }
  out.push('</svg>'); return out.join('\n');
}
export const renderBlockDiagram = blockSvgString;
