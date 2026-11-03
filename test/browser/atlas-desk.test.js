/** The Atlas desk in a browser: its shape in any window, the workspace
 *  check, a design's place, the listing, the hierarchy chain, and a large
 *  desk coming to rest. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, sleep, stillDesk, browserSkip } from './harness.js';
import { linkedTop, tagged, wideAmplifier, withBeats } from './fixtures.js';
import { join } from 'node:path';
import { Circuit } from '../../src/core/model.js';
import { runCommand } from '../../src/core/commands.js';

describe('the Atlas desk keeps its own shape, whatever the window', { skip: browserSkip() }, () => {
  const docs = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`d${i}`, i % 2 ? wideAmplifier() : tagged(`T${i}`)]));
  const desk = async (h) => {
    await h.click('#app-mark');
    await h.until(`${h.module('atlas.js')}.then((m) => { const s = m.atlasSnapshot(); return !!s && !s.busy && s.tiles.length === 9; })`, 15000);
    const tiles = await h.evaluate(`${h.module('atlas.js')}.then((m) => m.atlasSnapshot().tiles.map((t) => [t.name, t.x, t.y]))`);
    await h.click('#app-mark');
    await h.until(`${h.module('atlas.js')}.then((m) => !m.atlasSnapshot())`, 15000);
    return Object.fromEntries(tiles.map(([name, x, y]) => [name, [x, y]]));
  };
  const fresh = async (width, height) => {
    const h = await start({ docs, width, height });
    try {
      await h.open('d0');
      return await desk(h);
    } finally {
      await h.stop();
    }
  };

  test('a remembered desk opens the same in a narrow window', async () => {
    const h = await start({ docs, width: 1600, height: 800 });
    try {
      await h.open('d0');
      const wide = await desk(h);
      await h.send('Emulation.setDeviceMetricsOverride', { width: 700, height: 1200, deviceScaleFactor: 1, mobile: false });
      await h.settle();
      assert.deepEqual(await desk(h), wide);
    } finally {
      await h.stop();
    }
  });

  test('a fresh desk is the same in a narrow window and a wide one', async () => {
    assert.deepEqual(await fresh(700, 1200), await fresh(1600, 800));
  });
});

describe('the workspace check', { skip: browserSkip() }, () => {
  // system links OA1 to "opamp", renamed in a file manager to ota-v2 (its
  // file remembers it was saved as opamp), and R1 to "nothing", which no
  // design is or was called.
  const system = () => {
    const circuit = new Circuit();
    for (const line of ['add opamp OA1 --at 0 0', 'add resistor R1 --at -600 -40', 'link OA1 opamp', 'link R1 nothing']) runCommand(circuit, line);
    return circuit.toJSON();
  };
  let h;
  before(async () => {
    h = await start({ docs: { system: system(), 'ota-v2': { ...wideAmplifier(), names: ['opamp'] } }, width: 1400, height: 900 });
  });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });
  const snapshot = () => h.evaluate(`${h.module('atlas.js')}.then((m) => m.atlasSnapshot())`);
  const link = (ref) => h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.components.get(${JSON.stringify(ref)}).link)`);
  const menuItems = () => h.evaluate(`[...document.querySelectorAll('#atlas-check-menu [role="menuitem"]')].map((b) => b.textContent)`);

  test('in the editor, Design Check lists the open design\'s broken links and relinks the one it can', async () => {
    await h.open('system');
    await h.evaluate(`${h.module('atlas.js')}.then((m) => { if (m.atlasSnapshot()) document.getElementById('app-mark').click(); })`);
    await h.until(`${h.module('atlas.js')}.then((m) => !m.atlasSnapshot())`, 10000);
    const report = await h.evaluate(`${h.module('design-check-ui.js')}.then((m) => m.runCheck().brokenLinks)`);
    assert.deepEqual(report, ['OA1 → opamp', 'R1 → nothing']);
    const fixes = await h.evaluate(`[...document.querySelectorAll('#check-summary .check-fix')].map((b) => b.textContent)`);
    assert.deepEqual(fixes, ['Relink to ota-v2'], 'only the link with one design saved under its name is relinked');
    await h.evaluate(`[...document.querySelectorAll('#check-summary .check-fix')].find((b) => b.textContent === 'Relink to ota-v2').click()`);
    assert.equal(await link('OA1'), 'ota-v2');
    assert.equal(await link('R1'), 'nothing');
    // One undo step puts it back.
    await h.key('z', { ctrlKey: true });
    assert.equal(await link('OA1'), 'opamp');
  });

  test('in the Atlas, Check counts what needs a look, relinks in the files, and opens a design at its broken parts', async () => {
    await h.open('ota-v2');
    await h.click('#app-mark');
    await h.until(`${h.module('atlas.js')}.then((m) => { const s = m.atlasSnapshot(); return !!s && !s.busy; })`, 10000);
    assert.equal(await h.evaluate(`document.getElementById('atlas-check').dataset.findings`), '2');
    assert.equal(await h.evaluate(`document.getElementById('atlas-check').classList.contains('atlas-check-findings')`), true, 'amber while there is something');
    await h.click('#atlas-check');
    assert.deepEqual(await menuItems(), ['Relink system: OA1 → opamp to ota-v2', 'Open system: R1 → nothing']);
    await h.evaluate(`[...document.querySelectorAll('#atlas-check-menu [role="menuitem"]')][0].click()`);
    // Written into system's file; the desk's links follow at once.
    const { readFile } = await import('node:fs/promises');
    await h.until(`document.getElementById('atlas-check').dataset.findings === '1'`, 5000);
    const saved = JSON.parse(await readFile(join(h.workspace, 'system.json'), 'utf8'));
    assert.deepEqual(saved.components.map((c) => [c.refdes, c.link]).sort(), [['OA1', 'ota-v2'], ['R1', 'nothing']]);
    assert.deepEqual(await menuItems(), ['Open system: R1 → nothing']);
    // Opening it lands on the part to relink by hand.
    await h.evaluate(`[...document.querySelectorAll('#atlas-check-menu [role="menuitem"]')][0].click()`);
    await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.currentCircuitName === 'system')`, 10000);
    await h.until(`${h.module('atlas.js')}.then((m) => !m.atlasSnapshot())`, 10000);
    assert.deepEqual(await h.evaluate(`${h.module('main.js')}.then((m) => m.selectedComps().map((c) => c.refdes))`), ['R1']);
    assert.equal(await snapshot(), null);
  });
});

describe('the workspace check reads the notes\' links', { skip: browserSkip() }, () => {
  // The notes link to OpAmp (saved as opamp, renamed to ota-v2) and to
  // nowhere, which R1 links to as well.
  const system = () => {
    const circuit = new Circuit();
    for (const line of ['add resistor R1 --at -600 -40', 'link R1 nowhere']) runCommand(circuit, line);
    circuit.notes = 'Built on [[OpAmp]]; R1 is [[nowhere]] yet.';
    return circuit.toJSON();
  };
  let h;
  before(async () => {
    h = await start({ docs: { system: system(), 'ota-v2': { ...wideAmplifier(), names: ['opamp'] } }, width: 1400, height: 900 });
  });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });
  const notes = () => h.evaluate(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.notes)`);
  const menuItems = () => h.evaluate(`[...document.querySelectorAll('#atlas-check-menu [role="menuitem"]')].map((b) => b.textContent)`);

  test('Design Check lists them, relinks the one it can in the notes, and shows the notes for the rest', async () => {
    await h.open('system');
    await h.evaluate(`${h.module('atlas.js')}.then((m) => { if (m.atlasSnapshot()) document.getElementById('app-mark').click(); })`);
    await h.until(`${h.module('atlas.js')}.then((m) => !m.atlasSnapshot())`, 10000);
    const report = await h.evaluate(`${h.module('design-check-ui.js')}.then((m) => m.runCheck().brokenLinks)`);
    assert.deepEqual(report, ['R1, notes → nowhere', 'notes → OpAmp']);
    await h.evaluate(`[...document.querySelectorAll('#check-summary .check-fix')].find((b) => b.textContent === 'Relink to ota-v2').click()`);
    assert.equal(await notes(), 'Built on [[ota-v2]]; R1 is [[nowhere]] yet.');
    await h.key('z', { ctrlKey: true });
    assert.equal(await notes(), 'Built on [[OpAmp]]; R1 is [[nowhere]] yet.');
    await h.evaluate(`${h.module('design-check-ui.js')}.then((m) => m.runCheck())`);
    await h.evaluate(`[...document.querySelectorAll('#check-summary .check-issue')].find((b) => b.textContent.includes('notes → nowhere')).click()`);
    await h.until(`!!document.querySelector('.notes-window:not([hidden])')`);
    assert.deepEqual(await h.evaluate(`${h.module('main.js')}.then((m) => m.selectedComps().map((c) => c.refdes))`), ['R1']);
    await h.key('N', { shiftKey: true });
  });

  test('the Atlas Check relinks the notes in the file', async () => {
    await h.open('ota-v2');
    await h.click('#app-mark');
    await h.until(`${h.module('atlas.js')}.then((m) => { const s = m.atlasSnapshot(); return !!s && !s.busy; })`, 10000);
    assert.equal(await h.evaluate(`document.getElementById('atlas-check').dataset.findings`), '2');
    await h.click('#atlas-check');
    assert.deepEqual(await menuItems(), ['Open system: R1, notes → nowhere', 'Relink system: notes → OpAmp to ota-v2']);
    await h.evaluate(`[...document.querySelectorAll('#atlas-check-menu [role="menuitem"]')][1].click()`);
    await h.until(`document.getElementById('atlas-check').dataset.findings === '1'`, 5000);
    const { readFile } = await import('node:fs/promises');
    const saved = JSON.parse(await readFile(join(h.workspace, 'system.json'), 'utf8'));
    assert.equal(saved.notes, 'Built on [[ota-v2]]; R1 is [[nowhere]] yet.');
    assert.deepEqual(await menuItems(), ['Open system: R1, notes → nowhere']);
  });
});

describe('a design keeps its place on the desk whether or not it is open', { skip: browserSkip() }, () => {
  // The browser measures an open design's math, tighter than the size the
  // file saves: the desk must not size (and so move) a design by that.
  const withMath = () => {
    const circuit = new Circuit();
    runCommand(circuit, 'add resistor R1 --at 0 0');
    circuit.addLabel({ text: '$H(s) = \\frac{g_m}{s C_L} \\cdot \\frac{1}{1 + s / \\omega_p}$', math: true, anchor: { x: 600, y: 0 } });
    return circuit.toJSON();
  };
  let h;
  before(async () => {
    h = await start({ docs: { formula: withMath(), plain: wideAmplifier(), other: tagged('CA') }, width: 1300, height: 900 });
  });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });
  const tiles = async ({ repack = false } = {}) => {
    await h.click('#app-mark');
    await h.until(`${h.module('atlas.js')}.then((m) => { const s = m.atlasSnapshot(); return !!s && !s.busy && s.tiles.length === 3; })`, 10000);
    if (repack) {
      await h.evaluate(`document.getElementById('atlas').dispatchEvent(new KeyboardEvent('keydown', { key: 'T', shiftKey: true, bubbles: true }))`);
      await stillDesk(h);
    }
    const s = await h.evaluate(`${h.module('atlas.js')}.then((m) => m.atlasSnapshot())`);
    await h.click('#app-mark');
    await h.until(`${h.module('atlas.js')}.then((m) => !m.atlasSnapshot())`, 10000);
    return Object.fromEntries(s.tiles.map((t) => [t.name, { x: t.x, y: t.y, w: t.w, h: t.h }]));
  };

  test('opening and leaving designs, with no edits, moves nothing on the desk; nor does tidying it twice', async () => {
    const { readFile } = await import('node:fs/promises');
    const file = join(h.workspace, 'formula.json');
    const before = await readFile(file, 'utf8');
    await h.open('formula');
    // Its math measured in the editor first: that is no edit.
    await h.until(`${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.labels.values()].filter((l) => l.math).every((l) => l.textMeasured()))`);
    assert.equal(await h.evaluate(`${h.module('document-session.js')}.then((m) => m.hasUnsavedChanges())`), false, 'measuring math is no change');
    assert.equal(await h.evaluate(`document.getElementById('dirty-dot').hidden`), true);
    const open = await tiles();
    await h.open('plain');
    assert.equal(await readFile(file, 'utf8'), before, 'leaving it writes nothing');
    const closed = await tiles();
    assert.deepEqual(closed, open);
    await h.open('formula');
    await h.until(`${h.module('editor-state.js')}.then((m) => [...m.editor.circuit.labels.values()].filter((l) => l.math).every((l) => l.textMeasured()))`);
    assert.deepEqual(await tiles(), open);
    // Shift+T tidies; with nothing changed, a second time moves nothing,
    // and the tidy desk is remembered.
    const packed = await tiles({ repack: true });
    await h.open('plain');
    assert.deepEqual(await tiles({ repack: true }), packed);
    assert.deepEqual(await tiles(), packed);
  });
});

describe('the Atlas listing', { skip: browserSkip() }, () => {
  const timed = () => {
    const circuit = new Circuit();
    runCommand(circuit, 'add resistor R1 --at 0 0');
    circuit.addLabel({ text: 'p1', x: 400, y: 0, timing: { phase: 'p1', bits: '0110' } });
    return circuit.toJSON();
  };
  const noted = () => {
    const circuit = new Circuit();
    for (const line of ['add capacitor CA --at 0 0', 'tag add filters', 'notes set "A filter."', 'history checkpoint first']) runCommand(circuit, line);
    return circuit.toJSON();
  };
  let h;
  before(async () => {
    // Narrow enough that the List button sits near the right edge.
    h = await start({ docs: { top: linkedTop(), child: wideAmplifier(), alpha: noted(), gamma: withBeats(), timed: timed() }, width: 1000, height: 900 });
  });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });
  const rows = () => h.evaluate(`[...document.querySelectorAll('#atlas-list-panel tbody tr')].map((tr) => [...tr.cells].map((td) => td.querySelector('.atlas-list-name')?.textContent ?? td.textContent))`);
  const names = async () => (await rows()).map((row) => row[0]);

  test('lists every design with its tags and what it holds, sorts both ways, and renames as the editor does', async () => {
    await h.open('top');
    if (!await h.evaluate(`${h.module('atlas.js')}.then((m) => !!m.atlasSnapshot())`)) await h.click('#app-mark');
    await h.until(`${h.module('atlas.js')}.then((m) => { const s = m.atlasSnapshot(); return !!s && !s.busy && s.tiles.length === 5; })`, 10000);
    await h.click('#atlas-list');
    assert.equal(await h.evaluate(`!document.getElementById('atlas-list-panel').hidden`), true);
    assert.deepEqual(await names(), ['alpha', 'child', 'gamma', 'timed', 'top'], 'by name');
    // It stays inside the window, and a wheel over it scrolls it, not the desk.
    await h.settle();
    const fit = await h.evaluate(`(() => { const r = document.getElementById('atlas-list-panel').getBoundingClientRect(); return { left: r.left, right: r.right, width: innerWidth }; })()`);
    assert.ok(fit.left >= 0 && fit.right <= fit.width, JSON.stringify(fit));
    const view = (await h.evaluate(`${h.module('atlas.js')}.then((m) => m.atlasSnapshot().view)`));
    const swallowed = await h.evaluate(`(() => { const ev = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }); document.querySelector('#atlas-list-panel tbody tr').dispatchEvent(ev); return ev.defaultPrevented; })()`);
    assert.equal(swallowed, false, 'the listing scrolls');
    assert.deepEqual(await h.evaluate(`${h.module('atlas.js')}.then((m) => m.atlasSnapshot().view)`), view, 'the desk stays');
    const byName = Object.fromEntries((await rows()).map((row) => [row[0], row]));
    // name, saved, tags, beats, timing, links, notes, checkpoints, used in
    assert.equal(byName.alpha[2], '#filters');
    assert.deepEqual(byName.alpha.slice(3), ['', '', '', '✓', '1', '']);
    assert.deepEqual(byName.gamma.slice(3), ['✓', '', '', '', '', '']);
    assert.deepEqual(byName.timed.slice(3), ['', '✓', '', '', '', '']);
    assert.deepEqual(byName.top.slice(3), ['', '', '✓', '', '', '']);
    assert.deepEqual(byName.child.slice(3), ['', '', '', '', '', '1']);
    assert.equal(await h.evaluate(`[...document.querySelectorAll('#atlas-list-panel tbody tr')].find((tr) => tr.querySelector('.atlas-list-name').textContent === 'child').cells[8].title`), 'top');
    assert.ok(byName.top[1], 'when it was saved');
    // Name again: Z to A.
    const sortBy = (key) => h.evaluate(`[...document.querySelectorAll('#atlas-list-panel .atlas-list-sort')].find((b) => b.title === 'Sort by ${key}').click()`);
    await sortBy('name');
    assert.deepEqual(await names(), ['top', 'timed', 'gamma', 'child', 'alpha']);
    // By date, then its reverse: the same designs, opposite orders.
    await sortBy('date');
    const newest = await names();
    await sortBy('date');
    assert.deepEqual(await names(), [...newest].reverse());
    await sortBy('name');

    // A double-click renames; Esc keeps the name, and the listing open.
    const rename = (from, to, key) => h.evaluate(`(() => {
      const name = [...document.querySelectorAll('#atlas-list-panel .atlas-list-name')].find((n) => n.textContent === ${JSON.stringify(from)});
      name.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      const input = document.querySelector('#atlas-list-panel .atlas-list-edit');
      input.value = ${JSON.stringify(to)};
      input.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }));
    })()`);
    await rename('child', 'nope', 'Escape');
    assert.equal(await h.evaluate(`!document.getElementById('atlas-list-panel').hidden`), true, 'still open');
    assert.ok((await names()).includes('child'));
    await rename('child', 'child-amp', 'Enter');
    await h.until(`[...document.querySelectorAll('#atlas-list-panel .atlas-list-name')].some((n) => n.textContent === 'child-amp')`, 10000);
    assert.deepEqual(await names(), ['alpha', 'child-amp', 'gamma', 'timed', 'top']);
    // The file is renamed, and the design linking to it follows.
    const { readFile, access } = await import('node:fs/promises');
    await access(join(h.workspace, 'child-amp.json'));
    await assert.rejects(access(join(h.workspace, 'child.json')));
    const top = JSON.parse(await readFile(join(h.workspace, 'top.json'), 'utf8'));
    assert.equal(top.components.find((c) => c.refdes === 'OA1').link, 'child-amp');
    assert.equal((await h.evaluate(`${h.module('atlas.js')}.then((m) => m.atlasSnapshot().tiles.find((t) => t.selected)?.name)`)), 'child-amp', 'picked on the desk');
  });

  test('Shift+L opens it for the keys: arrows step through the designs, # edits tags, Enter opens one', async () => {
    const atlasKey = (key, init = {}) => h.evaluate(`document.getElementById('atlas').dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, ...${JSON.stringify(init)} }))`);
    const listKey = (key, init = {}) => h.evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true, ...${JSON.stringify(init)} }))`);
    const open = () => h.evaluate(`!document.getElementById('atlas-list-panel').hidden`);
    const picked = () => h.evaluate(`document.querySelector('#atlas-list-panel tr.picked .atlas-list-name')?.textContent ?? null`);
    if (await open()) await h.click('#atlas-list');
    // Let go of the pick, so the arrows start from the top.
    await atlasKey('Escape');
    await atlasKey('L', { shiftKey: true });
    assert.equal(await open(), true);
    assert.equal(await h.evaluate(`document.activeElement.id`), 'atlas-list-panel', 'it has the keys');
    assert.equal(await picked(), null);
    await listKey('ArrowDown');
    assert.equal(await picked(), 'alpha');
    await listKey('ArrowDown');
    assert.equal(await picked(), 'child-amp');
    await listKey('ArrowUp');
    assert.equal(await picked(), 'alpha');
    assert.equal((await h.evaluate(`${h.module('atlas.js')}.then((m) => m.atlasSnapshot().tiles.find((t) => t.selected)?.name)`)), 'alpha', 'picked on the desk too');
    // # edits the picked design's tags, saved as # on the desk saves them.
    await listKey('#');
    await h.evaluate(`(() => { const input = document.querySelector('#atlas-list-panel .atlas-list-edit'); input.value = 'filters audio'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
    await h.until(`[...document.querySelectorAll('#atlas-list-panel .atlas-list-tags')].some((td) => td.textContent === '#filters #audio')`, 5000);
    const { readFile } = await import('node:fs/promises');
    assert.deepEqual(JSON.parse(await readFile(join(h.workspace, 'alpha.json'), 'utf8')).tags, ['filters', 'audio']);
    // Shift+L again closes it; open again, Enter opens the picked design.
    await listKey('L', { shiftKey: true });
    assert.equal(await open(), false);
    await atlasKey('L', { shiftKey: true });
    await listKey('ArrowDown');
    await listKey('Enter');
    await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.currentCircuitName === 'child-amp')`, 10000);
    await h.until(`${h.module('atlas.js')}.then((m) => !m.atlasSnapshot())`, 10000);
  });

  test('Shift and Ctrl pick several; # then adds tags to each of them, never twice', async () => {
    const atlasKey = (key, init = {}) => h.evaluate(`document.getElementById('atlas').dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, ...${JSON.stringify(init)} }))`);
    const listKey = (key, init = {}) => h.evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true, ...${JSON.stringify(init)} }))`);
    const picked = () => h.evaluate(`[...document.querySelectorAll('#atlas-list-panel tr.picked .atlas-list-name')].map((n) => n.textContent)`);
    await h.click('#app-mark');
    await h.until(`${h.module('atlas.js')}.then((m) => { const s = m.atlasSnapshot(); return !!s && !s.busy; })`, 10000);
    await atlasKey('Escape');
    await atlasKey('L', { shiftKey: true });
    await listKey('ArrowDown');
    await listKey('ArrowDown', { shiftKey: true });
    await listKey('ArrowDown', { shiftKey: true });
    assert.deepEqual(await picked(), ['alpha', 'child-amp', 'gamma']);
    // The desk picks them too.
    assert.deepEqual((await h.evaluate(`${h.module('atlas.js')}.then((m) => m.atlasSnapshot().tiles.filter((t) => t.selected).map((t) => t.name).sort())`)), ['alpha', 'child-amp', 'gamma']);
    // Ctrl+click takes one out, and puts it back.
    const click = (name, init) => h.evaluate(`[...document.querySelectorAll('#atlas-list-panel tbody tr')].find((tr) => tr.querySelector('.atlas-list-name').textContent === ${JSON.stringify(name)}).dispatchEvent(new MouseEvent('click', { bubbles: true, ...${JSON.stringify(init)} }))`);
    await click('child-amp', { ctrlKey: true });
    assert.deepEqual(await picked(), ['alpha', 'gamma']);
    await click('child-amp', { ctrlKey: true });
    assert.deepEqual(await picked(), ['alpha', 'child-amp', 'gamma']);
    await h.evaluate(`document.getElementById('atlas-list-panel').focus()`);
    await listKey('#');
    assert.equal(await h.evaluate(`document.querySelector('#atlas-list-panel .atlas-list-edit').placeholder`), 'tags to add to 3 designs');
    // alpha already has filters (and audio): it is not added twice.
    await h.evaluate(`(() => { const input = document.querySelector('#atlas-list-panel .atlas-list-edit'); input.value = 'shared filters'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
    const { readFile } = await import('node:fs/promises');
    const tags = async (name) => JSON.parse(await readFile(join(h.workspace, `${name}.json`), 'utf8')).tags;
    await h.until(`[...document.querySelectorAll('#atlas-list-panel .atlas-list-tags')].filter((td) => td.textContent.includes('#shared')).length === 3`, 10000);
    assert.deepEqual(await tags('alpha'), ['filters', 'audio', 'shared']);
    assert.deepEqual(await tags('child-amp'), ['shared', 'filters']);
    assert.deepEqual(await tags('gamma'), ['shared', 'filters']);
    assert.equal(await tags('top'), undefined, 'the rest untouched');
    // A plain click picks one again.
    await click('top', {});
    assert.deepEqual(await picked(), ['top']);
    await h.click('#atlas-list');
  });
});

describe('a long Atlas listing scrolls with its keys', { skip: browserSkip() }, () => {
  let h;
  before(async () => {
    const docs = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`design-${String(i).padStart(2, '0')}`, tagged(`T${i}`)]));
    h = await start({ docs, width: 1100, height: 520 });
  });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  test('up to the top row, it shows whole below the header; down to the last, at the bottom', async () => {
    if (!await h.evaluate(`${h.module('atlas.js')}.then((m) => !!m.atlasSnapshot())`)) await h.click('#app-mark');
    await h.until(`${h.module('atlas.js')}.then((m) => { const s = m.atlasSnapshot(); return !!s && !s.busy && s.tiles.length === 30; })`, 15000);
    await h.evaluate(`document.getElementById('atlas').dispatchEvent(new KeyboardEvent('keydown', { key: 'L', shiftKey: true, bubbles: true }))`);
    await h.settle();
    const key = (k) => h.evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true }))`);
    const shows = () => h.evaluate(`(() => {
      const panel = document.getElementById('atlas-list-panel');
      const row = panel.querySelector('tr.cursor');
      const head = panel.querySelector('thead').getBoundingClientRect();
      const box = panel.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      return { name: row.querySelector('.atlas-list-name').textContent, below: r.top >= head.bottom - 0.5, inside: r.bottom <= box.bottom + 0.5, scrollTop: panel.scrollTop };
    })()`);
    await key('End');
    let at = await shows();
    assert.equal(at.name, 'design-29');
    assert.ok(at.inside && at.scrollTop > 0, JSON.stringify(at));
    for (let i = 0; i < 29; i++) {
      await key('ArrowUp');
      at = await shows();
      assert.ok(at.below && at.inside, `${at.name} in view: ${JSON.stringify(at)}`);
    }
    assert.equal(at.name, 'design-00');
    assert.equal(at.scrollTop, 0, 'all the way up');
    // Esc closes it and gives the keys back to the desk: the List button,
    // never pressed, takes no focus (and shows no focus ring).
    await key('Escape');
    await h.until(`document.getElementById('atlas-list-panel').hidden`);
    assert.equal(await h.evaluate(`document.activeElement.id`), 'atlas');
  });

  test("open, it leaves the bar's buttons as they were and stays inside the window as the window changes", async () => {
    if (!await h.evaluate(`${h.module('atlas.js')}.then((m) => !!m.atlasSnapshot())`)) await h.click('#app-mark');
    await h.until(`${h.module('atlas.js')}.then((m) => { const s = m.atlasSnapshot(); return !!s && !s.busy; })`, 10000);
    if (await h.evaluate(`!document.getElementById('atlas-list-panel').hidden`)) await h.click('#atlas-list');
    const compact = () => h.evaluate(`document.querySelector('.toolbar').dataset.compact`);
    const inside = async () => {
      // Measured where it settles: the open's scale-in is over.
      await h.until(`document.getAnimations().every((a) => !a.effect?.target?.closest?.('#atlas-list-panel'))`, 5000);
      const fit = await h.evaluate(`(() => { const r = document.getElementById('atlas-list-panel').getBoundingClientRect(); return { left: r.left, right: r.right, width: innerWidth }; })()`);
      assert.ok(fit.left >= 0 && fit.right <= fit.width, JSON.stringify(fit));
    };
    const size = await h.evaluate(`({ width: innerWidth, height: innerHeight })`);
    const resize = async (width) => {
      await h.send('Emulation.setDeviceMetricsOverride', { width, height: size.height, deviceScaleFactor: 1, mobile: false });
      await h.settle();
    };
    const before = await compact();
    await h.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    try {
      await h.click('#atlas-list');
      await h.settle();
      assert.equal(await compact(), before, 'opening it condenses nothing');
      await inside();
      await resize(size.width - 300);
      await inside();
      await resize(size.width);
      assert.equal(await compact(), before, 'wide again, the buttons are as before');
      await inside();
    } finally {
      await h.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await resize(size.width);
    }
    await h.click('#atlas-list');
    await h.until(`document.getElementById('atlas-list-panel').hidden`);
  });
});

describe('Atlas hierarchy chain', { skip: browserSkip() }, () => {
  let h;
  // top -> mid -> leaf -> deep -> deeper, and a design using top.
  const linking = (to) => {
    const circuit = new Circuit();
    for (const line of ['add opamp OA1 --at 0 0', ...(to ? [`link OA1 ${to}`] : [])]) runCommand(circuit, line);
    return circuit.toJSON();
  };
  before(async () => {
    h = await start({ docs: { top: linking('mid'), mid: linking('leaf'), leaf: linking('deep'), deep: linking('deeper'), deeper: linking(null), user: linking('top'), other: linking(null) }, width: 1400, height: 900 });
  });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  test("the pick's children lift less a level at a time, three levels down, with fainter beams", async () => {
    await h.open('top');
    await h.click('#app-mark');
    await h.until(`${h.module('atlas.js')}.then((m) => { const s = m.atlasSnapshot(); return !!s && !s.busy && s.tiles.length === 7; })`, 10000);
    await h.evaluate(`${h.module('atlas.js')}.then(async (m) => {
      for (let i = 0; i < 12 && m.atlasSnapshot().tiles.find((t) => t.selected)?.name !== 'top'; i++) {
        document.getElementById('atlas').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
        await new Promise((r) => setTimeout(r, 30));
      }
    })`);
    await h.until(`${h.module('atlas.js')}.then((m) => { const s = m.atlasSnapshot(); return s.tiles.find((t) => t.name === 'top').lift === 1 && s.tiles.every((t) => t.lift === 0 || t.lift > 0.05) && s.beams.length >= 4; })`);
    const s = await h.evaluate(`${h.module('atlas.js')}.then((m) => m.atlasSnapshot())`);
    const t = Object.fromEntries(s.tiles.map((tile) => [tile.name, tile]));
    assert.ok(t.top.lift > t.mid.lift && t.mid.lift > t.leaf.lift && t.leaf.lift > t.deep.lift && t.deep.lift > 0, JSON.stringify(s.tiles.map((x) => [x.name, x.lift])));
    assert.equal(t.user.lift, t.mid.lift, 'a design using the pick lifts as its children do');
    assert.ok(t.deeper.lift === 0 && t.deeper.dim === 1 && t.other.dim === 1, 'past three levels, and off the chain, the rest lie flat and dim');
    // The pick alone at full strength; its kin a step down, the chain dimmer as it goes.
    assert.ok(t.top.dim === 0 && t.mid.dim > 0 && t.leaf.dim > t.mid.dim && t.deep.dim > t.leaf.dim, JSON.stringify(s.tiles.map((x) => [x.name, x.dim])));
    const depthOf = (from, to) => s.beams.find((b) => b.from === t[from].id && b.to === t[to].id)?.depth;
    assert.deepEqual([depthOf('top', 'mid'), depthOf('user', 'top'), depthOf('mid', 'leaf'), depthOf('leaf', 'deep'), depthOf('deep', 'deeper')], [1, 1, 2, 3, undefined]);
  });

  test('with the links hidden the pick lifts alone; shown again, its kin float back up', async () => {
    const atlasKey = (key) => h.evaluate(`document.getElementById('atlas').dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }))`);
    const lifts = `${h.module('atlas.js')}.then((m) => Object.fromEntries(m.atlasSnapshot().tiles.map((t) => [t.name, t])))`;
    await h.until(`${lifts}.then((t) => t.top.lift === 1 && t.mid.lift > 0)`);
    await atlasKey('l');
    await h.until(`${lifts}.then((t) => t.top.lift === 1 && ['mid', 'leaf', 'deep', 'user'].every((n) => t[n].lift === 0 && t[n].dim === 1 && !t[n].float.dx && !t[n].float.dy))`);
    await atlasKey('l');
    await h.until(`${lifts}.then((t) => t.mid.lift > 0.2 && t.deep.lift > 0)`);
  });
});

describe('a desk of more designs than large images comes to rest', { skip: browserSkip() }, () => {
  // At this display scale every design on the fitted desk wants its large
  // image, more than are kept at once.
  const design = (i) => {
    const circuit = new Circuit();
    for (let k = 0; k < 3 + (i % 3); k++) runCommand(circuit, `add resistor R${k} --at ${k * 160} 0 --rot 90`);
    return circuit.toJSON();
  };
  let h;
  before(async () => {
    h = await start({ docs: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`d${i}`, design(i)])), width: 1400, height: 900, scale: 3 });
  });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  test('the images baked stop changing: none evicts another still on screen', async () => {
    await h.click('#app-mark');
    await h.until(`${h.module('atlas.js')}.then((m) => { const s = m.atlasSnapshot(); return !!s && !s.busy && s.tiles.length === 40; })`, 20000);
    // Baking done, however long a busy machine takes: images evicting each
    // other would keep it baking.
    const done = `${h.module('atlas.js')}.then((m) => { const s = m.atlasSnapshot(); return !s.baking && s.baked; })`;
    const baked = await h.until(done, 30000);
    await sleep(800);
    await h.settle();
    assert.equal(await h.until(done), baked);
  });
});
