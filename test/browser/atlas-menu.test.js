/** The Atlas's design menu in a browser: a right click on a design offers
 *  Edit, Rename, Tags, and Delete (confirmed); with several picked, only
 *  Tags and Delete, for all of them. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { start, sleep, browserSkip } from './harness.js';
import { amplifier, twoResistors } from './fixtures.js';

describe('Atlas design menu', { skip: browserSkip() }, () => {
  let h;
  before(async () => { h = await start({ docs: { amp: amplifier(), first: twoResistors(), second: twoResistors(), third: twoResistors() }, width: 1400, height: 900 }); });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  const snapshot = () => h.evaluate(`${h.module('atlas.js')}.then((m) => m.atlasSnapshot())`);
  const openDesk = async () => {
    if (!await snapshot()) await h.click('#app-mark');
    await h.until(`${h.module('atlas.js')}.then((m) => { const s = m.atlasSnapshot(); return !!s && !s.busy && s.tiles.length > 0; })`, 10000);
  };
  const tile = async (name) => (await snapshot()).tiles.find((t) => t.name === name);
  const center = (t) => ({ x: t.screen.x + t.screen.w / 2, y: t.screen.y + t.screen.h / 2 });
  const rightClick = async (name) => {
    const p = center(await tile(name));
    await h.mouse('mouseMoved', p.x, p.y, { button: 'none', buttons: 0 });
    await h.tap(p.x, p.y, { button: 'right' });
    await h.until(`!document.querySelector('.component-context-menu').hidden`);
  };
  const ctrlClick = async (name) => {
    const p = center(await tile(name));
    await h.mouse('mousePressed', p.x, p.y, { modifiers: 2 });
    await h.mouse('mouseReleased', p.x, p.y, { modifiers: 2 });
  };
  const items = () => h.evaluate(`[...document.querySelectorAll('.component-context-menu button')].map((b) => b.childNodes[0].textContent.trim())`);
  const choose = (text) => h.evaluate(`[...document.querySelectorAll('.component-context-menu button')].find((b) => b.childNodes[0].textContent.trim() === ${JSON.stringify(text)}).click()`);

  test('a right click on a design offers Edit, Rename, Tags, and Delete; Rename renames it', async () => {
    await h.open('amp');
    await openDesk();
    await rightClick('first');
    assert.deepEqual(await items(), ['Edit', 'Rename…', 'Tags…', 'Delete…']);
    assert.equal((await tile('first')).selected, true, 'the design right-clicked is picked');
    await choose('Rename…');
    await h.until(`document.activeElement?.classList.contains('atlas-tags')`);
    await h.evaluate(`(() => { const input = document.activeElement; input.value = 'renamed'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
    await h.until(`${h.module('atlas.js')}.then((m) => m.atlasSnapshot()?.tiles.some((t) => t.name === 'renamed'))`, 10000);
    assert.ok(existsSync(join(h.workspace, 'renamed.json')) && !existsSync(join(h.workspace, 'first.json')));
  });

  test('Tags… gives the design tags; Delete… asks first, and Cancel keeps it', async () => {
    await rightClick('second');
    await choose('Tags…');
    await h.until(`document.activeElement?.classList.contains('atlas-tags')`);
    await h.evaluate(`(() => { const input = document.activeElement; input.value = 'bias'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
    const tags = () => JSON.parse(readFileSync(join(h.workspace, 'second.json'), 'utf8')).tags || [];
    for (let i = 0; i < 300 && !tags().includes('bias'); i++) await sleep(50);
    assert.deepEqual(tags(), ['bias']);
    await rightClick('second');
    await choose('Delete…');
    await h.until(`document.getElementById('delete-dialog').open`);
    assert.match(await h.evaluate(`document.getElementById('delete-dialog-message').textContent`), /second\.json/);
    await h.evaluate(`document.querySelector('#delete-dialog button[value="cancel"]').click()`);
    await h.until(`!document.getElementById('delete-dialog').open`);
    assert.ok(existsSync(join(h.workspace, 'second.json')));
  });

  test('several picked: only tags and delete, for all of them, and Delete removes both', async () => {
    await rightClick('second');
    await h.evaluate(`${h.module('context-menu.js')}.then((m) => m.closeComponentContextMenu())`);
    await ctrlClick('third');
    await h.until(`${h.module('atlas.js')}.then((m) => m.atlasSnapshot().tiles.filter((t) => t.selected).length === 2)`);
    await rightClick('third');
    assert.deepEqual(await items(), ['Add tags…', 'Delete 2 designs…']);
    await choose('Delete 2 designs…');
    await h.until(`document.getElementById('delete-dialog').open`);
    await h.evaluate(`document.getElementById('confirm-delete').click()`);
    await h.until(`${h.module('atlas.js')}.then((m) => { const s = m.atlasSnapshot(); return s && !s.tiles.some((t) => t.name === 'second' || t.name === 'third'); })`, 10000);
    assert.ok(!existsSync(join(h.workspace, 'second.json')) && !existsSync(join(h.workspace, 'third.json')));
    assert.ok(existsSync(join(h.workspace, 'amp.json')), 'the open design stays');
  });

  test('a new accent color shows on the desk at once, not only when it opens again', async () => {
    await openDesk();
    // The desk reads its colors as it draws its first frame, which can
    // follow its laid-out tiles on a slow machine.
    await h.until(`${h.module('atlas.js')}.then((m) => !!m.atlasSnapshot()?.accent)`);
    const before = (await snapshot()).accent;
    await h.evaluate(`document.querySelector('#settings-accent [data-accent="orange"]').click()`);
    await h.until(`${h.module('atlas.js')}.then((m) => { const a = m.atlasSnapshot()?.accent; return !!a && a !== ${JSON.stringify(before)}; })`);
    assert.equal((await snapshot()).accent, await h.evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()`));
    await h.evaluate(`document.querySelector('#settings-accent [data-accent=""]').click()`);
    await h.until(`${h.module('atlas.js')}.then((m) => m.atlasSnapshot()?.accent === ${JSON.stringify(before)})`);
  });
});
