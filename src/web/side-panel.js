/**
 * The side panel: the component and net lists with their filter and renames,
 * the selection detail, collapsible sections, the resizable width, and
 * showing or hiding the panel (a drawer on narrow windows).
 */

import { INTERFACE_PIN_TYPES, componentLabelText, isReferenceMarker, normalizeComponentRefdes, parseLabelRuns, applyMarkup } from '../core/model.js';
import { switchPhase } from '../core/beats.js';
import { resolveColor } from '../core/style.js';
import { GRID } from '../core/grid.js';
import { componentPaletteItems } from './toolbar.js';
import { canvasEl, componentsListEl, netsListEl, detailEl, analysisDialog, panelFilterEl, sidePanelEl, sidePanelToggleEl } from './elements.js';
import { logLine } from './status-bar-ui.js';
import { clearDiagnosticFocus } from './design-check-ui.js';
import { openComponentContextMenu, selectContextTarget } from './context-menu.js';
import { bindInlineEditorKeys, inlineEditSchematicBlock, openReferenceMarkerEditor } from './label-editor.js';
import { plainMarkup } from './beats-ui.js';
import { editor } from './editor-state.js';
import { confirmNamedConnection, namedConnectionConflicts, portNameConflict, reportPortNameConflict } from './net-names.js';
import { bindHoverPreview, commit, isTransientCopyGhostRef, namedGroupNets, rangeValues, render, selectedComp, selectedLabel, setSelection, sortedComps, transientCopyGhostNetIds, visibleNets } from './main.js';

let panelFilter = '';

let lastRevealedRow = '';

function panelFilterMatches(...values) {
  if (!panelFilter) return true;
  return values.some((value) => value && String(value).replace(/[_^{}]/g, '').toLowerCase().includes(panelFilter));
}

function setPanelCount(id, shown, total) {
  const el = document.getElementById(id);
  if (el) el.textContent = shown === total ? String(total) : `${shown}/${total}`;
}

export function componentDisplayName(comp) {
  if (isReferenceMarker(comp)) return comp.refdes;
  // A switch's label is its phase; the panel names the switch itself.
  if (switchPhase(comp)) return componentLabelText(comp.refdes);
  return editor.circuit.labelOf(comp.refdes)?.text || componentLabelText(comp.refdes);
}

/** Render `_{…}`/`^{…}` label markup as sub/superscript DOM text. */
export function appendMarkupText(el, text) {
  for (const run of parseLabelRuns(String(text))) {
    const node = run.sub || run.super ? document.createElement(run.sub ? 'sub' : 'sup') : document.createTextNode(run.text);
    if (run.sub || run.super) node.textContent = run.text;
    el.appendChild(node);
  }
}

/** Keep a newly selected row visible without jumping on unrelated re-renders. */
function revealSelectedRow(row, key) {
  if (key === lastRevealedRow) return;
  lastRevealedRow = key;
  requestAnimationFrame(() => row.isConnected && row.scrollIntoView({ block: 'nearest' }));
}

/** Arrow keys walk a side-panel listbox; Enter and Space activate the row. */
function bindListboxRowKeys(listEl, row) {
  row.addEventListener('keydown', (ev) => {
    const step = ev.key === 'ArrowDown' || ev.key === 'ArrowRight' ? 1
      : ev.key === 'ArrowUp' || ev.key === 'ArrowLeft' ? -1 : 0;
    if (step) {
      const rows = [...listEl.querySelectorAll('[role="option"]')];
      rows[(rows.indexOf(row) + step + rows.length) % rows.length]?.focus();
      ev.preventDefault();
      return;
    }
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    ev.preventDefault();
    row.click();
  });
}

