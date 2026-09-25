/**
 * The toolbar and tool rail: fitting the toolbar to the window, the tool
 * buttons' pressed state and flyouts, the wire route mode, the document and
 * settings menus, and the theme, grid, guides, crosshair, scroll scheme,
 * and page guide toggles. Fitting's rules are in toolbar-fit.js.
 */

import { normalizePageGuide, pageGuideCaption } from '../core/page-guide.js';
import { minimalRevealScroll } from './toolbar.js';
import { chooseToolbarStage, toolbarFits, toolbarStageTokens } from './toolbar-fit.js';
import { canvasEl, componentContextMenuEl, circuitNameEl, modeToolbarEl, toolbarEl, railFlyoutProxyEl, railFlyoutEl, scrollSchemeButton, themeBtn, gridBtn, crosshairBtn, guidesBtn } from './elements.js';
import { ICON_PATHS, syncToolCursor } from './icons.js';
import { logLine, hintLine } from './status-bar-ui.js';
import { runCheck } from './design-check-ui.js';
import { prefersReducedMotion } from './canvas-view.js';
import { closeComponentContextMenu, appendContextItem } from './context-menu.js';
import { saveCircuit } from './document-session.js';
import { editor } from './editor-state.js';
import { activateAlign, activateAnnotation, activateCopy, activateDelete, activateHighlight, activateMove, activateNetLabel, activatePlace, activateSelect, activateShapeAnnotation, activateVisual, activateWire, hasWireDraft, interactionState, removeAllNetHighlights, render, restackSelected, selectedTransform } from './main.js';

// The top toolbar drops button text in stages as its row runs out of space (see
// toolbar-fit.js). Refit when the bar resizes or the document title changes.
let toolbarFitFrame = 0;

let titleMeasureContext = null;

function titleTextWidth() {
  const style = getComputedStyle(circuitNameEl);
  titleMeasureContext ||= document.createElement('canvas').getContext('2d');
  titleMeasureContext.font = style.font;
  const text = circuitNameEl.value || circuitNameEl.placeholder || '';
  return titleMeasureContext.measureText(text).width
    + parseFloat(style.paddingLeft || '0') + parseFloat(style.paddingRight || '0');
}

function fitToolbar() {
  toolbarFitFrame = 0;
  if (!toolbarEl) return;
  const wanted = titleTextWidth();
  const stage = chooseToolbarStage((count) => {
    toolbarEl.dataset.compact = toolbarStageTokens(count);
    return toolbarFits({
      scrollWidth: toolbarEl.scrollWidth,
      clientWidth: toolbarEl.clientWidth,
      titleWidth: circuitNameEl.getBoundingClientRect().width,
      titleTextWidth: wanted,
    });
  });
  toolbarEl.dataset.compact = toolbarStageTokens(stage);
}

export function scheduleToolbarFit() {
  if (!toolbarFitFrame) toolbarFitFrame = requestAnimationFrame(fitToolbar);
}

