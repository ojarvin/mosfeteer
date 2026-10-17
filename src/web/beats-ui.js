/**
 * Beats in the editor: the beat strip, stepping and editing beats, hiding
 * or dimming the selection from a beat on, switch flips, and the full-screen
 * presenter. The beat model is core/beats.js.
 */

import { element } from './dom.js';
import { DEFAULT_SLOT_CELLS, MAX_EDGE_SHIFT, MAX_ROW_CELLS, addTimingDiagram, parseTimingValue, timingStates, beatTimingBits, defaultTimingPairs, existingTimingDiagram, removeTimingDiagram, timingBeatBands, timingPhases, timingRowSources } from '../core/timing-diagram.js';
import { addBeat, beatTargetId, beatTitle, introduceAt, mergeBeats, moveBeat, removeBeat, renameBeat, resolveBeat, setPresenceAt, setPresenceFrom, setSwitchFrom, switchGroupKey, switchPhase, switchState, switchStateAt, phaseBeats, samePhase, complementKey, phaseKey, switchPhases } from '../core/beats.js';
import { plainTexText, svgString, texToLabelMarkup } from '../core/render.js';
import { DRAWING_EXPORT_OPTIONS } from '../core/selection-drawing.js';
import { canvasEl, beatStripEl, beatListEl, beatHintEl, presenterEl, presenterStageEl, presenterCountEl } from './elements.js';
import { logLine, hintLine } from './status-bar-ui.js';
import { fitView } from './canvas-view.js';
import { closeComponentContextMenu, appendContextItem, openMenuAt } from './context-menu.js';
import { editor } from './editor-state.js';
import { appendMarkupText } from './side-panel.js';
import { commit, markModelChanged, recordHistoryEntry, redo, render, selectedComps, selectedLabels, snapshot, undo } from './main.js';
import { noteTip } from './onboarding.js';
import { chooseAction } from './file-dialog.js';
import { PLACE, floatingWindow } from './floating-window.js';
import { buttonIcon } from './icons.js';
import { reducedMotion } from './motion.js';

export function activeBeatIndex() {
  if (!editor.activeBeatId) return null;
  const index = editor.circuit.beats.findIndex((beat) => beat.id === editor.activeBeatId);
  return index === -1 ? null : index;
}

export function activeBeatView(modelKey) {
  const index = activeBeatIndex();
  if (index === null) return null;
  const key = `${modelKey}|${index}`;
  if (editor.beatViewCache?.circuit !== editor.circuit || editor.beatViewCache.key !== key) {
    editor.beatViewCache = { circuit: editor.circuit, key, view: resolveBeat(editor.circuit, index) };
  }
  return editor.beatViewCache.view;
}

function allBeatViews() {
  const key = `${editor.modelRevision}|${editor.circuit.beats.length}`;
  if (editor.beatViewsCache?.circuit !== editor.circuit || editor.beatViewsCache.key !== key) {
    editor.beatViewsCache = { circuit: editor.circuit, key, views: editor.circuit.beats.map((_, index) => resolveBeat(editor.circuit, index)) };
  }
  return editor.beatViewsCache.views;
}

export function rememberBeatObjects() {
  const objects = new WeakSet();
  const ids = new Set();
  for (const component of editor.circuit.components.values()) { objects.add(component); ids.add(component.refdes); }
  for (const label of editor.circuit.labels.values()) { objects.add(label); ids.add(label.id); }
  editor.beatKnown = { circuit: editor.circuit, objects, ids };
}

/** Parts and labels drawn while a beat is shown appear from that beat on.
 * An object is new when both its id and its instance are: a rename keeps
 * the instance, and a document reload (undo, sync) keeps the ids. */
export function introduceNewBeatObjects() {
  const index = activeBeatIndex();
  if (index !== null) {
    const { circuit: knownCircuit, objects, ids } = editor.beatKnown;
    const isNew = (object, id) => !ids.has(id) && (knownCircuit !== editor.circuit || !objects.has(object));
    const fresh = [
      ...[...editor.circuit.components.values()].filter((c) => isNew(c, c.refdes)).map((c) => c.refdes),
      ...[...editor.circuit.labels.values()].filter((label) => isNew(label, label.id)).map((label) => label.id),
    ];
    if (fresh.length) introduceAt(editor.circuit, index, fresh);
  }
  rememberBeatObjects();
}

function beatStripVisible() {
  return editor.beatStripOpen;
}

/** Show one beat (an index), or the whole drawing (null). */
function setActiveBeat(index, { keepSelection = false } = {}) {
  const beat = index === null ? null : editor.circuit.beats[index];
  editor.activeBeatId = beat?.id || null;
  if (!keepSelection) {
    editor.selectedBeatIds = new Set(beat ? [beat.id] : []);
    editor.beatAnchorId = beat?.id || null;
  }
  if (beat) editor.beatStripOpen = true;
  rememberBeatObjects();
  render();
}

/** Step through All, beat 1, ..., the last beat, stopping at both ends. */
export function stepBeat(delta) {
  if (!editor.circuit.beats.length) {
    hintLine('BEATS: there are no beats yet; + adds one');
    return;
  }
  const index = activeBeatIndex() ?? -1;
  const next = Math.max(-1, Math.min(index + delta, editor.circuit.beats.length - 1));
  if (next !== index) setActiveBeat(next < 0 ? null : next);
}

/** Shift+B: open or close the beat strip. Closing it shows the whole drawing. */
export function toggleBeatStrip() {
  const open = !beatStripVisible();
  editor.beatStripOpen = open;
  if (!open) setActiveBeat(null);
  else render();
}

/** Add a beat after the one on screen (or at the end) and show it. It starts
 * out looking like the beat before it. */
export function addBeatHere() {
  const current = activeBeatIndex();
  const index = current === null ? editor.circuit.beats.length : current + 1;
  commit(() => addBeat(editor.circuit, { index }));
  logLine(`added beat ${index + 1}${editor.circuit.beats.length === 1 ? ' — hide what comes later with h, or dim it with Shift+H' : ''}`);
  setActiveBeat(index);
}

/** Remove beats (indices) as one edit; the others keep their look. */
export function deleteBeats(indices) {
  const doomed = [...new Set(indices)].filter((i) => editor.circuit.beats[i]).sort((a, b) => b - a);
  if (!doomed.length) return;
  const title = doomed.length === 1 ? beatLabel(doomed[0]) : `${doomed.length} beats`;
  const active = activeBeatIndex();
  const keep = active !== null && !doomed.includes(active) ? editor.circuit.beats[active].id : null;
  commit(() => { for (const i of doomed) removeBeat(editor.circuit, i); });
  logLine(`removed ${title}; the other beats look as before`);
  editor.beatStripActive = false;
  const next = keep ? editor.circuit.beats.findIndex((beat) => beat.id === keep) : Math.min(doomed.at(-1), editor.circuit.beats.length - 1);
  setActiveBeat(editor.circuit.beats.length && next >= 0 ? next : null);
}

function deleteBeat(index) {
  deleteBeats(editor.selectedBeatIds.has(editor.circuit.beats[index]?.id) ? selectedBeatIndices() : [index]);
}

export function selectedBeatIndices() {
  return editor.circuit.beats.flatMap((beat, i) => (editor.selectedBeatIds.has(beat.id) ? [i] : []));
}

/** A click on a beat chip: plain shows it (and picks it alone); Ctrl/Cmd
 * toggles it in the picked set and Shift picks the range from the anchor,
 * leaving the beat on screen as it was. */
function clickBeatChip(i, ev) {
  const beat = editor.circuit.beats[i];
  if (!beat) return;
  editor.beatStripActive = true;
  if (ev.shiftKey) {
    const anchor = editor.circuit.beats.findIndex((b) => b.id === editor.beatAnchorId);
    const from = anchor === -1 ? (activeBeatIndex() ?? i) : anchor;
    editor.selectedBeatIds = new Set(editor.circuit.beats.slice(Math.min(from, i), Math.max(from, i) + 1).map((b) => b.id));
  } else if (ev.ctrlKey || ev.metaKey) {
    if (editor.selectedBeatIds.has(beat.id)) editor.selectedBeatIds.delete(beat.id);
    else editor.selectedBeatIds.add(beat.id);
    editor.beatAnchorId = beat.id;
  } else {
    setActiveBeat(i);
    return;
  }
  render();
}

/** Merge the picked beats into one, at the first of them (core/beats.js
 *  mergeBeats): most visible look, switches closed in any, first highlight. */
function mergePickedBeats() {
  const indices = selectedBeatIndices();
  if (indices.length < 2) {
    hintLine('BEATS: Ctrl- or Shift-click two or more beats to merge them');
    return;
  }
  let index = null;
  commit(() => { index = mergeBeats(editor.circuit, indices); });
  if (index === null) return;
  logLine(`merged beats ${indices.map((i) => i + 1).join(', ')} into ${beatLabel(index)}; the other beats look as before`);
  editor.selectedBeatIds = new Set();
  editor.beatStripKey = '';
  setActiveBeat(index);
}

