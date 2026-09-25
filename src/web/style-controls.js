/**
 * The style controls for the selection: color, line dash and arrowheads,
 * width, text alignment, bold and italic. The side panel and the context
 * menu's style strip share them; Ctrl+Shift+V pastes a copied style.
 */

import { defaultArrowhead, polylineArrowheadStyles, polylineArrowheadValue, arrowheadEnds } from '../core/line-style.js';
import { componentContextMenuEl } from './elements.js';
import { ICON_PATHS } from './icons.js';
import { logLine } from './status-bar-ui.js';
import { editor } from './editor-state.js';
import { commit, keyToWire, render, selectedComps, selectedLabels } from './main.js';

/** Text-bearing selection: labels and annotation captions. */
function selectedTextTargets() {
  const labels = new Map();
  for (const label of selectedLabels()) {
    if (label.kind === 'label') labels.set(label.id, label);
    if (['arrow', 'box', 'line'].includes(label.kind)) {
      for (const child of editor.circuit.labels.values()) {
        if (child.parent === label.id) labels.set(child.id, child);
      }
    }
  }
  // Keep the result shape used by the shared text-style controls.  Schematic
  // block text is no longer a separate selection role, but the panel still
  // asks for this collection while deciding whether its row is visible.
  return { labels: [...labels.values()], blocks: [] };
}

function selectedFontState(field) {
  const { labels } = selectedTextTargets();
  return labels.length > 0 && labels.every((label) => label.style?.[field] !== false);
}

function setSelectedLabelFont(field, on) {
  const { labels } = selectedTextTargets();
  if (!labels.length) return;
  commit(() => {
    for (const label of labels) label.style[field] = on;
  });
  render();
}

export function toggleSelectedLabelFont(field) {
  setSelectedLabelFont(field, !selectedFontState(field));
}

function setSelectedLabelAlign(align) {
  const { labels } = selectedTextTargets();
  if (!labels.length) return;
  commit(() => labels.forEach((label) => label.setAlign(align)));
  render();
}

function selectedWireTargets() {
  return [...editor.selectedWires].map((key) => {
    const wire = keyToWire(key);
    return wire ? { net: editor.circuit.nets.get(wire.netId), key: `${wire.branch}:${wire.segment}` } : null;
  }).filter((item) => item?.net);
}

export function styleDefaults(field) {
  return field === 'color' ? '#111' : field === 'lineStyle' ? 'solid' : field === 'arrowhead' ? 'none' : 'normal';
}

function arrowheadKind(object) {
  if (object?.kind === 'arrow' || object?.kind === 'line') return object.kind;
  if (object?.routingMode) return 'wire';
  return null;
}

function supportsArrowhead(object) {
  return !!arrowheadKind(object);
}

/** Combine the two independent start/end toggle buttons into the one shared
 * arrowhead value the model stores. */
function combineArrowheadEnds(start, end) {
  return start && end ? 'both' : start ? 'start' : end ? 'end' : 'none';
}

const LINE_STYLE_ICONS = { solid: 'line-solid', dashed: 'line-dashed', 'dash-dot': 'line-dash-dot', dotted: 'line-dotted' };

function singlePathArrowheadValue(net) {
  const path = net?.paths?.()[0];
  if (!path || path.length < 2) return defaultArrowhead('wire');
  return polylineArrowheadValue(net.wireStyles, 0, path, net.style?.arrowhead);
}

export function wireStyleValue(net, key, field) {
  const wire = keyToWire(`${net?.id || ''}:${key}`);
  if (field === 'arrowhead' && net?.paths?.().length === 1 && wire.branch === 0) {
    return singlePathArrowheadValue(net);
  }
  return net?.wireStyles?.[key]?.[field] ?? net?.style?.[field] ?? styleDefaults(field);
}

function objectStyleValue(object, field) {
  if (field === 'arrowhead' && supportsArrowhead(object)) {
    if (object?.routingMode) {
      return object.paths?.().length === 1
        ? singlePathArrowheadValue(object)
        : object.style?.arrowhead || defaultArrowhead('wire');
    }
    return object.style?.arrowhead || defaultArrowhead(arrowheadKind(object));
  }
  return object?.style?.[field] || styleDefaults(field);
}

/** Put a shared arrowhead on the two endpoints of a one-path wire. */
function setSinglePathArrowhead(net, value) {
  const path = net?.paths?.()[0];
  if (!path || path.length < 2) return false;
  net.wireStyles = polylineArrowheadStyles(net.wireStyles, 0, path, value);
  // Segment styles now carry the endpoint-only placement. Leaving a net-wide
  // value here would make the renderer inherit it at every segment.
  delete net.style.arrowhead;
  return true;
}

function applyNetStyle(net, style) {
  const next = { ...style };
  if (next.arrowhead !== undefined && net.paths?.().length === 1) {
    setSinglePathArrowhead(net, next.arrowhead);
    delete next.arrowhead;
  }
  net.style = { ...(net.style || {}), ...next };
}

