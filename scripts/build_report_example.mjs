/**
 * The README's sample report: Learn's report example (src/web/examples/
 * report-example.js) built as the editor's Report export builds it -- the
 * same fonts embedded, A4, no page guide -- and printed with headless
 * Chromium to docs/report-example.pdf, its first page drawn to
 * docs/images/report-example.webp for the README. Run it after changing the
 * example or the report's look: `npm run report-example`. Needs Chromium,
 * and pdftoppm and ImageMagick for the picture.
 */

import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDocument } from '../src/core/document.js';
import { buildReport } from '../src/core/report.js';
import { printHtmlToPdf } from '../src/server/browser.js';
import { REPORT_EXAMPLE_NAMES, reportExampleDesigns } from '../src/web/examples/report-example.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fonts = join(ROOT, 'src', 'web', 'fonts');

/** The faces the editor embeds (web/drawing-export.js), read from disk. */
async function fontCss() {
  const face = async (file, family, weight = 'normal', style = 'normal') => {
    const data = (await readFile(join(fonts, file))).toString('base64');
    return `@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${data}) format("woff2");font-weight:${weight};font-style:${style}}`;
  };
  return (await Promise.all([
    face('latinmodern-math.woff2', 'Latin Modern Math'),
    face('lmroman10-regular.woff2', 'Latin Modern Roman'),
    face('lmroman10-italic.woff2', 'Latin Modern Roman', 'normal', 'italic'),
    face('lmroman10-bold.woff2', 'Latin Modern Roman', 'bold'),
    face('lmroman10-bolditalic.woff2', 'Latin Modern Roman', 'bold', 'italic'),
  ])).join('');
}

const designs = new Map(reportExampleDesigns().map(({ name, state }) => [name, { name, circuit: loadDocument(state) }]));
const top = designs.get(REPORT_EXAMPLE_NAMES.modulator);
const report = buildReport(top.circuit, {
  name: top.name,
  fontCss: await fontCss(),
  design: (name) => designs.get(name.trim().toLowerCase()) || null,
});
if (report.warnings.length) throw new Error(`the report example has warnings:\n${report.warnings.join('\n')}`);

const pdf = join(ROOT, 'docs', 'report-example.pdf');
await writeFile(pdf, await printHtmlToPdf(report.html));

const work = await mkdtemp(join(tmpdir(), 'mosfeteer-report-'));
try {
  execFileSync('pdftoppm', ['-r', '110', '-png', '-f', '1', '-l', '1', '-singlefile', pdf, join(work, 'page')]);
  execFileSync('magick', [join(work, 'page.png'), '-quality', '88', join(ROOT, 'docs', 'images', 'report-example.webp')]);
} finally {
  await rm(work, { recursive: true, force: true });
}
console.log(`docs/report-example.pdf: ${report.figures.length} figures; docs/images/report-example.webp: its first page`);
