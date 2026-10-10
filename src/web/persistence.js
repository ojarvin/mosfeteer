/**
 * Persistence boundary for the editor.
 *
 * The normal adapter talks to the local Node server. Browser-only mode keeps
 * the same document-shaped contract but uses the browser's file handles,
 * pickers, and downloads instead. Keeping the boundary here means the editor
 * and circuit core do not need to know where a document is stored.
 */

import { loadDocument, validDocumentName } from '../core/document.js';
export { validDocumentName };

const BROWSER_DOCUMENTS_KEY = 'mosfeteer:browser-documents';
const BROWSER_DOWNLOADS = 'Browser downloads';
const OPENED_FILES = 'Opened files';
const HANDLE_DB = 'mosfeteer-browser-files';
const HANDLE_STORE = 'handles';
const FOLDER_KEY = 'folder';
const LOCATION_KEY = 'location';
const EXPORT_FOLDER_KEY = 'export-folder:';
const DOCUMENT_TYPES = [{ description: 'Mosfeteer schematic', accept: { 'application/json': ['.json'] } }];

/** Return the initial export destination for the active persistence mode. */
export function defaultExportDirectory(workspaceState = {}, { browserOnly = false } = {}) {
  // Browser-only exports are always downloads, even from a folder workspace.
  if (browserOnly) return BROWSER_DOWNLOADS;
  const home = String(workspaceState.home || '').trim();
  if (!home) return workspaceState.workspace || '';
  const separator = workspaceState.sep || '/';
  return home.endsWith(separator) ? `${home}Pictures` : `${home}${separator}Pictures`;
}

function browserOnlyRequested(location = globalThis.location) {
  if (!location) return false;
  try {
    return location.protocol === 'file:'
      || new URLSearchParams(location.search || '').get('browser-only') === '1';
  } catch {
    return false;
  }
}

function browserPath(name) {
  return `browser://${name}`;
}

function browserName(path) {
  return String(path || '').replace(/^browser:\/\//, '');
}

function documentNameFromFile(file) {
  return String(file?.name || 'circuit.json')
    .replace(/\.schematic\.json$/i, '')
    .replace(/\.json$/i, '') || 'circuit';
}

function isDocumentFileName(name) {
  return !String(name).startsWith('.') && /\.json$/i.test(name);
}

// The time leads, as the server's does (modified-time.js reads it back).
function fileRevision(file) {
  return `${Number(file.lastModified || 0).toString(36)}-${Number(file.size || 0).toString(36)}`;
}

function readBrowserDocuments(storage) {
  if (!storage) return {};
  try {
    const value = JSON.parse(storage.getItem(BROWSER_DOCUMENTS_KEY) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function writeBrowserDocuments(storage, documents) {
  if (!storage) return;
  try {
    if (Object.keys(documents).length) storage.setItem(BROWSER_DOCUMENTS_KEY, JSON.stringify(documents));
    else storage.removeItem?.(BROWSER_DOCUMENTS_KEY);
  } catch { /* quota/private mode */ }
}

function makeDownload(download, contents, name, type) {
  if (download) return download(contents, name, type);
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof Blob === 'undefined') {
    throw new Error('browser downloads are unavailable in this environment');
  }
  const blob = contents instanceof Blob ? contents : new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function writeFileHandle(handle, contents) {
  const writable = await handle.createWritable();
  await writable.write(contents);
  await writable.close();
}

function dataUrlBlob(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;,]+)?;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('invalid PNG data URL');
  const bytes = Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: match[1] || 'application/octet-stream' });
}

/** Ask for files with a plain file input: every chosen file, or [] when canceled. */
function fileInput({ documentImpl = globalThis.document, accept = '.json,application/json', multiple = false, folder = false } = {}) {
  if (!documentImpl) throw new Error('browser file input is unavailable');
  return new Promise((resolve) => {
    const input = documentImpl.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    if (folder) input.webkitdirectory = true;
    input.addEventListener('change', () => resolve([...(input.files || [])]), { once: true });
    input.addEventListener('cancel', () => resolve([]), { once: true });
    input.click();
  });
}

/**
 * Remembered file and folder handles, kept in IndexedDB so a reload can reach
 * the same files again (after the browser's permission prompt). Each value is
 * `{ key, kind: 'file'|'folder', path?, name, handle }`.
 */
