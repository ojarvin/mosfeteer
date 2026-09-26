import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { evaluate } from '../src/core/commands.js';
import { findChromium } from '../src/server/browser.js';
import { startApp } from '../src/server/app.js';
import { serverTest, startServer } from './helpers/server.js';

async function command(app, name, cmd) {
  const response = await app.request(`/api/circuits/${name}/cmd`, { method: 'POST', body: { cmd } });
  assert.equal(response.status, 200);
  return response.json();
}

serverTest('documents save by name into the workspace and reopen by path', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());

  const circuit = new Circuit();
  circuit.addComponent('nmosb', { refdes: 'M1', x: 240, y: 240 });
  const state = circuit.toJSON();
  const saved = await app.request('/api/document', { method: 'PUT', body: { name: 'bulk mos', state } });
  assert.equal(saved.status, 200);
  const savedData = await saved.json();
  assert.deepEqual(savedData, { name: 'bulk mos', path: app.file('bulk mos'), dir: app.workspace, kind: 'circuit' });
  assert.ok(saved.headers.get('x-circuit-revision'));
  assert.deepEqual(JSON.parse(await readFile(app.file('bulk mos'), 'utf8')), state);

  const workspace = await (await app.request('/api/workspace')).json();
  assert.equal(workspace.workspace, app.workspace);
  assert.deepEqual(workspace.documents.map(({ revision, ...doc }) => doc), [{ name: 'bulk mos', path: app.file('bulk mos'), dir: app.workspace, kind: 'circuit' }]);
  assert.match(workspace.documents[0].revision, /^[0-9a-z]+-[0-9a-z]+$/);

  const loaded = await (await app.request(`/api/document?path=${encodeURIComponent(app.file('bulk mos'))}`)).json();
  assert.deepEqual(loaded.state, state);
  assert.equal(loaded.name, 'bulk mos');
  assert.equal((await readdir(app.workspace)).some((file) => file.endsWith('.tmp')), false);
});

serverTest('a request body split mid-character keeps its multi-byte label text', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());

  // Labels carry subscripts, \u221e and \u00b7. The body must be decoded as one
  // UTF-8 stream: here the socket delivers a character's bytes in two reads.
  const circuit = new Circuit();
  circuit.addComponent('resistor', { refdes: 'R1', x: 200, y: 200 });
  circuit.addLabel({ text: 'R_{1} \u2225 \u221e \u00b7', anchor: { x: 200, y: 280 } });
  const state = circuit.toJSON();
  const payload = Buffer.from(JSON.stringify({ name: 'split text', state }), 'utf8');
  const marker = payload.indexOf(Buffer.from('\u2225', 'utf8'));
  assert.ok(marker > 0, 'payload should contain the multi-byte label');

  const { request } = await import('node:http');
  const status = await new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1', port: app.port, path: '/api/document', method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length },
    }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    // Split inside the character, then let the first half land on its own.
    req.write(payload.subarray(0, marker + 1));
    setTimeout(() => req.end(payload.subarray(marker + 1)), 50);
  });
  assert.equal(status, 200);

  const roundTripped = JSON.parse(await readFile(app.file('split text'), 'utf8'));
  assert.deepEqual(roundTripped, state);
});

serverTest('saving refuses to replace another file unless asked, and saves anywhere', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());
  const empty = new Circuit().toJSON();
  const changed = new Circuit();
  changed.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });

  assert.equal((await app.request('/api/document', { method: 'PUT', body: { name: 'amp', state: empty } })).status, 200);
  const conflict = await app.request('/api/document', { method: 'PUT', body: { name: 'amp', state: changed.toJSON() } });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, 'exists');
  assert.deepEqual(JSON.parse(await readFile(app.file('amp'), 'utf8')), empty);
  const replaced = await app.request('/api/document', { method: 'PUT', body: { name: 'amp', state: changed.toJSON(), overwrite: true } });
  assert.equal(replaced.status, 200);

  const elsewhere = join(app.root, 'shared', 'project');
  const outside = await app.request('/api/document', { method: 'PUT', body: { dir: elsewhere, name: 'from coworker', state: empty } });
  assert.equal(outside.status, 200);
  assert.equal((await outside.json()).path, join(elsewhere, 'from coworker.json'));
  const recent = (await (await app.request('/api/workspace')).json()).recent;
  assert.deepEqual(recent.map((document) => document.name), ['from coworker']);

  for (const name of ['../escape', 'a/b', '.hidden', '']) {
    const invalid = await app.request('/api/document', { method: 'PUT', body: { name, state: empty } });
    assert.equal(invalid.status, 400, name);
  }
  const relative = await app.request('/api/document?path=relative.json');
  assert.equal(relative.status, 400);
});