let chipDragged = false;

/** Drag a chip along the strip to move its beat. A press that never leaves
 *  the chip stays a click. */
function beginBeatChipDrag(index, chip, ev) {
  if (ev.button !== 0) return;
  const start = { x: ev.clientX, y: ev.clientY };
  let target = null;
  let dragging = false;
  const clear = () => {
    for (const other of beatListEl.querySelectorAll('.beat-chip-group')) other.classList.remove('drop-before', 'drop-after', 'dragging');
  };
  const move = (moveEv) => {
    if (!dragging && Math.hypot(moveEv.clientX - start.x, moveEv.clientY - start.y) < 6) return;
    dragging = true;
    clear();
    chip.classList.add('dragging');
    const groups = [...beatListEl.querySelectorAll('.beat-chip-group')];
    // The slot the pointer is over: before the first chip whose middle it has
    // not passed, else after the last.
    // Docked in the side panel, the beats run down instead of across.
    const down = beatStripEl.classList.contains('docked');
    const before = groups.findIndex((group) => {
      const rect = group.getBoundingClientRect();
      return down ? moveEv.clientY < rect.top + rect.height / 2 : moveEv.clientX < rect.left + rect.width / 2;
    });
    const slot = before === -1 ? groups.length : before;
    target = slot > index ? slot - 1 : slot;
    if (target === index) return;
    if (before === -1) groups.at(-1)?.classList.add('drop-after');
    else groups[before].classList.add('drop-before');
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    clear();
    if (!dragging) return;
    // The click that ends a drag is not a click on the chip.
    chipDragged = true;
    setTimeout(() => { chipDragged = false; }, 0);
    if (target === null || target === index) return;
    commit(() => moveBeat(editor.circuit, index, target));
    logLine(`moved beat ${index + 1} to ${target + 1}; every beat looks as before`);
    editor.beatStripKey = '';
    render();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

function moveBeatBy(index, delta) {
  const to = index + delta;
  if (to < 0 || to >= editor.circuit.beats.length) return;
  commit(() => moveBeat(editor.circuit, index, to));
  render();
}

/** Beat-listable ids of the selection: parts and labels (an owned label
 * stands for its part). Wires follow what they join. */
function beatSelectionIds() {
  const ids = [...selectedComps().map((c) => c.refdes), ...selectedLabels().map((label) => label.id)]
    .map((id) => beatTargetId(editor.circuit, id))
    .filter(Boolean);
  return [...new Set(ids)];
}

function beatPresence(view, id) {
  if (view.hiddenRefs.has(id) || view.hiddenLabels.has(id)) return 'hide';
  return view.dimRefs.has(id) || view.dimLabels.has(id) ? 'dim' : 'show';
}

const PRESENCE_DONE = { show: 'shown', dim: 'dimmed', hide: 'hidden' };

/** h hides the selection from this beat on, or shows it when all of it is
 * hidden; Shift+H dims it, or shows it when all of it is dimmed. */
export function toggleSelectionInBeat(target = 'hide') {
  const index = activeBeatIndex();
  if (index === null) {
    hintLine(editor.circuit.beats.length ? 'BEATS: pick a beat first — Alt+→ steps into them' : 'BEATS: + adds a beat; then h hides or Shift+H dims the selection in it');
    return;
  }
  const ids = beatSelectionIds();
  if (!ids.length) {
    hintLine('BEATS: select parts or labels to show, dim, or hide — wires follow the parts they join');
    return;
  }
  const view = resolveBeat(editor.circuit, index);
  const presence = ids.every((id) => beatPresence(view, id) === target) ? 'show' : target;
  commit(() => setPresenceFrom(editor.circuit, index, ids, presence));
  logLine(`${PRESENCE_DONE[presence]} from beat ${index + 1}: ${ids.join(', ')}`);
  render();
}

/** The selected switches' groups: each phase once, or a lone switch. */
function selectedSwitchGroups({ onBeat = false } = {}) {
  const groups = [...new Map(selectedComps().filter((c) => switchState(c)).map((c) => [switchGroupKey(c), c])).values()];
  if (!onBeat) return groups;
  // On a beat a phase and its complement flip together already, the other
  // way round.
  return groups.filter((c, i) => !switchPhase(c) || !groups.slice(0, i).some((other) => switchPhase(other) && samePhase(switchGroupKey(other), complementKey(switchGroupKey(c)))));
}

// Plain text for messages: φ_{1} reads φ1, $\phi_1$ reads ϕ1.
export const plainMarkup = plainTexText;
export const beatLabel = (index) => plainMarkup(beatTitle(editor.circuit, index));
const switchGroupName = (c) => (switchPhase(c) ? `${plainMarkup(switchPhase(c))} switches` : c.refdes);

/** s: open or close the selected switches, with the rest of their phases --
 * in the drawing, or from the beat on screen on. */
export function flipSelectedSwitches() {
  const index = activeBeatIndex();
  const groups = selectedSwitchGroups({ onBeat: index !== null });
  if (!groups.length) {
    hintLine('SWITCH: select a switch to open or close it (with every switch on its phase)');
    return;
  }
  const stateOf = (c) => (index === null ? switchState(c) : switchStateAt(editor.circuit, c.refdes, index));
  const next = groups.every((c) => stateOf(c) === 'closed') ? 'open' : 'closed';
  commit(() => {
    for (const c of groups) {
      if (index === null) editor.circuit.setSwitchState(c.refdes, next);
      else setSwitchFrom(editor.circuit, index, c.refdes, next);
    }
  });
  logLine(`${groups.map(switchGroupName).join(', ')} ${next}${index === null ? '' : ` from beat ${index + 1}`}`);
  render();
}

function beatHintText(index) {
  if (!editor.circuit.beats.length) return '+ adds a beat; it starts as a copy of the one before.';
  if (index === null) return 'Whole drawing. Alt+→ steps into the beats.';
  return 'Faintest: hidden here. h hides · Shift+H dims · from this beat on · s flips a switch · drawing edits reach every beat.';
}

/** The strip's dot for one beat: how does the selection look in it? */
function beatDotState(view, ids) {
  const looks = new Set(ids.map((id) => beatPresence(view, id)));
  if (looks.size > 1) return 'mixed';
  return { show: 'shown', dim: 'dimmed', hide: 'hidden' }[[...looks][0]];
}

export function renderBeatStrip() {
  if (!beatStripEl || !beatListEl) return;
  const visible = beatStripVisible();
  const index = activeBeatIndex();
  if (editor.activeBeatId && index === null) editor.activeBeatId = null;
  const ids = visible ? beatSelectionIds() : [];
  // Stepping between beats only moves the pressed chip: rebuilding the chips
  // under a click would swallow a double-click on the same chip.
  for (const id of [...editor.selectedBeatIds]) if (!editor.circuit.beats.some((beat) => beat.id === id)) editor.selectedBeatIds.delete(id);
  const syncPressed = () => {
    beatListEl.querySelector('.beat-chip-all')?.setAttribute('aria-pressed', String(index === null));
    for (const chip of beatListEl.querySelectorAll('[data-beat-index]')) {
      const i = Number(chip.dataset.beatIndex);
      chip.setAttribute('aria-pressed', String(i === index));
      chip.classList.toggle('picked', editor.selectedBeatIds.size > 1 && editor.selectedBeatIds.has(editor.circuit.beats[i]?.id));
    }
    if (beatHintEl) {
      beatHintEl.textContent = editor.selectedBeatIds.size > 1
        ? `${editor.selectedBeatIds.size} beats picked — Delete removes them · right-click to merge them · Esc lets go`
        : beatHintText(index);
    }
  };
  const key = `${visible}|${editor.modelRevision}|${editor.circuit.beats.length}|${ids.join(',')}|${editor.circuit.beats.map((beat) => beat.name).join('|')}`;
  if (key === editor.beatStripKey && beatStripEl.hidden === !visible) {
    syncPressed();
    return;
  }
  editor.beatStripKey = key;
  const opening = visible && beatStripEl.hidden;
  beatStripEl.hidden = !visible;
  document.getElementById('btn-beats')?.setAttribute('aria-checked', String(visible));
  document.getElementById('btn-window-beats')?.setAttribute('aria-pressed', String(visible));
  if (!visible) return;
  if (opening) beatWindow?.place();
  const views = ids.length ? allBeatViews() : [];
  const chips = [];
  const all = document.createElement('button');
  all.type = 'button';
  all.className = 'beat-chip beat-chip-all';
  all.textContent = 'All';
  all.title = 'Show and edit the whole drawing';
  all.setAttribute('aria-pressed', String(index === null));
  all.addEventListener('click', () => setActiveBeat(null));
  chips.push(all);
  editor.circuit.beats.forEach((beat, i) => {
    const chip = document.createElement('span');
    chip.className = 'beat-chip-group';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'beat-chip';
    button.dataset.beatIndex = String(i);
    button.setAttribute('aria-pressed', String(i === index));
    button.title = beatLabel(i);
    const number = document.createElement('span');
    number.className = 'beat-chip-number';
    number.textContent = String(i + 1);
    button.appendChild(number);
    if (beat.name) {
      const name = document.createElement('span');
      name.className = 'beat-chip-name';
      appendMarkupText(name, texToLabelMarkup(beat.name));
      button.appendChild(name);
    }
    // The canvas keeps the keyboard, so h, s, and friends still work.
    button.addEventListener('mousedown', (ev) => ev.preventDefault());
    button.addEventListener('pointerdown', (ev) => beginBeatChipDrag(i, chip, ev));
    button.addEventListener('click', (ev) => {
      if (!chipDragged) clickBeatChip(i, ev);
    });
    button.addEventListener('dblclick', () => startBeatRename(i, button));
    button.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      openBeatMenu(i, ev.clientX, ev.clientY);
    });
    chip.appendChild(button);
    if (ids.length) {
      const state = beatDotState(views[i], ids);
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'beat-dot';
      dot.dataset.state = state;
      const what = ids.length === 1 ? ids[0] : 'the selection';
      const show = state === 'hidden';
      dot.title = `${{ shown: 'Shown', dimmed: 'Dimmed', hidden: 'Hidden', mixed: 'Mixed' }[state]} in beat ${i + 1} — click to ${show ? 'show' : 'hide'} ${what} in this beat only`;
      dot.setAttribute('aria-label', dot.title);
      dot.addEventListener('click', () => {
        commit(() => setPresenceAt(editor.circuit, i, ids, show ? 'show' : 'hide'));
        logLine(`${show ? 'shown' : 'hidden'} in beat ${i + 1} only: ${ids.join(', ')}`);
        render();
      });
      chip.appendChild(dot);
    }
    chips.push(chip);
  });
  beatListEl.replaceChildren(...chips);
  syncPressed();
}

