import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import {
  browseFolder, documentNameFromPath, fileRevision, documentPathFor, listDocuments, readDocumentFile, validDocumentName, writeFileAtomic,
} from '../src/server/documents.js';
import { decodePngToRgb, pngToPdf } from '../src/server/pdf-raster.js';
import { findChromium } from '../src/server/browser.js';
import { allowedHosts, checkRequest } from '../src/server/request-guard.js';
import { createSettingsStore, defaultWorkspace } from '../src/server/settings.js';
import {
  createBrowserPersistenceAdapter, createPersistenceAdapter, defaultExportDirectory, validDocumentName as clientValidDocumentName,
} from '../src/web/persistence.js';

async function tempDir(t, prefix) {
  const dir = await mkdtemp(join(tmpdir(), `mosfeteer-${prefix}-`));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function response(body, ok = true, status = 200, headers = {}) {
  return { ok, status, headers: { get(name) { return headers[name.toLowerCase()] || null; } }, async json() { return body; } };
}

test('document names are portable file names and match on client and server', () => {
  for (const name of ['amp', 'Two-stage OTA (v2)', 'ÄÖ mixer', 'a.b']) {
    assert.equal(validDocumentName(name), name);
    assert.equal(clientValidDocumentName(name), name);
  }
  for (const name of ['', '   ', '.hidden', 'a/b', 'a\\b', 'c:d', 'what?', 'x'.repeat(121), 'tab\there']) {
    assert.equal(validDocumentName(name), null, name);
    assert.equal(clientValidDocumentName(name), null, name);
  }
  assert.equal(documentPathFor('/work', ' amp '), join('/work', 'amp.json'));
  assert.throws(() => documentPathFor('/work', '../x'), /invalid document name/);
  assert.equal(documentNameFromPath('/work/amp.schematic.json'), 'amp');
  assert.equal(documentNameFromPath('/work/amp.json'), 'amp');
});

test('export defaults use Pictures in Node mode and browser downloads otherwise', () => {
  assert.equal(defaultExportDirectory({ home: '/home/alice', sep: '/' }), '/home/alice/Pictures');
  assert.equal(defaultExportDirectory({ home: 'C:\\Users\\Alice', sep: '\\' }), 'C:\\Users\\Alice\\Pictures');
  assert.equal(defaultExportDirectory({ workspace: 'Browser downloads' }, { browserOnly: true }), 'Browser downloads');
});

test('atomic writes replace whole files and can refuse to overwrite', async (t) => {
  const dir = await tempDir(t, 'atomic');
  const path = join(dir, 'nested', 'amp.json');
  await writeFileAtomic(path, 'one');
  await writeFileAtomic(path, 'two');
  assert.equal(await readFile(path, 'utf8'), 'two');
  await assert.rejects(writeFileAtomic(path, 'three', { overwrite: false }), (error) => error.code === 'exists' && error.status === 409);
  assert.equal(await readFile(path, 'utf8'), 'two');
  assert.deepEqual(await readdir(join(dir, 'nested')), ['amp.json']);
});

test('workspace listing and folder browsing show documents, folders, and other JSON', async (t) => {
  const dir = await tempDir(t, 'browse');
  const state = JSON.stringify(new Circuit().toJSON());
  await writeFile(join(dir, 'b.json'), state);
  await writeFile(join(dir, 'a10.json'), JSON.stringify({ kind: 'block', version: 1, grid: 40, blocks: [], arrows: [] }));
  await writeFile(join(dir, 'a9.json'), state);
  await writeFile(join(dir, 'notes.json'), '{}');
  await writeFile(join(dir, 'readme.txt'), 'hi');
  await writeFile(join(dir, '.hidden.json'), state);
  await mkdir(join(dir, 'project'));

  assert.deepEqual((await listDocuments(dir)).map(({ name, kind }) => [name, kind]), [['a9', 'circuit'], ['b', 'circuit']]);
  assert.deepEqual(await listDocuments(join(dir, 'missing')), []);
  // Each entry carries its file revision; an edit changes it.
  const [{ revision }] = await listDocuments(dir);
  assert.equal(revision, await fileRevision(join(dir, 'a9.json')));
  await writeFile(join(dir, 'a9.json'), `${state}\n`);
  assert.notEqual((await listDocuments(dir))[0].revision, revision);
  const listing = await browseFolder(dir);
  assert.deepEqual(listing.entries.map(({ name, type }) => [name, type]), [
    ['project', 'folder'], ['a9', 'document'], ['b', 'document'], ['a10.json', 'json'], ['notes.json', 'json'],
  ]);
  assert.equal(listing.parent, join(dir, '..'));
  await assert.rejects(browseFolder(join(dir, 'missing')), (error) => error.status === 404);
  await assert.rejects(readDocumentFile(join(dir, 'notes.json')), (error) => error.status === 422);
  assert.deepEqual(await readDocumentFile(join(dir, 'b.json')), JSON.parse(state));
  await assert.rejects(readDocumentFile(join(dir, 'a10.json')), (error) => error.status === 422);
});

test('settings remember the workspace and a bounded recent list', async (t) => {
  const dir = await tempDir(t, 'settings');
  const file = join(dir, 'data', 'settings.json');
  const store = createSettingsStore(file);
  await store.load();
  await store.update({ workspace: '/work' });
  for (let index = 0; index < 15; index += 1) await store.addRecent(`/docs/${index}.json`);
  await store.addRecent('/docs/3.json');
  await store.removeRecent('/docs/14.json');
  await store.flush();
  const reloaded = createSettingsStore(file);
  const settings = await reloaded.load();
  assert.equal(settings.workspace, '/work');
  assert.equal(settings.recent[0], '/docs/3.json');
  assert.equal(settings.recent.length, 11);
  assert.ok(!settings.recent.includes('/docs/14.json'));
  assert.equal(defaultWorkspace(join(dir, 'no-home')), join(dir, 'no-home', 'Schematics'));
});

test('browser discovery honors an explicit executable and ignores the launcher-only "default"', () => {
  assert.equal(findChromium({ env: { MOSFETEER_BROWSER: '/opt/custom/chrome' } }), '/opt/custom/chrome');
  assert.equal(findChromium({ platform: 'linux', env: { MOSFETEER_BROWSER: 'default', PATH: '' } }), null);
});

test('request guard accepts loopback editor requests only', () => {
  const hosts = allowedHosts(47280);
  const ok = (headers, api = true) => checkRequest({ headers, api }, hosts) === null;
  assert.equal(ok({ host: '127.0.0.1:47280' }), true);
  assert.equal(ok({ host: 'localhost:47280', origin: 'http://localhost:47280', 'sec-fetch-site': 'same-origin' }), true);
  assert.equal(ok({ host: 'evil.example:47280' }), false);
  assert.equal(ok({ host: '127.0.0.1:47281' }), false);
  assert.equal(ok({ host: '127.0.0.1:47280', origin: 'https://evil.example' }), false);
  assert.equal(ok({ host: '127.0.0.1:47280', origin: 'null' }), false);
  assert.equal(ok({ host: '127.0.0.1:47280', 'sec-fetch-site': 'cross-site' }), false);
  assert.equal(ok({ host: '127.0.0.1:47280', 'sec-fetch-site': 'cross-site' }, false), true, 'pages may be linked to');
  assert.equal(ok({ host: 'evil.example:47280' }, false), false);
});

test('HTTP persistence addresses documents by path and exposes conditional loads', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push([url, options]);
    if (url.startsWith('/api/document?') && options.headers?.['If-None-Match']) {
      return response({}, false, 304, { etag: '"rev-1"', 'x-circuit-revision': 'rev-1' });
    }
    if (url === '/api/document' && JSON.parse(options.body).name === 'taken') {
      return response({ error: 'exists', code: 'exists' }, false, 409);
    }
    return response({ ok: true });
  };
  const persistence = createPersistenceAdapter({ fetchImpl });
  const cached = await persistence.load('/a b/amp.json', { ifNoneMatch: '"rev-1"' });
  assert.equal(cached.notModified, true);
  assert.equal(cached.revision, 'rev-1');
  assert.deepEqual(Object.keys(cached), []);
  await persistence.load('/a b/amp.json', { open: true });
  await persistence.save({ path: '/a b/amp.json' }, { version: 2 }, { overwrite: true });
  await assert.rejects(persistence.save({ name: 'taken' }, {}), (error) => error.code === 'exists' && error.status === 409);
  await persistence.delete('/a b/amp.json');
  await persistence.browse('/a b');
  await persistence.setWorkspace('/work');

  assert.deepEqual(requests.map(([url, options]) => [url, options.method || 'GET']), [
    ['/api/document?path=%2Fa+b%2Famp.json', 'GET'],
    ['/api/document?path=%2Fa+b%2Famp.json&open=1', 'GET'],
    ['/api/document', 'PUT'],
    ['/api/document', 'PUT'],
    ['/api/document?path=%2Fa+b%2Famp.json', 'DELETE'],
    ['/api/browse?dir=%2Fa+b', 'GET'],
    ['/api/workspace', 'PUT'],
  ]);
  assert.deepEqual(JSON.parse(requests[2][1].body), { path: '/a b/amp.json', state: { version: 2 }, overwrite: true });
});

