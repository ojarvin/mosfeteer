/**
 * The open document's life in the editor: new, open, save, save as, and
 * delete; the unsaved-changes prompt; this window's local draft; following
 * the CLI's active document and reloading files changed on disk; and dropped
 * files. Storage itself is behind persistence.js.
 */

import { Circuit, nextSavedNames } from '../core/model.js';
import { createDocument, loadDocument, relinkDocumentState } from '../core/document.js';
import { historyText, textHash } from '../core/save-history.js';
import { createPersistenceAdapter, validDocumentName } from './persistence.js';
import { createWindowSession } from './window-session.js';
import { confirmChoice, showFileDialog } from './file-dialog.js';
import { analysisFormStorageKey } from './analysis-state.js';
import { opensOnAtlas } from './startup.js';
import { circuitSelectEl, circuitNameEl, newDocumentButton, deleteCircuitBtn, revealDocumentBtn, deleteDialog, deleteDialogMessage, switchDialog, switchDialogMessage, exportForm } from './elements.js';
import { dropTutorial } from './onboarding.js';
import { formatModifiedTime, modifiedRefreshMs, revisionTime } from './modified-time.js';
import { hintLine, logLine } from './status-bar-ui.js';
import { carryDeskPlace } from './atlas-layout.js';
import { resetCheckState } from './design-check-ui.js';
import { viewFromCenter, fitView } from './canvas-view.js';
import { clearLatestAnalysisResult, migrateAnalysisFormStorage, analysisFormScope } from './analysis-ui.js';
import { editor } from './editor-state.js';
import { closeToolbarMenu, scheduleToolbarFit, toolbarMenus } from './toolbar-ui.js';
import { applyJson, cancelPreviewTransaction, clearSymmetry, markModelChanged, render, setSelection, snapshot } from './main.js';

export const persistence = createPersistenceAdapter();

/** Replace a button's label, keeping its icon. */
function setButtonText(button, text) {
  for (const node of [...button.childNodes]) if (node.nodeType === Node.TEXT_NODE) node.remove();
  button.append(text);
}

let deleteWording = null;

/** Browser-only mode deletes a workspace-folder document's file, but only
 *  takes a file opened from elsewhere off the list. */
function renderDeleteWording() {
  const forget = persistence.browserOnly && !persistence.deletesFile(editor.currentDocumentPath);
  if (forget === deleteWording) return;
  deleteWording = forget;
  if (deleteCircuitBtn) {
    setButtonText(deleteCircuitBtn, forget ? 'Remove from list…' : 'Delete document…');
    deleteCircuitBtn.title = forget
      ? 'Take the current document off the document list; its file stays on disk'
      : 'Permanently delete the current document file';
  }
}

function configureBrowserOnlyUi() {
  if (!persistence.browserOnly) return;
  // A browser cannot reveal a file in the file manager. The workspace
  // folder comes from the browser's own folder picker.
  document.getElementById('btn-reveal-document')?.setAttribute('hidden', '');
  const workspaceButton = document.getElementById('btn-workspace');
  if (workspaceButton) {
    setButtonText(workspaceButton, 'Open folder…');
    workspaceButton.title = 'Workspace folder';
  }
  const pdf = exportForm?.querySelector('input[name="format"][value="pdf"]');
  if (pdf) {
    pdf.checked = false;
    pdf.disabled = true;
    pdf.closest('label')?.setAttribute('title', 'PDF export is not available in browser-only mode; use the browser print command.');
  }
}

// Each window keeps its own draft and says which document it shows, so two
// windows edit two documents side by side (see window-session.js).
const windowSession = (() => {
  let local = null;
  let session = null;
  try { local = window.localStorage; } catch { /* storage unavailable */ }
  try { session = window.sessionStorage; } catch { /* storage unavailable */ }
  return createWindowSession({ local, session });
})();

export function persistDraft() {
  if (!editor.draftReady || editor.draftTimer || editor.previewTransaction) return;
  editor.draftTimer = setTimeout(flushDraft, 150);
}

export function flushDraft() {
  if (editor.draftTimer) { clearTimeout(editor.draftTimer); editor.draftTimer = null; }
  if (!editor.draftReady) return;
  try {
    // A tab can close during a pointer gesture. Persist only the committed
    // document, never the disposable preview clone.
    const committed = editor.previewTransaction?.baseCircuit || editor.circuit;
    windowSession.writeDraft({
      name: editor.currentCircuitName,
      path: editor.currentDocumentPath,
      dir: editor.currentDocumentDir,
      pendingName: circuitNameEl.value,
      state: committed.toJSON(),
      savedSnapshot: editor.lastSavedSnapshot,
      view: { x: editor.view.x, y: editor.view.y, w: editor.view.w, h: editor.view.h },
    });
  } catch (err) { logLine(`Could not preserve local draft: ${err.message}`, 'error'); }
}

export function restoreDraft() {
  try {
    const draft = JSON.parse(windowSession.draft || 'null');
    if (!draft || !draft.state) {
      editor.lastSavedSnapshot = snapshot();
      return;
    }
    applyJson(JSON.stringify(draft.state), { document: true });
    editor.draftRestored = true;
    editor.currentCircuitName = draft.name || '';
    editor.currentDocumentPath = typeof draft.path === 'string' && draft.path ? draft.path : null;
    editor.currentDocumentDir = typeof draft.dir === 'string' && draft.dir ? draft.dir : null;
    circuitNameEl.value = typeof draft.pendingName === 'string' ? draft.pendingName : editor.currentCircuitName;
    const savedView = draft.view;
    if (savedView && [savedView.x, savedView.y, savedView.w, savedView.h].every(Number.isFinite) && savedView.w > 0 && savedView.h > 0) {
      editor.view = { x: savedView.x, y: savedView.y, w: savedView.w, h: savedView.h };
    }
    editor.lastSavedSnapshot = draft.savedSnapshot || snapshot();
    editor.restoredDraftPath = editor.currentDocumentPath;
    editor.activeSyncSuspended = !editor.currentDocumentPath;
  } catch (err) {
    logLine(`Could not restore local draft: ${err.message}`, 'error');
    editor.lastSavedSnapshot = snapshot();
  }
}

export function displayPath(path) {
  const home = editor.workspaceState?.home;
  return home && path && (path === home || path.startsWith(home + (editor.workspaceState.sep || '/')))
    ? `~${path.slice(home.length)}`
    : path || '';
}

function documentNameForPath(path) {
  const known = [...(editor.workspaceState?.documents || []), ...(editor.workspaceState?.recent || [])].find((document) => document.path === path);
  if (known) return known.name;
  return String(path).split(/[\\/]/).pop().replace(/\.json$/i, '');
}

let documentListHandler = null;

/** Let the Atlas follow a changed document list. The handler resolves true
 *  when it shows the new list itself, so a drop need not open a design. */
export function onDocumentListChange(handler) {
  documentListHandler = handler;
}

async function documentListChanged() {
  return documentListHandler ? !!await documentListHandler() : false;
}

const PICKER_OPEN_FILE = '__open-file__';

const PICKER_WORKSPACE = '__workspace__';

const PICKER_ACCESS = '__access__';

const PICKER_CLEAR = '__clear__';

/** Browser-only group names: a folder workspace, and files opened on their own. */
function documentGroupNames() {
  if (!persistence.browserOnly) return [`Workspace · ${displayPath(editor.workspaceState.workspace)}`, 'Recent elsewhere'];
  const folder = editor.workspaceState?.folder;
  return folder ? [`Folder · ${folder.name}`, 'Other opened files'] : ['Opened files', 'Other opened files'];
}

