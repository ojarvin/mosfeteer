/**
 * The right-click context menu on parts, wires, labels, and nets: its
 * selection, style, switch, signal-flow, and small-signal submenus, and the
 * panel rows' renames it offers.
 */

import { isReferenceMarker } from '../core/model.js';
import { supplyBarRow } from '../core/supply-bars.js';
import { switchGroupKey, switchPhase, switchPhases, switchState, switchesOf } from '../core/beats.js';
import { canvasEl, componentContextMenuEl, componentsListEl, netsListEl, panelFilterEl } from './elements.js';
import { logLine } from './status-bar-ui.js';
import { clientToWorld } from './canvas-view.js';
import { SMALL_SIGNAL_TRANSISTOR_TYPES, SMALL_SIGNAL_RESISTOR_TYPES, SMALL_SIGNAL_PORT_TYPES, analysisComponentTargets, analysisNetTargets, applyComponentAnalysis, applyNetAnalysis } from './analysis-ui.js';
import { editor } from './editor-state.js';
import { activateCopy, activateMove, annotationGeometryAt, appendBeatContextItems, appendMarkupText, commit, componentDisplayName, copyAsImage, deleteSelection, handleStyleControlClick, inlineEditLabel, namedGroupNets, pickAt, pickLabel, pickWire, plainMarkup, render, restackSelected, selectedComps, selectedTransform, selectionStyleState, setLabelSelection, setPanelCollapsed, setSelection, startComponentRename, startNetRename, styleDefaults, supplyBarGroup, supplyBarHit, syncSelectedWire, syncStyleControls, wireStyleValue } from './main.js';

function contextStyleValue(target, field) {
  if (target?.kind === 'wire') {
    const { net, branch, segment } = target.value;
    return wireStyleValue(net, `${branch}:${segment}`, field);
  }
  return target?.value?.style?.[field] || styleDefaults(field);
}

function contextTargetType(target) {
  return ['component', 'net'].includes(target.kind)
    ? target.kind
    : target.kind === 'wire' ? 'wire' : 'label';
}

function contextMatches(target, candidate, criterion) {
  if (criterion === 'type' && contextTargetType(target) !== contextTargetType(candidate)) return false;
  if (criterion === 'type') {
    if (target.kind === 'component') return candidate.value.type === target.value.type;
    if (target.kind === 'net') return candidate.value.name === target.value.name;
    if (target.kind === 'wire') return !!candidate.value.net.routingMode === !!target.value.net.routingMode;
    return candidate.value.kind === target.value.kind &&
      !!candidate.value.owner === !!target.value.owner &&
      !!candidate.value.netId === !!target.value.netId;
  }
  if (criterion === 'color' || criterion === 'lineStyle') {
    const field = criterion === 'color' ? 'color' : 'lineStyle';
    return contextStyleValue(candidate, field) === contextStyleValue(target, field);
  }
  return false;
}

let componentContextTarget = null;
let componentContextSubmenu = null;

export function closeComponentContextMenu() {
  // A menu that is a pending question (e.g. the solder net-name choice)
  // treats any close without a pick as a cancellation.
  const dismiss = editor.contextMenuDismiss;
  editor.contextMenuDismiss = null;
  if (dismiss) dismiss();
  componentContextTarget = null;
  componentContextSubmenu = null;
  if (componentContextMenuEl) {
    componentContextMenuEl.hidden = true;
    componentContextMenuEl.classList.remove('analysis-attribute-menu', 'opens-left');
    componentContextMenuEl.replaceChildren();
  }
}

function contextCandidates(target, criterion) {
  if (criterion === 'color' || criterion === 'lineStyle') {
    return [
      ...[...editor.circuit.components.values()].map((value) => ({ kind: 'component', value })),
      ...[...editor.circuit.labels.values()]
        .filter((value) => value.selectable !== false)
        .map((value) => ({ kind: 'label', value })),
      ...wireCandidates(),
    ];
  }
  if (target.kind === 'component') {
    return [...editor.circuit.components.values()].map((value) => ({ kind: 'component', value }));
  }
  if (target.kind === 'label') {
    return [...editor.circuit.labels.values()]
      .filter((value) => value.selectable !== false)
      .map((value) => ({ kind: 'label', value }));
  }
  if (target.kind === 'net') {
    return [...editor.circuit.nets.values()].map((value) => ({ kind: 'net', value }));
  }
  return wireCandidates();
}

/** Every drawn wire segment as a context-menu candidate. */
function wireCandidates() {
  const candidates = [];
  for (const net of editor.circuit.nets.values()) {
    const paths = net.paths();
    for (let branch = 0; branch < paths.length; branch++) {
      for (let segment = 1; segment < paths[branch].length; segment++) {
        candidates.push({ kind: 'wire', value: { net, branch, segment } });
      }
    }
  }
  return candidates;
}

