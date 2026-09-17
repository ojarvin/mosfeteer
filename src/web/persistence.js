/**
 * Persistence boundary for the editor: the local server's document API.
 * Documents are files addressed by absolute path; the workspace is the folder
 * the document picker lists and new documents are saved into.
 */

/** Mirrors the server rule: document names become file names. */
export function validDocumentName(value) {
  const name = String(value ?? '').trim();
  if (!name || name.length > 120 || name.startsWith('.') || /[/\\:*?"<>|\u0000-\u001f\u007f]/.test(name)) return null;
  return name;
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
