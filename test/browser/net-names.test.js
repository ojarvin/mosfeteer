/** Naming nets in a browser: a name that joins a net to another asks
 *  first, and says which parts the join would short. */

import { describe, before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, browserSkip } from './harness.js';
import { Circuit } from '../../src/core/model.js';
import { runCommand } from '../../src/core/commands.js';

/** R1, R2, R3 in series; the R2–R3 net is OUT, the R1–R2 net `first` (unnamed when null). */
function series(first = null) {
  const circuit = new Circuit();
  for (const line of ['add resistor R1 --at 0 0', 'add resistor R2 --at 400 0', 'add resistor R3 --at 800 0', `connect R1.b R2.a${first ? ` --name ${first}` : ''}`, 'connect R2.b R3.a --name OUT']) runCommand(circuit, line);
  return circuit.toJSON();
}

describe('naming nets', { skip: browserSkip() }, () => {
  let h;
  before(async () => { h = await start({ docs: { series: series() }, width: 1400, height: 900 }); });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });
  beforeEach(async () => {
    await h.open('series');
    await h.key('Escape');
  });

  const ed = (expression) => h.evaluate(`${h.module('editor-state.js')}.then((m) => { const c = m.editor.circuit; return ${expression}; })`);
  const firstNet = () => ed(`c.netOfTerminal({ comp: 'R1', term: 'b' }).name`);
  /** The text of the open dialog that mentions `name`. */
  const dialog = async (name) => {
    await h.until(`document.querySelector('dialog[open]')?.textContent.includes(${JSON.stringify(name)})`);
    return h.evaluate(`document.querySelector('dialog[open]').textContent`);
  };
  const cancel = async () => {
    await h.evaluate(`[...document.querySelectorAll('dialog[open] button')].find((b) => /Cancel|Keep separate/.test(b.textContent)).click()`);
    await h.until(`!document.querySelector('dialog[open]')`);
  };
  /** Shift+L with `name` typed, then a click on the R1–R2 wire. */
  const labelFirstNet = async (name) => {
    await h.key('L', { shiftKey: true });
    await h.until(`!!document.querySelector('.label-prompt input')`);
    await h.evaluate(`(() => { const input = document.querySelector('.label-prompt input'); input.value = ${JSON.stringify(name)}; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
    await h.until(`!document.querySelector('.label-prompt')`);
    const p = await h.evaluate(`${h.module('canvas-view.js')}.then((m) => m.worldToClient(200, 0))`);
    await h.mouse('mouseMoved', p.x, p.y, { button: 'none', buttons: 0 });
    await h.mouse('mousePressed', p.x, p.y);
    await h.mouse('mouseReleased', p.x, p.y);
  };

  test("the net label tool asks before giving an unnamed net another net's name, and names the part it shorts", async () => {
    await h.evaluate(`window.__load(${JSON.stringify(series())})`);
    await labelFirstNet('OUT');
    assert.match(await dialog('OUT'), /already used by an existing named net.*This shorts R2/s);
    await cancel();
    await h.key('Escape');
    assert.equal(await firstNet(), '');
  });

  test('renaming a net to the name across its part asks, and says so', async () => {
    await h.evaluate(`window.__load(${JSON.stringify(series('MID'))})`);
    await labelFirstNet('OUT');
    assert.match(await dialog('OUT'), /Rename it to OUT\?.*This shorts R2/s);
    await cancel();
    await h.key('Escape');
    assert.equal(await firstNet(), 'MID');
  });

  test('editing a net label to the name across its part asks first', async () => {
    await h.evaluate(`window.__load(${JSON.stringify(series('MID'))})`);
    await h.evaluate(`Promise.all([${h.module('editor-state.js')}, ${h.module('label-editor.js')}]).then(([s, l]) => {
      const c = s.editor.circuit;
      const net = c.netOfTerminal({ comp: 'R1', term: 'b' });
      const label = c.addNetLabel(net.id, { text: 'MID', anchor: { x: 200, y: 0 } });
      l.inlineEditLabel(label);
    })`);
    await h.until(`!!document.querySelector('textarea.label-inline-editor')`);
    await h.evaluate(`(() => { const input = document.querySelector('textarea.label-inline-editor'); input.value = 'OUT'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
    assert.match(await dialog('OUT'), /This shorts R2/);
    await cancel();
    // Kept open for a correction; Esc there drops the edit (a blur would commit it).
    // Back for the correction once its text is selected again.
    await h.until(`(() => { const input = document.querySelector('textarea.label-inline-editor'); return input.selectionStart === 0 && input.selectionEnd === input.value.length; })()`);
    await h.evaluate(`document.querySelector('textarea.label-inline-editor').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await h.until(`!document.querySelector('textarea.label-inline-editor')`);
    assert.equal(await firstNet(), 'MID');
  });

  test('a name shared with an unrelated net asks without a short warning', async () => {
    await h.evaluate(`window.__load(${JSON.stringify(series())})`);
    for (const line of ['add resistor R4 --at 0 400', 'add resistor R5 --at 400 400', 'connect R4.b R5.a --name FAR']) await h.evaluate(`window.__run(${JSON.stringify(line)})`);
    await labelFirstNet('FAR');
    const text = await dialog('FAR');
    assert.match(text, /already used by an existing named net/);
    assert.doesNotMatch(text, /shorts/);
    await h.evaluate(`[...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent.trim() === 'Connect').click()`);
    await h.until(`!document.querySelector('dialog[open]')`);
    await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.netOfTerminal({ comp: 'R1', term: 'b' }).name === 'FAR')`);
    await h.key('Escape');
  });
});