function selectSameTarget(criterion) {
  const target = componentContextTarget;
  if (!target) return;
  const candidates = contextCandidates(target, criterion).filter((candidate) => contextMatches(target, candidate, criterion));
  const refs = candidates.filter(({ kind }) => kind === 'component').map(({ value }) => value.refdes);
  const labels = candidates.filter(({ kind }) => kind === 'label').map(({ value }) => value.id);
  const nets = candidates.filter(({ kind }) => kind === 'net').map(({ value }) => value.id);
  const wires = candidates.filter(({ kind }) => kind === 'wire')
    .map(({ value }) => `${value.net.id}:${value.branch}:${value.segment}`);
  setSelection(refs, target.kind === 'component' ? target.value.refdes : refs[0], true);
  setLabelSelection(labels, target.kind === 'label' ? target.value.id : labels[0], true);
  if (target.kind === 'net') {
    editor.selectedNets = new Set(nets);
    editor.selectedWire = null;
  }
  editor.selectedWires = new Set(wires);
  syncSelectedWire();
  closeComponentContextMenu();
  render();
}

function contextNet(target) {
  return target?.kind === 'wire' ? target.value.net : target?.kind === 'net' ? target.value : null;
}

function selectContextNet(target, { namedGroup = false, segment = false } = {}) {
  const net = contextNet(target);
  if (!net) return;
  const candidates = namedGroup && net.name
    ? [...editor.circuit.nets.values()].filter((candidate) => candidate.name === net.name)
    : namedGroupNets(net);
  setSelection([], null, true);
  setLabelSelection([], null, true);
  editor.selectedNets = new Set(candidates.flatMap((candidate) => namedGroupNets(candidate).map((item) => item.id)));
  editor.selectedWire = null;
  editor.selectedWires.clear();
  if (segment && target.kind === 'wire') {
    const { branch, segment: segmentIndex } = target.value;
    const key = `${net.id}:${branch}:${segmentIndex}`;
    editor.selectedWires.add(key);
    editor.selectedWire = { netId: net.id, branch, segment: segmentIndex };
  }
  syncSelectedWire();
  closeComponentContextMenu();
  render();
}

export function appendContextItem(parent, label, action, { disabled = false, active = false, mixed = false, shortcut = '', danger = false } = {}) {
  const item = document.createElement('button');
  item.type = 'button';
  item.textContent = label;
  if (danger) item.classList.add('context-item-danger');
  if (shortcut) {
    const hint = document.createElement('kbd');
    hint.className = 'context-item-shortcut';
    hint.textContent = shortcut;
    item.appendChild(hint);
  }
  item.setAttribute('role', active || mixed ? 'menuitemradio' : 'menuitem');
  if (active || mixed) {
    item.classList.add(active ? 'context-item-active' : 'context-item-mixed');
    item.setAttribute('aria-checked', mixed ? 'mixed' : 'true');
    const state = document.createElement('span');
    state.className = 'context-item-state';
    state.textContent = active ? '✓' : '•';
    state.setAttribute('aria-hidden', 'true');
    item.appendChild(state);
  }
  item.disabled = disabled;
  item.addEventListener('click', () => {
    if (item.disabled) return;
    action();
    closeComponentContextMenu();
    render();
  });
  parent.appendChild(item);
  return item;
}

function analysisChoiceState(targets, read, expected) {
  const values = targets.map(read);
  const matches = values.filter((value) => value === expected).length;
  return {
    active: values.length > 0 && matches === values.length,
    mixed: matches > 0 && matches < values.length,
  };
}

/** Add one keyboard-accessible nested menu. The same helper is used for
 * selection, net roles, and device attributes so canvas and side-panel menus
 * have identical hierarchy and interaction semantics. */