export function renderComponents() {
  componentsListEl.innerHTML = '';
  componentsListEl.setAttribute('role', 'listbox');
  componentsListEl.setAttribute('aria-label', 'Components');
  componentsListEl.setAttribute('aria-multiselectable', 'true');
  const allComps = componentPaletteItems(sortedComps())
    .filter((comp) => !isTransientCopyGhostRef(comp.refdes));
  const comps = allComps.filter((comp) => panelFilterMatches(componentDisplayName(comp), comp.refdes, comp.type));
  setPanelCount('components-count', comps.length, allComps.length);
  if (comps.length === 0) {
    componentsListEl.innerHTML = `<div class="no-items">${allComps.length ? 'No matching components' : 'No components'}</div>`;
    return;
  }
  const primaryRef = editor.selected && editor.multi.has(editor.selected) ? editor.selected : [...editor.multi][0];
  for (const comp of comps) {
    const row = document.createElement('div');
    row.className = 'row' + (editor.multi.has(comp.refdes) ? ' selected' : '');
    row.dataset.ref = comp.refdes;
    row.dataset.refdes = comp.refdes;
    bindHoverPreview(row, () => ({ kind: 'component', refdes: comp.refdes }));
    row.dataset.type = comp.type;
    row.setAttribute('role', 'option');
    row.tabIndex = editor.multi.has(comp.refdes) || (!editor.multi.size && comp.refdes === comps[0]?.refdes) ? 0 : -1;
    row.id = `component-option-${CSS.escape(comp.refdes)}`;
    row.setAttribute('aria-selected', String(editor.multi.has(comp.refdes)));

    const ref = document.createElement('span');
    ref.className = 'ref';
    appendMarkupText(ref, componentDisplayName(comp));
    ref.title = isReferenceMarker(comp)
      ? 'Double-click to edit its label'
      : comp.type === 'block'
        ? 'Double-click to edit block text'
        : 'Double-click to rename';

    const meta = document.createElement('span');
    meta.className = 'meta';
    const analysisTags = [];
    if (comp.analysis?.model === 'triode') analysisTags.push('triode');
    if (comp.analysis?.role) analysisTags.push(comp.analysis.role);
    if (comp.analysis?.resistance === 'infinite' || comp.analysis?.resistance === true) analysisTags.push('R=∞');
    if (comp.analysis?.resistance === 'finite') analysisTags.push('finite R');
    if (comp.analysis?.channelLengthModulation === 'ignore') analysisTags.push('r_o→∞');
    if (comp.analysis?.channelLengthModulation === 'finite') analysisTags.push('finite r_o');
    if (comp.analysis?.gmroLarge === true) analysisTags.push('g_mr_o≫1');
    if (comp.analysis?.gmroLarge === false) analysisTags.push('finite g_mr_o');
    if (comp.analysis?.ignoreBodyEffect === true) analysisTags.push('V_BS=0');
    if (comp.analysis?.ignoreBodyEffect === false) analysisTags.push('body effect');
    if (switchPhase(comp)) analysisTags.unshift(plainMarkup(switchPhase(comp)));
    meta.textContent = `${comp.type}${analysisTags.map((tag) => ` · ${tag}`).join('')}`;

    row.appendChild(ref);
    row.appendChild(meta);

    row.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      selectContextTarget({ kind: 'component', value: comp });
      render();
      openComponentContextMenu({ kind: 'component', value: comp }, ev.clientX, ev.clientY);
    });

    row.addEventListener('click', (ev) => {
      editor.cursor = { x: comp.transform.x, y: comp.transform.y };
      const now = Date.now();
      const prev = editor.lastComponentClick;
      const doubleClick =
        !ev.shiftKey &&
        prev &&
        prev.refdes === comp.refdes &&
        now - prev.at < 500 &&
        Math.abs(ev.clientX - prev.x) <= 6 &&
        Math.abs(ev.clientY - prev.y) <= 6;
      editor.lastComponentClick = { refdes: comp.refdes, x: ev.clientX, y: ev.clientY, at: now };
      if (doubleClick) {
        if (isReferenceMarker(comp)) openReferenceMarkerEditor(comp);
        else if (comp.type === 'block') inlineEditSchematicBlock(comp);
        else startComponentRename(comp, ref);
        return;
      }
      if (ev.shiftKey) {
        const refs = rangeValues(comps, editor.componentRangeAnchor, comp.refdes, (item) => item.refdes);
        const next = ev.ctrlKey || ev.metaKey ? new Set(editor.multi) : new Set();
        for (const refdes of (refs.length ? refs : [comp.refdes])) next.add(refdes);
        setSelection([...next], comp.refdes);
      } else if (ev.ctrlKey || ev.metaKey) {
        const next = new Set(editor.multi);
        if (next.has(comp.refdes)) next.delete(comp.refdes); else next.add(comp.refdes);
        setSelection([...next], next.has(comp.refdes) ? comp.refdes : [...next][0]);
      } else {
        setSelection([comp.refdes]);
      }
      if (!ev.shiftKey) editor.componentRangeAnchor = comp.refdes;
      editor.netRangeAnchor = null;
      render();
    });
    row.addEventListener('dblclick', () => {
      // Native dblclick backup for browsers that deliver it (manual detection
      // in the click handler covers row replacement during the first click).
      if (isReferenceMarker(comp)) openReferenceMarkerEditor(comp);
      else if (comp.type === 'block') inlineEditSchematicBlock(comp);
      else startComponentRename(comp, ref);
    });
    bindListboxRowKeys(componentsListEl, row);

    componentsListEl.appendChild(row);
    if (comp.refdes === primaryRef) revealSelectedRow(row, `component:${primaryRef}`);
  }
}

