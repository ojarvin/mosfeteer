/**
 * The calculator: a floating window with one line to type into and the
 * results above it, no buttons. Enter works the line out (core/calculator.js:
 * `20*log(123)`, `123e-12`, `4.7k`, `R = 10k`, `ans`); the last ten results
 * show, older ones scroll. Up and Down step through what was typed, and a
 * click on a result puts its value in the line. The results are saved with
 * the design (`Circuit#windows.calculator`), names given in them included,
 * so another design has its own and this one keeps them when it is closed
 * and opened again. `clear` typed in the line, or the Clear button, empties
 * the results and forgets `ans` and every name. `Shift+E` shows or hides it.
 */

import { calculate, formatResult, replayNames, siResult } from '../core/calculator.js';
import { CALCULATOR_HISTORY } from '../core/window-state.js';
import { canvasEl } from './elements.js';
import { editor } from './editor-state.js';
import { floatingWindow } from './floating-window.js';
import { markSettingsChanged, onDocumentShown } from './main.js';

/** Results shown without scrolling. */
const SHOWN = 10;

let win = null; // { el, list, input, chrome }
let names = {}; // ans and the names given, from the design's results
let recall = -1; // Up/Down: how far back in what was typed

const history = () => editor.circuit.windows.calculator?.history || [];

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value !== false && value !== null && value !== undefined) node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children);
  return node;
}

function row(entry) {
  const result = el('span', { class: `calculator-result${entry.error ? ' analysis-error' : ''}`, text: entry.error ? entry.result : `= ${entry.result}` });
  const item = el('li', { class: 'calculator-entry' }, [el('span', { class: 'calculator-input', text: entry.input }), result]);
  if (!entry.error) {
    item.title = 'Click to put this value in the line';
    item.addEventListener('click', () => insert(entry.result.split(' ')[0]));
  }
  return item;
}

function renderList() {
  if (!win) return;
  const entries = history();
  win.list.replaceChildren(...entries.map(row));
  win.empty.hidden = entries.length > 0;
  win.list.scrollTop = win.list.scrollHeight;
}

/** Put text into the line at the caret. */
function insert(text) {
  const { input } = win;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  input.value = input.value.slice(0, start) + text + input.value.slice(end);
  input.focus();
  input.setSelectionRange(start + text.length, start + text.length);
}

/** Empty the results and forget ans and every name given. */
function clearCalculator() {
  names = {};
  recall = -1;
  if (editor.circuit.windows.calculator) {
    delete editor.circuit.windows.calculator;
    markSettingsChanged();
  }
  renderList();
  win?.input.focus();
}

/** Work out one line and keep it with the design. */
function calculateLine(line) {
  const text = String(line).trim();
  if (!text) return null;
  if (/^(clear|cls|reset)$/i.test(text)) {
    clearCalculator();
    return { input: text, cleared: true };
  }
  let entry;
  try {
    const { name, value } = calculate(text, names);
    const shown = formatResult(value);
    const si = siResult(value);
    entry = { input: text, result: si && si !== shown ? `${shown} (${si})` : shown };
    if (name) names[name] = value;
    names.ans = value;
  } catch (err) {
    entry = { input: text, result: err.message, error: true };
  }
  const state = editor.circuit.windows;
  state.calculator = { history: [...history(), entry].slice(-CALCULATOR_HISTORY) };
  markSettingsChanged();
  renderList();
  return entry;
}

function onKey(ev) {
  ev.stopPropagation();
  const { input } = win;
  if (ev.key === 'Enter') {
    ev.preventDefault();
    if (calculateLine(input.value)) input.value = '';
    recall = -1;
  } else if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
    const typed = history().map((entry) => entry.input);
    if (!typed.length) return;
    ev.preventDefault();
    recall = ev.key === 'ArrowUp' ? Math.min(typed.length - 1, recall + 1) : recall - 1;
    input.value = recall < 0 ? '' : typed[typed.length - 1 - recall];
    recall = Math.max(-1, recall);
  } else if (ev.key === 'Escape') {
    ev.preventDefault();
    if (input.value) input.value = '';
    else hide();
  }
}

function build() {
  const close = el('button', { type: 'button', class: 'floating-window-close', 'aria-label': 'Close the calculator', title: 'Close (Shift+E)', text: '×' });
  const clear = el('button', { type: 'button', class: 'calculator-clear', title: 'Clear the results and forget ans and every name (or type clear)', text: 'Clear', onclick: clearCalculator });
  const list = el('ol', { class: 'calculator-list', 'aria-live': 'polite' });
  const empty = el('p', { class: 'field-hint calculator-empty', text: 'Type a calculation and press Enter: 20*log(123), 1/(2pi*10k*1n), R = 4.7k, ans/2. clear starts afresh.' });
  const input = el('input', { type: 'text', class: 'calculator-line', 'aria-label': 'Calculation', placeholder: 'e.g. 20*log(123)', spellcheck: 'false', autocomplete: 'off' });
  const node = el('section', { class: 'floating-window calculator-window', 'aria-labelledby': 'calculator-title', hidden: true }, [
    el('header', { class: 'floating-window-header' }, [el('h2', { id: 'calculator-title', class: 'floating-window-title', text: 'Calculator' }), clear, close]),
    el('div', { class: 'calculator-body' }, [empty, list, input]),
  ]);
  node.style.setProperty('--calculator-rows', String(SHOWN));
  input.addEventListener('keydown', onKey);
  canvasEl.closest('.canvas-pane').append(node);
  const chrome = floatingWindow(node, { key: 'calculator', onClose: hide, resizable: true });
  win = { el: node, list, empty, input, chrome };
}

function syncButton() {
  document.getElementById('btn-window-calculator')?.setAttribute('aria-pressed', String(calculatorShown()));
}

export function calculatorShown() {
  return !!win && !win.el.hidden;
}

function show() {
  if (!win) build();
  win.el.hidden = false;
  renderList();
  win.chrome.place();
  win.input.focus();
  syncButton();
}

function hide() {
  if (!win || win.el.hidden) return;
  win.el.hidden = true;
  syncButton();
  canvasEl.focus({ preventScroll: true });
}

/** Shift+E: show or hide the calculator. */
export function toggleCalculator() {
  if (calculatorShown()) hide();
  else show();
}

export function installCalculator() {
  document.getElementById('btn-window-calculator')?.addEventListener('click', toggleCalculator);
  // Each design has its own results, and the names they gave.
  onDocumentShown(() => {
    names = replayNames(history().filter((entry) => !entry.error).map((entry) => entry.input));
    recall = -1;
    if (win) win.input.value = '';
    renderList();
  });
}