async function refreshCircuitList() {
  try {
    editor.workspaceState = await persistence.workspace();
  } catch (err) {
    logLine(`Could not list documents: ${err.message}`, 'error');
    return;
  }
  const { documents = [], recent = [], folder = null } = editor.workspaceState;
  // A file the browser needs permission for again is still listed; opening
  // it asks for that permission.
  const label = (document) => (document.locked ? `${document.name} (allow access)` : document.name);
  const known = new Set([...documents, ...recent].map((document) => document.path));
  const recentEntries = editor.currentDocumentPath && !known.has(editor.currentDocumentPath)
    ? [{ name: editor.currentCircuitName || documentNameForPath(editor.currentDocumentPath), path: editor.currentDocumentPath, kind: 'circuit' }, ...recent]
    : recent;
  const [workspaceGroup, elsewhereGroup] = documentGroupNames();
  const groups = [[workspaceGroup, documents], [elsewhereGroup, recentEntries]];
  const lockedFolder = folder?.locked ? folder.name : '';
  // Browser-only: files opened on their own (not the open one) can all be
  // taken off the list at once.
  const clearable = persistence.browserOnly ? (folder ? recent : documents).filter((doc) => doc.path !== editor.currentDocumentPath).length : 0;
  const signature = JSON.stringify([groups.map(([name, items]) => [name, items.map((item) => [label(item), item.path])]), lockedFolder, clearable]);
  if (circuitSelectEl.dataset.signature !== signature) {
    const children = [new Option(documents.length || recentEntries.length ? 'Open document…' : 'No documents yet', '')];
    for (const [name, items] of groups) {
      if (!items.length) continue;
      const group = document.createElement('optgroup');
      group.label = name;
      for (const item of items) {
        const option = new Option(label(item), item.path);
        option.title = item.path;
        group.append(option);
      }
      children.push(group);
    }
    const actions = document.createElement('optgroup');
    actions.label = 'More';
    if (lockedFolder) actions.append(new Option(`Allow access to folder “${lockedFolder}”…`, PICKER_ACCESS));
    actions.append(new Option('Browse for a file… (Ctrl/Cmd+O)', PICKER_OPEN_FILE));
    actions.append(new Option(persistence.browserOnly ? 'Open folder…' : 'Change workspace folder…', PICKER_WORKSPACE));
    if (clearable) actions.append(new Option(`Clear ${folder ? 'other ' : ''}opened files from the list…`, PICKER_CLEAR));
    children.push(actions);
    circuitSelectEl.replaceChildren(...children);
    circuitSelectEl.dataset.signature = signature;
    // Links to other designs resolve against this list (hierarchy.js): the
    // side panel's link dots and any broken bubble look again.
    render();
  }
  circuitSelectEl.value = editor.currentDocumentPath || '';
  circuitSelectEl.title = editor.currentDocumentPath
    ? editor.currentDocumentPath
    : persistence.browserOnly ? 'Open a document file or a folder of documents' : `Open a document from ${editor.workspaceState.workspace}`;
}

/**
 * Run a browser-only file operation, and when the browser needs permission
 * for the file or folder again (after a reload), explain and ask for it once.
 * The explanation's button click is what lets the browser show its prompt.
 */
async function withFileAccess(action) {
  try {
    return await action();
  } catch (err) {
    if (err.code !== 'needs-access') throw err;
    const allow = await confirmChoice({
      title: 'Allow file access?',
      message: `The browser needs your permission again to ${err.mode === 'read' ? 'open' : 'save to'} “${err.target}”. Choose Allow in the browser's prompt that follows; “Allow on every visit” skips this next time.`,
      confirmLabel: 'Continue',
    });
    if (!allow || !await persistence.requestAccess(err.path, err.mode)) {
      throw Object.assign(new Error(`the browser did not allow access to “${err.target}”`), { code: 'canceled' });
    }
    return action();
  }
}

/** Take every file opened on its own off the document list, but the open one. */
async function clearOpenedFiles() {
  const { documents = [], recent = [], folder = null } = editor.workspaceState || {};
  const count = (folder ? recent : documents).filter((doc) => doc.path !== editor.currentDocumentPath).length;
  if (!count) return;
  const keepsOpen = (folder ? recent : documents).some((doc) => doc.path === editor.currentDocumentPath);
  const clear = await confirmChoice({
    title: 'Clear opened files from the list?',
    message: `This takes ${count} opened file${count === 1 ? '' : 's'} off the document list${keepsOpen ? ', keeping the one you are editing' : ''}. The files stay on disk${folder ? `, and folder “${folder.name}” stays open` : ''}.`,
    confirmLabel: 'Clear list',
  });
  if (!clear) return;
  try {
    const removed = await persistence.forgetOpened({ keep: editor.currentDocumentPath });
    circuitSelectEl.dataset.signature = '';
    await refreshCircuitList();
    await documentListChanged();
    logLine(`Took ${removed} file${removed === 1 ? '' : 's'} off the document list; the files stay on disk.`);
  } catch (err) {
    logLine(`Could not clear the document list: ${err.message}`, 'error');
  }
}

export async function allowFolderAccess() {
  const name = editor.workspaceState?.folder?.name || 'the folder';
  if (!await persistence.requestAccess('')) {
    const allow = await confirmChoice({
      title: 'Allow folder access?',
      message: `The browser needs your permission again to use “${name}”. Choose Allow in the browser's prompt that follows; “Allow on every visit” skips this next time.`,
      confirmLabel: 'Continue',
    });
    if (!allow || !await persistence.requestAccess('')) {
      logLine(`The browser did not allow access to “${name}”.`, 'error');
      return;
    }
  }
  circuitSelectEl.dataset.signature = '';
  await refreshCircuitList();
  await documentListChanged();
  logLine(`Opened folder “${name}”.`);
}

export async function restoreStartup() {
  const listPromise = refreshCircuitList();
  const params = new URLSearchParams(window.location.search);
  const openPath = params.get('open');
  if (openPath) window.history.replaceState(null, '', window.location.pathname);
  await listPromise;
  const folder = editor.workspaceState?.folder;
  if (folder?.locked) logLine(`The browser needs permission to open folder “${folder.name}” again: choose “Allow access to folder” in the document list.`);
  if (openPath && openPath !== editor.currentDocumentPath) await openDocumentPath(openPath);
  return opensOnAtlas({ openPath, documents: editor.workspaceState?.documents, browserOnly: persistence.browserOnly });
}

const FOLDER_TIP_KEY = 'mosfeteer:folder-tip';

/** Once per browser, after a design is saved to a file of its own rather
 *  than into a folder: a folder keeps the designs together, and saves
 *  into it ask nothing. */
function folderTipOnce() {
  if (!persistence.browserOnly || editor.workspaceState?.folder) return;
  try {
    if (localStorage.getItem(FOLDER_TIP_KEY)) return;
    localStorage.setItem(FOLDER_TIP_KEY, '1');
  } catch { return; }
  logLine('Tip: open a folder for your designs (Atlas → Open folder…). New designs then save into it without asking, and the Atlas shows them all each visit.');
}

/** Point at the name field: a new design is named before its first save. */
function askForName() {
  hintLine(`Name the design, then press Enter to save it ${newDocumentDestination()}`);
  circuitNameEl.classList.remove('needs-name');
  void circuitNameEl.offsetWidth; // restart the pulse
  circuitNameEl.classList.add('needs-name');
  circuitNameEl.focus();
}

// The text the open design's save history was read against: its file's
// drawing as last read or written (core/save-history.js). A save sends it,
// so a design saved under a new name, or first saved from a dropped file,
// keeps its history. Null when unknown: the writer reads the file instead.
let historyBase = null;

