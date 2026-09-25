/**
 * Onboarding in the editor: the contextual tip card and the first-drawing
 * tutorial. The rules live in tips.js and tutorial.js; this shows them.
 */

import { getSymbol } from '../core/components/index.js';
import { TipBook } from './tips.js';
import { TUTORIAL_STEPS, openTutorialTargets, tutorialProgress, tutorialRuns } from './tutorial.js';
import { transformRect } from '../core/geometry.js';
import { canvasEl, circuitNameEl, tipCardEl, tipTextEl, tipsButton, tutorialCardEl, tutorialStepEl, tutorialStepsEl, tutorialCountEl, tutorialBarEl, tutorialSkipEl, tutorialStepsToggleEl } from './elements.js';
import { editor } from './editor-state.js';
import { logLine } from './status-bar-ui.js';
import { fitView, paneSize } from './canvas-view.js';
import { render, renderSaveState, requestDocumentAction, startNewDocument } from './main.js';

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

function syncTipsButton() {
  tipsButton?.setAttribute('aria-checked', String(!tipBook.state.off));
}

// ----- first-drawing tutorial ------------------------------------------------
// Optional and never offered by itself: it starts only from the More menu or
// the empty-canvas card, and closing it leaves the drawing as it is. Steps are
// checked from the drawing's structure in tutorial.js.
let tutorialKey = '';
let tutorialState = null;
let tutorialCheerTimer = 0;

function currentTutorialProgress() {
  if (!editor.tutorial) return null;
  const key = `${editor.modelRevision}:${[...editor.tutorial.skipped].join(',')}:${editor.circuit.netHighlights.size}`;
  if (key !== tutorialKey) {
    tutorialKey = key;
    tutorialState = tutorialProgress(editor.circuit, editor.tutorial.skipped);
  }
  return tutorialState;
}

export function tutorialTargetRects() {
  const progress = currentTutorialProgress();
  if (!progress?.current) return [];
  return openTutorialTargets(editor.circuit, progress.current).map((target) => {
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
  // A step finished since the last look earns a short cheer.
  const fresh = progress.steps.filter((step) => step.done && !editor.tutorial.cheered.has(step.id));
  for (const step of fresh) editor.tutorial.cheered.add(step.id);
  if (fresh.length) {
    editor.tutorial.cheer = TUTORIAL_STEPS.find((step) => step.id === fresh.at(-1).id).title;
    window.clearTimeout(tutorialCheerTimer);
    tutorialCheerTimer = window.setTimeout(() => {
      if (editor.tutorial) editor.tutorial.cheer = null;
      syncTutorial();
    }, 2600);
  }
  if (progress.finished && !editor.tutorial.finishedAt) editor.tutorial.finishedAt = Date.now();
  const total = TUTORIAL_STEPS.length;
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
    heading.textContent = skippedCount ? 'Through the tutorial' : 'You drew a 5T OTA!';
    appendTutorialText(body, `${skippedCount ? `All steps visited in ${tutorialElapsed()}; skipped ones tick off whenever you finish them.` : `Done in ${tutorialElapsed()}.`} Next, press **x** for a design check. Before **Analyze** can find the gain and output impedance, mark the tail node and the mirror node as AC ground: right-click each wire, then **Small-signal attributes → DC bias / AC ground**. **?** lists every key.`);
  }
  tutorialStepEl.append(heading, body);
  tutorialStepsEl.hidden = !editor.tutorial.showSteps;
  tutorialStepsToggleEl.textContent = editor.tutorial.showSteps ? 'Hide steps' : 'All steps';
  tutorialStepsEl.replaceChildren(...progress.steps.map((step) => {
    const item = document.createElement('li');
    item.textContent = TUTORIAL_STEPS.find((candidate) => candidate.id === step.id).title;
    item.classList.toggle('done', step.done);
    item.classList.toggle('skipped', step.skipped);
    item.classList.toggle('current', step.id === progress.current?.id);
    return item;
  }));
  tutorialSkipEl.hidden = !progress.current;
}

/** Begin the tutorial in a fresh document (after the usual unsaved-changes check). */
export function offerTutorial() {
  requestDocumentAction('Starting the tutorial', () => {
    startNewDocument();
    startTutorial();
  });
}

function startTutorial() {
  circuitNameEl.value = 'tutorial-5t-ota';
  renderSaveState();
  editor.tutorial = { startedAt: Date.now(), skipped: new Set(), cheered: new Set(), cheer: null, finishedAt: null };
  tutorialKey = '';
  hideTip();
  fitView();
  // Keep the marked spots clear of the card at the bottom left.
  const pane = paneSize();
  if (pane && tutorialCardEl) {
    const cardWorld = ((tutorialCardEl.getBoundingClientRect().width || 340) + 68) * (editor.view.w / pane.w);
    editor.view = { ...editor.view, x: editor.view.x - cardWorld / 2 };
  }
  render();
  canvasEl.focus();
  logLine('Tutorial started: follow the card at the bottom left, or close it any time.', 'status');
}

/** Drop the tutorial's state; the card hides on the next render. The tutorial
 *  belongs to its own drawing, so opening another design ends it. */
export function dropTutorial() {
  editor.tutorial = null;
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
    logLine('tips off — turn them back on from the More menu', 'status');
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
  document.getElementById('btn-tutorial')?.addEventListener('click', offerTutorial);
}
