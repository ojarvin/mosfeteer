import { MOS_TYPES } from './shared.js';
import {
  canonicalNetName,
  isReferenceMarker,
  isReferenceMarkerGlobalName,
  referenceMarkerInfo,
  referenceMarkerIsLocal,
} from '../model.js';

export const AC_GROUND = '@AC_GROUND';
const REFERENCE_NAMES = new Set(['GND', 'VSS', 'VDD', 'VCM']);

function diagnostic(code, message, details = {}) {
  return { code, message, ...details };
}

function componentTerminalNet(circuit, component, term) {
  return circuit.netOfTerminal({ comp: component.refdes, term });
}

function asValues(value) {
  if (value == null || value === '') return [];
  if (value instanceof Set || Array.isArray(value)) return [...value];
  return [value];
}

function netByValue(circuit, value, role) {
  if (value && typeof value === 'object' && value.comp && value.term) {
    try {
      const terminal = circuit.resolveTerm(value);
      const net = circuit.netOfTerminal(terminal);
      return net
        ? { ok: true, net, value: `${value.comp}.${value.term}` }
        : { ok: false, diagnostic: diagnostic('unconnected-port', `${role} terminal "${value.comp}.${value.term}" is not connected to a net`) };
    } catch {
      return { ok: false, diagnostic: diagnostic('unknown-terminal', `unknown ${role} terminal "${value.comp}.${value.term}"`) };
    }
  }
  if (value && typeof value === 'object' && value.id) {
    const net = circuit.nets.get(value.id);
    return net
      ? { ok: true, net, value: value.id }
      : { ok: false, diagnostic: diagnostic('unknown-net', `unknown ${role} net "${value.id}"`) };
  }

  const raw = String(value ?? '').trim();
  if (!raw) return { ok: false, diagnostic: diagnostic('missing-port', `${role} net is required`) };
  const byId = circuit.nets.get(raw);
  if (byId) return { ok: true, net: byId, value: raw };

  if (raw.includes('.')) {
    try {
      const terminal = circuit.resolveTerm(raw);
      const net = circuit.netOfTerminal(terminal);
      return net
        ? { ok: true, net, value: raw }
        : { ok: false, diagnostic: diagnostic('unconnected-port', `${role} terminal "${raw}" is not connected to a net`) };
    } catch {
      return { ok: false, diagnostic: diagnostic('unknown-terminal', `unknown ${role} terminal "${raw}"`) };
    }
  }

  const matches = [...circuit.nets.values()].filter((net) => canonicalNetName(net.name) === raw);
  // Several physical nets carrying one name are one node (a virtual
  // connection), so the first of them answers for the whole group.
  if (matches.length) return { ok: true, net: matches[0], value: raw };
  return { ok: false, diagnostic: diagnostic('unknown-net', `unknown ${role} net "${raw}"`) };
}

function roleCandidates(circuit, role) {
  const candidates = [];
  const seen = new Set();
  const add = (net) => {
    if (net && !seen.has(net.id)) {
      seen.add(net.id);
      candidates.push(net);
    }
  };
  for (const net of circuit.nets.values()) {
    if (net.analysis?.role === role) add(net);
  }
  for (const component of circuit.components.values()) {
    const typeMatches = role === 'input'
      ? component.type === 'input'
      : role === 'output' ? component.type === 'output' : false;
    if (typeMatches || component.analysis?.role === role) {
      add(componentTerminalNet(circuit, component, 'p'));
    }
  }
  const namePattern = role === 'input'
    ? /^(?:V_?IN|INPUT|IN)$/i
    : /^(?:V_?OUT|OUTPUT|OUT)$/i;
  if (candidates.length === 0) {
    for (const net of circuit.nets.values()) {
      if (namePattern.test(canonicalNetName(net.name))) add(net);
    }
  }
  return candidates;
}

export function resolveAnalysisPort(circuit, value, role) {
  if (value != null && value !== '') return netByValue(circuit, value, role);
  const all = roleCandidates(circuit, role);
  // Candidates that share a name are one node, so they cannot be ambiguous.
  const seenNames = new Set();
  const candidates = all.filter((net) => {
    const name = canonicalNetName(net.name);
    if (!name || !seenNames.has(name)) {
      if (name) seenNames.add(name);
      return true;
    }
    return false;
  });
  if (candidates.length === 1) {
    return { ok: true, net: candidates[0], value: candidates[0].id, inferred: true };
  }
  if (candidates.length > 1) {
    return {
      ok: false,
      diagnostic: diagnostic('ambiguous-port', `${role} port is ambiguous`, {
        candidates: candidates.map((net) => net.id),
      }),
    };
  }
  return { ok: false, diagnostic: diagnostic('missing-port', `${role} port is required`) };
}

function markerNet(circuit, component) {
  const info = referenceMarkerInfo(component.type);
  return info ? componentTerminalNet(circuit, component, info.terminal) : null;
}

function isGlobalReferenceNet(component, net) {
  if (!net) return false;
  const info = referenceMarkerInfo(component.type);
  return !referenceMarkerIsLocal(component)
    || isReferenceMarkerGlobalName(info, net.name)
    || REFERENCE_NAMES.has(canonicalNetName(net.name).toUpperCase());
}