/** Right-click on the highlight tool: its one bulk action. */
function openHighlightToolMenu(x, y) {
  if (!componentContextMenuEl) return;
  closeComponentContextMenu();
  const menu = componentContextMenuEl;
  menu.hidden = false;
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - 250))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - 120))}px`;
  const heading = document.createElement('div');
  heading.className = 'context-menu-heading';
  heading.textContent = 'Net highlight';
  menu.appendChild(heading);
  const highlighted = editor.circuit.toJSON().netHighlights;
  appendContextItem(menu, 'Remove all highlights', removeAllNetHighlights, { disabled: !highlighted, shortcut: '8', danger: true });
  const rect = menu.getBoundingClientRect();
  if (rect.bottom > window.innerHeight - 4) menu.style.top = `${Math.max(4, window.innerHeight - 4 - rect.height)}px`;
  if (rect.right > window.innerWidth - 4) menu.style.left = `${Math.max(4, window.innerWidth - 4 - rect.width)}px`;
  // Keyboard focus starts on the first action, not the first swatch.
  (menu.querySelector('.context-menu-group button:not(:disabled)') || menu.querySelector('button:not(:disabled)'))?.focus();
}

const TOOLBAR_IDS = {
  normal: ['btn-mode-select', 'btn-select', 'mode-select'],
  place: ['btn-place', 'btn-insert', 'btn-mode-place', 'tool-place', 'tool-insert', 'mode-place'],
  wire: ['btn-wire', 'btn-mode-wire', 'tool-wire', 'mode-wire'],
  visual: ['btn-mode-visual', 'btn-box-select', 'tool-visual', 'mode-visual'],
  move: ['btn-move', 'btn-mode-move', 'tool-move', 'mode-move'],
  'move-detached': ['btn-move-detached', 'btn-detach-move', 'btn-mode-detach-move', 'btn-detached-move', 'tool-move-detached', 'mode-detached-move'],
  copy: ['btn-copy', 'btn-mode-copy', 'tool-copy', 'mode-copy'],
  delete: ['btn-delete', 'btn-mode-delete', 'tool-delete', 'mode-delete'],
  'send-back': ['btn-send-back'],
  'bring-front': ['btn-bring-front'],
  'net-label': ['btn-net-label', 'btn-mode-net-label', 'tool-net-label', 'mode-net-label'],
  highlight: ['btn-mode-highlight'],
  annotation: ['btn-annotation', 'btn-mode-annotation', 'tool-annotation', 'mode-annotation'],
  arrow: ['btn-arrow', 'btn-mode-arrow', 'tool-arrow', 'mode-arrow'],
  box: ['btn-box', 'btn-mode-box', 'tool-box', 'mode-box'],
  line: ['btn-line', 'btn-mode-line', 'tool-line', 'mode-line'],
  rotate: ['btn-rotate', 'tool-rotate'],
  'mirror-x': ['btn-mirror-x', 'btn-mirror-horizontal', 'tool-mirror-x', 'tool-mirror-horizontal'],
  'mirror-y': ['btn-mirror-y', 'btn-mirror-vertical', 'tool-mirror-y', 'tool-mirror-vertical'],
  check: ['btn-check', 'btn-evaluate', 'tool-check'],
  save: ['btn-save', 'btn-save-circuit', 'tool-save'],
};

/** Elements matched by `selectors`, cached: the toolbars are static markup and
 * every repaint syncs them, so re-query only once a cached node was removed. */
const staticElementCache = new Map();

function staticElements(key, selectors) {
  const cached = staticElementCache.get(key);
  if (cached && cached.every((el) => el.isConnected)) return cached;
  const found = [...new Set(selectors().flatMap((selector) => [...document.querySelectorAll(selector)]))];
  staticElementCache.set(key, found);
  return found;
}

function toolbarElements(action) {
  return staticElements(`toolbar:${action}`, () => [
    ...(TOOLBAR_IDS[action] || []).map((id) => `#${id}`),
    `[data-interaction="${action}"]`, `[data-tool="${action}"]`, `[data-mode="${action}"]`, `[data-action="${action}"]`,
  ]);
}

/** Briefly pulse a rail button to confirm a tool or wire-shape change. */
function flashToolButton(button) {
  if (!button) return;
  button.classList.remove('tool-flash');
  void button.offsetWidth; // restart the animation when switching quickly
  button.classList.add('tool-flash');
  button.addEventListener('animationend', () => button.classList.remove('tool-flash'), { once: true });
}

let lastToolbarState = null;

let lastModeToolbarControl = null;

function modeToolbarControlFor(state) {
  if (!modeToolbarEl) return null;
  const direct = toolbarElements(state.toolbar).find((el) => (
    el.classList.contains('mode-control')
    && !el.hidden
    && el.closest('.mode-toolbar') === modeToolbarEl
  ));
  if (direct) return direct;
  return RAIL_FLYOUT_TOOLS.includes(state.toolbar) ? railFlyoutProxyEl : null;
}

// Text, arrow, box, and line share one rail slot. The slot shows the last-used
// tool and activates it on click; hover, right-click, or a long press opens
// the strip with all four. The real tool buttons live in the strip, so their
// bindings and pressed state are unchanged.
const RAIL_FLYOUT_TOOLS = ['annotation', 'arrow', 'box', 'line'];

let railFlyoutTool = 'annotation';