function applyWireTargetStyle(net, key, style) {
  const wire = keyToWire(`${net.id}:${key}`);
  const next = { ...style };
  if (next.arrowhead !== undefined && net.paths?.().length === 1 && wire.branch === 0) {
    setSinglePathArrowhead(net, next.arrowhead);
    delete next.arrowhead;
  }
  if (Object.keys(next).length) {
    net.wireStyles[key] = { ...(net.wireStyles[key] || {}), ...next };
  }
}

function selectedWireTargetKeys() {
  const keys = new Set(editor.selectedWires);
  if (editor.selectedWire) keys.add(`${editor.selectedWire.netId}:${editor.selectedWire.branch}:${editor.selectedWire.segment}`);
  return [...keys];
}

export function selectedStyleSource() {
  const comps = selectedComps();
  const labels = selectedLabels();
  const nets = [...editor.selectedNets].map((id) => editor.circuit.nets.get(id)).filter(Boolean);
  const wireKeys = selectedWireTargetKeys();
  const total = comps.length + labels.length + nets.length + wireKeys.length;
  if (total !== 1) return null;
  if (comps.length === 1) return { kind: 'object', style: { ...(comps[0].style || {}) } };
  if (labels.length === 1) return { kind: 'object', style: { ...(labels[0].style || {}) } };
  if (nets.length === 1) {
    const net = nets[0];
    return {
      kind: 'object',
      style: {
        ...(net.style || {}),
        ...(net.paths?.().length === 1 ? { arrowhead: singlePathArrowheadValue(net) } : {}),
      },
    };
  }
  const wire = keyToWire(wireKeys[0]);
  const net = editor.circuit.nets.get(wire.netId);
  if (!net) return null;
  return {
    kind: 'wire',
    style: {
      ...(net.wireStyles?.[`${wire.branch}:${wire.segment}`] || net.style || {}),
      arrowhead: wireStyleValue(net, `${wire.branch}:${wire.segment}`, 'arrowhead'),
    },
  };
}

function applyStyleToSelected(style) {
  const comps = selectedComps();
  const labels = selectedLabels();
  const wireTargets = selectedWireTargets();
  const nets = [...editor.selectedNets].map((id) => editor.circuit.nets.get(id)).filter(Boolean);
  const wireKeys = selectedWireTargetKeys();
  if (editor.selectedWire) {
    const net = editor.circuit.nets.get(editor.selectedWire.netId);
    if (net) wireTargets.push({ net, key: `${editor.selectedWire.branch}:${editor.selectedWire.segment}` });
  }
  const objects = [...comps, ...labels, ...nets];
  if (!objects.length && !wireTargets.length) {
    logLine('nothing selected for style paste');
    return false;
  }
  commit(() => {
    for (const obj of objects) {
      const next = { ...(obj.style || {}) };
      for (const field of ['color', 'lineStyle', 'width', 'arrowhead']) {
        if (style[field] !== undefined && (field !== 'lineStyle' || ['arrow', 'box', 'line'].includes(obj.kind) || obj.routingMode) &&
            (field !== 'arrowhead' || supportsArrowhead(obj))) {
          next[field] = style[field];
        }
      }
      if (style.color !== undefined && typeof obj.setColor === 'function') obj.setColor(style.color);
      if (obj.routingMode) applyNetStyle(obj, next);
      else obj.style = { ...(obj.style || {}), ...next };
    }
    for (const { net, key } of wireTargets) {
      applyWireTargetStyle(net, key, style);
    }
  });
  render();
  return true;
}

export function pasteStyle() {
  if (!editor.clipboard?.style) {
    logLine(editor.clipboard ? 'style paste requires a single copied object' : 'nothing copied');
    return false;
  }
  return applyStyleToSelected(editor.clipboard.style);
}

function applySelectedStyle(field, value) {
  const comps = selectedComps();
  const labels = selectedLabels();
  const wireTargets = selectedWireTargets();
  const nets = [...editor.selectedNets].map((id) => editor.circuit.nets.get(id)).filter(Boolean);
  if (editor.selectedWire) {
    const net = editor.circuit.nets.get(editor.selectedWire.netId);
    if (net) wireTargets.push({ net, key: `${editor.selectedWire.branch}:${editor.selectedWire.segment}` });
  }
  const objects = [...comps, ...labels, ...nets];
  if (!objects.length && !wireTargets.length) return;
  const next = value || styleDefaults(field);
  commit(() => {
    for (const obj of objects) {
      if (field === 'lineStyle' && !['arrow', 'box', 'line'].includes(obj.kind) && !obj.routingMode) continue;
      if (field === 'arrowhead' && !supportsArrowhead(obj)) continue;
      if (field === 'color' && typeof obj.setColor === 'function') obj.setColor(next);
      else if (obj.routingMode) applyNetStyle(obj, { [field]: next });
      else obj.style = { ...(obj.style || {}), [field]: next };
    }
    for (const { net, key } of wireTargets) {
      applyWireTargetStyle(net, key, { [field]: next });
    }
  });
  render();
}

/** The selection's shared style, or null when nothing styleable is selected.
 * A field the selection disagrees on reads as ''. */