export function renderNets() {
  netsListEl.innerHTML = '';
  netsListEl.setAttribute('role', 'listbox');
  netsListEl.setAttribute('aria-label', 'Electrical nets');
  netsListEl.setAttribute('aria-multiselectable', 'true');
  const hiddenNetIds = transientCopyGhostNetIds();
  const visibleGroupNets = (net) => namedGroupNets(net).filter((candidate) => !hiddenNetIds.has(candidate.id));
  const allNets = visibleNets();
  const nets = allNets.filter((net) => panelFilterMatches(net.name, net.id));
  setPanelCount('nets-count', nets.length, allNets.length);
  if (nets.length === 0) {
    netsListEl.innerHTML = `<div class="no-items">${allNets.length ? 'No matching nets' : 'No nets'}</div>`;
    return;
  }
  const primaryNet = nets.find((net) => visibleGroupNets(net).some((candidate) => editor.selectedNets.has(candidate.id)));
  for (const net of nets) {
    const groupedNets = visibleGroupNets(net);
    const groupedIds = groupedNets.map((candidate) => candidate.id);
    const groupSelected = groupedIds.some((id) => editor.selectedNets.has(id));
    const row = document.createElement('div');
    row.className = 'row' + (groupSelected ? ' selected' : '');
    row.setAttribute('role', 'option');
    row.tabIndex = groupSelected || (!editor.selectedNets.size && net.id === nets[0]?.id) ? 0 : -1;
    row.id = `net-option-${CSS.escape(net.id)}`;
    row.dataset.netIds = groupedIds.join(' ');
    bindHoverPreview(row, () => ({ kind: 'net', ids: groupedIds }));
    row.setAttribute('aria-selected', String(groupSelected));

    const ref = document.createElement('span');
    ref.className = 'ref';
    const highlight = editor.circuit.netHighlight(net);
    if (highlight) {
      const dot = document.createElement('span');
      dot.className = 'net-highlight-dot';
      dot.style.setProperty('--net-highlight', resolveColor(highlight));
      dot.title = `Highlighted ${highlight}`;
      ref.appendChild(dot);
    }
    appendMarkupText(ref, net.name || net.id);
    ref.title = 'Double-click to rename';

    const meta = document.createElement('span');
    meta.className = 'meta';
    const terminalKeys = new Set(groupedNets.flatMap((grouped) => grouped.terminals.map((terminal) => `${terminal.comp}.${terminal.term}`)));
    const pins = terminalKeys.size;
    const analysisNet = groupedNets.find((grouped) => grouped.analysis?.acGround || grouped.analysis?.role) || net;
    const analysisTag = analysisNet.analysis?.acGround ? ' · AC ground' : analysisNet.analysis?.role ? ` · ${analysisNet.analysis.role}` : '';
    meta.textContent = `${pins} ${pins === 1 ? 'pin' : 'pins'}${analysisTag}`;
    const wireLength = groupedNets.reduce((total, grouped) => total + grouped.length(), 0);
    row.title = `${groupedNets.map((grouped) => grouped.id).join(', ')} · ${pins} ${pins === 1 ? 'terminal' : 'terminals'} · ${wireLength} units of wire${analysisNet.analysis?.acGround ? ' · DC bias / AC ground' : ''}`;

    row.appendChild(ref);
    row.appendChild(meta);

    row.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      selectContextTarget({ kind: 'net', value: net });
      render();
      openComponentContextMenu({ kind: 'net', value: net }, ev.clientX, ev.clientY);
    });

    row.addEventListener('click', (ev) => {
      clearDiagnosticFocus();
      const now = Date.now();
      const prev = editor.lastNetClick;
      // A plain click re-renders the list, replacing this row node before the
      // browser can fire a native `dblclick` on it, so a fast second click at
      // the same position is detected here manually (like labels and wires).
      const doubleClick =
        !ev.shiftKey &&
        prev &&
        prev.netId === net.id &&
        now - prev.at < 500 &&
        Math.abs(ev.clientX - prev.x) <= 6 &&
        Math.abs(ev.clientY - prev.y) <= 6;
      editor.lastNetClick = { netId: net.id, x: ev.clientX, y: ev.clientY, at: now };
      if (doubleClick) {
        startNetRename(net, ref);
        return;
      }
      if (ev.shiftKey) {
        const ids = rangeValues(nets, editor.netRangeAnchor, net.id, (item) => item.id);
        const next = ev.ctrlKey || ev.metaKey ? new Set(editor.selectedNets) : new Set();
        for (const id of (ids.length ? ids : [net.id])) {
          for (const grouped of visibleGroupNets(editor.circuit.nets.get(id))) next.add(grouped.id);
        }
        editor.selectedNets = next;
      } else if (ev.ctrlKey || ev.metaKey) {
        const next = new Set(editor.selectedNets);
        if (groupSelected) for (const id of groupedIds) next.delete(id);
        else for (const id of groupedIds) next.add(id);
        editor.selectedNets = next;
      } else {
        editor.selectedNets = new Set(groupedIds);
      }
      editor.componentRangeAnchor = null;
      if (!ev.shiftKey) editor.netRangeAnchor = net.id;
      const pt = net.points()[Math.floor(net.points().length / 2)];
      if (pt) editor.cursor = { x: pt.x, y: pt.y };
      render();
    });

    row.addEventListener('dblclick', () => {
      // Native dblclick backup for browsers that deliver it (the manual
      // detection above covers the row-replacing re-render case).
      startNetRename(net, ref);
    });
    bindListboxRowKeys(netsListEl, row);

    netsListEl.appendChild(row);
    if (net === primaryNet) revealSelectedRow(row, `net:${net.id}`);
  }
}

