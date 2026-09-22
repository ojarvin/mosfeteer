/**
 * Persistence boundary for the editor.
 *
 * The normal adapter talks to the local Node server. Browser-only mode keeps
 * the same document-shaped contract but uses browser file pickers, downloads,
 * and a small localStorage cache instead. Keeping the boundary here means the
 * editor and circuit core do not need to know where a document is stored.
 */

import { validDocumentName } from '../core/document.js';
export { validDocumentName };

const BROWSER_DOCUMENTS_KEY = 'mosfeteer:browser-documents';
const BROWSER_DOWNLOADS = 'Browser downloads';

/** Return the initial export destination for the active persistence mode. */
export function defaultExportDirectory(workspaceState = {}, { browserOnly = false } = {}) {
  if (browserOnly) return workspaceState.workspace || BROWSER_DOWNLOADS;
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
  try { storage.setItem(BROWSER_DOCUMENTS_KEY, JSON.stringify(documents)); } catch { /* quota/private mode */ }
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

function fileInput({ documentImpl = globalThis.document, accept = '.json,application/json' } = {}) {
  if (!documentImpl) throw new Error('browser file input is unavailable');
  return new Promise((resolve) => {
    const input = documentImpl.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => resolve(input.files?.[0] || null), { once: true });
    input.click();
  });
}

/**
 * Browser-only persistence. Documents loaded from disk are cached locally so
 * the document picker remains useful after a reload; the cache is not a
 * replacement for the downloaded JSON file and does not provide live sync.
 *
 * `pickOpenFile`, `pickSaveFile`, and `download` are injectable for tests and
 * for embedders that want to provide their own browser integration.
 */
export function createBrowserPersistenceAdapter({
  storage = globalThis.localStorage,
  documentImpl = globalThis.document,
  windowImpl = globalThis.window,
  pickOpenFile = null,
  pickSaveFile = null,
  download = null,
} = {}) {
  const records = new Map();
  const cached = readBrowserDocuments(storage);
  for (const [name, state] of Object.entries(cached)) {
    if (state && typeof state === 'object') records.set(browserPath(name), { name, state });
  }

  function remember(name, state, handle = null) {
    const cleanName = validDocumentName(name) || 'circuit';
    const path = browserPath(cleanName);
    records.set(path, { name: cleanName, state, handle });
    const next = {};
    for (const record of records.values()) next[record.name] = record.state;
    writeBrowserDocuments(storage, next);
    return path;
  }

  async function openFile() {
    let file = null;
    let handle = null;
    if (!pickOpenFile && typeof windowImpl?.showOpenFilePicker === 'function') {
      try {
        [handle] = await windowImpl.showOpenFilePicker({
          multiple: false,
          types: [{ description: 'Mosfeteer schematic', accept: { 'application/json': ['.json'] } }],
        });
        file = await handle.getFile();
      } catch (error) {
        if (error?.name === 'AbortError') return null;
        if (error?.name !== 'NotSupportedError' && error?.name !== 'SecurityError') throw error;
      }
    }
    if (!file) file = pickOpenFile ? await pickOpenFile() : await fileInput({ documentImpl });
    if (!file) return null;
    const text = await file.text();
    const state = JSON.parse(text);
    const name = documentNameFromFile(file);
    const path = remember(name, state, handle);
    return { path, name, dir: BROWSER_DOWNLOADS };
  }

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
        types: [{ description: 'Mosfeteer schematic', accept: { 'application/json': ['.json'] } }],
      });
      return { handle, name: documentNameFromFile(handle) };
    } catch (error) {
      if (error?.name === 'AbortError') return null;
      if (error?.name !== 'NotSupportedError' && error?.name !== 'SecurityError') throw error;
      return { handle: null, name };
    }
  }

  async function save(target = {}, state) {
    let path = target.path || '';
    let record = path ? records.get(path) : null;
    let name = validDocumentName(target.name || record?.name) || 'circuit';
    if (!record) {
      const selected = await saveFile(name);
      if (!selected) throw Object.assign(new Error('save canceled'), { code: 'canceled' });
      name = validDocumentName(selected.name) || name;
      path = browserPath(name);
      record = { name, handle: selected.handle || null };
      records.set(path, record);
    }
    const content = `${JSON.stringify(state, null, 2)}\n`;
    if (record.handle) {
      const writable = await record.handle.createWritable();
      await writable.write(content);
      await writable.close();
    } else {
      makeDownload(download, content, `${name}.json`, 'application/json');
    }
    remember(name, state, record.handle || null);
    return { name, path, dir: BROWSER_DOWNLOADS, state };
  }

  const workspace = async () => ({
    workspace: BROWSER_DOWNLOADS,
    home: '',
    sep: '/',
    documents: [...records.values()].map(({ name }) => ({ name, path: browserPath(name), kind: 'circuit' })),
    recent: [],
  });

  return {
    browserOnly: true,
    liveSync: false,
    supportedExportFormats: new Set(['svg', 'png']),
    /** Reserve a native save target before PNG rasterization loses user activation. */
    prepareExport: async ({ name, formats = [] } = {}) => {
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
    createFolder: async () => { throw new Error('folders are managed by the browser download location'); },
    pickFile: async ({ mode = 'open', name = '' } = {}) => {
      if (mode === 'open') return openFile();
      if (mode === 'folder') return { path: BROWSER_DOWNLOADS };
      const selected = await saveFile(validDocumentName(name) || 'circuit');
      if (!selected) return null;
      const cleanName = validDocumentName(documentNameFromFile({ name: selected.name })) || validDocumentName(name) || 'circuit';
      const path = browserPath(cleanName);
      records.set(path, { name: cleanName, handle: selected.handle || null });
      return { path, dir: BROWSER_DOWNLOADS, name: cleanName };
    },
    load: async (path) => {
      const record = records.get(path);
      if (!record?.state) throw new Error(`document is not available in this browser session: ${browserName(path)}`);
      return { name: record.name, path, dir: BROWSER_DOWNLOADS, state: record.state };
    },
    save,
    delete: async (path) => {
      // Browser-only cleanup forgets the cached entry; it never deletes a
      // disk file, including one represented by a native file handle.
      records.delete(path);
      const next = {};
      for (const value of records.values()) next[value.name] = value.state;
      writeBrowserDocuments(storage, next);
      return { path, deleted: true };
    },
    reveal: async () => { throw new Error('the browser controls the download location'); },
    active: async () => ({ active: '', path: '' }),
    heartbeat: async () => {},
    exportFiles: async ({ dir = BROWSER_DOWNLOADS, name, formats = [], svg = '', png = '' }, { prepared = null } = {}) => {
      const supported = formats.filter((format) => ['svg', 'png'].includes(format));
      const unsupported = formats.filter((format) => !['svg', 'png'].includes(format));
      if (unsupported.length) throw Object.assign(new Error(`browser-only export does not support: ${unsupported.join(', ')}`), { code: 'unsupported-format' });
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

async function httpJson(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, { cache: 'no-store', ...options });
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

export function createPersistenceAdapter({ fetchImpl = globalThis.fetch } = {}) {
  if (browserOnlyRequested()) return createBrowserPersistenceAdapter();
  if (typeof fetchImpl !== 'function') throw new Error('persistence requires fetch');
  const query = (params) => new URLSearchParams(params).toString();
  return {
    liveSync: true,
    workspace: () => httpJson(fetchImpl, '/api/workspace'),
    setWorkspace: (path) => httpJson(fetchImpl, '/api/workspace', jsonBody('PUT', { path })),
    browse: (dir) => httpJson(fetchImpl, `/api/browse${dir ? `?${query({ dir })}` : ''}`),
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