function startBeatRename(index, button) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'beat-rename';
  input.value = editor.circuit.beats[index]?.name || '';
  input.placeholder = `Beat ${index + 1}`;
  input.setAttribute('aria-label', `Name of beat ${index + 1}`);
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    if (save && editor.circuit.beats[index] && input.value.trim() !== editor.circuit.beats[index].name) {
      commit(() => renameBeat(editor.circuit, index, input.value));
    }
    editor.beatStripKey = '';
    render();
    canvasEl.focus({ preventScroll: true });
  };
  input.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') finish(true);
    else if (ev.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  button.replaceWith(input);
  input.focus();
  input.select();
}

function openBeatMenu(index, x, y) {
  const menu = openMenuAt(x, y, beatLabel(index));
  if (!menu) return;
  const group = document.createElement('div');
  group.className = 'context-menu-group';
  const chip = () => beatListEl.querySelector(`[data-beat-index="${index}"]`);
  appendContextItem(group, 'Rename…', () => setTimeout(() => { if (chip()) startBeatRename(index, chip()); }, 0), { shortcut: 'dbl-click' });
  appendContextItem(group, 'Add beat after', () => { setActiveBeat(index); addBeatHere(); }, { shortcut: '+' });
  appendContextItem(group, 'Move earlier', () => moveBeatBy(index, -1), { disabled: index === 0 });
  appendContextItem(group, 'Move later', () => moveBeatBy(index, 1), { disabled: index === editor.circuit.beats.length - 1 });
  appendContextItem(group, 'Present from here', () => openPresenter(index), { shortcut: 'Shift+F5' });
  const picked = editor.selectedBeatIds.has(editor.circuit.beats[index]?.id) ? editor.selectedBeatIds.size : 1;
  if (picked > 1) appendContextItem(group, `Merge ${picked} beats`, () => mergePickedBeats());
  appendContextItem(group, picked > 1 ? `Delete ${picked} beats` : 'Delete beat', () => deleteBeat(index), { danger: true, shortcut: 'Del' });
  menu.appendChild(group);
  const rect = menu.getBoundingClientRect();
  if (rect.bottom > window.innerHeight - 4) menu.style.top = `${Math.max(4, window.innerHeight - 4 - rect.height)}px`;
  menu.querySelector('button:not(:disabled)')?.focus();
}

/** One beat per state of the timing diagram, or without one per switch
 * phase: what still works shown, the rest dimmed (core/beats.js
 * phaseBeats). With beats already there, asks whether the new ones replace
 * them or follow the beat on screen. */
async function addPhaseBeats() {
  const existing = editor.circuit.beats.length;
  let replace = false;
  // Without phases there is nothing to ask about: phaseBeats says so.
  if (existing && switchPhases(editor.circuit).length) {
    const after = activeBeatIndex() === null ? 'at the end' : 'after the beat on screen';
    const choice = await chooseAction({
      title: 'Beats already exist',
      message: `The drawing has ${existing} beat${existing === 1 ? '' : 's'}. Replace ${existing === 1 ? 'it' : 'them'} with the new beats, or add the new ones ${after}?`,
      choices: [{ value: 'replace', label: 'Replace', danger: true }, { value: 'append', label: 'Append' }],
    });
    if (!choice) return;
    replace = choice === 'replace';
  }
  const current = activeBeatIndex();
  const index = replace ? 0 : current === null ? editor.circuit.beats.length : current + 1;
  let count = 0;
  // A drawn timing diagram says which phases close together: one beat per
  // state it steps through. Without one, a beat per phase.
  const states = timingStates(editor.circuit);
  commit(() => { count = phaseBeats(editor.circuit, { index, states, replace }); });
  if (!count) return;
  noteTip('phase-beats');
  const what = replace ? `replaced the beats with ${count}` : `added ${count}`;
  logLine(states
    ? `${what} beats, one per state of the timing diagram: phases high together close together, and what they cut off is dimmed`
    : `${what} phase beats: each dims its open switches and whatever they cut off (draw a timing diagram to close phases together)`);
  setActiveBeat(index);
}

/** The timing diagram editor: a grid of slots, one row per phase, beside
 * the drawing. A cursor moves over it: 1, 0 and x set a slot, Space flips
 * one, + repeats the cursor's slot in every row (a state held one slot
 * longer), * the whole sequence, Delete removes it. Every change redraws the diagram in place, and
 * the whole session is one undo entry (core/timing-diagram.js). */
let timingEditor = null;
// Slots a first signal starts with, in a diagram with no rows yet.
const EMPTY_SIGNAL_SLOTS = 4;

function syncTimingToggle() {
  document.getElementById('btn-timing-diagram')?.setAttribute('aria-checked', String(!!timingEditor));
  document.getElementById('btn-window-timing')?.setAttribute('aria-pressed', String(!!timingEditor));
}

// The beats float over the drawing, at the bottom until moved.
let beatWindow = null;

/** The editor follows the drawing: an undo or a script under it. */
export function syncTimingEditor() {
  timingEditor?.follow();
}

/** Shift+K and the menu item open the editor, or close it when it is open,
 * as the other panels' keys do. */
export function toggleTimingDialog() {
  if (timingEditor) timingEditor.close();
  else openTimingDialog();
}

