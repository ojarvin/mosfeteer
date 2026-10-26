/**
 * Arrange like (Shift+Q): the selected parts drawn as an earlier drawing of
 * the same topology draws them (core/arrange.js). The picker lists each way
 * they are drawn, with the drawing it comes from; the one highlighted is
 * shown on the canvas as it would be, and Enter (or a click) keeps it as
 * one undo step. The open design is searched first, then the workspace's
 * other designs by when they were saved, then the built-in drawings.
 */

import { noteTip, tipWaiting } from './onboarding.js';
import { applyArrangement, arrangeableRefs, arrangementCandidates, cellsIn } from '../core/arrange.js';
import { builtInDrawings, cellPatterns } from '../core/arrange-builtins.js';
import { loadDocument } from '../core/document.js';
import { GRID } from '../core/grid.js';
import { svgString } from '../core/render.js';
import { DRAWING_EXPORT_OPTIONS } from '../core/selection-drawing.js';
import { persistence } from './document-session.js';
import { loadDesign } from './example-designs.js';
import { applyExportDarkTheme, withEmbeddedMathFont } from './drawing-export.js';
import { editor } from './editor-state.js';
import { canvasEl } from './elements.js';
import { applyJson, recordHistoryEntry, rememberAction, render, selectedComps, setSelection, snapshot } from './main.js';
import { revisionTime } from './modified-time.js';
import { hintLine, logLine } from './status-bar-ui.js';

/** The workspace's designs as last read: path -> { revision, circuit }. */
const designs = new Map();
let picker = null;
let opening = false;

/** The workspace's designs but the open one, newest first. One that cannot
 *  be read (a browser-only file without permission yet) is passed over. */
export async function workspaceDesigns() {
  let workspace;
  try { workspace = await persistence.workspace(); } catch { return []; }
  const docs = (workspace.documents || []).filter((doc) => doc.kind === 'circuit' && !doc.locked && !doc.missing && doc.path !== editor.currentDocumentPath);
  const out = [];
  for (const doc of docs) {
    let entry = designs.get(doc.path);
    if (!entry || !doc.revision || entry.revision !== doc.revision) {
      try {
        entry = { revision: doc.revision, circuit: loadDocument((await loadDesign(doc)).state) };
      } catch {
        continue;
      }
      if (doc.revision) designs.set(doc.path, entry);
    }
    out.push({ circuit: entry.circuit, name: doc.name, path: doc.path, time: revisionTime(doc.revision) ?? 0 });
  }
  return out.sort((a, b) => b.time - a.time);
}

const dataUrl = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const dark = () => document.documentElement.classList.contains('dark');

/** The drawing a candidate comes from, around the parts it draws, the rest
 *  of that drawing faint: `{ light, dark }` picture URLs. Arranging by
 *  cells comes from several: its picture is the parts as it draws them. */
async function candidatePicture(candidate, refs, before) {
  let circuit = candidate.sourceCircuit;
  let shown = new Set(candidate.parts);
  if (candidate.cells) {
    circuit = loadDocument(JSON.parse(before));
    try { applyArrangement(circuit, refs, candidate); } catch { return null; }
    shown = new Set(refs);
  }
  let box = null;
  const grow = (r) => {
    if (!r || !(r.w > 0 || r.h > 0)) return;
    if (!box) { box = { ...r }; return; }
    const x = Math.min(box.x, r.x);
    const y = Math.min(box.y, r.y);
    box = { x, y, w: Math.max(box.x + box.w, r.x + r.w) - x, h: Math.max(box.y + box.h, r.y + r.h) - y };
  };
  for (const ref of shown) grow(circuit.components.get(ref)?.bboxWorld());
  for (const label of circuit.labels.values()) if (shown.has(label.owner)) grow(label.bbox());
  if (!box) return null;
  const viewport = { x: box.x - GRID, y: box.y - GRID, w: box.w + 2 * GRID, h: box.h + 2 * GRID };
  const ghostRefs = [...circuit.components.keys()].filter((ref) => !shown.has(ref));
  const svg = svgString(circuit, { ...DRAWING_EXPORT_OPTIONS, background: false, emptyHint: false, viewport, ghostRefs });
  const [light, darkSvg] = await Promise.all([withEmbeddedMathFont(svg), withEmbeddedMathFont(applyExportDarkTheme(svg))]);
  return { light: dataUrl(light), dark: dataUrl(darkSvg) };
}

