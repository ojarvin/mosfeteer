/**
 * A design's save history, kept in its own file so it travels with it:
 * the state at each of the last few saves (save points), any of which can
 * be pinned as a named checkpoint that is never rotated out.
 *
 * What a save point keeps is the design as `historyText` writes it: the
 * document without its history, what its windows show, the names it was
 * saved under, and its tags -- one JSON value a line.
 * Entries are stored newest first, each as a line patch from the text of
 * the entry before it (the newest from the document's own drawing), so a
 * save that moved one part costs a few lines, not a copy of the design.
 * Every entry carries its text's hash, and the history the hash of the text
 * its newest patch starts from (`base`): a chain that does not fit the
 * text it is read against is never applied, rather than guessed at.
 *
 * An edit made outside the editor (the file's JSON changed by hand or by
 * another program) leaves the chain fitting no text. So the history also
 * keeps that base text itself, compressed (`anchor`, deflate.js): read
 * against it, the chain fits again, and the drawing the file had before
 * the edit is its newest entry (`outside`) -- one to restore. The next
 * write stores the chain against the edited drawing.
 *
 * Stored form (`history` in the document):
 *   { base: HASH, anchor?: { time, text: BASE64 },
 *     entries: [{ id, time, hash, patch, pinned?, name?, comment? }] }
 * A patch is a list: a positive number keeps that many lines, a negative
 * one drops them, a list of strings puts those lines in; the rest of the
 * lines are kept.
 *
 * Every writer of a document file passes the state it writes through
 * `settledHistory` with the file's previous contents, so the chain follows
 * the drawing whoever changed it (server/app.js, web/persistence.js); only
 * the editor's Save adds a save point.
 */

import { packText, unpackText } from './deflate.js';

/** Save points kept besides the pinned checkpoints. */
export const SAVE_POINTS_KEPT = 10;
/** Entries a history may hold at most (pinned ones included). */
const MAX_ENTRIES = 200;
/** Above this many differing lines a patch replaces the changed stretch whole. */
const MAX_EDIT_DISTANCE = 1500;
/** The longest anchor read (base64 characters). */
const MAX_ANCHOR = 16 * 1024 * 1024;

// ----- the text a save point keeps -----------------------------------------------

/** The part of a document state a save point keeps, as text. Math labels
 *  keep their measured size (`mathBox`): a save point is drawn outside the
 *  editor too (a reference window), where nothing measures them. */
export function historyText(state) {
  if (!state || typeof state !== 'object') return '';
  const { history, windows, names, tags, ...rest } = state;
  return JSON.stringify(rest, null, 1);
}

/** A save point's text as compared for a change: a math label measured
 *  again (another browser) is the same drawing. */
function drawingKey(text) {
  try {
    const state = JSON.parse(text);
    for (const label of Array.isArray(state.labels) ? state.labels : []) if (label && typeof label === 'object') delete label.mathBox;
    return JSON.stringify(state);
  } catch {
    return text;
  }
}

/** A short fingerprint of a text: two 32-bit FNV-1a hashes and its length. */
export function textHash(text) {
  const source = String(text ?? '');
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x5bd1e995) >>> 0;
    b ^= b >>> 15;
  }
  return `${source.length.toString(36)}.${a.toString(36)}.${(b >>> 0).toString(36)}`;
}

// ----- line patches --------------------------------------------------------------

/** The edit script from `a` to `b` (lists of lines), as Myers finds it:
 *  [['=', n] | ['-', n] | ['+', lines]], or null past MAX_EDIT_DISTANCE. */