/** The history a write stored, and the drawing it is now read against. */
function adoptWrittenHistory(sent, data) {
  const history = data.history ?? data.state?.history ?? null;
  if (history) editor.circuit.history = history;
  const text = historyText(sent);
  historyBase = !history || history.base === textHash(text) ? text : null;
}

/** The save history's base text, for the history window. */
export function savedHistoryBase() {
  return historyBase;
}

export async function saveCircuit({ saveAs = false } = {}) {
  let name = circuitNameEl.value.trim();
  let target;
  if (saveAs) {
    let choice;
    try {
      choice = await showFileDialog(persistence, {
        mode: 'save',
        dir: editor.currentDocumentDir || editor.workspaceState?.workspace || '',
        name: validDocumentName(name) || editor.currentCircuitName || '',
      });
    } catch (err) {
      logLine(`Could not choose a save file: ${err.message}`, 'error');
      return false;
    }
    if (!choice) return false;
    ({ name } = choice);
    target = choice;
  } else if (editor.currentDocumentPath && name === editor.currentCircuitName) {
    target = { path: editor.currentDocumentPath };
  } else {
    target = { ...(editor.currentDocumentDir ? { dir: editor.currentDocumentDir } : {}), name };
  }
  if (!name && !target.path) {
    // A new design not named yet. Where Save picks a file anyway, its picker
    // asks for the name; elsewhere the name field asks, gently.
    if (persistence.browserOnly && !editor.workspaceState?.folder?.writable && typeof window.showSaveFilePicker === 'function') {
      name = 'untitled';
      target = { name };
    } else {
      askForName();
      return false;
    }
  }
  if (!validDocumentName(name)) {
    logLine('Enter a document name. Names cannot start with "." or contain / \\ : * ? " < > |.', 'error');
    circuitNameEl.focus();
    return false;
  }
  editor.syncGeneration += 1;
  editor.saveInFlight += 1;
  renderSaveState();
  const previousScope = analysisFormScope();
  try {
    const state = editor.circuit.toJSON();
    const saveWith = (options) => withFileAccess(() => persistence.save(target, state, { ...options, savePoint: true, historyBase }));
    let data;
    try {
      data = await saveWith({ overwrite: !!target.path });
    } catch (err) {
      if (err.code !== 'exists' && err.code !== 'changed') throw err;
      const replace = await confirmChoice(err.code === 'exists' ? {
        title: 'Replace existing document?',
        message: `A document named "${name}" already exists in ${displayPath(target.dir || editor.currentDocumentDir || editor.workspaceState?.workspace)}. Replacing it overwrites its contents.`,
        confirmLabel: 'Replace',
        danger: true,
      } : {
        title: 'Overwrite the newer file?',
        message: `"${name}" was changed on disk after this window opened it, by another window or program. Saving replaces that version with this one.`,
        confirmLabel: 'Overwrite',
        danger: true,
      });
      if (!replace) {
        logLine('Save canceled.');
        return false;
      }
      data = await saveWith({ overwrite: true, force: true });
    }
    editor.currentCircuitName = data.name;
    editor.currentDocumentPath = data.path;
    editor.currentDocumentDir = data.dir;
    // The file remembers the names it was saved under; so does the design.
    editor.circuit.savedNames = nextSavedNames(editor.circuit.savedNames, data.name);
    adoptWrittenHistory(state, data);
    editor.activeSyncSuspended = false;
    migrateAnalysisFormStorage(previousScope, analysisFormScope());
    circuitNameEl.value = data.name;
    editor.lastSeenRevision = data.revision || null;
    editor.lastCircuitTag = data.etag || null;
    editor.lastSavedSnapshot = snapshot();
    persistDraft();
    await refreshCircuitList();
    logLine(data.downloaded
      ? `Downloaded ${data.name}.json. This browser cannot write to files in place, so the download is the saved version; open it from there next time.`
      : `Saved ${displayPath(data.path)}.`);
    if (!data.downloaded) folderTipOnce();
    // What follows the file (the history window's save points) reads it again.
    render();
    return true;
  } catch (err) {
    if (err.code === 'canceled') logLine(`Save canceled${err.message === 'save canceled' ? '' : `: ${err.message}`}.`);
    else logLine(`Could not save document: ${err.message}`, 'error');
    return false;
  } finally {
    editor.saveInFlight -= 1;
    editor.syncGeneration += 1;
    renderSaveState();
  }
}

async function loadCircuit(path, quiet = false, options = {}) {
  if (!path) return false;
  const { syncGeneration: expectedGeneration, gate, ...loadOptions } = options;
  try {
    // Only an interactive open may ask the browser for file access again.
    const data = await (loadOptions.open ? withFileAccess(() => persistence.load(path, loadOptions)) : persistence.load(path, loadOptions));
    // The Atlas fetches while it flies, and lets the document in once it
    // lands -- or not at all, when the flight turns back (the gate gives false).
    if (gate && (await gate) === false) return false;
    if (expectedGeneration !== undefined && (editor.saveInFlight || expectedGeneration !== editor.syncGeneration)) return false;
    if (data.notModified) {
      if (data.revision) editor.lastSeenRevision = data.revision;
      if (data.etag) editor.lastCircuitTag = data.etag;
      return true;
    }
    // Sync re-applies the same document after outside edits; only a
    // different one ends the tutorial.
    if (data.path !== editor.currentDocumentPath) dropTutorial();
    // A document owns its undo history. Navigation must not make Undo
    // restore a different document kind.
    editor.history = [];
    editor.future = [];
    applyJson(JSON.stringify(data.state), { document: true });
    historyBase = historyText(data.state);
    clearLatestAnalysisResult();
    setSelection([]);
    editor.cursor = { x: 0, y: 0 };
    editor.currentCircuitName = data.name;
    editor.currentDocumentPath = data.path;
    editor.currentDocumentDir = data.dir;
    editor.activeSyncSuspended = false;
    editor.remoteConflictLogged = false;
    circuitNameEl.value = data.name;
    editor.lastSavedSnapshot = snapshot();
    editor.lastSeenRevision = data.revision || null;
    editor.lastCircuitTag = data.etag || null;
    fitView();
    renderSaveState();
    void refreshCircuitList();
    logLine(`Opened ${displayPath(data.path)}.`);
    return true;
  } catch (err) {
    // A transient load failure (active circuit whose file does not exist yet)
    // is retried by syncActiveCircuit on the next poll — log only the first.
    if (err.code === 'canceled') logLine(`Open canceled: ${err.message}.`);
    else if (!quiet) logLine(`Could not open document: ${err.message}`, 'error');
    return false;
  }
}

/** Open a design's state as a new design not saved yet, after the
 *  unsaved-changes check: a save point started afresh (history-window.js). */
export function openStateAsNewDesign(state, name, message) {
  return new Promise((resolve) => {
    requestDocumentAction('Starting a new design', () => { openUnsavedDocument(state, name, message); resolve(true); }, () => resolve(false));
  });
}

/** Open document contents that have no file path (a dropped file). Saving puts it in the workspace. */
function openUnsavedDocument(state, name, message = null) {
  dropTutorial();
  editor.history = [];
  editor.future = [];
  applyJson(JSON.stringify(state), { document: true });
  historyBase = historyText(state);
  clearLatestAnalysisResult();
  setSelection([]);
  editor.cursor = { x: 0, y: 0 };
  editor.currentCircuitName = '';
  editor.currentDocumentPath = null;
  editor.currentDocumentDir = null;
  editor.activeSyncSuspended = true;
  editor.remoteConflictLogged = false;
  // The server's active document is what it was (see startNewDocument).
  editor.lastSeenRevision = null;
  editor.lastCircuitTag = null;
  circuitNameEl.value = validDocumentName(name) || '';
  circuitSelectEl.value = '';
  editor.lastSavedSnapshot = snapshot();
  fitView();
  renderSaveState();
  persistDraft();
  logLine(message || `Imported "${name}". Save (Ctrl/Cmd+S) to keep it in your workspace, or Save as to choose a folder.`);
}