/** Open the inline refdes editor for a component row. Invalid or occupied
 * names are rejected before commit, leaving the model and selection untouched. */
/** Ctrl/Cmd+, and Ctrl/Cmd+. toggle sub/superscript markup in a plain name field. */
function bindMarkupShortcuts(input) {
  input.addEventListener('keydown', (ev) => {
    if (!(ev.ctrlKey || ev.metaKey) || (ev.key !== ',' && ev.key !== '.')) return;
    ev.preventDefault();
    const res = applyMarkup(input.value, input.selectionStart, input.selectionEnd, ev.key === ',' ? '_' : '^');
    if (!res) return;
    input.value = res.text;
    input.setSelectionRange(res.selStart, res.selEnd);
  });
}

export function startComponentRename(comp, ref) {
  if (!comp || editor.inlineInput) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'rename-input';
  const ordinaryInstance = !isReferenceMarker(comp);
  // A switch's label is its phase; renaming here renames the switch.
  const currentLabel = ordinaryInstance && !switchPhase(comp) ? editor.circuit.labelOf(comp.refdes) : null;
  input.value = currentLabel?.text || (ordinaryInstance ? componentLabelText(comp.refdes) : comp.refdes);
  input.placeholder = input.value;
  input.spellcheck = false;
  bindMarkupShortcuts(input);
  ref.replaceWith(input);
  editor.inlineInput = input;
  input.focus();
  input.select();
  let closed = false;
  let prompting = false;
  const done = async (applyText) => {
    if (closed || prompting) return;
    const value = input.value.trim();
    const next = normalizeComponentRefdes(value);
    if (applyText && next && next !== comp.refdes && INTERFACE_PIN_TYPES.has(comp.type)) {
      const conflicts = namedConnectionConflicts(value, { ownerRefdes: comp.refdes });
      const portConflict = portNameConflict(conflicts, comp.refdes);
      if (portConflict) {
        reportPortNameConflict(portConflict, value);
        input.focus();
        input.select();
        return;
      }
      if (conflicts.length) {
        prompting = true;
        const connect = await confirmNamedConnection(value, conflicts);
        prompting = false;
        if (!connect) {
          input.focus();
          input.select();
          return;
        }
      }
    }
    closed = true;
    editor.inlineInput = null;
    input.replaceWith(ref);
    if (applyText && next && next !== comp.refdes &&
        /^[A-Za-z][A-Za-z0-9_]*$/.test(next) && !editor.circuit.components.has(next)) {
      const previous = comp.refdes;
      const displayLabel = value;
      commit(() => editor.circuit.renameComponent(previous, next, { displayLabel }));
      if (editor.componentRangeAnchor === previous) editor.componentRangeAnchor = next;
      if (editor.selected === previous) editor.selected = next;
      if (editor.multi.has(previous)) {
        editor.multi.delete(previous);
        editor.multi.add(next);
      }
    } else if (applyText && next && next !== comp.refdes) {
      logLine(!/^[A-Za-z][A-Za-z0-9_]*$/.test(next)
        ? `Invalid component name "${value}".`
        : `Component name "${next}" is already in use.`, 'error');
    }
    render();
  };
  bindInlineEditorKeys(input, done);
}

