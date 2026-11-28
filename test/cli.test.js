import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, serverTest, startServer } from './helpers/server.js';

const CLI = join(ROOT, 'src/cli/index.js');

/** The CLI against `app`, run in `cwd`; `input` is its stdin. Resolves
 *  { stdout, code } whatever the exit code. */
function cli(app, args, { cwd = app.root, input = null } = {}) {
  return new Promise((resolve) => {
    const child = execFile(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, SP_SERVER: app.base } }, (error, stdout, stderr) => {
      resolve({ stdout, stderr, code: error ? error.code : 0 });
    });
    if (input !== null) child.stdin.end(input);
    else child.stdin.end();
  });
}

serverTest('a script runs as one batch: blank lines and # comments left out, empty notes lines kept', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());
  const script = join(app.root, 'build.txt');
  await writeFile(script, [
    '# a resistor and its notes',
    'add resistor R1 --at 0 0',
    '',
    'notes set # Divider',
    'notes append',
    'notes append - R1 sets the gain',
    'notes append   - and the noise',
  ].join('\n'));
  const done = await cli(app, ['div', '-f', script]);
  assert.equal(done.code, 0, done.stdout + done.stderr);
  const saved = JSON.parse(await readFile(join(app.workspace, 'div.json'), 'utf8'));
  assert.equal(saved.components.length, 1);
  assert.equal(saved.notes, '# Divider\n\n- R1 sets the gain\n  - and the noise');
  // The same from stdin; a failing line stops the batch (the lines before
  // it stay done) and fails the run.
  const failed = await cli(app, ['div', '-'], { input: 'add resistor R2 --at 400 0\nrm NOPE\nadd resistor R3 --at 800 0\n' });
  assert.equal(failed.code, 1);
  assert.match(failed.stdout, /error: /);
  const parts = JSON.parse(await readFile(join(app.workspace, 'div.json'), 'utf8')).components.map((part) => part.refdes);
  assert.deepEqual(parts.sort(), ['R1', 'R2']);
});

serverTest('notes load sends the file it names; svg FILE is written where the CLI runs', async (t) => {
  const app = await startServer();
  t.after(() => app.stop());
  await writeFile(join(app.root, 'notes.md'), '# Notes\n\nFrom a file.\n');
  const loaded = await cli(app, ['amp', 'add resistor R1 --at 0 0', 'notes load notes.md', 'svg review.svg']);
  assert.equal(loaded.code, 0, loaded.stdout + loaded.stderr);
  assert.match(loaded.stdout, /notes: \d+ lines from notes\.md/);
  assert.match(loaded.stdout, /wrote review\.svg \(\d+ bytes\)/);
  assert.match(await readFile(join(app.root, 'review.svg'), 'utf8'), /^<svg /);
  assert.equal(JSON.parse(await readFile(join(app.workspace, 'amp.json'), 'utf8')).notes, '# Notes\n\nFrom a file.\n');
  // Without a file, the SVG comes in the JSON as before.
  const plain = await cli(app, ['amp', 'svg --json']);
  assert.match(plain.stdout, /"svg":"<svg /);
});