/** A document as text, without what its windows show: window state is saved
 *  with the design but is no edit, so it never makes the design unsaved. */
function drawingText(text) {
  if (!text || !['"windows"', '"names"', '"mathBox"', '"history"'].some((key) => text.includes(key))) return text;
  try {
    const data = JSON.parse(text);
    // Neither what the windows show, nor the names the file was saved
    // under, nor the size this browser measured a math label at (saved with
    // it so a file reads its size back), nor the save history (the file's,
    // written as it changes: history-window.js) ever make the design unsaved.
    delete data.windows;
    delete data.names;
    delete data.history;
    for (const label of data.labels || []) delete label.mathBox;
    return JSON.stringify(data);
  } catch { return text; }
}

/** Whether the document differs from its file in its windows' state alone. */
function windowsChanged() {
  if (!editor.lastSavedSnapshot || documentChanged()) return false;
  // The windows themselves: what else is left out of documentChanged (the
  // saved names, a math label's measured size) is no reason to write.
  const windowsOf = (text) => {
    try { return JSON.stringify(JSON.parse(text).windows ?? null); } catch { return null; }
  };
  return windowsOf(snapshot()) !== windowsOf(editor.lastSavedSnapshot);
}

/**
 * Write the open design's window state into its file when that is all that
 * changed: the windows follow the design without ever making it unsaved.
 * Done as the design is left or the window hidden. Resolves when written.
 */
export async function saveWindowState() {
  const path = editor.currentDocumentPath;
  if (!path || editor.saveInFlight || !windowsChanged()) return;
  const text = snapshot();
  try {
    editor.syncGeneration += 1;
    const sent = JSON.parse(text);
    const data = await persistence.save({ path }, sent, { overwrite: true, historyBase });
    if (path !== editor.currentDocumentPath) return;
    adoptWrittenHistory(sent, data);
    editor.lastSavedSnapshot = snapshot();
    editor.lastSeenRevision = data.revision || null;
    editor.lastCircuitTag = data.etag || null;
  } catch { /* the windows' state waits for the next save */ } finally {
    editor.syncGeneration += 1;
  }
}

// The toolbar's dirty dot asks on every frame; serializing the document each
// time cost most of a frame on a large drawing. The answer only changes with
// the model (its revision, or a preview's), the document, or a save.
let changedCache = null;

/** Whether the document differs from what was last saved. `cached` reuses
 *  the answer while nothing it depends on changed: for the per-frame dirty
 *  dot, not for deciding whether work would be lost. */
function documentChanged({ cached = false } = {}) {
  const key = { revision: editor.modelRevision, preview: editor.previewRevision, circuit: editor.circuit, saved: editor.lastSavedSnapshot };
  if (cached && changedCache && Object.keys(key).every((field) => changedCache.key[field] === key[field])) return changedCache.changed;
  changedCache = { key, changed: drawingText(snapshot()) !== drawingText(editor.lastSavedSnapshot) };
  return changedCache.changed;
}

export function hasUnsavedChanges({ cached = false } = {}) {
  return documentChanged({ cached }) ||
    (!editor.currentDocumentPath && !!validDocumentName(circuitNameEl.value));
}

let pendingDocumentAction = null;

/** Run an action that replaces the open document, asking first when that would discard unsaved changes. */
export function requestDocumentAction(description, run, cancel = null) {
  if (!hasUnsavedChanges()) {
    // Nothing to lose but what the windows show: that goes to the file first.
    if (windowsChanged()) void saveWindowState().then(run);
    else run();
    return;
  }
  pendingDocumentAction = { run, cancel };
  if (switchDialogMessage) {
    switchDialogMessage.textContent = `"${editor.currentCircuitName || circuitNameEl.value.trim() || 'This design'}" has unsaved changes. Save them before ${description.charAt(0).toLowerCase()}${description.slice(1)}, or discard them?`;
  }
  circuitSelectEl.value = editor.currentDocumentPath || '';
  switchDialog?.showModal();
}

function requestCircuitLoad(path) {
  if (!path) return;
  requestDocumentAction(`Opening "${documentNameForPath(path)}"`, () => loadCircuit(path, false, { open: true }));
}

/** Open a document by path, after the unsaved-changes check. Resolves true
 *  once it is open, false when the load fails or the user keeps editing.
 *  With `gate`, the file is read at once but applied only once it settles
 *  -- not at all when it settles false (resolving false). */
export function openDocumentPath(path, { gate = null } = {}) {
  return new Promise((resolve) => {
    requestDocumentAction(`Opening "${documentNameForPath(path)}"`,
      async () => resolve(await loadCircuit(path, false, { open: true, gate })),
      () => resolve(false));
  });
}

export async function openDocumentDialog() {
  try {
    const choice = await showFileDialog(persistence, { mode: 'open', dir: editor.currentDocumentDir || editor.workspaceState?.workspace || '' });
    if (!choice) return;
    if (choice.paths?.length > 1) {
      circuitSelectEl.dataset.signature = '';
      await refreshCircuitList();
      logLine(`Added ${choice.paths.length} documents to the document list; Shift+Backspace shows them all in the Atlas.`);
    }
    requestCircuitLoad(choice.path);
  } catch (err) {
    logLine(`Could not choose an open file: ${err.message}`, 'error');
  }
}

/** Pick another workspace folder; resolves true once it is the workspace. */
export async function chooseWorkspaceFolder() {
  let choice;
  try {
    choice = await showFileDialog(persistence, { mode: 'folder', dir: editor.workspaceState?.workspace || '' });
  } catch (err) {
    logLine(`Could not choose a folder: ${err.message}`, 'error');
    return false;
  }
  if (!choice) return false;
  try {
    editor.workspaceState = await persistence.setWorkspace(choice.path);
    circuitSelectEl.dataset.signature = '';
    await refreshCircuitList();
    logLine(workspaceFolderMessage());
  } catch (err) {
    logLine(`Could not change the workspace folder: ${err.message}`, 'error');
    return false;
  }
  await documentListChanged();
  return true;
}

/** Browser-only: add picked files to the document list without opening
 *  one; resolves true when any were added. */
export async function addDocumentFiles() {
  let choice;
  try {
    choice = await showFileDialog(persistence, { mode: 'open' });
  } catch (err) {
    logLine(`Could not choose files: ${err.message}`, 'error');
    return false;
  }
  if (!choice) return false;
  circuitSelectEl.dataset.signature = '';
  await refreshCircuitList();
  const count = choice.paths?.length || 1;
  logLine(`Added ${count} document${count === 1 ? '' : 's'} to the document list.`);
  await documentListChanged();
  return true;
}

function workspaceFolderMessage() {
  const workspace = editor.workspaceState;
  if (!persistence.browserOnly) return `Workspace folder is now ${displayPath(workspace.workspace)}. New documents are saved there.`;
  const count = (workspace.documents || []).length;
  const found = `${count} document${count === 1 ? '' : 's'}`;
  return workspace.folder?.writable
    ? `Opened folder “${workspace.folder.name}” (${found}). Saving writes its files in place, and new documents are saved there.`
    : `Read folder “${workspace.folder?.name}” (${found}). This browser cannot write to the folder, so saving downloads a copy.`;
}