function appendContextSubmenu(parent, label, build) {
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.textContent = label;
  trigger.setAttribute('aria-haspopup', 'true');
  trigger.setAttribute('aria-expanded', 'false');
  const arrow = document.createElement('span');
  arrow.textContent = '›';
  arrow.setAttribute('aria-hidden', 'true');
  trigger.appendChild(arrow);
  const submenu = document.createElement('div');
  submenu.className = 'context-submenu';
  submenu.setAttribute('role', 'menu');
  submenu.setAttribute('aria-label', label);
  build(submenu);
  const closeSiblings = () => {
    for (const sibling of parent.querySelectorAll(':scope > .context-submenu.open')) sibling.classList.remove('open');
    for (const siblingTrigger of parent.querySelectorAll(':scope > button[aria-expanded="true"]')) {
      siblingTrigger.setAttribute('aria-expanded', 'false');
      siblingTrigger.classList.remove('context-item-open');
    }
  };
  const open = () => {
    closeSiblings();
    submenu.classList.add('open');
    // Open level with the trigger row, then shift up only as far as needed to stay on screen.
    submenu.style.top = `${trigger.offsetTop - 5}px`;
    const overflow = submenu.getBoundingClientRect().bottom - (window.innerHeight - 8);
    if (overflow > 0) submenu.style.top = `${trigger.offsetTop - 5 - overflow}px`;
    componentContextSubmenu = submenu;
    trigger.setAttribute('aria-expanded', 'true');
    trigger.classList.add('context-item-open');
  };
  trigger.addEventListener('mouseenter', () => {
    trigger.focus({ preventScroll: true });
    open();
  });
  trigger.addEventListener('focus', open);
  trigger.addEventListener('click', open);
  trigger.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowLeft' || ev.key === 'Escape') {
      ev.preventDefault();
      submenu.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.classList.remove('context-item-open');
      trigger.focus();
      return;
    }
    if (ev.key === 'ArrowRight' || ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      open();
      submenu.querySelector('button:not(:disabled)')?.focus();
    }
  });
  parent.append(trigger, submenu);
  return submenu;
}

function appendContextSelectionMenu(menu, target) {
  appendContextSubmenu(menu, 'Select', (submenu) => {
    if (target.kind === 'component') {
      appendContextItem(submenu, 'Select this component', () => {
        setSelection([target.value.refdes]);
        setLabelSelection([], null, true);
      });
    } else if (target.kind === 'net' || target.kind === 'wire') {
      appendContextItem(submenu, 'Select this net', () => selectContextNet(target));
      if (target.kind === 'wire') appendContextItem(submenu, 'Select wire segment', () => selectContextNet(target, { segment: true }));
      const net = contextNet(target);
      if (target.kind === 'wire') {
        appendContextItem(submenu, 'Select same named nets', () => selectContextNet(target, { namedGroup: true }), { disabled: !net?.name });
      }
    }
    const phase = target.kind === 'component' ? switchPhase(target.value) : '';
    if (phase) {
      appendContextItem(submenu, 'Same switch phase', () => {
        setSelection(switchesOf(editor.circuit, switchGroupKey(target.value)).map((c) => c.refdes));
        setLabelSelection([], null, true);
      });
    }
    const typeLabel = target.kind === 'component' ? 'Same component type'
      : target.kind === 'wire' ? 'Same wire type'
        : target.kind === 'net' ? 'Same net name' : 'Same label type';
    const criteria = target.kind === 'net'
      ? [['type', typeLabel]]
      : [['type', typeLabel], ['color', 'Same color'], ['lineStyle', 'Same line style']];
    for (const [criterion, label] of criteria) {
      if (target.kind === 'net' && !target.value.name) continue;
      appendContextItem(submenu, label, () => selectSameTarget(criterion));
    }
  });
}

/** Put the selected switches on a phase: one already in the drawing, none
 * (each switch its own), or a new one typed into the label. */
function appendSwitchPhaseMenu(menu, target) {
  if (target.kind !== 'component' || !switchState(target.value)) return;
  const switches = selectedComps().filter((c) => switchState(c));
  const scope = switches.length ? switches : [target.value];
  const all = (test) => scope.every(test);
  const setPhase = (source) => {
    commit(() => { for (const c of scope) editor.circuit.setValue(c.refdes, source); });
    logLine(`${scope.map((c) => c.refdes).join(', ')} ${source ? `on phase ${plainMarkup(source)}` : 'on no phase'}`);
  };
  appendContextSubmenu(menu, 'Phase', (submenu) => {
    for (const { key, source } of switchPhases(editor.circuit)) {
      appendContextItem(submenu, plainMarkup(source), () => setPhase(source), { active: all((c) => switchGroupKey(c) === key) });
    }
    appendContextItem(submenu, 'None', () => setPhase(''), { active: all((c) => !switchPhase(c)) });
    appendContextItem(submenu, 'New phase…', () => setTimeout(() => {
      const label = editor.circuit.labelOf(target.value.refdes);
      if (label) inlineEditLabel(label);
    }, 0), { shortcut: 'dbl-click label' });
  });
}

function appendSignalFlowPolarityMenu(menu, target) {
  const component = target.kind === 'component' ? target.value : null;
  const inputs = component?.terminalDefs?.filter((terminal) => terminal.signalRole === 'input') || [];
  if (!inputs.length) return;
  appendContextSubmenu(menu, 'Input polarity', (submenu) => {
    for (const terminal of inputs) {
      const routed = !!editor.circuit.netOfTerminal({ comp: component.refdes, term: terminal.name });
      const negative = component.negativeInputs?.has(terminal.name) || false;
      const label = routed
        ? `${terminal.name} input: ${negative ? 'negative' : 'positive'}`
        : `${terminal.name} input (not routed)`;
      appendContextItem(submenu, label, () => {
        commit(() => editor.circuit.setSignalInputNegative(component.refdes, terminal.name, !negative));
      }, { disabled: !routed, active: negative });
    }
  });
}