function railFlyoutButton(tool) {
  return railFlyoutEl?.querySelector(`[data-action="${tool}"]`) || null;
}

function syncRailFlyout(state) {
  if (!railFlyoutProxyEl) return;
  if (RAIL_FLYOUT_TOOLS.includes(state.toolbar)) railFlyoutTool = state.toolbar;
  const active = RAIL_FLYOUT_TOOLS.includes(state.toolbar);
  railFlyoutProxyEl.setAttribute('aria-pressed', String(active));
  railFlyoutProxyEl.classList.toggle('active', active);
  const source = railFlyoutButton(railFlyoutTool);
  const icon = railFlyoutProxyEl.querySelector('.button-icon');
  if (source && icon && railFlyoutProxyEl.dataset.icon !== source.dataset.icon) {
    railFlyoutProxyEl.dataset.icon = source.dataset.icon;
    icon.innerHTML = ICON_PATHS[source.dataset.icon] || '';
  }
  if (source) railFlyoutProxyEl.title = `${source.title} · hover or right-click for all annotation tools`;
}

/** Hover, right-click, or a long press on a rail slot opens its flyout strip
 * beside it; leaving both, picking a tool, or Escape closes it. Clicking the
 * slot itself stays the slot's own action. Shared by the annotation tools and
 * the wire shapes so both behave and look the same. */
function bindRailFlyout(proxy, flyout) {
  if (!proxy || !flyout) return { close() {} };
  let timer = 0;
  const open = () => {
    if (!flyout.hidden) return;
    for (const other of railFlyouts) if (other.flyout !== flyout) other.close();
    const pane = document.querySelector('.canvas-pane').getBoundingClientRect();
    const r = proxy.getBoundingClientRect();
    flyout.hidden = false;
    // Beside a vertical rail; below the horizontal strip a narrow window uses.
    const horizontal = modeToolbarEl && getComputedStyle(modeToolbarEl).flexDirection === 'row';
    flyout.style.left = `${horizontal ? r.left - pane.left - 5 : r.right - pane.left + 8}px`;
    flyout.style.top = `${horizontal ? r.bottom - pane.top + 8 : r.top - pane.top - 5}px`;
    proxy.setAttribute('aria-expanded', 'true');
  };
  const close = () => {
    window.clearTimeout(timer);
    if (flyout.hidden) return;
    flyout.hidden = true;
    proxy.setAttribute('aria-expanded', 'false');
  };
  proxy.addEventListener('click', close);
  proxy.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    open();
  });
  proxy.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType === 'mouse') return;
    timer = window.setTimeout(open, 400);
  });
  const hoverIn = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(open, 350);
  };
  const hoverOut = (ev) => {
    if (flyout.contains(ev.relatedTarget) || proxy.contains(ev.relatedTarget)) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(close, 220);
  };
  proxy.addEventListener('pointerenter', hoverIn);
  proxy.addEventListener('pointerleave', hoverOut);
  flyout.addEventListener('pointerenter', () => window.clearTimeout(timer));
  flyout.addEventListener('pointerleave', hoverOut);
  flyout.addEventListener('click', (ev) => {
    if (ev.target.closest('button')) close();
  });
  flyout.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    ev.stopPropagation();
    close();
    proxy.focus();
  });
  const handle = { flyout, open, close };
  railFlyouts.push(handle);
  return handle;
}

const railFlyouts = [];

/** Reveal a newly selected mode with the smallest possible rail scroll. */
function revealModeToolbarControl(control) {
  if (!modeToolbarEl || !control) return;
  const horizontal = getComputedStyle(modeToolbarEl).flexDirection === 'row';
  const rail = modeToolbarEl.getBoundingClientRect();
  const visibleLeft = rail.left + modeToolbarEl.clientLeft;
  const visibleTop = rail.top + modeToolbarEl.clientTop;
  const visibleRight = visibleLeft + modeToolbarEl.clientWidth;
  const visibleBottom = visibleTop + modeToolbarEl.clientHeight;
  const target = control.getBoundingClientRect();
  const nextScroll = horizontal
    ? minimalRevealScroll(visibleLeft, visibleRight, target.left, target.right, modeToolbarEl.scrollLeft, Math.max(0, modeToolbarEl.scrollWidth - modeToolbarEl.clientWidth))
    : minimalRevealScroll(visibleTop, visibleBottom, target.top, target.bottom, modeToolbarEl.scrollTop, Math.max(0, modeToolbarEl.scrollHeight - modeToolbarEl.clientHeight));
  if (horizontal) {
    if (Math.abs(nextScroll - modeToolbarEl.scrollLeft) > 0.5) modeToolbarEl.scrollLeft = nextScroll;
  } else {
    if (Math.abs(nextScroll - modeToolbarEl.scrollTop) > 0.5) modeToolbarEl.scrollTop = nextScroll;
  }
}

