/**
 * A design's report: its notes set as a printable document, with figures of
 * the drawing where the notes embed them (`![[circuit|caption]]`, notes.js).
 * Every figure is drawn at the page guide's width, centered: one narrower
 * than the guide is padded to it, so every figure's text is the guide's
 * size; one wider is fitted to it, its text smaller, and the report says so.
 * Without a guide the report uses the A4 one. The page is A4, its text as
 * wide as the guide where that fits on the sheet.
 *
 * What a figure can show (`reportTargets`): `circuit` (the drawing without
 * the figures the tools annotated), `drawing` (all of it), `beat N` (the
 * circuit as beat N shows it), or one
 * annotated figure by its id (`F2`, the `figures` command lists them). A
 * mention (`@M1`) links to the first figure that shows it, and `[[#F2]]`
 * reads `Fig. N`. Notes that embed nothing get the whole drawing on top.
 *
 * The report is HTML; the server prints it to PDF (`printHtmlToPdf`).
 */

import { LABEL_FONT_SIZE } from './model.js';
import { listFigures } from './figures.js';
import { beatTitle, resolveBeat } from './beats.js';
import { timingBeatBands } from './timing-diagram.js';
import { DRAWING_EXPORT_OPTIONS, selectionDrawing } from './selection-drawing.js';
import { renderDocument } from './document.js';
import { normalizePageGuide } from './page-guide.js';
import { renderNotes } from './notes-markdown.js';
import { figureKey, noteFigures, normalizeNotes, resolveMention } from './notes.js';

const MM = 72 / 25.4;
/** The sheet: A4, 25 mm margins; the side margins give way, down to 12 mm,
 *  for a guide wider than 16 cm. */
const PAGE = Object.freeze({ widthPt: 210 * MM, heightPt: 297 * MM, marginPt: 25 * MM, minSidePt: 12 * MM });
/** The tallest a figure is drawn: the text height less room for its caption. */
const FIGURE_HEIGHT_SHARE = 0.85;

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const pt = (value) => `${Math.round(value * 100) / 100}pt`;

/** What a figure of the report can show: `[{ name, kind, detail, ... }]`. */
export function reportTargets(circuit) {
  const targets = [
    { name: 'circuit', kind: 'circuit', detail: 'the drawing without its figures' },
    { name: 'drawing', kind: 'drawing', detail: 'the whole drawing' },
  ];
  (circuit.beats || []).forEach((_, index) => targets.push({ name: `beat ${index + 1}`, kind: 'beat', beat: index, detail: `the circuit at ${beatTitle(circuit, index)}` }));
  for (const figure of listFigures(circuit)) {
    targets.push({ name: figure.id, kind: 'figure', figure, detail: `${figure.kind}${figure.source ? ` (${figure.source})` : ''}` });
  }
  return targets;
}

/** The target `name` embeds, or null. */
export function resolveReportTarget(circuit, name, targets = reportTargets(circuit)) {
  const key = figureKey(name);
  return targets.find((target) => figureKey(target.name) === key) || null;
}

/** The selection that draws a target: null for the whole drawing. */
function targetSelection(circuit, target) {
  if (target.kind === 'figure') {
    const refs = new Set(target.figure.components.map((component) => component.refdes));
    const netIds = new Set([...circuit.nets.values()].filter((net) => net.terminals.length && net.terminals.every((t) => refs.has(t.comp))).map((net) => net.id));
    return { refs, labels: target.figure.labels, netIds, wireKeys: new Set() };
  }
  if (target.kind !== 'circuit') return null;
  // Everything in no figure (as figures.js coreBounds counts the circuit).
  const figures = listFigures(circuit);
  const theirLabels = new Set(figures.flatMap((figure) => figure.labels));
  const parts = [...circuit.components.values()].filter((c) => !c.figure && !c.drawingOnly && c.type !== 'solder');
  const refs = new Set(parts.map((c) => c.refdes));
  const netIds = new Set([...circuit.nets.values()].filter((net) => !net.terminals.length || net.terminals.some((t) => refs.has(t.comp))).map((net) => net.id));
  const labels = [...circuit.labels.values()].filter((label) => !label.owner && !label.netId && !theirLabels.has(label));
  return { refs, labels, netIds, wireKeys: new Set() };
}

/** Whether a figure of `target` shows what a mention found. */
function targetShows(circuit, target, found) {
  if (target.kind === 'drawing') return true;
  const selection = targetSelection(circuit, target.kind === 'beat' ? { kind: 'circuit' } : target);
  return found.kind === 'component' ? selection.refs.has(found.refdes) : found.ids.some((id) => selection.netIds.has(id));
}

