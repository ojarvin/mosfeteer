import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { ROOT, serverTest, startServer } from './helpers/server.js';

const CLI = join(ROOT, 'src/cli/index.js');
const fixture = (name) => JSON.parse(readFileSync(join(ROOT, 'fixtures/circuit-spec', `${name}.json`), 'utf8'));

async function generate(base, name, mode, spec) {
  let body = { mode, spec };
  if (mode === 'commit') {
    const preview = await fetch(`${base}/api/circuits/${name}/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'preview', spec }),
    });
    const previewData = await preview.json();
    if (!preview.ok) return { response: preview, data: previewData };
    body = { mode, previewId: previewData.previewId };
  }
  const response = await fetch(`${base}/api/circuits/${name}/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { response, data: await response.json() };
}

const spec = fixture('resistor-divider');

serverTest('the browser and server expose only deterministic generation', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());
  const agents = await fetch(`${app.base}/api/generate/agents`);
  assert.equal(agents.status, 404);
  const legacy = await fetch(`${app.base}/api/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request: 'divider' }),
  });
  assert.equal(legacy.status, 404);
});

serverTest('generation preview is non-mutating and returns a consistent SVG artifact', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());
  const seed = await fetch(`${app.base}/api/circuits/manual/cmd`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd: 'add resistor R0 --at 0 0' }),
  });
  const before = (await seed.json()).state;
  const { response, data } = await generate(app.base, 'manual', 'preview', spec);
  assert.equal(response.status, 200);
  assert.equal(data.mutated, false);
  assert.equal(data.committed, false);
  assert.deepEqual(data.normalizedSpec, data.topology);
  assert.ok(data.candidate.score.length > 0);
  assert.match(data.artifacts.svg, /^<svg/);
  assert.deepEqual(Object.keys(data.artifacts), ['svg']);
  assert.deepEqual((await (await fetch(`${app.base}/api/circuits/manual`)).json()).state, before);
});

serverTest('generation preview includes semantic results without turning them into geometry failures', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());
  const semanticSpec = { ...spec, semantics: { requiredRails: ['missing-rail'], clarifications: [{ question: 'choose the intended supply' }] } };
  const { response, data } = await generate(app.base, 'semantic-preview', 'preview', semanticSpec);
  assert.equal(response.status, 200, JSON.stringify(data));
  assert.equal(data.candidate.report.ok, true);
  assert.equal(data.semantic.errorCount, 1);
  assert.equal(data.semantic.warningCount, 1);
  assert.deepEqual(data.semantic, data.candidate.semantic);
  assert.equal((await fetch(`${app.base}/api/circuits/semantic-preview`)).status, 404);
});

serverTest('generation commit persists a passing candidate under a new name', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());
  const { response, data } = await generate(app.base, 'generated', 'commit', spec);
  assert.equal(response.status, 200, JSON.stringify(data));
  assert.equal(data.mutated, true);
  const saved = await (await fetch(`${app.base}/api/circuits/generated`)).json();
  assert.deepEqual(saved.state, data.state);
  assert.deepEqual(JSON.parse(await readFile(app.file('generated'), 'utf8')), data.state);
  assert.deepEqual(await (await fetch(`${app.base}/api/active`)).json(), { active: 'generated', path: app.file('generated') });
});

serverTest('generation reports malformed input and bounded candidate failures clearly', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());
  const invalid = await generate(app.base, 'bad', 'preview', { version: 1, motif: 'rc-filter', components: [] });
  assert.equal(invalid.response.status, 400);
  assert.match(invalid.data.error, /nets must be supplied together|nets must be an array/);
  const blocked = structuredClone(spec);
  blocked.constraints = { corridors: [{ x: 240, y: -40, w: 160, h: 80, hard: true }] };
  const failed = await generate(app.base, 'blocked', 'preview', blocked);
  assert.equal(failed.response.status, 422);
  assert.equal(failed.data.error, 'generation candidate failed hard checks');
  assert.ok(failed.data.report.errors.length > 0);
  assert.equal((await fetch(`${app.base}/api/circuits/blocked`)).status, 404);

  const existing = await fetch(`${app.base}/api/circuits/guard/cmd`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd: 'add resistor R1 --at 0 0' }),
  });
  const existingState = (await existing.json()).state;
  const rejectedExisting = await generate(app.base, 'guard', 'commit', spec);
  assert.equal(rejectedExisting.response.status, 409);
  assert.equal(rejectedExisting.data.code, 'circuit-exists');
  assert.deepEqual((await (await fetch(`${app.base}/api/circuits/guard`)).json()).state, existingState);
  const rejectedCommit = await generate(app.base, 'guarded-new', 'commit', blocked);
  assert.equal(rejectedCommit.response.status, 422);
  assert.deepEqual((await fetch(`${app.base}/api/circuits/guarded-new`)).status, 404);
});

serverTest('manual command endpoint remains unchanged alongside generation', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());
  const response = await fetch(`${app.base}/api/circuits/manual/cmd`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd: 'add resistor R1 --at 0 0' }),
  });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.mutated, true);
  assert.equal(data.state.components[0].refdes, 'R1');
});

serverTest('command API reports post-delete net state in each result', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());
  const seed = await fetch(`${app.base}/api/circuits/delete-result/cmd`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd: 'add resistor R1 --at 0 0\nadd resistor R2 --at 400 0\nconnect R1.b R2.a' }),
  });
  const seeded = await seed.json();
  assert.equal(seed.status, 200);
  const netId = seeded.state.nets[0].id;
  const response = await fetch(`${app.base}/api/circuits/delete-result/cmd`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd: `net ${netId} segment-rm 0 1` }),
  });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.results[0].mutated, true);
  assert.equal(data.results[0].json, null);
  assert.equal(data.state.nets.length, 0);
});

serverTest('CLI sends a spec file without shell-quoting JSON', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());
  const root = await mkdtemp(join(tmpdir(), 'schematic-spawner-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'spec.json');
  await writeFile(file, JSON.stringify(spec));
  const child = spawn(process.execPath, [CLI, 'cli-preview', 'generate', '--preview', '--file', file], {
    cwd: ROOT, env: { ...process.env, SP_SERVER: app.base }, encoding: 'utf8',
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const [code] = await once(child, 'exit');
  assert.equal(code, 0, stderr);
  const data = JSON.parse(stdout);
  assert.equal(data.mode, 'preview');
  assert.equal(data.mutated, false);
  assert.equal((await fetch(`${app.base}/api/circuits/cli-preview`)).status, 404);

  const stdinChild = spawn(process.execPath, [CLI, 'cli-preview', 'generate', '--commit'], {
    cwd: ROOT, env: { ...process.env, SP_SERVER: app.base },
  });
  let stdinOut = '';
  let stdinErr = '';
  stdinChild.stdout.on('data', (chunk) => { stdinOut += chunk; });
  stdinChild.stderr.on('data', (chunk) => { stdinErr += chunk; });
  stdinChild.stdin.end(JSON.stringify(spec));
  const [stdinCode] = await once(stdinChild, 'exit');
  assert.equal(stdinCode, 0, stdinErr);
  assert.equal(JSON.parse(stdinOut).mode, 'commit');
  assert.equal((await fetch(`${app.base}/api/circuits/cli-preview`)).status, 200);
});