/** Open the inline rename <input> for a net's row (Enter/blur commits, Esc
 *  cancels). The net name is replaced in place so the row is not re-rendered
 *  mid-edit. */
export function startNetRename(net, ref) {
  editor.selectedNets = new Set([net.id]);
  editor.netRangeAnchor = net.id;
  editor.componentRangeAnchor = null;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'rename-input';
  input.value = net.name || '';
  input.placeholder = net.id;
  input.spellcheck = false;
  bindMarkupShortcuts(input);
  ref.replaceWith(input);
  input.focus();
  input.select();
  let closed = false;
  let prompting = false;
  const done = async (applyText) => {
    if (closed || prompting) return;
    const v = input.value.trim();
    if (applyText && v && v !== net.name) {
      const conflicts = namedConnectionConflicts(v, { netId: net.id });
      if (conflicts.length) {
        prompting = true;
        const connect = await confirmNamedConnection(v, conflicts);
        prompting = false;
        if (!connect) {
          input.focus();
          input.select();
          return;
        }
      }
    }
    closed = true;
    input.replaceWith(ref);
    if (applyText && v && v !== net.name) {
      // A sole port names its net, so this rename can rename that port too.
      // Carry the selection across with it, exactly like a component rename.
      const ports = net.terminals
        .map(({ comp }) => editor.circuit.components.get(comp))
        .filter((component) => component && INTERFACE_PIN_TYPES.has(component.type));
      const previous = ports.length === 1 ? ports[0].refdes : null;
      commit(() => {
        editor.circuit.renameNet(net.id, v);
        // A side-panel rename is an intentional editor action: promote any
        // compatibility child label synthesized by the model to a real local
        // reference label so the renamed rail no longer groups with VSS/VDD.
        editor.circuit._markReferenceLabelsLocal?.(net);
      });
      const renamed = previous && ports[0].refdes !== previous ? ports[0].refdes : null;
      if (renamed) {
        if (editor.componentRangeAnchor === previous) editor.componentRangeAnchor = renamed;
        if (editor.selected === previous) editor.selected = renamed;
        if (editor.multi.has(previous)) {
          editor.multi.delete(previous);
          editor.multi.add(renamed);
        }
      }
    }
    render();
  };
  bindInlineEditorKeys(input, done, { multiline: false });
}

export function renderDetail() {
  detailEl.innerHTML = '';
  const label = selectedLabel();
  if (label) {
    const a = label.anchorWorld();
    const role = label.isNetLabel?.() ? 'Net label' : label.owner ? 'Instance label' : 'Annotation';
    const rows = [['Role', role], ['Align', label.align], ['Anchor', `${a.x}, ${a.y}`]];
    if (label.owner) rows.push(['Owner', label.owner]);
    if (label.netId) rows.push(['Net', editor.circuit.nets.get(label.netId)?.name || label.netId]);
    detailEl.appendChild(detailHeader(label.text || '(empty)', label.kind === 'label' ? '' : label.kind));
    const list = document.createElement('dl');
    list.className = 'detail-props';
    for (const [key, value] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = key;
      const dd = document.createElement('dd');
      dd.textContent = value;
      list.append(dt, dd);
    }
    detailEl.appendChild(list);
    return;
  }

  const comp = selectedComp();
  if (!comp) {
    detailEl.innerHTML = '<div class="no-items">Select a component or label to inspect it</div>';
    return;
  }
  if (isTransientCopyGhostRef(comp.refdes)) {
    detailEl.innerHTML = '<div class="no-items">Copy ghost — commit it to inspect its terminals</div>';
    return;
  }

  detailEl.appendChild(detailHeader(componentDisplayName(comp), comp.value ? `${comp.type} · ${switchPhase(comp) ? `phase ${plainMarkup(comp.value)}` : comp.value}` : comp.type));
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Pin</th><th>Net</th><th>Position</th></tr>';
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const t of comp.worldTerminals()) {
    const tr = document.createElement('tr');
    const net = editor.circuit.netOfTerminal(`${comp.refdes}.${t.name}`);
    const nameTd = document.createElement('td');
    nameTd.textContent = t.name;
    nameTd.className = 'pin-name';
    const netTd = document.createElement('td');
    if (net) {
      appendMarkupText(netTd, net.name || net.id);
      netTd.className = 'net-label';
      netTd.title = net.id;
    } else {
      netTd.textContent = 'unconnected';
      netTd.className = 'off-grid';
    }
    const posTd = document.createElement('td');
    posTd.textContent = `${t.x}, ${t.y}`;
    if (t.x % GRID !== 0 || t.y % GRID !== 0) {
      posTd.className = 'off-grid';
      posTd.title = 'Off the placement grid';
    }
    tr.append(nameTd, netTd, posTd);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  detailEl.appendChild(table);
}