export function selectionStyleState() {
  const wireTargets = selectedWireTargets();
  if (editor.selectedWire) {
    const net = editor.circuit.nets.get(editor.selectedWire.netId);
    if (net) wireTargets.push({ net, key: `${editor.selectedWire.branch}:${editor.selectedWire.segment}` });
  }
  const objects = [...selectedComps(), ...selectedLabels(), ...[...editor.selectedNets].map((id) => editor.circuit.nets.get(id)).filter(Boolean)];
  if (!objects.length && !wireTargets.length) return null;
  const hasWireSelection = wireTargets.length > 0 || editor.selectedNets.size > 0;
  const common = (values) => (values.length && values.every((v) => v === values[0]) ? values[0] : '');
  const pick = (field) => common([
    ...objects.map((o) => objectStyleValue(o, field)),
    ...wireTargets.map(({ net, key }) => wireStyleValue(net, key, field)),
  ]);
  const { labels } = selectedTextTargets();
  return {
    color: pick('color'),
    lineStyle: pick('lineStyle'),
    arrowhead: pick('arrowhead'),
    width: pick('width'),
    supportsLine: hasWireSelection || objects.some((o) => ['arrow', 'box', 'line'].includes(o.kind)),
    supportsArrowhead: hasWireSelection || objects.some(supportsArrowhead),
    text: labels.length ? {
      align: labels.every((label) => label.align === labels[0].align) ? labels[0].align : null,
      towardPart: labels.every((label) => label.owner || label.netId),
      bold: selectedFontState('bold'),
      italic: selectedFontState('italic'),
    } : null,
  };
}

/** Reflect a selection style in one set of style controls: the side panel's
 * or the context menu's strip, which share their data attributes. */
export function syncStyleControls(root, state) {
  const pressed = (button, on) => button.setAttribute('aria-pressed', String(on));
  const lineRow = root.querySelector('[data-style-row="line"]');
  const textRow = root.querySelector('[data-style-row="text"]');
  if (lineRow) lineRow.hidden = !state.supportsLine;
  if (textRow) textRow.hidden = !state.text;
  const ends = arrowheadEnds(state.arrowhead);
  for (const button of root.querySelectorAll('[data-arrow-end]')) {
    button.hidden = button.disabled = !state.supportsArrowhead;
    pressed(button, ends[button.dataset.arrowEnd]);
  }
  for (const button of root.querySelectorAll('[data-line-style]')) pressed(button, button.dataset.lineStyle === state.lineStyle);
  for (const button of root.querySelectorAll('[data-width]')) pressed(button, button.dataset.width === state.width);
  for (const swatch of root.querySelectorAll('.swatch')) swatch.setAttribute('aria-checked', String(swatch.dataset.value === state.color));
  for (const button of root.querySelectorAll('[data-style-align]')) {
    if (button.dataset.styleAlign === 'parent') button.hidden = button.disabled = !state.text?.towardPart;
    pressed(button, button.dataset.styleAlign === state.text?.align);
  }
  for (const button of root.querySelectorAll('[data-style-font]')) pressed(button, !!state.text?.[button.dataset.styleFont]);
}

/** Apply a style control click inside `root`; returns whether it was one. */
export function handleStyleControlClick(root, ev) {
  const button = ev.target.closest?.('button');
  if (!button || button.disabled || !root.contains(button)) return false;
  const { dataset } = button;
  if (dataset.arrowEnd) {
    const on = (end) => root.querySelector(`[data-arrow-end="${end}"]`)?.getAttribute('aria-pressed') === 'true';
    const start = dataset.arrowEnd === 'start' ? !on('start') : on('start');
    const end = dataset.arrowEnd === 'end' ? !on('end') : on('end');
    applySelectedStyle('arrowhead', combineArrowheadEnds(start, end));
  } else if (dataset.lineStyle) applySelectedStyle('lineStyle', dataset.lineStyle);
  else if (dataset.width) applySelectedStyle('width', dataset.width);
  else if (button.classList.contains('swatch')) applySelectedStyle('color', dataset.value);
  else if (dataset.styleAlign) setSelectedLabelAlign(dataset.styleAlign);
  else if (dataset.styleFont) setSelectedLabelFont(dataset.styleFont, button.getAttribute('aria-pressed') !== 'true');
  else return false;
  return true;
}

/** The panel only exists while something is styleable; an open context menu's
 * strip follows the same selection. */
export function updateStyleControls() {
  const state = selectionStyleState();
  const panel = document.getElementById('style-panel');
  if (panel) {
    panel.hidden = !state;
    if (state) {
      syncStyleControls(panel, state);
      const linePattern = document.getElementById('style-line-pattern');
      if (linePattern) {
        linePattern.disabled = !state.supportsLine;
        const icon = linePattern.querySelector('.button-icon');
        if (icon) icon.innerHTML = ICON_PATHS[LINE_STYLE_ICONS[state.lineStyle] || 'line-solid'];
      }
    }
  }
  const strip = componentContextMenuEl?.querySelector('.context-style-strip');
  if (strip) {
    strip.hidden = !state;
    if (state) syncStyleControls(strip, state);
  }
}

export function installStyleControls() {
  document.getElementById('style-panel')?.addEventListener('click', (ev) => handleStyleControlClick(ev.currentTarget, ev));
}
