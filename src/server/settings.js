/**
 * Per-installation settings, kept with the app (`data/settings.json`, which
 * is gitignored) rather than in a hidden per-user directory. Documents never
 * live here; they live in the workspace folder or wherever the user saved them.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const MAX_RECENT = 12;

/** A visible, conventional default: ~/Documents/Schematics (or ~/Schematics without a Documents folder). */
export function defaultWorkspace(home = homedir()) {
  const documents = join(home, 'Documents');
  return existsSync(documents) ? join(documents, 'Schematics') : join(home, 'Schematics');
}

export function createSettingsStore(file) {
  let settings = { workspace: null, recent: [], legacyImported: false };
  let writes = Promise.resolve();

  const persist = () => {
    const snapshot = JSON.stringify(settings, null, 2);
    writes = writes.catch(() => {}).then(async () => {
      await mkdir(dirname(file), { recursive: true });
      const temp = `${file}.tmp`;
      await writeFile(temp, snapshot);
      await rename(temp, file);
    });
    return writes;
  };

  return {
    async load() {
      try {
        const data = JSON.parse(await readFile(file, 'utf8'));
        settings = {
          workspace: typeof data.workspace === 'string' ? data.workspace : null,
          recent: Array.isArray(data.recent) ? data.recent.filter((path) => typeof path === 'string').slice(0, MAX_RECENT) : [],
          legacyImported: data.legacyImported === true,
        };
      } catch (error) {
        if (error.code !== 'ENOENT') console.error(`warning: could not read ${file}: ${error.message}`);
      }
      return settings;
    },
    get: () => settings,
    async update(patch) {
      settings = { ...settings, ...patch };
      await persist();
      return settings;
    },
    async addRecent(path) {
      const target = resolve(path);
      settings = { ...settings, recent: [target, ...settings.recent.filter((item) => item !== target)].slice(0, MAX_RECENT) };
      await persist();
    },
    async removeRecent(path) {
      const target = resolve(path);
      if (!settings.recent.includes(target)) return;
      settings = { ...settings, recent: settings.recent.filter((item) => item !== target) };
      await persist();
    },
    flush: () => writes,
  };
}