function editScript(a, b) {
  const n = a.length;
  const m = b.length;
  const trace = [];
  let previous = null;
  let found = -1;
  for (let d = 0; d <= Math.min(n + m, MAX_EDIT_DISTANCE); d++) {
    const v = new Int32Array(2 * d + 1);
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (d === 0) x = 0;
      else if (k === -d || (k !== d && previous[k - 1 + d - 1] < previous[k + 1 + d - 1])) x = previous[k + 1 + d - 1];
      else x = previous[k - 1 + d - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[k + d] = x;
      if (x >= n && y >= m) { found = d; break; }
    }
    trace.push(v);
    previous = v;
    if (found >= 0) break;
  }
  if (found < 0) return null;
  const ops = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const before = trace[d - 1];
    const k = x - y;
    const down = k === -d || (k !== d && before[k - 1 + d - 1] < before[k + 1 + d - 1]);
    const priorK = down ? k + 1 : k - 1;
    const priorX = before[priorK + d - 1];
    const priorY = priorX - priorK;
    const startX = down ? priorX : priorX + 1;
    if (x > startX) ops.push(['=', x - startX]);
    if (down) ops.push(['+', [b[priorY]]]);
    else ops.push(['-', 1]);
    x = priorX;
    y = priorY;
  }
  if (x > 0) ops.push(['=', x]);
  return ops.reverse();
}

/** The patch that turns the lines `a` into the lines `b`. */
export function diffLines(a, b) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const middleA = a.slice(start, endA);
  const middleB = b.slice(start, endB);
  const ops = (start ? [['=', start]] : []).concat(
    editScript(middleA, middleB) || [['-', middleA.length], ['+', middleB]],
  );
  // Merge neighbors of one kind; the trailing keep is implied.
  const patch = [];
  for (const [kind, value] of ops) {
    if (kind === '+' && !value.length) continue;
    if (kind !== '+' && !value) continue;
    const last = patch.at(-1);
    if (kind === '+') {
      if (Array.isArray(last)) last.push(...value);
      else patch.push([...value]);
    } else {
      const signed = kind === '=' ? value : -value;
      if (typeof last === 'number' && Math.sign(last) === Math.sign(signed)) patch[patch.length - 1] += signed;
      else patch.push(signed);
    }
  }
  while (typeof patch.at(-1) === 'number' && patch.at(-1) > 0) patch.pop();
  return patch;
}

/** The lines `a` with `patch` applied. Throws on a patch that does not fit. */
export function applyPatch(a, patch) {
  const out = [];
  let at = 0;
  for (const op of patch) {
    if (Array.isArray(op)) out.push(...op);
    else if (op > 0) {
      if (at + op > a.length) throw new Error('patch runs past the text');
      for (let i = 0; i < op; i++) out.push(a[at + i]);
      at += op;
    } else {
      if (at - op > a.length) throw new Error('patch drops past the text');
      at -= op;
    }
  }
  for (; at < a.length; at++) out.push(a[at]);
  return out;
}

// ----- the stored history ----------------------------------------------------------

const textValue = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
const validPatch = (patch) => Array.isArray(patch) && patch.every((op) => (Number.isInteger(op) && op !== 0) || (Array.isArray(op) && op.every((line) => typeof line === 'string')));

/** A history as stored, checked: `{ base, entries }`, or null for none. An
 *  empty list is kept (every entry removed), unlike no history at all. */
export function normalizeHistory(value) {
  if (!value || typeof value !== 'object' || typeof value.base !== 'string' || !Array.isArray(value.entries)) return null;
  const entries = [];
  for (const entry of value.entries.slice(0, MAX_ENTRIES)) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || typeof entry.hash !== 'string' || !validPatch(entry.patch)) break;
    const time = textValue(entry.time, 40);
    entries.push({
      id: entry.id.slice(0, 40),
      time,
      hash: entry.hash.slice(0, 80),
      patch: entry.patch,
      ...(entry.pinned === true ? { pinned: true } : {}),
      ...(textValue(entry.name, 120).trim() ? { name: textValue(entry.name, 120).trim() } : {}),
      ...(textValue(entry.comment, 2000).trim() ? { comment: textValue(entry.comment, 2000).trim() } : {}),
    });
  }
  const anchor = value.anchor && typeof value.anchor === 'object' && typeof value.anchor.text === 'string'
    && value.anchor.text.length <= MAX_ANCHOR && /^[A-Za-z0-9+/]*=*$/.test(value.anchor.text)
    ? { time: textValue(value.anchor.time, 40), text: value.anchor.text } : null;
  return { base: value.base.slice(0, 80), ...(anchor ? { anchor } : {}), entries };
}