export function collectAcGrounds(circuit, values = []) {
  const ids = new Set();
  const diagnostics = [];
  for (const component of circuit.components.values()) {
    if (!isReferenceMarker(component)) continue;
    const net = markerNet(circuit, component);
    if (isGlobalReferenceNet(component, net)) ids.add(net.id);
  }
  for (const net of circuit.nets.values()) {
    if (net.analysis?.acGround === true || REFERENCE_NAMES.has(canonicalNetName(net.name).toUpperCase())) {
      ids.add(net.id);
    }
  }
  for (const value of asValues(values)) {
    const result = netByValue(circuit, value, 'AC-ground');
    if (result.ok) ids.add(result.net.id);
    else diagnostics.push(result.diagnostic);
  }
  return { ids, diagnostics };
}

/** Physical nets that share a canonical name are one electrical node: a
 * deliberate virtual connection drawn without a wire (a repeated net label, or
 * a port and a label carrying the same name). Their drawable geometry stays
 * separate, so the solve maps every member onto the first one it meets. The
 * returned map holds only the members that are not the representative. */
export function virtualNetAliases(circuit) {
  const byName = new Map();
  for (const net of circuit.nets.values()) {
    const name = canonicalNetName(net.name);
    if (!name) continue;
    // Case-sensitive, like `Circuit#logicallyConnected` and the net list's
    // own grouping: one spelling is one name.
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(net.id);
  }
  const aliases = new Map();
  for (const ids of byName.values()) {
    for (const id of ids.slice(1)) aliases.set(id, ids[0]);
  }
  return aliases;
}

/** A virtual connection to an AC-reference rail grounds every member of the
 * group, so the alias never points at a node the solve has removed. */
function expandGroundsThroughAliases(acGroundIds, aliases) {
  for (const [member, representative] of aliases) {
    if (acGroundIds.has(member) || acGroundIds.has(representative)) {
      acGroundIds.add(member);
      acGroundIds.add(representative);
    }
  }
  return acGroundIds;
}

/**
 * Take the chosen ports out of the AC-reference set, name group and all.
 * Returns whether anything was released, so an analysis that just removed its
 * own last reference can say so instead of solving a floating model.
 */
function releasePortsFromReference(acGroundIds, results, aliases) {
  const representative = (id) => aliases?.get(id) ?? id;
  const ports = new Set(results.filter((result) => result?.ok).map((result) => representative(result.net.id)));
  if (!ports.size || !acGroundIds.size) return false;
  let released = false;
  for (const id of [...acGroundIds]) {
    if (!ports.has(representative(id))) continue;
    acGroundIds.delete(id);
    released = true;
  }
  return released;
}

function nodeForNet(netId, acGroundIds, aliases = null) {
  if (!netId) return netId;
  if (acGroundIds.has(netId)) return AC_GROUND;
  return aliases?.get(netId) ?? netId;
}

export function resolveMosBulk(circuit, component, acGroundIds = new Set(), aliases = null) {
  if (!component || !MOS_TYPES.has(component.type)) {
    return { ok: false, diagnostic: diagnostic('not-mos', 'bulk resolution requires a MOS component') };
  }
  const hasExplicitBulk = component.def?.terminals?.some(({ name }) => name === 'b');
  if (hasExplicitBulk) {
    const net = componentTerminalNet(circuit, component, 'b');
    if (!net) {
      return {
        ok: false,
        diagnostic: diagnostic('unconnected-bulk', `${component.refdes} has an unconnected explicit bulk terminal`, {
          component: component.refdes,
        }),
      };
    }
    return {
      ok: true,
      component: component.refdes,
      kind: 'explicit',
      reference: null,
      netId: net.id,
      node: nodeForNet(net.id, acGroundIds, aliases),
    };
  }
  const reference = component.type.startsWith('pmos') ? 'VDD' : 'VSS';
  return {
    ok: true,
    component: component.refdes,
    kind: 'implicit',
    reference,
    netId: null,
    node: AC_GROUND,
  };
}

function normalizedPort(result, role, acGroundIds, aliases) {
  return {
    role,
    value: result.value,
    netId: result.net.id,
    name: canonicalNetName(result.net.name) || result.net.id,
    node: nodeForNet(result.net.id, acGroundIds, aliases),
    inferred: result.inferred === true,
  };
}

function optionValue(options, role) {
  const ports = options.ports || {};
  if (role === 'input') return options.input ?? options.inputName ?? options.inputNet ?? ports.input;
  return options.output ?? options.outputName ?? options.outputNet ?? options.target ?? options.targetName ?? ports.output;
}