test('browser-only persistence opens JSON, downloads saves, and caches documents', async () => {
  const storageValues = new Map();
  const storage = {
    getItem: (key) => storageValues.get(key) || null,
    setItem: (key, value) => storageValues.set(key, value),
  };
  const state = new Circuit().toJSON();
  const downloads = [];
  const persistence = createBrowserPersistenceAdapter({
    storage,
    windowImpl: {},
    pickOpenFile: async () => ({ name: 'amp.json', text: async () => JSON.stringify(state) }),
    pickSaveFile: async (name) => ({ name: `${name}.json`, handle: null }),
    download: (contents, name, type) => downloads.push({ contents, name, type }),
  });

  const opened = await persistence.pickFile({ mode: 'open' });
  assert.deepEqual(opened, { path: 'browser://amp', name: 'amp', dir: 'Browser downloads' });
  assert.deepEqual((await persistence.load(opened.path)).state, state);

  const changed = { ...state, version: state.version };
  const saved = await persistence.save({ path: opened.path }, changed);
  assert.equal(saved.path, opened.path);
  assert.equal(downloads[0].name, 'amp.json');
  assert.equal(downloads[0].type, 'application/json');
  assert.match(downloads[0].contents, /"version"/);
  assert.deepEqual((await persistence.workspace()).documents.map(({ name }) => name), ['amp']);

  const exported = await persistence.exportFiles({ name: 'amp', formats: ['svg'], svg: '<svg></svg>' });
  assert.deepEqual(exported.paths, ['Browser downloads/amp.svg']);
  assert.equal(downloads[1].name, 'amp.svg');
  let writtenPng = null;
  const pickerPersistence = createBrowserPersistenceAdapter({
    storage,
    windowImpl: {
      showSaveFilePicker: async (options) => {
        assert.equal(options.suggestedName, 'amp.png');
        return {
          createWritable: async () => ({
            write: async (contents) => { writtenPng = contents; },
            close: async () => {},
          }),
        };
      },
    },
  });
  const prepared = await pickerPersistence.prepareExport({ name: 'amp', formats: ['png'] });
  await pickerPersistence.exportFiles({ name: 'amp', formats: ['png'], png: 'data:image/png;base64,iVBORw0KGgo=' }, { prepared });
  assert.equal(writtenPng.type, 'image/png');
  assert.equal(writtenPng.size, 8);
  await assert.rejects(
    persistence.exportFiles({ name: 'amp', formats: ['pdf'], svg: '<svg></svg>' }),
    (error) => error.code === 'unsupported-format',
  );
  await persistence.delete(opened.path);
  assert.deepEqual((await persistence.workspace()).documents, []);
});

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

