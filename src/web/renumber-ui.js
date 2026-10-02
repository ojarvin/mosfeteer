/**
 * Renumber parts (More menu, `:renumber`): pick the corner the numbers grow
 * from, and the automatically named parts (M1, R2, ...) are numbered along
 * that diagonal (core/renumber.js). With parts selected, only they are
 * renumbered, among the numbers they already hold. One undo entry.
 */

import { RENUMBER_DIRECTIONS, renumberParts } from '../core/renumber.js';
import { editor } from './editor-state.js';
import { logLine } from './status-bar-ui.js';
import { canvasEl } from './elements.js';
import { commit, render, selectedComps, setSelection } from './main.js';

export function openRenumberDialog() {
  const selected = selectedComps().map((c) => c.refdes);
  const make = (tag, props = {}, children = []) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else node.setAttribute(key, value);
    }
    node.append(...children);
    return node;
  };
  const dialog = make('dialog', { class: 'confirm-dialog renumber-dialog', 'aria-label': 'Renumber parts' });
  const choose = (direction) => {
    dialog.close();
    let renames = [];
    commit(() => { renames = renumberParts(editor.circuit, { direction, refs: selected.length ? selected : null }); });
    const step = RENUMBER_DIRECTIONS[direction];
    if (!renames.length) {
      logLine(`already numbered ${step.arrow} ${step.text}`);
      return;
    }
    const to = new Map(renames.map(({ from, to: name }) => [from, name]));
    if (selected.length) setSelection(selected.map((ref) => to.get(ref) || ref));
    logLine(`renumbered ${step.arrow} ${step.text}: ${renames.map(({ from, to: name }) => `${from}→${name}`).join(', ')}`);
    render();
  };
  // The arrows stand in the corners they start from.
  const grid = make('div', { class: 'renumber-grid', role: 'group', 'aria-label': 'Numbers grow from' },
    ['se', 'sw', 'ne', 'nw'].map((direction) => {
      const { arrow, text } = RENUMBER_DIRECTIONS[direction];
      const button = make('button', { type: 'button', title: `Number ${text}`, 'aria-label': `Number ${text}` }, [
        make('span', { class: 'renumber-arrow', text: arrow, 'aria-hidden': 'true' }), make('span', { text }),
      ]);
      button.addEventListener('click', () => choose(direction));
      return button;
    }));
  dialog.append(
    make('h2', { text: 'Renumber parts' }),
    make('p', {
      text: selected.length
        ? `The ${selected.length} selected parts that are named automatically (M1, R2, …) trade the numbers they hold, growing from the corner picked.`
        : 'Parts named automatically (M1, R2, …) are numbered again, each letter on its own, growing from the corner picked. Parts named by hand keep their names.',
    }),
    grid,
    make('div', { class: 'dialog-actions' }, [make('button', { type: 'button', value: 'cancel', text: 'Cancel' })]),
  );
  dialog.querySelector('[value="cancel"]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('keydown', (event) => event.stopPropagation());
  dialog.addEventListener('close', () => {
    dialog.remove();
    canvasEl.focus({ preventScroll: true });
  }, { once: true });
  document.body.append(dialog);
  dialog.showModal();
  grid.querySelector('button')?.focus();
}

export function installRenumberUi() {
  document.getElementById('btn-renumber')?.addEventListener('click', openRenumberDialog);
}
