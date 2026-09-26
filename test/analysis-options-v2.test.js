import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANALYSIS_OPTION_DEFAULTS,
  analysisNoiseRequest,
  analysisOptionDefaults,
  migrateAnalysisFormState,
  normalizeAnalysisOptions,
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
    noiseSources: null,
    deviceRegions: { M1: { region: 'triode' } },
  });
});

test('persistence migration maps legacy aliases and drops removed fields', () => {
  const { state, diagnostics } = migrateAnalysisFormState({
    target: 'N2',
    input: 'N1',
    reference: 'VSS',
    acGround: ['VBN', 'VCASCN'],
    models: 'M2=triode, M1=current-source',
    approximationOptions: {
      ignoreGmb: false,
      assumeGmRoLarge: false,
      ignoreRo: true,
      dominantPoleApproximation: true,
      millerApproximation: true,
      cascodeReduction: true,
      dcOnly: true,
    },
    context: 'obsolete explanation',
  });
  assert.deepEqual(state, {
    input: 'N1',
    output: 'N2',
    reference: 'VSS',
    acGrounds: 'VBN, VCASCN',
    deviceRegions: { M2: { region: 'triode' } },
    options: {
      neglectBodyEffect: false,
      highIntrinsicGain: false,
      neglectChannelLengthModulation: true,
      millerApproximation: true,
      parasitics: false,
      dominantPole: true,
      nameSubexpressions: true,
      transferFunctions: ['Av'],
      noiseThermal: false,
      noiseFlicker: false,
      noiseSources: null,
    },
    annotationExcluded: [],
    collapsedGroups: [],
  });
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, 'legacy-mos-current-source');
});

test('canonical persisted values win over legacy aliases and lists', () => {
  const { state } = migrateAnalysisFormState({
    neglectBodyEffect: false,
    highIntrinsicGain: false,
    neglectChannelLengthModulation: false,
    dominantPole: false,
    transferFunctions: ['Av'],
    options: { neglectBodyEffect: true },
    approximationOptions: { ignoreRo: true },
    approximations: ['ignore-body-effect', 'gmro-large', 'dominant-pole'],
    deviceRegions: new Map([['M1', { region: 'triode', ignored: 'metadata' }]]),
  });
  assert.deepEqual(state.options, {
    neglectBodyEffect: false,
    highIntrinsicGain: false,
    neglectChannelLengthModulation: false,
    millerApproximation: true,
    parasitics: false,
    dominantPole: false,
    nameSubexpressions: true,
    transferFunctions: ['Av'],
    noiseThermal: false,
    noiseFlicker: false,
    noiseSources: null,
  });
  assert.deepEqual(state.deviceRegions, { M1: { region: 'triode' } });
});

test('transfer functions keep a known subset in report order, empty included', () => {
  assert.deepEqual(normalizeAnalysisOptions({ transferFunctions: ['Ai', 'bogus', 'Zm'] }).transferFunctions, ['Zm', 'Ai']);
  assert.deepEqual(normalizeAnalysisOptions({ options: { transferFunctions: [] } }).transferFunctions, []);
  assert.deepEqual(normalizeAnalysisOptions({ transferFunctions: 'Gm' }).transferFunctions, ['Av']);
  const { state } = migrateAnalysisFormState({ options: { transferFunctions: ['Gm', 'Av'] } });
  assert.deepEqual(state.options.transferFunctions, ['Av', 'Gm']);
  assert.deepEqual(migrateAnalysisFormState({}).state.options.transferFunctions, ['Av']);
});

test('legacy model maps are reduced to triode regions only', () => {
  const { state } = migrateAnalysisFormState({
    deviceOverrides: {
      M1: { model: 'triode' },
      M2: { model: 'current-source' },
      M3: { model: 'saturation' },
    },
  });
  assert.deepEqual(state.deviceRegions, { M1: { region: 'triode' } });
  assert.equal('models' in state, false);
  assert.equal('deviceOverrides' in state.options, false);
});

test('migration does not mutate persisted input', () => {
  const saved = {
    target: 'OUT',
    models: { M1: { model: 'triode' } },
    approximationOptions: { gmroLarge: true },
  };
  const before = structuredClone(saved);
  migrateAnalysisFormState(saved);
  assert.deepEqual(saved, before);
});

test('noise options persist their source list and build the engine request', () => {
  const options = normalizeAnalysisOptions({ noiseThermal: true, noiseSources: ['M1', ' RD ', 'M1'] });
  assert.equal(options.noiseThermal, true);
  assert.equal(options.noiseFlicker, false);
  assert.deepEqual(options.noiseSources, ['M1', 'RD']);
  assert.deepEqual(analysisNoiseRequest(options), { thermal: true, flicker: false, sources: ['M1', 'RD'] });
  assert.equal(analysisNoiseRequest(analysisOptionDefaults()), undefined);
  const { state } = migrateAnalysisFormState({ options: { noiseFlicker: true, noiseSources: ['M2'] } });
  assert.equal(state.options.noiseFlicker, true);
  assert.deepEqual(state.options.noiseSources, ['M2']);
  assert.equal(migrateAnalysisFormState({ options: { noiseSources: null } }).state.options.noiseSources, null);
});

test('result-panel choices persist as clean string lists', () => {
  const { state } = migrateAnalysisFormState({ annotationExcluded: ['DC voltage gain', ' ', 'DC voltage gain'], collapsedGroups: 'noise' });
  assert.deepEqual(state.annotationExcluded, ['DC voltage gain']);
  assert.deepEqual(state.collapsedGroups, []);
});
