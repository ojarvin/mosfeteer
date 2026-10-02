import test from 'node:test';
import assert from 'node:assert/strict';
import { formatModifiedTime, revisionTime } from '../src/web/modified-time.js';

test('a revision gives back the file time it was made from, server or browser', () => {
  const ms = Date.UTC(2026, 9, 2, 18, 42, 45);
  // The server encodes nanoseconds; browser-only files milliseconds.
  assert.equal(revisionTime(`${(BigInt(ms) * 1000000n + 123456n).toString(36)}-${(2307).toString(36)}`), ms);
  assert.equal(revisionTime(`${ms.toString(36)}-1x`), ms);
  assert.equal(revisionTime(null), null);
  assert.equal(revisionTime(''), null);
  assert.equal(revisionTime('*bad*'), null);
});

test('modification times read relative to now, then as yesterday or the date', () => {
  const now = new Date(2026, 9, 2, 21, 45, 0).getTime();
  const ago = (s) => now - s * 1000;
  assert.equal(formatModifiedTime(ago(2), now), 'just now');
  assert.equal(formatModifiedTime(ago(12), now), '12 seconds ago');
  assert.equal(formatModifiedTime(ago(60), now), '1 minute ago');
  assert.equal(formatModifiedTime(ago(5 * 60 + 40), now), '5 minutes ago');
  assert.equal(formatModifiedTime(ago(3 * 3600 + 10), now), '3 hours ago');
  // The same clock hours, but across midnight: yesterday with the time.
  const late = new Date(2026, 9, 1, 23, 30).getTime();
  assert.match(formatModifiedTime(late, new Date(2026, 9, 2, 1, 0).getTime(), 'en-GB'), /^yesterday 23:30$/);
  assert.match(formatModifiedTime(new Date(2026, 8, 28, 9, 5).getTime(), now, 'en-GB'), /^28 Sept? 09:05$/);
  assert.match(formatModifiedTime(new Date(2025, 11, 31, 9, 5).getTime(), now, 'en-GB'), /^31 Dec 2025 09:05$/);
  // A clock that runs behind the file never reads as the future.
  assert.equal(formatModifiedTime(now + 5000, now), 'just now');
});

test('the status bar carries the modified chip, refreshed with the save state', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
  const chips = html.slice(html.indexOf('class="status-chips"'), html.indexOf('id="log-drawer"'));
  assert.match(chips, /id="status-modified"[^>]*hidden/);
  const session = readFileSync(new URL('../src/web/document-session.js', import.meta.url), 'utf8');
  assert.match(session, /renderModifiedTime\(dirty\);/);
  // Unsaved edits date from the latest one; a clean document from its file.
  assert.match(session, /return dirty && editedAt !== null \? editedAt : revisionTime\(editor\.lastSeenRevision\);/);
});
