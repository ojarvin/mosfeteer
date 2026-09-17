/**
 * Identifies the app code a server was started from. The launcher compares it
 * with the checkout on disk so relaunching after an update (for example a
 * `git pull` while the app is open) replaces an outdated server instead of
 * reusing it.
 */

import { createHash } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const CODE_PATHS = ['launch.mjs', join('src', 'server'), join('src', 'core'), join('src', 'web')];

export function codeFingerprint(root) {
  const hash = createHash('sha256');
  const visit = (path) => {
    let info;
    try { info = statSync(path); } catch { return; }
    if (info.isDirectory()) {
      for (const name of readdirSync(path).sort()) visit(join(path, name));
    } else if (info.isFile()) {
      hash.update(`${relative(root, path)}:${info.size}:${Math.trunc(info.mtimeMs)}\n`);
    }
  };
  for (const path of CODE_PATHS) visit(join(root, path));
  return hash.digest('hex').slice(0, 16);
}
