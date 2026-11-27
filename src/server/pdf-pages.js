/**
 * Where a printed report's sections landed: Chromium writes each element id
 * a PDF links to as a named destination (the catalog's `/Dests`, one
 * `/id [page 0 R /XYZ ...]` entry each), and the page tree lists the pages
 * in order. Read from the PDF's own text -- Chromium writes these objects
 * uncompressed -- with no PDF library. Used to put page numbers in a
 * report's contents (browser.js printReportToPdf). And every PDF printed
 * has its stroke adjustment turned off (`withoutStrokeAdjustment`).
 */

/** The body of indirect object `number`, or null. */
function objectBody(text, number) {
  const match = new RegExp(`(?:^|[\\r\\n\\s])${number} 0 obj\\b([\\s\\S]*?)\\bendobj`).exec(text);
  return match ? match[1] : null;
}

/** A PDF name with its #xx escapes undone. */
const pdfName = (name) => name.replace(/#([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

/** The page objects in reading order: the page tree walked from `root`. */
function pageOrder(text, root, seen = new Set()) {
  if (seen.has(root)) return [];
  seen.add(root);
  const body = objectBody(text, root);
  if (!body) return [];
  if (!/\/Type\s*\/Pages\b/.test(body)) return [root];
  const kids = body.match(/\/Kids\s*\[([^\]]*)\]/);
  return kids ? [...kids[1].matchAll(/(\d+)\s+0\s+R/g)].flatMap((kid) => pageOrder(text, Number(kid[1]), seen)) : [];
}

/**
 * The page (from 1) of each named destination of a PDF: a Map from the
 * name (an element id) to its page. Empty when the PDF has none or reads
 * otherwise than Chromium writes it.
 */
export function pdfDestinationPages(pdf) {
  const text = Buffer.isBuffer(pdf) ? pdf.toString('latin1') : String(pdf);
  const pages = new Map();
  const catalog = /\/Type\s*\/Catalog\b[\s\S]*?\/Pages\s+(\d+)\s+0\s+R/.exec(text) || /\/Pages\s+(\d+)\s+0\s+R[\s\S]*?\/Type\s*\/Catalog\b/.exec(text);
  const dests = /\/Dests\s+(\d+)\s+0\s+R/.exec(text);
  if (!catalog || !dests) return pages;
  const order = new Map(pageOrder(text, Number(catalog[1])).map((page, index) => [page, index + 1]));
  const body = objectBody(text, Number(dests[1])) || '';
  for (const [, name, page] of body.matchAll(/\/([^\s/[\]<>()]+)\s*\[\s*(\d+)\s+0\s+R/g)) {
    if (order.has(Number(page))) pages.set(pdfName(name), order.get(Number(page)));
  }
  return pages;
}

/**
 * A PDF with its stroke adjustment off: Chromium writes `/SA true` in every
 * graphics state, which asks a viewer to round each line's width and place
 * to whole pixels while fills (a transistor's bars, an arrowhead, a dot)
 * keep their true size, so at some zooms lines thin or thicken against
 * the fills and a lead's end parts from the bar it overlaps. Each `/SA
 * true` in an object without a stream is blanked to spaces (the PDF's
 * default is off): the same length, so the cross-reference table holds.
 * Viewers that always adjust (Acrobat, poppler) are not changed by it.
 */
export function withoutStrokeAdjustment(pdf) {
  const bytes = Buffer.isBuffer(pdf) ? Buffer.from(pdf) : Buffer.from(String(pdf), 'latin1');
  const text = bytes.toString('latin1');
  for (const match of text.matchAll(/\d+\s+\d+\s+obj\b/g)) {
    const end = text.indexOf('endobj', match.index);
    if (end < 0) break;
    const body = text.slice(match.index, end);
    if (/\bstream\b/.test(body)) continue;
    for (const sa of body.matchAll(/\/SA\s+true\b/g)) bytes.fill(0x20, match.index + sa.index, match.index + sa.index + sa[0].length);
  }
  return bytes;
}
