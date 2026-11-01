import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromeQuiet } from '../src/web/chrome-quiet.js';

test('the chrome steps back while a part moves or a wire is drawn, not while looking around', () => {
  assert.equal(chromeQuiet(null, null), false, 'idle');
  assert.equal(chromeQuiet({ mode: 'move', moved: false }, null), false, 'pressed, not yet moved');
  assert.equal(chromeQuiet({ mode: 'move', moved: true }, null), true, 'a part moving');
  assert.equal(chromeQuiet({ mode: 'labelmove', moved: true }, null), true, 'a label moving');
  assert.equal(chromeQuiet({ mode: 'wireseg', moved: true }, null), true, 'a wire segment moving');
  for (const mode of ['pan', 'zoom', 'marquee', 'deletemarquee']) {
    assert.equal(chromeQuiet({ mode, moved: true }, null), false, mode);
  }
  assert.equal(chromeQuiet(null, { source: null, points: [] }), false, 'the wire tool, nothing started');
  assert.equal(chromeQuiet(null, { source: { refdes: 'R1', term: 'a' }, points: [] }), true, 'a wire started');
});