function sourceName(candidate) {
  if (candidate.cells) return 'By cells';
  return candidate.source.current ? 'this design' : candidate.source.name;
}

/** What a card says after its source: the parts there, or for cells each
 *  cell's kind. */
function partsText(candidate) {
  if (candidate.cells) return candidate.cells.map((cell) => cell.name.replace(/^(N|P)MOS /, '')).join(', ');
  return candidate.source.builtIn ? 'built-in' : candidate.parts.join(', ');
}

/** Draw the highlighted way on the canvas, from the drawing as it was. */
function preview(index) {
  if (!picker) return;
  picker.index = index;
  applyJson(picker.before);
  picker.failed = null;
  try {
    applyArrangement(editor.circuit, picker.refs, picker.candidates[index]);
  } catch (error) {
    applyJson(picker.before);
    picker.failed = error.message;
  }
  setSelection(picker.refs);
  render();
  for (const [i, item] of picker.items.entries()) {
    item.classList.toggle('active', i === index);
    item.setAttribute('aria-selected', String(i === index));
  }
  picker.items[index]?.scrollIntoView?.({ block: 'nearest' });
  picker.note.textContent = picker.failed ? `Cannot draw it here: ${picker.failed}` : '';
  picker.note.hidden = !picker.failed;
}

function close() {
  if (!picker) return;
  picker.el.remove();
  window.removeEventListener('pointerdown', picker.outside, true);
  picker = null;
  canvasEl.focus({ preventScroll: true });
}

/** Keep the highlighted way: one undo step. */
function choose(index = picker?.index) {
  if (!picker) return;
  if (index !== picker.index || picker.failed) preview(index);
  if (picker.failed) return;
  const { before, refs, candidates } = picker;
  const chosen = candidates[index];
  close();
  recordHistoryEntry(before, true);
  setSelection(refs);
  rememberAction('arrange like', () => void openArrangePicker());
  noteTip('arrange');
  logLine(chosen.cells
    ? `${refs.join(', ')} arranged by cells: ${chosen.cells.map((cell) => `${cell.refs.join(', ')} like ${cell.like.parts.join(', ')} in ${cell.like.source.current ? 'this design' : cell.like.source.name}`).join('; ')}`
    : `${refs.join(', ')} arranged like ${chosen.parts.join(', ')} in ${sourceName(chosen)}`);
  render();
}

/** Leave the parts as they were. */
function cancel() {
  if (!picker) return;
  const { before, refs } = picker;
  close();
  applyJson(before);
  setSelection(refs);
  render();
}

function buildPicker(refs, before, candidates) {
  const el = document.createElement('div');
  el.className = 'arrange-picker glass';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Arrange like');
  el.tabIndex = -1;
  const heading = document.createElement('p');
  heading.className = 'arrange-picker-heading';
  heading.textContent = 'Arrange like';
  const list = document.createElement('div');
  list.className = 'arrange-picker-list';
  list.setAttribute('role', 'listbox');
  const note = document.createElement('p');
  note.className = 'arrange-picker-note';
  note.hidden = true;
  const items = candidates.map((candidate, index) => {
    const item = document.createElement('div');
    item.className = 'arrange-picker-item';
    item.setAttribute('role', 'option');
    const picture = document.createElement('img');
    picture.className = 'arrange-picker-picture';
    picture.alt = '';
    const caption = document.createElement('span');
    caption.className = 'arrange-picker-caption';
    const where = document.createElement('span');
    where.className = 'arrange-picker-source';
    where.textContent = sourceName(candidate);
    const parts = document.createElement('span');
    parts.className = 'arrange-picker-parts';
    parts.textContent = partsText(candidate);
    caption.append(where, parts);
    if (candidate.count > 1) {
      const count = document.createElement('span');
      count.className = 'arrange-picker-count';
      count.textContent = `×${candidate.count}`;
      caption.append(count);
    }
    const key = document.createElement('kbd');
    key.textContent = index < 9 ? String(index + 1) : '';
    item.append(key, picture, caption);
    item.addEventListener('mousemove', () => { if (picker && picker.index !== index) preview(index); });
    item.addEventListener('mousedown', (ev) => { ev.preventDefault(); choose(index); });
    void candidatePicture(candidate, refs, before).then((urls) => {
      if (!urls) return;
      picture.dataset.light = urls.light;
      picture.dataset.dark = urls.dark;
      picture.src = dark() ? urls.dark : urls.light;
    });
    return item;
  });
  list.append(...items);
  el.append(heading, list, note);
  el.addEventListener('keydown', (ev) => {
    if (!picker) return;
    ev.stopPropagation();
    const n = picker.candidates.length;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      preview((picker.index + (ev.key === 'ArrowDown' ? 1 : -1) + n) % n);
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      choose();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      cancel();
    } else if (/^[1-9]$/.test(ev.key) && Number(ev.key) <= n) {
      ev.preventDefault();
      choose(Number(ev.key) - 1);
    }
  });
  document.body.appendChild(el);
  // In the drawing's top right corner: beside the selection it would cover
  // the parts it moves.
  const pane = canvasEl.getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  el.style.left = `${Math.max(8, pane.right - rect.width - 12)}px`;
  el.style.top = `${Math.max(8, pane.top + 12)}px`;
  return { el, items, note };
}

