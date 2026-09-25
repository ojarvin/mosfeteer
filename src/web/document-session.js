/**
 * The open document's life in the editor: new, open, save, save as, and
 * delete; the unsaved-changes prompt; this window's local draft; following
 * the CLI's active document and reloading files changed on disk; and dropped
 * files. Storage itself is behind persistence.js.
 */

import { Circuit } from '../core/model.js';
import { createDocument, loadDocument } from '../core/document.js';
import { createPersistenceAdapter, validDocumentName } from './persistence.js';
import { createWindowSession } from './window-session.js';
import { confirmChoice, showFileDialog } from './file-dialog.js';
import { analysisFormStorageKey } from './analysis-state.js';
import { circuitSelectEl, circuitNameEl, newDocumentButton, deleteCircuitBtn, revealDocumentBtn, deleteDialog, deleteDialogMessage, switchDialog, switchDialogMessage, exportForm } from './elements.js';
import { dropTutorial } from './onboarding.js';
import { logLine } from './status-bar-ui.js';
import { resetCheckState } from './design-check-ui.js';
import { viewFromCenter, fitView } from './canvas-view.js';
import { clearLatestAnalysisResult, migrateAnalysisFormStorage, analysisFormScope } from './analysis-ui.js';
import { editor } from './editor-state.js';
import { applyJson, cancelPreviewTransaction, clearSymmetry, closeToolbarMenu, markModelChanged, render, scheduleToolbarFit, setSelection, snapshot, toolbarMenus } from './main.js';

export const persistence = createPersistenceAdapter();

function configureBrowserOnlyUi() {
  if (!persistence.browserOnly) return;
  // These actions depend on the local server's filesystem. Browser mode uses
  // native file pickers and downloads instead of pretending that a browser can
  // browse or reveal arbitrary folders.
  for (const id of ['btn-workspace', 'btn-reveal-document']) document.getElementById(id)?.setAttribute('hidden', '');
  const forget = document.getElementById('btn-delete-circuit');
  if (forget) {
    forget.textContent = 'Forget from browser…';
    forget.title = 'Remove the current document from this browser\'s cached document list';
  }
  const deleteTitle = document.getElementById('delete-dialog-title');
  if (deleteTitle) deleteTitle.textContent = 'Forget browser document?';
  const confirmDelete = document.getElementById('confirm-delete');
  if (confirmDelete) confirmDelete.textContent = 'Forget document';
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
    applyJson(JSON.stringify(draft.state));
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
  return String(path).split(/[\\/]/).pop().replace(/\.schematic\.json$/i, '').replace(/\.json$/i, '');
}

const PICKER_OPEN_FILE = '__open-file__';

const PICKER_WORKSPACE = '__workspace__';

async function refreshCircuitList() {
  try {
    editor.workspaceState = await persistence.workspace();
  } catch (err) {
    logLine(`Could not list documents: ${err.message}`, 'error');
    return;
  }
  const { documents = [], recent = [] } = editor.workspaceState;
  const label = (document) => document.name;
  const known = new Set([...documents, ...recent].map((document) => document.path));
  const recentEntries = editor.currentDocumentPath && !known.has(editor.currentDocumentPath)
    ? [{ name: editor.currentCircuitName || documentNameForPath(editor.currentDocumentPath), path: editor.currentDocumentPath, kind: 'circuit' }, ...recent]
    : recent;
  const groups = [
    [persistence.browserOnly ? 'Documents available in this browser' : `Workspace · ${displayPath(editor.workspaceState.workspace)}`, documents],
    ['Recent elsewhere', recentEntries],
  ];
  const signature = JSON.stringify([groups.map(([name, items]) => [name, items.map((item) => [label(item), item.path])])]);
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
    actions.append(new Option('Browse for a file… (Ctrl/Cmd+O)', PICKER_OPEN_FILE));
    if (!persistence.browserOnly) actions.append(new Option('Change workspace folder…', PICKER_WORKSPACE));
    children.push(actions);
    circuitSelectEl.replaceChildren(...children);
    circuitSelectEl.dataset.signature = signature;
  }
  circuitSelectEl.value = editor.currentDocumentPath || '';
  circuitSelectEl.title = editor.currentDocumentPath
    ? editor.currentDocumentPath
    : persistence.browserOnly ? 'Open a document file' : `Open a document from ${editor.workspaceState.workspace}`;
}

