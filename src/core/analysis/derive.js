/**
 * The small-signal analysis as the analysis window derives it: the form's
 * options (options.js), each transistor's own overrides, the noise request,
 * and the loop gain, through one exact solve (engine.js) and the report
 * adapter. The window and `analyze equations` both derive through here, so
 * the same form gives the same equations.
 */

import { analyzeSmallSignalV2 } from './engine.js';
import { adaptCombinedReport } from './report-adapter.js';
import { analysisDeviceOptions, analysisNoiseRequest, normalizeAnalysisOptions } from './options.js';

/**
 * The engine request for `form`: { input, output, acGrounds: [name],
 * loopElement, options } with `options` as the window's
 * (normalizeAnalysisOptions; deviceRegions among them). `sketchRatios`: a
 * loop gain's sketch values. Returns { request, formOptions, devices }.
 */
export function smallSignalRequest(circuit, { input, output, acGrounds = [], loopElement = '', options = {}, sketchRatios = {} } = {}) {
  const formOptions = normalizeAnalysisOptions(options);
  const devices = analysisDeviceOptions(circuit);
  const noise = analysisNoiseRequest(formOptions);
  const request = {
    ...formOptions,
    ...(noise ? { noise } : {}),
    ...(loopElement ? { loopGain: { at: loopElement }, sketchRatios } : {}),
    ...(Object.keys(devices).length ? { devices } : {}),
    input,
    output,
    acGrounds,
  };
  return { request, formOptions, devices };
}

/** The combined report for `form` (smallSignalRequest), `analysisOptions`
 *  the options it was derived with. */
export function deriveSmallSignal(circuit, form = {}) {
  const { request, formOptions, devices } = smallSignalRequest(circuit, form);
  const report = adaptCombinedReport(analyzeSmallSignalV2(circuit, request), { nameSubexpressions: formOptions.nameSubexpressions });
  report.analysisOptions = {
    ...formOptions,
    devices,
    dominantPoleApplied: formOptions.dominantPole && report.assumptions?.includes('dominant-pole approximation'),
  };
  return report;
}
