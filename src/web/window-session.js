/**
 * One editor window among several open on the same origin.
 *
 * Each window keeps its own local draft and publishes a small status record
 * (the document it shows, when it was last focused, whether it is still
 * open), so two windows can edit two documents side by side without
 * restoring each other's draft or both jumping to the CLI's active document.
 *
 * Records live in localStorage under one key per window, so windows never
 * rewrite each other's entries. The window id lives in sessionStorage, which
 * survives a reload of the same tab but not a new window. A duplicated tab
 * inherits the id while its original is still open; it then takes a new id
 * and a copy of the draft.
 */

export const LEGACY_DRAFT_KEY = 'mosfeteer:draft';
const DRAFT_PREFIX = 'mosfeteer:draft:';
const STATUS_PREFIX = 'mosfeteer:window:';
const WINDOW_ID_KEY = 'mosfeteer:window-id';
// Background tabs run timers about once a minute, so a window that has not
// checked in for this long without saying it closed has crashed or been killed.
export const WINDOW_STALE_MS = 3 * 60_000;
// A draft no window has touched for this long is dropped at startup.
export const ORPHAN_DRAFT_MS = 30 * 24 * 60 * 60_000;
// An unchanged status is rewritten at most this often.
const TOUCH_MS = 10_000;

function read(storage, key) {
  try { return storage?.getItem(key) ?? null; } catch { return null; }
}
function write(storage, key, value) {
  try { storage?.setItem(key, value); return true; } catch { return false; }
}
function remove(storage, key) {
  try { storage?.removeItem(key); } catch { /* storage unavailable */ }
}
function keys(storage) {
  const out = [];
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key !== null) out.push(key);
    }
  } catch { /* storage unavailable */ }
  return out;
}
function parse(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

/**
 * Claim this window's identity and pick the draft it should restore.
 *
 * `local`/`session` are Storage-like objects (either may be missing or
 * throw). Returns the session; `session.draft` is the draft text to restore,
 * or null.
 */
export function createWindowSession({ local, session, now = () => Date.now(), randomId = defaultRandomId } = {}) {
  const statusOf = (id) => parse(read(local, STATUS_PREFIX + id));
  const alive = (status, at = now()) => !!status && !status.closed && at - (status.seenAt || 0) < WINDOW_STALE_MS;

  let id = read(session, WINDOW_ID_KEY);
  let copyFrom = null;
  if (id && alive(statusOf(id))) {
    // Duplicated tab: the original still owns this id and its draft.
    copyFrom = id;
    id = null;
  }
  if (!id) {
    id = randomId();
    write(session, WINDOW_ID_KEY, id);
  }
  const draftKey = DRAFT_PREFIX + id;

  let draft = read(local, draftKey);
  if (draft === null && copyFrom) {
    draft = read(local, DRAFT_PREFIX + copyFrom);
    if (draft !== null) write(local, draftKey, draft);
  }
  if (draft === null) draft = adoptOrphanDraft();
  pruneOrphans();

  let status = { path: null, seenAt: 0, focusedAt: now(), hidden: false, closed: false };
  publish();

  /** Take over the newest draft whose window is gone (a new window or a restarted browser). */
  function adoptOrphanDraft() {
    const at = now();
    let best = null;
    for (const key of keys(local)) {
      if (key === draftKey) continue;
      let owner;
      if (key === LEGACY_DRAFT_KEY) owner = null;
      else if (key.startsWith(DRAFT_PREFIX)) owner = key.slice(DRAFT_PREFIX.length);
      else continue;
      if (owner && alive(statusOf(owner), at)) continue;
      const text = read(local, key);
      if (text === null) continue;
      const savedAt = parse(text)?.savedAt || 0;
      if (!best || savedAt > best.savedAt) best = { key, owner, text, savedAt };
    }
    if (!best) return null;
    if (!write(local, draftKey, best.text)) return best.text;
    remove(local, best.key);
    if (best.owner) remove(local, STATUS_PREFIX + best.owner);
    return best.text;
  }

  /** Forget closed windows' records, and drafts nobody has touched in a long time. */
  function pruneOrphans() {
    const at = now();
    for (const key of keys(local)) {
      if (key.startsWith(STATUS_PREFIX)) {
        const owner = key.slice(STATUS_PREFIX.length);
        if (owner === id || alive(statusOf(owner), at)) continue;
        if (read(local, DRAFT_PREFIX + owner) === null) remove(local, key);
      } else if (key.startsWith(DRAFT_PREFIX) && key !== draftKey) {
        const owner = key.slice(DRAFT_PREFIX.length);
        if (alive(statusOf(owner), at)) continue;
        const savedAt = parse(read(local, key))?.savedAt || 0;
        if (at - savedAt > ORPHAN_DRAFT_MS) {
          remove(local, key);
          remove(local, STATUS_PREFIX + owner);
        }
      }
    }
  }

  function publish() {
    status.seenAt = now();
    write(local, STATUS_PREFIX + id, JSON.stringify(status));
  }

  /** The other open windows' status records. */
  function others() {
    const at = now();
    const out = [];
    for (const key of keys(local)) {
      if (!key.startsWith(STATUS_PREFIX)) continue;
      const owner = key.slice(STATUS_PREFIX.length);
      if (owner === id) continue;
      const other = statusOf(owner);
      if (alive(other, at)) out.push(other);
    }
    return out;
  }

  return {
    id,
    draft,
    readDraft: () => read(local, draftKey),
    /** Store this window's draft; `state` gains a `savedAt` so orphans can be ranked. */
    writeDraft(state) {
      if (!write(local, draftKey, JSON.stringify({ ...state, savedAt: now() }))) {
        throw new Error('browser storage is unavailable or full');
      }
    },
    clearDraft: () => remove(local, draftKey),
    /**
     * Record what this window shows. Cheap to call often: an unchanged status
     * is rewritten every few seconds only. A closed window stays closed (the
     * page fires visibilitychange after pagehide) until `reopen`.
     */
    touch({ path = status.path, hidden = status.hidden, focused = false } = {}) {
      if (status.closed) return;
      const nextPath = path || null;
      const changed = nextPath !== status.path || !!hidden !== status.hidden || focused;
      status.path = nextPath;
      status.hidden = !!hidden;
      if (focused) status.focusedAt = now();
      if (changed || now() - status.seenAt >= TOUCH_MS) publish();
    },
    /** Mark this window closed (pagehide). A reload of the same tab reclaims the id. */
    close() {
      status.closed = true;
      write(local, STATUS_PREFIX + id, JSON.stringify(status));
    },
    /** Undo `close` when the page comes back from the back/forward cache. */
    reopen() {
      status.closed = false;
      publish();
    },
    /** Whether another open window already shows the document at `path`. */
    otherWindowShows: (path) => !!path && others().some((other) => other.path === path),
    /**
     * Whether this window should follow the CLI's active document: the most
     * recently focused of the visible windows, or of all of them when none is
     * visible.
     */
    leadsActiveSync() {
      const rest = others();
      const pool = status.hidden ? rest : rest.filter((other) => !other.hidden);
      if (status.hidden && rest.some((other) => !other.hidden)) return false;
      return pool.every((other) => (other.focusedAt || 0) <= status.focusedAt);
    },
  };
}

function defaultRandomId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
