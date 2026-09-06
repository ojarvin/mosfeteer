#!/usr/bin/env node
/**
 * Thin HTTP client for schematic-spawner.
 *
 *   node src/cli/index.js <circuit> "add nmos M1 --at 120 120"
 *   node src/cli/index.js <circuit> "connect M1.s M2.s --name TAIL\neval"
 *   node src/cli/index.js <circuit>      # interactive REPL bound to <circuit>
 *
 * The CLI sends commands to POST /api/circuits/<name>/cmd and generation
 * requests to POST /api/circuits/<name>/generate. Command mutations write
 * `circuits/<name>/circuit.json` + `circuit.svg`; generation preview is
 * non-mutating and commit writes the generated candidate. The browser polls
 * the active circuit and re-renders automatically.
 *
 * Server is selected with SP_SERVER (default http://127.0.0.1:8080). The
 * command language is the same one the in-browser command prompt uses; see
 * guidelines/CIRCUIT-AUTHOR.md for the reference.
 */

import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';

const SERVER = process.env.SP_SERVER || 'http://127.0.0.1:8080';

function usage() {
  return [
    'schematic-spawner CLI — thin HTTP client over the running server.',
    '',
    'Usage:',
    `  node src/cli/index.js <circuit> "<command>" [<command> ...]`,
    `  node src/cli/index.js <circuit>               # REPL bound to <circuit>`,
    `  node src/cli/index.js <circuit> generate [--preview|--commit] [--file spec.json]`,
    '',
    'Environment:',
    `  SP_SERVER   base URL of the server (default ${SERVER})`,
    '',
    'Examples:',
    `  node src/cli/index.js 5t-ota "add nmos M1 --at 120 120"`,
    `  node src/cli/index.js 5t-ota "connect M1.s M2.s --name TAIL" "eval"`,
    `  node src/cli/index.js ota generate --preview --file ota.json`,
    `  cat ota.json | node src/cli/index.js ota generate --commit`,
    '',
    'Commands hit POST /api/circuits/<circuit>/cmd; generation uses',
    'POST /api/circuits/<circuit>/generate. The browser auto-loads commits.'
  ].join('\n');
}

function isValidName(name) {
  return typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name);
}

async function postCommand(circuit, cmd) {
  const url = `${SERVER}/api/circuits/${encodeURIComponent(circuit)}/cmd`;
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd }),
    });
  } catch (err) {
    throw new Error(`could not reach server at ${SERVER}: ${err.message}`);
  }
  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new Error(`server returned non-JSON (status ${response.status}): ${await response.text().catch(() => '')}`);
  }
  if (!response.ok) {
    const msg = data && data.error ? data.error : `server returned ${response.status}`;
    throw new Error(msg);
  }
  return data;
}

/** Pretty-print one server response. Mutated is summarized in the header. */
function printResponse(data) {
  const header = data.mutated ? `[${data.name}] mutated` : `[${data.name}]`;
  process.stdout.write(`${header}\n`);
  for (const r of data.results || []) {
    if (r.ok) {
      if (r.text) process.stdout.write(`${r.text}\n`);
      if (r.json !== undefined && r.json !== null) process.stdout.write(`__JSON__\n${JSON.stringify(r.json)}\n`);
    } else {
      process.stdout.write(`error: ${r.error}\n`);
    }
  }
}

function printHelpAndExit(code = 0) {
  process.stdout.write(`${usage()}\n`);
  process.exit(code);
}

async function postGeneration(circuit, mode, spec) {
  const url = `${SERVER}/api/circuits/${encodeURIComponent(circuit)}/generate`;
  const request = async (body) => {
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(`could not reach server at ${SERVER}: ${err.message}`);
    }
    const data = await response.json().catch(async () => {
      throw new Error(`server returned non-JSON (status ${response.status}): ${await response.text().catch(() => '')}`);
    });
    if (!response.ok) throw new Error(data?.error || `server returned ${response.status}`);
    return data;
  };
  const preview = await request({ mode: mode === 'commit' ? 'preview' : mode, spec });
  return mode === 'commit' ? request({ mode, previewId: preview.previewId }) : preview;
}

async function readGenerationSpec(file) {
  const source = file && file !== '-' ? await readFile(file, 'utf8') : await new Promise((resolve, reject) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { input += chunk; });
    process.stdin.on('end', () => resolve(input));
    process.stdin.on('error', reject);
  });
  try { return JSON.parse(source); }
  catch (err) { throw new Error(`could not parse generation spec${file ? ` ${file}` : ''}: ${err.message}`); }
}

async function generateOnce(circuit, args) {
  let mode = 'preview';
  let file = null;
  const positionals = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--preview' || arg === '--commit') mode = arg.slice(2);
    else if (arg === '--file') {
      if (!args[++i]) throw new Error('--file expects a path or -');
      file = args[i];
    } else if (arg === '--mode') {
      mode = args[++i];
      if (mode !== 'preview' && mode !== 'commit') throw new Error('--mode must be preview or commit');
    } else if (arg.startsWith('--')) throw new Error(`unknown generation flag ${arg}`);
    else positionals.push(arg);
  }
  if (positionals.length > 1) throw new Error('generate accepts one spec file (or stdin)');
  file ||= positionals[0] || '-';
  const data = await postGeneration(circuit, mode, await readGenerationSpec(file));
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  return data.mutated;
}

async function runOnce(circuit, line) {
  const data = await postCommand(circuit, line);
  printResponse(data);
  return data.mutated;
}

async function runOnceBatch(circuit, lines) {
  let mutated = false;
  for (const line of lines) {
    const lineMutated = await runOnce(circuit, line);
    if (lineMutated) mutated = true;
  }
  return mutated;
}

async function repl(circuit) {
  process.stdout.write(`sch> (${circuit}) server=${SERVER}  type 'help' for commands, 'quit' to exit\n`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.setPrompt('sch> ');
  rl.prompt();
  rl.on('line', async (line) => {
    const s = line.trim();
    if (!s) return rl.prompt();
    if (s === 'quit' || s === 'exit' || s === 'q') return rl.close();
    if (s === 'help' || s === '?') { process.stdout.write(`${usage()}\n`); return rl.prompt(); }
    try {
      await runOnce(circuit, s);
    } catch (err) {
      process.stdout.write(`error: ${err.message}\n`);
    }
    rl.prompt();
  });
  await new Promise((resolve) => rl.on('close', resolve));
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help' || argv[0] === 'help') {
    printHelpAndExit(0);
  }
  const circuit = argv[0];
  if (!isValidName(circuit)) {
    process.stderr.write(`error: invalid circuit name "${circuit}" (must match [A-Za-z0-9][A-Za-z0-9_-]*)\n`);
    process.exit(2);
  }
  const rest = argv.slice(1);
  if (rest.length === 0) return repl(circuit);
  try {
    const mutated = rest[0] === 'generate'
      ? await generateOnce(circuit, rest.slice(1))
      : await runOnceBatch(circuit, rest);
    process.exitCode = mutated ? 0 : 0;
  } catch (err) {
    process.stderr.write(`error: ${err.message}\n`);
    process.exitCode = 1;
  }
}

main();
