/** Arrange suggestions in a browser: off by default; on, an edit that
 *  completes a cell offers to draw it as the workspace's other designs do,
 *  shown faintly; Tab draws it as one undo step, Escape lets it go for good. */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { start, browserSkip } from './harness.js';
import { Circuit } from '../../src/core/model.js';
import { runCommand } from '../../src/core/commands.js';

function build(lines) {
  const circuit = new Circuit();
  for (const line of lines) runCommand(circuit, line);
  return circuit.toJSON();
}

/** Two transistors on ground with tied gates: a diode connection away from a mirror. */
const almost = () => build(['add nmos MA --at 0 0', 'add nmos MB --at 480 -160', 'add ground --at 0 200', 'add ground --at 480 120',
  'connect MA.g MB.g', 'connect MA.s GROUND1.gnd', 'connect MB.s GROUND2.gnd']);
/** A mirror drawn the way this user draws them. */
const bias = () => build(['add nmos M1 --at 0 0 --mirrorX', 'add nmos M2 --at 400 0', 'add ground --at 0 120', 'add ground --at 400 120',
  'connect M1.g M2.g', 'connect M1.d M1.g', 'connect M1.s GROUND1.gnd', 'connect M2.s GROUND2.gnd']);

describe('arrange suggestions', { skip: browserSkip() }, () => {
  let h;
  before(async () => { h = await start({ docs: { amp: almost(), bias: bias() }, width: 1400, height: 900 }); });
  after(async () => { const errors = h.exceptions(); await h.stop(); assert.deepEqual(errors, []); });

  const mod = (expression) => h.evaluate(`${h.module('arrange-suggest.js')}.then((m) => ${expression})`);
  const ed = (expression) => h.evaluate(`${h.module('editor-state.js')}.then((m) => { const e = m.editor; const c = e.circuit; return ${expression}; })`);
  const places = () => ed(`['MA', 'MB'].map((ref) => { const t = c.components.get(ref).transform; return [t.x, t.y, t.mirrorX]; })`);
  const run = (line) => h.evaluate(`window.__run(${JSON.stringify(line)})`);

  test('off by default: completing a mirror offers nothing', async () => {
    await h.open('amp');
    assert.equal(await mod('m.arrangeSuggestionsOn()'), false);
    await run('connect MA.d MA.g');
    await h.settle();
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.equal(await mod('m.arrangeSuggestionState()'), null);
    await h.key('u');
  });

  test('on, the edit that completes a mirror offers the workspace\'s drawing of it; Tab draws it as one step', async () => {
    await mod('m.setArrangeSuggestions(true)');
    const before = await places();
    await run('connect MA.d MA.g');
    await h.until(`${h.module('arrange-suggest.js')}.then((m) => !!m.arrangeSuggestionState())`);
    const state = await mod('m.arrangeSuggestionState()');
    assert.deepEqual(state.parts, ['GROUND1', 'GROUND2', 'M1', 'M2']);
    assert.equal(state.source, 'bias');
    assert.ok(await h.evaluate(`document.querySelector('.arrange-suggestion').childElementCount > 0`), 'the cell is drawn faintly');
    assert.match(await h.evaluate(`document.querySelector('.status')?.textContent || ''`), /SUGGESTION: MA, MB make a current mirror: like M1, M2 in bias · Tab draws it/);
    assert.deepEqual(await places(), before, 'nothing moves until Tab');
    await h.key('Tab');
    await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.components.get('MA').transform.mirrorX === true)`);
    const shown = await places();
    assert.equal(shown[1][0] - shown[0][0], 400);
    assert.equal(shown[1][1] - shown[0][1], 0);
    assert.equal(await mod('m.arrangeSuggestionState()'), null);
    await h.key('u');
    await h.until(`${h.module('editor-state.js')}.then((m) => m.editor.circuit.components.get('MA').transform.mirrorX === false)`);
    assert.deepEqual(await places(), before);
  });

  test('Escape lets a suggestion go, and the same cell is not offered again', async () => {
    await h.key('u');
    await run('connect MA.d MA.g');
    await h.until(`${h.module('arrange-suggest.js')}.then((m) => !!m.arrangeSuggestionState())`);
    await h.key('Escape');
    assert.equal(await mod('m.arrangeSuggestionState()'), null);
    await h.key('u');
    await run('connect MA.d MA.g');
    await h.settle();
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.equal(await mod('m.arrangeSuggestionState()'), null);
    await mod('m.setArrangeSuggestions(false)');
  });
  test('wiring a mirror with the mouse offers it, though a ground lies within the two parts\' outline', async () => {
    await h.evaluate(`window.__load(${JSON.stringify(build(['add nmos MA --at 0 0', 'add nmos MB --at 480 -160', 'add ground --at 0 120', 'add ground --at 480 -40',
      'connect MA.s GROUND1.gnd', 'connect MB.s GROUND2.gnd', 'annotation add margin 1600 1000']))})`);
    await h.evaluate(`${h.module('canvas-view.js')}.then((m) => m.fitView())`);
    await mod('m.setArrangeSuggestions(true)');
    const at = (x, y) => h.evaluate(`${h.module('canvas-view.js')}.then((m) => m.worldToClient(${x}, ${y}))`);
    const clickAt = async (x, y) => {
      const p = await at(x, y);
      await h.mouse('mouseMoved', p.x, p.y, { button: 'none', buttons: 0 });
      await h.mouse('mousePressed', p.x, p.y);
      await h.mouse('mouseReleased', p.x, p.y);
      await h.settle();
    };
    await h.key('w'); await clickAt(-120, 0); await clickAt(360, -160); await h.key('Escape');
    await h.key('w'); await clickAt(0, -80); await clickAt(-120, 0); await h.key('Escape');
    await h.until(`${h.module('arrange-suggest.js')}.then((m) => !!m.arrangeSuggestionState())`);
    assert.equal((await mod('m.arrangeSuggestionState()')).source, 'bias');
    await h.key('Escape');
    await mod('m.setArrangeSuggestions(false)');
  });
});