export function indexedDbHandleStore(indexedDBImpl = globalThis.indexedDB) {
  if (!indexedDBImpl) return null;
  let database = null;
  const open = () => (database ||= new Promise((resolve, reject) => {
    const request = indexedDBImpl.open(HANDLE_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(HANDLE_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
  const run = async (mode, action) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(HANDLE_STORE, mode);
      const request = action(transaction.objectStore(HANDLE_STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  };
  return {
    all: () => run('readonly', (store) => store.getAll()),
    put: (value) => run('readwrite', (store) => store.put(value, value.key)),
    delete: (key) => run('readwrite', (store) => store.delete(key)),
  };
}

function needsAccess(path, name, mode) {
  return Object.assign(new Error(`the browser needs permission to ${mode === 'read' ? 'open' : 'change'} "${name}"`), {
    code: 'needs-access', path, target: name, mode,
  });
}

/**
 * Whether the page may use a handle. Without `prompt` this only asks the
 * browser what is already granted; with it, it also shows the browser's
 * permission prompt, which needs a recent click or key press.
 */
async function permitted(handle, mode, prompt = false) {
  if (typeof handle?.queryPermission !== 'function') return true;
  const options = { mode };
  if (await handle.queryPermission(options) === 'granted') return true;
  if (!prompt || typeof handle.requestPermission !== 'function') return false;
  try {
    return await handle.requestPermission(options) === 'granted';
  } catch (error) {
    if (error?.name === 'SecurityError' || error?.name === 'NotAllowedError') return false;
    throw error;
  }
}

function missingFile(error, name) {
  if (error?.name === 'NotFoundError') return Object.assign(new Error(`"${name}" was not found`), { status: 404 });
  return error;
}

/**
 * Browser-only persistence. Where the browser has the File System Access API
 * (Chromium), every document stays linked to its file on disk: Save writes
 * that file in place, and the links survive a reload. One folder can be the
 * workspace, as in Node mode; single files opened from elsewhere are listed
 * beside it. Nothing is copied into browser storage, so no second version of
 * a document can drift away from its file.
 *
 * Without file handles (Firefox, Safari), opened files and an imported folder
 * are read once for this page only, and Save downloads the document.
 *
 * `pickOpenFile`, `pickSaveFile`, `pickFolder`, `download`, and
 * `handleStore` are injectable for tests and for embedders that want to
 * provide their own browser integration.
 */
export function createBrowserPersistenceAdapter({
  storage = globalThis.localStorage,
  documentImpl = globalThis.document,
  windowImpl = globalThis.window,
  handleStore = indexedDbHandleStore(windowImpl?.indexedDB),
  pickOpenFile = null,
  pickSaveFile = null,
  pickFolder = null,
  download = null,
} = {}) {
  // The workspace folder: { name, handle, locked } with a directory handle,
  // or { name, handle: null } for a folder read once through a file input.
  let folder = null;
  const folderDocs = new Map(); // path -> record, for files in the folder
  const opened = new Map(); // path -> record, for files opened from elsewhere
  const kinds = new Map(); // path -> { revision, valid }, so a listing parses each file once
  // The file last opened or saved: file pickers start in its folder.
  let location = null;
  // Export folders by their displayed path (the folder's name). They are
  // never the workspace: choosing one leaves the open folder alone.
  const exportFolders = new Map();
  // A record is { path, name, handle, state?, lastModified?, revision?, legacy? }:
  // with a handle the file is read and written in place; without one, `state`
  // holds the contents read this session.

  // Earlier releases cached every document in localStorage. Those copies stay
  // listed (and savable to a real file) until forgotten, but nothing new is
  // cached there.
  const legacy = readBrowserDocuments(storage);
  for (const [name, state] of Object.entries(legacy)) {
    if (state && typeof state === 'object') opened.set(browserPath(name), { path: browserPath(name), name, handle: null, state, legacy: true });
  }
  const writeLegacy = () => {
    const next = {};
    for (const record of opened.values()) if (record.legacy) next[record.name] = record.state;
    writeBrowserDocuments(storage, next);
  };

  const remember = async (value) => { try { await handleStore?.put(value); } catch { /* storage unavailable */ } };
  const forget = async (key) => { try { await handleStore?.delete(key); } catch { /* storage unavailable */ } };

  const ready = (async () => {
    let stored = [];
    try { stored = (await handleStore?.all()) || []; } catch { /* storage unavailable */ }
    for (const value of stored) {
      if (value?.kind === 'location' && value.handle) location = value.handle;
      else if (value?.kind === 'folder' && value.handle) folder = { name: value.name || value.handle.name, handle: value.handle, locked: false };
      else if (value?.kind === 'export-folder' && value.handle && value.path) exportFolders.set(value.path, value.handle);
      else if (value?.kind === 'file' && value.handle && value.path && !opened.has(value.path)) {
        opened.set(value.path, { path: value.path, name: value.name, handle: value.handle });
      }
    }
  })();

  const pickerStart = () => {
    const start = location || folder?.handle;
    return start ? { startIn: start } : {};
  };
  const setLocation = (handle) => {
    if (!handle || handle === location) return;
    location = handle;
    void remember({ key: LOCATION_KEY, kind: 'location', handle });
  };

  const folderPath = (fileName) => browserPath(`${folder.name}/${fileName}`);
  const folderDir = () => folder?.name || '';
  const recordFor = (path) => folderDocs.get(path) || opened.get(path) || null;
  const dirOf = (record) => (folderDocs.has(record.path) ? folderDir() : OPENED_FILES);
  const writable = () => !!folder?.handle && typeof folder.handle.getFileHandle === 'function';

  function uniqueOpenedPath(fileName) {
    let path = browserPath(fileName);
    for (let n = 2; opened.has(path); n += 1) path = browserPath(`${fileName}#${n}`);
    return path;
  }

  /** Whether a document file holds a drawing, parsed once per revision. */
  async function validDocument(path, file) {
    const revision = fileRevision(file);
    const known = kinds.get(path);
    if (known?.revision === revision) return known.valid;
    let valid = false;
    try {
      loadDocument(JSON.parse(await file.text()));
      valid = true;
    } catch { /* not a drawing */ }
    kinds.set(path, { revision, valid });
    return valid;
  }

  /** Re-read the folder's document files; a folder without permission lists nothing. */
  async function listFolder() {
    if (!folder?.handle) return;
    folder.locked = !await permitted(folder.handle, 'read');
    if (folder.locked) {
      folderDocs.clear();
      return;
    }
    const seen = new Set();
    for await (const entry of folder.handle.values()) {
      if (entry.kind !== 'file' || !isDocumentFileName(entry.name)) continue;
      const path = folderPath(entry.name);
      let file;
      try { file = await entry.getFile(); } catch { continue; }
      if (!await validDocument(path, file)) continue;
      seen.add(path);
      const record = folderDocs.get(path) || { path, name: documentNameFromFile(entry), handle: entry };
      record.handle = entry;
      record.revision = fileRevision(file);
      folderDocs.set(path, record);
    }
    for (const path of folderDocs.keys()) if (!seen.has(path)) folderDocs.delete(path);
  }

  async function describe(record) {
    const entry = { name: record.name, path: record.path, kind: 'circuit' };
    if (!record.handle) return entry;
    if (!await permitted(record.handle, 'read')) return { ...entry, locked: true };
    try {
      entry.revision = fileRevision(await record.handle.getFile());
    } catch {
      entry.missing = true;
    }
    return entry;
  }

  const sortByName = (items) => items.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

  async function workspace() {
    await ready;
    await listFolder();
    const files = sortByName(await Promise.all([...opened.values()].map(describe)));
    const folderState = folder && { name: folder.name, locked: !!folder.locked, writable: writable() };
    if (!folder) return { workspace: OPENED_FILES, home: '', sep: '/', documents: files, recent: [], folder: null };
    const documents = sortByName(await Promise.all([...folderDocs.values()].map(describe)));
    return { workspace: folder.name, home: '', sep: '/', documents, recent: files, folder: folderState };
  }

  /** Use a directory handle (or a folder read once) as the workspace. */
  async function useFolder(handle, docs = null) {
    await ready;
    folderDocs.clear();
    kinds.clear();
    if (handle) {
      folder = { name: handle.name, handle, locked: false };
      await remember({ key: FOLDER_KEY, kind: 'folder', name: handle.name, handle });
      setLocation(handle);
      return;
    }
    await forget(FOLDER_KEY);
    folder = { name: docs.name, handle: null, locked: false };
    for (const doc of docs.files) {
      const path = folderPath(doc.fileName);
      folderDocs.set(path, { path, name: documentNameFromFile({ name: doc.fileName }), handle: null, state: doc.state });
    }
  }

  /** Where a picked file handle lives: its folder-workspace path, or null. */
  async function pathInFolder(handle) {
    if (!folder?.handle || typeof folder.handle.resolve !== 'function') return null;
    try {
      const parts = await folder.handle.resolve(handle);
      if (parts?.length === 1) {
        const path = folderPath(parts[0]);
        if (!folderDocs.has(path)) folderDocs.set(path, { path, name: documentNameFromFile(handle), handle });
        return path;
      }
    } catch { /* not comparable */ }
    return null;
  }

  /** Add one picked or dropped file to the document list; resolves its path. */
  async function addFile({ handle = null, file = null }) {
    if (handle) {
      const inFolder = await pathInFolder(handle);
      if (inFolder) return inFolder;
      for (const record of opened.values()) {
        try {
          if (record.handle && await record.handle.isSameEntry(handle)) return record.path;
        } catch { /* keep looking */ }
      }
      const path = uniqueOpenedPath(handle.name);
      const record = { path, name: documentNameFromFile(handle), handle };
      opened.set(path, record);
      await remember({ key: `file:${path}`, kind: 'file', path, name: record.name, handle });
      return path;
    }
    const state = JSON.parse(await file.text());
    const path = uniqueOpenedPath(file.name || 'circuit.json');
    opened.set(path, { path, name: documentNameFromFile(file), handle: null, state });
    return path;
  }

  async function addFiles(picked) {
    const paths = [];
    for (const item of picked) paths.push(await addFile(item));
    return [...new Set(paths)];
  }

  async function openFiles() {
    await ready;
    let picked = [];
    if (!pickOpenFile && typeof windowImpl?.showOpenFilePicker === 'function') {
      try {
        const handles = await windowImpl.showOpenFilePicker({
          multiple: true,
          types: DOCUMENT_TYPES,
          ...pickerStart(),
        });
        picked = handles.map((handle) => ({ handle }));
      } catch (error) {
        if (error?.name === 'AbortError') return null;
        if (error?.name !== 'NotSupportedError' && error?.name !== 'SecurityError') throw error;
      }
    }
    if (!picked.length) {
      const files = pickOpenFile ? await pickOpenFile() : await fileInput({ documentImpl, multiple: true });
      picked = [files].flat().filter(Boolean).map((file) => ({ file }));
    }
    if (!picked.length) return null;
    const paths = await addFiles(picked);
    const first = recordFor(paths[0]);
    return { path: paths[0], paths, name: first.name, dir: dirOf(first) };
  }

  async function chooseFolder() {
    await ready;
    if (pickFolder) {
      const chosen = await pickFolder();
      if (!chosen) return null;
      await useFolder(chosen.handle || null, chosen.handle ? null : chosen);
      return { path: folder.name };
    }
    if (typeof windowImpl?.showDirectoryPicker === 'function') {
      try {
        const handle = await windowImpl.showDirectoryPicker({
          id: 'mosfeteer-workspace',
          mode: 'readwrite',
          ...(folder?.handle ? { startIn: folder.handle } : pickerStart()),
        });
        await useFolder(handle);
        return { path: folder.name };
      } catch (error) {
        if (error?.name === 'AbortError') return null;
        if (error?.name !== 'NotSupportedError' && error?.name !== 'SecurityError') throw error;
      }
    }
    // A folder input yields every file below the folder; like Node mode,
    // the workspace is the folder's own documents only.
    const files = await fileInput({ documentImpl, accept: '', folder: true });
    if (!files.length) return null;
    const name = String(files[0].webkitRelativePath || '').split('/')[0] || 'Folder';
    const docs = [];
    for (const file of files) {
      const parts = String(file.webkitRelativePath || file.name).split('/');
      if (parts.length > 2 || !isDocumentFileName(file.name)) continue;
      try {
        const state = JSON.parse(await file.text());
        loadDocument(state);
        docs.push({ fileName: file.name, state });
      } catch { /* not a drawing */ }
    }
    await useFolder(null, { name, files: docs });
    return { path: name };
  }

  const canChooseExportFolder = () => typeof windowImpl?.showDirectoryPicker === 'function';

  /** Pick a folder to export into, without touching the workspace folder. */
  async function chooseExportFolder(dir = '') {
    await ready;
    if (!canChooseExportFolder()) return null;
    let handle;
    try {
      const current = exportFolders.get(dir);
      handle = await windowImpl.showDirectoryPicker({
        id: 'mosfeteer-export',
        mode: 'readwrite',
        ...(current ? { startIn: current } : {}),
      });
    } catch (error) {
      if (error?.name === 'AbortError') return null;
      throw error;
    }
    let path = null;
    for (const [known, knownHandle] of exportFolders) {
      try {
        if (await knownHandle.isSameEntry(handle)) path = known;
      } catch { /* keep looking */ }
    }
    if (!path) {
      path = handle.name;
      for (let n = 2; exportFolders.has(path) || path === BROWSER_DOWNLOADS; n += 1) path = `${handle.name} (${n})`;
    }
    exportFolders.set(path, handle);
    await remember({ key: `${EXPORT_FOLDER_KEY}${path}`, kind: 'export-folder', path, handle });
    return { path };
  }

  /** Ask where to save; resolves { handle|null, name } or null when canceled. */
  async function saveFile(name) {
    if (pickSaveFile) {
      const selected = await pickSaveFile(name);
      if (!selected) return null;
      return { ...selected, name: documentNameFromFile({ name: selected.name || name }) };
    }
    if (typeof windowImpl?.showSaveFilePicker !== 'function') return { handle: null, name };
    try {
      const handle = await windowImpl.showSaveFilePicker({
        suggestedName: `${name}.json`,
        types: DOCUMENT_TYPES,
        ...pickerStart(),
      });
      return { handle, name: documentNameFromFile(handle) };
    } catch (error) {
      if (error?.name === 'AbortError') return null;
      if (error?.name !== 'NotSupportedError' && error?.name !== 'SecurityError') throw error;
      return { handle: null, name };
    }
  }

  /** Turn a save-picker choice into a listed record, reusing a known path for the same file. */
  async function recordForChoice(selected, fallbackName) {
    const name = validDocumentName(selected.name) || fallbackName;
    if (selected.handle) {
      const path = await addFile({ handle: selected.handle });
      return recordFor(path);
    }
    const path = uniqueOpenedPath(`${name}.json`);
    const record = { path, name, handle: null, state: null };
    opened.set(path, record);
    return record;
  }

  async function requireAccess(record, mode, prompt) {
    const handle = record?.handle || folder?.handle;
    if (!await permitted(handle, mode, prompt)) {
      throw needsAccess(record?.path || '', record?.handle ? `${record.name}.json` : folder?.name || '', mode);
    }
  }

  async function writeRecord(record, content, { force = false } = {}) {
    await requireAccess(record, 'readwrite', true);
    // Another window or program may have saved the file since this window
    // read it; overwriting it then needs the user's say-so.
    if (!force && record.lastModified !== undefined) {
      let current = null;
      try { current = await record.handle.getFile(); } catch { /* removed: write it again */ }
      if (current && current.lastModified !== record.lastModified) {
        throw Object.assign(new Error(`"${record.name}" changed on disk since this window opened it`), { code: 'changed' });
      }
    }
    await writeFileHandle(record.handle, content);
    const file = await record.handle.getFile();
    record.lastModified = file.lastModified;
    record.revision = fileRevision(file);
    setLocation(record.handle);
  }

  async function save(target = {}, state, { overwrite = false, force = false } = {}) {
    await ready;
    const content = `${JSON.stringify(state, null, 2)}\n`;
    let record = target.path ? recordFor(target.path) : null;
    const name = validDocumentName(target.name || record?.name || documentNameFromFile({ name: browserName(target.path) })) || 'circuit';
    if (!record && writable() && (!target.dir || target.dir === folder.name)) {
      // A new document goes into the workspace folder, as in Node mode.
      await requireAccess(null, 'readwrite', true);
      const fileName = `${name}.json`;
      const path = folderPath(fileName);
      if (!overwrite) {
        let exists = false;
        try { await folder.handle.getFileHandle(fileName); exists = true; } catch { /* free */ }
        if (exists) throw Object.assign(new Error(`"${fileName}" already exists`), { status: 409, code: 'exists' });
      }
      const handle = await folder.handle.getFileHandle(fileName, { create: true });
      record = { path, name, handle };
      folderDocs.set(path, record);
    }
    const canPick = !!pickSaveFile || typeof windowImpl?.showSaveFilePicker === 'function';
    if (!record || (!record.handle && canPick)) {
      // No file to write yet: ask for one. This also gives a document read
      // from an older browser cache a real file of its own.
      const selected = await saveFile(name);
      if (!selected) throw Object.assign(new Error('save canceled'), { code: 'canceled' });
      if (selected.handle) {
        const previous = record;
        record = recordFor(await addFile({ handle: selected.handle }));
        if (previous?.legacy) {
          opened.delete(previous.path);
          writeLegacy();
        }
      } else if (!record) {
        record = await recordForChoice(selected, name);
      }
    }
    if (record.handle) {
      await writeRecord(record, content, { force: force || !target.path || target.path !== record.path });
      return { name: record.name, path: record.path, dir: dirOf(record), state, revision: record.revision };
    }
    // Without file handles the browser can only download the document.
    makeDownload(download, content, `${record.name}.json`, 'application/json');
    record.state = state;
    if (record.legacy) writeLegacy();
    return { name: record.name, path: record.path, dir: dirOf(record), state, downloaded: true };
  }

  async function load(path, { open = false } = {}) {
    await ready;
    const record = recordFor(path);
    if (!record) throw new Error(`"${browserName(path)}" is not open in this browser; open the file or its folder again`);
    if (!record.handle) {
      if (!record.state) throw new Error(`"${record.name}" has not been saved yet`);
      return { name: record.name, path, dir: dirOf(record), state: record.state };
    }
    await requireAccess(record, 'read', open);
    let file;
    try { file = await record.handle.getFile(); } catch (error) { throw missingFile(error, `${record.name}.json`); }
    const state = JSON.parse(await file.text());
    record.lastModified = file.lastModified;
    record.revision = fileRevision(file);
    if (open) setLocation(record.handle);
    return { name: record.name, path, dir: dirOf(record), state, revision: record.revision };
  }

  /** The file's current revision, without prompting; null when unknown. */
  async function revision(path) {
    await ready;
    const record = recordFor(path);
    if (!record?.handle || !await permitted(record.handle, 'read')) return null;
    try { return fileRevision(await record.handle.getFile()); } catch { return null; }
  }

  /** Show the browser's permission prompt for a document, or the folder when no path is given. */
  async function requestAccess(path = '', mode = 'readwrite') {
    await ready;
    const record = path ? recordFor(path) : null;
    const handle = record?.handle || folder?.handle;
    if (!handle) return true;
    const granted = await permitted(handle, handle === folder?.handle ? 'readwrite' : mode, true);
    if (granted && handle === folder?.handle) folder.locked = false;
    return granted;
  }

  /** Documents dropped on the window. Call it from the drop event itself:
   *  the browser hands out file handles only while the event runs. */
  function openDropped(dataTransfer) {
    const items = [...(dataTransfer?.items || [])].filter((item) => item.kind === 'file');
    const pending = items.map((item) => (typeof item.getAsFileSystemHandle === 'function' ? item.getAsFileSystemHandle() : null));
    const files = [...(dataTransfer?.files || [])];
    return (async () => {
      await ready;
      const handles = (await Promise.all(pending.map((promise) => promise?.catch(() => null)))).filter(Boolean);
      const directory = handles.find((handle) => handle.kind === 'directory');
      if (directory) {
        await useFolder(directory);
        return { folder: directory.name, paths: [] };
      }
      const picked = handles.length
        ? handles.filter((handle) => handle.kind === 'file' && isDocumentFileName(handle.name)).map((handle) => ({ handle }))
        : files.filter((file) => isDocumentFileName(file.name)).map((file) => ({ file }));
      return { folder: null, paths: await addFiles(picked) };
    })();
  }

  return {
    browserOnly: true,
    liveSync: false,
    supportedExportFormats: new Set(['svg', 'png']),
    get canChooseExportFolder() { return canChooseExportFolder(); },
    /** While the submit still carries user activation: ask for access to a
     *  chosen export folder, or reserve a native PNG save target before
     *  rasterization loses the activation. */
    prepareExport: async ({ name, formats = [], dir = '' } = {}) => {
      await ready;
      const exportFolder = exportFolders.get(dir);
      if (exportFolder) {
        if (!await permitted(exportFolder, 'readwrite', true)) throw needsAccess('', dir, 'readwrite');
        return null;
      }
      if (!formats.includes('png') || download || typeof windowImpl?.showSaveFilePicker !== 'function') return null;
      try {
        const handle = await windowImpl.showSaveFilePicker({
          suggestedName: `${validDocumentName(name) || 'circuit'}.png`,
          types: [{ description: 'PNG image', accept: { 'image/png': ['.png'] } }],
        });
        return { pngHandle: handle };
      } catch (error) {
        if (error?.name === 'AbortError') throw Object.assign(new Error('save canceled'), { code: 'canceled' });
        if (error?.name !== 'NotSupportedError' && error?.name !== 'SecurityError') throw error;
        return null;
      }
    },
    workspace,
    setWorkspace: workspace,
    browse: async () => ({ dir: BROWSER_DOWNLOADS, entries: [], parent: null, home: '', workspace: BROWSER_DOWNLOADS }),
    createFolder: async () => { throw new Error('create folders with the browser\'s folder picker'); },
    pickFile: async ({ mode = 'open', name = '', dir = '' } = {}) => {
      if (mode === 'open') return openFiles();
      if (mode === 'folder') return chooseFolder();
      if (mode === 'export-folder') return chooseExportFolder(dir);
      await ready;
      const fallbackName = validDocumentName(name) || 'circuit';
      const selected = await saveFile(fallbackName);
      if (!selected) return null;
      const record = await recordForChoice(selected, fallbackName);
      return { path: record.path, dir: dirOf(record), name: record.name };
    },
    openDropped,
    load,
    revision,
    requestAccess,
    save,
    /** Take every file opened on its own off the list, except `keep` (the
     *  open document); the files stay on disk. Resolves how many went. */
    forgetOpened: async ({ keep = null } = {}) => {
      await ready;
      let count = 0;
      for (const record of [...opened.values()]) {
        if (record.path === keep) continue;
        opened.delete(record.path);
        if (record.handle) await forget(`file:${record.path}`);
        count += 1;
      }
      writeLegacy();
      return count;
    },
    /** Whether deleting this document removes its file (a folder document)
     *  rather than only taking it off the list. */
    deletesFile: (path) => folderDocs.has(path) && writable(),
    delete: async (path) => {
      await ready;
      const record = folderDocs.get(path);
      if (record && writable()) {
        await requireAccess(null, 'readwrite', true);
        await folder.handle.removeEntry(browserName(path).slice(folder.name.length + 1));
        folderDocs.delete(path);
        return { path, deleted: true };
      }
      // Anything else is only taken off the list; its file stays on disk.
      const forgotten = opened.get(path);
      opened.delete(path);
      folderDocs.delete(path);
      if (forgotten?.legacy) writeLegacy();
      if (forgotten?.handle) await forget(`file:${path}`);
      return { path, deleted: true };
    },
    reveal: async () => { throw new Error('the browser cannot show files in the file manager'); },
    active: async () => ({ active: '', path: '' }),
    heartbeat: async () => {},
    exportFiles: async ({ dir = BROWSER_DOWNLOADS, name, formats = [], svg = '', png = '', overwrite = false }, { prepared = null } = {}) => {
      const supported = formats.filter((format) => ['svg', 'png'].includes(format));
      const unsupported = formats.filter((format) => !['svg', 'png'].includes(format));
      if (unsupported.length) throw Object.assign(new Error(`browser-only export does not support: ${unsupported.join(', ')}`), { code: 'unsupported-format' });
      await ready;
      const exportFolder = exportFolders.get(dir);
      if (exportFolder) {
        if (!await permitted(exportFolder, 'readwrite', true)) throw needsAccess('', dir, 'readwrite');
        const files = supported.map((format) => ({ fileName: `${name}.${format}`, contents: format === 'svg' ? svg : dataUrlBlob(png) }));
        if (!overwrite) {
          const existing = [];
          for (const { fileName } of files) {
            try { await exportFolder.getFileHandle(fileName); existing.push(`${dir}/${fileName}`); } catch { /* free */ }
          }
          if (existing.length) throw Object.assign(new Error(`${existing.length === 1 ? 'a file' : 'files'} already exist`), { code: 'exists', existing });
        }
        for (const { fileName, contents } of files) await writeFileHandle(await exportFolder.getFileHandle(fileName, { create: true }), contents);
        return { dir, paths: files.map(({ fileName }) => `${dir}/${fileName}`) };
      }
      // A folder this browser no longer knows (or never could) downloads.
      dir = BROWSER_DOWNLOADS;
      const paths = [];
      if (supported.includes('svg')) {
        const fileName = `${name}.svg`;
        makeDownload(download, svg, fileName, 'image/svg+xml');
        paths.push(`${dir}/${fileName}`);
      }
      if (supported.includes('png')) {
        const fileName = `${name}.png`;
        const image = dataUrlBlob(png);
        if (prepared?.pngHandle) await writeFileHandle(prepared.pngHandle, image);
        else makeDownload(download, image, fileName, 'image/png');
        paths.push(`${dir}/${fileName}`);
      }
      return { dir, paths, notes: ['Files were downloaded by the browser.'] };
    },
  };
}

function responseHeader(response, name) {
  return typeof response.headers?.get === 'function' ? response.headers.get(name) : null;
}

function withResponseMeta(data, response, notModified = false) {
  Object.defineProperties(data, {
    revision: { value: responseHeader(response, 'x-circuit-revision') || responseHeader(response, 'x-active-revision'), enumerable: false },
    etag: { value: responseHeader(response, 'etag'), enumerable: false },
    notModified: { value: notModified, enumerable: false },
  });
  return data;
}

/** Waits between tries while the server cannot be reached: a `--watch`
 *  server restarting after a source change is back within a second or two. */
export const UNREACHABLE_RETRY_MS = [250, 500, 1000, 1500, 2000, 3000];

/** `fetch`, tried again while the server cannot be reached at all (the
 *  browser's bare "Failed to fetch"), then failing with an error that says so. */
async function fetchRetrying(fetchImpl, url, options, waits, sleep) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fetchImpl(url, options);
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      if (attempt >= waits.length) {
        const error = new Error('the Mosfeteer server is not responding; check that it is still running, then try again');
        error.code = 'unreachable';
        error.cause = err;
        throw error;
      }
      await sleep(waits[attempt]);
    }
  }
}

async function httpJsonOnce(fetchImpl, url, options = {}, { waits = UNREACHABLE_RETRY_MS, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const response = await fetchRetrying(fetchImpl, url, { cache: 'no-store', ...options }, waits, sleep);
  if (response.status === 304) return withResponseMeta({}, response, true);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `server returned ${response.status}`);
    error.status = response.status;
    if (data.code) error.code = data.code;
    if (Array.isArray(data.existing)) error.existing = data.existing;
    throw error;
  }
  return withResponseMeta(data, response);
}

const jsonBody = (method, value) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(value),
});

