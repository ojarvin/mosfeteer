import { once } from 'node:events';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const ROOT = new URL('..', import.meta.url).pathname;
const SERVER = join(ROOT, 'src/web/serve.js');
const SPEC = { version: 1, motif: 'resistor-divider', components: [{ id: 'R1', type: 'resistor' }, { id: 'R2', type: 'resistor' }], nets: [
  { id: 'in', terminals: ['R1.a'] }, { id: 'out', terminals: ['R1.b', 'R2.a'] }, { id: 'ground', terminals: ['R2.b'] },
] };

async function port() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const value = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return value;
}

async function app(mode = 'success', configured = true) {
  const root = await mkdtemp(join(tmpdir(), 'schematic-spawner-agent-'));
  const agent = join(root, 'agent.mjs');
  await writeFile(agent, `#!/usr/bin/env node
let input=''; process.stdin.on('data', c => input += c); process.stdin.on('end', () => {
    if (process.env.FAKE_AGENT_MODE === 'malformed') return process.stdout.write('{bad');
    if (process.env.FAKE_AGENT_MODE === 'invalid') return process.stdout.write(JSON.stringify({spec:{version:1,motif:'bad',components:[{id:'R1',type:'resistor'}],nets:[{id:'bad',terminals:['R1.nope']}]}}));
    if (process.env.FAKE_AGENT_MODE === 'large') return process.stdout.write('x'.repeat(1100000));
    if (process.env.FAKE_AGENT_MODE === 'timeout') return setTimeout(() => {}, 10000);
    process.stdout.write(JSON.stringify({ explanation: 'structured fake output', spec: ${JSON.stringify(SPEC)} }));
  });`);
  await chmod(agent, 0o755);
  const p = await port();
  const child = spawn(process.execPath, [SERVER], { cwd: ROOT, env: { ...process.env, PORT: String(p), HOST: '127.0.0.1', CIRCUITS_ROOT: join(root, 'circuits'), DATA_ROOT: join(root, 'data'), ACTIVE_FILE: join(root, 'data/active.json'), SCHEMATIC_AGENT: configured ? agent : '', FAKE_AGENT_MODE: mode, SCHEMATIC_AGENT_TIMEOUT_MS: '100' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => { output += chunk; if (output.includes('running at')) resolve(); });
    child.once('error', reject);
    child.once('exit', (code, signal) => reject(new Error(`server exited (${code ?? signal})`)));
  });
  await ready;
  return { base: `http://127.0.0.1:${p}`, root, async stop() { child.kill('SIGTERM'); await once(child, 'exit'); await rm(root, { recursive: true, force: true }); } };
}

async function post(base, path, body) {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

test('agent preview validates structured output and does not mutate the current circuit', async (t) => {
  const a = await app(); t.after(() => a.stop());
  await post(a.base, '/api/circuits/current/cmd', { cmd: 'add resistor' });
  const before = (await fetch(`${a.base}/api/circuits/current`)).json();
  const preview = await post(a.base, '/api/generate', { request: 'make a divider' });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.explanation, 'structured fake output');
  assert.equal(preview.body.spec.motif, SPEC.motif);
  assert.equal(preview.body.spec.nets.length, SPEC.nets.length);
  assert.ok(preview.body.ascii.includes('R1:resistor'));
  assert.equal(JSON.stringify((await before).state), JSON.stringify((await (await fetch(`${a.base}/api/circuits/current`)).json()).state));
});

test('agent commit creates a new circuit and keeps the source circuit', async (t) => {
  const a = await app(); t.after(() => a.stop());
  await post(a.base, '/api/circuits/current/cmd', { cmd: 'add resistor' });
  const preview = await post(a.base, '/api/generate', { request: 'divider' });
  const committed = await post(a.base, '/api/generate/commit', { previewId: preview.body.previewId });
  assert.equal(committed.status, 200);
  assert.notEqual(committed.body.name, 'current');
  assert.equal((await (await fetch(`${a.base}/api/circuits/current`)).json()).name, 'current');
  assert.equal((await (await fetch(`${a.base}/api/circuits/${committed.body.name}`)).json()).name, committed.body.name);
});

test('agent configuration and output failures are clear', async (t) => {
  for (const [mode, text] of [['malformed', 'malformed JSON'], ['large', 'exceeded'], ['timeout', 'timed out']]) {
    const a = await app(mode); t.after(() => a.stop());
    const result = await post(a.base, '/api/generate', { request: 'anything' });
    assert.ok(result.status >= 500, `${mode}: ${result.status}`);
    assert.match(result.body.error, new RegExp(text, 'i'));
  }
});

test('invalid CircuitSpec is rejected at the compiler boundary', async (t) => {
  const a = await app('invalid'); t.after(() => a.stop());
  const result = await post(a.base, '/api/generate', { request: 'invalid?' });
  assert.equal(result.status, 422);
  assert.equal(result.body.code, 'invalid-spec');
});

test('missing agent configuration is reported', async (t) => {
  const a = await app('success', false); t.after(() => a.stop());
  const result = await post(a.base, '/api/generate', { request: 'anything' });
  assert.equal(result.status, 503);
  assert.equal(result.body.code, 'not-configured');
});
