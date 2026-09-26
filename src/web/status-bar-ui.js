/**
 * The status bar and the log drawer: the mode chip, selection and cursor
 * readouts, the message chip, and the log it opens. The fields' wording is
 * in status-bar.js.
 */

import { LOG_DRAWER_CLOSED, contextKeyHints, logDrawerTransition, statusFields, zoomPercent } from './status-bar.js';
import { statusEl, statusKeysEl, accessibilityAnnouncementEl, logEl, cmdInput, consoleEl, statusModeEl, statusSelectionEl, statusCursorEl, statusZoomEl, statusMessageEl, logDrawerEl, logPinEl, logClearEl } from './elements.js';
import { editor } from './editor-state.js';
import { paneSize } from './canvas-view.js';
import { syncInteractionUI } from './toolbar-ui.js';
import { keyHintContext, selectedComp, selectedComps, selectedLabel, selectedLabels, symmetryAxisText, symmetryTwin } from './main.js';

let logPeekTimer = 0;

let logHoverTimer = 0;

let pointerInConsole = false;

function setStatusMessage(text, cls) {
  if (!statusMessageEl) return;
  const lines = String(text).split('\n');
  statusMessageEl.textContent = lines.length > 1 ? `${lines[0]} …` : lines[0];
  statusMessageEl.dataset.kind = cls || 'info';
  statusMessageEl.title = `${text}\nClick to open the log and command line (:)`;
  // Restart the fade: a fresh message is bright, then settles to dim.
  statusMessageEl.classList.remove('fresh');
  void statusMessageEl.offsetWidth;
  statusMessageEl.classList.add('fresh');
}

export function logLine(text, cls, { peek = true } = {}) {
  const line = document.createElement('div');
  if (cls) line.className = cls;
  line.textContent = text;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
  if (cls !== 'cmd') setStatusMessage(text, cls);
  if (cls === 'error' && peek) applyLogDrawerEvent({ type: 'error' });
  if (cls === 'error' || cls === 'status') announce(text);
}

/** Transient guidance: shown in the message chip, never appended to the log. */
export function hintLine(text) {
  setStatusMessage(text, 'hint');
}

export function applyLogDrawerEvent(event) {
  const before = editor.logDrawerState;
  editor.logDrawerState = logDrawerTransition(editor.logDrawerState, event);
  if (editor.logDrawerState === before) return;
  syncLogDrawer();
  window.clearTimeout(logPeekTimer);
  if (editor.logDrawerState.open && editor.logDrawerState.reason === 'peek') {
    logPeekTimer = window.setTimeout(() => applyLogDrawerEvent({ type: 'peek-timeout', inside: pointerInConsole }), 3500);
  }
}

function syncLogDrawer() {
  if (!logDrawerEl) return;
  const { open, pinned, reason } = editor.logDrawerState;
  logDrawerEl.hidden = !open;
  logDrawerEl.dataset.reason = reason || '';
  statusMessageEl?.setAttribute('aria-expanded', String(open));
  logPinEl?.setAttribute('aria-pressed', String(pinned));
  if (open) logEl.scrollTop = logEl.scrollHeight;
}

export function openCommandLine(prefill = '') {
  applyLogDrawerEvent({ type: 'command' });
  cmdInput.value = prefill;
  cmdInput.focus();
  cmdInput.setSelectionRange(prefill.length, prefill.length);
}

export function logCommand(line) {
  logLine(`> ${line}`, 'cmd');
}

export function announce(text) {
  if (!accessibilityAnnouncementEl) return;
  accessibilityAnnouncementEl.textContent = '';
  requestAnimationFrame(() => { accessibilityAnnouncementEl.textContent = text; });
}

export function noteActionPrevented(error) {
  const detail = error?.message || String(error || 'the requested change was rejected');
  logLine(`action prevented: ${detail}`, 'status');
}