function openTimingDialog() {
  noteTip('timing-open');
  if (timingEditor) {
    timingEditor.grid.focus();
    return;
  }
  let sources;
  try {
    sources = timingRowSources(editor.circuit);
  } catch (err) {
    logLine(err.message, 'error');
    return;
  }
  // With no switch phases it opens empty: signals are added by name.
  const before = existingTimingDiagram(editor.circuit);
  const rows = [];
  const state = {
    cursor: { row: 0, slot: 0 },
    slot: DEFAULT_SLOT_CELLS,
    gaps: 'none',
    session: null,
    place: false,
    // Arrows, marks and spans on the edges (edge: { row: phase key, at:
    // slot boundary }), and an arrow or span begun at an edge, waiting for
    // its other end.
    notes: { arrows: [], marks: [], spans: [] },
    pending: null,
    // A number being typed into the cursor's slot (.35, -0.5), or null.
    entry: null,
    // The model revision the editor's rows were read at or last wrote.
    seen: null,
  };
  // The rows and settings as the drawing has them: when the editor opens,
  // and again whenever the drawing changed under it (an undo, a redo, a
  // script), so its next edit starts from what is drawn, not from what the
  // editor held before.
  const readDrawing = (found = timingRowSources(editor.circuit)) => {
    const drawn = existingTimingDiagram(editor.circuit);
    // The rows' own waves; a complement with none follows its phase inverted.
    // An older diagram's don't-care slots read as low.
    rows.splice(0, rows.length, ...found.map((row) => ({
      key: row.key,
      source: row.source,
      // The row a complement follows, by its phase (rows can be reordered).
      baseKey: row.complementOf !== undefined ? found[row.complementOf].key : undefined,
      follows: row.from === 'complement',
      signal: !!row.signal,
      // An analog row's values, as text (0.35); a digital row's 1s and 0s.
      analog: !!row.values,
      hold: !!row.hold,
      height: row.height || 2,
      wave: row.values ? row.values.map(String) : row.from === 'complement' ? [] : [...row.bits].map((level) => (level === '1' ? '1' : '0')),
      shift: drawn?.shifts.get(row.key) || { fall: 0, rise: 0 },
    })));
    state.slot = drawn?.slot || DEFAULT_SLOT_CELLS;
    state.gaps = drawn?.gaps ?? 'none';
    state.notes = { arrows: [...(drawn?.arrows || [])], marks: [...(drawn?.marks || [])], spans: (drawn?.spans || []).map((span) => ({ ...span })) };
    state.pending = null;
    state.session = null;
    state.cursor.row = Math.max(0, Math.min(state.cursor.row, rows.length - 1));
    state.seen = { circuit: editor.circuit, revision: editor.modelRevision };
  };
  readDrawing(sources);
  const length = () => Math.max(1, ...rows.map((row) => row.wave.length));
  const at = (row, slot) => (row.wave.length ? row.wave[Math.min(slot, row.wave.length - 1)] : '0');
  const baseOf = (row) => rows.find((other) => other.key === row.baseKey);
  const shown = (row, slot) => (row.follows ? { 0: '1', 1: '0' }[at(baseOf(row), slot)] : at(row, slot));
  // Give every row a full-length wave before an edit, so columns line up.
  const settle = () => {
    const n = length();
    for (const row of rows) if (!row.follows) row.wave = Array.from({ length: n }, (_, i) => at(row, i));
  };
  const detach = (row) => {
    if (!row.follows) return;
    row.wave = Array.from({ length: length() }, (_, i) => shown(row, i));
    row.follows = false;
  };

  // The edge at the cursor: its row's change of level at the left of the
  // cursor's slot (the empty cell after the last: the edge after it). The
  // waves repeat, so the first slot's edge comes from the last.
  const edgeRef = (r, slot) => ({ row: rows[r].key, at: slot });
  const levelAround = (row, at) => {
    const n = length();
    return [shown(row, (at + n - 1) % n), shown(row, at % n)];
  };
  // An analog row's every slot start is a point arrows, marks and spans take.
  const hasEdge = (r, at) => {
    if (rows[r].analog) return at >= 0 && at <= length();
    const [a, b] = levelAround(rows[r], at);
    return a !== b;
  };
  const sameRef = (a, b) => samePhase(a.row, b.row) && a.at === b.at;
  const usesEdge = (ref) => state.notes.marks.some((mark) => sameRef(mark, ref))
    || [...state.notes.arrows, ...state.notes.spans].some((item) => sameRef(item.from, ref) || sameRef(item.to, ref));
  const edgeName = (ref) => {
    const r = rows.findIndex((row) => samePhase(row.key, ref.row));
    if (r < 0) return `${plainMarkup(ref.row)} ${ref.at + 1}`;
    if (rows[r].analog) return `${plainMarkup(rows[r].source)} ${at(rows[r], ref.at)} @${ref.at + 1}`;
    const [a, b] = levelAround(rows[r], ref.at);
    return `${plainMarkup(rows[r].source)} ${a === b ? '·' : b === '1' ? '↑' : '↓'}${ref.at + 1}`;
  };

  const grid = element('div', { class: 'timing-grid', tabindex: '0', role: 'grid', 'aria-label': 'Timing slots: arrows move, 1 and 0 set, Space flips, + repeats a slot, Delete removes it' });
  const pairsBox = element('div', { class: 'timing-section timing-pairs' });
  const status = element('p', { class: 'timing-dialog-status', role: 'status' });

  const redraw = () => {
    const bits = {};
    const hold = {};
    const heights = {};
    for (const row of rows) {
      if (!row.follows) bits[row.key] = row.analog ? row.wave.map(Number) : row.wave.join('');
      if (row.analog) hold[row.key] = row.hold;
      heights[row.key] = row.height || 2;
    }
    const shifts = Object.fromEntries(rows.map((row) => [row.key, row.shift]));
    const order = rows.map((row) => row.key);
    const place = state.place;
    state.place = false;
    // Signals added or removed here since the diagram was last drawn.
    const drawnRows = timingPhases(editor.circuit);
    const add = rows.filter((row) => row.signal && !drawnRows.some((phase) => samePhase(phase.key, row.key))).map((row) => row.source);
    const remove = drawnRows.filter((phase) => phase.signal && !rows.some((row) => samePhase(row.key, phase.key))).map((phase) => phase.source);
    const start = snapshot();
    try {
      if (rows.length) addTimingDiagram(editor.circuit, { bits, hold, heights, slot: state.slot, gaps: state.gaps, shifts, order, place, fromBeats: true, add, remove, ...state.notes });
      else removeTimingDiagram(editor.circuit);
    } catch (err) {
      status.textContent = err.message;
      return;
    }
    status.textContent = '';
    renderNotes();
    if (snapshot() === start) return;
    // One undo entry for the session, unless something else was edited since.
    const first = !state.session;
    if (!state.session || state.session.revision !== editor.modelRevision) recordHistoryEntry(start, true, 'none');
    markModelChanged();
    if (!state.session) noteTip('timing-drawn');
    state.session = { revision: editor.modelRevision };
    state.seen = { circuit: editor.circuit, revision: editor.modelRevision };
    if (first && !before) fitView({ animate: true });
    render();
  };

  // Which pairs (of phase keys) are kept apart now: the explicit list, or
  // what 'auto' picks.
  const samePair = ([a, b], [x, y]) => (a === x && b === y) || (a === y && b === x);
  const activePairs = () => {
    if (state.gaps === 'none') return [];
    if (Array.isArray(state.gaps)) return state.gaps;
    const waves = rows.map((row) => (row.follows ? '' : row.wave.join('')));
    return defaultTimingPairs(waves, new Set(rows.flatMap((row, index) => (row.baseKey !== undefined || row.signal ? [index] : []))))
      .map(([a, b]) => [rows[a].key, rows[b].key]);
  };
  // A row's name as the grid shows it: TeX drawn as markup, a bar spelled out.
  const nameText = (target, source) => {
    if (/\\(?:overline|bar)\{/.test(source)) target.textContent = plainMarkup(source);
    else appendMarkupText(target, texToLabelMarkup(source));
    return target;
  };
  // The pairs as a square of checkboxes, the rows' names along the top and
  // the left; both halves are the same pair, and the diagonal is blocked, as
  // a row cannot overlap itself.
  const renderPairs = () => {
    pairsBox.replaceChildren();
    // An analog row has no edges to keep apart.
    const own = rows.filter((row) => row.baseKey === undefined && !row.analog);
    const active = activePairs();
    const head = element('div', { class: 'timing-dialog-options' });
    const body = element('div', { class: 'timing-pairs-body' }, [head]);
    pairsBox.append(element('span', { class: 'timing-pairs-title', text: 'Non-overlap', title: 'Non-overlap pairs' }), body);
    const auto = element('button', { type: 'button', class: 'timing-chip', text: 'Auto', 'aria-pressed': String(state.gaps === 'auto'), title: 'Auto non-overlap' });
    auto.addEventListener('click', () => { state.gaps = state.gaps === 'auto' ? activePairs() : 'auto'; renderPairs(); redraw(); });
    head.append(auto);
    if (own.length < 2) {
      head.append(element('span', { class: 'timing-pairs-none', text: 'two rows needed' }));
      return;
    }
    const matrix = element('table', { class: 'timing-pairs-matrix' });
    matrix.append(element('tr', {}, [element('th', {}), ...own.map((row) => nameText(element('th', { scope: 'col' }), row.source))]));
    for (const a of own) {
      const cells = own.map((b) => {
        if (a === b) return element('td', { class: 'blocked', 'aria-hidden': 'true' });
        const pair = [a.key, b.key];
        const on = active.some((other) => samePair(other, pair));
        const box = element('input', { type: 'checkbox', 'aria-label': `${plainMarkup(a.source)} and ${plainMarkup(b.source)} never overlap` });
        box.checked = on;
        box.addEventListener('change', () => {
          const next = activePairs().filter((other) => !samePair(other, pair));
          if (box.checked) next.push(pair);
          state.gaps = next.length ? next : 'none';
          renderPairs();
          redraw();
        });
        return element('td', {}, [box]);
      });
      matrix.append(element('tr', {}, [nameText(element('th', { scope: 'row' }), a.source), ...cells]));
    }
    body.append(matrix);
  };

  const renderGrid = () => {
    grid.replaceChildren();
    // Analog values need wider slots; every row's, so the columns line up.
    grid.classList.toggle('has-analog', rows.some((row) => row.analog));
    const n = length();
    state.cursor.slot = Math.min(state.cursor.slot, n);
    rows.forEach((row, r) => {
      const name = nameText(element('span', { class: 'timing-grid-name' }), row.source);
      if (row.follows) name.title = `${plainMarkup(baseOf(row).source)} inverted`;
      const cells = element('span', { class: `timing-grid-row${row.follows ? ' follows' : ''}` });
      for (let slot = 0; slot < n; slot += 1) {
        const level = shown(row, slot);
        const here = state.cursor.row === r && state.cursor.slot === slot;
        // An analog slot shows its value as a fill from the bottom (or,
        // below zero, down from the middle) and as a number.
        const cell = row.analog
          ? element('span', {
            class: `timing-cell analog${Number(level) < 0 ? ' negative' : ''}${here ? ' cursor' : ''}`, role: 'gridcell', title: level,
            style: `--v: ${Math.abs(Number(level))}`,
            text: here && state.entry !== null ? `${state.entry}▏` : String(level).replace(/^(-?)0\./, '$1.'),
          })
          : element('span', { class: `timing-cell level-${level}${here ? ' cursor' : ''}`, role: 'gridcell' });
        cell.addEventListener('mousedown', (event) => {
          event.preventDefault();
          state.cursor = { row: r, slot };
          grid.focus();
          // A click flips a digital slot; an analog one it picks.
          if (row.analog) renderGrid();
          else setCell(level === '1' ? '0' : '1');
        });
        edgeHandle(cell, r, slot);
        cells.append(cell);
      }
      // After the last slot, an empty cell to type a new one into.
      const typingHere = state.cursor.row === r && state.cursor.slot === n;
      const add = element('span', {
        class: `timing-cell new${row.analog ? ' analog' : ''}${typingHere ? ' cursor' : ''}`, title: 'Add a slot',
        ...(typingHere && state.entry !== null ? { text: `${state.entry}▏` } : {}),
      });
      add.addEventListener('mousedown', (event) => {
        event.preventDefault();
        state.cursor = { row: r, slot: n };
        grid.focus();
        renderGrid();
      });
      edgeHandle(add, r, n);
      cells.append(add);
      const edge = (arrow, cells) => (cells ? `${arrow}${cells > 0 ? '+' : '−'}${Math.abs(cells)}` : '');
      const shift = element('span', {
        class: 'timing-shift',
        text: [edge('↓', row.shift.fall), edge('↑', row.shift.rise)].filter(Boolean).join(' '),
        title: row.shift.fall || row.shift.rise
          ? `Falls ${Math.abs(row.shift.fall)} cell${Math.abs(row.shift.fall) === 1 ? '' : 's'} ${row.shift.fall < 0 ? 'early' : 'late'}, rises ${Math.abs(row.shift.rise)} ${row.shift.rise < 0 ? 'early' : 'late'} ([ ] and { } move them)`
          : 'Edges on the slot boundaries ([ ] move the falls, { } the rises)',
      });
      grid.append(element('div', { class: 'timing-grid-line' }, [name, cells, shift]));
    });
    const count = element('div', { class: 'timing-grid-foot', text: !rows.length ? 'no rows yet: add a signal below'
      : state.cursor.slot < n ? `slot ${state.cursor.slot + 1} of ${n}` : `after slot ${n}: type to add one` });
    grid.append(count);
    removeRow.disabled = !rows[state.cursor.row]?.signal;
    const cursorRow = rows[state.cursor.row];
    analogButton.disabled = !cursorRow?.signal;
    analogButton.setAttribute('aria-pressed', String(!!cursorRow?.analog));
    holdButton.disabled = !cursorRow?.analog;
    holdButton.setAttribute('aria-pressed', String(!!cursorRow?.hold));
    tallerButton.disabled = !cursorRow || (cursorRow.height || 2) >= MAX_ROW_CELLS;
    shorterButton.disabled = !cursorRow || (cursorRow.height || 2) <= 2;
    for (const button of edgeButtons) button.disabled = !cursorRow || !!cursorRow.analog;
  };

  // An edge between two slots, where the row changes level: a click puts
  // the cursor on it (without flipping the slot), or ends the arrow or span
  // begun at another.
  function edgeHandle(cell, r, at) {
    if (!hasEdge(r, at)) return;
    const ref = edgeRef(r, at);
    const pending = state.pending && sameRef(state.pending.from, ref);
    const handle = element('span', {
      class: `timing-edge${usesEdge(ref) ? ' used' : ''}${pending ? ' pending' : ''}`,
      title: state.pending ? `${edgeName(ref)}: click to end the ${state.pending.kind} here` : `${edgeName(ref)}: click to pick this edge (a arrow, m mark, s span)`,
    });
    handle.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      state.cursor = { row: r, slot: at };
      grid.focus();
      if (state.pending) noteAt(state.pending.kind);
      else renderGrid();
    });
    cell.append(handle);
  }

  const change = () => { renderGrid(); renderPairs(); redraw(); };

  // Arrows, marks and spans: `kind` at the edge under the cursor. A mark
  // goes on (or comes off) at once; an arrow or a span begins there and
  // ends at the next edge picked the same way.
  const noteAt = (kind) => {
    const { row: r, slot } = state.cursor;
    if (!rows[r]) return;
    const ref = edgeRef(r, slot);
    if (!hasEdge(r, slot)) {
      status.textContent = `${plainMarkup(rows[r].source)} has no edge at the start of slot ${slot + 1}: put the cursor on a slot whose row changes level as it begins`;
      return;
    }
    status.textContent = '';
    if (kind === 'mark') {
      const at = state.notes.marks.findIndex((mark) => sameRef(mark, ref));
      if (at >= 0) state.notes.marks.splice(at, 1);
      else state.notes.marks.push(ref);
      state.pending = null;
    } else if (!state.pending || state.pending.kind !== kind) {
      state.pending = { kind, from: ref };
      renderGrid();
      renderNotes();
      return;
    } else {
      const { from } = state.pending;
      state.pending = null;
      if (sameRef(from, ref)) {
        status.textContent = `${kind === 'arrow' ? 'an arrow' : 'a span'} runs between two edges: pick another`;
        renderGrid();
        renderNotes();
        return;
      }
      const list = kind === 'arrow' ? state.notes.arrows : state.notes.spans;
      if (!list.some((item) => sameRef(item.from, from) && sameRef(item.to, ref))) list.push(kind === 'arrow' ? { from, to: ref } : { from, to: ref, text: '' });
    }
    change();
    // A new span asks for its text.
    if (kind === 'span') notesBox.querySelector('.timing-note:last-of-type input')?.focus();
  };
  const cancelPending = () => {
    if (!state.pending) return false;
    state.pending = null;
    renderGrid();
    renderNotes();
    return true;
  };
  // Slots inserted or removed move the edges after them along.
  const moveEdges = (from, by) => {
    const move = (ref) => (ref.at > from ? { ...ref, at: ref.at + by } : ref);
    state.notes.marks = state.notes.marks.map(move);
    state.notes.arrows = state.notes.arrows.map((item) => ({ ...item, from: move(item.from), to: move(item.to) }));
    state.notes.spans = state.notes.spans.map((item) => ({ ...item, from: move(item.from), to: move(item.to) }));
    if (state.pending) state.pending = { ...state.pending, from: move(state.pending.from) };
  };
  const notesBox = element('div', { class: 'timing-section timing-notes' });
  function renderNotes() {
    notesBox.replaceChildren();
    const missing = existingTimingDiagram(editor.circuit)?.missing || [];
    const list = element('div', { class: 'timing-note-list' });
    const item = (kind, index, text, extra = []) => {
      const gone = missing.some((m) => m.kind === kind && m.index === index);
      const remove = element('button', { type: 'button', class: 'icon-button', 'aria-label': `Remove the ${kind}`, title: `Remove the ${kind}` }, [buttonIcon('trash')]);
      remove.addEventListener('click', () => {
        state.notes[`${kind}s`].splice(index, 1);
        change();
        grid.focus();
      });
      list.append(element('div', { class: `timing-note${gone ? ' missing' : ''}`, title: gone ? 'Its edge has gone; it is drawn again when the edge comes back' : '' }, [
        element('span', { class: 'timing-note-kind', text: kind }),
        element('span', { class: 'timing-note-edges', text }),
        ...extra,
        remove,
      ]));
    };
    // An arrow's and a span's text, typed in place.
    const textField = (note, placeholder, label) => {
      const input = element('input', { type: 'text', value: note.text || '', placeholder, 'aria-label': label, spellcheck: 'false' });
      input.addEventListener('change', () => { note.text = input.value.trim(); redraw(); });
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        input.blur();
        grid.focus();
      });
      return input;
    };
    state.notes.arrows.forEach((arrow, index) => item('arrow', index, `${edgeName(arrow.from)} → ${edgeName(arrow.to)}`, [textField(arrow, 'text (optional)', 'Arrow text')]));
    state.notes.marks.forEach((mark, index) => item('mark', index, edgeName(mark)));
    state.notes.spans.forEach((span, index) => item('span', index, `${edgeName(span.from)} ↔ ${edgeName(span.to)}`, [textField(span, 'text, e.g. $t_{su}$', 'Span text')]));
    const hint = state.pending
      ? `${state.pending.kind === 'arrow' ? 'Arrow' : 'Span'} from ${edgeName(state.pending.from)}: pick the other edge (${state.pending.kind === 'arrow' ? 'a' : 's'} at the cursor, or click it); Esc cancels`
      : !state.notes.arrows.length && !state.notes.marks.length && !state.notes.spans.length ? 'Put the cursor on an edge (or click one) to draw on it' : '';
    notesBox.append(
      element('span', { class: 'timing-pairs-title', text: 'On the edges', title: 'Arrows, marks, and spans' }),
      element('div', { class: 'timing-dialog-options' }, [
        element('div', { class: 'segmented', role: 'group', 'aria-label': 'On the edges' }, [
          noteButton('Arrow', 'An arrow from the edge at the cursor to the edge it causes: then pick that one (a)', 'arrow'),
          noteButton('Mark', 'A dashed line through every row at the edge at the cursor; again takes it away (m)', 'mark'),
          noteButton('Span', 'A time between the edge at the cursor and another: dashed lines and an arrow below the diagram, its text under it (s)', 'span'),
        ]),
      ]),
      ...(hint ? [element('p', { class: 'timing-note-hint', text: hint })] : []),
      list,
    );
  }
  function noteButton(text, title, kind) {
    const node = element('button', { type: 'button', text, title, 'aria-pressed': String(state.pending?.kind === kind) });
    node.addEventListener('click', () => { grid.focus(); noteAt(kind); });
    return node;
  }
  const setCell = (level, { advance = false } = {}) => {
    const row = rows[state.cursor.row];
    if (!row) return;
    // A value between the levels makes a signal analog; a switch phase
    // stays 1 or 0, as its switches are.
    if (!['0', '1'].includes(level) && !row.analog) {
      if (!row.signal) {
        status.textContent = `${plainMarkup(row.source)} is a switch phase: its slots are 1 or 0 (an analog row is a signal you add)`;
        return;
      }
      row.analog = true;
    }
    detach(row);
    settle();
    // The empty cell after the last slot adds a slot: every other row holds
    // its last level into it.
    if (state.cursor.slot >= length()) for (const r of rows) if (!r.follows) r.wave.push(r.wave.at(-1) ?? '0');
    row.wave[state.cursor.slot] = level;
    if (advance) state.cursor.slot = Math.min(state.cursor.slot + 1, length());
    change();
  };
  // A signal of the diagram's own, not tied to a switch: low throughout to
  // start with, as long as the other rows.
  const addSignal = (name) => {
    const source = name.trim();
    if (!source) return false;
    const key = phaseKey(source);
    if (rows.some((row) => samePhase(row.key, key))) {
      status.textContent = `the diagram has ${source} already`;
      return false;
    }
    settle();
    rows.push({ key, source, signal: true, follows: false, wave: Array.from({ length: rows.length ? length() : EMPTY_SIGNAL_SLOTS }, () => '0'), shift: { fall: 0, rise: 0 } });
    state.cursor = { row: rows.length - 1, slot: 0 };
    change();
    return true;
  };
  const removeSignal = () => {
    const row = rows[state.cursor.row];
    if (!row?.signal) return;
    rows.splice(state.cursor.row, 1);
    // What sat on its edges goes with it.
    const on = (ref) => samePhase(ref.row, row.key);
    state.notes.marks = state.notes.marks.filter((mark) => !on(mark));
    state.notes.arrows = state.notes.arrows.filter((item) => !on(item.from) && !on(item.to));
    state.notes.spans = state.notes.spans.filter((item) => !on(item.from) && !on(item.to));
    if (state.pending && on(state.pending.from)) state.pending = null;
    // A complement that followed it keeps the wave it showed.
    for (const other of rows) {
      if (other.baseKey !== undefined && samePhase(other.baseKey, row.key)) {
        if (other.follows) other.wave = Array.from({ length: length() }, (_, i) => ({ 0: '1', 1: '0' })[at(row, i)]);
        other.follows = false;
        other.baseKey = undefined;
      }
    }
    state.cursor.row = Math.max(0, Math.min(state.cursor.row, rows.length - 1));
    change();
  };
  // Move the cursor row up (-1) or down a row; the order is the diagram's.
  const moveRow = (by) => {
    const from = state.cursor.row;
    const to = from + by;
    if (to < 0 || to >= rows.length) return;
    [rows[from], rows[to]] = [rows[to], rows[from]];
    state.cursor.row = to;
    change();
  };
  // Move the cursor row's falling or rising edges a cell earlier (-1) or later.
  const shiftEdge = (edge, by) => {
    const row = rows[state.cursor.row];
    if (!row || row.analog) return;
    row.shift = { ...row.shift, [edge]: Math.max(-MAX_EDGE_SHIFT, Math.min(MAX_EDGE_SHIFT, row.shift[edge] + by)) };
    change();
  };
  // At the empty cell after the end, these act on the last slot.
  const cursorSlot = () => Math.min(state.cursor.slot, length() - 1);
  const repeatSlot = () => {
    settle();
    const slot = cursorSlot();
    for (const row of rows) if (!row.follows) row.wave.splice(slot + 1, 0, row.wave[slot]);
    moveEdges(slot, 1);
    state.cursor.slot = slot + 1;
    change();
  };
  // Repeat the whole sequence once, every row's wave copied after itself,
  // for a second period to edit afterwards.
  const repeatSequence = () => {
    settle();
    const n = length();
    for (const row of rows) if (!row.follows) row.wave = [...row.wave, ...row.wave];
    state.cursor.slot = Math.min(state.cursor.slot + n, length());
    change();
  };
  const removeSlot = () => {
    settle();
    if (length() <= 1) return;
    const slot = cursorSlot();
    for (const row of rows) if (!row.follows) row.wave.splice(slot, 1);
    moveEdges(slot, -1);
    state.cursor.slot = Math.min(slot, length() - 1);
    change();
  };
  // A number typed into a slot: `.` or `-` begins it (F2 with the slot's
  // own value), digits go on, and the next key sets it -- Enter, Tab or
  // Space and moving on, an arrow and going that way; Esc drops it.
  const commitEntry = ({ advance }) => {
    const text = state.entry;
    state.entry = null;
    let value;
    try {
      value = parseTimingValue(text);
    } catch (err) {
      status.textContent = err.message;
      renderGrid();
      return;
    }
    setCell(String(value), { advance });
  };
  const onEntryKey = (event) => {
    const key = event.key;
    if (/^[0-9]$/.test(key) || (key === '.' && !state.entry.includes('.')) || (key === '-' && state.entry === '')) state.entry += key;
    else if (key === 'Backspace') state.entry = state.entry.slice(0, -1);
    else if (key === 'Escape') state.entry = null;
    else if (['Enter', 'Tab', ' '].includes(key)) commitEntry({ advance: true });
    else if (key.startsWith('Arrow') || key === 'Home' || key === 'End') {
      commitEntry({ advance: false });
      return false;
    } else return true;
    event.preventDefault();
    event.stopPropagation();
    renderGrid();
    return true;
  };
  grid.addEventListener('keydown', (event) => {
    // A number being typed takes its keys; one it does not take (an arrow)
    // sets it and goes on to do what it does.
    if (state.entry !== null && onEntryKey(event)) return;
    if ((event.key === '.' || event.key === '-' || event.key === 'F2') && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const current = rows[state.cursor.row];
      if (!current) return;
      event.preventDefault();
      state.entry = event.key === 'F2' ? (current.analog && state.cursor.slot < length() ? at(current, state.cursor.slot) : '') : event.key;
      renderGrid();
      return;
    }
    const { row, slot } = state.cursor;
    const move = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[event.key];
    if (move && event.altKey && move[0]) {
      moveRow(move[0]);
    } else if (move) {
      state.cursor = { row: Math.max(0, Math.min(rows.length - 1, row + move[0])), slot: Math.max(0, Math.min(length(), slot + move[1])) };
      renderGrid();
    } else if (event.key === 'Home' || event.key === 'End') {
      state.cursor.slot = event.key === 'Home' ? 0 : length();
      renderGrid();
    } else if (['0', '1', 'h', 'H', 'l', 'L'].includes(event.key)) {
      setCell({ h: '1', H: '1', l: '0', L: '0' }[event.key] || event.key, { advance: true });
    } else if (event.key === ' ' && !rows[row]?.analog) {
      setCell(shown(rows[row], Math.min(slot, length() - 1)) === '1' ? '0' : '1');
    } else if (['[', ']', '{', '}'].includes(event.key)) {
      shiftEdge(event.key === '[' || event.key === ']' ? 'fall' : 'rise', event.key === '[' || event.key === '{' ? -1 : 1);
    } else if (event.key === '+' || event.key === 'Insert') {
      repeatSlot();
    } else if (event.key === '*') {
      repeatSequence();
    } else if (['a', 'm', 's'].includes(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
      noteAt({ a: 'arrow', m: 'mark', s: 'span' }[event.key]);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      removeSlot();
    } else return;
    event.preventDefault();
  });

  const slotInput = element('input', { type: 'number', min: '1', max: '64', step: '1', value: String(state.slot), 'aria-label': 'Slot width in cells' });
  slotInput.addEventListener('change', () => { state.slot = Math.max(1, Math.round(Number(slotInput.value)) || DEFAULT_SLOT_CELLS); redraw(); });
  // A button; with `icon` an icon-only one (its text the accessible name).
  const button = (text, title, action, { icon = null, className = '' } = {}) => {
    const node = element('button', { type: 'button', title, class: `${icon ? 'icon-button' : ''} ${className}`.trim() || undefined, ...(icon ? { 'aria-label': text } : { text }) });
    if (icon) node.prepend(buttonIcon(icon));
    node.addEventListener('click', () => { action(); grid.focus(); });
    return node;
  };
  // A segmented group of icon buttons, as the style panel's.
  const segmented = (label, buttons) => element('div', { class: 'segmented', role: 'group', 'aria-label': label }, buttons);
  const fromBeats = button('Read beats', 'Read the waves from the beats', () => {
    rows.forEach((row) => {
      // A signal of the diagram's own has no switches to read.
      if (row.signal) return;
      if (row.baseKey !== undefined) { row.follows = true; row.wave = []; } else row.wave = [...beatTimingBits(editor.circuit, row.key)];
    });
    change();
  });
  if (!editor.circuit.beats.length) fromBeats.disabled = true;
  // The diagram stays where it stands; Re-place puts it where the drawing
  // has room again (after the drawing grew into it, say).
  const replace = button('Move under drawing', 'Move under the drawing', () => {
    state.place = true;
    redraw();
  });
  // The timing is where the beats come from: one beat per state.
  const makeBeats = button('Make beats', 'Make beats from the timing', () => {
    addPhaseBeats();
  }, { icon: null, className: 'confirm-action' });
  const signalInput = element('input', { type: 'text', placeholder: 'CLK, EN, $\\varphi_{s}$ …', 'aria-label': 'New signal name', spellcheck: 'false' });
  const addButton = button('Add signal', 'Add a signal', () => {
    if (addSignal(signalInput.value)) signalInput.value = '';
  }, { icon: 'add' });
  signalInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (addSignal(signalInput.value)) signalInput.value = '';
    grid.focus();
  });
  // One titled group of controls.
  const section = (title, children, className = '') => element('div', { class: `timing-section ${className}`.trim() }, [
    element('span', { class: 'timing-pairs-title', text: title }),
    element('div', { class: 'timing-dialog-options' }, children),
  ]);
  const removeRow = button('Remove row', 'Remove the cursor row', removeSignal, { icon: 'trash' });
  // The cursor row's kind and size: analog (a signal's values from -1 to 1),
  // held through each slot rather than joined straight, and its height.
  const toggleAnalog = () => {
    const row = rows[state.cursor.row];
    if (!row?.signal) return;
    settle();
    row.analog = !row.analog;
    // Back to digital: each value rounds to the nearer level.
    if (!row.analog) {
      row.wave = row.wave.map((value) => (Number(value) >= 0.5 ? '1' : '0'));
      row.hold = false;
    }
    change();
  };
  const analogButton = button('Analog', 'Analog values (.N, F2)', toggleAnalog);
  const holdButton = button('Hold', 'Hold each value through its slot', () => {
    const row = rows[state.cursor.row];
    if (!row?.analog) return;
    row.hold = !row.hold;
    change();
  });
  const resize = (by) => {
    const row = rows[state.cursor.row];
    if (!row) return;
    row.height = Math.max(2, Math.min(MAX_ROW_CELLS, (row.height || 2) + by));
    change();
  };
  const tallerButton = button('Taller', 'Taller row', () => resize(2));
  const shorterButton = button('Shorter', 'Shorter row', () => resize(-2));
  // Edge shifts move a digital row's edges; an analog row has none.
  const edgeButtons = [];
  const edgeButton = (...args) => {
    const node = button(...args);
    edgeButtons.push(node);
    return node;
  };
  const close = () => {
    const focused = dialog.contains(document.activeElement);
    timingEditor?.window.dispose();
    timingEditor?.dialog.remove();
    timingEditor = null;
    syncTimingToggle();
    if (focused) canvasEl.focus({ preventScroll: true });
  };
  // A floating window over the drawing (floating-window.js), not a modal:
  // the diagram stays in view as it is edited.
  const dialog = element('section', { class: 'floating-window timing-dialog', 'data-editor-edge': 'right', 'aria-labelledby': 'timing-window-title' }, [
    element('header', { class: 'floating-window-header' }, [
      element('h2', { id: 'timing-window-title', class: 'floating-window-title', text: 'Timing diagram' }),
      element('button', { type: 'button', class: 'floating-window-close', 'aria-label': 'Close the timing diagram', title: 'Close (Esc or Shift+K)', text: '×' }),
    ]),
    element('div', { class: 'timing-dialog-body' }, [
      element('p', { class: 'timing-dialog-legend', text: 'A row per switch phase (and any signal you add), a column per slot. Click a slot to flip it.' }),
      grid,
      element('details', { class: 'timing-keys' }, [
        element('summary', { text: 'Keyboard' }),
        element('p', { text: 'Arrows move the cursor; 1 and 0 set a slot and step on; Space flips it. + repeats the slot at the cursor in every row (a state held one slot longer), Delete removes it, * repeats the whole sequence. Ctrl+Z undoes. In a signal\'s row . or - begins an analog value (.35, -.5) and the next key sets it; F2 edits the slot\'s value. [ ] move the cursor row\'s falling edges a cell earlier or later, { } its rising edges; Alt+↑/↓ move the row. The edge at the cursor is the one at the left of its slot: a begins an arrow there and a again at another edge ends it, s does the same for a span, m marks it (or unmarks it); Esc cancels.' }),
      ]),
      section('Slots', [
        segmented('Slots', [
          button('Add a slot', 'Add a slot (+)', repeatSlot, { icon: 'add' }),
          button('Remove the slot', 'Remove the slot (Delete)', removeSlot, { icon: 'minus' }),
          button('Repeat the sequence', 'Repeat the sequence (*)', repeatSequence, { icon: 'repeat' }),
        ]),
        element('label', { class: 'timing-width', title: 'Slot width in grid cells' }, [slotInput, element('span', { text: 'cells each' })]),
      ]),
      section('Cursor row', [
        segmented('Falling edges', [
          edgeButton('Fall earlier', 'Falling edges a cell earlier ([)', () => shiftEdge('fall', -1), { icon: 'chevron-left' }),
          element('span', { class: 'segmented-label', 'aria-hidden': 'true' }, [buttonIcon('edge-fall')]),
          edgeButton('Fall later', 'Falling edges a cell later (])', () => shiftEdge('fall', 1), { icon: 'chevron-right' }),
        ]),
        segmented('Rising edges', [
          edgeButton('Rise earlier', 'Rising edges a cell earlier ({)', () => shiftEdge('rise', -1), { icon: 'chevron-left' }),
          element('span', { class: 'segmented-label', 'aria-hidden': 'true' }, [buttonIcon('edge-rise')]),
          edgeButton('Rise later', 'Rising edges a cell later (})', () => shiftEdge('rise', 1), { icon: 'chevron-right' }),
        ]),
        segmented('Row order', [
          button('Move up', 'Move the row up (Alt+↑)', () => moveRow(-1), { icon: 'chevron-up' }),
          button('Move down', 'Move the row down (Alt+↓)', () => moveRow(1), { icon: 'chevron-down' }),
        ]),
        segmented('Row height', [tallerButton, shorterButton]),
        segmented('Analog', [analogButton, holdButton]),
      ]),
      section('Signals', [element('div', { class: 'timing-signal-field' }, [signalInput, addButton]), removeRow], 'timing-signal-controls'),
      pairsBox,
      notesBox,
      status,
      // The two ways between the timing and the beats, and where the
      // diagram sits, each said once.
      element('div', { class: 'timing-beats' }, [
        element('p', { class: 'timing-beats-note', text: 'Beats step the drawing through this timing: each beat closes the switches whose phase is high.' }),
        element('div', { class: 'timing-beats-actions' }, [replace, element('span', { class: 'timing-beats-spacer' }), fromBeats, makeBeats]),
      ]),
    ]),
  ]);
  dialog.addEventListener('keydown', (event) => {
    event.stopPropagation();
    // Undo and redo work here as on the drawing (a field keeps its own).
    const mod = (event.ctrlKey || event.metaKey) && !event.altKey;
    if (mod && event.target.tagName !== 'INPUT' && ['z', 'y'].includes(event.key.toLowerCase())) {
      event.preventDefault();
      if (event.key.toLowerCase() === 'y' || event.shiftKey) redo();
      else undo();
      return;
    }
    // Shift+K closes it again, except while typing a number.
    if (event.key === 'Escape' && cancelPending()) {
      event.preventDefault();
    } else if (event.key === 'Escape' || (event.key === 'K' && !event.ctrlKey && !event.metaKey && !event.altKey && event.target.tagName !== 'INPUT')) {
      event.preventDefault();
      close();
    }
  });
  renderGrid();
  renderPairs();
  renderNotes();
  canvasEl.closest('.canvas-pane').append(dialog);
  /** The drawing changed, not by this editor: read it again. */
  const follow = () => {
    if (state.seen?.circuit === editor.circuit && state.seen.revision === editor.modelRevision) return;
    try {
      readDrawing();
    } catch (err) {
      status.textContent = err.message;
      state.seen = { circuit: editor.circuit, revision: editor.modelRevision };
      return;
    }
    slotInput.value = String(state.slot);
    renderGrid();
    renderPairs();
    renderNotes();
  };
  timingEditor = { dialog, grid, close, follow, window: floatingWindow(dialog, { key: 'timing', onClose: close, place: PLACE.topCenter }) };
  timingEditor.window.place();
  syncTimingToggle();
  grid.focus();
  // Opening it draws the diagram, so what the grid shows is on the page.
  redraw();
}

