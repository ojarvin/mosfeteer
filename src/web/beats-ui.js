/**
 * Beats in the editor: the beat strip, stepping and editing beats, hiding
 * or dimming the selection from a beat on, switch flips, and the full-screen
 * presenter. The beat model is core/beats.js.
 */

import { DEFAULT_SLOT_CELLS, MAX_EDGE_SHIFT, addTimingDiagram, timingStates, beatTimingBits, defaultTimingPairs, existingTimingDiagram, removeTimingDiagram, timingPhases, timingRowSources } from '../core/timing-diagram.js';
import { addBeat, beatTargetId, beatTitle, introduceAt, mergeBeats, moveBeat, removeBeat, renameBeat, resolveBeat, setPresenceAt, setPresenceFrom, setSwitchFrom, switchGroupKey, switchPhase, switchState, switchStateAt, phaseBeats, samePhase, complementKey, phaseKey } from '../core/beats.js';
import { plainTexText, svgString, texToLabelMarkup } from '../core/render.js';
import { DRAWING_EXPORT_OPTIONS } from '../core/selection-drawing.js';
import { canvasEl, componentContextMenuEl, beatStripEl, beatListEl, beatHintEl, presenterEl, presenterStageEl, presenterCountEl } from './elements.js';
import { logLine, hintLine } from './status-bar-ui.js';
import { fitView } from './canvas-view.js';
import { closeComponentContextMenu, appendContextItem } from './context-menu.js';
import { editor } from './editor-state.js';
import { appendMarkupText } from './side-panel.js';
import { commit, markModelChanged, recordHistoryEntry, render, selectedComps, selectedLabels, setLabelSelection, setSelection, snapshot } from './main.js';
import { noteTip } from './onboarding.js';

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
export function mergePickedBeats() {
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
    const before = groups.findIndex((group) => {
      const rect = group.getBoundingClientRect();
      return moveEv.clientX < rect.left + rect.width / 2;
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
  beatStripEl.hidden = !visible;
  document.getElementById('btn-beats')?.setAttribute('aria-checked', String(visible));
  if (!visible) return;
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
    button.title = `${beatLabel(i)} — click to show, drag to move, Ctrl/Shift-click to pick several, double-click to rename, right-click for more`;
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
  if (!componentContextMenuEl) return;
  closeComponentContextMenu();
  const menu = componentContextMenuEl;
  menu.hidden = false;
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - 250))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - 120))}px`;
  const heading = document.createElement('div');
  heading.className = 'context-menu-heading';
  heading.textContent = beatLabel(index);
  menu.appendChild(heading);
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
 * phase, after the beat on screen: what still works shown, the rest dimmed
 * (core/beats.js phaseBeats). */
function addPhaseBeats() {
  const current = activeBeatIndex();
  const index = current === null ? editor.circuit.beats.length : current + 1;
  let count = 0;
  // A drawn timing diagram says which phases close together: one beat per
  // state it steps through. Without one, a beat per phase.
  const states = timingStates(editor.circuit);
  commit(() => { count = phaseBeats(editor.circuit, { index, states }); });
  if (!count) return;
  noteTip('phase-beats');
  logLine(states
    ? `added ${count} beats, one per state of the timing diagram: phases high together close together, and what they cut off is dimmed`
    : `added ${count} phase beats: each dims its open switches and whatever they cut off (draw a timing diagram to close phases together)`);
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
}

/** Shift+K and the menu item open the editor, or close it when it is open,
 * as the other panels' keys do. */
export function toggleTimingDialog() {
  if (timingEditor) timingEditor.close();
  else openTimingDialog();
}

export function openTimingDialog() {
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
  const make = (tag, props = {}, children = []) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else node.setAttribute(key, value);
    }
    node.append(...children);
    return node;
  };
  // The rows' own waves; a complement with none follows its phase inverted.
  // An older diagram's don't-care slots read as low.
  const rows = sources.map((row) => ({
    key: row.key,
    source: row.source,
    // The row a complement follows, by its phase (rows can be reordered).
    baseKey: row.complementOf !== undefined ? sources[row.complementOf].key : undefined,
    follows: row.from === 'complement',
    signal: !!row.signal,
    wave: row.from === 'complement' ? [] : [...row.bits].map((level) => (level === '1' ? '1' : '0')),
    shift: before?.shifts.get(row.key) || { fall: 0, rise: 0 },
  }));
  const state = {
    cursor: { row: 0, slot: 0 },
    slot: before?.slot || DEFAULT_SLOT_CELLS,
    gaps: before?.gaps ?? 'auto',
    session: null,
    place: false,
  };
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

  const grid = make('div', { class: 'timing-grid', tabindex: '0', role: 'grid', 'aria-label': 'Timing slots: arrows move, 1 and 0 set, Space flips, + repeats a slot, Delete removes it' });
  const pairsBox = make('div', { class: 'timing-pairs' });
  const status = make('p', { class: 'timing-dialog-status', role: 'status' });

  const redraw = () => {
    const bits = {};
    for (const row of rows) if (!row.follows) bits[row.key] = row.wave.join('');
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
      if (rows.length) addTimingDiagram(editor.circuit, { bits, slot: state.slot, gaps: state.gaps, shifts, order, place, fromBeats: true, add, remove });
      else removeTimingDiagram(editor.circuit);
    } catch (err) {
      status.textContent = err.message;
      return;
    }
    status.textContent = '';
    if (snapshot() === start) return;
    // One undo entry for the session, unless something else was edited since.
    const first = !state.session;
    if (!state.session || state.session.revision !== editor.modelRevision) recordHistoryEntry(start, true, 'none');
    markModelChanged();
    if (!state.session) noteTip('timing-drawn');
    state.session = { revision: editor.modelRevision };
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
  const renderPairs = () => {
    pairsBox.replaceChildren();
    const own = rows.filter((row) => row.baseKey === undefined);
    const active = activePairs();
    const head = make('div', { class: 'timing-pairs-head' }, [make('span', { class: 'timing-pairs-title', text: 'Never overlap' })]);
    const list = make('div', { class: 'timing-pairs-list' });
    pairsBox.append(head, list);
    for (let a = 0; a < own.length; a += 1) {
      for (let b = a + 1; b < own.length; b += 1) {
        const pair = [own[a].key, own[b].key];
        const box = make('input', { type: 'checkbox' });
        box.checked = active.some((other) => samePair(other, pair));
        box.addEventListener('change', () => {
          const next = activePairs().filter((other) => !samePair(other, pair));
          if (box.checked) next.push(pair);
          state.gaps = next;
          renderPairs();
          redraw();
        });
        list.append(make('label', {}, [box, make('span', { text: `${plainMarkup(own[a].source)} · ${plainMarkup(own[b].source)}` })]));
      }
    }
    const auto = make('button', { type: 'button', class: 'timing-pairs-auto', text: state.gaps === 'auto' ? 'automatic' : 'Automatic', title: 'Keep apart every two phases that are never high in the same slot' });
    auto.disabled = state.gaps === 'auto';
    auto.addEventListener('click', () => { state.gaps = 'auto'; renderPairs(); redraw(); });
    head.append(auto);
  };

  const renderGrid = () => {
    grid.replaceChildren();
    const n = length();
    state.cursor.slot = Math.min(state.cursor.slot, n);
    rows.forEach((row, r) => {
      const name = make('span', { class: 'timing-grid-name' });
      if (/\\(?:overline|bar)\{/.test(row.source)) name.textContent = plainMarkup(row.source);
      else appendMarkupText(name, texToLabelMarkup(row.source));
      if (row.follows) name.title = `${plainMarkup(baseOf(row).source)} inverted; edit it to give it a wave of its own`;
      const cells = make('span', { class: `timing-grid-row${row.follows ? ' follows' : ''}` });
      for (let slot = 0; slot < n; slot += 1) {
        const level = shown(row, slot);
        const cell = make('span', { class: `timing-cell level-${level}${state.cursor.row === r && state.cursor.slot === slot ? ' cursor' : ''}`, role: 'gridcell' });
        cell.addEventListener('mousedown', (event) => {
          event.preventDefault();
          state.cursor = { row: r, slot };
          grid.focus();
          setCell(level === '1' ? '0' : '1');
        });
        cells.append(cell);
      }
      // After the last slot, an empty cell to type a new one into.
      const add = make('span', { class: `timing-cell new${state.cursor.row === r && state.cursor.slot === n ? ' cursor' : ''}`, title: 'Type 1 or 0 here to add a slot' });
      add.addEventListener('mousedown', (event) => {
        event.preventDefault();
        state.cursor = { row: r, slot: n };
        grid.focus();
        renderGrid();
      });
      cells.append(add);
      const edge = (arrow, cells) => (cells ? `${arrow}${cells > 0 ? '+' : '−'}${Math.abs(cells)}` : '');
      const shift = make('span', {
        class: 'timing-shift',
        text: [edge('↓', row.shift.fall), edge('↑', row.shift.rise)].filter(Boolean).join(' '),
        title: row.shift.fall || row.shift.rise
          ? `Falls ${Math.abs(row.shift.fall)} cell${Math.abs(row.shift.fall) === 1 ? '' : 's'} ${row.shift.fall < 0 ? 'early' : 'late'}, rises ${Math.abs(row.shift.rise)} ${row.shift.rise < 0 ? 'early' : 'late'} ([ ] and { } move them)`
          : 'Edges on the slot boundaries ([ ] move the falls, { } the rises)',
      });
      grid.append(make('div', { class: 'timing-grid-line' }, [name, cells, shift]));
    });
    const count = make('div', { class: 'timing-grid-foot', text: !rows.length ? 'no rows yet: add a signal below'
      : state.cursor.slot < n ? `slot ${state.cursor.slot + 1} of ${n}` : `after slot ${n}: type to add one` });
    grid.append(count);
    removeRow.disabled = !rows[state.cursor.row]?.signal;
  };

  const change = () => { renderGrid(); renderPairs(); redraw(); };
  const setCell = (level, { advance = false } = {}) => {
    const row = rows[state.cursor.row];
    if (!row) return;
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
    row.shift = { ...row.shift, [edge]: Math.max(-MAX_EDGE_SHIFT, Math.min(MAX_EDGE_SHIFT, row.shift[edge] + by)) };
    change();
  };
  // At the empty cell after the end, these act on the last slot.
  const cursorSlot = () => Math.min(state.cursor.slot, length() - 1);
  const repeatSlot = () => {
    settle();
    const slot = cursorSlot();
    for (const row of rows) if (!row.follows) row.wave.splice(slot + 1, 0, row.wave[slot]);
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
    state.cursor.slot = Math.min(slot, length() - 1);
    change();
  };
  grid.addEventListener('keydown', (event) => {
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
    } else if (event.key === ' ') {
      setCell(shown(rows[row], Math.min(slot, length() - 1)) === '1' ? '0' : '1');
    } else if (['[', ']', '{', '}'].includes(event.key)) {
      shiftEdge(event.key === '[' || event.key === ']' ? 'fall' : 'rise', event.key === '[' || event.key === '{' ? -1 : 1);
    } else if (event.key === '+' || event.key === 'Insert') {
      repeatSlot();
    } else if (event.key === '*') {
      repeatSequence();
    } else if (event.key === 'Delete' || event.key === 'Backspace' || event.key === '-') {
      removeSlot();
    } else return;
    event.preventDefault();
  });

  const slotInput = make('input', { type: 'number', min: '1', max: '64', step: '1', value: String(state.slot), 'aria-label': 'Slot width in cells' });
  slotInput.addEventListener('change', () => { state.slot = Math.max(1, Math.round(Number(slotInput.value)) || DEFAULT_SLOT_CELLS); redraw(); });
  const button = (text, title, action) => {
    const node = make('button', { type: 'button', text, title });
    node.addEventListener('click', () => { action(); grid.focus(); });
    return node;
  };
  const fromBeats = button('From beats', 'One slot per beat: high where the phase\'s switches are closed', () => {
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
  const replace = button('Re-place', 'Put the diagram back under the drawing, as high as the drawing leaves room', () => {
    state.place = true;
    redraw();
  });
  // The timing is where the beats come from: one beat per state.
  const makeBeats = button('Make beats', 'Add one beat per state of this timing diagram, after the beat on screen: phases high together close together', () => {
    addPhaseBeats();
  });
  const signalInput = make('input', { type: 'text', placeholder: 'CLK, EN, $\\varphi_{s}$ …', 'aria-label': 'New signal name', spellcheck: 'false' });
  const addButton = button('Add signal', 'Add a row of your own, not tied to any switch (Enter in the field)', () => {
    if (addSignal(signalInput.value)) signalInput.value = '';
  });
  signalInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (addSignal(signalInput.value)) signalInput.value = '';
    grid.focus();
  });
  const removeRow = button('Remove row', 'Remove the cursor row: a signal added here (a switch phase\'s row comes from its switches)', removeSignal);
  const close = () => {
    const focused = dialog.contains(document.activeElement);
    timingEditor?.dialog.close();
    timingEditor?.dialog.remove();
    timingEditor = null;
    syncTimingToggle();
    if (focused) canvasEl.focus({ preventScroll: true });
  };
  const dialog = make('dialog', { class: 'confirm-dialog timing-dialog', 'aria-label': 'Timing diagram' }, [
    make('h2', { text: 'Timing diagram' }),
    make('p', { class: 'timing-dialog-legend', text: 'Click a slot to flip it, or move with the arrows and type 1 or 0. + repeats the slot at the cursor in every row (a state held one slot longer); Delete removes it; * repeats the whole sequence. [ ] move the cursor row\'s falling edges a cell earlier or later, { } its rising edges; Alt+↑/↓ move the row. Signals add rows of your own, not tied to a switch. Make beats steps through the states the switch phases go through.' }),
    grid,
    make('div', { class: 'timing-dialog-options' }, [
      button('+ slot', 'Repeat the slot at the cursor in every row (+)', repeatSlot),
      button('− slot', 'Remove the slot at the cursor (Delete)', removeSlot),
      button('Repeat all', 'Copy every wave once after itself: a second period to edit (*)', repeatSequence),
      make('label', {}, [make('span', { text: 'Slot' }), slotInput, make('span', { text: 'cells' })]),
    ]),
    make('div', { class: 'timing-dialog-options timing-shift-controls' }, [
      make('span', { class: 'timing-pairs-title', text: 'Cursor row' }),
      make('span', { class: 'timing-shift-pair' }, [
        make('span', { text: 'Fall' }),
        button('◂', 'Fall a cell earlier ([)', () => shiftEdge('fall', -1)),
        button('▸', 'Fall a cell later (])', () => shiftEdge('fall', 1)),
      ]),
      make('span', { class: 'timing-shift-pair' }, [
        make('span', { text: 'Rise' }),
        button('◂', 'Rise a cell earlier ({)', () => shiftEdge('rise', -1)),
        button('▸', 'Rise a cell later (})', () => shiftEdge('rise', 1)),
      ]),
      make('span', { class: 'timing-shift-pair' }, [
        make('span', { text: 'Row' }),
        button('▴', 'Move the row up (Alt+↑)', () => moveRow(-1)),
        button('▾', 'Move the row down (Alt+↓)', () => moveRow(1)),
      ]),
    ]),
    make('div', { class: 'timing-dialog-options timing-signal-controls' }, [
      make('span', { class: 'timing-pairs-title', text: 'Signals' }), signalInput, addButton, removeRow,
    ]),
    pairsBox,
    status,
    make('div', { class: 'dialog-actions' }, [fromBeats, replace, makeBeats, button('Close', 'Close (Escape)', close)]),
  ]);
  dialog.addEventListener('keydown', (event) => {
    event.stopPropagation();
    // Shift+K closes it again, except while typing a number.
    if (event.key === 'Escape' || (event.key === 'K' && !event.ctrlKey && !event.metaKey && !event.altKey && event.target.tagName !== 'INPUT')) {
      event.preventDefault();
      close();
    }
  });
  renderGrid();
  renderPairs();
  document.body.append(dialog);
  timingEditor = { dialog, grid, close };
  syncTimingToggle();
  // Not modal: the diagram stays in view as it is edited.
  dialog.show();
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
    frame.innerHTML = svgString(editor.circuit, { ...DRAWING_EXPORT_OPTIONS, themeInk: true, beat: { view: resolveBeat(editor.circuit, editor.presenter.index) } });
    const svg = frame.querySelector('svg');
    svg?.removeAttribute('width');
    svg?.removeAttribute('height');
    svg?.setAttribute('role', 'img');
    svg?.setAttribute('aria-label', beatLabel(editor.presenter.index));
  }
  // The new frame fades in over the old one, which then goes; every beat
  // shares the drawing's frame, so only what changed appears to move.
  const previous = [...presenterStageEl.children];
  const still = !animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
  document.getElementById('beat-strip-close')?.addEventListener('click', () => {
    editor.beatStripOpen = false;
    setActiveBeat(null);
  });
  document.getElementById('btn-beats')?.addEventListener('click', toggleBeatStrip);
}
