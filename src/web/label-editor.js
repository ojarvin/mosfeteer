/**
 * The inline editors that open over the canvas: label and annotation text,
 * a part's name and child labels, a supply bar's rail name, a reference
 * marker's value, and a schematic block's caption.
 */

import { INTERFACE_PIN_TYPES, isReferenceMarker, normalizeComponentRefdes, referenceMarkerInfo, stripMathDelimiters, applyMarkup } from '../core/model.js';
import { supplyBars } from '../core/supply-bars.js';
import { switchState } from '../core/beats.js';
import { labelFontSize } from '../core/style.js';
import { snap } from '../core/grid.js';
import { logLine } from './status-bar-ui.js';
import { editor } from './editor-state.js';
import { commit, confirmNamedConnection, cycleLabelSelection, interfacePortNet, markModelChanged, namedConnectionConflicts, portNameConflict, recordHistoryEntry, renameLabelThroughModel, render, reportPortNameConflict, restoreProvisionalLabel, snapshot, supplyBarGroup } from './main.js';

/** Standard inline-editor keys: Enter or blur commits, Escape cancels, and
 *  Shift+Enter inserts a line break where the field accepts one. Extra keys
 *  are handled first and may claim the event by returning true. */
export function bindInlineEditorKeys(input, done, { multiline = true, extraKeys = null } = {}) {
  input.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (extraKeys?.(ev)) return;
    if (multiline && ev.key === 'Enter' && ev.shiftKey) return;
    if (ev.key === 'Enter') { ev.preventDefault(); done(true); }
    else if (ev.key === 'Escape') { ev.preventDefault(); done(false); }
  });
  input.addEventListener('blur', () => done(true));
}

/** A box annotation's geometry and its child labels' anchors, to restore. */
export function boxState(label) {
  const children = new Map();
  for (const child of editor.circuit.labels.values()) if (child.parent === label.id) children.set(child.id, { ...child.anchor });
  return { anchor: { ...label.anchor }, end: { ...label.end }, textAnchor: { ...label.textAnchor }, children };
}

export function restoreBoxState(label, state) {
  label.anchor = { ...state.anchor };
  label.end = { ...state.end };
  label.textAnchor = { ...state.textAnchor };
  for (const [id, anchor] of state.children) {
    const child = editor.circuit.labels.get(id);
    if (child) child.anchor = { ...anchor };
  }
}

export function inlineEditSchematicBlock(component) {
  if (!component || component.type !== 'block' || editor.inlineInput) return;
  const pane = document.querySelector('.canvas-pane');
  const input = document.createElement('textarea');
  input.value = component.value || '';
  input.spellcheck = false;
  input.className = 'label-inline-editor block-inline-editor';
  input.style.position = 'fixed';
  input.style.zIndex = '30';
  // Covers the block at the current zoom and pan, repositioned on every repaint.
  input.relayout = () => {
    const paneRect = pane.getBoundingClientRect();
    const box = component.bboxWorld();
    input.style.left = `${paneRect.left + ((box.x - editor.view.x) / editor.view.w) * paneRect.width}px`;
    input.style.top = `${paneRect.top + ((box.y - editor.view.y) / editor.view.h) * paneRect.height}px`;
    input.style.width = `${(box.w / editor.view.w) * paneRect.width}px`;
    input.style.height = `${(box.h / editor.view.h) * paneRect.height}px`;
  };
  input.relayout();
  input.style.textAlign = 'center';
  input.style.resize = 'none';
  input.style.whiteSpace = 'pre-wrap';
  input.style.overflow = 'hidden';
  document.body.appendChild(input);
  editor.inlineInput = input;
  input.focus({ preventScroll: true });
  input.select();
  let closed = false;
  const done = (apply) => {
    if (closed) return;
    closed = true;
    editor.inlineInput = null;
    const text = input.value.trim();
    input.remove();
    if (apply && text && text !== component.value) commit(() => editor.circuit.setValue(component.refdes, text));
    render();
  };
  bindInlineEditorKeys(input, done);
}

