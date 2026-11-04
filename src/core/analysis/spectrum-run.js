/**
 * One simulated spectrum run, as the Plots window's spectrum asks it: in a
 * worker thread (web/optimize-worker.js) or, where none can start, in the
 * page. Everything it takes and gives is plain data, so it crosses to a
 * worker and back.
 */

import { Circuit } from '../model.js';
import { prepareSimulation } from './simulate.js';
import { outputSpectrum } from './spectrum.js';

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
