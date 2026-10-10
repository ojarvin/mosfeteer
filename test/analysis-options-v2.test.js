import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANALYSIS_OPTION_DEFAULTS,
  analysisNoiseRequest,
  analysisOptionDefaults,
  normalizeAnalysisOptions,
  readAnalysisFormState,
} from '../src/web/analysis-options.js';

test('defaults select the concise textbook presentation', () => {
  assert.deepEqual(analysisOptionDefaults(), {
    neglectBodyEffect: true,
    neglectChannelLengthModulation: false,
    millerApproximation: true,
    parasitics: false,
    highIntrinsicGain: true,
    dominantPole: false,
    nameSubexpressions: true,
    transferFunctions: ['Av'],
    noiseThermal: false,
    noiseFlicker: false,
    noiseOutput: false,
    noiseSources: null,
  });
  assert.notEqual(analysisOptionDefaults(), ANALYSIS_OPTION_DEFAULTS);
});

test('normalization accepts only canonical option names and device regions', () => {
  assert.deepEqual(normalizeAnalysisOptions({
    neglectBodyEffect: false,
    highIntrinsicGain: false,
    neglectChannelLengthModulation: false,
    dominantPole: true,
    transferFunctions: ['Av'],
    ignoreBodyEffect: true,
    millerApproximation: false,
    cascodeReduction: true,
    dcOnly: true,
    context: 'obsolete',
    deviceOverrides: { M1: { model: 'triode', highIntrinsicGain: false } },
    deviceRegions: { M2: { region: 'triode' }, M3: { region: 'saturation' } },
  }), {
    neglectBodyEffect: false,
    highIntrinsicGain: false,
    neglectChannelLengthModulation: false,
    millerApproximation: false,
    parasitics: false,
    dominantPole: true,
    nameSubexpressions: true,
    transferFunctions: ['Av'],
    noiseThermal: false,
    noiseFlicker: false,
    noiseOutput: false,
    noiseSources: null,
    deviceRegions: { M2: { region: 'triode' } },
  });
});

test('channel-length omission supersedes high intrinsic gain', () => {
  assert.deepEqual(normalizeAnalysisOptions({
    highIntrinsicGain: true,
    neglectChannelLengthModulation: true,
  }), {
    neglectBodyEffect: true,
    highIntrinsicGain: false,
    neglectChannelLengthModulation: true,
    millerApproximation: true,
    parasitics: false,
    dominantPole: false,
    nameSubexpressions: true,
    transferFunctions: ['Av'],
    noiseThermal: false,
    noiseFlicker: false,
    noiseOutput: false,
    noiseSources: null,
  });
});

test('canonical nested form state remains canonical during normalization', () => {
  assert.deepEqual(normalizeAnalysisOptions({
    options: {
      neglectBodyEffect: false,
      deviceRegions: { M1: { region: 'triode' } },
      millerApproximation: true,
    },
  }), {
    neglectBodyEffect: false,
    highIntrinsicGain: true,
    neglectChannelLengthModulation: false,
    millerApproximation: true,
    parasitics: false,
    dominantPole: false,
    nameSubexpressions: true,
    transferFunctions: ['Av'],
    noiseThermal: false,
    noiseFlicker: false,
    noiseOutput: false,
    noiseSources: null,
    deviceRegions: { M1: { region: 'triode' } },
  });
});

test('a saved form reads back normalized, its canonical fields only', () => {
  const saved = {
    input: ' N1 ',
    output: 'N2',
    acGrounds: 'VBN, VCASCN, VBN',
    deviceRegions: new Map([['M1', { region: 'triode', ignored: 'metadata' }], ['M2', { region: 'saturation' }]]),
    options: { neglectBodyEffect: false, dominantPole: true, ignoreRo: true },
    approximationOptions: { ignoreRo: true },
  };
  const before = structuredClone(saved);
  const state = readAnalysisFormState(saved);
  assert.deepEqual(saved, before);
  assert.deepEqual(state, {
    input: 'N1',
    output: 'N2',
    acGrounds: 'VBN, VCASCN',
    deviceRegions: { M1: { region: 'triode' } },
    options: {
      neglectBodyEffect: false,
      highIntrinsicGain: true,
      neglectChannelLengthModulation: false,
      millerApproximation: true,
      parasitics: false,
      dominantPole: true,
      nameSubexpressions: true,
      transferFunctions: ['Av'],
      noiseThermal: false,
      noiseFlicker: false,
      noiseOutput: false,
      noiseSources: null,
    },
    annotationExcluded: [],
    collapsedGroups: [],
  });
});

test('transfer functions keep a known subset in report order, empty included', () => {
  assert.deepEqual(normalizeAnalysisOptions({ transferFunctions: ['Ai', 'bogus', 'Zm'] }).transferFunctions, ['Zm', 'Ai']);
  assert.deepEqual(normalizeAnalysisOptions({ options: { transferFunctions: [] } }).transferFunctions, []);
  assert.deepEqual(normalizeAnalysisOptions({ transferFunctions: 'Gm' }).transferFunctions, ['Av']);
  const state = readAnalysisFormState({ options: { transferFunctions: ['Gm', 'Av'] } });
  assert.deepEqual(state.options.transferFunctions, ['Av', 'Gm']);
  assert.deepEqual(readAnalysisFormState({}).options.transferFunctions, ['Av']);
});

test('noise options persist their source list and build the engine request', () => {
  const options = normalizeAnalysisOptions({ noiseThermal: true, noiseSources: ['M1', ' RD ', 'M1'] });
  assert.equal(options.noiseThermal, true);
  assert.equal(options.noiseFlicker, false);
  // Only the input-referred densities unless the output ones are asked for.
  assert.equal(options.noiseOutput, false);
  assert.deepEqual(options.noiseSources, ['M1', 'RD']);
  assert.deepEqual(analysisNoiseRequest(options), { thermal: true, flicker: false, output: false, sources: ['M1', 'RD'] });
  assert.equal(analysisNoiseRequest({ ...options, noiseOutput: true }).output, true);
  assert.equal(analysisNoiseRequest(analysisOptionDefaults()), undefined);
  const state = readAnalysisFormState({ options: { noiseFlicker: true, noiseSources: ['M2'] } });
  assert.equal(state.options.noiseFlicker, true);
  assert.deepEqual(state.options.noiseSources, ['M2']);
  assert.equal(readAnalysisFormState({ options: { noiseSources: null } }).options.noiseSources, null);
});

test('result-panel choices persist as clean string lists', () => {
  const state = readAnalysisFormState({ annotationExcluded: ['DC voltage gain', ' ', 'DC voltage gain'], collapsedGroups: 'noise' });
  assert.deepEqual(state.annotationExcluded, ['DC voltage gain']);
  assert.deepEqual(state.collapsedGroups, []);
});
