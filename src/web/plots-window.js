/**
 * The Plots window: a signal-flow diagram's plots in a floating window of
 * their own, beside the analysis window that sets them up. Its views --
 * magnitude, phase, step, root locus, swing, loop gain, and the time domain
 * -- are signal-flow-ui.js's (the time domain time-plot.js's); this module
 * is the window around them. `Shift+W` shows or hides it, as do its toolbar
 * button and the More menu; Derive opens it unless it was closed since.
 */

import { canvasEl } from './elements.js';
import { element as el } from './dom.js';
import { floatingWindow } from './floating-window.js';

let win = null; // { el, body, chrome }
let content = null;
let onShow = () => {};
// Derive opens the window; closing it says not to, until it is opened again.
let wanted = true;

function build() {
  const close = el('button', { type: 'button', class: 'floating-window-close', 'aria-label': 'Close the plots', title: 'Close (Shift+W)', text: '×' });
  const body = el('div', { class: 'plots-body' }, [content]);
  const node = el('section', { class: 'floating-window plots-window', 'aria-labelledby': 'plots-title', hidden: true }, [
    el('header', { class: 'floating-window-header' }, [el('h2', { id: 'plots-title', class: 'floating-window-title', text: 'Plots' }), close]),
    body,
  ]);
  node.addEventListener('keydown', (ev) => {
    // Its fields are the window's own: keys typed there never reach the drawing.
    ev.stopPropagation();
    if (ev.key === 'Escape' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(ev.target.tagName)) hidePlots();
  });
  canvasEl.closest('.canvas-pane').append(node);
  const chrome = floatingWindow(node, { key: 'plots', onClose: hidePlots, resizable: true });
  win = { el: node, body, chrome };
}

function syncButtons() {
  document.getElementById('btn-window-plots')?.setAttribute('aria-pressed', String(plotsShown()));
}

export function plotsShown() {
  return !!win && !win.el.hidden;
}

/** Show the window (built on first use) and draw its view. */
export function showPlots() {
  if (!win) build();
  wanted = true;
  if (win.el.hidden) {
    win.el.hidden = false;
    win.chrome.place();
  }
  syncButtons();
  onShow();
}

export function hidePlots() {
  if (!win || win.el.hidden) return;
  win.el.hidden = true;
  wanted = false;
  syncButtons();
  canvasEl.focus({ preventScroll: true });
}

/** Shift+W: show or hide the plots. */
export function togglePlots() {
  if (plotsShown()) hidePlots();
  else showPlots();
}

/** Derive's: show the plots, unless they were closed since last shown. */
export function offerPlots() {
  if (wanted && !plotsShown()) showPlots();
}

/** `view`: the element the window shows; `shown`: called whenever it opens. */
export function installPlotsWindow({ view, shown }) {
  content = view;
  onShow = shown;
  document.getElementById('btn-window-plots')?.addEventListener('click', togglePlots);
}
