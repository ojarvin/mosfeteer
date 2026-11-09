import { texToMathML } from '../core/render.js';

/**
 * A DOM element in one call: `props` sets `class`, `text`, `html`, `on…`
 * listeners, and attributes (true as a bare attribute; false, null, and
 * undefined left off), and `children` are appended.
 */
export function element(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value !== undefined && value !== null && value !== false) node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children);
  return node;
}

/**
 * Apply a text field when it is done with: Enter, or focus leaving it
 * changed -- never while it is being typed in. `apply(text)` hears each
 * new value once; Enter applies the field only, so it stops there.
 */
export function onFieldCommit(input, apply) {
  let applied = input.value;
  // Typed since the last commit: a value set from elsewhere since (by a
  // slider) and typed back to the one last applied applies too.
  let edited = false;
  const commit = () => {
    if (!edited && input.value === applied) return;
    edited = false;
    applied = input.value;
    apply(input.value);
  };
  input.addEventListener('input', () => { edited = true; });
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    ev.stopPropagation();
    commit();
  });
}

/** TeX as MathML in a span of `className`, inline or (`display`) on a line of its own. */
export function mathSpan(tex, className, display = false) {
  const span = element('span', { class: `${className}${display ? ' display' : ''}` });
  const markup = texToMathML(tex);
  span.innerHTML = display ? markup : markup.replace('display="block"', 'display="inline"');
  return span;
}

// Writes for what render() keeps up to date: it runs on every pointer
// frame, and a write of the same value still restyles or wakes observers.
export function setAttr(el, name, value) {
  if (el && el.getAttribute(name) !== value) el.setAttribute(name, value);
}

export function setText(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}

export function setHidden(el, hidden) {
  if (el && el.hidden !== hidden) el.hidden = hidden;
}

export function setClassName(el, name) {
  if (el && el.className !== name) el.className = name;
}

/** One named setting in a settings grid (.signal-flow-swing-controls): its
 *  name in the names' column, then its control and, as text, its unit. An
 *  empty name lines a button up under the controls. */
export function controlPair(name, ...controls) {
  return element('div', { class: 'control-pair' }, [
    element('label', { text: name }),
    element('div', { class: 'control-value' }, controls.map((control) => (typeof control === 'string' ? element('span', { class: 'control-unit', text: control }) : control))),
  ]);
}
