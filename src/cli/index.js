#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { Circuit } from '../core/model.js';
import { runCommand } from '../core/commands.js';
import { svgToPng } from '../tools/rasterize.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');

function defaultStateFile() {
  const env = process.env.SP;
  if (env) return resolve(env);
  return resolve(ROOT, 'data/state.json');
}

const io = {
  writeTextFile(p, content) {
    mkdirSync(dirname(resolve(p)), { recursive: true });
    writeFileSync(resolve(p), content);
  },
  readTextFile(p) {
    return readFileSync(resolve(p), 'utf8');
  },
  rasterize(svg, png) {
    return svgToPng(svg, png);
  },
};

function load(p) {
  if (!existsSync(p)) return new Circuit();
  try {
    return Circuit.fromJSON(JSON.parse(readFileSync(p, 'utf8')));
  } catch (err) {
    console.error(`warning: could not load ${p}: ${err.message}`);
    return new Circuit();
  }
}

function persist(p, circuit) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(circuit.toJSON(), null, 2));
}

// Run one command on a circuit; returns {circuit, result}.
function execute(circuit, line) {
  let result;
  try {
    result = runCommand(circuit, line, io);
  } catch (err) {
    return { mutated: false, error: err.message };
  }
  return result;
}

function main() {
  const argv = process.argv.slice(2);
  const stateFile = defaultStateFile();
  const circuit = load(stateFile);

  if (argv.length === 0) {
    // Interactive REPL
    console.log('schematic-spawner CLI. Type a command (help, quit).');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.setPrompt('sch> ');
    rl.prompt();
    let firstError = false;
    rl.on('line', (line) => {
      const s = line.trim();
      if (!s) return rl.prompt();
      if (s === 'quit' || s === 'exit' || s === 'q') {
        rl.close();
        return;
      }
      const r = execute(circuit, s);
      if (r.error) console.log(`error: ${r.error}`);
      else {
        console.log(r.text);
        if (r.mutated) persist(stateFile, circuit);
      }
      rl.prompt();
    });
    rl.on('close', () => process.exit(firstError ? 1 : 0));
    return;
  }

  const r = execute(circuit, argv.join(' '));
  if (r.error) {
    console.error(`error: ${r.error}`);
    process.exitCode = 1;
  } else {
    console.log(r.text);
    if (r.json) console.log('__JSON__\n' + JSON.stringify(r.json));
    if (r.mutated) persist(stateFile, circuit);
  }
}

main();