/** Apply all interaction affordances from one derived state. */
export function syncInteractionUI() {
  const state = interactionState();
  const modeControl = modeToolbarControlFor(state);
  if (lastToolbarState !== null && state.toolbar !== lastToolbarState) {
    for (const el of toolbarElements(state.toolbar)) {
      if (el.classList.contains('mode-control') && !el.hidden) flashToolButton(el);
    }
  }
  if (modeControl && modeControl !== lastModeToolbarControl) revealModeToolbarControl(modeControl);
  lastToolbarState = state.toolbar;
  lastModeToolbarControl = modeControl;
  for (const action of Object.keys(TOOLBAR_IDS)) {
    const active = state.toolbar === action;
    for (const el of toolbarElements(action)) {
      el.setAttribute('aria-pressed', String(active));
      el.setAttribute('aria-current', active ? 'true' : 'false');
      el.classList.toggle('active', active);
    }
  }
  for (const kind of ['orthogonal', 'diagonal']) {
    // Like the annotation strip, a shape reads as pressed only while it is the
    // tool in use.
    const active = editor.routeMode === kind && state.toolbar === 'wire';
    for (const el of routeModeElements(kind)) {
      el.setAttribute('aria-pressed', String(active));
      el.setAttribute('aria-current', active ? 'true' : 'false');
      if (el.tagName === 'INPUT') el.checked = active;
      el.classList.toggle('active', active);
    }
  }
  for (const id of ['routing-mode', 'route-mode', 'route-mode-select', 'route-choice']) {
    const select = document.getElementById(id);
    if (select?.tagName === 'SELECT') select.value = editor.routeMode;
  }
  // Toggle only real changes: rewriting the canvas class invalidates style
  // for the whole drawing, and this runs on every repaint.
  for (const name of ['mode-normal', 'mode-place', 'mode-insert', 'mode-wire', 'mode-visual', 'mode-move', 'mode-detached-move', 'mode-copy', 'mode-delete', 'mode-net-label', 'mode-highlight', 'mode-annotation']) {
    canvasEl.classList.toggle(name, name === state.canvasClass);
  }
  canvasEl.classList.toggle(state.canvasClass, true);
  canvasEl.classList.toggle('wire-mode', !!editor.wire || state.canvasClass === 'wire-mode');
  canvasEl.classList.toggle('direct-wire-mode', !!editor.directWire || state.canvasClass === 'direct-wire-mode');
  syncRailFlyout(state);
  syncToolCursor(state);
  return state;
}

const ROUTE_MODE_IDS = {
  orthogonal: ['route-orthogonal', 'route-mode-orthogonal', 'btn-route-orthogonal', 'btn-route-ortho', 'btn-orthogonal-route'],
  diagonal: ['route-diagonal', 'route-mode-diagonal', 'btn-route-diagonal', 'btn-diagonal-route'],
};

function routeModeElements(kind) {
  return staticElements(`route:${kind}`, () => [
    ...(ROUTE_MODE_IDS[kind] || []).map((id) => `#${id}`),
    `[data-route-mode="${kind}"]`, `[data-route="${kind}"]`,
  ]);
}

function routeChoiceContainers() {
  return ['route-mode-controls', 'route-controls', 'route-choice', 'route-mode']
    .map((id) => document.getElementById(id)).filter(Boolean)
    .filter((el) => !['SELECT', 'INPUT', 'BUTTON'].includes(el.tagName));
}