async function revealCurrentDocument() {
  if (!editor.currentDocumentPath) return;
  if (persistence.browserOnly) {
    logLine('Browser-only mode cannot reveal files in the operating-system file manager.');
    return;
  }
  try {
    await persistence.reveal(editor.currentDocumentPath);
  } catch (err) {
    logLine(`Could not show the document folder: ${err.message}`, 'error');
  }
}

/** Where Save puts a document that has no file yet. */
/** What a new design says first: name it, press Enter, and where it goes. */
function newDesignMessage() {
  const folder = editor.workspaceState?.folder;
  if (!persistence.browserOnly) return 'New design: name it and press Enter to save it in the workspace folder.';
  if (folder?.writable) return `New design: name it and press Enter to save it in “${folder.name}”.`;
  if (typeof window.showSaveFilePicker !== 'function') return 'New design: name it and press Enter to download it (this browser cannot save in place).';
  return 'New design: name it and press Enter, then choose where it goes. A folder opened in the Atlas keeps designs together and saves without asking.';
}

function newDocumentDestination() {
  if (!persistence.browserOnly) return 'to the workspace folder';
  const folder = editor.workspaceState?.folder;
  if (folder?.writable) return `to folder “${folder.name}”`;
  return typeof window.showSaveFilePicker === 'function' ? 'to a file you choose' : 'as a browser download';
}

/** The name a save would copy the open design to: the name field's, when
 *  it differs from the design's own (not while renaming), else null. */
function savesAsCopy() {
  const typed = circuitNameEl.value.trim();
  return editor.currentDocumentPath && !renaming && typed && typed !== editor.currentCircuitName ? typed : null;
}

export function renderSaveState() {
  const dirty = hasUnsavedChanges({ cached: true });
  // Fitting measures the toolbar at each compaction stage (a forced layout
  // apiece), so refit only when the title or dirty dot can change its width;
  // the toolbar's ResizeObserver covers everything else.
  const fitKey = `${circuitNameEl.value}|${circuitNameEl.placeholder}|${dirty}`;
  if (fitKey !== editor.toolbarFitKey) {
    editor.toolbarFitKey = fitKey;
    scheduleToolbarFit();
  }
  const dirtyDot = document.getElementById('dirty-dot');
  if (dirtyDot) dirtyDot.hidden = !dirty;
  renderModifiedTime(dirty);
  if (deleteCircuitBtn) deleteCircuitBtn.disabled = !editor.currentDocumentPath || editor.deleteInFlight;
  if (revealDocumentBtn) revealDocumentBtn.disabled = persistence.browserOnly || !editor.currentDocumentPath;
  const renameButton = document.getElementById('btn-rename-document');
  if (renameButton) renameButton.disabled = !canRenameDocument() || editor.saveInFlight > 0;
  circuitNameEl.title = editor.currentDocumentPath ? `Design name · ${editor.currentDocumentPath}` : 'Design name';
  renderDeleteWording();
  const saveButton = document.getElementById('btn-save');
  if (saveButton) {
    // A new name typed for a saved design: Save (as Ctrl+S) makes a copy under it.
    const copyName = savesAsCopy();
    saveButton.disabled = !(dirty || copyName) || editor.saveInFlight > 0;
    saveButton.title = copyName ? `Save as a copy named “${copyName}” (Ctrl/Cmd+S)`
      : dirty ? `Save (Ctrl/Cmd+S) · unsaved changes${editor.currentDocumentPath ? ` to ${editor.currentDocumentPath}` : ''}`
        : editor.currentDocumentPath ? `Saved · ${editor.currentDocumentPath}` : 'Save (Ctrl/Cmd+S)';
  }
}

// ----- last modified ---------------------------------------------------------------

// The model revision the last edit was seen at, and when.
let editedRevision = null;
let editedAt = null;
let modifiedTimer = 0;

/** When the document last changed: the latest edit while there are unsaved
 *  ones, else the file's own time (the last save, from here or elsewhere). */
function documentModifiedAt(dirty) {
  if (!dirty) {
    editedRevision = null;
    editedAt = null;
  } else if (editor.modelRevision !== editedRevision) {
    editedRevision = editor.modelRevision;
    editedAt = Date.now();
  }
  return dirty && editedAt !== null ? editedAt : revisionTime(editor.lastSeenRevision);
}

/** The status bar's quiet "modified … ago" chip, kept current by a timer. */
function renderModifiedTime(dirty = hasUnsavedChanges({ cached: true })) {
  const chip = document.getElementById('status-modified');
  if (!chip) return;
  const at = documentModifiedAt(dirty);
  const text = at === null ? '' : `${dirty ? 'edited' : 'saved'} ${formatModifiedTime(at)}`;
  if (chip.textContent !== text) {
    chip.textContent = text;
    chip.hidden = !text;
    chip.title = at === null ? '' : `${dirty ? 'Last edit (not saved yet)' : 'Last saved'}: ${new Date(at).toLocaleString()}`;
  }
  if (at !== null && !modifiedTimer) {
    modifiedTimer = setTimeout(() => {
      modifiedTimer = 0;
      renderModifiedTime();
    }, modifiedRefreshMs(at));
  }
}

// ----- rename --------------------------------------------------------------------

/** Whether the open document's file can be renamed: it has one, and this
 *  storage can remove the old file (browser-only mode needs a writable
 *  folder). */
function canRenameDocument() {
  const path = editor.currentDocumentPath;
  return !!path && (!persistence.browserOnly || persistence.deletesFile(path));
}

let renaming = false;

/** Rename document…: the name field takes the new name; Enter renames the
 *  file, Escape (or leaving the field) keeps the old one. */
function beginDocumentRename() {
  for (const [button, menu] of toolbarMenus) closeToolbarMenu(button, menu);
  if (!canRenameDocument()) {
    logLine(editor.currentDocumentPath ? 'This document\'s file cannot be renamed here: open its folder as the workspace first.' : 'Save the document first; then it can be renamed.', 'error');
    return;
  }
  renaming = true;
  circuitNameEl.classList.add('renaming');
  circuitNameEl.value = editor.currentCircuitName || circuitNameEl.value;
  circuitNameEl.focus();
  circuitNameEl.select();
  hintLine('RENAME: type the new name · Enter renames the file · Esc keeps the old name');
}

function endDocumentRename() {
  renaming = false;
  circuitNameEl.classList.remove('renaming');
  circuitNameEl.value = editor.currentCircuitName || '';
  renderSaveState();
}

/**
 * Rename the open document's file to `name`, next to where it is: its saved
 * content is written under the new name, then the old file goes. Unsaved
 * edits stay unsaved. A name already taken is refused.
 */
/** The editor's rename (the name field, More → Rename document…): the
 *  open design's file, in its folder. */
async function renameDocument(name) {
  return !!await renameDesign(editor.currentDocumentPath, name, { dir: editor.currentDocumentDir });
}

/**
 * Rename a design's file: saved under `name` beside it (in `dir`), the old
 * file removed, its place on the Atlas carried over, and every other design
 * linking to it relinked (relinkWorkspace). The open design's own state
 * follows when it is the one renamed; its unsaved changes stay unsaved.
 * The editor's rename and the Atlas's listing both rename this way.
 * Resolves the saved document ({ name, path, dir }), or null.
 */
