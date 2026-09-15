/**
 * Pure helpers for the small-signal analysis form.
 *
 * The form is a user preference surface, not part of the schematic model.
 * Keep its persistence scoped to the visible document and keep references
 * conservative when a schematic has been edited since the last analysis.
 */

export const ANALYSIS_FORM_KEY = 'schematic-spawner:analysis-form';

export function analysisFormStorageKey(documentName = '') {
  const scope = String(documentName || 'new').trim() || 'new';
  return `${ANALYSIS_FORM_KEY}:${encodeURIComponent(scope)}`;
}

export function splitAnalysisValues(value) {
  if (Array.isArray(value)) return value.flatMap((item) => splitAnalysisValues(item));
  if (value === undefined || value === null) return [];
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

/** Return the names that resolveAcGrounds can accept for the visible nets. */
export function analysisNetAliases(nets = []) {
  const aliases = new Set();
  for (const net of nets) {
    if (!net) continue;
    if (net.id) aliases.add(String(net.id));
    if (net.name) aliases.add(String(net.name));
    for (const terminal of net.terminals || []) {
      if (terminal?.comp && terminal?.term) aliases.add(`${terminal.comp}.${terminal.term}`);
    }
  }
  return aliases;
}

export function pruneAnalysisNetValues(value, nets = []) {
  const aliases = analysisNetAliases(nets);
  return splitAnalysisValues(value).filter((token) => aliases.has(token)).join(', ');
}

export function pruneAnalysisDeviceRegions(value, refdes = []) {
  const refs = new Set(refdes.map((ref) => String(ref)));
  const entries = value instanceof Map
    ? [...value.entries()]
    : value && typeof value === 'object'
      ? Object.entries(value)
      : splitAnalysisValues(value).map((entry) => {
        const match = String(entry).match(/^([^=:]+)[=:](.+)$/);
        return match ? [match[1].trim(), match[2].trim()] : null;
      }).filter(Boolean);
  const regions = {};
  for (const [rawRefdes, rawValue] of entries) {
    const component = String(rawRefdes || '').trim();
    const region = typeof rawValue === 'object' ? rawValue?.region ?? rawValue?.model : rawValue;
    if (refs.has(component) && String(region || '').trim().toLowerCase() === 'triode') {
      regions[component] = { region: 'triode' };
    }
  }
  return regions;
}

export function formatAnalysisDeviceRegions(value = {}) {
  return Object.keys(value).sort().map((refdes) => `${refdes}=triode`).join(', ');
}

function firstMatching(nets, predicate, excludedId = '') {
  return nets.find((net) => net?.id !== excludedId && predicate(net));
}

/**
 * Choose form defaults from explicit schematic metadata before falling back to
 * a caller hint or a conservative name/type heuristic.  The marked flags let
 * the UI distinguish a deliberate toolbar role from a persisted user choice.
 */
export function analysisFormDefaults(nets = [], { targetNetId = '', componentInputNetIds = [] } = {}) {
  const usable = nets.filter((net) => net?.id);
  const markedOutput = firstMatching(usable, (net) => net.analysis?.role === 'output');
  const targetHint = usable.find((net) => net.id === targetNetId);
  const target = markedOutput || targetHint || usable[0] || null;

  const markedInput = firstMatching(usable, (net) => net.analysis?.role === 'input', target?.id);
  const componentInputIds = new Set(componentInputNetIds);
  const componentInput = firstMatching(usable, (net) => componentInputIds.has(net.id), target?.id);
  const namedInput = firstMatching(usable, (net) => /^(?:v_?in|input|in)$/i.test(String(net.name || '').trim()), target?.id);
  const firstAlternative = firstMatching(usable, () => true, target?.id);
  const input = markedInput || componentInput || namedInput || firstAlternative || null;

  return {
    target: target?.id || '',
    input: input?.id || '',
    targetMarked: !!markedOutput,
    inputMarked: !!markedInput,
  };
}
