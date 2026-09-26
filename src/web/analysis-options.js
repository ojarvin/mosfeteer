/** Canonical small-signal form options and the legacy persistence boundary. */

export const ANALYSIS_OPTION_DEFAULTS = Object.freeze({
  // Model simplifications: they change the small-signal model itself.
  neglectBodyEffect: true,
  neglectChannelLengthModulation: false,
  millerApproximation: true,
  parasitics: false,
  // Equation approximations: they change only the displayed expression.
  highIntrinsicGain: true,
  dominantPole: false,
  // Show large or recurring sums as named symbols with a "where" block.
  nameSubexpressions: true,
  // Which transfer functions to derive, in report order; zero or more.
  transferFunctions: Object.freeze(['Av']),
  // Noise densities: each generator adds one solve column, so both are off
  // until asked for. `noiseSources` null means every noisy device.
  noiseThermal: false,
  noiseFlicker: false,
  // The input-referred densities are the ones compared against a signal;
  // the output-referred ones are extra rows, shown on request.
  noiseOutput: false,
  noiseSources: null,
});

/** A refdes list, null for "all", or undefined when `value` is neither. */
function noiseSourcesValue(value) {
  if (value === null) return null;
  if (!Array.isArray(value)) return undefined;
  return [...new Set(value.map((name) => String(name).trim()).filter(Boolean))];
}

/**
 * The engine's `noise` request for normalized options, or undefined when no
 * noise kind is selected.
 */
export function analysisNoiseRequest(options = {}) {
  if (!options.noiseThermal && !options.noiseFlicker) return undefined;
  return {
    thermal: Boolean(options.noiseThermal),
    flicker: Boolean(options.noiseFlicker),
    output: Boolean(options.noiseOutput),
    sources: options.noiseSources ?? null,
  };
}

const TRANSFER_FUNCTIONS = Object.freeze(['Av', 'Zm', 'Gm', 'Ai']);

/** A known subset in report order, or undefined when `value` is not a list. */
function transferFunctionValue(value) {
  if (!Array.isArray(value)) return undefined;
  const names = new Set(value.map((name) => String(name).trim()));
  return TRANSFER_FUNCTIONS.filter((name) => names.has(name));
}

const OPTION_ALIASES = Object.freeze({
  neglectBodyEffect: ['ignoreBodyEffect', 'ignoreGmb', 'approxIgnoreBody', 'bodyEffectIgnored'],
  highIntrinsicGain: ['gmroLarge', 'assumeGmRoLarge', 'approxGmRo', 'approxGmRoLarge'],
  neglectChannelLengthModulation: [
    'ignoreChannelLengthModulation', 'ignoreRo', 'approxIgnoreRo', 'roInfinite',
  ],
  dominantPole: [
    'dominantPoleApproximation', 'dominantPoleReduction', 'approxDominantPole',
  ],
  millerApproximation: ['miller', 'approxMiller', 'millerDecoupling'],
  parasitics: ['deviceCapacitances', 'includeParasitics', 'approxParasitics'],
  noiseThermal: [],
  noiseFlicker: [],
  noiseOutput: [],
  nameSubexpressions: [],
});

const LEGACY_LIST_FIELDS = Object.freeze({
  acGrounds: ['acGrounds', 'acGround', 'additionalAcGrounds'],
  deviceRegions: ['deviceRegions', 'models', 'modelOverrides', 'deviceOverrides'],
});

function has(object, key) {
  return object != null && Object.prototype.hasOwnProperty.call(object, key);
}

function booleanValue(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && (value === 0 || value === 1)) return value === 1;
  if (typeof value !== 'string') return undefined;
  if (/^(?:true|yes|on|1)$/i.test(value.trim())) return true;
  if (/^(?:false|no|off|0)$/i.test(value.trim())) return false;
  return undefined;
}

function objectValue(value) {
  return value && typeof value === 'object' ? value : {};
}

