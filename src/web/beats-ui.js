/**
 * Beats in the editor: the beat strip, stepping and editing beats, hiding
 * or dimming the selection from a beat on, switch flips, and the full-screen
 * presenter. The beat model is core/beats.js.
 */

import { DEFAULT_SLOT_CELLS, addTimingDiagram, beatTimingBits, existingTimingDiagram, parseTimingBits, timingRowSources } from '../core/timing-diagram.js';
import { addBeat, beatTargetId, beatTitle, introduceAt, mergeBeats, moveBeat, removeBeat, renameBeat, resolveBeat, setPresenceAt, setPresenceFrom, setSwitchFrom, switchGroupKey, switchPhase, switchState, switchStateAt, phaseBeats, samePhase, complementKey } from '../core/beats.js';
import { plainTexText, svgString, texToLabelMarkup } from '../core/render.js';
import { DRAWING_EXPORT_OPTIONS } from '../core/selection-drawing.js';
import { canvasEl, componentContextMenuEl, beatStripEl, beatListEl, beatHintEl, presenterEl, presenterStageEl, presenterCountEl } from './elements.js';
import { logLine, hintLine } from './status-bar-ui.js';
import { fitView } from './canvas-view.js';
import { closeComponentContextMenu, appendContextItem } from './context-menu.js';
import { editor } from './editor-state.js';
import { appendMarkupText } from './side-panel.js';
import { commit, render, selectedComps, selectedLabels, setLabelSelection, setSelection } from './main.js';

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

/** One beat per switch phase, after the beat on screen: what still works in
 * the phase shown, the rest dimmed (core/beats.js phaseBeats). */
function addPhaseBeats() {
  const current = activeBeatIndex();
  const index = current === null ? editor.circuit.beats.length : current + 1;
  let count = 0;
  commit(() => { count = phaseBeats(editor.circuit, { index }); });
  if (!count) return;
  logLine(`added ${count} phase beats: each dims its open switches and whatever they cut off`);
  setActiveBeat(index);
}

/** The timing diagram dialog: one wave per phase, typed as slots (1 high,
 * 0 low, x don't care), started from the diagram already drawn or the beats.
 * It stays open beside the drawing: Draw (Enter) draws or redraws the
 * diagram in place and the waves can be changed again (core/timing-diagram.js). */
let timingDialog = null;