function appendContextSmallSignalMenu(menu, target) {
  const component = target.kind === 'component' ? target.value : null;
  const net = contextNet(target);
  if (target.kind !== 'component' && !net) return;
  if (net) {
    appendContextSubmenu(menu, 'Small-signal attributes', (submenu) => {
      const targets = analysisNetTargets(net);
      appendContextItem(submenu, 'DC bias / AC ground', () => applyNetAnalysis(net, { role: 'dc-bias', acGround: true }), analysisChoiceState(targets, (candidate) => candidate.analysis?.role === 'dc-bias' || candidate.analysis?.acGround, true));
      appendContextItem(submenu, 'Input node', () => applyNetAnalysis(net, { role: 'input', acGround: false }), analysisChoiceState(targets, (candidate) => candidate.analysis?.role, 'input'));
      appendContextItem(submenu, 'Output node', () => applyNetAnalysis(net, { role: 'output', acGround: false }), analysisChoiceState(targets, (candidate) => candidate.analysis?.role, 'output'));
      appendContextItem(submenu, 'Clear net role', () => applyNetAnalysis(net, { role: null, acGround: false }), {
        disabled: !targets.some((candidate) => candidate.analysis?.role || candidate.analysis?.acGround),
      });
    });
    return;
  }
  const transistor = SMALL_SIGNAL_TRANSISTOR_TYPES.has(component.type);
  const resistor = SMALL_SIGNAL_RESISTOR_TYPES.has(component.type);
  const port = SMALL_SIGNAL_PORT_TYPES.has(component.type);
  if (!transistor && !resistor && !port) return;
  appendContextSubmenu(menu, 'Small-signal attributes', (submenu) => {
    if (transistor) {
      const transistorTargets = analysisComponentTargets(component, (candidate) => SMALL_SIGNAL_TRANSISTOR_TYPES.has(candidate.type));
      appendContextSubmenu(submenu, 'Device model', (modelMenu) => {
        appendContextItem(modelMenu, 'Triode device (r_ds resistor)', () => applyComponentAnalysis(component, { model: 'triode' }, (candidate) => SMALL_SIGNAL_TRANSISTOR_TYPES.has(candidate.type)), analysisChoiceState(transistorTargets, (candidate) => candidate.analysis?.model, 'triode'));
        appendContextItem(modelMenu, 'Clear device model', () => applyComponentAnalysis(component, { model: null }, (candidate) => SMALL_SIGNAL_TRANSISTOR_TYPES.has(candidate.type)), {
          disabled: !transistorTargets.some((candidate) => candidate.analysis?.model),
        });
      });
      appendContextSubmenu(submenu, 'Output resistance', (roMenu) => {
        appendContextItem(roMenu, 'Ignore channel-length modulation (r_o → ∞)', () => applyComponentAnalysis(component, { channelLengthModulation: 'ignore' }, (candidate) => SMALL_SIGNAL_TRANSISTOR_TYPES.has(candidate.type)), analysisChoiceState(transistorTargets, (candidate) => candidate.analysis?.channelLengthModulation, 'ignore'));
        appendContextItem(roMenu, 'Retain finite r_o', () => applyComponentAnalysis(component, { channelLengthModulation: 'finite' }, (candidate) => SMALL_SIGNAL_TRANSISTOR_TYPES.has(candidate.type)), analysisChoiceState(transistorTargets, (candidate) => candidate.analysis?.channelLengthModulation, 'finite'));
        appendContextItem(roMenu, 'Clear r_o override', () => applyComponentAnalysis(component, { channelLengthModulation: null }, (candidate) => SMALL_SIGNAL_TRANSISTOR_TYPES.has(candidate.type)), {
          disabled: !transistorTargets.some((candidate) => candidate.analysis?.channelLengthModulation),
        });
      });
      appendContextSubmenu(submenu, 'Intrinsic gain', (gmroMenu) => {
        appendContextItem(gmroMenu, 'Assume g_m r_o ≫ 1', () => applyComponentAnalysis(component, { gmroLarge: true }, (candidate) => SMALL_SIGNAL_TRANSISTOR_TYPES.has(candidate.type)), analysisChoiceState(transistorTargets, (candidate) => candidate.analysis?.gmroLarge, true));
        appendContextItem(gmroMenu, 'Retain finite g_m r_o', () => applyComponentAnalysis(component, { gmroLarge: false }, (candidate) => SMALL_SIGNAL_TRANSISTOR_TYPES.has(candidate.type)), analysisChoiceState(transistorTargets, (candidate) => candidate.analysis?.gmroLarge, false));
        appendContextItem(gmroMenu, 'Clear g_m r_o override', () => applyComponentAnalysis(component, { gmroLarge: null }, (candidate) => SMALL_SIGNAL_TRANSISTOR_TYPES.has(candidate.type)), {
          disabled: !transistorTargets.some((candidate) => candidate.analysis?.gmroLarge !== null && candidate.analysis?.gmroLarge !== undefined),
        });
      });
      appendContextSubmenu(submenu, 'Body effect', (bodyMenu) => {
        appendContextItem(bodyMenu, 'Ignore body effect (V_BS = 0)', () => applyComponentAnalysis(component, { ignoreBodyEffect: true }, (candidate) => SMALL_SIGNAL_TRANSISTOR_TYPES.has(candidate.type)), analysisChoiceState(transistorTargets, (candidate) => candidate.analysis?.ignoreBodyEffect, true));
        appendContextItem(bodyMenu, 'Retain body effect', () => applyComponentAnalysis(component, { ignoreBodyEffect: false }, (candidate) => SMALL_SIGNAL_TRANSISTOR_TYPES.has(candidate.type)), analysisChoiceState(transistorTargets, (candidate) => candidate.analysis?.ignoreBodyEffect, false));
        appendContextItem(bodyMenu, 'Clear body-effect override', () => applyComponentAnalysis(component, { ignoreBodyEffect: null }, (candidate) => SMALL_SIGNAL_TRANSISTOR_TYPES.has(candidate.type)), {
          disabled: !transistorTargets.some((candidate) => candidate.analysis?.ignoreBodyEffect !== null && candidate.analysis?.ignoreBodyEffect !== undefined),
        });
      });
      // The device's own capacitances, per device: the analysis form carries
      // the same choice for the whole circuit.
      appendContextSubmenu(submenu, 'Device capacitances', (capMenu) => {
        appendContextItem(capMenu, 'Include C_gs and C_gd', () => applyComponentAnalysis(component, { parasitics: 'include' }, (candidate) => SMALL_SIGNAL_TRANSISTOR_TYPES.has(candidate.type)), analysisChoiceState(transistorTargets, (candidate) => candidate.analysis?.parasitics, 'include'));
        appendContextItem(capMenu, 'Omit device capacitances', () => applyComponentAnalysis(component, { parasitics: 'omit' }, (candidate) => SMALL_SIGNAL_TRANSISTOR_TYPES.has(candidate.type)), analysisChoiceState(transistorTargets, (candidate) => candidate.analysis?.parasitics, 'omit'));
        appendContextItem(capMenu, 'Follow the analysis form', () => applyComponentAnalysis(component, { parasitics: null }, (candidate) => SMALL_SIGNAL_TRANSISTOR_TYPES.has(candidate.type)), {
          disabled: !transistorTargets.some((candidate) => candidate.analysis?.parasitics),
        });
      });
    }
    if (resistor) {
      const resistorTargets = analysisComponentTargets(component, (candidate) => SMALL_SIGNAL_RESISTOR_TYPES.has(candidate.type));
      appendContextSubmenu(submenu, 'Resistance', (resistanceMenu) => {
        appendContextItem(resistanceMenu, 'Treat as R = ∞', () => applyComponentAnalysis(component, { resistance: 'infinite' }, (candidate) => SMALL_SIGNAL_RESISTOR_TYPES.has(candidate.type)), analysisChoiceState(resistorTargets, (candidate) => candidate.analysis?.resistance, 'infinite'));
        appendContextItem(resistanceMenu, 'Retain finite R', () => applyComponentAnalysis(component, { resistance: 'finite' }, (candidate) => SMALL_SIGNAL_RESISTOR_TYPES.has(candidate.type)), analysisChoiceState(resistorTargets, (candidate) => candidate.analysis?.resistance, 'finite'));
        appendContextItem(resistanceMenu, 'Clear resistance override', () => applyComponentAnalysis(component, { resistance: null }, (candidate) => SMALL_SIGNAL_RESISTOR_TYPES.has(candidate.type)), {
          disabled: !resistorTargets.some((candidate) => candidate.analysis?.resistance !== null && candidate.analysis?.resistance !== undefined),
        });
      });
    }
    if (port) {
      const portTargets = analysisComponentTargets(component, (candidate) => SMALL_SIGNAL_PORT_TYPES.has(candidate.type));
      appendContextSubmenu(submenu, 'Port role', (roleMenu) => {
        appendContextItem(roleMenu, 'DC bias / AC ground', () => applyComponentAnalysis(component, { role: 'dc-bias' }, (candidate) => SMALL_SIGNAL_PORT_TYPES.has(candidate.type)), analysisChoiceState(portTargets, (candidate) => candidate.analysis?.role, 'dc-bias'));
        appendContextItem(roleMenu, 'Input node', () => applyComponentAnalysis(component, { role: 'input' }, (candidate) => SMALL_SIGNAL_PORT_TYPES.has(candidate.type)), analysisChoiceState(portTargets, (candidate) => candidate.analysis?.role, 'input'));
        appendContextItem(roleMenu, 'Output node', () => applyComponentAnalysis(component, { role: 'output' }, (candidate) => SMALL_SIGNAL_PORT_TYPES.has(candidate.type)), analysisChoiceState(portTargets, (candidate) => candidate.analysis?.role, 'output'));
        appendContextItem(roleMenu, 'Clear port role', () => applyComponentAnalysis(component, { role: null }, (candidate) => SMALL_SIGNAL_PORT_TYPES.has(candidate.type)), {
          disabled: !portTargets.some((candidate) => candidate.analysis?.role),
        });
      });
    }
  });
}

