/**
 * Arrange suggestions (Settings → Arrange suggestions, off by default): when
 * an edit completes a cell (core/arrange.js cellsIn: a mirror, a pair, the
 * five-transistor OTA) that the user's own drawings draw otherwise, the cell
 * is shown faintly as they draw it, and the status bar offers it: Tab draws
 * it (one undo step), Escape or any other edit lets it go. Only cells the
 * last edit completed are offered, only from the open design and the
 * workspace's other designs (never the built-in drawings), and a cell let go
 * is not offered again while the design is open. A browser preference.
 */

import { noteTip } from './onboarding.js';
import { applyArrangement, arrangeableRefs, cellDrawing, cellsIn } from '../core/arrange.js';
import { cellPatterns } from '../core/arrange-builtins.js';
import { loadDocument } from '../core/document.js';
import { componentShapeSvg } from '../core/render.js';
import { workspaceDesigns } from './arrange-ui.js';
import { editor } from './editor-state.js';
import { arrangeSuggestionsButton } from './elements.js';
import { markModelChanged, onDocumentShown, recordHistoryEntry, render, setSelection, snapshot } from './main.js';
import { hintLine, logLine } from './status-bar-ui.js';

const SETTING_KEY = 'mosfeteer.arrangeSuggestions';
/** Quiet time after an edit before looking: a burst of edits looks once. */
const SETTLE_MS = 400;

let on = (() => {
  try { return globalThis.localStorage?.getItem(SETTING_KEY) === '1'; } catch { return false; }
})();
/** The cells there were at the last look (null before the first). */
let seen = null;
/** Cells offered and let go, while this design is open. */
let dismissed = new Set();
let timer = 0;
let looking = 0;
let suggestion = null;
let layerEl = null;
let layerKey = '';

const cellKey = (cell) => `${cell.name}:${cell.refs.join(',')}`;

export function arrangeSuggestionsOn() {
  return on;
}

export function setArrangeSuggestions(next) {
  on = !!next;
  try { globalThis.localStorage?.setItem(SETTING_KEY, on ? '1' : ''); } catch { /* per-session only */ }
  arrangeSuggestionsButton?.setAttribute('aria-checked', String(on));
  hintLine(on ? 'arrange suggestions on' : 'arrange suggestions off');
  if (on) noteTip('arrange-suggestions-on');
  if (!on) clearSuggestion();
  rememberCells();
}

/** The cells there are now: none of them is offered, only those an edit
 *  completes from here on. */
function rememberCells() {
  clearTimeout(timer);
  looking += 1;
  const circuit = editor.circuit;
  seen = on && circuit ? new Set(cellsIn(circuit, arrangeableRefs(circuit, [...circuit.components.keys()]), cellPatterns()).map(cellKey)) : null;
}

/** The suggestion standing, while the drawing is as it was found on. */
export function arrangeSuggestion() {
  if (suggestion && (suggestion.revision !== editor.modelRevision || suggestion.circuit !== editor.circuit)) clearSuggestion({ quiet: true });
  return suggestion;
}

function clearSuggestion({ quiet = false } = {}) {
  if (!suggestion) return;
  dismissed.add(suggestion.key);
  suggestion = null;
  if (!quiet) render();
}

/** After an edit is committed: look again once the edits settle. Any
 *  suggestion standing is let go. */
export function noteDrawingEdit() {
  if (!on) return;
  clearSuggestion({ quiet: true });
  clearTimeout(timer);
  timer = setTimeout(() => void look(), SETTLE_MS);
}