export function openComponentChildLabelEditor(component) {
  if (!component || editor.inlineInput) return;
  if (isReferenceMarker(component)) {
    openReferenceMarkerEditor(component);
    return;
  }
  if (component.type === 'block') {
    inlineEditSchematicBlock(component);
    return;
  }
  let label = editor.circuit.labelOf(component.refdes);
  if (label) {
    inlineEditLabel(label);
    return;
  }
  // Legacy/imported symbols can lack the owned label that current inserts get
  // automatically. Create it at the symbol's declared label offset, then use
  // a draft edit so Escape/blank restores the pre-edit circuit unchanged.
  if (!component.def?.labelOffset || !editor.circuit._ensureComponentInstanceLabel) return;
  const before = snapshot();
  label = editor.circuit._ensureComponentInstanceLabel(component);
  if (label) inlineEditLabel(label, { ownedLabelDraft: true, initialSnapshot: before });
}

/** A joined supply bar has one label, shown over its first supply and
 *  centred on the bar; its name goes to every supply on the bar. */
function openSupplyBarLabelEditor(refs) {
  const lead = editor.circuit.components.get(refs[0]);
  const existing = editor.circuit.labelOf(lead.refdes);
  if (existing) {
    inlineEditLabel(existing, { removeOnEmpty: true });
    return;
  }
  const bar = supplyBars(editor.circuit).find((candidate) => candidate.refs[0] === lead.refdes);
  const info = referenceMarkerInfo('supply');
  const centre = bar ? bar.rect.x + bar.rect.w / 2 : lead.transform.x;
  const before = snapshot();
  const label = editor.circuit.addLabel({
    text: '',
    owner: lead.refdes,
    // Local offsets rotate with the supply; a bar is only ever centred for an
    // upright one, which is also the only way a row of them reads as a bar.
    offset: lead.transform.rotation ? info.labelOffset : { x: snap(centre - lead.transform.x), y: info.labelOffset.y },
    align: 'center',
    style: { color: lead.style.color },
  });
  inlineEditLabel(label, { markerDraft: true, initialSnapshot: before, removeOnEmpty: true });
}

export function openReferenceMarkerEditor(component) {
  if (!component || editor.inlineInput) return;
  const bar = component.type === 'supply' ? supplyBarGroup(component.refdes) : [];
  if (bar.length > 1) {
    openSupplyBarLabelEditor(bar);
    return;
  }
  const existing = editor.circuit.labelOf(component.refdes);
  if (existing) {
    inlineEditLabel(existing, { removeOnEmpty: true });
    return;
  }
  const info = referenceMarkerInfo(component.type);
  if (!info) return;
  const before = snapshot();
  const label = editor.circuit.addLabel({
    text: component.value || '',
    owner: component.refdes,
    offset: info.labelOffset,
    align: 'parent',
    style: { color: component.style.color },
  });
  inlineEditLabel(label, { markerDraft: true, initialSnapshot: before, removeOnEmpty: true });
}

