/**
 * Onboarding in the editor: the contextual tip card and the first-drawing
 * tutorial. The rules live in tips.js and tutorial.js; this shows them.
 */

import { getSymbol } from '../core/components/index.js';
import { TIP_MAX_SHOWS, TIPS, TipBook } from './tips.js';
import { openTutorialTargets, tutorialById, tutorialProgress, tutorialRuns } from './tutorial.js';
import { transformRect } from '../core/geometry.js';
import { canvasEl, circuitNameEl, tipCardEl, tipTextEl, tipsButton, tutorialCardEl, tutorialStepEl, tutorialStepsEl, tutorialCountEl, tutorialBarEl, tutorialSkipEl, tutorialStepsToggleEl } from './elements.js';
import { editor } from './editor-state.js';
import { logLine } from './status-bar-ui.js';
import { fitView, paneSize } from './canvas-view.js';
import { openDocumentPath, persistence, refreshCircuitList, renderSaveState, requestDocumentAction, startNewDocument } from './document-session.js';
import { reportExampleDesigns } from './examples/report-example.js';
import { showNotes } from './notes-window.js';
import { applyJson, render } from './main.js';
import { leaveAtlasNow } from './atlas.js';

// ----- contextual tips ---------------------------------------------------------
// One quiet line in the canvas corner when a faster way exists for what the
// user is doing. The rules that keep them scarce live in tips.js; this only
// stores the state and shows the card. `noteTip` is safe to call anywhere.
const TIPS_KEY = 'mosfeteer.tips';
const tipBook = new TipBook((() => {
  try { return JSON.parse(localStorage.getItem(TIPS_KEY) || 'null'); } catch { return null; }
})());
const TIP_VISIBLE_MS = 14000;
let shownTip = null;
let tipHideTimer = 0;

function saveTips() {
  try { localStorage.setItem(TIPS_KEY, JSON.stringify(tipBook.toJSON())); } catch { /* per-session only */ }
}

function hideTip() {
  window.clearTimeout(tipHideTimer);
  shownTip = null;
  if (tipCardEl) tipCardEl.hidden = true;
}

export function noteTip(event) {
  // The tutorial teaches the same things; tips still retire, but stay quiet.
  const tip = editor.tutorial ? (tipBook.note(event, -Infinity), null) : tipBook.note(event, Date.now());
  // Using the feature a visible tip describes answers it.
  if (shownTip && tipBook.state.retired.includes(shownTip.id)) hideTip();
  saveTips();
  if (!tip || !tipCardEl) return;
  shownTip = tip;
  tipTextEl.textContent = tip.text;
  tipCardEl.hidden = false;
  window.clearTimeout(tipHideTimer);
  tipHideTimer = window.setTimeout(hideTip, TIP_VISIBLE_MS);
}

/** Every tip with where it stands for this user: retired (used or
 *  dismissed) or still waiting, and how often it has been shown. */
export function tipStates() {
  return TIPS.map((tip) => ({
    id: tip.id,
    text: tip.text,
    retired: tipBook.state.retired.includes(tip.id),
    shown: tipBook.state.shown[tip.id] || 0,
  }));
}

/** Whether a tip may still be shown: tips on, it not retired, not yet shown
 *  its most. For a trigger that costs something to notice. */
export function tipWaiting(id) {
  const state = tipBook.state;
  return !state.off && !state.retired.includes(id) && (state.shown[id] || 0) < TIP_MAX_SHOWS;
}

/** Whether tips are on (Settings → Show tips). */
export function tipsOn() {
  return !tipBook.state.off;
}

function syncTipsButton() {
  tipsButton?.setAttribute('aria-checked', String(!tipBook.state.off));
}

// ----- tutorials ---------------------------------------------------------------
// Optional and never offered by themselves: one starts only from Learn (?),
// the empty-canvas card, or the command line, and closing it leaves the
// drawing as it is. Steps are checked from the drawing's structure in
// tutorial.js, or from what the windows show (tutorialUi).
let tutorialKey = '';
let tutorialState = null;
let tutorialCheerTimer = 0;
let tutorialWatch = 0;

/** What the editor shows that a step may ask about: the beat on screen, the
 *  switched-cap equation, how many signal-flow results there are, and the
 *  Plots window's tab. Read from the page, so no window needs to tell. */
function tutorialUi() {
  const visible = (el) => !!el && !el.hidden && !!el.offsetParent;
  const plots = document.querySelector('.plots-window');
  const beats = editor.circuit.beats || [];
  const active = beats.findIndex((beat) => beat.id === editor.activeBeatId);
  return {
    activeBeat: active >= 0 ? active : null,
    scEquation: document.querySelector('.sc-equation')?.textContent || '',
    signalFlowResults: document.querySelectorAll('.signal-flow-results .signal-flow-entry').length,
    plotsTab: visible(plots) ? plots.querySelector('.signal-flow-view button[aria-pressed="true"]')?.textContent || '' : '',
  };
}

