/**
 * A report's pages laid out before it is printed, for the browser's print
 * dialog (browser-only), which gives no PDF back to read the pages from
 * (the server reads them from its own print, server/pdf-pages.js) and has
 * no `target-counter()` to number the contents.
 *
 * The report is laid out once, off screen, at its pages' text width with
 * its own fonts, and its pages are filled from the top: every page break
 * is chosen here and forced (`break-before: page`, its top margin dropped,
 * as LaTeX drops space at the top of a page), so the browser prints the
 * pages as they were filled, and the contents can list them.
 *
 * - A figure, table, equation, heading, rule, the contents, and a list item
 *   move whole to the next page when they do not fit.
 * - A heading (or a byline under one) goes with what follows it, and a
 *   paragraph leading into a table or an equation keeps its last line with
 *   it.
 * - A paragraph that does not fit is cut where a line ends, into two
 *   paragraphs: the first keeps its last line justified, the second has no
 *   indent, and a word hyphenated at the cut keeps its hyphen. At least two
 *   lines stay on each side, else the whole paragraph moves.
 * - What is taller than a page is left to the browser, from its top.
 *
 * The frame takes the editor's Content-Security-Policy, which must allow
 * the report's `data:` fonts; a face that fails to load leaves the report
 * unpaginated rather than numbered from another face's lines.
 */

import { reportWithPages } from '../core/report.js';

const PX_PER_PT = 4 / 3;
/** Room left at each page's foot for rounding between layout and print. */
const SLACK_PX = 2;
/** Lines kept on each side of a cut paragraph (as orphans and widows). */
const MIN_LINES = 2;

const WHOLE = 'figure, table, pre, hr, img, nav, h1, h2, h3, h4, h5, h6, li, .note-display-math, .report-authors, .section-author, .note-figure';
const TEXT = 'p';
const KEEP_WITH_NEXT = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

/** The blocks pages are filled with, in reading order: whole blocks and
 *  paragraphs, inside sections, quotes, and lists. */
function flowBlocks(root) {
  const blocks = [];
  const walk = (element) => {
    for (const child of element.children) {
      if (child.matches('style, script, title, meta')) continue;
      if (child.matches(WHOLE)) blocks.push({ element: child, whole: true });
      else if (child.matches(TEXT)) blocks.push({ element: child, whole: false });
      else walk(child);
    }
  };
  walk(root);
  return blocks;
}

const keepsWithNext = (element) => KEEP_WITH_NEXT.has(element.tagName) || element.matches('.report-authors, .section-author');

/** An element's border box in the document, px: { top, bottom }. */
function box(element) {
  const rect = element.getBoundingClientRect();
  const scroll = element.ownerDocument.defaultView.scrollY;
  return { top: rect.top + scroll, bottom: rect.bottom + scroll };
}

/** A paragraph's lines, top to bottom, as { top, bottom }: its text's
 *  boxes grouped where they overlap (a line with math is taller). */
function lineBoxes(element) {
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  const scroll = element.ownerDocument.defaultView.scrollY;
  const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0)
    .map((r) => ({ top: r.top + scroll, bottom: r.bottom + scroll }))
    .sort((a, b) => a.top - b.top);
  const lines = [];
  for (const rect of rects) {
    const last = lines.at(-1);
    if (last && (rect.top + rect.bottom) / 2 < last.bottom) last.bottom = Math.max(last.bottom, rect.bottom);
    else lines.push({ ...rect });
  }
  return lines;
}

/** Where in a paragraph line `top` starts: { node, offset } before its
 *  first character, or before the math or element that starts it. */
function lineStart(element, top) {
  const doc = element.ownerDocument;
  const scroll = doc.defaultView.scrollY;
  const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const range = doc.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const math = node.parentElement.closest('math');
    for (let i = 0; i < node.length; i += 1) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const rect = [...range.getClientRects()].find((r) => r.height > 0);
      if (!rect || rect.top + scroll < top - 1) continue;
      if (/\s/.test(node.data[i]) && !math) continue;
      return math && element.contains(math) ? { before: math } : { node, offset: i };
    }
  }
  return null;
}

/** Cut a paragraph before the line starting at `top`: the rest becomes a
 *  paragraph of its own after it, which is returned. */
function cutParagraph(element, top) {
  const at = lineStart(element, top);
  if (!at) return null;
  const doc = element.ownerDocument;
  const range = doc.createRange();
  if (at.before) range.setStartBefore(at.before);
  else range.setStart(at.node, at.offset);
  range.setEnd(element, element.childNodes.length);
  // A word the line ended inside: hyphenated there, so the hyphen is kept.
  const before = at.node && at.offset > 0 ? at.node.data[at.offset - 1] : '';
  const hyphenated = /\p{L}/u.test(before) && /\p{L}/u.test(at.node.data[at.offset] || '');
  const rest = element.cloneNode(false);
  rest.removeAttribute('id');
  rest.append(range.extractContents());
  element.after(rest);
  if (hyphenated) element.append(doc.createTextNode('‐'));
  element.style.textAlignLast = 'justify';
  rest.style.textIndent = '0';
  return rest;
}