function firstBoolean(source, key) {
  if (!has(source, key)) return undefined;
  return booleanValue(source[key]);
}

function canonicalOptions(value) {
  const root = objectValue(value);
  const nested = objectValue(root.options);
  const options = analysisOptionDefaults();
  for (const name of Object.keys(ANALYSIS_OPTION_DEFAULTS)) {
    if (typeof ANALYSIS_OPTION_DEFAULTS[name] !== 'boolean') continue;
    const selected = firstBoolean(root, name) ?? firstBoolean(nested, name);
    if (selected !== undefined) options[name] = selected;
  }
  const transferFunctions = transferFunctionValue(root.transferFunctions) ?? transferFunctionValue(nested.transferFunctions);
  if (transferFunctions) options.transferFunctions = transferFunctions;
  const noiseSources = has(root, 'noiseSources') ? noiseSourcesValue(root.noiseSources) : noiseSourcesValue(nested.noiseSources);
  if (noiseSources !== undefined) options.noiseSources = noiseSources;
  if (options.neglectChannelLengthModulation) options.highIntrinsicGain = false;
  return options;
}

function parseEntries(value) {
  if (value instanceof Map) return [...value.entries()];
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (Array.isArray(entry)) return entry;
      const match = String(entry).trim().match(/^([^:=\s]+)\s*[:=]\s*(\S+)$/);
      return match ? [match[1], match[2]] : null;
    }).filter(Boolean);
  }
  if (value && typeof value === 'object') return Object.entries(value);
  return String(value || '').split(',').map((entry) => {
    const match = String(entry).trim().match(/^([^:=\s]+)\s*[:=]\s*(\S+)$/);
    return match ? [match[1], match[2]] : null;
  }).filter(Boolean);
}

function regionName(value) {
  if (value && typeof value === 'object') {
    if (value.region !== undefined) return value.region;
    if (value.model !== undefined) return value.model;
    if (value.triode === true) return 'triode';
    return undefined;
  }
  return value;
}

/** Keep the only supported model override in its structured canonical form. */
function normalizeDeviceRegions(value) {
  const regions = {};
  for (const [rawRefdes, rawRegion] of parseEntries(value)) {
    const refdes = String(rawRefdes || '').trim();
    const region = String(regionName(rawRegion) || '').trim().toLowerCase();
    if (refdes && region === 'triode') regions[refdes] = { region: 'triode' };
  }
  return Object.fromEntries(Object.entries(regions).sort(([left], [right]) => (
    left < right ? -1 : left > right ? 1 : 0
  )));
}

function normalizedList(value) {
  const values = Array.isArray(value) || value instanceof Set ? [...value] : String(value || '').split(',');
  return [...new Set(values.map((item) => String(item).trim()).filter(Boolean))].join(', ');
}

/** Distinct non-empty strings from a stored list; anything else is empty. */
function stringList(value) {
  return Array.isArray(value) ? [...new Set(value.map((item) => String(item).trim()).filter(Boolean))] : [];
}

function firstField(source, names) {
  for (const name of names) if (source[name] !== undefined) return source[name];
  return undefined;
}

function approximationNames(source) {
  return Array.isArray(source.approximations)
    ? source.approximations.map((item) => String(item).trim().toLowerCase()).filter(Boolean)
    : [];
}