/** The side panel's style controls, laid out inline at the top of the context
 * menu so a right-click restyles without a trip to the panel. The controls are
 * cloned from the panel, so both share labels, icons, and data attributes; a
 * click keeps the menu open for the next field. */
function appendContextStyleStrip(menu) {
  const state = selectionStyleState();
  const panel = document.getElementById('style-panel');
  if (!state || !panel) return;
  const strip = document.createElement('div');
  strip.className = 'context-style-strip';
  strip.setAttribute('role', 'group');
  strip.setAttribute('aria-label', 'Style');
  const clone = (selector) => {
    const node = panel.querySelector(selector).cloneNode(true);
    for (const el of [node, ...node.querySelectorAll('[id]')]) el.removeAttribute('id');
    for (const el of node.querySelectorAll('[aria-controls]')) el.removeAttribute('aria-controls');
    return node;
  };
  const row = (name, ...children) => {
    const el = document.createElement('div');
    el.className = 'context-style-row';
    if (name) el.dataset.styleRow = name;
    el.append(...children);
    strip.appendChild(el);
    return el;
  };
  row('', clone('#style-color'));
  // The panel tucks the dash patterns into a popover; here they sit between
  // the two arrowhead toggles, one click each.
  const line = document.createElement('div');
  line.className = 'segmented';
  line.setAttribute('role', 'group');
  line.setAttribute('aria-label', 'Line style and arrowheads');
  const patterns = [...panel.querySelectorAll('#style-line-menu [data-line-style]')].map((button) => {
    const copy = button.cloneNode(true);
    copy.removeAttribute('role');
    copy.setAttribute('aria-pressed', 'false');
    return copy;
  });
  line.append(clone('#style-arrow-start'), ...patterns, clone('#style-arrow-end'));
  row('line', line);
  row('', clone('#style-width-row .segmented'));
  row('text', clone('#style-text-row .style-text-controls'));
  strip.addEventListener('click', (ev) => handleStyleControlClick(strip, ev));
  syncStyleControls(strip, state);
  menu.appendChild(strip);
}