function detailHeader(name, kind) {
  const header = document.createElement('div');
  header.className = 'detail-header';
  const title = document.createElement('span');
  title.className = 'detail-name';
  appendMarkupText(title, name);
  header.appendChild(title);
  if (kind) {
    const meta = document.createElement('span');
    meta.className = 'detail-kind';
    meta.textContent = kind;
    header.appendChild(meta);
  }
  return header;
}

export const PANEL_COLLAPSED_KEY = 'mosfeteer:panel-collapsed';

const PANEL_WIDTH_KEY = 'mosfeteer:panel-width';

export const collapsedPanels = new Set();

function panelSection(name) {
  return document.querySelector(`.side-panel [data-panel="${CSS.escape(name)}"]`);
}

export function setPanelCollapsed(name, collapsed) {
  const section = panelSection(name);
  if (!section) return;
  section.classList.toggle('collapsed', collapsed);
  section.querySelector('.panel-toggle')?.setAttribute('aria-expanded', String(!collapsed));
  if (collapsed) collapsedPanels.add(name); else collapsedPanels.delete(name);
  try { localStorage.setItem(PANEL_COLLAPSED_KEY, JSON.stringify([...collapsedPanels])); } catch { /* storage unavailable */ }
}

/** Drag/keyboard width control on a panel's left edge, persisted per panel. */
function bindPanelResizer(panel, handle, storageKey, cssVar, minWidth) {
  if (!panel || !handle) return;
  const setWidth = (width, persist = true) => {
    if (width == null) {
      panel.style.removeProperty(cssVar);
      try { localStorage.removeItem(storageKey); } catch { /* storage unavailable */ }
      return;
    }
    const max = Math.max(minWidth, Math.round(window.innerWidth * 0.6));
    const next = Math.round(Math.min(max, Math.max(minWidth, width)));
    panel.style.setProperty(cssVar, `${next}px`);
    handle.setAttribute('aria-valuenow', String(next));
    if (persist) {
      try { localStorage.setItem(storageKey, String(next)); } catch { /* storage unavailable */ }
    }
  };
  try {
    const saved = Number(localStorage.getItem(storageKey));
    if (saved) setWidth(saved, false);
  } catch { /* storage unavailable */ }
  handle.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    handle.setPointerCapture(ev.pointerId);
    const startX = ev.clientX;
    const startWidth = panel.getBoundingClientRect().width;
    panel.classList.add('resizing');
    const move = (moveEv) => setWidth(startWidth + startX - moveEv.clientX, false);
    const end = () => {
      panel.classList.remove('resizing');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      setWidth(panel.getBoundingClientRect().width);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  });
  handle.addEventListener('dblclick', () => setWidth(null));
  handle.addEventListener('keydown', (ev) => {
    const step = ev.shiftKey ? 64 : 16;
    const width = panel.getBoundingClientRect().width;
    if (ev.key === 'ArrowLeft') setWidth(width + step);
    else if (ev.key === 'ArrowRight') setWidth(width - step);
    else return;
    ev.preventDefault();
  });
}

// One toggle (button or P) at every size. A wide window docks the panel and the
// toggle collapses it, remembered per browser. A narrow window (see style.css)
// slides it over the canvas as a drawer that starts closed and closes on a
// canvas press or Escape.
const narrowPanelQuery = window.matchMedia('(max-width: 600px)');