export function renderStatus() {
  const interaction = syncInteractionUI();
  const comp = selectedComp();
  const label = selectedLabel();
  const sel = label
    ? `${label.isNetLabel?.() ? 'net' : label.owner ? 'instance' : 'annotation'} "${label.text}"${editor.selLabels.size > 1 ? ` +${editor.selLabels.size - 1}` : ''}`
    : comp
      ? `${comp.refdes}${editor.multi.size > 1 ? ` +${editor.multi.size - 1}` : ''}`
      : '';
  const parts = [];
  if (editor.analysisPick) parts.push('click a wire or pin for the analysis node · Esc cancel');
  if (editor.visual) {
    parts.push('box from cursor · arrows grow · Enter select · Esc cancel');
  }
  if (editor.mode === 'insert') {
    parts.push(editor.pendingPlace ? `place ${editor.pendingPlace.kind === 'label' ? 'label' : editor.pendingPlace.type} @ click/Enter · arrows move · R/Shift+R/Ctrl+R · Alt symmetric · Esc cancel` : editor.insertQuery ? `~${editor.insertQuery} · Enter pick` : 'type or alias to filter · Esc exit');
  }
  if (editor.symmetry) {
    const mirroring = editor.drag?.mode === 'copyghost' ? !!editor.drag.ghost?.mirror : !!symmetryTwin();
    parts.push(editor.symmetry.operation
      ? `SYMMETRY about ${symmetryAxisText()}${editor.symmetry.settled ? ' (held)' : ''}${editor.activeSymmetryCells ? ` · ${editor.activeSymmetryCells} ${editor.activeSymmetryCells === 1 ? 'cell' : 'cells'} each side, ${editor.activeSymmetryCells * 2} apart` : ''}${mirroring ? (editor.drag?.mode === 'copyghost' ? ' · commits both' : ' · Enter places both') : ' · on the axis'}`
      : `SYMMETRY armed at (${editor.symmetry.pin.x},${editor.symmetry.pin.y}) · move to mirror`);
  }
  if (editor.labelMode === 'net') parts.push('click wire · selected/highlighted net resolves crossings · Esc cancel');
  if (editor.labelMode === 'highlight') parts.push('click a wire, pin, net label, rail marker, or port to cycle its net color · 8 removes all · Esc exits');
  if (editor.labelMode === 'annotation') parts.push('click anywhere for free text · Esc cancel');
  if (editor.labelMode === 'equation') parts.push('click anywhere for LaTeX equation · Enter/blur commit · Esc cancel');
  if (editor.wire) {
    parts.push(
      `${editor.terminalSnap ? 'TERMINAL SNAP · ' : ''}` + (editor.wire.source
        ? editor.wire.source.fixed
          ? `WIRE fixed endpoint @ (${editor.wire.source.fixed.point.x},${editor.wire.source.fixed.point.y}) → click points / target`
          : editor.wire.source.refdes
            ? `WIRE ${editor.wire.source.refdes}.${editor.wire.source.term} → terminal click commits · other clicks guide · Enter commits`
            : `WIRE (${editor.wire.source.x},${editor.wire.source.y}) → terminal click commits · other clicks guide · Enter commits`
        : `WIRE (${editor.wire.routeStyle || editor.routeMode}): click a terminal or point to start`),
    );
  }
  if (editor.directWire) {
    parts.push(editor.directWire.source
      ? `${editor.directWire.source.fixed ? 'fixed endpoint suffix' : `${editor.directWire.routeMode || editor.routeMode} direct path`}${editor.directWire.points.length ? ` · ${editor.directWire.points.length} point${editor.directWire.points.length === 1 ? '' : 's'}` : ''} · click waypoints / terminal / wire · Enter · Esc cancel`
      : 'click a terminal or open fixed endpoint to start · Esc cancel');
  }
  if (editor.selectedNets.size) parts.push(`nets ${editor.selectedNets.size}`);
  if (editor.lastCheckReport && (editor.diagnosticSelection.components.size || editor.diagnosticSelection.nets.size || editor.diagnosticSelection.labels.size)) {
    parts.push(`check focus ${editor.diagnosticSelection.components.size + editor.diagnosticSelection.nets.size + editor.diagnosticSelection.labels.size}`);
  }
  if (editor.netWarnings.length) parts.push('⚠ wire overlap with another net (highlighted)');
  if (editor.circuit.netNameWarnings?.length) parts.push('⚠ merged net names require reconciliation');
  if (editor.clipboardNotice) parts.unshift(editor.clipboardNotice);
  const fields = statusFields({
    mode: editor.analysisPick ? 'PICK NET' : interaction.label,
    selection: sel,
    cursor: editor.cursor,
    hints: parts,
  });
  statusEl.textContent = fields.hint;
  renderKeyHints(!fields.hint);
  statusEl.className = `status ${interaction.key}`;
  if (editor.directWire) statusEl.classList.add('direct-wire');
  else if (editor.wire) statusEl.classList.add('wire');
  else if (editor.mode === 'insert') statusEl.classList.add('insert');
  if (statusModeEl) {
    statusModeEl.textContent = fields.mode;
    statusModeEl.className = `status-mode ${statusEl.className.replace(/^status\s*/, '')}`;
  }
  if (statusSelectionEl) {
    statusSelectionEl.textContent = fields.selection;
    statusSelectionEl.hidden = !fields.selection;
  }
  if (statusCursorEl) statusCursorEl.textContent = fields.cursor;
  // render() measured the pane before writing the DOM; measuring again here
  // would force a synchronous layout on every frame.
  if (statusZoomEl) statusZoomEl.textContent = `${zoomPercent(editor.view, (editor.viewPane || paneSize())?.w, editor.zoom)}%`;
}