/** The target drawn with the guide, as SVG. A beat is the circuit as that
 *  beat shows it, without the figures. */
function targetSvg(circuit, target, guide) {
  if (target.kind === 'beat') {
    const view = resolveBeat(circuit, target.beat);
    return selectionDrawing(circuit, targetSelection(circuit, { kind: 'circuit' }), { pageGuide: guide, beat: { view, timing: timingBeatBands(circuit, view.index) } });
  }
  const selection = targetSelection(circuit, target);
  if (selection) return selectionDrawing(circuit, selection, { pageGuide: guide });
  return renderDocument(circuit, { ...DRAWING_EXPORT_OPTIONS, pageGuide: guide });
}

/** The page for a guide: its text width, and the side margin that leaves. */
export function reportPage(guide) {
  const textWidthPt = Math.min(Math.max(PAGE.widthPt - 2 * PAGE.marginPt, guide.widthPt), PAGE.widthPt - 2 * PAGE.minSidePt);
  return {
    textWidthPt,
    textHeightPt: PAGE.heightPt - 2 * PAGE.marginPt,
    sidePt: (PAGE.widthPt - textWidthPt) / 2,
  };
}

/**
 * One figure, sized: an SVG `width` world units across set at the guide's
 * width, smaller when the page cannot hold it (too wide, or too tall).
 * `textPt` is what its label text measures on the page.
 */
export function reportFigureSize(guide, page, width, height) {
  let widthPt = guide.widthPt;
  let heightPt = (widthPt * height) / width;
  const scale = Math.min(1, page.textWidthPt / widthPt, (page.textHeightPt * FIGURE_HEIGHT_SHARE) / heightPt);
  widthPt *= scale;
  heightPt *= scale;
  return { widthPt, heightPt, textPt: (LABEL_FONT_SIZE * widthPt) / width };
}

/** The SVG set at a size on the page: its own width and height replaced. */
function sizedSvg(svg, { widthPt, heightPt }) {
  return svg.replace(/^<svg\b([^>]*)>/, (_, attrs) => `<svg${attrs.replace(/\s(width|height)="[^"]*"/g, '')} width="${pt(widthPt)}" height="${pt(heightPt)}" role="img">`);
}

/**
 * The report of `circuit`: `{ html, figures, warnings }`. `name` titles it
 * (unless the notes start with a `#` heading of their own); `guide` sizes
 * its figures (A4 without one); `fontCss` is put in its style sheet (the math
 * face, which only the caller can read). `figures` lists each figure,
 * `{ number, name, caption, kind, textPt }` (`kind` null: nothing to draw);
 * `warnings` says what to look at: a missing figure, small text, a
 * reference to no figure.
 */
