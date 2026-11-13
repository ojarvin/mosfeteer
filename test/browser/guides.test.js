/** Learn's guides in a browser: the ? button opens Learn, its search lists
 *  the guides that match beside the keys, and a match opens on the Guides
 *  tab, whose own search narrows the list. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, browserSkip } from './harness.js';
import { amplifier } from './fixtures.js';

describe('Learn\'s guides', { skip: browserSkip() }, () => {
  let h;
  before(async () => {
    h = await start({ docs: { amp: amplifier() }, width: 1400, height: 900 });
    await h.open('amp');
  });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  /** Type into a field as a user does: focused, then text inserted. */
  const type = async (selector, text) => {
    await h.evaluate(`(() => { const field = document.querySelector(${JSON.stringify(selector)}); field.focus(); field.select(); })()`);
    await h.send('Input.insertText', { text });
  };
  const shownGuide = () => h.evaluate(`document.querySelector('#help-guide h3')?.textContent`);

  test('a search in Learn finds a guide, and choosing it opens it on the Guides tab', async () => {
    await h.click('#btn-help');
    await h.until(`document.getElementById('help-dialog').open`);
    await type('#help-search', 'timing diagram');
    await h.until(`!!document.querySelector('#help-dialog-content [data-guide="timing"]')`);
    assert.equal(await h.evaluate(`document.querySelector('#help-dialog-content .help-guide-matches button').textContent`), 'Draw a timing diagram',
      'the guide named by the words comes first');
    assert.ok(await h.evaluate(`document.getElementById('help-dialog-content').textContent.includes('Shift+K')`), 'the keys still match');

    await h.click('#help-dialog-content [data-guide="timing"]');
    await h.until(`!document.getElementById('help-panel-guides').hidden`);
    assert.equal(await shownGuide(), 'Draw a timing diagram');
    assert.equal(await h.evaluate(`document.querySelector('#help-guide-list [aria-current="true"]').textContent`), 'Draw a timing diagram');
    assert.ok(await h.evaluate(`document.querySelectorAll('#help-guide .help-guide-steps li').length`) >= 3, 'numbered steps');
    assert.ok(await h.evaluate(`[...document.querySelectorAll('#help-guide kbd')].some((k) => k.textContent === 'Shift+K')`), 'keys as key caps');
    assert.match(await h.evaluate(`document.querySelector('#help-guide a.help-link').href`), /\/docs\/beats\.md$/);
  });

  test('the Guides tab lists every guide, and its search narrows them', async () => {
    await h.evaluate(`document.querySelector('#help-dialog [data-help-tab="guides"]').click()`);
    const all = await h.evaluate(`document.querySelectorAll('#help-guide-list .help-guide-item').length`);
    assert.ok(all >= 8, `${all} guides`);

    await type('#help-guide-search', 'truth table');
    await h.until(`document.querySelectorAll('#help-guide-list .help-guide-item').length < ${all}`);
    assert.equal(await shownGuide(), 'Analyze a logic circuit', 'the first match shows when the one shown is filtered out');

    await type('#help-guide-search', 'nothing like this');
    await h.until(`!!document.querySelector('#help-guide-list .help-empty')`);
    assert.equal(await shownGuide(), undefined, 'no match shows no guide');
  });

  test('a guide\'s tutorial link starts the tutorial and closes Learn', async () => {
    await type('#help-guide-search', 'signal flow');
    await h.until(`document.querySelector('#help-guide h3')?.textContent === 'Analyze a block diagram (signal flow)'`);
    await h.click('#help-guide [data-tutorial="sdm"]');
    await h.untilDiscarding(`${h.module('editor-state.js')}.then((m) => m.editor.tutorial?.id === 'sdm')`);
    assert.equal(await h.evaluate(`document.getElementById('help-dialog').open`), false);
  });
  test('the Math tab lists the TeX the labels take, each drawn beside what is typed', async () => {
    if (!await h.evaluate(`document.getElementById('help-dialog').open`)) {
      await h.click('#btn-help');
      await h.until(`document.getElementById('help-dialog').open`);
    }
    await h.click('[data-help-tab="math"]');
    await h.until(`!document.getElementById('help-panel-math').hidden && document.querySelectorAll('#help-math .help-math-tile').length > 0`);
    const shown = await h.evaluate(`(() => {
      const tiles = [...document.querySelectorAll('#help-math .help-math-tile')];
      const tile = tiles.find((t) => t.querySelector('code').textContent === '\\\\downarrow');
      return {
        headings: [...document.querySelectorAll('#help-math h3')].map((h) => h.textContent),
        rows: document.querySelectorAll('#help-math .help-math-table tr').length,
        tiles: tiles.length,
        arrow: tile?.querySelector('math')?.textContent,
      };
    })()`);
    const { GREEK_LOWER, GREEK_UPPER, TEX_SPACES, TEX_STRUCTURES, TEX_SYMBOLS } = await import('../../src/core/tex-markup.js');
    assert.deepEqual(shown.headings, ['Structures', 'Spaces', 'Greek', 'Symbols']);
    assert.equal(shown.rows, TEX_STRUCTURES.length + TEX_SPACES.length);
    // Every Greek letter and symbol but \sqrt, a structure here.
    assert.equal(shown.tiles, Object.keys({ ...GREEK_LOWER, ...GREEK_UPPER }).length + Object.keys(TEX_SYMBOLS).length - 1);
    assert.equal(shown.arrow, '↓');
  });
});