function normalizeDeviceRegions(options) {
  const source = options.deviceRegions
    ?? options.modelOverrides
    ?? options.models
    ?? options.devices;
  if (!source) return new Map();
  const entries = source instanceof Map
    ? [...source.entries()]
    : Array.isArray(source)
      ? source.map((entry) => {
        const match = String(entry).trim().match(/^([^:=\s]+)\s*[:=]\s*(.+)$/);
        return match ? [match[1], match[2]] : [];
      }).filter(([refdes]) => refdes)
      : typeof source === 'string'
        ? source.split(',').map((entry) => {
          const match = entry.trim().match(/^([^:=\s]+)\s*[:=]\s*(.+)$/);
          return match ? [match[1], match[2]] : [];
        }).filter(([refdes]) => refdes)
        : Object.entries(source);
  const regions = new Map();
  for (const [refdes, value] of entries) {
    if (value === undefined || value === null || value === '') continue;
    regions.set(String(refdes), value && typeof value === 'object' ? { ...value } : { model: value });
  }
  return regions;
}

export function resolveAnalysisContext(circuit, options = {}, legacyOptions = {}) {
  const normalizedOptions = typeof options === 'string'
    ? { ...legacyOptions, output: options }
    : options || {};
  const diagnostics = [];
  const inputResult = resolveAnalysisPort(circuit, optionValue(normalizedOptions, 'input'), 'input');
  const outputResult = resolveAnalysisPort(circuit, optionValue(normalizedOptions, 'output'), 'output');
  if (!inputResult.ok) diagnostics.push(inputResult.diagnostic);
  if (!outputResult.ok) diagnostics.push(outputResult.diagnostic);

  const groundValues = [
    ...asValues(normalizedOptions.acGrounds ?? normalizedOptions.acGround),
    ...asValues(normalizedOptions.reference),
  ];
  const groundResult = collectAcGrounds(circuit, groundValues);
  diagnostics.push(...groundResult.diagnostics);
  const virtualAliases = virtualNetAliases(circuit);
  expandGroundsThroughAliases(groundResult.ids, virtualAliases);

  // A node chosen as a port is driven or observed there, so it is not the AC
  // reference any more. That is what lets a supply rail answer as an input --
  // a supply-rejection query is an ordinary transfer between two nodes, with
  // no rule of its own -- and the rail's whole name group leaves with it.
  const released = releasePortsFromReference(groundResult.ids, [inputResult, outputResult], virtualAliases);
  if (released && !groundResult.ids.size) {
    diagnostics.push(diagnostic('missing-reference', 'the selected ports are the only AC reference: mark another net as AC ground'));
  }

  const input = inputResult.ok ? normalizedPort(inputResult, 'input', groundResult.ids, virtualAliases) : null;
  const output = outputResult.ok ? normalizedPort(outputResult, 'output', groundResult.ids, virtualAliases) : null;
  if (input && output && input.node === output.node) {
    diagnostics.push(diagnostic('same-port', 'input and output must be different nodes', {
      input: input.netId,
      output: output.netId,
    }));
  }

  const bulks = new Map();
  for (const component of circuit.components.values()) {
    if (!MOS_TYPES.has(component.type)) continue;
    const result = resolveMosBulk(circuit, component, groundResult.ids, virtualAliases);
    if (result.ok) bulks.set(component.refdes, result);
    else diagnostics.push(result.diagnostic);
  }

  const nodeAliases = new Map([
    ...virtualAliases,
    ...[...groundResult.ids].map((id) => [id, AC_GROUND]),
  ]);
  const terminalNodes = new Map();
  for (const component of circuit.components.values()) {
    for (const terminal of component.def?.terminals || []) {
      const net = componentTerminalNet(circuit, component, terminal.name);
      if (net) terminalNodes.set(`${component.refdes}.${terminal.name}`, nodeForNet(net.id, groundResult.ids, virtualAliases));
    }
  }
  const referenceNodes = new Map([
    ['GND', AC_GROUND],
    ['VSS', AC_GROUND],
    ['VDD', AC_GROUND],
    ['VCM', AC_GROUND],
  ]);
  // An implicit bulk names its rail rather than a net. When that rail is the
  // port under test it is a live node, and the bulks must follow it there.
  for (const port of [input, output]) {
    if (!port) continue;
    const rail = canonicalNetName(port.name).replace(/[_^]\{([^}]*)\}/g, '$1').toUpperCase();
    if (!referenceNodes.has(rail)) continue;
    referenceNodes.set(rail, port.node);
    if (rail === 'VSS') referenceNodes.set('GND', port.node);
    if (rail === 'GND') referenceNodes.set('VSS', port.node);
  }
  const deviceRegions = normalizeDeviceRegions(normalizedOptions);
  // Device capacitances are opt-in: off unless the request asks for them, and
  // a device's own attribute can still opt in or out on its own.
  const parasitics = normalizedOptions.parasitics === true
    || normalizedOptions.deviceCapacitances === true
    || normalizedOptions.includeParasitics === true;
  const ok = diagnostics.length === 0;
  return {
    ok,
    input,
    output,
    acGround: AC_GROUND,
    acGroundIds: groundResult.ids,
    referenceIds: groundResult.ids,
    nodeAliases,
    terminalNodes,
    referenceNodes,
    referenceNets: referenceNodes,
    rails: referenceNodes,
    deviceRegions,
    parasitics,
    acGroundNode: AC_GROUND,
    bulks,
    diagnostics: { errors: diagnostics, warnings: [] },
    error: ok ? null : diagnostics.map(({ message }) => message).join('; '),
  };
}
