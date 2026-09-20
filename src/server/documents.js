/**
 * Document files on disk. A document is one self-contained JSON file that can
 * live anywhere: the workspace folder, a project repository, a shared drive.
 * Files saved by the app use the plain `.json` extension. Older
 * `.schematic.json` paths remain readable so existing schematics can be
 * opened and resaved under the canonical name.
 */

import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { documentKind, loadDocument } from '../core/document.js';

export const DOCUMENT_EXTENSION = '.json';
export const LEGACY_DOCUMENT_EXTENSION = '.schematic.json';

const FORBIDDEN_NAME_CHARS = /[/\\:*?"<>|\u0000-\u001f\u007f]/;

/** Names become file names, so reject separators and characters that are invalid on any common OS. */
export function validDocumentName(value) {
  const name = String(value ?? '').trim();
  if (!name || name.length > 120 || name.startsWith('.') || FORBIDDEN_NAME_CHARS.test(name)) return null;
  return name;
}

/** Display name of a document file: its base name without the document extension. */
export function documentNameFromPath(path) {
  const file = basename(path);
  if (file.toLowerCase().endsWith(LEGACY_DOCUMENT_EXTENSION)) return file.slice(0, -LEGACY_DOCUMENT_EXTENSION.length);
  return file.replace(/\.json$/i, '');
}

export function documentPathFor(dir, name) {
  const safe = validDocumentName(name);
  if (!safe) throw Object.assign(new Error('invalid document name'), { status: 400 });
  return join(dir, `${safe}${DOCUMENT_EXTENSION}`);
}

/** Resolve a client-supplied path. Only absolute paths are accepted: the server has no meaningful cwd for users. */
export function absolutePath(value) {
  const path = String(value ?? '');
  if (!path || !isAbsolute(path) || path.includes('\0')) {
    throw Object.assign(new Error('expected an absolute path'), { status: 400 });
  }
  return resolve(path);
}

export function isJsonFile(path) {
  return /\.json$/i.test(path);
}

export async function fileRevision(path) {
  try {
    const info = await stat(path, { bigint: true });
    return `${info.mtimeNs.toString(36)}-${info.size.toString(36)}`;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function readDocumentFile(path) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') throw Object.assign(new Error(`"${basename(path)}" was not found`), { status: 404 });
    if (error.code === 'EISDIR') throw Object.assign(new Error(`"${basename(path)}" is a folder`), { status: 400 });
    throw error;
  }
  let state;
  try {
    state = JSON.parse(text);
  } catch {
    throw Object.assign(new Error(`"${basename(path)}" is not valid JSON`), { status: 422 });
  }
  try {
    loadDocument(state);
  } catch (error) {
    throw Object.assign(new Error(`"${basename(path)}" is not a Mosfeteer document: ${error.message}`), { status: 422 });
  }
  return state;
}

export function serializeDocument(document) {
  return `${JSON.stringify(document.toJSON(), null, 2)}\n`;
}

/**
 * Replace (or create) a file atomically: write a sibling temp file and rename
 * it over the target, so a crash never leaves a half-written document.
 */
export async function writeFileAtomic(path, content, { overwrite = true } = {}) {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  if (!overwrite) {
    try {
      await lstat(path);
      throw Object.assign(new Error(`"${basename(path)}" already exists`), { status: 409, code: 'exists' });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const temp = join(dir, `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, content, { flag: 'wx' });
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true }).catch(() => {});
  }
}

export async function deleteDocumentFile(path) {
  if (!isJsonFile(path)) throw Object.assign(new Error('only .json document files can be deleted'), { status: 400 });
  let entry;
  try {
    entry = await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') throw Object.assign(new Error('document not found'), { status: 404 });
    throw error;
  }
  if (!entry.isFile()) throw Object.assign(new Error('document not found'), { status: 404 });
  await rm(path);
}

async function documentKindOf(path) {
  try {
    const data = JSON.parse(await readFile(path, 'utf8'));
    const kind = documentKind(data);
    loadDocument(data);
    return kind;
  } catch {
    return null;
  }
}

export async function describeDocument(path) {
  return { name: documentNameFromPath(path), path, dir: dirname(path), kind: await documentKindOf(path) };
}

/** Documents saved directly in a folder (not recursive). */
export async function listDocuments(dir) {
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return [];
    throw error;
  }
  const files = entries
    .filter((entry) => !entry.name.startsWith('.') && (entry.isFile() || entry.isSymbolicLink()) && entry.name.toLowerCase().endsWith(DOCUMENT_EXTENSION))
    .map((entry) => join(dir, entry.name));
  const documents = (await Promise.all(files.map(describeDocument))).filter((document) => document.kind);
  return documents.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
}

/** One folder level for the in-app file browser. Hidden entries are omitted. */
export async function browseFolder(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') throw Object.assign(new Error(`folder "${dir}" does not exist`), { status: 404 });
    if (error.code === 'ENOTDIR') throw Object.assign(new Error(`"${dir}" is not a folder`), { status: 400 });
    if (error.code === 'EACCES' || error.code === 'EPERM') throw Object.assign(new Error(`no permission to read "${dir}"`), { status: 403 });
    throw error;
  }
  const items = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    let isDirectory = entry.isDirectory();
    let isFile = entry.isFile();
    if (entry.isSymbolicLink()) {
      try {
        const info = await stat(path);
        isDirectory = info.isDirectory();
        isFile = info.isFile();
      } catch { continue; }
    }
    if (isDirectory) items.push({ name: entry.name, path, type: 'folder' });
    else if (isFile && isJsonFile(entry.name)) {
      const document = await describeDocument(path);
      items.push(document.kind
        ? { ...document, type: 'document' }
        : { name: entry.name, file: entry.name, path, type: 'json' });
    }
  }
  const order = { folder: 0, document: 1, json: 2 };
  items.sort((a, b) => order[a.type] - order[b.type] || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  const parent = dirname(dir);
  return { dir, parent: parent === dir ? null : parent, root: parse(dir).root, entries: items };
}