function legacyOptions(source) {
  const root = objectValue(source);
  const nested = objectValue(root.options);
  const old = objectValue(root.approximationOptions);
  const result = {};
  for (const [canonical, aliases] of Object.entries(OPTION_ALIASES)) {
    let selected;
    for (const candidate of [root, nested, old]) {
      const value = firstBoolean(candidate, canonical);
      if (value !== undefined) {
        selected = value;
        break;
      }
    }
    if (selected === undefined) for (const candidate of [root, nested, old]) {
      for (const alias of aliases) {
        const value = firstBoolean(candidate, alias);
        if (value !== undefined) {
          selected = value;
          break;
        }
      }
      if (selected !== undefined) break;
    }
    if (selected !== undefined) result[canonical] = selected;
  }
  const approximations = approximationNames(root);
  const listAliases = {
    neglectBodyEffect: ['ignore-body-effect'],
    highIntrinsicGain: ['gmro-large', 'high-intrinsic-gain'],
    neglectChannelLengthModulation: ['ignore-channel-length-modulation', 'ignore-ro', 'ro-infinite'],
    dominantPole: ['dominant-pole', 'dominant-pole-approximation', 'dominant-pole-reduction'],
    millerApproximation: ['miller', 'miller-approximation'],
    parasitics: ['parasitics', 'device-capacitances'],
  };
  for (const [name, names] of Object.entries(listAliases)) {
    if (!has(result, name) && names.some((alias) => approximations.includes(alias))) result[name] = true;
  }
  const channelLengthModulation = [root, nested, old]
    .map((candidate) => candidate.channelLengthModulation)
    .find((value) => value !== undefined);
  const mode = String(channelLengthModulation || '').trim().toLowerCase();
  if (!has(result, 'neglectChannelLengthModulation')) {
    if (mode === 'ignore' || mode === 'infinite') result.neglectChannelLengthModulation = true;
    if (mode === 'finite' || mode === 'retain') result.neglectChannelLengthModulation = false;
  }
  return result;
}

function legacyRegionSource(source) {
  const root = objectValue(source);
  return firstField(root, LEGACY_LIST_FIELDS.deviceRegions)
    ?? objectValue(root.options).deviceRegions;
}

/** Return a fresh copy of the concise default presentation options. */
export function analysisOptionDefaults() {
  return { ...ANALYSIS_OPTION_DEFAULTS, transferFunctions: [...ANALYSIS_OPTION_DEFAULTS.transferFunctions] };
}

/** Normalize only the canonical request contract; legacy aliases are ignored. */
export function normalizeAnalysisOptions(value = {}) {
  const source = objectValue(value);
  const options = canonicalOptions(source);
  const regions = normalizeDeviceRegions(source.deviceRegions ?? source.options?.deviceRegions);
  if (Object.keys(regions).length) options.deviceRegions = regions;
  return options;
}

/**
 * Migrate persisted form data once at the storage boundary. The returned
 * state contains only current fields and the canonical options.
 */
export function migrateAnalysisFormState(value = {}) {
  const source = objectValue(value);
  const migratedOptions = legacyOptions(source);
  const transferFunctions = transferFunctionValue(objectValue(source.options).transferFunctions);
  if (transferFunctions) migratedOptions.transferFunctions = transferFunctions;
  const noiseSources = noiseSourcesValue(objectValue(source.options).noiseSources);
  if (noiseSources !== undefined) migratedOptions.noiseSources = noiseSources;
  const options = canonicalOptions(migratedOptions);
  const deviceRegions = normalizeDeviceRegions(legacyRegionSource(source));
  const diagnostics = [];
  const removed = new Set();
  for (const [rawRefdes, rawRegion] of parseEntries(legacyRegionSource(source))) {
    const refdes = String(rawRefdes || '').trim();
    const model = String(regionName(rawRegion) || '').trim().toLowerCase();
    if (refdes && model === 'current-source' && !removed.has(refdes)) {
      removed.add(refdes);
      diagnostics.push({
        code: 'legacy-mos-current-source',
        severity: 'warning',
        refdes,
        once: true,
        message: `${refdes}=current-source was removed because the model override is no longer supported.`,
      });
    }
  }
  return {
    state: {
      input: String(source.input || '').trim(),
      output: String(source.output ?? source.target ?? '').trim(),
      reference: String(source.reference || '').trim(),
      acGrounds: normalizedList(firstField(source, LEGACY_LIST_FIELDS.acGrounds)),
      deviceRegions,
      options,
      annotationExcluded: stringList(source.annotationExcluded),
      collapsedGroups: stringList(source.collapsedGroups),
    },
    diagnostics,
  };
}