serverTest('any JSON document file opens from any folder', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());
  const otherDir = join(app.root, 'circuits', 'old-amp');
  await mkdir(otherDir, { recursive: true });
  const state = new Circuit().toJSON();
  await writeFile(join(otherDir, 'amp.json'), JSON.stringify(state));
  const loaded = await app.request(`/api/document?path=${encodeURIComponent(join(otherDir, 'amp.json'))}&open=1`);
  assert.equal(loaded.status, 200);
  assert.equal((await loaded.json()).name, 'amp');

  await writeFile(join(app.root, 'not-a-document.json'), '{"hello": 1}');
  const rejected = await app.request(`/api/document?path=${encodeURIComponent(join(app.root, 'not-a-document.json'))}`);
  assert.equal(rejected.status, 422);

  const listing = await (await app.request(`/api/browse?dir=${encodeURIComponent(app.root)}`)).json();
  assert.equal(listing.dir, app.root);
  assert.deepEqual(listing.entries.map(({ name, type }) => [name, type]), [
    ['circuits', 'folder'],
    ['data', 'folder'],
    ['workspace', 'folder'],
    ['not-a-document.json', 'json'],
  ]);
});

serverTest('saves a circuit with check issues and explains an outdated symbol registry', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());

  const circuit = new Circuit();
  circuit.addComponent('resistor', { refdes: 'R1', x: 240, y: 240 });
  const state = circuit.toJSON();
  assert.equal(evaluate(circuit).ok, false);
  assert.equal((await app.request('/api/document', { method: 'PUT', body: { name: 'unfinished', state } })).status, 200);
  assert.deepEqual((await (await app.request('/api/circuits/unfinished')).json()).state, state);

  state.components[0].type = 'future_mos';
  const rejected = await app.request('/api/document', { method: 'PUT', body: { name: 'future-symbol', state } });
  assert.equal(rejected.status, 400);
  const { error } = await rejected.json();
  assert.match(error, /unknown component type "future_mos"/);
  assert.match(error, /restart the server after changing the symbol registry/);
});

serverTest('conditional GETs and active revisions skip unchanged documents', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());

  await command(app, 'revisioned', 'add resistor R1');
  const first = await app.request('/api/circuits/revisioned');
  assert.equal(first.status, 200);
  const revision = first.headers.get('x-circuit-revision');
  assert.ok(revision);
  assert.equal(first.headers.get('etag'), `"${revision}"`);
  const active = await app.request('/api/active');
  assert.equal(active.headers.get('x-active-revision'), revision);
  assert.deepEqual(await active.json(), { active: 'revisioned', path: app.file('revisioned') });

  const path = encodeURIComponent(app.file('revisioned'));
  const cached = await app.request(`/api/document?path=${path}`, { headers: { 'If-None-Match': first.headers.get('etag') } });
  assert.equal(cached.status, 304);
  assert.equal(await cached.text(), '');

  const changed = await app.request('/api/circuits/revisioned/cmd', { method: 'POST', body: { cmd: 'add capacitor C1' } });
  assert.equal(changed.status, 200);
  assert.notEqual(changed.headers.get('x-circuit-revision'), revision);
  const refreshed = await app.request(`/api/document?path=${path}`, { headers: { 'If-None-Match': `"${revision}"` } });
  assert.equal(refreshed.status, 200);
  assert.equal((await refreshed.json()).state.components.length, 2);
});

