import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromeQuiet } from '../src/web/chrome-quiet.js';

test('the chrome steps back while a part moves, a wire is drawn, or the view pans, not while picking', () => {
  assert.equal(chromeQuiet(null, null), false, 'idle');
  assert.equal(chromeQuiet({ mode: 'move', moved: false }, null), false, 'pressed, not yet moved');
  assert.equal(chromeQuiet({ mode: 'move', moved: true }, null), true, 'a part moving');
  assert.equal(chromeQuiet({ mode: 'labelmove', moved: true }, null), true, 'a label moving');
  assert.equal(chromeQuiet({ mode: 'wireseg', moved: true }, null), true, 'a wire segment moving');
  for (const mode of ['zoom', 'marquee', 'deletemarquee']) {
    assert.equal(chromeQuiet({ mode, moved: true }, null), false, mode);
  }
  // A pan from its press: the middle button says what it is at once.
  assert.equal(chromeQuiet({ mode: 'pan' }, null), true, 'a pan');
  assert.equal(chromeQuiet(null, { source: null, points: [] }), false, 'the wire tool, nothing started');
  assert.equal(chromeQuiet(null, { source: { refdes: 'R1', term: 'a' }, points: [] }), true, 'a wire started');
});
