/**
 * Pure helpers for the small-signal analysis form.
 *
 * The form is a user preference surface, not part of the schematic model.
 * Keep its persistence scoped to the visible document and keep references
 * conservative when a schematic has been edited since the last analysis.
 */

import { parseLabelRuns } from '../core/model.js';

/** Native <option> text cannot render sub/superscripts, so node choices show
 * the net name without `_{…}`/`^{…}` markup, followed by its physical id. */
/** A net as the analysis menus list it: its name as read (V_{IN} as VIN);
 *  its id only where the name does not tell it apart -- no name, or a name
 *  `shared` with another net listed. */
export function analysisNetOptionText(net, { shared = false } = {}) {
  const name = net?.name ? parseLabelRuns(net.name).map((run) => run.text).join('') : '';
  if (!name) return `unnamed net ${net.id}`;
  return name === net.id || !shared ? name : `${name} (${net.id})`;
}

/** The names more than one of `nets` has, as analysisNetOptionText's
 *  `shared` reads them. */
export function sharedNetNames(nets) {
  const seen = new Map();
  for (const net of nets) if (net?.name) seen.set(net.name, (seen.get(net.name) || 0) + 1);
  return new Set([...seen].filter(([, count]) => count > 1).map(([name]) => name));
}

const ANALYSIS_FORM_KEY = 'mosfeteer:analysis-form';

export function analysisFormStorageKey(documentName = '') {
  const scope = String(documentName || 'new').trim() || 'new';
  return `${ANALYSIS_FORM_KEY}:${encodeURIComponent(scope)}`;
}

function splitAnalysisValues(value) {
  if (Array.isArray(value)) return value.flatMap((item) => splitAnalysisValues(item));
  if (value === undefined || value === null) return [];
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

/** Return the names that resolveAcGrounds can accept for the visible nets. */
function analysisNetAliases(nets = []) {
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
export function analysisFormDefaults(nets = [], { targetNetId = '', componentInputNetIds = [], componentOutputNetIds = [] } = {}) {
  const usable = nets.filter((net) => net?.id);
  const markedOutput = firstMatching(usable, (net) => net.analysis?.role === 'output');
  const targetHint = usable.find((net) => net.id === targetNetId);
  const componentOutputIds = new Set(componentOutputNetIds);
  const componentOutput = firstMatching(usable, (net) => componentOutputIds.has(net.id));
  const namedOutput = firstMatching(usable, (net) => /^(?:v_?\{?out\}?|output|out)$/i.test(String(net.name || '').trim()));
  const target = markedOutput || targetHint || componentOutput || namedOutput || usable[0] || null;

  // With a differential input pair, the non-inverting (…P / …+) side is the conventional drive.
  const nonInverting = (net) => /(?:p|\+|plus)\}?$/i.test(String(net.name || ''));
  const markedInputs = usable.filter((net) => net.id !== target?.id && net.analysis?.role === 'input');
  const markedInput = markedInputs.find(nonInverting) || markedInputs[0];
  const componentInputIds = new Set(componentInputNetIds);
  const componentInput = firstMatching(usable, (net) => componentInputIds.has(net.id) && nonInverting(net), target?.id)
    || firstMatching(usable, (net) => componentInputIds.has(net.id), target?.id);
  const namedInput = firstMatching(usable, (net) => /^(?:v_?\{?in\}?|input|in)$/i.test(String(net.name || '').trim()), target?.id);
  const firstAlternative = firstMatching(usable, () => true, target?.id);
  const input = markedInput || componentInput || namedInput || firstAlternative || null;

  return {
    target: target?.id || '',
    input: input?.id || '',
    targetMarked: !!markedOutput,
    inputMarked: !!markedInput,
    markedInputs: markedInputs.map((net) => net.id),
  };
}

/** The input the form shows: the saved one, unless a role marked on the
 *  drawing says otherwise -- one of several marked inputs is a choice among
 *  them, and the saved one stays. */
export function restoredAnalysisInput(defaults, saved) {
  if (!defaults.inputMarked || !saved) return defaults.inputMarked || !saved ? defaults.input : saved;
  return defaults.markedInputs.includes(saved) ? saved : defaults.input;
}
