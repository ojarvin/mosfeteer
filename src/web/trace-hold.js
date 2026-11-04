/**
 * Held traces, as every analysis graph keeps them (the signal-flow, the
 * switched-cap, and the small-signal Bode graphs): a legend row's Hold puts
 * a copy of its trace on the graph at the numbers now, which the sliders
 * leave as it is. Each graph keeps its own copies, saved with the design;
 * this is where they are kept, their name, and their button.
 */

import { element as el } from './dom.js';
import { editor } from './editor-state.js';
import { markSettingsChanged } from './main.js';

/** An analysis's held traces as the design keeps them (`Circuit#windows.holds`,
 *  window-state.js): records, remade into traces as a Derive brings back
 *  the trace each was held from. */
export function savedHolds(mode) {
  return editor.circuit.windows.holds?.[mode] || [];
}

/** Keep `records` as an analysis's held traces. */
export function saveHolds(mode, records) {
  const holds = { ...(editor.circuit.windows.holds || {}) };
  if (records.length) holds[mode] = records;
  else delete holds[mode];
  editor.circuit.windows.holds = holds;
  markSettingsChanged();
}

/** A new held trace's key, unlike any saved before. */
export const holdKey = () => `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** A number as a held trace's name gives it: four digits. */
export const heldNumber = (value) => String(Number(Number(value).toPrecision(4)));

/** The numbers a trace was held at (`held`, by name) that differ from the
 *  sliders' now (`current(name)`), each as `tex(name) = format(value)`. */
export function differing(held, current, { tex = (name) => name, format = (_, value) => heldNumber(value) } = {}) {
  return Object.entries(held || {})
    .filter(([name, value]) => Math.abs(value - current(name)) > 1e-12 * Math.max(1, Math.abs(value)))
    .map(([name, value]) => `${tex(name)} = ${format(name, value)}`);
}

/** The names among a held trace's numbers (`held`) that differ from the
 *  sliders' now. */
export function differingNames(held, current) {
  return Object.entries(held || {}).filter(([name, value]) => Math.abs(value - current(name)) > 1e-12 * Math.max(1, Math.abs(value))).map(([name]) => name);
}

/** A live trace's name beside its held copies: its own, then its numbers
 *  now for the names its copies give (`names`), so each curve reads at
 *  what it was drawn. */
export function liveName(base, names, current, { tex = (name) => name, format = (_, value) => heldNumber(value) } = {}) {
  const notes = [...new Set(names)].map((name) => `${tex(name)} = ${format(name, current(name))}`);
  return notes.length ? `${base},\\ ${notes.join(',\\ ')}` : base;
}

/** A held trace's name: its own (TeX), then what differs (`a_r = 0.01`),
 *  or "held" while nothing does. */
export function heldName(base, notes) {
  return notes.length ? `${base},\\ ${notes.join(',\\ ')}` : `${base}\\ \\text{(held)}`;
}

/** A legend row's Hold button. */
export function holdButton(onHold, label = 'Hold this trace') {
  return el('button', { type: 'button', class: 'signal-flow-legend-hold', 'aria-label': label, title: 'Hold', text: 'Hold', onclick: onHold });
}

/** A legend row's Hold (for a live trace) and ×, at the row's end. */
export function legendActions(hold, remove) {
  return el('span', { class: 'signal-flow-legend-actions' }, [...(hold ? [hold] : []), remove]);
}