/** Encode RGBA pixels as a PNG, cycling through every row filter type. */
function encodePng(width, height, pixel) {
  const stride = width * 4;
  const rows = [];
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(stride);
    for (let x = 0; x < width; x += 1) row.set(pixel(x, y), x * 4);
    const filter = y % 5;
    const out = Buffer.alloc(stride + 1);
    out[0] = filter;
    for (let i = 0; i < stride; i += 1) {
      const left = i >= 4 ? row[i - 4] : 0;
      const up = previous[i];
      const upLeft = i >= 4 ? previous[i - 4] : 0;
      const p = left + up - upLeft;
      const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1
        : (Math.abs(p - left) <= Math.abs(p - up) && Math.abs(p - left) <= Math.abs(p - upLeft) ? left : Math.abs(p - up) <= Math.abs(p - upLeft) ? up : upLeft);
      out[i + 1] = (row[i] - predictor) & 0xff;
    }
    rows.push(out);
    previous = row;
  }
  const chunk = (type, body) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
    return Buffer.concat([head, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0)),
  ]);
}

test('raster PDF fallback decodes every PNG filter and writes a valid one-page PDF', () => {
  const pixel = (x, y) => [(x * 37 + y * 11) & 0xff, (x * 5 + y * 90) & 0xff, (x * y) & 0xff, x === 0 && y === 0 ? 0 : 255];
  const png = encodePng(7, 10, pixel);
  const { width, height, rgb } = decodePngToRgb(png);
  assert.equal(width, 7);
  assert.equal(height, 10);
  for (let y = 0; y < 10; y += 1) {
    for (let x = 0; x < 7; x += 1) {
      const expected = x === 0 && y === 0 ? [255, 255, 255] : pixel(x, y).slice(0, 3);
      assert.deepEqual([...rgb.subarray((y * 7 + x) * 3, (y * 7 + x) * 3 + 3)], expected, `${x},${y}`);
    }
  }
  const pdf = pngToPdf(png, { widthPt: 450, heightPt: 225 }).toString('latin1');
  assert.match(pdf, /^%PDF-1\.4/);
  assert.match(pdf, /\/MediaBox \[0 0 450 225\]/);
  assert.match(pdf, /\/Width 7 \/Height 10/);
  const startxref = Number(pdf.match(/startxref\n(\d+)/)[1]);
  assert.equal(pdf.slice(startxref, startxref + 4), 'xref');
  Array.from(pdf.slice(startxref).matchAll(/(\d{10}) 00000 n /g)).forEach((match, index) => {
    const header = `${index + 1} 0 obj`;
    assert.equal(pdf.slice(Number(match[1]), Number(match[1]) + header.length), header);
  });
  assert.throws(() => decodePngToRgb(Buffer.from('nope')), /not a PNG/);
});