export async function renameDesign(oldPath, name, { dir = null } = {}) {
  const current = !!oldPath && oldPath === editor.currentDocumentPath;
  const oldName = current ? editor.currentCircuitName : documentNameForPath(oldPath);
  if (!oldPath || name === oldName) return null;
  if (!validDocumentName(name)) {
    logLine('Enter a document name. Names cannot start with "." or contain / \\ : * ? " < > |.', 'error');
    return null;
  }
  editor.syncGeneration += 1;
  editor.saveInFlight += 1;
  renderSaveState();
  const previousScope = current ? analysisFormScope() : null;
  try {
    const saved = await withFileAccess(() => persistence.load(oldPath));
    let data;
    try {
      data = await withFileAccess(() => persistence.save({ ...(dir ? { dir } : {}), name }, saved.state, { overwrite: false }));
    } catch (err) {
      if (err.code !== 'exists') throw err;
      logLine(`A document named "${name}" already exists there; pick another name.`, 'error');
      return null;
    }
    await withFileAccess(() => persistence.delete(oldPath));
    if (current) {
      editor.circuit.savedNames = nextSavedNames(editor.circuit.savedNames, data.name);
      editor.currentCircuitName = data.name;
      editor.currentDocumentPath = data.path;
      editor.currentDocumentDir = data.dir;
      editor.activeSyncSuspended = false;
      migrateAnalysisFormStorage(previousScope, analysisFormScope());
      editor.lastSeenRevision = data.revision || null;
      editor.lastCircuitTag = data.etag || null;
      circuitNameEl.value = data.name;
      persistDraft();
    }
    carryDeskPlace(oldPath, data.path);
    await refreshCircuitList();
    logLine(`Renamed ${displayPath(oldPath)} to ${displayPath(data.path)}.`);
    await relinkWorkspace(oldName, data.name, data.path);
    return data;
  } catch (err) {
    if (err.code === 'canceled') logLine('Rename canceled.');
    else logLine(`Could not rename the document: ${err.message}`, 'error');
    return null;
  } finally {
    editor.saveInFlight -= 1;
    editor.syncGeneration += 1;
    renderSaveState();
  }
}

/** A design renamed from `from` to `to`: every other known document whose
 *  parts link to `from` is saved linking to `to`, unless another design is
 *  still called `from` (the links then still find one). */
async function relinkWorkspace(from, to, renamedPath) {
  const known = [...(editor.workspaceState?.documents || []), ...(editor.workspaceState?.recent || [])]
    .filter((doc) => (doc.kind === 'circuit' || !doc.kind) && !doc.missing && !doc.locked);
  if (known.some((doc) => doc.name === from && doc.path !== renamedPath)) return;
  const relinked = [];
  for (const doc of known) {
    if (doc.path === renamedPath || relinked.includes(doc.name)) continue;
    try {
      const loaded = await persistence.load(doc.path);
      if (!relinkDocumentState(loaded.state, from, to)) continue;
      await persistence.save({ path: doc.path }, loaded.state, { overwrite: true, force: true });
      relinked.push(doc.name);
    } catch (err) {
      logLine(`Could not update the links in ${doc.name}: ${err.message}`, 'error');
    }
  }
  if (relinked.length) {
    logLine(`Links to ${from} now name ${to} in ${relinked.join(', ')}.`);
    await refreshCircuitList();
  }
}

/** The open design's file is gone: the editor starts a blank one. */
async function clearDeletedCurrent() {
  editor.history = [];
  editor.future = [];
  cancelPreviewTransaction();
  dropTutorial();
  editor.circuit = new Circuit();
  clearLatestAnalysisResult();
  markModelChanged(false);
  resetCheckState();
  editor.wire = null;
  editor.terminalSnap = false;
  clearSymmetry();
  editor.drag = null;
  editor.moveMode = null;
  editor.copyMode = false;
  editor.deleteMode = false;
  editor.alignTool = null;
  editor.movePending = false;
  editor.copyPending = false;
  editor.pendingPlace = null;
  clearSymmetry();
  editor.labelMode = null;
  editor.annotationPoints = [];
  setSelection([]);
  editor.selectedNets.clear();
  editor.cursor = { x: 0, y: 0 };
  editor.view = viewFromCenter(0, 0);
  editor.currentCircuitName = '';
  editor.currentDocumentPath = null;
  editor.currentDocumentDir = null;
  editor.activeSyncSuspended = true;
  circuitNameEl.value = '';
  circuitSelectEl.value = '';
  editor.lastSavedSnapshot = snapshot();
  lastSeenActive = null;
  lastFailedActive = null;
  editor.lastSeenRevision = null;
  editor.lastCircuitTag = null;
  editor.restoredDraftPath = null;
  editor.remoteConflictLogged = false;
  windowSession.clearDraft();
  render();
}

let pendingDelete = null; // { paths, resolve }: what the delete dialog asks about

/** Delete designs (by path) after the delete dialog confirms: their files
 *  go (or, browser-only without a folder, they leave the list), and the
 *  open one among them leaves the editor blank. Resolves true when any
 *  went, false when canceled. */
export function deleteDocuments(paths) {
  const list = [...new Set(paths)].filter(Boolean);
  if (!list.length || !deleteDialog || editor.deleteInFlight || pendingDelete) return Promise.resolve(false);
  const forget = persistence.browserOnly && list.some((path) => !persistence.deletesFile(path));
  const what = list.length === 1 ? displayPath(list[0]) : `${list.length} designs: ${list.map(documentNameForPath).join(', ')}`;
  const unsaved = list.includes(editor.currentDocumentPath) && hasUnsavedChanges()
    ? ' and discards the open design\'s unsaved changes' : '';
  deleteDialogMessage.textContent = forget
    ? `This takes ${what} off the document list${unsaved}. The files stay on disk.`
    : `This permanently deletes ${what}${unsaved}. This cannot be undone.`;
  const title = document.getElementById('delete-dialog-title');
  if (title) title.textContent = forget ? 'Remove from the list?' : list.length === 1 ? 'Delete document file?' : `Delete ${list.length} document files?`;
  const confirm = document.getElementById('confirm-delete');
  if (confirm) setButtonText(confirm, forget ? 'Remove from list' : list.length === 1 ? 'Delete file' : 'Delete files');
  deleteDialog.showModal();
  return new Promise((resolve) => { pendingDelete = { paths: list, resolve, forget }; });
}

async function runDelete(paths, forget) {
  editor.deleteInFlight = true;
  renderSaveState();
  const done = [];
  try {
    for (const path of paths) {
      try {
        await withFileAccess(() => persistence.delete(path));
        done.push(path);
        if (path === editor.currentDocumentPath) await clearDeletedCurrent();
      } catch (err) {
        logLine(`Could not delete ${documentNameForPath(path)}: ${err.message}`, 'error');
      }
    }
    await refreshCircuitList();
    const names = done.map((path) => `"${documentNameForPath(path)}"`).join(', ');
    if (done.length) logLine(forget ? `Removed ${names} from the document list; the files stay on disk.` : `Deleted ${names}.`);
  } finally {
    editor.deleteInFlight = false;
    renderSaveState();
  }
  return done.length > 0;
}

function askDeleteCircuit() {
  if (editor.currentDocumentPath) void deleteDocuments([editor.currentDocumentPath]);
}

let lastSeenActive = null;

let lastFailedActive = null; // active circuit path whose load failed (retry silently)

