import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { createBrowserPersistenceAdapter } from '../src/web/persistence.js';

const drawing = () => new Circuit().toJSON();
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

/**
 * A small stand-in for the File System Access API: folders of text files,
 * handles that read and write them, and one permission that a reload
 * resets to "prompt" and only a user gesture (`activation`) can grant.
 */
function fakeDisk() {
  let clock = 1;
  const disk = { permission: 'granted', activation: false, requests: 0 };

  class FileHandle {
    constructor(folder, name) {
      this.kind = 'file';
      this.name = name;
      this.folder = folder;
    }

    async getFile() {
      if (disk.permission !== 'granted') throw Object.assign(new Error('not allowed'), { name: 'NotAllowedError' });
      const entry = this.folder.files.get(this.name);
      if (!entry) throw Object.assign(new Error('gone'), { name: 'NotFoundError' });
      return { name: this.name, lastModified: entry.mtime, size: entry.text.length, text: async () => entry.text };
    }

    async createWritable() {
      let buffer = '';
      return {
        write: async (contents) => { buffer += contents; },
        close: async () => { this.folder.files.set(this.name, { text: buffer, mtime: clock += 1 }); },
      };
    }

    async isSameEntry(other) {
      return other.folder === this.folder && other.name === this.name;
    }
  }

  class FolderHandle {
    constructor(name, files = {}) {
      this.kind = 'directory';
      this.name = name;
      this.files = new Map(Object.entries(files).map(([file, text]) => [file, { text, mtime: clock += 1 }]));
    }

    async* values() {
      for (const name of this.files.keys()) yield new FileHandle(this, name);
    }

    async getFileHandle(name, { create = false } = {}) {
      if (!this.files.has(name)) {
        if (!create) throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
        this.files.set(name, { text: '', mtime: clock += 1 });
      }
      return new FileHandle(this, name);
    }

    async removeEntry(name) {
      this.files.delete(name);
    }

    async resolve(handle) {
      return handle.folder === this ? [handle.name] : null;
    }
  }

  for (const Handle of [FileHandle, FolderHandle]) {
    Handle.prototype.queryPermission = async () => disk.permission;
    Handle.prototype.requestPermission = async () => {
      disk.requests += 1;
      if (!disk.activation) throw Object.assign(new Error('User activation is required'), { name: 'SecurityError' });
      disk.permission = 'granted';
      return 'granted';
    };
  }

  disk.folder = (name, files) => new FolderHandle(name, files);
  disk.touch = (folder, name, text) => folder.files.set(name, { text, mtime: clock += 1 });
  return disk;
}

