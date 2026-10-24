/**
 * The actions under a Bode graph -- magnitude over phase -- in the Plots
 * window, one row for every mode that draws one (the small-signal and the
 * switched-capacitor modes): Clear graph, Annotate graph, and with phase,
 * which puts the phase on the drawing too, as a plot of its own.
 */

import { element as el } from './dom.js';

/**
 * The row's controls. `clear()` empties the graph; `annotate({ magnitude,
 * phase })` puts the shown quantities on the drawing; `ready` whether
 * there is a graph to annotate; `state` the mode's own { phase } choice,
 * kept across redraws.
 */
export function bodeGraphActions({ clear, annotate, ready, state }) {
  return [
    el('button', { type: 'button', text: 'Clear graph', onclick: clear }),
    el('button', { type: 'button', class: 'bode-annotate-graph', text: 'Annotate', title: 'Put the graph on the drawing', disabled: !ready, onclick: () => annotate({ magnitude: true, phase: state.phase }) }),
    el('label', { class: 'bode-phase-toggle' }, [
      Object.assign(el('input', { type: 'checkbox', 'aria-label': 'Annotate the phase too' }), { checked: state.phase, onchange: (ev) => { state.phase = ev.target.checked; } }),
      ' with phase',
    ]),
  ];
}