/** Context-menu items for beats: show/hide, switch position. */
export function appendBeatContextItems(group, target) {
  if (target.kind === 'component' && switchState(target.value)) {
    const index = activeBeatIndex();
    const state = index === null ? switchState(target.value) : switchStateAt(editor.circuit, target.value.refdes, index);
    const where = index === null ? '' : ' from this beat';
    appendContextItem(group, `${state === 'closed' ? 'Open' : 'Close'} ${switchPhase(target.value) ? switchGroupName(target.value) : 'switch'}${where}`, flipSelectedSwitches, { shortcut: 's' });
  }
  const index = activeBeatIndex();
  if (index === null || (target.kind !== 'component' && target.kind !== 'label')) return;
  const ids = beatSelectionIds();
  if (!ids.length) return;
  const view = resolveBeat(editor.circuit, index);
  const all = (presence) => ids.every((id) => beatPresence(view, id) === presence);
  appendContextItem(group, all('hide') ? 'Show from this beat' : 'Hide from this beat', () => toggleSelectionInBeat('hide'), { shortcut: 'h' });
  appendContextItem(group, all('dim') ? 'Undim from this beat' : 'Dim from this beat', () => toggleSelectionInBeat('dim'), { shortcut: 'Shift+H' });
}

// ----- presenting --------------------------------------------------------------