const meta = ({ text, patch, hash, outside, ...rest }) => rest;

/** The text a history's anchor holds, when it is the text of its base. */
function anchorText(value) {
  if (!value?.anchor) return null;
  try {
    const text = unpackText(value.anchor.text);
    return textHash(text) === value.base ? text : null;
  } catch {
    return null;
  }
}

/** The entries read along the chain from `text`, the base's own. */
function readChain(value, text) {
  const entries = [];
  let lines = String(text).split('\n');
  for (const entry of value.entries) {
    try { lines = applyPatch(lines, entry.patch); } catch { break; }
    const next = lines.join('\n');
    if (textHash(next) !== entry.hash) break;
    entries.push({ ...meta(entry), text: next });
  }
  return entries;
}

/**
 * The entries with their texts, newest first, read against `baseText` (the
 * text of the drawing the history was stored with). An entry whose text
 * fails its hash ends the list.
 *
 * When the history does not fit that text -- the file was edited outside
 * the editor -- it is read against its anchor, the text it was stored
 * with; the drawing that was is then the newest entry, marked `outside`
 * (an entry already, or one added with the anchor's time). With
 * `recover: false`, or no anchor that fits, null.
 */
export function historyEntries(history, baseText, { recover = true } = {}) {
  const value = normalizeHistory(history);
  if (!value) return [];
  if (value.base === textHash(baseText)) return readChain(value, baseText);
  const before = recover ? anchorText(value) : null;
  if (before === null) return null;
  const entries = readChain(value, before);
  const key = drawingKey(before);
  const held = entries.findIndex((entry) => drawingKey(entry.text) === key);
  if (held >= 0) entries[held] = { ...entries[held], outside: true };
  else entries.unshift({ id: `o${value.base.replace(/[^a-z0-9]/g, '').slice(-9)}`, time: value.anchor.time, text: before, outside: true });
  return entries;
}

/** The last anchor packed, by the hash of its text: a write that leaves
 *  the drawing as it was packs nothing again. */
let lastAnchor = { hash: null, text: null };

/** Entries with their texts stored against `baseText`, with the anchor
 *  (`anchor`, an existing one to keep when it holds that text). */
function encodeHistory(entries, baseText, { now = new Date(), anchor = null } = {}) {
  let lines = String(baseText).split('\n');
  const stored = [];
  for (const entry of entries) {
    const next = entry.text.split('\n');
    stored.push({ ...meta(entry), hash: textHash(entry.text), patch: diffLines(lines, next) });
    lines = next;
  }
  const base = textHash(baseText);
  let kept = anchor?.base === base && anchor.anchor ? anchor.anchor : null;
  if (!kept) {
    if (lastAnchor.hash !== base) lastAnchor = { hash: base, text: packText(baseText) };
    kept = { time: now.toISOString(), text: lastAnchor.text };
  }
  return { base, anchor: kept, entries: stored };
}

/** The newest SAVE_POINTS_KEPT unpinned entries and every pinned one. */
function rotate(entries, keep = SAVE_POINTS_KEPT) {
  let unpinned = 0;
  return entries.filter((entry) => entry.pinned || ++unpinned <= keep);
}

function newId() {
  return Math.random().toString(36).slice(2, 10).padEnd(8, '0');
}

/**
 * The history to write with `next` (the state about to be written; its own
 * `history` is the writer's). `previous` is the file's state before this
 * write, `sent` the state as a client sent it (when the writer normalized
 * it), and `baseText` any other text the writer's history may be stored
 * against (a design saved under a new name: the file it was opened from).
 * With `savePoint` (the editor's Save) the written drawing becomes the
 * newest save point unless the history holds it already; the oldest unpinned ones beyond
 * SAVE_POINTS_KEPT go.
 *
 * When the writer's history fits none of those texts, the file's own is
 * used if it fits; failing both, the writer's is written as it came --
 * never applied, and never thrown away.
 */
