import { readdirSync, watch } from 'node:fs';
import { join } from 'node:path';

export function startDevHotReload({ directories, reload, delay = 100 } = {}) {
  const watchers = new Map();
  let timer;
  let stopped = false;
  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(() => reload(), delay);
  };
  function addDirectory(directory) {
    if (stopped) return;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    watchers.set(directory, watch(directory, { persistent: false }, () => {
      refresh();
      rebuild();
    }));
    for (const entry of entries) {
      if (entry.isDirectory()) addDirectory(join(directory, entry.name));
    }
  }
  function rebuild() {
    for (const watcher of watchers.values()) watcher.close();
    watchers.clear();
    for (const directory of directories || []) addDirectory(directory);
  }
  rebuild();
  return () => {
    stopped = true;
    clearTimeout(timer);
    for (const watcher of watchers.values()) watcher.close();
  };
}