function currentTutorial() {
  return editor.tutorial ? tutorialById(editor.tutorial.id) : null;
}

function currentTutorialProgress() {
  if (!editor.tutorial) return null;
  const ui = tutorialUi();
  const key = `${editor.tutorial.id}:${editor.modelRevision}:${[...editor.tutorial.skipped].join(',')}:${editor.circuit.netHighlights.size}:${JSON.stringify(ui)}`;
  if (key !== tutorialKey) {
    tutorialKey = key;
    tutorialState = tutorialProgress(editor.circuit, editor.tutorial.skipped, { tutorial: currentTutorial(), ui });
  }
  return tutorialState;
}

export function tutorialTargetRects() {
  const progress = currentTutorialProgress();
  if (!progress?.current) return [];
  return openTutorialTargets(editor.circuit, progress.current, currentTutorial()).map((target) => {
    const def = getSymbol(target.type);
    const transform = { x: target.x, y: target.y, rotation: 0, mirrorX: target.mirrorX, mirrorY: !!def.defaultMirrorY };
    return { rect: transformRect(transform, def.bbox), caption: target.caption };
  });
}

function appendTutorialText(parent, text) {
  for (const run of tutorialRuns(text)) {
    parent.append(run.key ? Object.assign(document.createElement('kbd'), { textContent: run.text }) : run.text);
  }
}