export async function restoreStartup() {
  const listPromise = refreshCircuitList();
  const params = new URLSearchParams(window.location.search);
  const openPath = params.get('open');
  if (openPath) window.history.replaceState(null, '', window.location.pathname);
  await listPromise;
  if (openPath && openPath !== editor.currentDocumentPath) requestCircuitLoad(openPath);
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
      return;
    }
    if (!choice) return;
    ({ name } = choice);
    target = choice;
  } else if (editor.currentDocumentPath && name === editor.currentCircuitName) {
    target = { path: editor.currentDocumentPath };
  } else {
    target = { ...(editor.currentDocumentDir ? { dir: editor.currentDocumentDir } : {}), name };
  }
  if (!validDocumentName(name)) {
    logLine('Enter a document name. Names cannot start with "." or contain / \\ : * ? " < > |.', 'error');
    circuitNameEl.focus();
    return;
  }
  editor.syncGeneration += 1;
  editor.saveInFlight += 1;
  renderSaveState();
  const previousScope = analysisFormScope();
  try {
    const state = editor.circuit.toJSON();
    let data;
    try {
      data = await persistence.save(target, state, { overwrite: !!target.path });
    } catch (err) {
      if (err.code !== 'exists') throw err;
      const replace = await confirmChoice({
        title: 'Replace existing document?',
        message: `A document named "${name}" already exists in ${displayPath(target.dir || editor.currentDocumentDir || editor.workspaceState?.workspace)}. Replacing it overwrites its contents.`,
        confirmLabel: 'Replace',
        danger: true,
      });
      if (!replace) {
        logLine('Save canceled.');
        return;
      }
      data = await persistence.save(target, state, { overwrite: true });
    }
    editor.currentCircuitName = data.name;
    editor.currentDocumentPath = data.path;
    editor.currentDocumentDir = data.dir;
    editor.activeSyncSuspended = false;
    migrateAnalysisFormStorage(previousScope, analysisFormScope());
    circuitNameEl.value = data.name;
    editor.lastSeenRevision = data.revision || null;
    editor.lastCircuitTag = data.etag || null;
    editor.lastSavedSnapshot = snapshot();
    persistDraft();
    await refreshCircuitList();
    logLine(`Saved ${displayPath(data.path)}.`);
  } catch (err) {
    logLine(`Could not save document: ${err.message}`, 'error');
  } finally {
    editor.saveInFlight -= 1;
    editor.syncGeneration += 1;
    renderSaveState();
  }
}

async function loadCircuit(path, quiet = false, options = {}) {
  if (!path) return false;
  const { syncGeneration: expectedGeneration, ...loadOptions } = options;
  try {
    const data = await persistence.load(path, loadOptions);
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
    applyJson(JSON.stringify(data.state));
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
    if (!quiet) logLine(`Could not open document: ${err.message}`, 'error');
    return false;
  }
}

/** Open document contents that have no file path (a dropped file). Saving puts it in the workspace. */
function openUnsavedDocument(state, name) {
  dropTutorial();
  editor.history = [];
  editor.future = [];
  applyJson(JSON.stringify(state));
  clearLatestAnalysisResult();
  setSelection([]);
  editor.cursor = { x: 0, y: 0 };
  editor.currentCircuitName = '';
  editor.currentDocumentPath = null;
  editor.currentDocumentDir = null;
  editor.activeSyncSuspended = true;
  editor.remoteConflictLogged = false;
  lastSeenActive = null;
  editor.lastSeenRevision = null;
  editor.lastCircuitTag = null;
  circuitNameEl.value = validDocumentName(name) || '';
  circuitSelectEl.value = '';
  editor.lastSavedSnapshot = snapshot();
  fitView();
  renderSaveState();
  persistDraft();
  logLine(`Imported "${name}". Save (Ctrl/Cmd+S) to keep it in your workspace, or Save as to choose a folder.`);
}

