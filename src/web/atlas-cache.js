/**
 * The Atlas view's rendering cache: each design's drawing (SVG and size) and its
 * baked images, kept in IndexedDB so a second visit shows the workspace at
 * once. Entries are keyed by document path and file revision, so an edited
 * design is simply a miss. Without IndexedDB (a private window, blocked
 * storage) the cache lives in memory for the session and everything still
 * works, only slower to appear.
 */

const DB_NAME = 'mosfeteer-atlas';
const STORE = 'renderings';
const VERSION = 1;
/** Old revisions of every design pile up otherwise; trim past this many. */
const MAX_ENTRIES = 600;

let opening = null;
const memory = new Map();

function openDatabase() {
  if (opening) return opening;
  opening = new Promise((resolve) => {
    try {
      const request = globalThis.indexedDB?.open(DB_NAME, VERSION);
      if (!request) { resolve(null); return; }
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(STORE);
        store.createIndex('touched', 'touched');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

function transact(db, mode, run) {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const result = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(result?.result ?? null);
      tx.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** The cache key of one rendering of a document revision. */
/** The cached design index's version (core/design-index.js): bump it when
 *  the index gains or changes what it holds. */
export const INDEX_CACHE = 'index-v4';

export function renderingKey(path, revision, part) {
  return `${path}\n${revision}\n${part}`;
}

/** A cached value, or null. Only revisioned documents are cached at all. */
export async function cacheGet(key) {
  if (memory.has(key)) return memory.get(key);
  const db = await openDatabase();
  if (!db) return null;
  const record = await transact(db, 'readonly', (store) => store.get(key));
  if (record) memory.set(key, record.value);
  return record?.value ?? null;
}

export async function cachePut(key, value) {
  memory.set(key, value);
  const db = await openDatabase();
  if (!db) return;
  await transact(db, 'readwrite', (store) => store.put({ value, touched: Date.now() }, key));
}

/** Drop the least recently written entries past the cap. */
export async function trimCache() {
  const db = await openDatabase();
  if (!db) return;
  const count = await transact(db, 'readonly', (store) => store.count());
  if (!(count > MAX_ENTRIES)) return;
  await transact(db, 'readwrite', (store) => {
    let excess = count - MAX_ENTRIES;
    const cursor = store.index('touched').openCursor();
    cursor.onsuccess = () => {
      const at = cursor.result;
      if (!at || excess <= 0) return;
      at.delete();
      excess -= 1;
      at.continue();
    };
    return cursor;
  });
}

/**
 * Bake each tile's images in turn: `levels(tile)` names which (a small one,
 * and a large one where the tile shows big). Each one baked is kept
 * (`keep(tile, level, bitmap)`); one that fails is noted (`failed(tile,
 * level)`) and the rest go on. Once `stale()` (a newer opening of the
 * Atlas) nothing more is baked or kept.
 */
export async function bakeTiles(tiles, { levels, bake, keep, failed, stale }) {
  for (const tile of tiles) {
    for (const level of levels(tile)) {
      try {
        const bitmap = await bake(tile, level);
        if (stale()) { bitmap?.close?.(); return; }
        keep(tile, level, bitmap);
      } catch {
        if (stale()) return;
        failed(tile, level);
      }
    }
  }
}
