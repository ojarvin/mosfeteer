/**
 * A value as the analysis windows set one: its symbol, a slider stepping
 * through E24 values (log scale), and a field to type any positive number.
 * The small-signal analysis's Values (bode-ui.js) and the switched-capacitor
 * mode's capacitances (switched-cap-ui.js) are rows of these; the
 * signal-flow coefficients are the same row with links and fractions.
 */

import { texToMathML } from '../core/render.js';
import { indexE24, stepE24 } from './e-series.js';
import { element as el, onFieldCommit } from './dom.js';

/**
 * `onValue(number)` hears every change: the slider as it slides, a typed
 * value once entered (Enter, or leaving the field). `onSlide(true)` and
 * `onSlide(false)` the slider taken and let go. `min`/`max` are the
 * slider's E24 steps (e-series.js PER_DECADE a decade).
 */
export function valueRow({ name, tex, value, min, max, onValue, onSlide = () => {}, title = '', className = '' }) {
  const label = el('span', { class: 'signal-flow-coefficient-name' });
  label.innerHTML = texToMathML(tex);
  const slider = el('input', { type: 'range', min: String(min), max: String(max), step: '1', 'aria-label': `${name}: slide to change` });
  slider.value = String(indexE24(value));
  const field = el('input', { type: 'text', class: 'signal-flow-coefficient-value', 'aria-label': `${name}: value`, title: 'A positive number', value: String(Number(value.toPrecision(4))) });
  const row = el('div', { class: `signal-flow-coefficient${className ? ` ${className}` : ''}`, 'data-name': name, ...(title ? { title } : {}) }, [label, slider, field]);
  slider.addEventListener('input', () => {
    onSlide(true);
    const next = stepE24(Number(slider.value));
    field.value = String(next);
    field.classList.remove('invalid');
    onValue(next);
  });
  slider.addEventListener('change', () => onSlide(false));
  onFieldCommit(field, (text) => {
    const number = Number(text.trim());
    const valid = text.trim() !== '' && Number.isFinite(number) && number > 0;
    field.classList.toggle('invalid', !valid);
    if (!valid) return;
    slider.value = String(indexE24(number));
    onValue(number);
  });
  return row;
}
