/**
 * A text field that shows what its text reads as -- V_{INN} as V with INN
 * below, $t_\text{su}$ as math -- while it is not being typed in, and its
 * source while it is: the field itself is unchanged, its rendering is laid
 * over it. A field whose text has no markup shows as it is.
 */

import { parseLabelRuns } from '../core/model.js';
import { texToMathML } from '../core/render.js';
import { element as el } from './dom.js';

/** Label markup (V_{IN}, x^{2}) as text with subscripts and superscripts;
 *  null when there is none to show. */
export function markupNode(text) {
  const runs = parseLabelRuns(String(text));
  if (!runs.some((run) => run.sub || run.super)) return null;
  const span = el('span');
  for (const run of runs) span.append(run.sub || run.super ? el(run.sub ? 'sub' : 'sup', { text: run.text }) : run.text);
  return span;
}

/** A label's text: its $math$ as math, the rest as label markup; null when
 *  there is neither. */
export function labelTextNode(text) {
  const source = String(text);
  if (!/\$[^$]+\$/.test(source)) return markupNode(source);
  const span = el('span');
  for (const part of source.split(/(\$[^$]+\$)/)) {
    if (!part) continue;
    if (/^\$[^$]+\$$/.test(part)) {
      const math = el('span', { class: 'rendered-field-math' });
      math.innerHTML = texToMathML(part.slice(1, -1)).replace('display="block"', 'display="inline"');
      span.append(math);
    } else span.append(markupNode(part) || part);
  }
  return span;
}

/** Show `input`'s text rendered by `render` (text -> node or null) while it
 *  is not focused. Follows typing and values set by code alike. Returns the
 *  field's wrapper, which takes the input's place (if it has one). */
export function renderedWhenIdle(input, render = markupNode) {
  const view = el('span', { class: 'rendered-field-view', 'aria-hidden': 'true' });
  const wrap = el('span', { class: 'rendered-field' });
  if (input.parentNode) input.replaceWith(wrap);
  wrap.append(input, view);
  const sync = () => {
    const node = input.value.trim() ? render(input.value.trim()) : null;
    view.replaceChildren(...(node ? [node] : []));
    wrap.classList.toggle('rendered', !!node);
  };
  // A value set by code (a form restored) shows too.
  const own = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  Object.defineProperty(input, 'value', {
    configurable: true,
    get() { return own.get.call(this); },
    set(value) { own.set.call(this, value); sync(); },
  });
  input.addEventListener('input', sync);
  // A press on the rendering types in the field.
  view.addEventListener('mousedown', (ev) => {
    ev.preventDefault();
    input.focus();
  });
  sync();
  return wrap;
}