async function syncActiveCircuitOnce() {
  if (!persistence.liveSync) return;
  windowSession.touch({ path: editor.currentDocumentPath, hidden: document.hidden });
  const generation = editor.syncGeneration;
  // First, follow the server's "active circuit" — the CLI drives it, the
  // browser mirrors it. Only auto-load on a CHANGE of the server's active
  // circuit (lastSeenActive), not on every poll where it merely differs from
  // the open document — otherwise a manual open gets clobbered by the next tick.
  let active = null;
  let activeRevision = null;
  let activeResponseSucceeded = false;
  try {
    const data = await persistence.active();
    if (typeof data.active === 'string') {
      active = data.active ? data.path : '';
      activeRevision = data.revision || null;
      activeResponseSucceeded = true;
    }
  } catch {
    // server restart — keep going with the content sync below
  }

  if (editor.saveInFlight || generation !== editor.syncGeneration) return;

  if (editor.activeSyncSuspended) {
    // Consume the current active identity while the explicit blank/dropped
    // document owns the editor. This prevents the next poll from treating an
    // already-active file as a change and replacing the unsaved document.
    if (activeResponseSucceeded) {
      lastSeenActive = active;
      editor.lastSeenRevision = activeRevision;
      lastFailedActive = null;
    }
    return;
  }

  // Seed the active revision without replacing the restored local draft.
  if (activeResponseSucceeded && editor.restoredDraftPath && editor.currentDocumentPath === editor.restoredDraftPath) {
    lastSeenActive = active;
    editor.lastSeenRevision = activeRevision;
    editor.restoredDraftPath = null;
    return;
  }
  if (activeResponseSucceeded && editor.restoredDraftPath && editor.currentDocumentPath !== editor.restoredDraftPath) {
    editor.restoredDraftPath = null;
  }

  // With several windows open, the CLI's new active document goes to one of
  // them: none when a window already shows it, else the most recently
  // focused. The others keep their documents.
  if (active !== lastSeenActive && active && active !== editor.currentDocumentPath
    && (windowSession.otherWindowShows(active) || !windowSession.leadsActiveSync())) {
    lastSeenActive = active;
    lastFailedActive = null;
  }
  if (active !== lastSeenActive) {
    // The server only sends a revision for an active circuit whose file exists.
    // Wait silently for a missing one (not yet written, or deleted) instead of
    // requesting it and reporting a load error on every poll.
    if (active && active !== editor.currentDocumentPath && activeResponseSucceeded && !activeRevision) return;
    if (active && active !== editor.currentDocumentPath) {
      // A failed load must NOT advance lastSeenActive — otherwise the poll
      // would never retry once the file appears.
      const quietRetry = active === lastFailedActive;
      await loadCircuit(active, quietRetry, { syncGeneration: generation });
      if (editor.currentDocumentPath === active) {
        lastSeenActive = active;
        lastFailedActive = null;
      } else {
        lastFailedActive = active;
      }
      return; // loadCircuit already re-rendered + fit (or logged the failure)
    }
    lastSeenActive = active;
  }
  if (!editor.currentDocumentPath) return;
  // Avoid a document GET and model parse when the active revision is unchanged.
  if (active === editor.currentDocumentPath && activeRevision && activeRevision === editor.lastSeenRevision) return;
  try {
    const data = await persistence.load(editor.currentDocumentPath, { ifNoneMatch: editor.lastCircuitTag });
    if (editor.saveInFlight || generation !== editor.syncGeneration) return;
    if (data.notModified) {
      if (data.revision) editor.lastSeenRevision = data.revision;
      if (data.etag) editor.lastCircuitTag = data.etag;
      return;
    }
    // The model normalizes loaded state (notably reducible net geometry), so
    // compare and record the canonical representation rather than the raw
    // JSON on disk. Otherwise a clean design can become permanently dirty
    // after the first poll of a normalized save.
    const remoteSnapshot = JSON.stringify(loadDocument(data.state).toJSON());
    const remoteRevision = data.revision || activeRevision;
    const remoteTag = data.etag || editor.lastCircuitTag;
    const currentSnapshot = snapshot();
    editor.lastSeenRevision = remoteRevision || null;
    editor.lastCircuitTag = remoteTag || null;
    if (remoteSnapshot === currentSnapshot) return;
    // Only what the windows show differs -- this window's own window-state
    // save coming back, as often as not: the drawing is the same, so keep
    // what is open rather than reload it under the user.
    if (drawingText(remoteSnapshot) === drawingText(currentSnapshot)) {
      // Another window's checkpoint, say: the file's history is the one to keep.
      const remoteHistory = JSON.parse(remoteSnapshot).history ?? null;
      editor.circuit.history = remoteHistory;
      historyBase = historyText(data.state);
      return;
    }
    if (drawingText(currentSnapshot) !== drawingText(editor.lastSavedSnapshot)) {
      if (!editor.remoteConflictLogged) {
        logLine(`${editor.currentCircuitName} changed on disk, but this window has unsaved changes. Saving will overwrite the other version.`, 'error');
        editor.remoteConflictLogged = true;
      }
      return;
    }
    applyJson(remoteSnapshot, { document: true });
    historyBase = historyText(data.state);
    editor.lastSavedSnapshot = snapshot();
    editor.remoteConflictLogged = false;
    fitView();
    logLine(`Reloaded ${editor.currentCircuitName}: the file changed on disk.`);
  } catch {
    // A missing file or a server restart should not interrupt editing.
  }
}

export async function syncActiveCircuit() {
  if (!persistence.liveSync || document.hidden) return;
  if (editor.syncInFlight) return editor.syncInFlight;
  editor.syncInFlight = syncActiveCircuitOnce().finally(() => { editor.syncInFlight = null; });
  return editor.syncInFlight;
}

export function startNewDocument() {
  // A blank document is a new analysis session. Do not reuse free-text
  // references from an earlier unnamed schematic; named documents keep their
  // own scoped preferences and are restored when reopened.
  try { localStorage.removeItem(analysisFormStorageKey('new')); } catch { /* storage unavailable */ }
  // Starting the tutorial restarts it right after this.
  dropTutorial();
  editor.syncGeneration += 1;
  editor.activeSyncSuspended = true;
  circuitNameEl.value = '';
  circuitSelectEl.value = '';
  editor.currentCircuitName = '';
  editor.currentDocumentPath = null;
  editor.currentDocumentDir = null;
  editor.history = [];
  editor.future = [];
  applyJson(JSON.stringify(createDocument().toJSON()), { document: true });
  historyBase = null;
  clearLatestAnalysisResult();
  editor.lastSavedSnapshot = snapshot();
  // A new document leaves the server's active one as it was, and so what
  // the sync last saw of it: forgotten, a document saved before the next
  // poll would see the active one as newly chosen and be replaced by it.
  editor.lastSeenRevision = null;
  editor.lastCircuitTag = null;
  editor.remoteConflictLogged = false;
  editor.cursor = { x: 0, y: 0 };
  editor.view = viewFromCenter(0, 0);
  render();
  circuitNameEl.focus();
  renderSaveState();
  logLine(newDesignMessage());
}

/**
 * Browser-only drop: a dropped folder becomes the workspace, and dropped
 * files join the document list linked to their files where the browser
 * allows it, just as if they were opened with Open file.
 */
async function openDroppedDocuments(dropped) {
  let result;
  try {
    result = await dropped;
  } catch (err) {
    logLine(`Could not open the dropped files: ${err.message}`, 'error');
    return;
  }
  circuitSelectEl.dataset.signature = '';
  await refreshCircuitList();
  if (result.folder) {
    logLine(workspaceFolderMessage());
    await documentListChanged();
    return;
  }
  if (!result.paths.length) {
    logLine('Drop .json document files or a folder of them to open them.', 'error');
    return;
  }
  // Over the Atlas, dropped designs join the desk instead of opening.
  if (await documentListChanged()) return;
  if (result.paths.length > 1) logLine(`Added ${result.paths.length} documents to the document list; Shift+Backspace shows them all in the Atlas.`);
  requestCircuitLoad(result.paths[0]);
}

