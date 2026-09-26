/**
 * The open document's tags, in the side panel: a text field of
 * space-separated words. Enter or leaving the field sets them (one undo
 * entry, saved with the document); Escape puts the field back. The Atlas
 * finds designs by them (`#tag`); docs/atlas.md.
 */

import { parseTags, tagsText } from '../core/design-index.js';
import { canvasEl } from './elements.js';
import { editor } from './editor-state.js';
import { logLine } from './status-bar-ui.js';
import { commit, render } from './main.js';

const fieldEl = document.getElementById('panel-tags');

/** Set the open document's tags from typed text; returns whether they changed. */
export function setDocumentTags(text) {
  const next = parseTags(text);
  if (tagsText(next) === tagsText(editor.circuit.tags)) return false;
  commit(() => { editor.circuit.tags = next; });
  logLine(next.length ? `tags: ${next.map((tag) => `#${tag}`).join(' ')}` : 'tags cleared');
  return true;
}

/** Show the document's tags, unless they are being typed. */
export function renderTagsField() {
  if (!fieldEl || document.activeElement === fieldEl) return;
  const text = tagsText(editor.circuit.tags);
  if (fieldEl.value !== text) fieldEl.value = text;
}

export function installTagsField() {
  if (!fieldEl) return;
  let cancelled = false;
  fieldEl.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') {
      ev.preventDefault();
      canvasEl.focus({ preventScroll: true });
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      cancelled = true;
      fieldEl.value = tagsText(editor.circuit.tags);
      canvasEl.focus({ preventScroll: true });
    }
  });
  fieldEl.addEventListener('blur', () => {
    if (!cancelled) setDocumentTags(fieldEl.value);
    cancelled = false;
    fieldEl.value = tagsText(editor.circuit.tags);
    render();
  });
}