const SIDE_PANEL_COLLAPSED_KEY = 'mosfeteer.sidePanelCollapsed';

export function sidePanelVisible() {
  return narrowPanelQuery.matches
    ? document.body.classList.contains('side-panel-open')
    : !document.body.classList.contains('side-panel-collapsed');
}

function syncSidePanelToggle() {
  const visible = sidePanelVisible();
  sidePanelToggleEl?.setAttribute('aria-expanded', String(visible));
  sidePanelToggleEl?.setAttribute('aria-pressed', String(visible));
  if (sidePanelToggleEl) sidePanelToggleEl.title = `${visible ? 'Hide' : 'Show'} the components, nets, and selection panel (Shift+P)`;
  if (sidePanelEl) sidePanelEl.inert = !visible;
}

export function setSidePanelVisible(visible) {
  if (narrowPanelQuery.matches) {
    document.body.classList.toggle('side-panel-open', visible);
  } else {
    document.body.classList.toggle('side-panel-collapsed', !visible);
    try { localStorage.setItem(SIDE_PANEL_COLLAPSED_KEY, visible ? '0' : '1'); } catch {}
  }
  syncSidePanelToggle();
  // The canvas changes size when the docked panel collapses or returns.
  requestAnimationFrame(() => render());
}

export function toggleSidePanel() {
  setSidePanelVisible(!sidePanelVisible());
}

export function installSidePanel() {
  try {
    for (const name of JSON.parse(localStorage.getItem(PANEL_COLLAPSED_KEY) || '[]')) collapsedPanels.add(name);
  } catch { /* storage unavailable */ }
  for (const toggle of document.querySelectorAll('.side-panel .panel-toggle')) {
    const section = toggle.closest('.panel-group');
    if (!section.dataset.panel) section.dataset.panel = toggle.getAttribute('aria-controls');
    const name = section.dataset.panel;
    setPanelCollapsed(name, collapsedPanels.has(name));
    toggle.addEventListener('click', () => setPanelCollapsed(name, !section.classList.contains('collapsed')));
  }

  panelFilterEl?.addEventListener('input', () => {
    panelFilter = panelFilterEl.value.trim().replace(/[_^{}]/g, '').toLowerCase();
    editor.panelStateKey = '';
    render();
  });

  panelFilterEl?.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    ev.stopPropagation();
    if (panelFilterEl.value) {
      panelFilterEl.value = '';
      panelFilterEl.dispatchEvent(new Event('input'));
    } else {
      canvasEl.focus();
    }
  });

  bindPanelResizer(document.getElementById('side-panel'), document.getElementById('side-panel-resizer'), PANEL_WIDTH_KEY, '--side-panel-width', 180);

  bindPanelResizer(analysisDialog, document.getElementById('analysis-dock-resizer'), 'mosfeteer:analysis-width', '--analysis-dock-width', 300);

  try {
    document.body.classList.toggle('side-panel-collapsed', localStorage.getItem(SIDE_PANEL_COLLAPSED_KEY) === '1');
  } catch {}

  narrowPanelQuery.addEventListener('change', () => {
    document.body.classList.remove('side-panel-open');
    syncSidePanelToggle();
  });

  syncSidePanelToggle();

  sidePanelToggleEl?.addEventListener('click', (ev) => {
    toggleSidePanel();
    if (ev.detail > 0) canvasEl.focus({ preventScroll: true });
  });

  // Focusing into the panel (Ctrl+F filter, Tab) reveals it; a canvas press or
  // Escape puts the drawer away again.
  sidePanelEl?.addEventListener('focusin', () => {
    if (!sidePanelVisible()) setSidePanelVisible(true);
  });

  document.querySelector('.canvas-pane')?.addEventListener('pointerdown', (ev) => {
    if (narrowPanelQuery.matches && document.body.classList.contains('side-panel-open') && ev.target !== sidePanelToggleEl && !sidePanelToggleEl?.contains(ev.target)) {
      setSidePanelVisible(false);
    }
  }, true);

  window.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || !narrowPanelQuery.matches || !document.body.classList.contains('side-panel-open')) return;
    if (!sidePanelEl?.contains(document.activeElement)) return;
    setSidePanelVisible(false);
    canvasEl.focus({ preventScroll: true });
  });
}
