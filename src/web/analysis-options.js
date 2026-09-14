/** Canonical small-signal form options and the legacy persistence boundary. */

export const ANALYSIS_OPTION_DEFAULTS = Object.freeze({
  neglectBodyEffect: true,
  highIntrinsicGain: true,
  neglectChannelLengthModulation: false,
  dominantPole: false,
});

const OPTION_ALIASES = Object.freeze({
  neglectBodyEffect: ['ignoreBodyEffect', 'ignoreGmb', 'approxIgnoreBody', 'bodyEffectIgnored'],
  highIntrinsicGain: ['gmroLarge', 'assumeGmRoLarge', 'approxGmRo', 'approxGmRoLarge'],
  neglectChannelLengthModulation: [
    'ignoreChannelLengthModulation', 'ignoreRo', 'approxIgnoreRo', 'roInfinite',
  ],
  dominantPole: [
    'dominantPoleApproximation', 'dominantPoleReduction', 'approxDominantPole',
  ],
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
  const options = { ...ANALYSIS_OPTION_DEFAULTS };
  for (const name of Object.keys(ANALYSIS_OPTION_DEFAULTS)) {
    const selected = firstBoolean(root, name) ?? firstBoolean(nested, name);
    if (selected !== undefined) options[name] = selected;
  }
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
  return { ...ANALYSIS_OPTION_DEFAULTS };
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
 * state contains only current fields and the four canonical options.
 */
export function migrateAnalysisFormState(value = {}) {
  const source = objectValue(value);
  const migratedOptions = legacyOptions(source);
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
    },
    diagnostics,
  };
}

export const defaultAnalysisOptions = analysisOptionDefaults;
export const migrateAnalysisOptions = migrateAnalysisFormState;
