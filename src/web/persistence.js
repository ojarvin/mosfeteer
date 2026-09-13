/**
 * Persistence boundary for the editor. Desktop uses the preload API; browser
 * and development use the existing HTTP service.
 */

function encoded(name) {
  return encodeURIComponent(name);
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
  if (!response.ok) throw new Error(data.error || `server returned ${response.status}`);
  return withResponseMeta(data, response);
}

function browserExport({ content, dataUrl, suggestedName = 'circuit.svg', extension = 'svg', format = extension, printWindow = null }) {
  if (format === 'pdf') {
    if (!printWindow || printWindow.closed) throw new Error('could not open the browser print window');
    const size = String(content || '').match(/<svg\b[^>]*\bwidth="([\d.]+)"[^>]*\bheight="([\d.]+)"/i);
    const width = size?.[1] || '1000';
    const height = size?.[2] || '800';
    printWindow.document.open();
    printWindow.document.write(`<!doctype html><html><head><title>${String(suggestedName).replace(/[<&>]/g, '')}</title><style>@page{size:${width}px ${height}px;margin:0}html,body{margin:0;padding:0;background:#fff}svg{display:block;width:${width}px;height:${height}px}</style></head><body>${content || ''}</body></html>`);
    printWindow.document.close();
    setTimeout(() => { printWindow.focus(); printWindow.print(); }, 100);
    return { canceled: false, path: suggestedName };
  }
  const blob = dataUrl
    ? null
    : new Blob([content], { type: extension === 'svg' ? 'image/svg+xml' : 'application/octet-stream' });
  const link = document.createElement('a');
  const url = dataUrl || URL.createObjectURL(blob);
  link.href = url;
  link.download = suggestedName;
  link.click();
  if (!dataUrl) setTimeout(() => URL.revokeObjectURL(url), 0);
  return { canceled: false, path: suggestedName };
}

export function createPersistenceAdapter({ nativeApi = globalThis.schematicStorage, fetchImpl = globalThis.fetch } = {}) {
  if (nativeApi) {
    return {
      mode: 'desktop',
      liveSync: false,
      list: () => nativeApi.list(),
      load: (name) => nativeApi.load(name),
      create: (name, kind) => nativeApi.create ? nativeApi.create(name, kind) : nativeApi.save(name, kind === 'block' ? { kind: 'block', version: 1, grid: 40, blocks: [], arrows: [] } : { version: 2, grid: 40, components: [], nets: [], labels: [] }),
      save: (name, state) => nativeApi.save(name, state),
      delete: (name) => nativeApi.delete(name),
      lastOpened: () => nativeApi.lastOpened ? nativeApi.lastOpened() : Promise.resolve(null),
      markOpened: (name) => nativeApi.markOpened ? nativeApi.markOpened(name) : Promise.resolve(null),
      export: (options) => nativeApi.export(options),
    };
  }

  if (typeof fetchImpl !== 'function') throw new Error('browser persistence requires fetch');
  return {
    mode: 'http',
    liveSync: true,
    list: () => httpJson(fetchImpl, '/api/circuits'),
    create: (name, kind = 'circuit') => httpJson(fetchImpl, `/api/circuits/${encoded(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind }),
    }),
    load: (name, { ifNoneMatch } = {}) => httpJson(fetchImpl, `/api/circuits/${encoded(name)}`, {
      ...(ifNoneMatch ? { headers: { 'If-None-Match': ifNoneMatch } } : {}),
    }),
    save: (name, state) => httpJson(fetchImpl, `/api/circuits/${encoded(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    }),
    delete: (name) => httpJson(fetchImpl, `/api/circuits/${encoded(name)}`, { method: 'DELETE' }),
    export: browserExport,
  };
}