export function buildReport(circuit, { name = 'Design', guide = null, fontCss = '' } = {}) {
  const pageGuide = normalizePageGuide(guide) || normalizePageGuide('a4');
  const page = reportPage(pageGuide);
  const notes = normalizeNotes(circuit.notes);
  const targets = reportTargets(circuit);
  const embedded = noteFigures(notes);
  const source = embedded.length ? notes : `![[drawing]]\n\n${notes}`;
  const figures = noteFigures(source).map((figure) => {
    const target = resolveReportTarget(circuit, figure.name, targets);
    return { ...figure, target, number: embedded.length ? figure.number : null };
  });
  const warnings = [];
  const label = (figure) => (figure.number ? `Fig. ${figure.number}` : 'The drawing');

  const drawn = new Map();
  for (const figure of figures) {
    if (!figure.target) {
      warnings.push(`${label(figure)}: nothing named "${figure.name}" to draw.`);
      continue;
    }
    const svg = targetSvg(circuit, figure.target, pageGuide);
    const [, , width, height] = svg.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
    const size = reportFigureSize(pageGuide, page, width, height);
    if (size.textPt < pageGuide.textPt - 0.05) warnings.push(`${label(figure)} (${figure.name}): its text is ${size.textPt.toFixed(1)} pt, below the guide's ${pageGuide.textPt} pt.`);
    drawn.set(figure, { svg: sizedSvg(svg, size), ...size });
  }
  for (const match of notes.matchAll(/\[\[#([^[\]\n|]+)\]\]/g)) {
    if (!figures.some((figure) => figureKey(figure.name) === figureKey(match[1]))) warnings.push(`[[#${match[1].trim()}]]: no figure of the notes shows it.`);
  }

  // The first figure that shows a mentioned part or net, for its link.
  const mentionFigure = (found) => figures.find((figure) => figure.target && targetShows(circuit, figure.target, found));
  let index = 0;
  const body = renderNotes(source, {
    headingLevel: 1,
    mention: (mention) => resolveMention(circuit, mention),
    mentionHtml: (mention, found, nameHtml) => {
      const figure = found ? mentionFigure(found) : null;
      return figure ? `<a class="mention" href="#fig-${figures.indexOf(figure) + 1}">${nameHtml}</a>` : `<span class="mention">${nameHtml}</span>`;
    },
    designHtml: (design) => `<span class="design">${escapeHtml(design)}</span>`,
    figure: (target) => resolveReportTarget(circuit, target, targets),
    figureHtml: ({ captionHtml }) => {
      const figure = figures[index++];
      const id = `fig-${index}`;
      const caption = figure.number
        ? `<figcaption><span class="figure-number">Fig. ${figure.number}.</span>${captionHtml ? ` ${captionHtml}` : ''}</figcaption>`
        : (captionHtml ? `<figcaption>${captionHtml}</figcaption>` : '');
      const art = drawn.get(figure);
      if (!art) return `<figure id="${id}" class="missing"><p>Nothing named “${escapeHtml(figure.name)}” to draw.</p>${caption}</figure>`;
      return `<figure id="${id}">${art.svg}${caption}</figure>`;
    },
  });
  const title = /^#\s/.test(notes) ? '' : `<h1>${escapeHtml(name)}</h1>\n`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">
<title>${escapeHtml(name)}</title>
<style>${fontCss}${reportCss(page)}</style>
</head>
<body>
${title}${body}
</body>
</html>
`;
  return {
    html,
    figures: figures.map((figure) => ({
      number: figure.number, name: figure.name, caption: figure.caption,
      kind: figure.target?.kind || null, ...(drawn.has(figure) ? { textPt: drawn.get(figure).textPt } : {}),
    })),
    warnings,
  };
}

function reportCss(page) {
  return `
@page { size: A4; margin: ${pt(PAGE.marginPt)} ${pt(page.sidePt)}; @bottom-center { content: counter(page); font: 9pt Georgia, "Times New Roman", serif; color: #555; } }
html { color: #111; background: #fff; font: 10.5pt/1.45 Georgia, "Times New Roman", serif; }
body { max-width: ${pt(page.textWidthPt)}; margin: 0 auto; }
@media screen { body { padding: 36pt 16pt; } }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; break-after: avoid; page-break-after: avoid; }
h1 { font-size: 18pt; margin: 0 0 14pt; }
h2 { font-size: 13.5pt; margin: 18pt 0 6pt; }
h3 { font-size: 11.5pt; margin: 14pt 0 4pt; }
h4, h5, h6 { font-size: 10.5pt; margin: 12pt 0 4pt; }
p, ul, ol, blockquote, pre, table { margin: 0 0 8pt; }
ul, ol { padding-left: 1.4em; }
li > ul, li > ol { margin: 0; }
.note-task { list-style: none; margin-left: -1.2em; }
.note-check { display: inline-block; width: 0.7em; height: 0.7em; margin-right: 0.4em; border: 1px solid #555; vertical-align: -0.05em; }
.note-task.done .note-check { background: #555; }
blockquote { margin-left: 0; padding-left: 10pt; border-left: 2pt solid #ccc; color: #444; }
code { font: 0.9em ui-monospace, Menlo, Consolas, monospace; }
pre { padding: 6pt 8pt; background: #f4f4f4; white-space: pre-wrap; break-inside: avoid; }
table { border-collapse: collapse; break-inside: avoid; }
th, td { padding: 2pt 8pt; border: 0.5pt solid #999; text-align: left; }
hr { border: 0; border-top: 0.5pt solid #999; margin: 12pt 0; }
math { font-family: "Latin Modern Math", "STIX Two Math", "Cambria Math", serif; }
.note-display-math { margin: 0 0 8pt; text-align: center; }
a { color: #1d4e89; text-decoration: none; }
.mention { font-style: italic; }
.note-figure-ref.broken, .note-math-error { color: #b42318; }
figure { margin: 14pt 0; break-inside: avoid; page-break-inside: avoid; }
figure svg { display: block; margin: 0 auto; }
figcaption { margin: 6pt auto 0; max-width: ${pt(page.textWidthPt)}; font-size: 9pt; text-align: center; }
.figure-number { font-weight: bold; }
figure.missing p { margin: 0 auto; padding: 18pt; border: 1pt dashed #b42318; color: #b42318; text-align: center; }
`;
}
