/**
 * When the open document last changed, as the status bar says it: "12
 * seconds ago", "5 minutes ago", "3 hours ago" the same day, "yesterday
 * 14:05", then the date and time.
 */

/** The modification time (ms) a document revision records, or null. A
 *  revision starts with the file's mtime in base 36: nanoseconds from the
 *  server (documents.js fileRevision), milliseconds from browser-only files
 *  (persistence.js fileRevision). */
export function revisionTime(revision) {
  const head = String(revision || '').split('-')[0];
  if (!/^[0-9a-z]+$/.test(head)) return null;
  const value = parseInt(head, 36);
  if (!Number.isFinite(value) || value <= 0) return null;
  // No millisecond time reaches 1e15 before the year 33000.
  return value > 1e15 ? Math.round(value / 1e6) : value;
}

const plural = (count, unit) => `${count} ${unit}${count === 1 ? '' : 's'} ago`;

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** `then` relative to `now` (both ms), in the locale's clock and date. */
export function formatModifiedTime(then, now = Date.now(), locale = undefined) {
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return plural(seconds, 'second');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return plural(minutes, 'minute');
  const at = new Date(then);
  const today = new Date(now);
  if (sameDay(at, today)) return plural(Math.floor(minutes / 60), 'hour');
  const clock = at.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(at, yesterday)) return `yesterday ${clock}`;
  const date = at.toLocaleDateString(locale, {
    day: 'numeric', month: 'short', ...(at.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  });
  return `${date} ${clock}`;
}

/** How soon to read formatModifiedTime(then) again: each second while it
 *  counts seconds, then a few times a minute. */
export function modifiedRefreshMs(then, now = Date.now()) {
  return now - then < 60_000 ? 1_000 : 15_000;
}
