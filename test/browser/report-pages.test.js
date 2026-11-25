/** A report's pages laid out in the editor (web/report-pages.js), for the
 *  browser's print dialog, checked against a real print: the paginated
 *  HTML is printed once by headless Chromium, and every element the PDF
 *  names (sections, figures, references) must be on the page the editor
 *  numbered it with. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, browserSkip } from './harness.js';
import { amplifier } from './fixtures.js';
import { printHtmlToPdf } from '../../src/server/browser.js';
import { pdfDestinationPages } from '../../src/server/pdf-pages.js';

describe('report pages laid out in the editor', { skip: browserSkip() }, () => {
  let h;
  before(async () => { h = await start({ docs: { amp: amplifier() } }); await h.open('amp'); });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  /** The report of `notes` (or of the report example), laid out in the
   *  page: { html, pages: [[id, page]], cuts }. */
  const paginated = (notes) => h.evaluate(`(async () => {
    const [{ buildReport }, { loadDocument }, { reportExampleDesigns }, { paginateReport }, fonts] = await Promise.all([
      ${h.module('../core/report.js')}, ${h.module('../core/document.js')}, ${h.module('examples/report-example.js')},
      ${h.module('report-pages.js')}, ${h.module('drawing-export.js')}]);
    const designs = new Map(reportExampleDesigns().map((d) => [d.name, { name: d.name, circuit: loadDocument(d.state) }]));
    const top = designs.get('report-example-modulator');
    const notes = ${JSON.stringify(notes ?? null)};
    if (notes !== null) top.circuit.notes = notes;
    const fontCss = (await fonts.embeddedMathFontFace()) + (await fonts.embeddedReportFontFaces());
    const built = buildReport(top.circuit, { name: top.name, fontCss, design: (n) => designs.get(n.trim().toLowerCase()) || null });
    const { html, pages } = await paginateReport(built.html, built.page);
    return { html, pages: [...pages], cuts: (html.match(/text-align-last: justify/g) || []).length };
  })()`);

  /** Print the laid-out HTML once and compare where the PDF put each id. */
  const check = async ({ html, pages }) => {
    const printed = pdfDestinationPages(await printHtmlToPdf(html));
    assert.ok(printed.size > 5, `the PDF names ${printed.size} elements`);
    const ours = new Map(pages);
    const wrong = [...printed].filter(([id, page]) => ours.has(id) && ours.get(id) !== page).map(([id, page]) => `${id}: numbered ${ours.get(id)}, printed on ${page}`);
    assert.deepEqual(wrong, []);
    const listed = [...html.matchAll(/data-toc-page="([^"]+)">(\d*)<\/span>/g)];
    assert.ok(listed.length > 0 && listed.every(([, id, page]) => Number(page) === printed.get(id)), 'the contents list the printed pages');
    return printed;
  };

  test('the report example prints on the pages its contents list', async () => {
    const result = await paginated();
    // Its leaders written in as text, a section's own line without one.
    const leaders = [...result.html.matchAll(/<li class="toc-level-(\d)">.*?<span class="toc-leader">([^<]*)<\/span>/g)].map(([, level, dots]) => [Number(level), dots]);
    assert.ok(leaders.length >= 10);
    for (const [level, dots] of leaders) {
      if (level === 0) assert.equal(dots, '');
      else assert.match(dots, /^\.{20,}$/);
    }
    const printed = await check(result);
    assert.ok(Math.max(...printed.values()) >= 6, 'several pages');
  });

  /** A long report of paragraphs of many lengths, lists, tables, and
   *  equations, so page ends land everywhere. */
  const stress = (start) => {
    const words = 'switched capacitor integrator settles quickly while the comparator decides, and the reference buffer recovers before sampling again'.split(' ');
    let seed = start;
    const word = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return words[seed % words.length]; };
    const paragraph = (n) => Array.from({ length: n }, word).join(' ').replace(/^./, (c) => c.toUpperCase()) + '.';
    const blocks = ['# Stress test', '', '[TOC]'];
    for (let section = 1; section <= 8; section += 1) {
      blocks.push(`## Section ${section}`, paragraph(40 + section * 17 + (start % 23)), paragraph(90 + section * 11 + (start % 31)));
      if (section % 2) blocks.push('- one item\n- two items, a little longer than the first one\n- three', '$$V_{OUT} = \\frac{C_S}{C_F} \\frac{1}{1 - z^{-1}}$$');
      else blocks.push(`### Part ${section}.1`, paragraph(60), '| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |');
      blocks.push(paragraph(150 + section * 9));
    }
    return blocks.join('\n\n');
  };

  for (const seed of [7, 12345, 99991]) {
    test(`long paragraphs, lists, tables, and equations near the foot of a page break where the editor broke them (seed ${seed})`, async () => {
      const result = await paginated(stress(seed));
      assert.ok(result.cuts >= 3, `paragraphs cut at page ends: ${result.cuts}`);
      const printed = await check(result);
      assert.ok(Math.max(...printed.values()) >= 6, 'several pages');
    });
  }
});