/** The footer's key strip: the few keys that matter now, while no mode hint
 *  has the space. Kept out of the live status region, which it would flood. */
function renderKeyHints(show) {
  if (!statusKeysEl) return;
  const busy = editor.mode !== 'normal' || editor.wire || editor.directWire || editor.visual || editor.labelMode
    || editor.alignTool || editor.analysisPick || editor.symmetry || editor.inlineInput || editor.quickAdd
    || (editor.drag && !editor.movePending && !editor.copyPending);
  const hints = show && !busy ? contextKeyHints({
    tool: editor.moveMode ? 'move' : editor.copyMode ? 'copy' : editor.deleteMode ? 'delete' : null,
    selection: {
      parts: selectedComps().map((c) => c.type),
      labels: selectedLabels().length,
      nets: editor.selectedNets.size + editor.selectedWires.size + (editor.selectedWire ? 1 : 0),
    },
    empty: !editor.circuit.components.size && !editor.circuit.labels.size,
    ...keyHintContext(),
  }) : [];
  const key = JSON.stringify(hints);
  if (statusKeysEl.dataset.key === key) return;
  statusKeysEl.dataset.key = key;
  statusKeysEl.replaceChildren(...hints.map(([keys, action]) => {
    const item = document.createElement('span');
    item.className = 'status-key';
    const cap = document.createElement('kbd');
    cap.textContent = keys;
    item.append(cap, ` ${action}`);
    return item;
  }));
  statusKeysEl.hidden = !hints.length;
}

export function installStatusBar() {
  // The log drawer opens from the message chip (click, or a short hover), from
  // `:`, and briefly on errors. It overlays the canvas, so nothing reflows.
  if (consoleEl && logDrawerEl) {
    consoleEl.addEventListener('pointerenter', () => { pointerInConsole = true; });
    consoleEl.addEventListener('pointerleave', () => {
      pointerInConsole = false;
      window.clearTimeout(logHoverTimer);
      if (document.activeElement !== cmdInput) applyLogDrawerEvent({ type: 'leave' });
    });
    statusMessageEl?.addEventListener('click', () => applyLogDrawerEvent({ type: 'toggle' }));
    statusMessageEl?.addEventListener('pointerenter', () => {
      window.clearTimeout(logHoverTimer);
      logHoverTimer = window.setTimeout(() => applyLogDrawerEvent({ type: 'hover' }), 300);
    });
    statusMessageEl?.addEventListener('pointerleave', () => window.clearTimeout(logHoverTimer));
    logPinEl?.addEventListener('click', () => applyLogDrawerEvent({ type: 'pin' }));
    logClearEl?.addEventListener('click', () => { logEl.replaceChildren(); });
    window.addEventListener('pointerdown', (ev) => {
      if (editor.logDrawerState.open && !consoleEl.contains(ev.target)) applyLogDrawerEvent({ type: 'dismiss' });
    }, true);
    cmdInput.addEventListener('blur', () => {
      // Keep a hovered drawer open; it closes when the pointer leaves.
      if (!pointerInConsole) applyLogDrawerEvent({ type: 'command-done' });
    });
  }
}