export function openComponentContextMenu(target, x, y) {
  if (!componentContextMenuEl || !target) return;
  closeComponentContextMenu();
  componentContextTarget = target;
  const menu = componentContextMenuEl;
  menu.classList.remove('analysis-attribute-menu');
  menu.hidden = false;
  if (x > window.innerWidth - 420) menu.classList.add('opens-left');
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - 250))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - 120))}px`;
  const heading = document.createElement('div');
  heading.className = 'context-menu-heading';
  const contextComponent = target.kind === 'component' ? target.value : null;
  const contextNetwork = contextNet(target);
  const scopeCount = contextComponent
    ? analysisComponentTargets(contextComponent).length
    : contextNetwork
      ? analysisNetTargets(contextNetwork).length
      : 1;
  const scopeSuffix = scopeCount > 1 ? ` (${scopeCount} selected)` : '';
  if (contextComponent) appendMarkupText(heading, componentDisplayName(contextComponent));
  else if (contextNetwork) appendMarkupText(heading, contextNetwork.name || '(unnamed net)');
  else heading.textContent = target.kind === 'label' ? 'Label' : 'Selection';
  const headingMeta = contextComponent ? contextComponent.type : contextNetwork ? contextNetwork.id : '';
  const meta = [headingMeta, scopeSuffix.trim()].filter(Boolean).join(' ');
  if (meta) heading.append(` · ${meta}`);
  menu.appendChild(heading);
  appendContextStyleStrip(menu);
  appendContextActions(menu, target);
  appendContextSelectionMenu(menu, target);
  appendSignalFlowPolarityMenu(menu, target);
  appendSwitchPhaseMenu(menu, target);
  appendContextSmallSignalMenu(menu, target);
  if (target.kind !== 'component' && target.kind !== 'net' && target.kind !== 'wire') {
    appendContextItem(menu, 'Close', closeComponentContextMenu);
  }
  const rect = menu.getBoundingClientRect();
  if (rect.bottom > window.innerHeight - 4) menu.style.top = `${Math.max(4, window.innerHeight - 4 - rect.height)}px`;
  menu.querySelector('button:not(:disabled)')?.focus();
}

/** Right-clicking an unselected object makes it the selection, so menu actions have one clear scope. */
export function selectContextTarget(target) {
  if (target.kind === 'component') {
    if (editor.multi.has(target.value.refdes)) return;
    setSelection(supplyBarGroup(target.value.refdes), target.value.refdes);
    setLabelSelection([], null, true);
    editor.selectedNets = new Set();
  } else if (target.kind === 'label') {
    if (editor.selLabels.has(target.value.id)) return;
    setSelection([]);
    setLabelSelection([target.value.id]);
  } else if (target.kind === 'net' || target.kind === 'wire') {
    const net = contextNet(target);
    if (!net || editor.selectedNets.has(net.id)) return;
    setSelection([]);
    setLabelSelection([]);
    editor.selectedNets = new Set(namedGroupNets(net).map((member) => member.id));
  }
}

function renameFromPanel(listEl, selector, start) {
  const section = listEl.closest('.panel-group');
  if (section?.classList.contains('collapsed')) setPanelCollapsed(section.dataset.panel, false);
  let row = listEl.querySelector(selector);
  if (!row && panelFilterEl?.value) {
    panelFilterEl.value = '';
    panelFilterEl.dispatchEvent(new Event('input'));
    row = listEl.querySelector(selector);
  }
  const ref = row?.querySelector('.ref');
  if (!ref) return;
  row.scrollIntoView({ block: 'nearest' });
  start(ref);
}

/** Join a supply's bar with its aligned same-rail neighbours. A selection of
 *  several supplies is the scope; a single supply joins its whole row, since a
 *  bar needs two ends. The join is visual only (see core/supply-bars.js). */
function appendSupplyBarItem(group, comp) {
  const selectedSupplies = [...editor.multi].filter((ref) => editor.circuit.components.get(ref)?.type === 'supply');
  const scope = selectedSupplies.length > 1 ? selectedSupplies : supplyBarRow(editor.circuit, comp.refdes);
  // Joining pairs each supply only with same-named neighbours, so a selection
  // spanning VDD and VDD2 rows joins each rail's own bars. It splits only
  // when everything in scope is already joined.
  const joined = scope.length > 0 && scope.every((ref) => editor.circuit.components.get(ref)?.joinBar);
  const mixed = !joined && scope.some((ref) => editor.circuit.components.get(ref)?.joinBar);
  appendContextItem(group, scope.length > 1 ? 'Join supply bars' : 'Join supply bars (no aligned supply)', () => {
    commit(() => {
      for (const ref of scope) editor.circuit.setSupplyBarJoin(ref, !joined);
    });
    logLine(`${joined ? 'split' : 'joined'} supply bar: ${scope.join(', ')}`, 'status');
  }, { disabled: scope.length < 2 && !joined, active: joined, mixed });
}

function appendContextActions(menu, target) {
  const group = document.createElement('div');
  group.className = 'context-menu-group';
  const later = (fn) => () => setTimeout(fn, 0);
  if (target.kind === 'component') {
    const comp = target.value;
    const renamable = !isReferenceMarker(comp) && comp.type !== 'block' && comp.type !== 'solder';
    if (renamable) {
      appendContextItem(group, 'Rename…', later(() => renameFromPanel(componentsListEl, `[data-refdes="${CSS.escape(comp.refdes)}"]`, (ref) => startComponentRename(comp, ref))), { shortcut: 'dbl-click' });
    }
    appendContextItem(group, 'Rotate', () => selectedTransform('rotate'), { shortcut: 'r' });
    appendContextItem(group, 'Mirror horizontally', () => selectedTransform('mirror-x'), { shortcut: 'Shift+R' });
    appendContextItem(group, 'Mirror vertically', () => selectedTransform('mirror-y'), { shortcut: 'Ctrl/Cmd+R' });
    if (comp.type === 'supply') appendSupplyBarItem(group, comp);
    appendBeatContextItems(group, target);
  } else if (target.kind === 'label') {
    if (target.value.kind === 'label') appendContextItem(group, 'Edit text…', later(() => inlineEditLabel(target.value)), { shortcut: 't' });
    appendBeatContextItems(group, target);
  } else if (target.kind === 'net' || target.kind === 'wire') {
    const net = contextNet(target);
    appendContextItem(group, 'Rename net…', later(() => renameFromPanel(netsListEl, `#net-option-${CSS.escape(net.id)}`, (ref) => startNetRename(net, ref))));
  }
  if (target.kind !== 'net' && target.kind !== 'wire') {
    appendContextItem(group, 'Move', () => activateMove('connected'), { shortcut: 'm' });
    appendContextItem(group, 'Detached move', () => activateMove('detached'), { shortcut: 'Shift+M' });
    appendContextItem(group, 'Copy', activateCopy, { shortcut: 'c' });
    appendContextItem(group, 'Copy as image', copyAsImage, { shortcut: 'Ctrl/Cmd+Shift+C' });
    appendContextItem(group, 'Bring to front', () => restackSelected('front'), { shortcut: 'Shift+↑' });
    appendContextItem(group, 'Send to back', () => restackSelected('back'), { shortcut: 'Shift+↓' });
  }
  if (target.kind === 'net' || target.kind === 'wire') appendContextItem(group, 'Copy as image', copyAsImage, { shortcut: 'Ctrl/Cmd+Shift+C' });
  appendContextItem(group, 'Delete', deleteSelection, { shortcut: 'Del', danger: true });
  menu.appendChild(group);
}

