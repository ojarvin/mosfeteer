/**
 * One simulated spectrum run, as the Plots window's spectrum asks it, and
 * one point of its sweep: in a worker thread (web/optimize-worker.js) or,
 * where none can start, in the page. Everything it takes and gives is plain data, so it crosses to a
 * worker and back.
 */

import { Circuit } from '../model.js';
import { prepareSimulation } from './simulate.js';
import { inBand, outputSpectrum } from './spectrum.js';

/** One run of `options` (prepareSimulation's) at `amplitude` dBFS, and its
 *  output's spectrum in segments of `segment`: `{ raw, quantizers,
 *  fullScale, frequency }`, or `{ error }`, or `{ overloaded }`. */
export function simulatedSpectrum({ circuit, options, amplitude, segment }) {
  try {
    const sim = prepareSimulation(Circuit.fromJSON(circuit), options);
    if (!sim.ok) return { error: sim.error };
    const run = sim.run(amplitude, { record: true });
    if (run.overloaded || !run.samples) return { overloaded: !!run.overloaded, fullScale: sim.fullScale, frequency: sim.frequency };
    return { raw: outputSpectrum(run.samples, { segment, variance: 1 / 3 }), quantizers: run.quantizers, fullScale: sim.fullScale, frequency: sim.frequency };
  } catch (error) {
    return { error: error.message };
  }
}

/** The signals a sweep's runs measure the peaks of (`{ key, name, role }`),
 *  without running: `[]` when the diagram does not simulate. */
export function simulationSignals({ circuit, options }) {
  try {
    const sim = prepareSimulation(circuit instanceof Circuit ? circuit : Circuit.fromJSON(circuit), options);
    return sim.ok ? sim.signals.map(({ key, name, role }) => ({ key, name, role })) : [];
  } catch {
    return [];
  }
}

/**
 * One point of a sweep: a run of `options` at `amplitude` dBFS, measured.
 * Returns `{ signals, fullScale, measures }`, `measures` by key -- `sndr`
 * and `noise` (dBFS) in the band `edges`, `tone` (the output's amplitude at
 * the input frequency, dBFS), and `peak:<signal key>` (each net's peak,
 * dBFS) -- each a number or null; `{ overloaded }` when the loop ran away;
 * or `{ error }`.
 */
export function simulatedMeasures({ circuit, options, amplitude, segment, edges = [] }) {
  try {
    const sim = prepareSimulation(Circuit.fromJSON(circuit), options);
    if (!sim.ok) return { error: sim.error };
    const signals = sim.signals.map(({ key, name, role }) => ({ key, name, role }));
    const run = sim.run(amplitude, { record: true });
    if (run.overloaded || !run.samples) return { overloaded: true, signals, fullScale: sim.fullScale };
    const db = (value) => (value > 0 ? 20 * Math.log10(value / sim.fullScale) : null);
    const raw = outputSpectrum(run.samples, { segment, variance: 1 / 3 });
    const band = edges.length ? inBand(raw, sim.frequency, edges, { fullScale: sim.fullScale }) : null;
    const measures = {
      sndr: band?.sndr ?? null,
      noise: band?.noiseDb ?? null,
      tone: db(run.tone),
      ...Object.fromEntries(sim.signals.map((signal, i) => [`peak:${signal.key}`, db(run.peaks[i])])),
    };
    return { signals, fullScale: sim.fullScale, measures };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * A sweep plot's y axis and trace names. `measures` `[{ name, unit }]`
 * (TeX, the unit plain), `runs` `[{ notes, held }]`: each run's notes (TeX,
 * what it ran at that names it) and whether it is a held one. Measures of
 * one unit put it on the axis; one measure puts its name there too, and
 * its traces are named by their notes. Returns `{ y, labels }` (TeX),
 * `labels` a row of names per run.
 */
export function sweepLabels(measures, runs) {
  const unit = new Set(measures.map((m) => m.unit)).size === 1 ? measures[0]?.unit : null;
  const full = (m) => `${m.name}\\text{ (${m.unit})}`;
  const y = !unit ? 'dB' : measures.length === 1 ? full(measures[0]) : unit;
  const labels = runs.map(({ notes = [], held = false }) => measures.map((m) => {
    const head = unit && measures.length === 1 && notes.length ? [] : [unit ? m.name : full(m)];
    const label = [...head, ...notes].join(',\\ ');
    return held && !notes.length ? `${label}\\ \\text{(held)}` : label;
  }));
  return { y, labels };
}

/** The values a sweep runs: `points` from `from` to `to`, evenly spaced, or
 *  on `log` evenly in ratio (from and to of one sign, not zero). */
export function sweepValues(from, to, points, log = false) {
  const n = Math.max(2, Math.round(points));
  if (log && !(from * to > 0)) return [];
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return log ? Math.sign(from) * Math.exp(Math.log(Math.abs(from)) + t * (Math.log(Math.abs(to)) - Math.log(Math.abs(from)))) : from + t * (to - from);
  });
}