function exposeRouteChoice() {
  editor.routeChoiceExposed = true;
  for (const el of routeChoiceContainers()) {
    el.hidden = false;
    el.classList.add('exposed');
    el.setAttribute('aria-expanded', 'true');
  }
  for (const kind of ['orthogonal', 'diagonal']) for (const el of routeModeElements(kind)) el.hidden = false;
  for (const id of ['btn-route-mode', 'route-mode-toggle', 'btn-route-choice']) {
    const el = document.getElementById(id);
    if (el) el.setAttribute('aria-expanded', 'true');
  }
  for (const id of ['routing-mode', 'route-mode', 'route-mode-select', 'route-choice']) {
    const el = document.getElementById(id);
    if (el) el.hidden = false;
  }
}

function setRouteMode(next, announce = true) {
  const wanted = next === 'diagonal' ? 'diagonal' : 'orthogonal';
  editor.routeMode = wanted;
  if (editor.wire) {
    // Route choice is latched on the persistent wire command.  Changing F3 or
    // the selector while a draft is active therefore changes the exact model
    // options that the next commit will use, rather than merely changing the
    // status text or a preview.
    editor.wire.routeStyle = wanted;
    editor.wire.allowDiagonal = wanted === 'diagonal';
  }
  exposeRouteChoice();
  for (const kind of ['orthogonal', 'diagonal']) {
    for (const el of routeModeElements(kind)) {
      if (el.tagName === 'INPUT') el.checked = kind === wanted;
      el.setAttribute('aria-pressed', kind === wanted ? 'true' : 'false');
    }
  }
  const select = ['routing-mode', 'route-mode', 'route-mode-select', 'route-choice']
    .map((id) => document.getElementById(id)).find((el) => el?.tagName === 'SELECT');
  syncWireButtonRouteMode(announce);
  if (announce) logLine(`route mode: ${wanted}${hasWireDraft() ? ' (active wire draft updated)' : ''}`);
  render();
}

/** The Wire tool button shows the active wire shape; a change briefly highlights it. */
function syncWireButtonRouteMode(flash = false) {
  const button = document.getElementById('btn-mode-wire');
  if (!button) return;
  const icon = button.querySelector('.button-icon');
  if (icon) icon.innerHTML = ICON_PATHS[editor.routeMode === 'diagonal' ? 'wire-diagonal' : 'wire'];
  button.dataset.routeShape = editor.routeMode;
  button.title = `Draw an electrical wire (w) · hold Alt to snap to the nearest terminal · ${editor.routeMode} shape · F3 to toggle; hover or right-click for both shapes`;
  if (flash) flashToolButton(button);
}

export function toggleRouteMode() {
  exposeRouteChoice();
  setRouteMode(editor.routeMode === 'orthogonal' ? 'diagonal' : 'orthogonal');
}

