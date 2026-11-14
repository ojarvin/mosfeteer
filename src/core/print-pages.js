/**
 * Drawings laid out for printing to PDF: one page per SVG, each page the
 * size of its own drawing (CSS named pages), nothing around it. The server
 * prints this with headless Chromium (server/browser.js printSvgToPdf); the
 * browser-only build hands it to the browser's own print dialog
 * (web/print-pdf.js), where "Save as PDF" makes the same document.
 */

import { escapeSvg } from './style.js';
import { svgPixelSize } from './render.js';

/** The HTML that prints `pages` (SVG strings) one to a page. `title` names
 *  the document, which a print dialog offers as the file's name. */
export function printPagesHtml(pages, { title = '' } = {}) {
  if (!pages.length) throw new Error('a PDF needs at least one page');
  const sizes = pages.map((svg) => svgPixelSize(svg));
  // A named page per drawing, each its own size.
  const pageRules = sizes.map(({ width, height }, index) =>
    `@page p${index}{size:${width}px ${height}px;margin:0}.p${index}{page:p${index};width:${width}px;height:${height}px}.p${index} svg{width:${width}px;height:${height}px}`).join('');
  // The SVG is rendered by a real browser, so the page denies scripts and
  // every external load; only the inline drawing and its inline styles run.
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">${title ? `<title>${escapeSvg(title)}</title>` : ''}<style>@page{size:${sizes[0].width}px ${sizes[0].height}px;margin:0}html,body{margin:0;padding:0;background:#fff}svg{display:block}.page{break-after:page;overflow:hidden}.page:last-child{break-after:auto}${pageRules}</style></head><body>${pages.map((svg, index) => `<div class="page p${index}">${svg}</div>`).join('')}</body></html>`;
}
