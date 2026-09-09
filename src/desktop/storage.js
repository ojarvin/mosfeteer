import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadDocument, renderDocument } from '../core/document.js';

export const CIRCUIT_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function validCircuitName(value) {
  const name = String(value || '').trim();
  return CIRCUIT_NAME.test(name) ? name : null;
}

const secureDirectoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const secureFileFlags = constants.O_NOFOLLOW;
const fdRoot = process.platform === 'linux' ? '/proc/self/fd' : process.platform === 'darwin' ? '/dev/fd' : null;

export function createNativeStorage(root, { render = renderDocument } = {}) {
  if (!fdRoot || typeof constants.O_NOFOLLOW !== 'number' || typeof constants.O_DIRECTORY !== 'number') {
    throw new Error('desktop app supports only Linux and macOS');
  }
  const circuitsRoot = resolve(root);
  const fdPath = (handle) => join(fdRoot, String(handle.fd));
  const openDirectory = (path) => open(path, secureDirectoryFlags);
  const openRoot = async (create = false) => {
    try {
      return await openDirectory(circuitsRoot);
    } catch (error) {
      if (!create || error.code !== 'ENOENT') throw error;
      await mkdir(circuitsRoot, { recursive: true });
      return openDirectory(circuitsRoot);
    }
  };
  const openCircuit = async (rootHandle, name, create = false) => {
    const path = join(fdPath(rootHandle), name);
    try {
      return await openDirectory(path);
    } catch (error) {
      if (!create || error.code !== 'ENOENT') throw error;
      await mkdir(path);
      return openDirectory(path);
    }
  };
  const withFile = async (directoryHandle, name, flags, action) => {
    const file = await open(join(fdPath(directoryHandle), name), flags, 0o666);
    try {
      return await action(file);
    } finally {
      await file.close();
    }
  };
  const locks = new Map();
  const withCircuitLock = (name, action) => {
    const previous = locks.get(name);
    const run = (previous || Promise.resolve()).catch(() => {}).then(action);
    locks.set(name, run);
    return run.finally(() => {
      if (locks.get(name) === run) locks.delete(name);
    });
  };

  return {
    async list() {
      let rootHandle;
      try {
        rootHandle = await openRoot();
        const entries = await readdir(fdPath(rootHandle), { withFileTypes: true });
        return {
          circuits: entries
            .filter((entry) => entry.isDirectory() && CIRCUIT_NAME.test(entry.name))
            .map((entry) => entry.name)
            .sort(),
        };
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        return { circuits: [] };
      } finally {
        await rootHandle?.close();
      }
    },

    async load(name) {
      const safe = validCircuitName(name);
      if (!safe) throw new Error('invalid circuit name');
      return withCircuitLock(safe, async () => {
        let rootHandle;
        let circuitHandle;
        try {
          rootHandle = await openRoot();
          circuitHandle = await openCircuit(rootHandle, safe);
          return await withFile(circuitHandle, 'circuit.json', constants.O_RDONLY | secureFileFlags, async (file) => {
            const state = JSON.parse(await file.readFile('utf8'));
            loadDocument(state);
            return { name: safe, state };
          });
        } finally {
          await circuitHandle?.close();
          await rootHandle?.close();
        }
      });
    },

    async save(name, state) {
      const safe = validCircuitName(name);
      if (!safe) throw new Error('invalid circuit name');
      return withCircuitLock(safe, async () => {
        const circuit = loadDocument(state);
        const files = [
          ['circuit.json', JSON.stringify(circuit.toJSON(), null, 2)],
          ['circuit.svg', render(circuit, {
            grid: true, terminals: false, junctions: false, background: true, netNames: true,
          })],
        ];
        let rootHandle;
        let stageHandle;
        let stagePath;
        try {
          rootHandle = await openRoot(true);
          // Validate the existing path without following a symlink before the swap.
          let existing = false;
          try {
            const current = await openCircuit(rootHandle, safe);
            await current.close();
            existing = true;
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
          }
          const stageName = `.${safe}.${randomUUID()}.tmp`;
          const backupName = `.${safe}.${randomUUID()}.old`;
          stagePath = join(fdPath(rootHandle), stageName);
          await mkdir(stagePath);
          stageHandle = await openDirectory(stagePath);
          try {
            for (const [fileName, content] of files) {
              await withFile(stageHandle, fileName, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | secureFileFlags,
                (file) => file.writeFile(content));
            }
          } finally {
            await stageHandle.close();
            stageHandle = null;
          }
          const targetPath = join(fdPath(rootHandle), safe);
          const backupPath = join(fdPath(rootHandle), backupName);
          let replaced = false;
          try {
            if (existing) {
              await rename(targetPath, backupPath);
              replaced = true;
            }
            await rename(stagePath, targetPath);
            stagePath = null;
            if (replaced) await rm(backupPath, { recursive: true, force: true }).catch(() => {});
          } catch (error) {
            if (replaced) await rename(backupPath, targetPath).catch(() => {});
            if (stagePath) await rm(stagePath, { recursive: true, force: true }).catch(() => {});
            throw error;
          }
          return { name: safe, files: ['circuit.json', 'circuit.svg'] };
        } finally {
          await stageHandle?.close();
          if (stagePath) await rm(stagePath, { recursive: true, force: true }).catch(() => {});
          await rootHandle?.close();
        }
      });
    },

    async importFrom(sourceRoot) {
      const source = createNativeStorage(sourceRoot, { render });
      const existing = new Set((await this.list()).circuits);
      const imported = [];
      for (const name of (await source.list()).circuits) {
        if (existing.has(name)) continue;
        const { state } = await source.load(name);
        await this.save(name, state);
        existing.add(name);
        imported.push(name);
      }
      return { circuits: imported };
    },

    async delete(name) {
      const safe = validCircuitName(name);
      if (!safe) throw new Error('invalid circuit name');
      return withCircuitLock(safe, async () => {
        let rootHandle;
        try {
          rootHandle = await openRoot();
          await rm(join(fdPath(rootHandle), safe), { recursive: true, force: false });
          return { name: safe, deleted: true };
        } catch (error) {
          if (error.code === 'ENOENT') throw new Error('circuit not found');
          throw error;
        } finally {
          await rootHandle?.close();
        }
      });
    },
  };
}