/**
 * Open the picker for the selected parts (two or more). Says so on the
 * status bar instead when no other drawing has their topology, or every
 * one draws them as they are.
 */
export async function openArrangePicker() {
  if (picker || opening) return false;
  const refs = arrangeableRefs(editor.circuit, selectedComps().map((c) => c.refdes));
  if (refs.length < 2) {
    hintLine('Shift+Q arranges parts like another drawing of them: select two or more');
    return false;
  }
  opening = true;
  let found;
  try {
    const circuit = editor.circuit;
    const sources = [{ circuit, name: editor.currentCircuitName || 'this design' }, ...await workspaceDesigns(), ...builtInDrawings()];
    // The drawing may have changed while the workspace was read.
    if (circuit !== editor.circuit || refs.some((ref) => !circuit.components.has(ref))) return false;
    found = arrangementCandidates(circuit, refs, sources, { patterns: cellPatterns() });
  } finally {
    opening = false;
  }
  // Only what can be drawn here is offered: each tried on a copy first.
  const drawable = found.candidates.filter((candidate) => {
    try { applyArrangement(loadDocument(editor.circuit.toJSON()), refs, candidate); return true; } catch { return false; }
  });
  if (!drawable.length && found.candidates.length) {
    hintLine(`${refs.join(', ')} cannot be drawn here like the other drawings of them: no clear place, or a wire would be left off`);
    return false;
  }
  found = { ...found, candidates: drawable };
  if (!found.candidates.length) {
    hintLine(found.alike
      ? `${refs.join(', ')} are drawn like the other drawings of them already`
      : `No other drawing has ${refs.join(', ')} with the same connections`);
    return false;
  }
  if (found.candidates.some((c) => c.source.builtIn)) noteTip('arrange-built-in');
  const before = snapshot();
  const built = buildPicker(refs, before, found.candidates);
  picker = { refs, before, candidates: found.candidates, index: 0, failed: null, ...built };
  picker.outside = (ev) => { if (picker && !picker.el.contains(ev.target)) cancel(); };
  window.addEventListener('pointerdown', picker.outside, true);
  preview(0);
  picker.el.focus({ preventScroll: true });
  return true;
}

/** The picker as it stands, for tests: null when closed. */
export function arrangePickerState() {
  if (!picker) return null;
  return {
    refs: [...picker.refs],
    index: picker.index,
    failed: picker.failed,
    candidates: picker.candidates.map((c) => ({ source: sourceName(c), parts: [...c.parts], count: c.count, builtIn: c.source.builtIn, cells: c.cells?.map((cell) => cell.name) || null })),
  };
}

/** A selection of two or more parts that make a cell (a mirror, a pair, the
 *  OTA): the moment to say Shift+Q draws it as the user's drawings do.
 *  Looked at only while that tip waits, and not while the picker is open. */
let selectionSeen = '';
export function noteSelectionForTips() {
  if (!tipWaiting('arrange-like')) return;
  const refs = [...editor.multi];
  const seen = refs.sort().join(',');
  if (seen === selectionSeen) return;
  selectionSeen = seen;
  if (picker || refs.length < 2 || refs.length > 24) return;
  const circuit = editor.circuit;
  setTimeout(() => {
    if (picker || editor.circuit !== circuit) return;
    if (cellsIn(circuit, refs.filter((ref) => circuit.components.has(ref)), cellPatterns()).length) noteTip('cell-selected');
  });
}