serverTest('DELETE removes only the document file and clears a matching active circuit', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());

  await command(app, 'active-one', 'add resistor');
  const deleted = await app.request(`/api/document?path=${encodeURIComponent(app.file('active-one'))}`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  await assert.rejects(readFile(app.file('active-one')));
  assert.deepEqual(await (await app.request('/api/active')).json(), { active: '', path: '' });

  await command(app, 'kept', 'add resistor');
  await command(app, 'other', 'add resistor');
  const nonActive = await app.request(`/api/document?path=${encodeURIComponent(app.file('kept'))}`, { method: 'DELETE' });
  assert.equal(nonActive.status, 200);
  assert.equal((await (await app.request('/api/active')).json()).active, 'other');
  assert.ok(await readFile(app.file('other')));

  const missing = await app.request(`/api/document?path=${encodeURIComponent(app.file('kept'))}`, { method: 'DELETE' });
  assert.equal(missing.status, 404);
  const notJson = await app.request(`/api/document?path=${encodeURIComponent(app.workspace)}`, { method: 'DELETE' });
  assert.equal(notJson.status, 400);
  for (const name of ['../escape', 'foo bar', 'a.b', '%']) {
    const invalid = await app.request(`/api/circuits/${encodeURIComponent(name)}/cmd`, { method: 'POST', body: { cmd: 'eval' } });
    assert.equal(invalid.status, 400, name);
  }
});

serverTest('the server refuses cross-site and rebinding requests but serves the editor', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());

  const page = await app.request('/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>Mosfeteer<\/title>/);
  // The API can read and write any file the user can, so a script injected
  // through document content must never run in the editor's origin.
  const policy = page.headers.get('content-security-policy');
  assert.match(policy, /default-src 'none'/);
  assert.match(policy, /script-src 'self'/);
  assert.doesNotMatch(policy, /unsafe-eval|script-src[^;]*unsafe-inline/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await app.request('/src/core/model.js')).status, 200);
  assert.equal((await app.request('/package.json')).status, 404);
  assert.equal((await app.request('/src/server/app.js')).status, 404);
  assert.equal((await app.request('/src/web/../../package.json')).status, 404);

  const crossOrigin = await app.request('/api/workspace', { headers: { Origin: 'https://evil.example' } });
  assert.equal(crossOrigin.status, 403);
  const crossSite = await app.request('/api/document', { method: 'PUT', headers: { 'Sec-Fetch-Site': 'cross-site' }, body: { name: 'x', state: new Circuit().toJSON() } });
  assert.equal(crossSite.status, 403);
  const sameOrigin = await app.request('/api/workspace', { headers: { Origin: app.base, 'Sec-Fetch-Site': 'same-origin' } });
  assert.equal(sameOrigin.status, 200);

  // Node's fetch does not let callers override Host; use a raw request.
  const { request } = await import('node:http');
  const status = await new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: app.port, path: '/api/workspace', headers: { Host: `attacker.example:${app.port}` } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(status, 403);
});

// A 1×1 white PNG, standing in for the editor's 4× rendering.
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
const EXPORT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#fff"/><text x="20" y="60">R1</text></svg>';