/** The contents' dotted leaders as text: as many periods as each leader's
 *  width holds at its spacing, set from the right so they stand in
 *  columns. Text prints in every print path; the stylesheet's generated
 *  dots did not in a print dialog. A section's own line has none. */
function writeLeaders(doc) {
  for (const leader of doc.querySelectorAll('.note-toc li:not(.toc-level-0) > .toc-leader')) {
    const probe = doc.createElement('span');
    probe.textContent = '.'.repeat(20);
    leader.append(probe);
    const advance = probe.getBoundingClientRect().width / 20;
    probe.remove();
    const width = leader.getBoundingClientRect().width;
    leader.textContent = advance > 0 ? '.'.repeat(Math.max(0, Math.floor(width / advance))) : '';
  }
}

/** Start a page at `element`: forced, its top margin dropped. */
function breakBefore(element) {
  element.style.breakBefore = 'page';
  element.style.marginTop = '0';
}

/**
 * Lay out a report's pages (core/report.js `{ html, page }`) and number its
 * contents: resolves to the report's HTML with every page break forced and
 * the contents' pages in, and `pages`, the page each section starts on
 * (a Map from its id). Runs in the editor: needs a document to lay it out.
 */
export async function paginateReport(html, page) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  const width = page.textWidthPt * PX_PER_PT;
  Object.assign(frame.style, { position: 'fixed', left: '-20000px', top: '0', width: `${Math.ceil(width) + 40}px`, height: '1000px', border: '0', visibility: 'hidden' });
  const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
  frame.srcdoc = html;
  document.body.append(frame);
  try {
    await loaded;
    const doc = frame.contentDocument;
    // Laid out as printed: the text width, without the screen's padding.
    const measure = doc.createElement('style');
    measure.textContent = `html, body { margin: 0 !important; padding: 0 !important; } body { width: ${width}px !important; max-width: none !important; }`;
    doc.head.append(measure);
    // Every face the report declares, loaded before anything is measured:
    // `fonts.ready` alone can resolve before a face is first asked for.
    await Promise.all([...doc.fonts].map((face) => face.load().catch(() => {})));
    doc.body.getBoundingClientRect();
    await doc.fonts.ready;
    // Measured in another face, the pages would not be the printed ones:
    // the report goes as it came, its contents unnumbered.
    if ([...doc.fonts].some((face) => face.status === 'error')) return { html, pages: new Map() };
    await Promise.all([...doc.images].map((image) => image.decode().catch(() => {})));

    const height = page.textHeightPt * PX_PER_PT - SLACK_PX;
    const starts = [];
    let pageTop = box(doc.body).top;
    let startElement = null;
    for (let guard = 0; guard < 2000; guard += 1) {
      const blocks = flowBlocks(doc.body);
      const index = blocks.findIndex(({ element }) => element !== startElement && box(element).bottom > pageTop + height
        && box(element).top >= pageTop - 0.5);
      if (index < 0) break;
      let { element } = blocks[index];
      let next = null;
      if (!blocks[index].whole) {
        // A paragraph: cut after the last line that fits, two lines a side.
        const lines = lineBoxes(element);
        const fit = lines.filter((line) => line.bottom <= pageTop + height).length;
        if (fit >= MIN_LINES && lines.length - fit >= MIN_LINES) next = cutParagraph(element, lines[fit].top);
      }
      if (!next) {
        // Whole: a heading above it, and a lead-in paragraph's last line, go with it.
        let at = index;
        while (at > 0 && keepsWithNext(blocks[at - 1].element) && blocks[at - 1].element !== startElement) at -= 1;
        const lead = blocks[at - 1];
        if (at === index && lead && !lead.whole && lead.element.nextElementSibling === element
          && element.matches('table, .note-display-math') && lead.element !== startElement) {
          const lines = lineBoxes(lead.element);
          if (lines.length > MIN_LINES) next = cutParagraph(lead.element, lines.at(-1).top);
          else at -= 1;
        }
        if (!next) next = blocks[at].element;
        if (next === startElement || box(next).top <= pageTop + 0.5) {
          // Taller than a page: the browser breaks it; go on below it.
          pageTop = box(element).bottom;
          startElement = element;
          continue;
        }
      }
      breakBefore(next);
      startElement = next;
      pageTop = box(next).top;
      starts.push(next);
    }

    // The page each section starts on.
    const tops = starts.map((element) => box(element).top);
    const pages = new Map();
    for (const heading of doc.querySelectorAll('[id]')) {
      const top = box(heading).top;
      pages.set(heading.id, 1 + tops.filter((t) => t <= top + 0.5).length);
    }
    writeLeaders(doc);
    measure.remove();
    const out = `<!doctype html>\n${doc.documentElement.outerHTML}\n`;
    return { html: reportWithPages(out, (id) => pages.get(id)), pages };
  } finally {
    frame.remove();
  }
}