export function openPresenter(start = activeBeatIndex() ?? 0) {
  if (!presenterEl) return;
  if (!editor.circuit.beats.length) {
    logLine('Nothing to present: add a beat first (+).', 'status');
    return;
  }
  closeComponentContextMenu();
  editor.presenter = { index: Math.max(0, Math.min(start, editor.circuit.beats.length - 1)), blank: false, fullscreen: false };
  presenterEl.hidden = false;
  presenterEl.focus({ preventScroll: true });
  const request = presenterEl.requestFullscreen?.();
  request?.then(() => { if (editor.presenter) editor.presenter.fullscreen = true; }).catch(() => {});
  showPresenterFrame(false);
}

function closePresenter() {
  if (!editor.presenter) return;
  const { index } = editor.presenter;
  editor.presenter = null;
  presenterEl.hidden = true;
  presenterStageEl.replaceChildren();
  if (document.fullscreenElement === presenterEl) document.exitFullscreen?.().catch(() => {});
  // Come back to the beat the talk stopped at.
  setActiveBeat(index < editor.circuit.beats.length ? index : null);
  canvasEl.focus({ preventScroll: true });
}

function showPresenterFrame(animate = true) {
  if (!editor.presenter) return;
  const frame = document.createElement('div');
  frame.className = 'presenter-frame';
  if (!editor.presenter.blank) {
    // Theme ink, like the canvas: the presentation follows light or dark mode.
    frame.innerHTML = svgString(editor.circuit, { ...DRAWING_EXPORT_OPTIONS, themeInk: true, beat: { view: resolveBeat(editor.circuit, editor.presenter.index), timing: timingBeatBands(editor.circuit, editor.presenter.index) } });
    const svg = frame.querySelector('svg');
    svg?.removeAttribute('width');
    svg?.removeAttribute('height');
    svg?.setAttribute('role', 'img');
    svg?.setAttribute('aria-label', beatLabel(editor.presenter.index));
  }
  // The new frame fades in over the old one, which then goes; every beat
  // shares the drawing's frame, so only what changed appears to move.
  const previous = [...presenterStageEl.children];
  const still = !animate || reducedMotion();
  if (still) previous.forEach((el) => el.remove());
  else {
    frame.classList.add('entering');
    frame.addEventListener('animationend', () => previous.forEach((el) => el.remove()), { once: true });
  }
  presenterStageEl.appendChild(frame);
  const beat = editor.circuit.beats[editor.presenter.index];
  if (presenterCountEl) {
    presenterCountEl.replaceChildren(editor.presenter.blank ? '' : `${editor.presenter.index + 1} / ${editor.circuit.beats.length}${beat?.name ? ' · ' : ''}`);
    if (!editor.presenter.blank && beat?.name) appendMarkupText(presenterCountEl, texToLabelMarkup(beat.name));
  }
}