serverTest('export writes the chosen formats into a folder and asks before replacing', async (t) => {
  const app = await startServer({ env: { MOSFETEER_BROWSER: '/nonexistent/chromium' } });
  t.after(() => app.stop());
  const dir = join(app.root, 'exports', 'figures');
  const body = { dir, name: 'amp', formats: ['svg', 'png', 'pdf'], svg: EXPORT_SVG, png: TINY_PNG };

  const exported = await app.request('/api/export', { method: 'POST', body });
  assert.equal(exported.status, 200);
  const result = await exported.json();
  assert.deepEqual(result.paths, ['svg', 'png', 'pdf'].map((format) => join(dir, `amp.${format}`)));
  assert.equal(await readFile(join(dir, 'amp.svg'), 'utf8'), EXPORT_SVG);
  assert.deepEqual((await readFile(join(dir, 'amp.png'))).subarray(1, 4).toString(), 'PNG');
  const pdf = (await readFile(join(dir, 'amp.pdf'))).toString('latin1');
  assert.match(pdf, /^%PDF-/);
  assert.match(pdf, /\/MediaBox \[0 0 150 75\]/, 'page is the drawing size in points');
  assert.match(result.notes[0], /high-resolution image/);

  const conflict = await app.request('/api/export', { method: 'POST', body: { ...body, formats: ['svg', 'pdf'] } });
  assert.equal(conflict.status, 409);
  const conflictData = await conflict.json();
  assert.equal(conflictData.code, 'exists');
  assert.deepEqual(conflictData.existing, [join(dir, 'amp.svg'), join(dir, 'amp.pdf')]);
  const replaced = await app.request('/api/export', { method: 'POST', body: { ...body, formats: ['svg'], svg: EXPORT_SVG.replace('R1', 'R2'), overwrite: true } });
  assert.equal(replaced.status, 200);
  assert.match(await readFile(join(dir, 'amp.svg'), 'utf8'), /R2/);

  // An image PDF uses its own fallback raster when given one.
  const fallback = await app.request('/api/export', { method: 'POST', body: { dir, name: 'fallback', formats: ['pdf'], svg: EXPORT_SVG, pdfPng: TINY_PNG } });
  assert.equal(fallback.status, 200);
  assert.match((await readFile(join(dir, 'fallback.pdf'))).toString('latin1'), /\/Subtype\s*\/Image/);

  for (const invalid of [{ ...body, name: '../x' }, { ...body, formats: [] }, { ...body, dir: 'relative' }, { ...body, formats: ['png'], png: 'data:text/plain;base64,AA==' }]) {
    assert.equal((await app.request('/api/export', { method: 'POST', body: invalid })).status, 400);
  }
});

serverTest('PDF export is vector output when a Chromium-family browser is installed', async (t) => {
  if (!findChromium()) {
    t.skip('no Chromium-family browser installed');
    return;
  }
  const app = await startServer();
  t.after(() => app.stop());
  const response = await app.request('/api/export', {
    method: 'POST',
    body: { dir: join(app.root, 'exports'), name: 'vector', formats: ['pdf'], svg: EXPORT_SVG, png: TINY_PNG },
  });
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual((await response.json()).notes, []);
  const pdf = (await readFile(join(app.root, 'exports', 'vector.pdf'))).toString('latin1');
  assert.match(pdf, /^%PDF-/);
  assert.doesNotMatch(pdf, /\/Subtype\s*\/Image/, 'vector PDF does not embed the PNG');
});

serverTest('the server listens on loopback only, whatever HOST says', async (t) => {
  // 192.0.2.1 is a documentation address no machine owns: listening there
  // would fail, and listening on a real interface would expose the file API.
  const app = await startServer({ env: { HOST: '192.0.2.1' } });
  t.after(() => app.stop());
  const response = await app.request('/api/health');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');

  const root = await mkdtemp(join(tmpdir(), 'mosfeteer-listen-'));
  const direct = await startApp({ port: 0, dataRoot: join(root, 'data'), workspace: join(root, 'workspace'), log: () => {} });
  t.after(async () => { await direct.close(); await rm(root, { recursive: true, force: true }); });
  assert.equal(direct.server.address().address, '127.0.0.1');
  assert.ok(direct.url.startsWith('http://127.0.0.1:'));
});

serverTest('a server whose code changed on disk refuses to write documents', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'mosfeteer-stale-'));
  let code = 'v1';
  const app = await startApp({ port: 0, dataRoot: join(root, 'data'), workspace: join(root, 'workspace'), log: () => {}, codeVersion: () => code });
  t.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });
  const put = (name) => fetch(`${app.url}api/document`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, state: new Circuit().toJSON() }),
  });
  assert.equal((await put('fresh')).status, 200);

  // The checkout was updated: this process's model is now older than the editor's.
  code = 'v2';
  const refused = await put('stale');
  assert.equal(refused.status, 409);
  assert.match((await refused.json()).error, /relaunch/);
  const cmd = await fetch(`${app.url}api/circuits/stale/cmd`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd: 'add resistor R1' }),
  });
  assert.equal(cmd.status, 409);
  assert.deepEqual((await readdir(join(root, 'workspace'))).sort(), ['fresh.json']);
});