function memoryHandleStore() {
  const values = new Map();
  return {
    values,
    all: async () => [...values.values()],
    put: async (value) => { values.set(value.key, value); },
    delete: async (key) => { values.delete(key); },
  };
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test('without file handles, opened files live for the page only and Save downloads', async () => {
  const storage = memoryStorage();
  const downloads = [];
  const files = [
    { name: 'amp.json', text: async () => JSON.stringify(drawing()) },
    { name: 'bias.json', text: async () => JSON.stringify(drawing()) },
  ];
  const options = {
    storage,
    windowImpl: {},
    handleStore: null,
    pickOpenFile: async () => files,
    download: (contents, name, type) => downloads.push({ contents, name, type }),
  };
  const persistence = createBrowserPersistenceAdapter(options);

  const opened = await persistence.pickFile({ mode: 'open' });
  assert.deepEqual(opened.paths, ['browser://amp.json', 'browser://bias.json']);
  assert.equal(opened.path, 'browser://amp.json');
  assert.deepEqual((await persistence.load(opened.path)).state, drawing());
  assert.deepEqual((await persistence.workspace()).documents.map(({ name }) => name), ['amp', 'bias']);

  const saved = await persistence.save({ path: opened.path }, drawing(), { overwrite: true });
  assert.equal(saved.path, opened.path);
  assert.equal(saved.downloaded, true);
  assert.equal(downloads[0].name, 'amp.json');
  assert.equal(downloads[0].type, 'application/json');
  // Nothing is copied into browser storage, so a reload has no second
  // version of the file to offer.
  assert.equal(storage.values.size, 0);
  assert.deepEqual((await createBrowserPersistenceAdapter(options).workspace()).documents, []);

  const exported = await persistence.exportFiles({ name: 'amp', formats: ['svg'], svg: '<svg></svg>' });
  assert.deepEqual(exported.paths, ['Browser downloads/amp.svg']);
  await assert.rejects(
    persistence.exportFiles({ name: 'amp', formats: ['pdf'], svg: '<svg></svg>' }),
    (error) => error.code === 'unsupported-format',
  );
  assert.equal(persistence.deletesFile(opened.path), false);
  await persistence.delete(opened.path);
  assert.deepEqual((await persistence.workspace()).documents.map(({ name }) => name), ['bias']);
});

test('a document from the old browser cache stays listed until it is saved to a real file', async () => {
  const disk = fakeDisk();
  const target = disk.folder('home');
  const storage = memoryStorage({ 'mosfeteer:browser-documents': JSON.stringify({ amp: drawing() }) });
  const persistence = createBrowserPersistenceAdapter({
    storage,
    windowImpl: {},
    handleStore: memoryHandleStore(),
    pickSaveFile: async () => ({ name: 'amp.json', handle: await target.getFileHandle('amp.json', { create: true }) }),
  });
  assert.deepEqual((await persistence.workspace()).documents.map(({ path }) => path), ['browser://amp']);

  const saved = await persistence.save({ path: 'browser://amp' }, drawing(), { overwrite: true });
  assert.equal(saved.path, 'browser://amp.json');
  assert.equal(saved.downloaded, undefined);
  assert.equal(target.files.get('amp.json').text, json(drawing()));
  assert.equal(storage.values.has('mosfeteer:browser-documents'), false);
  assert.deepEqual((await persistence.workspace()).documents.map(({ path }) => path), ['browser://amp.json']);
});

test('opened files stay linked to disk: Save writes them in place, also after a reload', async () => {
  const disk = fakeDisk();
  const home = disk.folder('home', { 'amp.json': JSON.stringify(drawing()) });
  const handleStore = memoryHandleStore();
  const windowImpl = { showOpenFilePicker: async () => [await home.getFileHandle('amp.json')] };
  const options = { storage: memoryStorage(), windowImpl, handleStore, download: () => assert.fail('nothing is downloaded') };
  const persistence = createBrowserPersistenceAdapter(options);

  const opened = await persistence.pickFile({ mode: 'open' });
  assert.equal(opened.path, 'browser://amp.json');
  // Opening the same file again finds the listed document instead of adding a copy.
  assert.equal((await persistence.pickFile({ mode: 'open' })).path, opened.path);
  assert.equal((await persistence.workspace()).documents.length, 1);

  const loaded = await persistence.load(opened.path, { open: true });
  const edited = { ...loaded.state, tags: ['edited'] };
  const saved = await persistence.save({ path: opened.path }, edited, { overwrite: true });
  assert.equal(home.files.get('amp.json').text, json(edited));
  assert.equal(saved.revision, await persistence.revision(opened.path));

  // After a reload the browser wants permission again: the file is listed
  // as locked, and only an interactive open asks for access.
  disk.permission = 'prompt';
  const reloaded = createBrowserPersistenceAdapter(options);
  assert.deepEqual((await reloaded.workspace()).documents, [{ name: 'amp', path: opened.path, kind: 'circuit', locked: true }]);
  await assert.rejects(reloaded.load(opened.path), (error) => error.code === 'needs-access' && error.mode === 'read');
  assert.equal(disk.requests, 0);
  await assert.rejects(reloaded.load(opened.path, { open: true }), (error) => error.code === 'needs-access' && error.target === 'amp.json');
  disk.activation = true;
  assert.equal(await reloaded.requestAccess(opened.path, 'read'), true);
  assert.deepEqual((await reloaded.load(opened.path, { open: true })).state, edited);

  // Removing it from the list keeps the file.
  assert.equal(reloaded.deletesFile(opened.path), false);
  await reloaded.delete(opened.path);
  assert.deepEqual([...handleStore.values.keys()].filter((key) => key.startsWith('file:')), []);
  assert.ok(home.files.has('amp.json'));
});

test('saving over a file another window changed asks first', async () => {
  const disk = fakeDisk();
  const home = disk.folder('home', { 'amp.json': JSON.stringify(drawing()) });
  const persistence = createBrowserPersistenceAdapter({
    storage: memoryStorage(),
    windowImpl: { showOpenFilePicker: async () => [await home.getFileHandle('amp.json')] },
    handleStore: memoryHandleStore(),
  });
  const { path } = await persistence.pickFile({ mode: 'open' });
  await persistence.load(path, { open: true });
  disk.touch(home, 'amp.json', JSON.stringify({ ...drawing(), tags: ['theirs'] }));
  await assert.rejects(persistence.save({ path }, drawing(), { overwrite: true }), (error) => error.code === 'changed');
  assert.match(home.files.get('amp.json').text, /theirs/);
  await persistence.save({ path }, drawing(), { overwrite: true, force: true });
  assert.equal(home.files.get('amp.json').text, json(drawing()));
  // Having written it, this window may save again without asking.
  await persistence.save({ path }, { ...drawing(), tags: ['mine'] }, { overwrite: true });
});

test('a folder is the workspace: listed, saved into, and deleted from in place', async () => {
  const disk = fakeDisk();
  const designs = disk.folder('designs', {
    'amp.json': JSON.stringify(drawing()),
    'bias.json': JSON.stringify(drawing()),
    'package.json': '{"name": 1, "kind": "block"}',
    'broken.json': '{',
    'notes.txt': 'not a drawing',
    '.hidden.json': JSON.stringify(drawing()),
  });
  const handleStore = memoryHandleStore();
  const options = {
    storage: memoryStorage(),
    windowImpl: {
      showDirectoryPicker: async () => designs,
      showOpenFilePicker: async () => [await designs.getFileHandle('bias.json')],
    },
    handleStore,
  };
  const persistence = createBrowserPersistenceAdapter(options);
  assert.deepEqual(await persistence.pickFile({ mode: 'folder' }), { path: 'designs' });
  const listed = await persistence.setWorkspace('designs');
  assert.equal(listed.workspace, 'designs');
  assert.deepEqual(listed.folder, { name: 'designs', locked: false, writable: true });
  assert.deepEqual(listed.documents.map(({ path }) => path), ['browser://designs/amp.json', 'browser://designs/bias.json']);
  assert.ok(listed.documents.every(({ revision }) => revision));

  // Open file on a file inside the folder names the folder's document.
  assert.equal((await persistence.pickFile({ mode: 'open' })).path, 'browser://designs/bias.json');
  assert.deepEqual((await persistence.workspace()).recent, []);

  const created = await persistence.save({ name: 'mixer' }, drawing());
  assert.equal(created.path, 'browser://designs/mixer.json');
  assert.equal(created.dir, 'designs');
  assert.equal(designs.files.get('mixer.json').text, json(drawing()));
  await assert.rejects(persistence.save({ name: 'amp' }, drawing()), (error) => error.code === 'exists');
  await persistence.save({ name: 'amp' }, drawing(), { overwrite: true });

  assert.equal(persistence.deletesFile(created.path), true);
  await persistence.delete(created.path);
  assert.equal(designs.files.has('mixer.json'), false);

  // A reload finds the folder again, locked until the user allows access.
  disk.permission = 'prompt';
  const reloaded = createBrowserPersistenceAdapter(options);
  const locked = await reloaded.workspace();
  assert.deepEqual(locked.folder, { name: 'designs', locked: true, writable: true });
  assert.deepEqual(locked.documents, []);
  assert.equal(await reloaded.requestAccess(''), false);
  disk.activation = true;
  assert.equal(await reloaded.requestAccess(''), true);
  assert.equal((await reloaded.workspace()).documents.length, 2);
});

test('without a folder picker, a folder is read once and saving downloads', async () => {
  const downloads = [];
  const persistence = createBrowserPersistenceAdapter({
    storage: memoryStorage(),
    windowImpl: {},
    handleStore: null,
    pickFolder: async () => ({ name: 'designs', files: [{ fileName: 'amp.json', state: drawing() }] }),
    download: (contents, name) => downloads.push(name),
  });
  await persistence.pickFile({ mode: 'folder' });
  const listed = await persistence.workspace();
  assert.deepEqual(listed.folder, { name: 'designs', locked: false, writable: false });
  assert.deepEqual(listed.documents.map(({ path }) => path), ['browser://designs/amp.json']);
  assert.equal(persistence.deletesFile('browser://designs/amp.json'), false);
  const saved = await persistence.save({ path: 'browser://designs/amp.json' }, drawing(), { overwrite: true });
  assert.equal(saved.downloaded, true);
  assert.deepEqual(downloads, ['amp.json']);
});

test('dropped files and folders keep their handles', async () => {
  const disk = fakeDisk();
  const designs = disk.folder('designs', { 'amp.json': JSON.stringify(drawing()), 'notes.txt': '' });
  const persistence = createBrowserPersistenceAdapter({ storage: memoryStorage(), windowImpl: {}, handleStore: memoryHandleStore() });
  const item = (handle) => ({ kind: 'file', getAsFileSystemHandle: async () => handle });

  const files = await persistence.openDropped({
    items: [item(await designs.getFileHandle('amp.json')), item(await designs.getFileHandle('notes.txt'))],
    files: [],
  });
  assert.deepEqual(files, { folder: null, paths: ['browser://amp.json'] });
  await persistence.save({ path: 'browser://amp.json' }, { ...drawing(), tags: ['dropped'] }, { overwrite: true });
  assert.match(designs.files.get('amp.json').text, /dropped/);

  const folder = await persistence.openDropped({ items: [item(designs)], files: [] });
  assert.deepEqual(folder, { folder: 'designs', paths: [] });
  assert.deepEqual((await persistence.workspace()).documents.map(({ path }) => path), ['browser://designs/amp.json']);

  // Without handles the dropped file's contents are opened for this page.
  const plain = createBrowserPersistenceAdapter({ storage: memoryStorage(), windowImpl: {}, handleStore: null });
  const dropped = await plain.openDropped({ items: [{ kind: 'file' }], files: [{ name: 'bias.json', text: async () => JSON.stringify(drawing()) }] });
  assert.deepEqual(dropped.paths, ['browser://bias.json']);
});

test('opened files leave the list all at once, keeping the open one', async () => {
  const disk = fakeDisk();
  const home = disk.folder('home', { 'a.json': '{}', 'b.json': '{}', 'c.json': '{}' });
  const handleStore = memoryHandleStore();
  const storage = memoryStorage({ 'mosfeteer:browser-documents': JSON.stringify({ old: drawing() }) });
  const persistence = createBrowserPersistenceAdapter({
    storage,
    windowImpl: { showOpenFilePicker: async () => Promise.all(['a.json', 'b.json', 'c.json'].map((name) => home.getFileHandle(name))) },
    handleStore,
  });
  const { paths } = await persistence.pickFile({ mode: 'open' });
  assert.equal(await persistence.forgetOpened({ keep: paths[1] }), 3);
  assert.deepEqual((await persistence.workspace()).documents.map(({ path }) => path), [paths[1]]);
  assert.deepEqual([...handleStore.values.keys()], [`file:${paths[1]}`]);
  assert.equal(storage.values.has('mosfeteer:browser-documents'), false);
  assert.equal(home.files.size, 3);
});

test('file pickers start next to the file last opened or saved, also after a reload', async () => {
  const disk = fakeDisk();
  const home = disk.folder('home', { 'amp.json': JSON.stringify(drawing()) });
  const handleStore = memoryHandleStore();
  const starts = [];
  const windowImpl = {
    showOpenFilePicker: async (options) => { starts.push(options.startIn); return [await home.getFileHandle('amp.json')]; },
    showSaveFilePicker: async (options) => { starts.push(options.startIn); return home.getFileHandle(options.suggestedName, { create: true }); },
  };
  const options = { storage: memoryStorage(), windowImpl, handleStore };
  const persistence = createBrowserPersistenceAdapter(options);
  const { path } = await persistence.pickFile({ mode: 'open' });
  assert.equal(starts[0], undefined);
  await persistence.load(path, { open: true });

  // A new document's Save asks for a file in the loaded file's folder.
  const saved = await persistence.save({ name: 'mixer' }, drawing());
  assert.equal(starts[1].folder, home);
  assert.equal(saved.path, 'browser://mixer.json');
  assert.ok(home.files.has('mixer.json'));

  await createBrowserPersistenceAdapter(options).pickFile({ mode: 'save', name: 'bias' });
  assert.equal(starts[2].folder, home);
  assert.equal(starts[2].name, 'mixer.json');
});
