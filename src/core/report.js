/**
 * A design's report: its notes set as a printable document, with figures of
 * the drawing where the notes embed them (`![[circuit|caption]]`, notes.js).
 * Every figure is drawn at the page guide's width, centered: one narrower
 * than the guide is padded to it, so every figure's text is the guide's
 * size; one wider is fitted to it, its text smaller, and the report says so.
 * A plot is drawn again to fill three quarters of the guide's width, its
 * own text at the guide's size.
 * Without a guide the report uses the A4 one. The page is A4, its text as
 * wide as the guide where that fits on the sheet.
 *
 * What a figure can show (`reportTargets`): `circuit` (the drawing without
 * the figures the tools annotated), `drawing` (all of it), `beat N` (the
 * circuit as beat N shows it), or one
 * annotated figure by its id (`F2`, the `figures` command lists them). A
 * mention (`@M1`) links to the first figure that shows it, and `[[#F2]]`
 * reads `Fig. N`. A citation (`[^https://...|title]`) reads `[N]`, linked to
 * the References list the report ends with. A `[TOC]` line in the notes
 * lists the report's sections there, numbered, the included designs' too. Notes that embed nothing get
 * the whole drawing on top.
 *
 * The report is HTML; the server prints it to PDF (`printHtmlToPdf`).
 */

import { LABEL_FONT_SIZE } from './model.js';
import { listFigures } from './figures.js';
import { beatTitle, resolveBeat } from './beats.js';
import { timingBeatBands } from './timing-diagram.js';
import { DRAWING_EXPORT_OPTIONS, selectionDrawing } from './selection-drawing.js';
import { loadDocument, renderDocument } from './document.js';
import { plotFontSize } from './render.js';
import { normalizePageGuide } from './page-guide.js';
import { numberSections, referencesHtml, renderNotes } from './notes-markdown.js';
import { FIGURE_EMBED_LINE, figureKey, noteCitations, noteFigures, normalizeNotes, resolveMention } from './notes.js';

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
    return { svg: selectionDrawing(circuit, targetSelection(circuit, { kind: 'circuit' }), { pageGuide: guide, beat: { view, timing: timingBeatBands(circuit, view.index) } }) };
  }
  if (target.kind === 'figure' && target.figure.kind === 'plot') {
    const plot = reportPlot(circuit, target.figure, guide);
    if (plot) return plot;
  }
  const selection = targetSelection(circuit, target);
  if (selection) return { svg: selectionDrawing(circuit, selection, { pageGuide: guide }) };
  return { svg: renderDocument(circuit, { ...DRAWING_EXPORT_OPTIONS, pageGuide: guide }) };
}

/** The share of the guide's width a plot fills in a report. */
const PLOT_SHARE = 0.75;

const viewBoxWidth = (svg) => Number(svg.match(/viewBox="([^"]+)"/)[1].split(/\s+/)[2]);

/**
 * A plot figure as a report draws it, `{ svg, widthPt, textUnits }`: drawn
 * again in a box of its own proportions sized so that the figure fills
 * PLOT_SHARE of the guide's width with its text -- ticks, axis names, the
 * legend beside it -- at the guide's size; on the canvas a plot's text is
 * smaller than the labels'. The drawing itself is left as it is (a copy is
 * drawn). Null when the figure has no plot box.
 */
