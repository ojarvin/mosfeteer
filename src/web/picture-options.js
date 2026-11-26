/**
 * A picture on the drawing's options (a double-click on it): its name, by
 * which the notes place it as a figure (`![[name]]`) and refer to it
 * (`[[#name]]`, report.js namePicture).
 */

import { element as el } from './dom.js';
import { editor } from './editor-state.js';
import { commit, render } from './main.js';
import { pictureName } from '../core/model.js';
import { namePicture, resolveReportTarget } from '../core/report.js';

/** Open the options of the picture `label` (a box with an image). */
export function openPictureOptions(label) {
  if (label?.kind !== 'box' || !label.image) return;
  document.getElementById('picture-dialog')?.remove();
  const input = el('input', { id: 'picture-name', type: 'text', value: label.image.name || '', placeholder: 'No name', spellcheck: 'false', autocomplete: 'off' });
  const embed = el('code', { id: 'picture-embed' });
  const error = el('p', { class: 'page-guide-error', role: 'alert' });
  const dialog = el('dialog', { id: 'picture-dialog', class: 'confirm-dialog picture-dialog', 'aria-labelledby': 'picture-dialog-title' }, [
    el('form', { method: 'dialog' }, [
      el('h2', { id: 'picture-dialog-title', text: 'Picture' }),
      el('label', { class: 'picture-field', for: 'picture-name' }, [el('span', { text: 'Name' }), input]),
      el('p', { class: 'field-hint' }, ['In the notes: ', embed]),
      error,
      el('div', { class: 'dialog-actions' }, [
        el('button', { value: 'cancel', formnovalidate: true, text: 'Cancel' }),
        el('button', { id: 'picture-submit', value: 'save', class: 'confirm-action', text: 'OK' }),
      ]),
    ]),
  ]);
  const show = () => {
    const name = pictureName(input.value);
    embed.textContent = name ? `![[${name}]]` : '(no name: not placed)';
    error.textContent = '';
  };
  input.addEventListener('input', show);
  // Enter is OK (the form's first button is Cancel).
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    dialog.querySelector('form').requestSubmit(dialog.querySelector('#picture-submit'));
  });
  dialog.addEventListener('keydown', (event) => event.stopPropagation());
  dialog.querySelector('form').addEventListener('submit', (event) => {
    if (event.submitter?.value !== 'save') return;
    event.preventDefault();
    const name = pictureName(input.value);
    const taken = name ? resolveReportTarget(editor.circuit, name) : null;
    if (taken && taken.label?.id !== label.id) {
      error.textContent = `The name "${name}" is taken.`;
      return;
    }
    commit(() => namePicture(editor.circuit, label.id, name));
    dialog.close();
    render();
  });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  show();
  document.body.append(dialog);
  dialog.showModal();
  input.focus();
  input.select();
}