function bindInteractionControls() {
  const actions = {
    normal: activateSelect,
    place: activatePlace,
    wire: activateWire,
    visual: activateVisual,
    move: () => activateMove('connected'),
    'move-detached': () => activateMove('detached'),
    'detach-move': () => activateMove('detached'),
    copy: activateCopy,
    delete: activateDelete,
    align: activateAlign,
    'send-back': () => restackSelected('back'),
    'bring-front': () => restackSelected('front'),
    'net-label': activateNetLabel,
    highlight: activateHighlight,
    annotation: activateAnnotation,
    arrow: () => activateShapeAnnotation('arrow'),
    box: () => activateShapeAnnotation('box'),
    line: () => activateShapeAnnotation('line'),
    rotate: () => selectedTransform('rotate'),
    'mirror-x': () => selectedTransform('mirror-x'),
    'mirror-y': () => selectedTransform('mirror-y'),
    check: runCheck,
    save: saveCircuit,
  };
  for (const [action, fn] of Object.entries(actions)) {
    for (const el of toolbarElements(action)) {
      if (el.dataset.interactionBound) continue;
      el.dataset.interactionBound = 'true';
      el.addEventListener('click', (ev) => { ev.preventDefault(); fn(); });
    }
  }

  for (const kind of ['orthogonal', 'diagonal']) {
    for (const el of routeModeElements(kind)) {
      if (el.tagName === 'INPUT' && el.checked) editor.routeMode = kind;
      if (el.dataset.routeBound) continue;
      el.dataset.routeBound = 'true';
      el.addEventListener('click', (ev) => { ev.preventDefault(); setRouteMode(kind); });
      if (el.tagName === 'INPUT') el.addEventListener('change', () => { if (el.checked) setRouteMode(kind); });
    }
  }
  const select = ['routing-mode', 'route-mode', 'route-mode-select', 'route-choice'].map((id) => document.getElementById(id)).find((el) => el?.tagName === 'SELECT');
  if (select && !select.dataset.routeBound) {
    if (select.value === 'diagonal' || select.value === 'orthogonal') editor.routeMode = select.value;
    select.dataset.routeBound = 'true';
    select.addEventListener('change', () => setRouteMode(select.value));
  }
  for (const el of ['btn-route-mode', 'route-mode-toggle', 'btn-route-choice', 'route-mode']
    .map((id) => document.getElementById(id)).filter(Boolean)) {
    if (el.dataset.routeBound) continue;
    el.dataset.routeBound = 'true';
    el.addEventListener('click', (ev) => { ev.preventDefault(); toggleRouteMode(); });
  }
  // Normalize every route control after reading the initial choice so the
  // selector, radio/button affordances, and the persistent draft state start
  // from one value.
  setRouteMode(editor.routeMode, false);
}

export const toolbarMenus = [
  [document.getElementById('btn-document-menu'), document.getElementById('document-menu')],
  [document.getElementById('btn-settings'), document.getElementById('settings-menu')],
  [document.getElementById('style-line-pattern'), document.getElementById('style-line-menu')],
].filter(([button, menu]) => button && menu);

export function closeToolbarMenu(button, menu, focusButton = false) {
  if (menu.hidden) return;
  menu.hidden = true;
  button.setAttribute('aria-expanded', 'false');
  if (focusButton) button.focus();
}

// A narrow toolbar hides New, Export, and the view toggles; the More menu shows
// proxy items that click the real buttons, and mirror their pressed state.
function syncMenuProxies(menu) {
  for (const item of menu.querySelectorAll('[data-proxy-for][role="menuitemcheckbox"]')) {
    const target = document.getElementById(item.dataset.proxyFor);
    item.setAttribute('aria-checked', String(target?.getAttribute('aria-pressed') === 'true'));
  }
}

function dismissToolbarMenusOutside(ev) {
  for (const [button, menu] of toolbarMenus) {
    if (!menu.contains(ev.target) && !button.contains(ev.target)) closeToolbarMenu(button, menu);
  }
}

function syncScrollSchemeButton() {
  scrollSchemeButton?.setAttribute('aria-checked', String(editor.scrollScheme === 'trackpad'));
}

const THEME_KEY = 'mosfeteer:theme';

function applyTheme(dark) {
  document.documentElement.classList.toggle('dark', dark);
  syncToolCursor();
  if (themeBtn) {
    themeBtn.setAttribute('aria-pressed', String(dark));
    themeBtn.title = dark ? 'Switch to light theme (Shift+D)' : 'Switch to dark theme (Shift+D)';
    const icon = themeBtn.querySelector('.button-icon');
    if (icon) icon.innerHTML = ICON_PATHS[dark ? 'sun' : 'moon'];
  }
  try {
    localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
  } catch { /* storage unavailable */ }
}

export function toggleTheme() {
  const next = !document.documentElement.classList.contains('dark');
  // Crossfade the whole window where the browser supports view transitions.
  if (document.startViewTransition && !prefersReducedMotion()) document.startViewTransition(() => applyTheme(next));
  else applyTheme(next);
}

/** Turn the placement grid on/off; keeps the toolbar button and the '#'
 *  keybinding in sync. */
export function setGrid(on) {
  editor.showGrid = on;
  if (gridBtn) {
    gridBtn.setAttribute('aria-pressed', String(editor.showGrid));
    gridBtn.title = editor.showGrid ? 'Hide the placement grid (#)' : 'Show the placement grid (#)';
  }
  render();
  hintLine(editor.showGrid ? 'grid shown' : 'grid hidden');
}

