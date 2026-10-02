/**
 * The open document's tags, in a popover from the # by its name: a text
 * field of space-separated words. Enter or leaving the field sets them (one
 * undo entry, saved with the document); Escape puts the field back. The #
 * shows how many there are. The Atlas finds designs by them (`#tag`);
 * docs/atlas.md.
 */

import { parseTags, tagsText } from '../core/design-index.js';
import { canvasEl } from './elements.js';
import { editor } from './editor-state.js';
import { logLine } from './status-bar-ui.js';
import { commit, render } from './main.js';

const fieldEl = document.getElementById('panel-tags');
const buttonEl = document.getElementById('btn-tags');
const popEl = document.getElementById('tags-pop');

function setOpen(open) {
  if (!popEl || popEl.hidden === !open) return;
  popEl.hidden = !open;
  buttonEl?.setAttribute('aria-expanded', String(open));
  if (open) {
    fieldEl.focus();
    fieldEl.select();
  }
}

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
  const text = tagsText(editor.circuit.tags);
  if (buttonEl) {
    const count = editor.circuit.tags?.length || 0;
    const label = count ? `# ${count}` : '#';
    if (buttonEl.textContent !== label) {
      buttonEl.textContent = label;
      buttonEl.classList.toggle('has-tags', count > 0);
      buttonEl.title = count
        ? `Tags: ${editor.circuit.tags.map((tag) => `#${tag}`).join(' ')} (the Atlas finds designs by them)`
        : "This document's tags: find designs by them in the Atlas (#tag)";
    }
  }
  if (!fieldEl || document.activeElement === fieldEl) return;
  if (fieldEl.value !== text) fieldEl.value = text;
}

export function installTagsField() {
  if (!fieldEl) return;
  let cancelled = false;
  fieldEl.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') {
      ev.preventDefault();
      setOpen(false);
      canvasEl.focus({ preventScroll: true });
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      cancelled = true;
      fieldEl.value = tagsText(editor.circuit.tags);
      setOpen(false);
      canvasEl.focus({ preventScroll: true });
    }
  });
  buttonEl?.addEventListener('click', () => setOpen(popEl.hidden));
  window.addEventListener('pointerdown', (ev) => {
    if (!popEl?.hidden && !popEl.contains(ev.target) && !buttonEl.contains(ev.target)) setOpen(false);
  }, true);
  fieldEl.addEventListener('blur', () => {
    if (!cancelled) setDocumentTags(fieldEl.value);
    cancelled = false;
    fieldEl.value = tagsText(editor.circuit.tags);
    render();
  });
}