export function createPersistenceAdapter({ fetchImpl = globalThis.fetch, retry } = {}) {
  if (browserOnlyRequested()) return createBrowserPersistenceAdapter();
  if (typeof fetchImpl !== 'function') throw new Error('persistence requires fetch');
  const httpJson = (impl, url, options) => httpJsonOnce(impl, url, options, retry);
  const query = (params) => new URLSearchParams(params).toString();
  return {
    liveSync: true,
    workspace: () => httpJson(fetchImpl, '/api/workspace'),
    setWorkspace: (path) => httpJson(fetchImpl, '/api/workspace', jsonBody('PUT', { path })),
    browse: (dir, { nearest = false } = {}) => httpJson(fetchImpl, `/api/browse${dir || nearest ? `?${query({ ...(dir ? { dir } : {}), ...(nearest ? { nearest: '1' } : {}) })}` : ''}`),
    createFolder: (dir, name) => httpJson(fetchImpl, '/api/folders', jsonBody('POST', { dir, name })),
    reveal: (path) => httpJson(fetchImpl, '/api/reveal', jsonBody('POST', { path })),
    /** `open` records the file in the recent-documents list. */
    load: (path, { ifNoneMatch, open = false } = {}) => httpJson(fetchImpl, `/api/document?${query({ path, ...(open ? { open: '1' } : {}) })}`, {
      ...(ifNoneMatch ? { headers: { 'If-None-Match': ifNoneMatch } } : {}),
    }),
    /** Target is `{ path }` or `{ dir?, name }` (dir defaults to the workspace). */
    save: (target, state, { overwrite = false } = {}) => httpJson(fetchImpl, '/api/document', jsonBody('PUT', { ...target, state, overwrite })),
    delete: (path) => httpJson(fetchImpl, `/api/document?${query({ path })}`, { method: 'DELETE' }),
    active: () => httpJson(fetchImpl, '/api/active'),
    heartbeat: (id) => fetchImpl('/api/session', { ...jsonBody('POST', { id }), keepalive: true }).catch(() => {}),
    /** Write `<dir>/<name>.<format>` for each format; `svg` and PNG data URL `png` are rendered by the editor. */
    exportFiles: (request) => httpJson(fetchImpl, '/api/export', jsonBody('POST', request)),
  };
}
