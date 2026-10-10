/**
 * The nets a plot shows, picked: a checkbox per net with its colour and its
 * name as math, in columns that wrap. Every row stays in view (the window
 * scrolls, the list never on its own). The swing and the time-domain plots
 * use it.
 */

import { texToMathML } from '../core/render.js';
import { element as el } from './dom.js';

/** `items`: `{ key, label (TeX), color, checked, title? }`; `onToggle(key,
 *  checked)` when one is ticked or cleared. */
export function netPicker(items, onToggle) {
  return el('div', { class: 'net-picker' }, items.map((item) => {
    const check = el('input', { type: 'checkbox', 'aria-label': `Show ${item.label}` });
    check.checked = !!item.checked;
    check.addEventListener('change', () => onToggle(item.key, check.checked));
    const name = el('span', { class: 'net-pick-name' });
    name.innerHTML = texToMathML(item.label);
    if (item.checked && item.color) name.style.color = item.color;
    // The swatch keeps its place unticked, so the names line up.
    const swatch = el('span', { class: 'net-pick-swatch', style: item.checked && item.color ? `background:${item.color}` : '' });
    return el('label', { class: 'net-pick', title: item.title || '' }, [check, swatch, name]);
  }));
}