function presenterStep(delta) {
  if (!editor.presenter) return;
  const next = Math.max(0, Math.min(editor.presenter.index + delta, editor.circuit.beats.length - 1));
  if (next === editor.presenter.index && !editor.presenter.blank) return;
  editor.presenter.index = next;
  editor.presenter.blank = false;
  showPresenterFrame();
}

export function onPresenterKey(ev) {
  const key = ev.key;
  const forward = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n'];
  const back = ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p'];
  if (forward.includes(key)) presenterStep(1);
  else if (back.includes(key)) presenterStep(-1);
  else if (key === 'Home') presenterStep(-editor.circuit.beats.length);
  else if (key === 'End') presenterStep(editor.circuit.beats.length);
  else if (key === '.' || key === 'b') {
    editor.presenter.blank = !editor.presenter.blank;
    showPresenterFrame(false);
  } else if (key === 'Escape') closePresenter();
  else return;
  ev.preventDefault();
}

export function installBeatsUi() {
  presenterEl?.addEventListener('click', () => presenterStep(1));
  presenterEl?.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    presenterStep(-1);
  });
  // Leaving full screen (the browser owns Escape there) ends the presentation.
  document.addEventListener('fullscreenchange', () => {
    if (editor.presenter?.fullscreen && document.fullscreenElement !== presenterEl) closePresenter();
  });
  document.getElementById('beat-add')?.addEventListener('click', addBeatHere);
  document.getElementById('beat-present')?.addEventListener('click', () => openPresenter());
  document.getElementById('btn-present')?.addEventListener('click', () => openPresenter());
  document.getElementById('btn-phase-beats')?.addEventListener('click', addPhaseBeats);
  document.getElementById('btn-timing-diagram')?.addEventListener('click', toggleTimingDialog);
  const closeBeatStrip = () => {
    editor.beatStripOpen = false;
    setActiveBeat(null);
  };
  document.getElementById('beat-strip-close')?.addEventListener('click', closeBeatStrip);
  // Escape in the window closes it, as in the other windows -- once it has
  // let go of beats picked there, and not while a beat's name is typed.
  beatStripEl?.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || ev.defaultPrevented || ['INPUT', 'TEXTAREA', 'SELECT'].includes(ev.target.tagName)) return;
    if (editor.selectedBeatIds.size > 1) return;
    ev.preventDefault();
    ev.stopPropagation();
    closeBeatStrip();
    canvasEl.focus({ preventScroll: true });
  });
  document.getElementById('btn-beats')?.addEventListener('click', toggleBeatStrip);
  document.getElementById('btn-window-beats')?.addEventListener('click', toggleBeatStrip);
  document.getElementById('btn-window-timing')?.addEventListener('click', toggleTimingDialog);
  if (beatStripEl) beatWindow = floatingWindow(beatStripEl, { key: 'beats', place: PLACE.bottomCenter });
}