function tutorialElapsed() {
  const seconds = Math.round(((editor.tutorial.finishedAt || Date.now()) - editor.tutorial.startedAt) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function syncTutorial() {
  if (!tutorialCardEl) return;
  tutorialCardEl.hidden = !editor.tutorial;
  const progress = currentTutorialProgress();
  if (!progress) return;
  const tutorial = currentTutorial();
  const titleEl = document.getElementById('tutorial-title');
  if (titleEl) titleEl.textContent = `Tutorial · ${tutorial.card}`;
  // A step finished since the last look earns a short cheer.
  const fresh = progress.steps.filter((step) => step.done && !editor.tutorial.cheered.has(step.id));
  for (const step of fresh) editor.tutorial.cheered.add(step.id);
  if (fresh.length) {
    editor.tutorial.cheer = tutorial.steps.find((step) => step.id === fresh.at(-1).id).title;
    window.clearTimeout(tutorialCheerTimer);
    tutorialCheerTimer = window.setTimeout(() => {
      if (editor.tutorial) editor.tutorial.cheer = null;
      syncTutorial();
    }, 2600);
  }
  if (progress.finished && !editor.tutorial.finishedAt) editor.tutorial.finishedAt = Date.now();
  const total = tutorial.steps.length;
  tutorialCountEl.textContent = `${progress.doneCount} / ${total}`;
  tutorialBarEl.style.width = `${(progress.doneCount / total) * 100}%`;
  tutorialStepEl.replaceChildren();
  if (editor.tutorial.cheer) {
    tutorialStepEl.append(Object.assign(document.createElement('div'), { className: 'tutorial-cheer', textContent: `✓ ${editor.tutorial.cheer}` }));
  }
  const heading = document.createElement('h3');
  const body = document.createElement('p');
  if (progress.current) {
    heading.textContent = progress.current.title;
    appendTutorialText(body, progress.current.text);
  } else {
    const skippedCount = progress.steps.filter((step) => step.skipped).length;
    heading.textContent = skippedCount ? 'Through the tutorial' : tutorial.done;
    appendTutorialText(body, `${skippedCount ? `All steps visited in ${tutorialElapsed()}; skipped ones tick off whenever you finish them.` : `Done in ${tutorialElapsed()}.`} ${tutorial.finish}`);
  }
  tutorialStepEl.append(heading, body);
  tutorialStepsEl.hidden = !editor.tutorial.showSteps;
  tutorialStepsToggleEl.textContent = editor.tutorial.showSteps ? 'Hide steps' : 'All steps';
  tutorialStepsEl.replaceChildren(...progress.steps.map((step) => {
    const item = document.createElement('li');
    item.textContent = tutorial.steps.find((candidate) => candidate.id === step.id).title;
    item.classList.toggle('done', step.done);
    item.classList.toggle('skipped', step.skipped);
    item.classList.toggle('current', step.id === progress.current?.id);
    return item;
  }));
  tutorialSkipEl.hidden = !progress.current;
}

/** Begin a tutorial (the OTA unless `id` names another) in a fresh
 *  document, from its own drawing if it has one (after the usual
 *  unsaved-changes check). */
/**
 * Learn's report example (examples/report-example.js): its designs saved to
 * the workspace, each only when no design of its name is there -- one that
 * is opens as it is, never replaced -- then the first opened, its notes shown.
 */
export async function openReportExample() {
  if (persistence.browserOnly && !editor.workspaceState?.folder) {
    logLine('Open a folder first: the report example is two designs saved there.', 'error');
    return;
  }
  await refreshCircuitList();
  const pathOf = (name) => (editor.workspaceState?.documents || []).find((doc) => doc.name.toLowerCase() === name.toLowerCase())?.path || null;
  const paths = [];
  try {
    for (const { name, state } of reportExampleDesigns()) {
      let path = pathOf(name);
      if (!path) {
        try {
          path = (await persistence.save({ name }, state, { overwrite: false })).path;
        } catch (err) {
          if (err.code !== 'exists') throw err;
          await refreshCircuitList();
          path = pathOf(name);
        }
      }
      paths.push(path);
    }
  } catch (err) {
    logLine(`Could not save the report example: ${err.message}`, 'error');
    return;
  }
  await refreshCircuitList();
  if (paths[0] && await openDocumentPath(paths[0])) showNotes();
}

export function offerTutorial(id = 'ota') {
  const tutorial = tutorialById(id);
  requestDocumentAction('Starting the tutorial', () => {
    // Started over the Atlas (Learn is there too), it opens in the editor.
    leaveAtlasNow();
    startNewDocument();
    if (tutorial.start) applyJson(JSON.stringify(tutorial.start()), { document: true });
    startTutorial(tutorial);
  });
}

function startTutorial(tutorial) {
  circuitNameEl.value = tutorial.name;
  renderSaveState();
  editor.tutorial = { id: tutorial.id, startedAt: Date.now(), skipped: new Set(), cheered: new Set(), cheer: null, finishedAt: null };
  tutorialKey = '';
  // A step about a window finishes without an edit: look again while it runs.
  window.clearInterval(tutorialWatch);
  tutorialWatch = window.setInterval(() => {
    if (!editor.tutorial) { window.clearInterval(tutorialWatch); return; }
    const before = tutorialKey;
    currentTutorialProgress();
    if (tutorialKey !== before) render();
  }, 400);
  hideTip();
  fitView();
  // Keep the marked spots -- or the drawing the tutorial starts from --
  // clear of the card at the bottom left.
  const pane = paneSize();
  if (pane && tutorialCardEl) {
    const cardWorld = ((tutorialCardEl.getBoundingClientRect().width || 340) + 68) * (editor.view.w / pane.w);
    if (!tutorial.start) editor.view = { ...editor.view, x: editor.view.x - cardWorld / 2 };
    else {
      // The fitted drawing moves right of the card, the view widened to
      // keep all of it.
      const w = editor.view.w + cardWorld;
      const h = editor.view.h * (w / editor.view.w);
      editor.view = { ...editor.view, x: editor.view.x - cardWorld, y: editor.view.y - (h - editor.view.h) / 2, w, h };
    }
  }
  render();
  canvasEl.focus();
  logLine(`Tutorial started (${tutorial.card}): follow the card at the bottom left, or close it any time.`, 'status');
}

/** Drop the tutorial's state; the card hides on the next render. The tutorial
 *  belongs to its own drawing, so opening another design ends it. */
export function dropTutorial() {
  editor.tutorial = null;
  window.clearInterval(tutorialWatch);
  window.clearTimeout(tutorialCheerTimer);
}

function endTutorial() {
  dropTutorial();
  render();
  canvasEl.focus();
}

export function installOnboarding() {
  document.getElementById('tip-card-close')?.addEventListener('click', () => {
    if (shownTip) tipBook.retire(shownTip.id);
    saveTips();
    hideTip();
  });
  document.getElementById('tip-card-off')?.addEventListener('click', () => {
    tipBook.setOff(true);
    saveTips();
    hideTip();
    syncTipsButton();
    logLine('tips off — turn them back on in Settings; Learn (?) lists them all', 'status');
  });
  // Hovering keeps a tip up while it is being read.
  tipCardEl?.addEventListener('mouseenter', () => window.clearTimeout(tipHideTimer));
  tipCardEl?.addEventListener('mouseleave', () => {
    if (shownTip) tipHideTimer = window.setTimeout(hideTip, TIP_VISIBLE_MS / 2);
  });
  tipsButton?.addEventListener('click', () => {
    tipBook.setOff(!tipBook.state.off);
    if (tipBook.state.off) hideTip();
    saveTips();
    syncTipsButton();
  });
  syncTipsButton();

  document.getElementById('tutorial-close')?.addEventListener('click', endTutorial);
  tutorialStepsToggleEl?.addEventListener('click', () => {
    if (!editor.tutorial) return;
    editor.tutorial.showSteps = !editor.tutorial.showSteps;
    syncTutorial();
  });
  tutorialSkipEl?.addEventListener('click', () => {
    const current = currentTutorialProgress()?.current;
    if (current) editor.tutorial.skipped.add(current.id);
    render();
  });
  const github = document.getElementById('btn-github');
  github?.addEventListener('click', () => window.open(github.dataset.href, '_blank', 'noopener'));
}
