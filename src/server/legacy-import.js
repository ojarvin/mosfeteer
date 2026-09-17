/**
 * One-time migration from the pre-workspace layouts:
 *   - `<repo>/circuits/<name>/circuit.json` (HTTP server storage)
 *   - `<user data>/schematic-spawner/circuits/<name>/circuit.json` (former Electron app)
 * Each name is copied into the workspace as `<name>.schematic.json`, taking the
 * most recently modified copy. Existing workspace files are never overwritten,
 * and the original folders are left untouched.
 */

import { constants } from 'node:fs';
import { copyFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { documentPathFor, validDocumentName } from './documents.js';

export function legacyElectronCircuitsDir({ platform = process.platform, env = process.env, home = homedir() } = {}) {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'schematic-spawner', 'circuits');
  if (platform === 'win32') return join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'schematic-spawner', 'circuits');
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'schematic-spawner', 'circuits');
}

async function legacyCircuits(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !validDocumentName(entry.name)) continue;
    const file = join(root, entry.name, 'circuit.json');
    try {
      const info = await stat(file);
      if (info.isFile()) found.push({ name: entry.name, file, mtimeMs: info.mtimeMs });
    } catch { /* not a circuit folder */ }
  }
  return found;
}

export async function importLegacyCircuits(workspace, sources) {
  const newest = new Map();
  for (const source of sources) {
    for (const circuit of await legacyCircuits(source)) {
      const current = newest.get(circuit.name);
      if (!current || circuit.mtimeMs > current.mtimeMs) newest.set(circuit.name, circuit);
    }
  }
  const imported = [];
  for (const { name, file } of [...newest.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    try {
      await copyFile(file, documentPathFor(workspace, name), constants.COPYFILE_EXCL);
      imported.push(name);
    } catch (error) {
      if (error.code !== 'EEXIST') console.error(`warning: could not import ${file}: ${error.message}`);
    }
  }
  return imported;
}
