import { once } from 'node:events';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { evaluate } from '../src/core/commands.js';

const ROOT = new URL('..', import.meta.url).pathname;
const SERVER = join(ROOT, 'src/web/serve.js');

async function unusedPort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close((err) => err ? reject(err) : resolve()));
  return port;
}

async function startServer() {
  const root = await mkdtemp(join(tmpdir(), 'schematic-spawner-delete-'));
  const circuits = join(root, 'circuits');
  const data = join(root, 'data');
  const active = join(data, 'active.json');
  const port = await unusedPort();
  const child = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      CIRCUITS_ROOT: circuits,
      DATA_ROOT: data,
      ACTIVE_FILE: active,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes('Schematic Spawner running')) resolve();
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => reject(new Error(`server exited (${code ?? signal})`)));
  });
  await ready;

  return {
    base: `http://127.0.0.1:${port}`,
    circuits,
    active,
    async stop() {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        await once(child, 'exit');
      }
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function createCircuit(base, name) {
  const response = await fetch(`${base}/api/circuits/${name}/cmd`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd: 'add resistor' }),
  });
  assert.equal(response.status, 200);
}

test('PUT accepts registered symbols and explains an outdated server registry', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());

  const circuit = new Circuit();
  circuit.addComponent('nmosb', { refdes: 'M1', x: 240, y: 240 });
  const state = circuit.toJSON();
  const saved = await fetch(`${app.base}/api/circuits/bulk-mos`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state }),
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), {
    name: 'bulk-mos',
    files: ['circuit.json', 'circuit.svg'],
  });

  state.components[0].type = 'future_mos';
  const rejected = await fetch(`${app.base}/api/circuits/future-symbol`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state }),
  });
  assert.equal(rejected.status, 400);
  const { error } = await rejected.json();
  assert.match(error, /unknown component type "future_mos"/);
  assert.match(error, /restart the server after changing the symbol registry/);
});

test('saves a circuit with check issues without changing it', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());

  const circuit = new Circuit();
  circuit.addComponent('resistor', { refdes: 'R1', x: 240, y: 240 });
  const state = circuit.toJSON();
  assert.equal(evaluate(circuit).ok, false);
  const saved = await fetch(`${app.base}/api/circuits/unfinished`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state }),
  });
  assert.equal(saved.status, 200);
  const loaded = await (await fetch(`${app.base}/api/circuits/unfinished`)).json();
  assert.deepEqual(loaded.state, state);
});

test('DELETE circuit removes only the circuit and manages active state', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());

  await createCircuit(app.base, 'active-one');
  const deleted = await fetch(`${app.base}/api/circuits/active-one`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { name: 'active-one', deleted: true });
  await assert.rejects(readFile(join(app.circuits, 'active-one', 'circuit.json')));
  assert.deepEqual(await (await fetch(`${app.base}/api/active`)).json(), { active: '' });
  assert.deepEqual(JSON.parse(await readFile(app.active, 'utf8')).active, '');

  await createCircuit(app.base, 'kept-active');
  await createCircuit(app.base, 'other-one');
  const nonActive = await fetch(`${app.base}/api/circuits/kept-active`, { method: 'DELETE' });
  assert.equal(nonActive.status, 200);
  assert.deepEqual(await (await fetch(`${app.base}/api/active`)).json(), { active: 'other-one' });
  assert.deepEqual(JSON.parse(await readFile(app.active, 'utf8')).active, 'other-one');
  await assert.rejects(readFile(join(app.circuits, 'kept-active', 'circuit.json')));
  assert.ok(await readFile(join(app.circuits, 'other-one', 'circuit.json')));

  const missing = await fetch(`${app.base}/api/circuits/kept-active`, { method: 'DELETE' });
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: 'circuit not found' });

  for (const name of ['../escape', 'foo/bar', 'a.b', '%']) {
    const invalid = await fetch(`${app.base}/api/circuits/${encodeURIComponent(name)}`, { method: 'DELETE' });
    assert.equal(invalid.status, 400, name);
    assert.deepEqual(await invalid.json(), { error: 'invalid circuit name' });
  }
  assert.deepEqual(await (await fetch(`${app.base}/api/active`)).json(), { active: 'other-one' });
});
