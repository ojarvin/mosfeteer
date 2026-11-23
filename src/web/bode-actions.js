/**
 * A Bode graph -- magnitude over phase -- in the Plots window, as every
 * mode that draws one has it (the small-signal and the
 * switched-capacitor modes): the two plots, the legend under them, and the
 * actions row: Clear graph, Annotate graph, and with phase, which puts the
 * phase on the drawing too, as a plot of its own.
 */

import { element as el } from './dom.js';
import { createPlotView, linkPlots } from './plot-view.js';
import { traceLegendRow } from './trace-hold.js';

/** A mode's magnitude and phase plots: one frequency axis, the two pan and
 *  zoom along x together, and only the lower one numbers it. */
export function bodeGraphPair() {
  const pair = {
    magnitude: createPlotView({ height: 200, aspect: 0.42, xAxis: false, className: 'bode-magnitude' }),
    phase: createPlotView({ height: 140, aspect: 0.3, className: 'bode-phase' }),
  };
  linkPlots(pair.magnitude, pair.phase);
  return pair;
}

/** Draw `specs` ({ magnitude, phase }) in `host`, the plots staying in
 *  place while they redraw (a zoomed view stays too); with none, a hint to
 *  check a trace, while there are traces. */
export function showBodeGraphs(host, pair, specs, hasTraces) {
  if (!specs) {
    host.replaceChildren(el('p', { class: 'field-hint', text: hasTraces ? 'Check a trace below to plot it.' : '' }));
    return;
  }
  if (pair.magnitude.el.parentNode !== host) host.replaceChildren(pair.magnitude.el, pair.phase.el);
  pair.magnitude.set(specs.magnitude);
  pair.phase.set(specs.phase);
}

/**
 * The row's controls. `clear()` empties the graph; `annotate({ magnitude,
 * phase })` puts the shown quantities on the drawing; `ready` whether
 * there is a graph to annotate; `state` the mode's own { phase } choice,
 * kept across redraws, and { asymptotes } where its sketches have them.
 */
function bodeGraphActions({ clear, annotate, ready, state }) {
  return [
    el('button', { type: 'button', text: 'Clear graph', onclick: clear }),
    el('button', { type: 'button', class: 'bode-annotate-graph', text: 'Annotate', title: 'Put the graph on the drawing', disabled: !ready, onclick: () => annotate({ magnitude: true, phase: state.phase }) }),
    el('label', { class: 'bode-phase-toggle' }, [
      Object.assign(el('input', { type: 'checkbox', 'aria-label': 'Annotate the phase too' }), { checked: state.phase, onchange: (ev) => { state.phase = ev.target.checked; } }),
      ' with phase',
    ]),
    // A mode whose sketches have straight-line asymptotes shows them or not.
    ...('asymptotes' in state ? [el('label', { class: 'bode-asymptote-toggle' }, [
      Object.assign(el('input', { type: 'checkbox', 'aria-label': 'Asymptotes' }), { checked: state.asymptotes, onchange: (ev) => { state.asymptotes = ev.target.checked; } }),
      ' Asymptotes',
    ])] : []),
  ];
}

/**
 * Under the graph: a legend row per trace of `traces` (named by
 * `label(trace)`; `hold(trace)` holds one; `redraw()` after one is shown or
 * hidden), then the actions, hidden with no traces. `setTraces(list)` takes
 * the mode's traces to `list` and redraws; Clear graph also drops the held
 * records (`holds`, `holdsChanged`).
 */
export function bodeGraphFooter({ legend, actions, traces, label, holds, holdsChanged, hold, redraw, setTraces, annotate, ready, state }) {
  legend.replaceChildren(...traces.map((trace) => traceLegendRow(trace, {
    label: label(trace), holds, holdsChanged,
    onHold: () => hold(trace),
    onShow: redraw,
    onRemove: () => setTraces(traces.filter((t) => t !== trace)),
  })));
  actions.hidden = !traces.length;
  actions.replaceChildren(...bodeGraphActions({
    clear: () => { holdsChanged([]); setTraces([]); },
    annotate,
    ready,
    state,
  }));
}
