/** The analysis window's sections, in every mode, sit one gap apart: no
 *  empty holder doubling a gap, no section with margins of its own, and
 *  the cards inside Options spaced as the column spaces them. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, browserSkip } from './harness.js';
import { scIntegrator, amplifier, modulator } from './fixtures.js';

// The vertical gaps between each column's visible, stacked children:
// the window's scroll column, each mode's section, and Options opened.
const GAPS = `(() => {
  const visible = (e) => e.getClientRects().length > 0;
  const gaps = [];
  const column = (box, name) => {
    const kids = [...box.children].filter(visible);
    for (let i = 1; i < kids.length; i += 1) {
      const a = kids[i - 1].getBoundingClientRect();
      const b = kids[i].getBoundingClientRect();
      if (b.top < a.bottom - 1) continue; // side by side
      gaps.push({ where: name + ': ' + (kids[i - 1].className || kids[i - 1].tagName) + ' / ' + (kids[i].className || kids[i].tagName), gap: Math.round(b.top - a.bottom) });
    }
  };
  const scroll = document.querySelector('#analysis-dialog .analysis-scroll');
  column(scroll, 'window');
  for (const section of scroll.querySelectorAll('.signal-flow-section')) if (visible(section)) column(section, section.id);
  const options = document.getElementById('analysis-options');
  if (visible(options)) column(options, 'options');
  return gaps;
})()`;

describe('analysis window spacing', { skip: browserSkip() }, () => {
  let h;
  before(async () => { h = await start({ docs: { sc: scIntegrator(), amp: amplifier(), mod: modulator() } }); });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  const check = async (label) => {
    const gaps = await h.evaluate(GAPS);
    assert.ok(gaps.length > 2, `${label}: sections measured`);
    // The mode bar sits closer above the intro (8); every other gap is 12.
    const uneven = gaps.filter(({ where, gap }) => gap !== 12 && !(/analysis-mode/.test(where) && gap === 8));
    assert.deepEqual(uneven, [], `${label}: uneven gaps`);
  };

  test('every mode, before and after Derive, its sections one gap apart', async () => {
    for (const [doc, modes] of [['amp', ['circuit', 'signal-flow']], ['mod', ['signal-flow']], ['sc', ['switched-cap']]]) {
      await h.open(doc);
      if (await h.evaluate(`document.getElementById('analysis-dialog').hidden`)) await h.key('S');
      await h.until(`!document.getElementById('analysis-dialog').hidden`);
      for (const mode of modes) {
        await h.evaluate(`document.querySelector('.analysis-mode [data-mode="${mode}"]').click()`);
        await h.until(`document.querySelector('.analysis-mode [data-mode="${mode}"]').getAttribute('aria-pressed') === 'true'`);
        await h.evaluate(`(() => { const o = document.getElementById('analysis-options'); if (o) o.open = true; const n = document.getElementById('sc-noise-on'); if (n && !n.checked && n.offsetParent) n.click(); })()`);
        await check(`${doc} ${mode}`);
        await h.evaluate(`[...document.querySelectorAll('#analysis-dialog .dialog-actions .primary-action')].find((b) => b.offsetParent)?.click()`);
        const result = { circuit: '#analysis-result:not([hidden])', 'signal-flow': '.signal-flow-results:not(:empty)', 'switched-cap': '.sc-calc-result table' }[mode];
        await h.until(`!!document.querySelector(${JSON.stringify(result)})`, 20000);
        await check(`${doc} ${mode} derived`);
      }
    }
  });
});