/** Open the context menu for whatever is under a client point. */
export function openContextMenuAt(clientX, clientY) {
  const world = clientToWorld(clientX, clientY);
  const label = pickLabel(world);
  const annotation = annotationGeometryAt(world);
  const wire = pickWire(world);
  const hit = pickAt(world) || (wire ? null : supplyBarHit(world));
  const labelNet = label?.netId ? editor.circuit.nets.get(label.netId) : null;
  const target = label
    ? labelNet ? { kind: 'net', value: labelNet } : { kind: 'label', value: label }
    : annotation
      ? { kind: 'label', value: annotation }
      : hit?.refdes && editor.circuit.components.has(hit.refdes)
        ? { kind: 'component', value: editor.circuit.components.get(hit.refdes) }
        : wire
          ? { kind: 'wire', value: { net: wire.net, branch: wire.branch, segment: wire.seg } }
          : null;
  if (target) {
    selectContextTarget(target);
    render();
    openComponentContextMenu(target, clientX, clientY);
  } else closeComponentContextMenu();
}
// As in desktop menus, hovering another item closes submenus it is not part
// of. The short delay lets a diagonal move from a trigger reach its submenu
// across the rows in between.
let contextHoverButton = null;
let contextHoverTimer = 0;

function closeStrayContextSubmenus(button) {
  if (!componentContextMenuEl || componentContextMenuEl.hidden || !componentContextMenuEl.contains(button)) return;
  for (const submenu of componentContextMenuEl.querySelectorAll('.context-submenu.open')) {
    const trigger = submenu.previousElementSibling;
    if (submenu.contains(button) || trigger === button) continue;
    submenu.classList.remove('open');
    trigger?.setAttribute('aria-expanded', 'false');
    trigger?.classList.remove('context-item-open');
    // Hovering a trigger focuses it; hand focus on so neither the old row
    // stays highlighted nor :focus-within keeps the submenu showing.
    if (document.activeElement === trigger || submenu.contains(document.activeElement)) button.focus({ preventScroll: true });
  }
}