// Crosshair visibility is independent from pointer presence: the pointer
// leaving the canvas hides it, while this toggle controls whether it may
// render when the pointer is inside.
export function setCrosshair(on, announce = true) {
  editor.crosshairVisible = !!on;

  if (crosshairBtn) {
    crosshairBtn.setAttribute('aria-pressed', String(editor.crosshairVisible));
    crosshairBtn.title = editor.crosshairVisible ? 'Hide the crosshair (Shift+C)' : 'Show the crosshair (Shift+C)';
  }
  render();
  if (announce) hintLine(editor.crosshairVisible ? 'crosshair shown' : 'crosshair hidden');
}

// Placement guides are advisory, so they are a view toggle like the grid and
// the crosshair rather than anything the document carries.
export function setGuides(on, announce = true) {
  editor.guidesVisible = !!on;
  if (guidesBtn) {
    guidesBtn.setAttribute('aria-pressed', String(editor.guidesVisible));
    guidesBtn.title = editor.guidesVisible ? 'Hide the spacing and alignment guides (Shift+G)' : 'Show the spacing and alignment guides (Shift+G)';
  }
  render();
  if (announce) hintLine(editor.guidesVisible ? 'placement guides shown' : 'placement guides hidden');
}

// Page guide: an app preference, like the other view toggles. It shows the
// width an export will be padded to (see core/page-guide.js).
const PAGE_GUIDE_KEY = 'mosfeteer.pageGuide';

function syncPageGuideControls() {
  for (const item of document.querySelectorAll('[data-page-guide]')) {
    item.setAttribute('aria-checked', String((editor.pageGuide?.preset || '') === item.dataset.pageGuide));
  }
}

function setPageGuide(preset) {
  editor.pageGuide = normalizePageGuide(preset);
  try { localStorage.setItem(PAGE_GUIDE_KEY, editor.pageGuide?.preset || ''); } catch { /* per-session only */ }
  syncPageGuideControls();
  render();
  hintLine(editor.pageGuide ? `page guide: ${pageGuideCaption(editor.pageGuide)}` : 'page guide off');
}

export function syncModeToolbarOverflow() {
  if (!modeToolbarEl) return;
  const styles = getComputedStyle(modeToolbarEl);
  const remaining = styles.flexDirection === 'row'
    ? modeToolbarEl.scrollWidth - modeToolbarEl.clientWidth - modeToolbarEl.scrollLeft
    : modeToolbarEl.scrollHeight - modeToolbarEl.clientHeight - modeToolbarEl.scrollTop;
  modeToolbarEl.toggleAttribute('data-overflow-end', remaining > 1);
}