async function look() {
  const ticket = ++looking;
  const circuit = editor.circuit;
  const revision = editor.modelRevision;
  const cells = cellsIn(circuit, arrangeableRefs(circuit, [...circuit.components.keys()]), cellPatterns());
  const fresh = seen ? cells.filter((cell) => !seen.has(cellKey(cell)) && !dismissed.has(cellKey(cell))) : [];
  seen = new Set(cells.map(cellKey));
  if (!fresh.length) return;
  const sources = [{ circuit, name: 'this design' }, ...await workspaceDesigns()];
  // The drawing changed while the workspace was read: that edit looks again.
  if (ticket !== looking || circuit !== editor.circuit || revision !== editor.modelRevision) return;
  for (const cell of fresh) {
    const best = cellDrawing(circuit, cell, sources);
    if (!best) continue;
    // Only what can be drawn is offered: tried on a copy first.
    const preview = loadDocument(circuit.toJSON());
    try { applyArrangement(preview, best.refs, best.candidate); } catch { continue; }
    const { candidate } = best;
    // Named by its transistors, here and there; the rail symbols go along.
    const own = new Set(cell.map.values());
    const names = (list) => best.refs.map((ref, i) => [ref, list[i]]).filter(([ref]) => own.has(ref)).map(([, name]) => name).join(', ');
    suggestion = {
      key: cellKey(cell),
      circuit,
      revision,
      refs: best.refs,
      candidate,
      preview,
      text: `${names(best.refs)} make a ${cell.name.replace(/^(N|P)MOS /, '')}: like ${names(candidate.parts)} in ${candidate.source.current ? 'this design' : candidate.source.name}`,
    };
    render();
    return;
  }
}

/** After an undo or a redo: what is there now is not new, and a suggestion
 *  standing goes (it is not let go: an edit may complete the cell again). */
export function noteDrawingReplaced() {
  suggestion = null;
  rememberCells();
}

/** Tab: draw the cell as suggested. */
export function acceptArrangeSuggestion() {
  const standing = arrangeSuggestion();
  if (!standing) return false;
  suggestion = null;
  const before = snapshot();
  try {
    applyArrangement(editor.circuit, standing.refs, standing.candidate);
  } catch (error) {
    logLine(`Could not arrange ${standing.refs.join(', ')}: ${error.message}`, 'error');
    render();
    return true;
  }
  recordHistoryEntry(before, true);
  markModelChanged();
  setSelection(standing.refs);
  logLine(`${standing.refs.join(', ')} arranged ${standing.text.replace(/^.*?: /, '')}`);
  render();
  return true;
}

/** Escape: let the suggestion go. */
export function dismissArrangeSuggestion() {
  if (!arrangeSuggestion()) return false;
  clearSuggestion();
  return true;
}

/** The status bar's line for the suggestion standing, or null. */
export function arrangeSuggestionHint() {
  const standing = arrangeSuggestion();
  return standing ? `SUGGESTION: ${standing.text} · Tab draws it · Esc lets it go` : null;
}

/** A fresh layer in a newly built canvas, under the editor overlay. */
export function mountArrangeSuggestion(svgEl) {
  layerEl = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  layerEl.setAttribute('class', 'arrange-suggestion');
  layerEl.setAttribute('pointer-events', 'none');
  svgEl.appendChild(layerEl);
  layerKey = '';
}

/** The suggested cell, faint: its parts and their wires as it draws them. */
function suggestionSvg() {
  const standing = arrangeSuggestion();
  if (!standing) return '';
  const { preview, refs } = standing;
  const wanted = new Set(refs);
  const parts = refs.map((ref) => preview.components.get(ref)).filter(Boolean).map((c) => componentShapeSvg(c)).join('');
  const wires = [...preview.nets.values()]
    .filter((net) => net.terminals.some((t) => wanted.has(t.comp)))
    .flatMap((net) => net.paths())
    .map((path) => `<polyline points="${path.map((p) => `${p.x},${p.y}`).join(' ')}"/>`)
    .join('');
  return `${parts}<g class="arrange-suggestion-wires">${wires}</g>`;
}

export function syncArrangeSuggestion() {
  if (!layerEl) return;
  const svg = suggestionSvg();
  if (svg === layerKey) return;
  layerKey = svg;
  layerEl.innerHTML = svg;
}

export function installArrangeSuggestions() {
  arrangeSuggestionsButton?.addEventListener('click', () => setArrangeSuggestions(!on));
  arrangeSuggestionsButton?.setAttribute('aria-checked', String(on));
  onDocumentShown(() => {
    dismissed = new Set();
    suggestion = null;
    rememberCells();
  });
}

/** For tests: the suggestion standing, as plain data. */
export function arrangeSuggestionState() {
  const standing = arrangeSuggestion();
  return standing ? { refs: [...standing.refs], parts: [...standing.candidate.parts], source: standing.candidate.source.name, text: standing.text } : null;
}
