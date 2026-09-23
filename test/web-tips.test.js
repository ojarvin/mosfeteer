import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TIP_COOLDOWN_MS, TIP_MAX_SHOWS, TIPS, TIPS_PER_SESSION, TipBook, loadTipState } from '../src/web/tips.js';

const LATER = TIP_COOLDOWN_MS + 1;

test('a tip waits until its situation has come up a few times', () => {
  const book = new TipBook();
  assert.equal(book.note('wire-start', 0), null);
  assert.equal(book.note('wire-start', 0)?.id, 'wire-alt');
});

test('using the feature retires its tip for good', () => {
  const book = new TipBook();
  book.note('wire-start', 0);
  book.note('terminal-snap', 0);
  assert.equal(book.note('wire-start', 0), null);
  assert.deepEqual(new TipBook(book.toJSON()).state.retired, ['wire-alt']);
});

test('tips stay scarce: a cooldown, a session cap, and a lifetime cap', () => {
  const book = new TipBook();
  book.note('wire-start', 0);
  assert.equal(book.note('wire-start', 0)?.id, 'wire-alt');
  // Another tip is due at once, but waits for the cooldown.
  for (let i = 0; i < 2; i += 1) book.note('place-repeat', 1000);
  assert.equal(book.note('place-repeat', 2000), null);
  assert.equal(book.note('place-repeat', LATER)?.id, 'place-symmetry');
  // The same tip is not repeated in a session.
  assert.equal(book.note('wire-start', 2 * LATER), null);
  // And after the per-session cap, nothing more is offered.
  assert.equal(book.note('move-start', 3 * LATER), null);
  assert.equal(book.note('move-start', 3 * LATER), null);
  assert.equal(book.note('move-start', 3 * LATER)?.id, 'radial');
  assert.equal(book.sessionShown.length, TIPS_PER_SESSION);
  for (let i = 0; i < 6; i += 1) assert.equal(book.note('wire-commit', (4 + i) * LATER), null);

  // Across sessions a tip is shown at most TIP_MAX_SHOWS times.
  let state = book.toJSON();
  for (let session = 1; session < 4; session += 1) {
    const next = new TipBook(state);
    next.note('wire-start', 0);
    state = next.toJSON();
  }
  assert.equal(state.shown['wire-alt'], TIP_MAX_SHOWS);
});

test('turning tips off silences them, and stored junk is ignored', () => {
  const book = new TipBook({ off: true });
  book.note('wire-start', 0);
  assert.equal(book.note('wire-start', 0), null);
  assert.deepEqual(loadTipState({ off: 'yes', retired: ['nope', 'knife'], shown: { knife: -1 }, seen: { bogus: 3 } }),
    { off: false, retired: ['knife'], shown: {}, seen: {} });
  assert.equal(new TipBook().note('unknown-event', 0), null);
});

test('every tip is short and names a trigger and a retiring action the editor reports', () => {
  const main = readFileSync(new URL('../src/web/main.js', import.meta.url), 'utf8');
  for (const tip of TIPS) {
    assert.ok(tip.text.length <= 110, `${tip.id} is one short line`);
    for (const event of [tip.trigger, tip.retiredBy]) {
      assert.match(main, new RegExp(`noteTip\\('${event}'\\)`), `${event} is reported`);
    }
  }
  const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="tip-card"[^>]*role="status"[^>]*hidden/);
  assert.match(html, /id="btn-tips"[^>]*role="menuitemcheckbox"/);
});