export function installToolbarUi() {
  if (toolbarEl) {
    new ResizeObserver(scheduleToolbarFit).observe(toolbarEl);
    document.fonts?.ready?.then(scheduleToolbarFit);
  }

  document.getElementById('btn-mode-highlight')?.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    openHighlightToolMenu(ev.clientX, ev.clientY);
  });

  bindRailFlyout(railFlyoutProxyEl, railFlyoutEl);

  railFlyoutProxyEl?.addEventListener('click', (ev) => {
    ev.preventDefault();
    railFlyoutButton(railFlyoutTool)?.click();
  });

  // The wire shapes share the Wire rail slot the way the annotation tools share
  // theirs: clicking the slot draws with the current shape, and its flyout picks
  // a shape and starts drawing with it.
  bindRailFlyout(document.getElementById('btn-mode-wire'), document.getElementById('wire-flyout'));

  document.getElementById('wire-flyout')?.addEventListener('click', (ev) => {
    if (!ev.target.closest('[data-route-mode]')) return;
    if (interactionState().toolbar !== 'wire') activateWire();
  });

  bindInteractionControls();

  // A pointer click on a rail tool hands the keyboard back to the canvas, so
  // Escape and the tool keys work at once. (A focused button swallows canvas
  // keys; keyboard activation keeps focus on the rail for further tabbing.)
  for (const rail of document.querySelectorAll('.mode-toolbar, .rail-flyout')) {
    rail.addEventListener('click', (ev) => {
      if (ev.detail > 0 && ev.target.closest('button')) canvasEl.focus({ preventScroll: true });
    });
  }

  for (const [button, menu] of toolbarMenus) {
    button.addEventListener('click', (ev) => {
      ev.preventDefault();
      if (!menu.hidden) { closeToolbarMenu(button, menu); return; }
      for (const [otherButton, otherMenu] of toolbarMenus) closeToolbarMenu(otherButton, otherMenu);
      syncMenuProxies(menu);
      menu.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      [...menu.querySelectorAll('[role^="menuitem"]:not(:disabled)')].find((item) => item.getClientRects().length)?.focus();
    });
    menu.addEventListener('click', (ev) => {
      if (ev.target.closest?.('[role="menuitem"]')) closeToolbarMenu(button, menu);
    });
    menu.addEventListener('keydown', (ev) => {
      if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
      ev.preventDefault();
      // Items folded in only for narrow windows are display:none otherwise.
      const items = [...menu.querySelectorAll('[role^="menuitem"]:not(:disabled)')].filter((item) => item.getClientRects().length);
      const next = items.indexOf(document.activeElement) + (ev.key === 'ArrowDown' ? 1 : -1);
      items[(next + items.length) % items.length]?.focus();
    });
  }

  for (const item of document.querySelectorAll('[data-proxy-for]')) {
    item.addEventListener('click', (ev) => {
      ev.preventDefault();
      document.getElementById(item.dataset.proxyFor)?.click();
      syncMenuProxies(item.closest('[role="menu"]'));
    });
  }

  window.addEventListener('pointerdown', dismissToolbarMenusOutside, true);

  window.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    const open = toolbarMenus.find(([, menu]) => !menu.hidden);
    if (!open) return;
    ev.preventDefault();
    closeToolbarMenu(open[0], open[1], true);
  });

  scrollSchemeButton?.addEventListener('click', () => {
    editor.scrollScheme = editor.scrollScheme === 'trackpad' ? 'mouse' : 'trackpad';
    try { localStorage.setItem('mosfeteer.scrollScheme', editor.scrollScheme); } catch { /* per-session only */ }
    syncScrollSchemeButton();
    hintLine(editor.scrollScheme === 'trackpad' ? 'trackpad scrolling: scroll pans, pinch zooms' : 'mouse scrolling: the wheel zooms');
  });

  syncScrollSchemeButton();

  // Persist the theme across reloads; default to light unless the system prefers dark.
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved) applyTheme(saved === 'dark');
    else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) applyTheme(true);
  } catch { /* storage unavailable */ }

  if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

  if (gridBtn) {
    gridBtn.addEventListener('click', () => setGrid(!editor.showGrid));
    gridBtn.setAttribute('aria-pressed', String(editor.showGrid));
    gridBtn.title = editor.showGrid ? 'Hide the placement grid (#)' : 'Show the placement grid (#)';
  }

  if (guidesBtn) {
    guidesBtn.addEventListener('click', () => setGuides(!editor.guidesVisible));
    guidesBtn.setAttribute('aria-pressed', String(editor.guidesVisible));
  }

  for (const item of document.querySelectorAll('[data-page-guide]')) {
    item.addEventListener('click', (ev) => {
      ev.preventDefault();
      setPageGuide(item.dataset.pageGuide);
    });
  }

  syncPageGuideControls();

  if (crosshairBtn) {
    crosshairBtn.addEventListener('click', () => setCrosshair(!editor.crosshairVisible));
    crosshairBtn.setAttribute('aria-pressed', String(editor.crosshairVisible));
    crosshairBtn.title = editor.crosshairVisible ? 'Hide the crosshair (Shift+C)' : 'Show the crosshair (Shift+C)';
  }

  if (modeToolbarEl) {
    modeToolbarEl.addEventListener('scroll', syncModeToolbarOverflow, { passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(syncModeToolbarOverflow).observe(modeToolbarEl);
    }
    if (typeof MutationObserver !== 'undefined') {
      new MutationObserver(syncModeToolbarOverflow).observe(modeToolbarEl, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['class', 'hidden', 'style'],
      });
    }
    syncModeToolbarOverflow();
  }
}
