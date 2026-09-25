import { readFileSync, readdirSync } from 'node:fs';

const WEB = new URL('../../src/web/', import.meta.url);

/**
 * The editor's source text: main.js followed by the modules split out of it
 * (those sharing its state through editor-state.js or calling back into it).
 * Tests that inspect how the editor wires a feature read this, so they keep
 * working when code moves between those files. Split-out modules reach the
 * shared state as `editor.circuit` where main.js says `circuit`; the prefix
 * is dropped so one pattern matches either.
 */
export function editorSource() {
  const parts = [readFileSync(new URL('main.js', WEB), 'utf8')];
  for (const file of readdirSync(WEB).filter((name) => name.endsWith('.js') && name !== 'main.js').sort()) {
    const source = readFileSync(new URL(file, WEB), 'utf8');
    if (/from '\.\/(main|editor-state)\.js'/.test(source)) parts.push(source);
  }
  return parts.join('\n').replace(/\beditor\.(?=[A-Za-z_$])/g, '');
}
