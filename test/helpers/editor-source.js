import { readFileSync, readdirSync } from 'node:fs';

const WEB = new URL('../../src/web/', import.meta.url);

/**
 * The editor's source text: main.js followed by the modules split out of it
 * (those sharing its state through editor-state.js or calling back into it).
 * Tests that inspect how the editor wires a feature read this, so they keep
 * working when code moves between those files. Split-out modules reach the
 * shared state as `editor.circuit` where main.js says `circuit` (and
 * `{ circuit: editor.circuit }` where it says `{ circuit }`); both are
 * folded back so one pattern matches either.
 */
export function editorSource() {
  const parts = [readFileSync(new URL('main.js', WEB), 'utf8')];
  for (const file of readdirSync(WEB).filter((name) => name.endsWith('.js') && name !== 'main.js').sort()) {
    const source = readFileSync(new URL(file, WEB), 'utf8');
    if (/from '\.\/(main|editor-state)\.js'/.test(source)) parts.push(source);
  }
  return parts.join('\n')
    .replace(/\b([A-Za-z_$][\w$]*): editor\.\1\b/g, '$1')
    .replace(/\beditor\.(?=[A-Za-z_$])/g, '');
}

/** One top-level function of the editor's source, from its declaration to its closing brace. */
export function functionSource(name, source = editorSource()) {
  const start = source.search(new RegExp(`(?:^|\\n)(?:export )?(?:async )?function ${name}\\(`));
  if (start < 0) return '';
  const end = source.indexOf('\n}\n', start + 1);
  // Without the export keyword, so a test can evaluate the function alone.
  return source.slice(start, end < 0 ? undefined : end + 2).replace(/^\n?export /, '');
}
