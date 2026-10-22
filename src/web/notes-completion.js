/**
 * Completion in the notes' source (notes-window.js): after `[[` the
 * workspace's designs, after `@` the design's parts and nets
 * (`noteCompletion`, core/notes.js), listed at the caret. Up/Down choose,
 * Enter or Tab puts the choice in, Esc closes the list; typing on narrows it.
 */

import { noteCompletion } from '../core/notes.js';
import { element as el } from './dom.js';

/** Where the caret of `field` is, in pixels from the field's top-left
 *  (scrolling included): a hidden copy of the text up to the caret. */
function caretPoint(field, index) {
  const style = getComputedStyle(field);
  const mirror = el('div');
  for (const key of ['boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'tabSize', 'textTransform', 'wordSpacing']) mirror.style[key] = style[key];
  Object.assign(mirror.style, { position: 'absolute', visibility: 'hidden', top: '0', left: '-9999px', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', overflow: 'hidden' });
  mirror.textContent = field.value.slice(0, index);
  const mark = el('span', { text: '​' });
  mirror.append(mark);
  document.body.append(mirror);
  const point = { x: mark.offsetLeft, y: mark.offsetTop + mark.offsetHeight };
  mirror.remove();
  return { x: point.x - field.scrollLeft, y: point.y - field.scrollTop };
}

/**
 * Complete in `field`; `names()` gives `{ designs, parts, nets }` as they
 * are now. The list goes in the field's parent, which is positioned.
 */
export function attachNoteCompletion(field, names) {
  const list = el('ul', { class: 'notes-suggestions', id: 'notes-suggestions', role: 'listbox', 'aria-label': 'Completions', hidden: true });
  field.parentElement.append(list);
  field.setAttribute('aria-autocomplete', 'list');
  field.setAttribute('aria-controls', list.id);
  let found = null;
  let active = 0;

  const close = () => {
    found = null;
    list.hidden = true;
    field.setAttribute('aria-expanded', 'false');
    field.removeAttribute('aria-activedescendant');
  };

  const show = () => {
    list.replaceChildren(...found.items.map((item, index) => {
      const row = el('li', { role: 'option', id: `notes-suggestion-${index}`, 'aria-selected': String(index === active) }, [
        el('span', { class: 'notes-suggestion-name', text: item.name }),
        el('span', { class: 'notes-suggestion-detail', text: item.detail }),
      ]);
      // A press would leave the field and close the list first.
      row.addEventListener('pointerdown', (ev) => ev.preventDefault());
      row.addEventListener('click', () => accept(index));
      return row;
    }));
    list.hidden = false;
    const at = caretPoint(field, found.start);
    list.style.left = `${Math.max(0, Math.min(field.offsetLeft + at.x, field.offsetLeft + field.clientWidth - list.offsetWidth))}px`;
    list.style.top = `${field.offsetTop + Math.min(at.y, field.clientHeight)}px`;
    field.setAttribute('aria-expanded', 'true');
    field.setAttribute('aria-activedescendant', `notes-suggestion-${active}`);
  };

  const update = () => {
    const caret = field.selectionStart;
    const next = document.activeElement === field && caret === field.selectionEnd ? noteCompletion(field.value, caret, names()) : null;
    if (!next) { close(); return; }
    // The same kind still being typed keeps its choice where it can.
    const keep = found && found.start === next.start ? found.items[active]?.name : null;
    found = next;
    active = Math.max(0, found.items.findIndex((item) => item.name === keep));
    show();
  };

  const accept = (index) => {
    const item = found?.items[index];
    if (!item) return;
    const { start, end } = found;
    close();
    field.focus();
    field.setSelectionRange(start, end);
    // insertText keeps the field's own undo (Ctrl+Z) working.
    if (!document.execCommand?.('insertText', false, item.insert)) {
      field.setRangeText(item.insert, start, end, 'end');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
    // What was put in is complete: no list until the next keys.
    close();
  };

  field.addEventListener('keydown', (ev) => {
    if (!found || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const step = { ArrowDown: 1, ArrowUp: -1 }[ev.key];
    if (step) {
      active = (active + step + found.items.length) % found.items.length;
      show();
    } else if ((ev.key === 'Enter' || ev.key === 'Tab') && !ev.shiftKey) {
      accept(active);
    } else if (ev.key === 'Escape') {
      close();
    } else {
      return;
    }
    // Before the field's own keys: Tab indents, Esc finishes editing.
    ev.preventDefault();
    ev.stopImmediatePropagation();
  });
  field.addEventListener('input', update);
  field.addEventListener('click', update);
  field.addEventListener('keyup', (ev) => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key)) update();
  });
  field.addEventListener('scroll', () => { if (found) show(); });
  field.addEventListener('blur', close);
  return { close };
}