export function installContextMenu() {
  canvasEl.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    if (editor.drag?.mode === 'radialpending' || editor.drag?.mode === 'radial') return;
    if (Date.now() < editor.suppressContextMenuUntil) return;
    openContextMenuAt(ev.clientX, ev.clientY);
  });
  // The late Windows event lands on whatever the release opened under the
  // cursor (the context or radial menu), not the canvas: keep the browser's own
  // menu from opening over ours.
  window.addEventListener('contextmenu', (ev) => {
    if (Date.now() < editor.suppressContextMenuUntil || componentContextMenuEl?.contains(ev.target) || editor.radialMenuEl?.contains(ev.target)) ev.preventDefault();
  }, true);
  window.addEventListener('mousedown', (ev) => {
    if (componentContextMenuEl?.hidden || componentContextMenuEl.contains(ev.target)) return;
    closeComponentContextMenu();
  });
  componentContextMenuEl?.addEventListener('mouseover', (ev) => {
    const button = ev.target.closest?.('button');
    if (!button || button === contextHoverButton) return;
    contextHoverButton = button;
    window.clearTimeout(contextHoverTimer);
    contextHoverTimer = window.setTimeout(() => closeStrayContextSubmenus(contextHoverButton), 150);
  });
  window.addEventListener('keydown', (ev) => {
    if (componentContextMenuEl?.hidden) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      closeComponentContextMenu();
      return;
    }
    if (ev.key === 'ArrowLeft' && componentContextSubmenu?.contains(document.activeElement)) {
      ev.preventDefault();
      componentContextSubmenu.classList.remove('open');
      componentContextSubmenu.previousElementSibling?.focus();
    }
  });
}