export function inlineEditLabel(label, options = {}) {
  if (!label || label.role === 'signal-input-sign' || editor.inlineInput) return;
  const provisional = !!options.provisional;
  const equationDraft = !!options.equationDraft;
  const initialSnapshot = options.initialSnapshot || null;
  const initialName = options.initialName || '';
  // A joined supply bar is one rail: whatever this edit names, every supply on
  // the bar takes. Captured now, since the edit itself may break the bar.
  const barRefs = label.owner ? supplyBarGroup(label.owner) : [];
  const nameBar = (text) => {
    if (barRefs.length > 1) editor.circuit.nameSupplyBar(barRefs, text);
  };
  editor.lastLabelClick = null; // starting an edit clears any pending double-click state
  const pane = document.querySelector('.canvas-pane');
  const align = label.textAlign();
  const editorPad = 4;
  // Ordinary Enter commits. Shift+Enter is reserved for inserting a newline
  // and is shared by every LabelInstance editor, including connector labels.
  const input = document.createElement('textarea');
  input.value = label.text;
  input.spellcheck = false;
  input.className = 'label-inline-editor';
  input.dataset.labelId = label.id;
  // Fixed, in viewport coordinates, and focused without scrolling: a long
  // label's editor may run past the window, and an absolute element there
  // would widen the page and scroll the whole editor sideways on focus.
  input.style.position = 'fixed';
  input.style.zIndex = '30';
  input.style.textAlign = align;
  input.style.resize = 'none';
  input.style.whiteSpace = 'pre-wrap';
  input.style.overflowWrap = 'anywhere';
  input.style.overflow = 'hidden';
  // Measure the live editor text in the same face as the rendered label. The
  // The box grows from the actual text anchor while keeping alignment stable.
  const measure = document.createElement('span');
  measure.className = 'label-inline-editor-measure';
  document.body.appendChild(measure);
  // The editor covers the text, not the label's grid box: the label's own
  // font at the current zoom, one line tall per line, centred where the text
  // is drawn, and growing from the text's aligned edge (or its centre) just
  // as the drawn text does. Laid out again on every repaint, so it follows
  // zooming and panning like the drawing.
  const resize = () => {
    const b = label.bbox();
    const r = pane.getBoundingClientRect();
    const scale = r.width / editor.view.w;
    const screenX = (x) => r.left + (x - editor.view.x) * scale;
    const inset = label.math ? 0 : label.alignInset();
    const alignedEdge = align === 'left' ? screenX(b.x + inset) - editorPad
      : align === 'right' ? screenX(b.x + b.w - inset) + editorPad
        : screenX(b.x + b.w / 2);
    const fontPx = Math.max(6, labelFontSize(label.style?.width) * scale);
    input.style.fontSize = `${fontPx}px`;
    measure.textContent = input.value || ' ';
    measure.style.fontSize = input.style.fontSize;
    // Long text wraps inside the visible canvas instead of running off it,
    // and scrolls within the editor once even that is taller than the pane.
    const margin = 8;
    const width = Math.min(r.width - 2 * margin, Math.max(2 * fontPx, measure.getBoundingClientRect().width + 4));
    const wanted = align === 'left' ? alignedEdge : align === 'right' ? alignedEdge - width : alignedEdge - width / 2;
    const left = Math.min(Math.max(wanted, r.left + margin), r.right - margin - width);
    input.style.width = `${width}px`;
    input.style.left = `${left}px`;
    input.style.height = '0px';
    const lines = input.value.split('\n').length * fontPx * 1.2 + 4;
    const height = Math.min(r.height - 2 * margin, Math.max(lines, input.scrollHeight + 2));
    input.style.height = `${height}px`;
    input.style.overflowY = input.scrollHeight > height + 1 ? 'auto' : 'hidden';
    const centre = r.top + (b.y + b.h / 2 - editor.view.y) * scale;
    input.style.top = `${Math.min(Math.max(centre - height / 2, r.top + margin), r.bottom - margin - height)}px`;
  };
  input.relayout = resize;
  resize();
  input.addEventListener('input', resize);
  document.body.appendChild(input);
  editor.inlineInput = input;
  render();
  input.focus({ preventScroll: true });
  if (equationDraft) input.setSelectionRange(Math.min(1, input.value.length), Math.min(1, input.value.length));
  else input.select();
  let closed = false;
  let prompting = false;
  const done = async (applyText) => {
    if (closed || prompting) return;
    const v = input.value.trim();
    const owner = label.owner ? editor.circuit.components.get(label.owner) : null;
    const namesNet = !!label.netId || !!(owner && INTERFACE_PIN_TYPES.has(owner.type));
    if (applyText && v && v !== label.text && namesNet) {
      const targetNet = label.netId ? editor.circuit.nets.get(label.netId) : interfacePortNet(owner);
      const conflicts = namedConnectionConflicts(v, {
        netId: targetNet?.id || null,
        ownerRefdes: owner?.refdes || null,
      });
      const portConflict = portNameConflict(conflicts, owner?.refdes);
      if (portConflict) {
        reportPortNameConflict(portConflict, v);
        input.focus({ preventScroll: true });
        input.select();
        return false;
      }
      if (conflicts.length) {
        prompting = true;
        const connect = await confirmNamedConnection(v, conflicts);
        prompting = false;
        if (!connect) {
          input.focus({ preventScroll: true });
          input.select();
          return false;
        }
      }
    }
    closed = true;
    editor.inlineInput = null;
    measure.remove();
    input.remove();
    if (provisional) {
      if (applyText && v) {
        try {
          renameLabelThroughModel(label, v);
          recordHistoryEntry(initialSnapshot || snapshot());
        } catch (err) {
          logLine(`net label edit cancelled: ${err.message}`, 'error');
          restoreProvisionalLabel(label, initialName);
        }
      } else {
        restoreProvisionalLabel(label, initialName);
      }
      markModelChanged(false);
    } else if (options.markerDraft) {
      if (applyText) {
        try {
          label.setText(v);
          if (!v) editor.circuit.removeLabel(label.id);
          nameBar(v);
          recordHistoryEntry(initialSnapshot || snapshot());
        } catch (err) {
          logLine(`reference marker label edit cancelled: ${err.message}`, 'error');
          editor.circuit.removeLabel(label.id);
        }
      } else {
        editor.circuit.removeLabel(label.id);
      }
      markModelChanged(false);
    } else if (options.ownedLabelDraft) {
      if (applyText && v) {
        try {
          if (v !== label.text) renameLabelThroughModel(label, v);
          recordHistoryEntry(initialSnapshot || snapshot());
        } catch (err) {
          logLine(`component label edit cancelled: ${err.message}`, 'error');
          editor.circuit.removeLabel(label.id);
        }
      } else if (editor.circuit.labels.has(label.id)) {
        editor.circuit.removeLabel(label.id);
      }
      markModelChanged(false);
    } else if (equationDraft) {
      // A fresh equation starts as `$$`; Escape, blur without content, or an
      // untouched draft should not leave a literal delimiter label behind.
      if (applyText && stripMathDelimiters(v)) {
        if (v !== label.text) commit(() => renameLabelThroughModel(label, v));
      } else if (editor.circuit.labels.has(label.id)) commit(() => editor.circuit.removeLabel(label.id));
    } else if (applyText && v && v !== label.text) {
      const owner = label.owner ? editor.circuit.components.get(label.owner) : null;
      // Interface pins validate exactly like every other instance label: the
      // label is the component's identity, and a port additionally names its
      // net through the same rename. A switch's label is its phase instead.
      const ordinaryOwner = owner && !isReferenceMarker(owner) && !switchState(owner) && !label.math;
      if (ordinaryOwner) {
        const canonical = normalizeComponentRefdes(v);
        if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(canonical)) {
          logLine(`Invalid component name "${v}".`, 'error');
        } else if (canonical !== owner.refdes && editor.circuit.components.has(canonical)) {
          logLine(`Component name "${canonical}" is already in use.`, 'error');
        } else {
          commit(() => renameLabelThroughModel(label, v));
        }
      } else {
        commit(() => {
          renameLabelThroughModel(label, v);
          nameBar(v);
        });
      }
    }
    else if (options.removeOnEmpty && !v) commit(() => {
      if (label.owner && isReferenceMarker(editor.circuit.components.get(label.owner))) label.setText('');
      editor.circuit.removeLabel(label.id);
      nameBar('');
    });
    render();
    return true;
  };
  // Ctrl+, (comma) / Ctrl+. (period) wrap the selected text in subscript /
  // superscript markup `_{...}` / `^{...}`. Toggle off (un-wrap) by pressing
  // again on the same selection; a selection that mixes plain and sub/super
  // text reverts everything in it to normal. The canvas re-renders the markup
  // live so the effect is visible while editing.
  const toggleMarkup = (mark) => {
    const res = applyMarkup(input.value, input.selectionStart, input.selectionEnd, mark);
    if (!res) return;
    input.value = res.text;
    input.setSelectionRange(res.selStart, res.selEnd);
    if (provisional) {
      renameLabelThroughModel(label, res.text);
      markModelChanged(false);
    } else commit(() => renameLabelThroughModel(label, res.text));
    render();
  };
  bindInlineEditorKeys(input, done, {
    extraKeys: (ev) => {
      if (ev.key === 'Tab') {
        ev.preventDefault();
        done(true).then((committed) => {
          if (committed) cycleLabelSelection(ev.shiftKey ? -1 : 1, label.id);
        });
        return true;
      }
      if ((ev.ctrlKey || ev.metaKey) && (ev.key === ',' || ev.key === '.')) {
        ev.preventDefault();
        toggleMarkup(ev.key === ',' ? '_' : '^');
        return true;
      }
      return false;
    },
  });
}