export function settledHistory(next, { previous = null, sent = null, baseText = null, savePoint = false, now = new Date(), keep = SAVE_POINTS_KEPT } = {}) {
  const nextText = historyText(next);
  const own = normalizeHistory(next?.history);
  const prior = previous ? historyText(previous) : null;
  let entries = null;
  const texts = [prior, sent ? historyText(sent) : null, baseText, nextText].filter((text) => typeof text === 'string');
  if (own) {
    for (const text of texts) {
      const read = historyEntries(own, text, { recover: false });
      if (read) { entries = read; break; }
    }
  }
  const theirs = previous ? normalizeHistory(previous.history) : null;
  if (!entries && theirs) entries = historyEntries(theirs, prior, { recover: false });
  // Edited outside the editor: read against the anchor, the drawing before
  // the edit its newest entry.
  if (!entries && own) entries = historyEntries(own, texts[0]);
  if (!entries && theirs) entries = historyEntries(theirs, prior);
  if (!entries) {
    // Unreadable: kept as it came, never guessed at.
    if (own || theirs) return own || theirs;
    entries = [];
  }
  // A drawing the history holds already (a restored save point) is that
  // entry, the file's now: no second one.
  if (savePoint && !entries.some((entry) => drawingKey(entry.text) === drawingKey(nextText))) entries.unshift({ id: newId(), time: now.toISOString(), text: nextText });
  entries = rotate(entries, keep);
  if (!entries.length && !own && !theirs) return null;
  return encodeHistory(entries, nextText, { now, anchor: own || theirs });
}

/**
 * Change the entries of a history stored against `baseText` (the file's
 * drawing) with `edit(entries) -> entries`, and store them again. Null when
 * the history does not fit the text.
 */
function editHistory(history, baseText, edit) {
  const entries = historyEntries(history, baseText);
  if (!entries) return null;
  return encodeHistory(edit(entries.map((entry) => ({ ...entry }))), baseText, { anchor: normalizeHistory(history) });
}

/** Pin entry `id` as a checkpoint, named (and with a comment). */
export function pinHistoryEntry(history, baseText, id, { name = '', comment = '' } = {}) {
  return editHistory(history, baseText, (entries) => entries.map((entry) => (entry.id !== id ? entry : {
    ...entry,
    pinned: true,
    ...(String(name).trim() ? { name: String(name).trim().slice(0, 120) } : { name: undefined }),
    ...(String(comment).trim() ? { comment: String(comment).trim().slice(0, 2000) } : { comment: undefined }),
  })).map(dropUndefined));
}

/** Unpin entry `id`: a save point again, rotated out in its turn. */
export function unpinHistoryEntry(history, baseText, id) {
  return editHistory(history, baseText, (entries) => entries.map((entry) => {
    if (entry.id !== id) return entry;
    const { pinned, name, comment, ...rest } = entry;
    return rest;
  }));
}

/** Remove entry `id`; the entries around it are stored against each other. */
export function removeHistoryEntry(history, baseText, id) {
  return editHistory(history, baseText, (entries) => entries.filter((entry) => entry.id !== id));
}

/** Pin the file's drawing as a checkpoint: its newest entry when that is the
 *  drawing, else a new entry for it. Returns { history, id }. */
export function checkpointHistory(history, baseText, { name = '', comment = '', now = new Date() } = {}) {
  let id = null;
  const next = editHistory(history ?? { base: textHash(baseText), entries: [] }, baseText, (entries) => {
    if (entries[0]?.text !== baseText) entries.unshift({ id: newId(), time: now.toISOString(), text: baseText });
    id = entries[0].id;
    return entries;
  });
  if (!next) return { history: null, id: null };
  return { history: pinHistoryEntry(next, baseText, id, { name, comment }), id };
}

function dropUndefined(entry) {
  return Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined));
}

/** The state an entry's text holds (no history, windows, names, or tags). */
export function historyEntryState(entry) {
  return JSON.parse(entry.text);
}