function hasUnsavedChanges() {
  return snapshot() !== editor.lastSavedSnapshot ||
    (!editor.currentDocumentPath && !!validDocumentName(circuitNameEl.value));
}

let pendingDocumentAction = null;

/** Run an action that replaces the open document, asking first when that would discard unsaved changes. */
export function requestDocumentAction(description, run) {
  if (!hasUnsavedChanges()) {
    run();
    return;
  }
  pendingDocumentAction = run;
  if (switchDialogMessage) {
    switchDialogMessage.textContent = `${description} will discard the unsaved changes in "${editor.currentCircuitName || circuitNameEl.value.trim() || 'this design'}".`;
  }
  circuitSelectEl.value = editor.currentDocumentPath || '';
  switchDialog?.showModal();
}

function requestCircuitLoad(path) {
  if (!path) return;
  requestDocumentAction(`Opening "${documentNameForPath(path)}"`, () => loadCircuit(path, false, { open: true }));
}

export async function openDocumentDialog() {
  try {
    const choice = await showFileDialog(persistence, { mode: 'open', dir: editor.currentDocumentDir || editor.workspaceState?.workspace || '' });
    if (choice) requestCircuitLoad(choice.path);
  } catch (err) {
    logLine(`Could not choose an open file: ${err.message}`, 'error');
  }
}

