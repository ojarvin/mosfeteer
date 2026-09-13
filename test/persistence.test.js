import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { createNativeStorage } from '../src/desktop/storage.js';
import { createPersistenceAdapter } from '../src/web/persistence.js';

function response(body, ok = true, status = 200, headers = {}) {
  return { ok, status, headers: { get(name) { return headers[name.toLowerCase()] || null; } }, async json() { return body; } };
}

test('desktop persistence stores validated circuit files in its workspace', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'schematic-spawner-storage-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storage = createNativeStorage(root);
  const state = new Circuit().toJSON();

  assert.deepEqual(await storage.list(), { circuits: [], documents: [] });
  assert.deepEqual(await storage.save('bench_1', state), {
    name: 'bench_1', files: ['circuit.json', 'circuit.svg'],
  });
  assert.deepEqual(await storage.list(), {
    circuits: ['bench_1'],
    documents: [{ name: 'bench_1', kind: 'circuit' }],
  });
  assert.deepEqual((await storage.load('bench_1')).state, state);
  assert.match(await readFile(join(root, 'bench_1', 'circuit.svg'), 'utf8'), /^<svg/);
  await assert.rejects(storage.load('../outside'), /invalid circuit name/);
  assert.deepEqual(await storage.delete('bench_1'), { name: 'bench_1', deleted: true });
  await assert.rejects(storage.load('bench_1'));
});

test('desktop persistence imports repository circuits without overwriting native circuits', async (t) => {
  const sourceRoot = await mkdtemp(join(tmpdir(), 'schematic-spawner-source-'));
  const targetRoot = await mkdtemp(join(tmpdir(), 'schematic-spawner-target-'));
  t.after(() => Promise.all([
    rm(sourceRoot, { recursive: true, force: true }),
    rm(targetRoot, { recursive: true, force: true }),
  ]));
  const source = createNativeStorage(sourceRoot);
  const target = createNativeStorage(targetRoot);
  const sourceState = new Circuit().toJSON();
  sourceState.grid = 80;
  await source.save('repository-circuit', sourceState);
  await target.save('repository-circuit', new Circuit().toJSON());
  await source.save('new-circuit', new Circuit().toJSON());

  assert.deepEqual(await target.importFrom(sourceRoot), { circuits: ['new-circuit'] });
  await target.create('block-overview', 'block');
  assert.deepEqual((await target.list()).documents.find(({ name }) => name === 'block-overview'), { name: 'block-overview', kind: 'block' });
  assert.deepEqual((await target.load('new-circuit')).state, new Circuit().toJSON());
  assert.equal((await target.load('repository-circuit')).state.grid, 40);
  assert.deepEqual(await target.importFrom(sourceRoot), { circuits: [] });
});

test('atomic desktop saves keep the previous pair when rendering fails', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'schematic-spawner-atomic-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const state = new Circuit().toJSON();
  const storage = createNativeStorage(root);
  await storage.save('pair', state);
  const beforeJson = await readFile(join(root, 'pair', 'circuit.json'), 'utf8');
  const beforeSvg = await readFile(join(root, 'pair', 'circuit.svg'), 'utf8');
  const failing = createNativeStorage(root, { render: () => { throw new Error('render failed'); } });
  await assert.rejects(failing.save('pair', { ...state, grid: 80 }), /render failed/);
  assert.equal(await readFile(join(root, 'pair', 'circuit.json'), 'utf8'), beforeJson);
  assert.equal(await readFile(join(root, 'pair', 'circuit.svg'), 'utf8'), beforeSvg);
});

test('HTTP persistence exposes conditional loads without changing response data', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push([url, options]);
    return response({}, false, 304, { etag: '"rev-1"', 'x-circuit-revision': 'rev-1' });
  };
  const browser = createPersistenceAdapter({ nativeApi: null, fetchImpl });
  const data = await browser.load('a/b', { ifNoneMatch: '"rev-1"' });
  assert.equal(data.notModified, true);
  assert.equal(data.revision, 'rev-1');
  assert.equal(data.etag, '"rev-1"');
  assert.deepEqual(Object.keys(data), []);
  assert.equal(requests[0][1].headers['If-None-Match'], '"rev-1"');
});

test('persistence adapter keeps native and HTTP contracts narrow', async () => {
  const calls = [];
  const native = {
    list: async () => ({ circuits: ['native'] }),
    load: async (name) => ({ name, state: { native: true } }),
    save: async (...args) => { calls.push(['save', ...args]); return { name: args[0] }; },
    delete: async (name) => ({ name, deleted: true }),
    lastOpened: async () => 'native',
    markOpened: async (name) => { calls.push(['markOpened', name]); return name; },
    export: async (options) => ({ canceled: false, path: options.suggestedName }),
  };
  const desktop = createPersistenceAdapter({ nativeApi: native });
  assert.equal(desktop.mode, 'desktop');
  assert.equal(desktop.liveSync, false);
  assert.deepEqual(await desktop.list(), { circuits: ['native'] });
  assert.equal(await desktop.lastOpened(), 'native');
  await desktop.save('one', { ok: true });
  assert.equal(await desktop.markOpened('one'), 'one');
  assert.deepEqual(calls, [['save', 'one', { ok: true }], ['markOpened', 'one']]);
  assert.deepEqual(await desktop.export({ suggestedName: 'one.svg' }), { canceled: false, path: 'one.svg' });

  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push([url, options]);
    return response(url === '/api/circuits' ? { circuits: ['http'] } : { name: 'a/b', state: {} });
  };
  const browser = createPersistenceAdapter({ nativeApi: null, fetchImpl });
  assert.equal(browser.mode, 'http');
  assert.equal(browser.liveSync, true);
  assert.deepEqual(await browser.list(), { circuits: ['http'] });
  await browser.load('a/b');
  await browser.save('a/b', { ok: true });
  await browser.delete('a/b');
  assert.deepEqual(requests.map(([url]) => url), [
    '/api/circuits',
    '/api/circuits/a%2Fb',
    '/api/circuits/a%2Fb',
    '/api/circuits/a%2Fb',
  ]);
  assert.equal(requests[2][1].method, 'PUT');
  assert.equal(requests[3][1].method, 'DELETE');
});

test('desktop startup creates the window without waiting for storage migration', async () => {
  const main = await readFile(new URL('../src/desktop/main.js', import.meta.url), 'utf8');
  assert.match(main, /storageReady = \(async \(\) =>/);
  assert.match(main, /await awaitStorage\(\);/);
  assert.match(main, /registerPersistence\(\);\s*await createWindow\(\);/);
  assert.doesNotMatch(main, /await registerPersistence\(\);\s*await createWindow\(\);/);
  assert.match(main, /show: false/);
  assert.match(main, /mainWindow\.once\('ready-to-show', showWindow\)/);
});
