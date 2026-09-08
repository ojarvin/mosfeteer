/**
 * Persistence boundary for the editor. Desktop uses the preload API; browser
 * and development use the existing HTTP service.
 */

function encoded(name) {
  return encodeURIComponent(name);
}

async function httpJson(fetchImpl, url, options) {
  const response = await fetchImpl(url, { cache: 'no-store', ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `server returned ${response.status}`);
  return data;
}

function browserExport({ content, suggestedName = 'circuit.svg', extension = 'svg' }) {
  const blob = new Blob([content], { type: extension === 'svg' ? 'image/svg+xml' : 'application/octet-stream' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = suggestedName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return { canceled: false, path: suggestedName };
}

export function createPersistenceAdapter({ nativeApi = globalThis.schematicStorage, fetchImpl = globalThis.fetch } = {}) {
  if (nativeApi) {
    return {
      mode: 'desktop',
      liveSync: false,
      list: () => nativeApi.list(),
      load: (name) => nativeApi.load(name),
      save: (name, state) => nativeApi.save(name, state),
      delete: (name) => nativeApi.delete(name),
      export: (options) => nativeApi.export(options),
    };
  }

  if (typeof fetchImpl !== 'function') throw new Error('browser persistence requires fetch');
  return {
    mode: 'http',
    liveSync: true,
    list: () => httpJson(fetchImpl, '/api/circuits'),
    load: (name) => httpJson(fetchImpl, `/api/circuits/${encoded(name)}`),
    save: (name, state) => httpJson(fetchImpl, `/api/circuits/${encoded(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    }),
    delete: (name) => httpJson(fetchImpl, `/api/circuits/${encoded(name)}`, { method: 'DELETE' }),
    export: browserExport,
  };
}