async function chooseWorkspaceFolder() {
  if (persistence.browserOnly) {
    logLine('Browser-only mode uses the browser download location instead of a workspace folder.');
    return;
  }
  const choice = await showFileDialog(persistence, { mode: 'folder', dir: editor.workspaceState?.workspace || '' });
  if (!choice) return;
  try {
    editor.workspaceState = await persistence.setWorkspace(choice.path);
    circuitSelectEl.dataset.signature = '';
    await refreshCircuitList();
    logLine(`Workspace folder is now ${displayPath(editor.workspaceState.workspace)}. New documents are saved there.`);
  } catch (err) {
    logLine(`Could not change the workspace folder: ${err.message}`, 'error');
  }
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

export function renderSaveState() {
  const dirty = hasUnsavedChanges();
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
  if (deleteCircuitBtn) deleteCircuitBtn.disabled = !editor.currentDocumentPath || editor.deleteInFlight;
  if (revealDocumentBtn) revealDocumentBtn.disabled = persistence.browserOnly || !editor.currentDocumentPath;
  circuitNameEl.title = editor.currentDocumentPath
    ? `${editor.currentDocumentPath}\nRename and save to create a copy next to it.`
    : persistence.browserOnly ? 'Name used when saving this document as a browser download' : 'Name used when saving this document to the workspace folder';
  const saveButton = document.getElementById('btn-save');
  if (saveButton) {
    saveButton.disabled = !dirty || editor.saveInFlight > 0;
    saveButton.title = dirty
      ? 'Save unsaved changes, including designs with issues (Ctrl/Cmd+S or Shift+X)'
      : editor.currentDocumentPath ? `All changes saved to ${editor.currentDocumentPath}` : 'Nothing to save yet';
  }
}

async function deleteSavedCircuit() {
  const path = editor.currentDocumentPath;
  if (!path || editor.deleteInFlight) return;
  editor.deleteInFlight = true;
  renderSaveState();
  try {
    await persistence.delete(path);
    const name = editor.currentCircuitName;

    editor.history = [];
    editor.future = [];
    cancelPreviewTransaction();
    dropTutorial();
    editor.circuit = new Circuit();
    clearLatestAnalysisResult();
    markModelChanged(false);
    resetCheckState();
    editor.directWire = null;
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
    editor.visual = null;
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
    await refreshCircuitList();
    logLine(`${persistence.browserOnly ? 'Forgot' : 'Deleted'} "${name}" (${displayPath(path)}).`);
  } catch (err) {
    logLine(`Could not delete document: ${err.message}`, 'error');
  } finally {
    editor.deleteInFlight = false;
    renderSaveState();
  }
}

function askDeleteCircuit() {
  const path = editor.currentDocumentPath;
  if (!path || !deleteDialog) return;
  if (persistence.browserOnly) {
    deleteDialogMessage.textContent = hasUnsavedChanges()
      ? `This removes ${displayPath(path)} from this browser's cached document list and discards its unsaved editor changes. It does not delete a file already downloaded to disk.`
      : `This removes ${displayPath(path)} from this browser's cached document list. It does not delete a file already downloaded to disk.`;
  } else {
    deleteDialogMessage.textContent = hasUnsavedChanges()
      ? `This permanently deletes ${displayPath(path)} and discards its unsaved editor changes. This cannot be undone.`
      : `This permanently deletes ${displayPath(path)}. This cannot be undone.`;
  }
  deleteDialog.showModal();
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
    if (currentSnapshot !== editor.lastSavedSnapshot) {
      if (!editor.remoteConflictLogged) {
        logLine(`${editor.currentCircuitName} changed on disk, but this window has unsaved changes. Saving will overwrite the other version.`, 'error');
        editor.remoteConflictLogged = true;
      }
      return;
    }
    applyJson(remoteSnapshot);
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
  applyJson(JSON.stringify(createDocument().toJSON()));
  clearLatestAnalysisResult();
  editor.lastSavedSnapshot = snapshot();
  lastSeenActive = null;
  editor.lastSeenRevision = null;
  editor.lastCircuitTag = null;
  editor.remoteConflictLogged = false;
  editor.cursor = { x: 0, y: 0 };
  editor.view = viewFromCenter(0, 0);
  render();
  circuitNameEl.focus();
  renderSaveState();
  logLine(persistence.browserOnly
    ? 'Started a new schematic. Enter a name and save it as a browser download, or use Save as to choose a file name.'
    : 'Started a new schematic. Enter a name and save to store it in the workspace folder, or use Save as to choose a folder.');
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
  window.addEventListener('focus', () => windowSession.touch({ path: editor.currentDocumentPath, hidden: document.hidden, focused: true }));
  document.addEventListener('visibilitychange', () => windowSession.touch({ path: editor.currentDocumentPath, hidden: document.hidden }));
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
    deleteDialog.addEventListener('close', () => {
      if (deleteDialog.returnValue === 'confirm') deleteSavedCircuit();
    });
  }

  if (switchDialog) {
    switchDialog.addEventListener('close', () => {
      const run = pendingDocumentAction;
      pendingDocumentAction = null;
      if (switchDialog.returnValue === 'discard' && run) run();
      else circuitSelectEl.value = editor.currentDocumentPath || '';
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

  circuitNameEl.addEventListener('input', renderSaveState);

  circuitSelectEl.addEventListener('change', () => {
    const value = circuitSelectEl.value;
    circuitSelectEl.value = editor.currentDocumentPath || '';
    if (value === PICKER_OPEN_FILE) openDocumentDialog();
    else if (value === PICKER_WORKSPACE) chooseWorkspaceFolder();
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
    const name = file.name.replace(/\.schematic\.json$/i, '').replace(/\.json$/i, '');
    requestDocumentAction(`Opening "${file.name}"`, () => openUnsavedDocument(state, name));
  });

  // Documents created by the CLI, another window, or a file manager appear without a manual reload.
  circuitSelectEl.addEventListener('focus', () => { void refreshCircuitList(); });

  window.addEventListener('beforeunload', (ev) => {
    flushDraft();
    if (snapshot() === editor.lastSavedSnapshot) return;
    ev.preventDefault();
    ev.returnValue = 'You have unsaved schematic changes.';
  });
}