function reportPlot(circuit, figure, guide) {
  const copy = loadDocument(circuit.toJSON());
  const own = listFigures(copy).find((entry) => entry.id === figure.id);
  const box = own?.labels.find((label) => label.plot && label.anchor && label.end);
  if (!box) return null;
  const legend = own.labels.filter((label) => label.parent === box.id);
  const draw = () => selectionDrawing(copy, targetSelection(copy, { kind: 'figure', figure: own }));
  let svg = draw();
  // The text grows with the box up to a size, so settle in a few steps.
  for (let step = 0; step < 4; step += 1) {
    const w = Math.abs(box.end.x - box.anchor.x);
    const h = Math.abs(box.end.y - box.anchor.y);
    const ptPerUnit = guide.textPt / plotFontSize(box.plot, h);
    const grow = (PLOT_SHARE * guide.widthPt) / ptPerUnit - viewBoxWidth(svg);
    if (Math.abs(grow) < 1 || w + grow <= 0) break;
    const k = (w + grow) / w;
    const left = Math.min(box.anchor.x, box.end.x);
    const top = Math.min(box.anchor.y, box.end.y);
    const right = Math.max(box.anchor.x, box.end.x);
    const resize = (point) => ({ x: left + (point.x - left) * k, y: top + (point.y - top) * k });
    box.anchor = resize(box.anchor);
    box.end = resize(box.end);
    // The legend stays beside the box, in its place from the top.
    const moved = Math.max(box.anchor.x, box.end.x) - right;
    for (const label of legend) label.anchor = { x: label.anchor.x + moved, y: label.anchor.y };
    svg = draw();
  }
  const h = Math.abs(box.end.y - box.anchor.y);
  const textUnits = plotFontSize(box.plot, h);
  return { svg, widthPt: (guide.textPt / textUnits) * viewBoxWidth(svg), textUnits };
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
 * width (or `widthPt`), smaller when the page cannot hold it (too wide, or
 * too tall). `textPt` is what its text, `textUnits` tall (a label's by
 * default), measures on the page.
 */
export function reportFigureSize(guide, page, width, height, { widthPt = guide.widthPt, textUnits = LABEL_FONT_SIZE } = {}) {
  let heightPt = (widthPt * height) / width;
  const scale = Math.min(1, page.textWidthPt / widthPt, (page.textHeightPt * FIGURE_HEIGHT_SHARE) / heightPt);
  widthPt *= scale;
  heightPt *= scale;
  return { widthPt, heightPt, textPt: (textUnits * widthPt) / width };
}

/** The SVG set at a size on the page: its own width and height replaced. */
function sizedSvg(svg, { widthPt, heightPt }) {
  return svg.replace(/^<svg\b([^>]*)>/, (_, attrs) => `<svg${attrs.replace(/\s(width|height)="[^"]*"/g, '')} width="${pt(widthPt)}" height="${pt(heightPt)}" role="img">`);
}

/**
 * The names a design's notes embed that are no figure of its own: the
 * designs whose notes would be its sections, for a caller to load
 * (`buildReport`'s `design`).
 */
export function embeddedDesignNames(circuit) {
  const targets = reportTargets(circuit);
  return noteFigures(circuit.notes).filter((entry) => !resolveReportTarget(circuit, entry.name, targets)).map((entry) => entry.name);
}

/** The anchor of a design's section. */
const sectionId = (name) => `design-${figureKey(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section'}`;

/**
 * The report of `circuit`: `{ html, figures, warnings }`. `name` titles it
 * (unless the notes start with a `#` heading of their own); `guide` sizes
 * its figures (A4 without one); `fontCss` is put in its style sheet (the math
 * face, which only the caller can read); `design(name)` gives another
 * design of the workspace, `{ name, circuit }` or null, for the sections
 * its notes embed (`![[amp]]`).
 *
 * A section is the embedded design's notes, a heading level down, with its
 * own figures, mentions and references; its figures continue the report's
 * numbering, and its citations join the one list at the end. Each design
 * is one section, where the report first embeds it: embedding it again,
 * or linking it (`[[amp]]`), links to that section. A design without
 * notes is its circuit. `figures` lists each figure, `{ number, name,
 * caption, kind, textPt, design }` (`kind` null: nothing to draw;
 * `design` the section's design, null at the top); `warnings` says what
 * to look at: a missing figure, small text, a reference to no figure.
 */
export function buildReport(circuit, { name = 'Design', guide = null, fontCss = '', design = () => null } = {}) {
  const pageGuide = normalizePageGuide(guide) || normalizePageGuide('a4');
  const page = reportPage(pageGuide);
  const warnings = [];
  const listed = [];
  let figureCount = 0;

  // The sections, each design once in reading order, and the notes read in
  // that order, for the citations' numbers.
  const sections = new Map([[figureKey(name), { name, circuit, id: sectionId(name) }]]);
  const lookup = (embed) => {
    const found = design(embed);
    return found?.circuit ? { name: found.name || embed, circuit: found.circuit } : null;
  };
  const isDesignIn = (owner) => {
    const targets = reportTargets(owner);
    return (embed) => !resolveReportTarget(owner, embed, targets) && (sections.has(figureKey(embed)) || !!lookup(embed));
  };
  const readingOrder = (owner) => {
    const notes = normalizeNotes(owner.notes);
    const isDesign = isDesignIn(owner);
    return notes.split('\n').map((line) => {
      const embed = line.replace(/^(\s*>)+/, '').match(FIGURE_EMBED_LINE);
      if (!embed || !isDesign(embed[1].trim()) || sections.has(figureKey(embed[1]))) return line;
      const found = lookup(embed[1].trim());
      sections.set(figureKey(embed[1]), { ...found, id: sectionId(found.name) });
      return readingOrder(found.circuit);
    }).join('\n');
  };
  const citations = noteCitations(readingOrder(circuit));
  const rendered = new Set([figureKey(name)]);

  /** One design's notes as HTML, `depth` sections down. */
  const section = (owner, ownerName, depth) => {
    const notes = normalizeNotes(owner.notes);
    const targets = reportTargets(owner);
    const isDesign = isDesignIn(owner);
    const embeds = noteFigures(notes, { isDesign });
    // The top with nothing placed shows its drawing, unnumbered; a section
    // with nothing placed, its circuit.
    const fallback = !embeds.length ? (depth ? '![[circuit]]' : '![[drawing]]') : null;
    // Under the notes' own title, when they start with one.
    const title = notes.match(/^#\s[^\n]*(\n|$)/)?.[0] || '';
    const source = fallback ? `${title}${title ? '\n' : ''}${fallback}\n\n${notes.slice(title.length)}` : notes;
    const where = depth ? ` (${ownerName})` : '';
    const figures = noteFigures(source, { isDesign, first: figureCount + 1 }).map((entry) => {
      if (entry.design) return entry;
      const numbered = !(fallback && !depth);
      if (numbered) figureCount = entry.number;
      const target = resolveReportTarget(owner, entry.name, targets);
      return { ...entry, number: numbered ? entry.number : null, id: numbered ? `fig-${entry.number}` : 'fig-drawing', target };
    });
    const label = (figure) => (figure.number ? `Fig. ${figure.number}` : 'The drawing');
    const drawn = new Map();
    for (const figure of figures.filter((entry) => !entry.design)) {
      listed.push(figure);
      figure.owner = depth ? ownerName : null;
      if (!figure.target) {
        warnings.push(`${label(figure)}${where}: nothing named "${figure.name}" to draw.`);
        continue;
      }
      const { svg, ...sizing } = targetSvg(owner, figure.target, pageGuide);
      const [, , width, height] = svg.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
      const size = reportFigureSize(pageGuide, page, width, height, sizing);
      if (size.textPt < pageGuide.textPt - 0.05) warnings.push(`${label(figure)} (${figure.name}${depth ? ` of ${ownerName}` : ''}): its text is ${size.textPt.toFixed(1)} pt, below the guide's ${pageGuide.textPt} pt.`);
      drawn.set(figure, { svg: sizedSvg(svg, size), ...size });
      figure.textPt = size.textPt;
    }
    for (const match of notes.matchAll(/\[\[#([^[\]\n|]+)\]\]/g)) {
      if (!figures.some((figure) => !figure.design && figureKey(figure.name) === figureKey(match[1]))) warnings.push(`[[#${match[1].trim()}]]${where}: no figure of the notes shows it.`);
    }

    // The first figure that shows a mentioned part or net, for its link.
    const mentionFigure = (found) => figures.find((figure) => figure.target && targetShows(owner, figure.target, found));
    let index = 0;
    const body = renderNotes(source, {
      headingLevel: depth + 1,
      // One contents for the report, where its own notes place it.
      toc: depth ? 'drop' : 'place',
      isDesign,
      figures,
      citations,
      references: false,
      mention: (mention) => resolveMention(owner, mention),
      mentionHtml: (mention, found, nameHtml) => {
        const figure = found ? mentionFigure(found) : null;
        return figure ? `<a class="mention" href="#${figure.id}">${nameHtml}</a>` : `<span class="mention">${nameHtml}</span>`;
      },
      designHtml: (linked) => {
        const known = sections.get(figureKey(linked));
        return known ? `<a class="design" href="#${known.id}">${escapeHtml(linked)}</a>` : `<span class="design">${escapeHtml(linked)}</span>`;
      },
      figure: (target) => resolveReportTarget(owner, target, targets),
      figureHtml: ({ captionHtml }) => {
        const figure = figures[index++];
        if (figure.design) {
          const key = figureKey(figure.name);
          const known = sections.get(key);
          if (rendered.has(key)) return `<p class="see-section">See <a class="design" href="#${known.id}">${escapeHtml(known.name)}</a>.</p>`;
          rendered.add(key);
          const own = normalizeNotes(known.circuit.notes);
          const heading = /^#\s/.test(own) ? '' : `<h${Math.min(depth + 2, 6)}>${escapeHtml(known.name)}</h${Math.min(depth + 2, 6)}>\n`;
          return `<section id="${known.id}" class="design-section">\n${heading}${section(known.circuit, known.name, depth + 1)}\n</section>`;
        }
        const caption = figure.number
          ? `<figcaption><span class="figure-number">Fig. ${figure.number}.</span>${captionHtml ? ` ${captionHtml}` : ''}</figcaption>`
          : (captionHtml ? `<figcaption>${captionHtml}</figcaption>` : '');
        const art = drawn.get(figure);
        if (!art) return `<figure id="${figure.id}" class="missing"><p>Nothing named “${escapeHtml(figure.name)}” to draw.</p>${caption}</figure>`;
        return `<figure id="${figure.id}">${art.svg}${caption}</figure>`;
      },
    });
    return body;
  };

  const notes = normalizeNotes(circuit.notes);
  const body = section(circuit, name, 0);
  const references = citations.length ? referencesHtml(citations, 2) : '';
  const title = /^#\s/.test(notes) ? '' : `<h1>${escapeHtml(name)}</h1>\n`;
  const content = numberSections(`${body}${references ? `\n${references}` : ''}`, { titleLevel: 1 });
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">
<title>${escapeHtml(name)}</title>
<style>${fontCss}${reportCss(page)}</style>
</head>
<body>
${title}${content}
</body>
</html>
`;
  return {
    html,
    figures: listed.map((figure) => ({
      number: figure.number, name: figure.name, caption: figure.caption, kind: figure.target?.kind || null,
      ...(figure.textPt !== undefined ? { textPt: figure.textPt } : {}), design: figure.owner,
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
.note-cite { white-space: nowrap; }
.note-toc { margin: 0 0 14pt; break-inside: avoid; }
.note-toc ol { list-style: none; padding: 0; margin: 0; }
.note-toc li { margin: 2pt 0; }
.note-toc .toc-level-1 { padding-left: 1.6em; }
.note-toc .toc-level-2 { padding-left: 3.2em; }
.note-toc .toc-level-3, .note-toc .toc-level-4 { padding-left: 4.8em; }
.note-toc a { color: inherit; }
.section-number { margin-right: 0.35em; }
.note-references { break-before: avoid; }
.note-references ol { padding-left: 2em; font-size: 9.5pt; }
.note-references li { margin-bottom: 3pt; overflow-wrap: anywhere; }
.note-figure-ref.broken, .note-math-error { color: #b42318; }
figure { margin: 14pt 0; break-inside: avoid; page-break-inside: avoid; }
figure svg { display: block; margin: 0 auto; }
figcaption { margin: 6pt auto 0; max-width: ${pt(page.textWidthPt)}; font-size: 9pt; text-align: center; }
.figure-number { font-weight: bold; }
figure.missing p { margin: 0 auto; padding: 18pt; border: 1pt dashed #b42318; color: #b42318; text-align: center; }
`;
}

// ----- outline -------------------------------------------------------------------

/** A plot's caption, by what it plots. */
const PLOT_CAPTIONS = {
  response: 'Frequency response.', locus: 'Root locus.', step: 'Step response.',
  swing: 'Signal swing.', wave: 'Waveforms.', noise: 'Noise spectrum.',
};
const SOURCE_NAMES = { 'small-signal': 'small-signal', 'signal-flow': 'signal-flow', 'switched-cap': 'switched-capacitor' };

/** What an annotated figure shows, as its caption in an outline. */
function figureCaption(figure) {
  const of = SOURCE_NAMES[figure.source] ? ` (${SOURCE_NAMES[figure.source]} analysis)` : '';
  if (figure.kind === 'plot') {
    const plot = figure.labels.find((label) => label.plot)?.plot;
    if (plot?.kind === 'response' && plot.quantity === 'phase') return 'Phase response.';
    return PLOT_CAPTIONS[plot?.kind] || 'Plot.';
  }
  return {
    equations: `Equations${of}.`, coefficients: 'Coefficients.', noise: 'kT/C noise.', model: 'Small-signal model.',
    timing: 'Clock phases.', table: 'Parts.',
  }[figure.kind] || 'Figure.';
}

// Where each kind of annotated figure goes in an outline.
const OUTLINE_SECTIONS = [
  { title: 'Operation', kinds: ['timing'] },
  { title: 'Analysis', kinds: ['equations', 'model', 'plot', 'coefficients', 'noise'] },
  { title: 'Sizing', kinds: ['table'] },
];

/**
 * Notes to start a report from: a heading, its contents, the circuit, then a section for
 * the beats and timing (Operation), the annotated equations, models, plots
 * and noise (Analysis), the parts tables (Sizing), and the designs its
 * parts link to, each embedded once as a section (Blocks) -- only what the
 * drawing has, each with a caption and a line to replace with text.
 * Nothing is computed: an analysis appears once it is annotated.
 */
export function notesOutline(circuit, { name = 'Design' } = {}) {
  const figures = listFigures(circuit);
  const blocks = [`# ${name}`, '[TOC]', 'What the circuit is and does.', '![[circuit|The circuit.]]'];
  for (const section of OUTLINE_SECTIONS) {
    const embeds = [];
    for (const kind of section.kinds) {
      for (const figure of figures.filter((f) => f.kind === kind)) embeds.push(`![[${figure.id}|${figureCaption(figure)}]]`);
    }
    if (section.title === 'Operation') {
      (circuit.beats || []).forEach((beat, index) => embeds.push(`![[beat ${index + 1}|Beat ${index + 1}${beat.name ? `: ${beat.name}` : ''}.]]`));
    }
    if (!embeds.length) continue;
    const lead = { Operation: 'How it works, step by step.', Analysis: 'What the analysis shows.', Sizing: 'How the parts are sized.' }[section.title];
    blocks.push(`## ${section.title}`, lead, ...embeds);
  }
  // The designs its parts link to, each once: their notes as sections.
  const linked = [...new Set([...circuit.components.values()].filter((part) => part.link && !part.figure)
    .sort((a, b) => a.refdes.localeCompare(b.refdes, undefined, { numeric: true })).map((part) => part.link))];
  if (linked.length) blocks.push('## Blocks', 'The blocks, each from its own design.', ...linked.map((name) => `![[${name}]]`));
  return `${blocks.join('\n\n')}\n`;
}
