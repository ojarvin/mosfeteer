/**
 * A worker thread for the coefficient optimizer (optimize-ui.js) and the
 * simulated spectrum (signal-flow-ui.js), so the editor stays responsive
 * while they run. For the optimizer it rebuilds the diagram from its JSON,
 * prepares the objective once (core/analysis/optimize.js), and scores each
 * batch of coefficient numbers it is sent (the quick test, or the long one
 * for `{ verify }`). For `spectrum` it simulates the diagram once and takes
 * its output's spectrum (core/analysis/spectrum-run.js).
 */

import { Circuit } from '../core/model.js';
import { prepareObjective, scoreRequest } from '../core/analysis/optimize.js';
import { simulatedSpectrum } from '../core/analysis/spectrum-run.js';

let objective = null;

self.addEventListener('message', ({ data }) => {
  if (data.type === 'init') {
    try {
      objective = prepareObjective(Circuit.fromJSON(data.circuit), data.problem);
      self.postMessage({ type: 'ready', ok: objective.ok, error: objective.error || null });
    } catch (error) {
      objective = null;
      self.postMessage({ type: 'ready', ok: false, error: error.message });
    }
  } else if (data.type === 'evaluate') {
    const scores = data.batch.map((request) => {
      try {
        return scoreRequest(objective, request);
      } catch (error) {
        return { violation: 1000, goal: 0, error: error.message };
      }
    });
    self.postMessage({ type: 'scores', id: data.id, scores });
  } else if (data.type === 'spectrum') {
    self.postMessage({ type: 'spectrum', id: data.id, ...simulatedSpectrum(data) });
  }
});