/**
 * Browser-only mode has no server to watch files, so check the open
 * document's file whenever the window comes back into view: a clean
 * document follows a newer file, an edited one is warned about.
 */
async function checkOpenFileChanged() {
  const path = editor.currentDocumentPath;
  if (!persistence.browserOnly || !path || editor.saveInFlight || !editor.lastSeenRevision) return;
  const revision = await persistence.revision(path);
  if (!revision || revision === editor.lastSeenRevision || path !== editor.currentDocumentPath || editor.saveInFlight) return;
  if (documentChanged()) {
    if (!editor.remoteConflictLogged) {
      logLine(`${editor.currentCircuitName} changed on disk, but this window has unsaved changes. Saving will ask before overwriting the other version.`, 'error');
      editor.remoteConflictLogged = true;
    }
    return;
  }
  let data;
  try { data = await persistence.load(path); } catch { return; }
  if (path !== editor.currentDocumentPath || documentChanged()) return;
  applyJson(JSON.stringify(loadDocument(data.state).toJSON()), { document: true });
  historyBase = historyText(data.state);
  editor.lastSavedSnapshot = snapshot();
  editor.lastSeenRevision = data.revision || null;
  editor.remoteConflictLogged = false;
  render();
  renderSaveState();
  logLine(`Reloaded ${editor.currentCircuitName}: the file changed on disk.`);
}

// Dropping a document file (for example, one received by email) opens a copy.
function droppedFiles(ev) {
  return [...(ev.dataTransfer?.types || [])].includes('Files');
}

/** Tell the local server this window is open; the launcher stops the server after the last one closes. */
export function startSessionHeartbeat() {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  const beat = () => {
    persistence.heartbeat(id);
    windowSession.touch({ path: editor.currentDocumentPath, hidden: document.hidden });
  };
  beat();
  // Runs while hidden too; browsers throttle background timers to about once a minute.
  window.setInterval(beat, 20_000);
  window.addEventListener('pageshow', (ev) => {
    if (!ev.persisted) return;
    windowSession.reopen();
    beat();
  });
  window.addEventListener('focus', () => {
    windowSession.touch({ path: editor.currentDocumentPath, hidden: document.hidden, focused: true });
    void checkOpenFileChanged();
  });
  document.addEventListener('visibilitychange', () => {
    windowSession.touch({ path: editor.currentDocumentPath, hidden: document.hidden });
    if (!document.hidden) void checkOpenFileChanged();
  });
  window.addEventListener('pagehide', () => {
    windowSession.close();
    if (persistence.liveSync) {
      navigator.sendBeacon?.('/api/session', new Blob([JSON.stringify({ id, closing: true })], { type: 'application/json' }));
    }
  });
}

export function installDocumentSession() {
  configureBrowserOnlyUi();

  if (deleteDialog) {
    deleteDialog.addEventListener('close', async () => {
      const pending = pendingDelete;
      pendingDelete = null;
      if (!pending) return;
      pending.resolve(deleteDialog.returnValue === 'confirm' ? await runDelete(pending.paths, pending.forget) : false);
    });
  }

  if (switchDialog) {
    switchDialog.addEventListener('close', () => {
      const action = pendingDocumentAction;
      pendingDocumentAction = null;
      if (switchDialog.returnValue === 'discard' && action) action.run();
      else if (switchDialog.returnValue === 'save' && action) {
        // Saved first; a save that fails or is canceled keeps the design open.
        void saveCircuit().then((saved) => {
          if (saved) action.run();
          else {
            action.cancel?.();
            circuitSelectEl.value = editor.currentDocumentPath || '';
          }
        });
      } else {
        action?.cancel?.();
        circuitSelectEl.value = editor.currentDocumentPath || '';
      }
    });
  }

  newDocumentButton?.addEventListener('click', () => {
    for (const [button, menu] of toolbarMenus) closeToolbarMenu(button, menu);
    startNewDocument();
  });

  deleteCircuitBtn?.addEventListener('click', askDeleteCircuit);

  revealDocumentBtn?.addEventListener('click', revealCurrentDocument);

  document.getElementById('btn-open-file')?.addEventListener('click', openDocumentDialog);

  document.getElementById('btn-save-as')?.addEventListener('click', () => saveCircuit({ saveAs: true }));

  document.getElementById('btn-workspace')?.addEventListener('click', chooseWorkspaceFolder);

  circuitNameEl.addEventListener('input', () => { circuitNameEl.classList.remove('needs-name'); renderSaveState(); });

  document.getElementById('btn-rename-document')?.addEventListener('click', beginDocumentRename);
  circuitNameEl.addEventListener('keydown', (ev) => {
    // Naming a design never saved, or a saved one anew: Enter saves it (a copy).
    if (!renaming && ev.key === 'Enter' && circuitNameEl.value.trim() && (!editor.currentDocumentPath || savesAsCopy())) {
      ev.preventDefault();
      ev.stopPropagation();
      circuitNameEl.classList.remove('needs-name');
      void saveCircuit();
      return;
    }
    if (!renaming) return;
    if (ev.key === 'Enter') {
      ev.preventDefault();
      ev.stopPropagation();
      const name = circuitNameEl.value.trim();
      renaming = false;
      circuitNameEl.classList.remove('renaming');
      circuitNameEl.blur();
      void renameDocument(name).then(() => { circuitNameEl.value = editor.currentCircuitName || ''; renderSaveState(); });
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      endDocumentRename();
      circuitNameEl.blur();
    }
  });
  circuitNameEl.addEventListener('blur', () => { if (renaming) endDocumentRename(); });

  circuitSelectEl.addEventListener('change', () => {
    const value = circuitSelectEl.value;
    circuitSelectEl.value = editor.currentDocumentPath || '';
    if (value === PICKER_OPEN_FILE) openDocumentDialog();
    else if (value === PICKER_WORKSPACE) chooseWorkspaceFolder();
    else if (value === PICKER_ACCESS) void allowFolderAccess();
    else if (value === PICKER_CLEAR) void clearOpenedFiles();
    else requestCircuitLoad(value);
  });

  window.addEventListener('dragover', (ev) => {
    if (!droppedFiles(ev)) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'copy';
  });

  window.addEventListener('drop', async (ev) => {
    if (!droppedFiles(ev)) return;
    ev.preventDefault();
    if (persistence.browserOnly) {
      openDroppedDocuments(persistence.openDropped(ev.dataTransfer));
      return;
    }
    const file = [...ev.dataTransfer.files].find((candidate) => /\.json$/i.test(candidate.name));
    if (!file) {
      logLine('Drop a .json document file to open it.', 'error');
      return;
    }
    let state;
    try {
      state = JSON.parse(await file.text());
      loadDocument(state);
    } catch (err) {
      logLine(`Could not open ${file.name}: ${err.message}`, 'error');
      return;
    }
    const name = file.name.replace(/\.json$/i, '');
    requestDocumentAction(`Opening "${file.name}"`, () => openUnsavedDocument(state, name));
  });

  // Documents created by the CLI, another window, or a file manager appear without a manual reload.
  circuitSelectEl.addEventListener('focus', () => { void refreshCircuitList(); });

  // The windows' state goes to the file as the editor is put away.
  document.addEventListener('visibilitychange', () => { if (document.hidden) void saveWindowState(); });

  window.addEventListener('beforeunload', (ev) => {
    flushDraft();
    if (!documentChanged()) return;
    ev.preventDefault();
    ev.returnValue = 'You have unsaved schematic changes.';
  });
}
