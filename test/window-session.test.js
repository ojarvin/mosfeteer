import test from 'node:test';
import assert from 'node:assert/strict';
import { createWindowSession, LEGACY_DRAFT_KEY, ORPHAN_DRAFT_MS, WINDOW_STALE_MS } from '../src/web/window-session.js';

class MemoryStorage {
  constructor() { this.map = new Map(); }
  get length() { return this.map.size; }
  key(i) { return [...this.map.keys()][i] ?? null; }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}

function harness() {
  let clock = 1_000_000;
  let next = 0;
  const local = new MemoryStorage();
  return {
    local,
    now: () => clock,
    advance(ms) { clock += ms; },
    open(session = new MemoryStorage()) {
      return { session, window: createWindowSession({ local, session, now: () => clock, randomId: () => `w${next += 1}` }) };
    },
  };
}

test('two windows keep separate drafts, and a reload restores its own', () => {
  const h = harness();
  const a = h.open();
  const b = h.open();
  assert.notEqual(a.window.id, b.window.id);
  a.window.writeDraft({ name: 'amp' });
  h.advance(10);
  b.window.writeDraft({ name: 'mixer' });

  // Unloading fires visibilitychange after pagehide; that must not reopen it.
  a.window.close();
  a.window.touch({ hidden: true });
  const reloaded = h.open(a.session);
  assert.equal(reloaded.window.id, a.window.id);
  assert.equal(JSON.parse(reloaded.window.draft).name, 'amp');
});

test('a duplicated tab gets a new id and a copy of the draft', () => {
  const h = harness();
  const a = h.open();
  a.window.writeDraft({ name: 'amp' });
  const copiedSession = new MemoryStorage();
  copiedSession.setItem('mosfeteer:window-id', a.session.getItem('mosfeteer:window-id'));
  const dup = h.open(copiedSession);
  assert.notEqual(dup.window.id, a.window.id);
  assert.equal(JSON.parse(dup.window.draft).name, 'amp');
  assert.equal(JSON.parse(a.window.readDraft()).name, 'amp');
});

test('a new window adopts the newest draft of a closed window, never an open one', () => {
  const h = harness();
  const a = h.open();
  const b = h.open();
  a.window.writeDraft({ name: 'old' });
  h.advance(10);
  b.window.writeDraft({ name: 'newest' });
  a.window.close();

  const fresh = h.open();
  assert.equal(JSON.parse(fresh.window.draft).name, 'old');
  assert.equal(h.local.getItem(`mosfeteer:draft:${a.window.id}`), null);

  const another = h.open();
  assert.equal(another.window.draft, null);
  assert.equal(JSON.parse(b.window.readDraft()).name, 'newest');
});

test('a crashed window counts as closed once it goes stale', () => {
  const h = harness();
  const a = h.open();
  a.window.writeDraft({ name: 'amp' });
  assert.equal(h.open().window.draft, null);
  h.advance(WINDOW_STALE_MS + 1);
  assert.equal(JSON.parse(h.open().window.draft).name, 'amp');
});

test('the single legacy draft migrates into the first window', () => {
  const h = harness();
  h.local.setItem(LEGACY_DRAFT_KEY, JSON.stringify({ name: 'legacy' }));
  const a = h.open();
  assert.equal(JSON.parse(a.window.draft).name, 'legacy');
  assert.equal(h.local.getItem(LEGACY_DRAFT_KEY), null);
});

test('long-abandoned drafts are pruned at startup', () => {
  const h = harness();
  const a = h.open();
  a.window.writeDraft({ name: 'ancient' });
  a.window.close();
  const b = h.open();
  b.window.clearDraft();
  h.advance(ORPHAN_DRAFT_MS + 1);
  // Put an abandoned draft back under a closed window's key.
  h.local.setItem('mosfeteer:draft:gone', JSON.stringify({ name: 'x', savedAt: 0 }));
  h.local.setItem('mosfeteer:window:gone', JSON.stringify({ closed: true, seenAt: 0 }));
  h.open(b.session);
  assert.equal(h.local.getItem('mosfeteer:draft:gone'), null);
  assert.equal(h.local.getItem('mosfeteer:window:gone'), null);
});

test('only one window follows the CLI active document', () => {
  const h = harness();
  const a = h.open().window;
  h.advance(10);
  const b = h.open().window;
  a.touch({ path: '/w/amp.json' });
  b.touch({ path: '/w/mixer.json' });
  // The newest window leads until another is focused.
  assert.equal(b.leadsActiveSync(), true);
  assert.equal(a.leadsActiveSync(), false);
  h.advance(10);
  a.touch({ focused: true });
  assert.equal(a.leadsActiveSync(), true);
  assert.equal(b.leadsActiveSync(), false);
  // A hidden window yields to a visible one.
  a.touch({ hidden: true });
  assert.equal(b.leadsActiveSync(), true);
  assert.equal(a.leadsActiveSync(), false);
  // Nobody switches to a document another window already shows.
  assert.equal(b.otherWindowShows('/w/amp.json'), true);
  assert.equal(b.otherWindowShows('/w/mixer.json'), false);
  a.close();
  assert.equal(b.otherWindowShows('/w/amp.json'), false);
  a.reopen();
  assert.equal(b.otherWindowShows('/w/amp.json'), true);
});

test('storage failures never throw at startup', () => {
  const broken = { get length() { throw new Error('denied'); }, getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); }, key() { throw new Error('denied'); } };
  const w = createWindowSession({ local: broken, session: broken });
  assert.equal(w.draft, null);
  assert.throws(() => w.writeDraft({}), /storage/);
  w.touch({ path: '/x', focused: true });
  assert.equal(w.leadsActiveSync(), true);
});