function openTimingDialog() {
  if (timingDialog) {
    timingDialog.querySelector('input')?.focus();
    return;
  }
  let rows;
  try {
    rows = timingRowSources(editor.circuit);
  } catch (err) {
    logLine(err.message, 'error');
    return;
  }
  if (!rows.length) {
    logLine('no switch has a phase yet: label switches with the signal that controls them', 'error');
    return;
  }
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
  const inputs = rows.map((row) => make('input', {
    type: 'text',
    // A complement follows its phase inverted until it is given a wave of its own.
    value: row.from === 'complement' || row.from === 'low' ? '' : row.bits,
    spellcheck: 'false',
    autocomplete: 'off',
    'aria-label': `${plainMarkup(row.source)} wave`,
  }));
  const status = make('p', { class: 'timing-dialog-status', role: 'status' });
  const hints = () => {
    rows.forEach((row, index) => {
      const beats = beatTimingBits(editor.circuit, row.key);
      inputs[index].placeholder = row.complementOf !== undefined ? `${plainMarkup(rows[row.complementOf].source)} inverted`
        : beats ? `${beats} (from the beats)` : 'low';
    });
    try {
      for (const input of inputs) parseTimingBits(input.value);
      status.textContent = '';
      return true;
    } catch (err) {
      status.textContent = err.message;
      return false;
    }
  };
  const slot = make('input', { type: 'number', min: '1', max: '64', step: '1', value: String(before?.slot || DEFAULT_SLOT_CELLS), 'aria-label': 'Slot width in cells' });
  const gaps = make('input', { type: 'checkbox' });
  gaps.checked = before ? before.gaps : true;
  const fromBeats = make('button', { type: 'button', text: 'Fill from beats', title: 'One slot per beat: high where the phase\'s switches are closed' });
  if (!editor.circuit.beats.length) fromBeats.disabled = true;
  fromBeats.addEventListener('click', () => {
    rows.forEach((row, index) => { inputs[index].value = row.complementOf !== undefined ? '' : beatTimingBits(editor.circuit, row.key); });
    hints();
  });
  const grid = make('div', { class: 'timing-dialog-rows' });
  rows.forEach((row, index) => {
    const name = make('span', { class: 'timing-dialog-name' });
    // Label markup has no overbar: a complement's name reads as plain text.
    if (/\\(?:overline|bar)\{/.test(row.source)) name.textContent = plainMarkup(row.source);
    else appendMarkupText(name, texToLabelMarkup(row.source));
    grid.append(make('label', {}, [name, inputs[index]]));
  });
  const close = () => {
    timingDialog?.close();
    timingDialog?.remove();
    timingDialog = null;
  };
  const closeButton = make('button', { type: 'button', text: 'Close' });
  closeButton.addEventListener('click', close);
  const form = make('form', {}, [
    make('h2', { text: 'Timing diagram' }),
    make('p', { class: 'timing-dialog-legend', text: 'One character per slot: 1 high, 0 low, x don\'t care. The waves repeat, so each shows its last slot before the start and its first after the end.' }),
    grid,
    make('div', { class: 'timing-dialog-options' }, [
      make('label', {}, [make('span', { text: 'Slot' }), slot, make('span', { text: 'cells' })]),
      make('label', { title: 'A one-cell gap wherever a phase changes: falling edges come early and rising edges late, so no two phases are high at once' }, [gaps, make('span', { text: 'Non-overlap gaps' })]),
    ]),
    status,
    make('div', { class: 'dialog-actions' }, [
      fromBeats,
      closeButton,
      make('button', { type: 'submit', class: 'confirm-action', text: 'Draw' }),
    ]),
  ]);
  const dialog = make('dialog', { class: 'confirm-dialog timing-dialog', 'aria-label': 'Timing diagram' }, [form]);
  dialog.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });
  form.addEventListener('input', hints);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!hints()) return;
    const bits = {};
    rows.forEach((row, index) => {
      if (inputs[index].value.trim()) bits[String(index + 1)] = inputs[index].value;
    });
    drawTimingDiagram({ bits, slot: Number(slot.value) || DEFAULT_SLOT_CELLS, gaps: gaps.checked });
  });
  hints();
  document.body.append(dialog);
  timingDialog = dialog;
  // Not modal: the drawing stays in view, and the diagram can be redrawn as
  // the waves are changed.
  dialog.show();
  inputs[0]?.focus();
}

/** Draw (or redraw) the diagram: the dialog's waves are the whole truth, so
 *  a row left empty is not kept from the diagram drawn before. */
function drawTimingDiagram({ bits, slot, gaps }) {
  const first = !existingTimingDiagram(editor.circuit);
  let rows = [];
  try {
    commit(() => { rows = addTimingDiagram(editor.circuit, { bits, slot, gaps, fromBeats: true }); });
  } catch (err) {
    logLine(`Could not draw the timing diagram: ${err.message}`, 'error');
    return;
  }
  if (!rows.length) return;
  logLine(`drew the timing diagram for ${rows.length} phase${rows.length === 1 ? '' : 's'}`);
  if (first) fitView({ animate: true });
  render();
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
  document.getElementById('btn-timing-diagram')?.addEventListener('click', openTimingDialog);
  document.getElementById('beat-strip-close')?.addEventListener('click', () => {
    editor.beatStripOpen = false;
    setActiveBeat(null);
  });
  document.getElementById('btn-beats')?.addEventListener('click', toggleBeatStrip);
}
