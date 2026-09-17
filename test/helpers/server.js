import { once } from 'node:events';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

export const ROOT = new URL('../..', import.meta.url).pathname;
export const SERVER = join(ROOT, 'src/server/serve.js');

async function unusedPort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      probe.removeListener('error', reject);
      resolve();
    });
  });
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((err) => err ? reject(err) : resolve()));
  return port;
}

// Restricted runners may disallow loopback listeners. Skip server tests there
// rather than surfacing an unhandled native error.
const LOOPBACK_ERROR = await unusedPort().then(() => null, (error) => error);
export const serverTest = LOOPBACK_ERROR
  ? (name, fn) => test(name, { skip: `loopback unavailable${LOOPBACK_ERROR.code ? ` (${LOOPBACK_ERROR.code})` : ''}` }, fn)
  : test;

/** Start `src/server/serve.js` against a temporary workspace and data folder. */
export async function startServer({ env = {} } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'mosfeteer-server-'));
  const workspace = join(root, 'workspace');
  const data = join(root, 'data');
  const port = await unusedPort();
  const child = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), SCHEMATIC_WORKSPACE: workspace, DATA_ROOT: data, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes('Mosfeteer running')) resolve();
    });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.once('error', reject);
    child.once('exit', (code, signal) => reject(new Error(`server exited (${code ?? signal}): ${output}`)));
  });
  const base = `http://127.0.0.1:${port}`;
  return {
    base,
    port,
    root,
    workspace,
    data,
    file: (name) => join(workspace, `${name}.schematic.json`),
    request: (path, { method = 'GET', body, headers = {} } = {}) => fetch(`${base}${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    async stop() {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        await once(child, 'exit');
      }
      await rm(root, { recursive: true, force: true });
    },
  };
}
