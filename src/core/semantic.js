/** Pure semantic checks for explicitly declared analog intent.
 *
 * This module deliberately does not inspect geometry, route wires, or infer
 * connectivity from net names. Physical net IDs and the declared topology are
 * the only electrical authority here.
 */

import { getSymbol } from './components/index.js';

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const list = (value) => value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
const text = (value) => typeof value === 'string' ? value.trim() : '';
const terminal = (value) => {
  if (typeof value === 'string') {
    const split = value.lastIndexOf('.');
    return split > 0 ? { component: value.slice(0, split), terminal: value.slice(split + 1) } : null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return { component: text(value.component || value.ref || value.id), terminal: text(value.terminal || value.term) };
};
const termKey = (value) => {
  const point = terminal(value);
  return point?.component && point.terminal ? `${point.component}.${point.terminal}` : null;
};
const componentRef = (value, byId, byRef) => {
  const name = typeof value === 'string' ? value : value?.component || value?.id || value?.refdes;
  if (!name) return null;
  return byId.has(name) ? name : byRef.get(name) || null;
};

function issue(code, severity, explanation, refs = [], nets = [], clarification = null) {
  return {
    code,
    severity,
    refs: [...new Set(refs.filter(Boolean))].sort(compare),
    nets: [...new Set(nets.filter(Boolean))].sort(compare),
    explanation,
    clarification,
  };
}

function expectedNet(spec, value) {
  const nets = spec.nets || [];
  if (typeof value === 'string') {
    const requested = text(value);
    if (!requested) return { net: null, requested: null };
    const byId = nets.find((item) => item.id === requested);
    if (byId) return { net: byId, requested };
    const matches = nets.filter((item) => text(item.name).toLowerCase() === requested.toLowerCase());
    return { net: matches.length === 1 ? matches[0] : null, requested, matches };
  }
  const id = value?.netId || value?.net;
  if (id) return { net: nets.find((item) => item.id === id) || null, requested: id };
  const name = text(value?.name || value?.netName);
  if (!name) return { net: null, requested: null };
  const matches = nets.filter((item) => text(item.name).toLowerCase() === name.toLowerCase());
  return { net: matches.length === 1 ? matches[0] : null, requested: name, matches };
}

function checkRails(spec, semantics, out) {
  const required = [];
  if (semantics.requiredRails && !Array.isArray(semantics.requiredRails) && typeof semantics.requiredRails === 'object') {
    required.push(...Object.entries(semantics.requiredRails).map(([kind, net]) => ({ kind, net })));
  } else required.push(...list(semantics.requiredRails));
  required.push(...list(semantics.requiredRail));
  if (semantics.rails && typeof semantics.rails === 'object' && !Array.isArray(semantics.rails)) {
    for (const [kind, values] of Object.entries(semantics.rails)) {
      if (kind === 'required') required.push(...list(values));
      else required.push(...list(values).map((value) => typeof value === 'string' ? { net: value, kind } : { ...value, kind: value.kind || kind }));
    }
  }
  for (const declaration of required) {
    const value = typeof declaration === 'string' ? { net: declaration } : declaration || {};
    const found = expectedNet(spec, value);
    const candidates = found.matches || [];
    if (!found.net) {
      const clarification = candidates.length > 1 ? {
        question: `Which physical net satisfies rail ${found.requested}?`,
        candidates: candidates.map((net) => net.id).sort(compare),
      } : null;
      out.push(issue(candidates.length > 1 ? 'ambiguous-rail-net' : 'missing-required-rail', 'error',
        candidates.length > 1 ? `rail declaration ${found.requested} matches multiple physical nets` : `required rail ${found.requested || '(unspecified)'} is missing`, [], candidates.map((net) => net.id), clarification));
      continue;
    }
    const wantedKind = text(value.kind || value.type).toLowerCase();
    if (wantedKind && text(found.net.kind).toLowerCase() !== wantedKind) {
      out.push(issue('rail-kind-mismatch', 'error', `rail ${found.net.id} is declared as ${found.net.kind || 'untyped'}, expected ${wantedKind}`, [], [found.net.id]));
    }
  }
  const bias = [...list(semantics.requiredBiasNets), ...list(semantics.requiredBias), ...list(semantics.biasNets)];
  for (const value of bias) {
    const found = expectedNet(spec, value);
    if (!found.net) {
      const candidates = found.matches || [];
      if (candidates.length > 1) {
        out.push(issue('ambiguous-required-bias', 'error', `required bias net ${found.requested} matches multiple physical nets`, [], candidates.map((net) => net.id), {
          question: `Which physical net satisfies bias ${found.requested}?`,
          candidates: candidates.map((net) => net.id).sort(compare),
        }));
      } else {
        out.push(issue('missing-required-bias', 'error', `required bias net ${found.requested || '(unspecified)'} is missing`, [], candidates.map((net) => net.id)));
      }
    } else if (found.net.kind && !/bias/i.test(found.net.kind)) {
      out.push(issue('bias-kind-mismatch', 'warning', `net ${found.net.id} is required as bias but is typed ${found.net.kind}`, [], [found.net.id]));
    }
  }
}

function terminalDisplay(value) {
  if (typeof value === 'string') return value.trim() || '(empty terminal)';
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const component = text(value.component || value.ref || value.id);
    const name = text(value.terminal || value.term);
    if (component || name) return `${component || '(missing component)'}.${name || '(missing terminal)'}`;
  }
  return '(invalid terminal)';
}

function declaredTerminal(value, components, out) {
  const point = terminal(value);
  const display = terminalDisplay(value);
  if (!point?.component || !point.terminal) {
    out.push(issue('invalid-semantic-terminal', 'error', `semantic declaration contains invalid terminal ${display}`, [display]));
    return null;
  }
  const component = components.get(point.component);
  if (!component) {
    out.push(issue('unknown-semantic-terminal', 'error', `semantic declaration references missing component terminal ${display}`, [display]));
    return null;
  }
  let symbol;
  try { symbol = getSymbol(component.type); } catch {
    out.push(issue('unknown-semantic-terminal', 'error', `semantic declaration references terminal on unknown component type ${display}`, [display]));
    return null;
  }
  if (!symbol.terminals.some((item) => item.name === point.terminal)) {
    out.push(issue('unknown-semantic-terminal', 'error', `semantic declaration references unknown terminal ${display}`, [display]));
    return null;
  }
  return point;
}

function checkConnections(spec, semantics, out) {
  const ownership = new Map();
  for (const net of spec.nets || []) for (const item of net.terminals || []) {
    const key = termKey(item);
    if (key) ownership.set(key, net.id);
  }
  const components = new Map((spec.components || []).map((component) => [component.id, component]));
  const declarations = [...list(semantics.requiredConnections), ...list(semantics.connections)];
  for (const declaration of declarations) {
    const values = Array.isArray(declaration) ? declaration : list(declaration?.terminals || declaration?.refs || declaration?.members);
    const points = values.map((value) => declaredTerminal(value, components, out));
    if (points.some((point) => !point)) continue;
    const refs = points.map((point) => `${point.component}.${point.terminal}`);
    const actual = [...new Set(points.map((point) => ownership.get(`${point.component}.${point.terminal}`)).filter(Boolean))];
    const expected = text(declaration?.net || declaration?.netId);
    const expectedPhysical = expected ? expectedNet(spec, expected).net?.id : null;
    if (points.length < 2) {
      out.push(issue('ambiguous-required-connection', 'error', 'required connection does not identify at least two terminals', refs, [], {
        question: 'Which terminals should be electrically connected?',
        candidates: refs,
      }));
    } else if (expected && (actual.length !== 1 || actual[0] !== expectedPhysical)) {
      out.push(issue('required-connection-mismatch', 'error', `required terminals are not all on physical net ${expected}`, refs, [expectedPhysical || expected, ...actual]));
    } else if (!expected && actual.length !== 1) {
      out.push(issue('required-connection-missing', 'error', 'required terminals are not all on one physical net', refs, actual));
    }
  }
}

function portRequirements(semantics) {
  const values = [...list(semantics.requiredPorts), ...list(semantics.portRequirements)];
  for (const direction of ['inputs', 'outputs', 'inputoutputs', 'inouts']) {
    values.push(...list(semantics[direction]).map((value) => typeof value === 'string' ? { id: value, direction: direction === 'inputs' ? 'input' : direction === 'outputs' ? 'output' : 'inputoutput' } : { ...value, direction: value.direction || (direction === 'inputs' ? 'input' : direction === 'outputs' ? 'output' : 'inputoutput') }));
  }
  if (Array.isArray(semantics.ports)) values.push(...semantics.ports);
  else if (semantics.ports && typeof semantics.ports === 'object') {
    for (const [id, direction] of Object.entries(semantics.ports)) values.push({ id, direction });
  }
  return values;
}

function checkPorts(spec, semantics, out) {
  const ports = new Map((spec.ports || []).map((port) => [port.id, port]));
  for (const declaration of portRequirements(semantics)) {
    const value = typeof declaration === 'string' ? { id: declaration } : declaration || {};
    const id = text(value.id || value.name);
    const actual = ports.get(id);
    if (!actual) {
      out.push(issue('missing-required-port', 'error', `required ${value.direction || ''} port ${id || '(unnamed)'} is missing`, [], value.net ? [value.net] : [], {
        question: `Which physical net should port ${id || '(unnamed)'} expose?`,
        candidates: (spec.nets || []).map((net) => net.id).sort(compare),
      }));
      continue;
    }
    const wanted = text(value.direction || value.type).toLowerCase().replace('inout', 'inputoutput');
    if (wanted && actual.type !== wanted) out.push(issue('port-direction-mismatch', 'error', `port ${id} is ${actual.type || 'unspecified'}, expected ${wanted}`, [], [actual.net]));
    if (value.net && actual.net !== value.net) out.push(issue('port-net-mismatch', 'error', `port ${id} targets physical net ${actual.net}, expected ${value.net}`, [], [actual.net, value.net]));
  }
  for (const port of spec.ports || []) if (!port.type && !semantics.allowUnspecifiedPortDirection) {
    out.push(issue('port-direction-unspecified', 'warning', `port ${port.id} has no explicit input/output direction`, [], [port.net], {
      question: `Is port ${port.id} an input, output, or bidirectional port?`,
      candidates: ['input', 'output', 'inputoutput'],
    }));
  }
}

function explicitGroups(spec, semantics) {
  const groups = [];
  for (const group of semantics.matchedGroups || []) groups.push({ ...group, source: 'semantic' });
  for (const group of spec.constraints?.groups || []) {
    if (group.matched === true || group.kind === 'matched' || group.kind === 'differential-pair') groups.push({ ...group, source: 'constraint' });
  }
  const named = new Map();
  for (const component of spec.components || []) if (component.group) {
    if (!named.has(component.group)) named.set(component.group, []);
    named.get(component.group).push(component.id);
  }
  for (const [name, members] of named) groups.push({ members, kind: 'matched', source: `group:${name}` });
  return groups;
}

function checkGroups(spec, semantics, out) {
  const byId = new Map((spec.components || []).map((component) => [component.id, component]));
  for (const group of explicitGroups(spec, semantics)) {
    const members = [...new Set(group.members || [])].sort(compare);
    const missing = members.filter((id) => !byId.has(id));
    if (missing.length) {
      out.push(issue('matched-group-member-missing', 'error', `matched group references missing component(s): ${missing.join(', ')}`, missing));
      continue;
    }
    if (members.length < 2) {
      out.push(issue('matched-group-ambiguous', 'error', 'matched group needs at least two components', members, [], {
        question: 'Which components belong to the matched group?', candidates: members,
      }));
      continue;
    }
    const components = members.map((id) => byId.get(id));
    const types = [...new Set(components.map((component) => component.type))];
    if (types.length > 1) out.push(issue('matched-group-type-mismatch', 'error', `matched group mixes component types: ${types.join(', ')}`, members));
    const signatures = components.map((component) => {
      try { return getSymbol(component.type).terminals.map((item) => item.name).sort(compare).join(','); }
      catch { return ''; }
    });
    if (new Set(signatures).size > 1) out.push(issue('matched-group-terminal-mismatch', 'error', 'matched group members do not expose the same terminal roles', members));
    if (/differential/i.test(group.kind || group.type || '')) {
      const ownership = new Map();
      for (const net of spec.nets || []) for (const item of net.terminals || []) ownership.set(termKey(item), net.id);
      const shared = list(group.sharedTerminals || group.sharedTerminal || ['s']);
      const distinct = list(group.distinctTerminals || ['g', 'd']);
      for (const name of shared) {
        const nets = [...new Set(members.map((id) => ownership.get(`${id}.${name}`)).filter(Boolean))];
        if (nets.length !== 1 || members.some((id) => !ownership.has(`${id}.${name}`))) out.push(issue('differential-shared-net-mismatch', 'error', `differential pair terminal ${name} is not shared on one physical net`, members, nets));
      }
      for (const name of distinct) {
        const nets = members.map((id) => ownership.get(`${id}.${name}`)).filter(Boolean);
        if (nets.length !== members.length || new Set(nets).size !== nets.length) out.push(issue('differential-distinct-net-mismatch', 'error', `differential pair terminal ${name} must use distinct physical nets`, members, nets));
      }
    }
  }
}

function checkRoles(spec, semantics, out) {
  const byId = new Map((spec.components || []).map((component) => [component.id, component]));
  const byRef = new Map((spec.components || []).map((component) => [component.refdes || component.id, component.id]));
  const declarations = [...list(semantics.roleExpectations)];
  for (const field of ['roles', 'templateRoles']) {
    if (Array.isArray(semantics[field])) declarations.push(...semantics[field]);
    else if (semantics[field] && typeof semantics[field] === 'object') {
      for (const [role, members] of Object.entries(semantics[field])) declarations.push(...list(members).map((component) => ({ component, role })));
    }
  }
  for (const declaration of declarations) {
    const value = typeof declaration === 'string' ? { component: declaration } : declaration || {};
    const expected = text(value.role || value.expectedRole || value.templateRole);
    const members = list(value.components || value.members || value.component || value.id);
    for (const member of members) {
      const id = componentRef(member, byId, byRef);
      if (!id) { out.push(issue('role-component-missing', 'error', `role expectation references missing component ${typeof member === 'string' ? member : '(unnamed)'}`, [String(member)])); continue; }
      const component = byId.get(id);
      const actual = text(component.role || component.template);
      if (!expected) {
        out.push(issue('ambiguous-role-expectation', 'error', `role for ${id} is not specified`, [id], [], { question: `What role should ${id} play?`, candidates: ['driver', 'load', 'bias', 'input', 'output'] }));
      } else if (actual !== expected) {
        out.push(issue('component-role-mismatch', 'error', `${id} has role ${actual || 'unspecified'}, expected ${expected}`, [id]));
      }
    }
  }
  const components = new Map((spec.components || []).map((component) => [component.id, component]));
  const ownership = new Map();
  for (const net of spec.nets || []) for (const item of net.terminals || []) ownership.set(termKey(item), net.id);
  for (const declaration of [...list(semantics.driverLoads), ...list(semantics.driverLoad), ...list(semantics.relationships)]) {
    const value = declaration || {};
    const driverValue = Object.prototype.hasOwnProperty.call(value, 'driver') ? value.driver : value.source;
    const driver = driverValue === undefined ? null : declaredTerminal(driverValue, components, out);
    const loadValues = Object.prototype.hasOwnProperty.call(value, 'loads') ? value.loads
      : Object.prototype.hasOwnProperty.call(value, 'load') ? value.load : value.sinks;
    const loads = list(loadValues).map((item) => declaredTerminal(item, components, out));
    const refs = [driver, ...loads].filter(Boolean).map((point) => `${point.component}.${point.terminal}`);
    const netId = text(value.net || value.netId);
    if (!driver || !loads.length || loads.some((point) => !point)) {
      out.push(issue('ambiguous-driver-load', 'error', 'driver/load expectation must name one driver and at least one load terminal', refs, [], {
        question: 'Which driver and load terminals form this relationship?', candidates: refs,
      }));
      continue;
    }
    const driverNet = ownership.get(termKey(driver));
    const loadNets = loads.map((point) => ownership.get(termKey(point)));
    if (netId && (driverNet !== netId || loadNets.some((net) => net !== netId))) out.push(issue('driver-load-net-mismatch', 'error', `driver/load relationship is not on physical net ${netId}`, refs, [netId, driverNet, ...loadNets]));
    else if (!netId && (!driverNet || loadNets.some((net) => net !== driverNet))) out.push(issue('driver-load-disconnected', 'error', 'driver and load terminals do not share one physical net', refs, [driverNet, ...loadNets]));
  }
}

function checkOpens(spec, semantics, out) {
  const open = new Set((spec.openTerminals || []).map(termKey).filter(Boolean));
  const components = new Map((spec.components || []).map((component) => [component.id, component]));
  const prohibited = [...list(semantics.prohibitedOpenTerminals), ...list(semantics.requiredClosedTerminals)];
  const openRules = semantics.openTerminals && typeof semantics.openTerminals === 'object' ? semantics.openTerminals : {};
  prohibited.push(...list(openRules.prohibited || openRules.forbidden));
  for (const value of prohibited) {
    const point = declaredTerminal(value, components, out);
    if (!point) continue;
    const key = `${point.component}.${point.terminal}`;
    const actual = open.has(key) || !(spec.nets || []).some((net) => (net.terminals || []).some((item) => termKey(item) === key));
    if (actual) out.push(issue('prohibited-open-terminal', 'error', `terminal ${key} is open but must be connected`, [key]));
  }
  const allowed = [...list(semantics.allowedOpenTerminals), ...list(openRules.allowed)];
  if (allowed.length) {
    const allowedKeys = new Set(allowed.map(termKey).filter(Boolean));
    for (const key of open) if (!allowedKeys.has(key)) out.push(issue('unexpected-open-terminal', 'error', `terminal ${key} is open without an intentional-open declaration`, [key]));
  }
}

function checkClarifications(semantics, out) {
  for (const value of [...list(semantics.clarifications), ...list(semantics.ambiguous)]) {
    const item = value || {};
    const refs = list(item.refs || item.components).map((ref) => typeof ref === 'string' ? ref : ref?.id || ref?.refdes).filter(Boolean);
    const nets = list(item.nets || item.netIds || item.net).map((net) => typeof net === 'string' ? net : net?.id).filter(Boolean);
    out.push(issue(item.code || 'ambiguous-topology', item.severity === 'error' ? 'error' : 'warning', text(item.explanation || item.question) || 'topology needs clarification', refs, nets, {
      question: text(item.question || item.explanation) || 'Which topology is intended?',
      candidates: list(item.candidates).map((candidate) => typeof candidate === 'string' ? candidate : candidate?.id || candidate?.refdes).filter(Boolean).sort(compare),
    }));
  }
}

/** Check explicit semantic intent without mutating the spec or a Circuit. */
export function checkSemantics(spec) {
  const declared = spec?.semantics || spec?.semantic;
  const semantics = declared === undefined ? {} : declared && typeof declared === 'object' && !Array.isArray(declared) ? { ...declared } : declared;
  const hard = new Set(spec?.constraints?.hard || []);
  if (semantics && typeof semantics === 'object' && !Array.isArray(semantics)) {
    if (hard.has('require-supply') || hard.has('require-vdd')) semantics.requiredRail = [...list(semantics.requiredRail), { kind: 'supply', name: 'VDD' }];
    if (hard.has('require-ground') || hard.has('require-gnd')) semantics.requiredRail = [...list(semantics.requiredRail), { kind: 'ground', name: 'GND' }];
    if (hard.has('require-bias')) semantics.requiredBiasNets = [...list(semantics.requiredBiasNets), { name: 'BIAS' }];
  }
  const out = [];
  if (!semantics || typeof semantics !== 'object' || Array.isArray(semantics)) {
    out.push(issue('invalid-semantic-declaration', 'error', 'semantic declarations must be an object'));
  } else {
    checkRails(spec || {}, semantics, out);
    checkConnections(spec || {}, semantics, out);
    checkPorts(spec || {}, semantics, out);
    checkGroups(spec || {}, semantics, out);
    checkRoles(spec || {}, semantics, out);
    checkOpens(spec || {}, semantics, out);
    checkClarifications(semantics, out);
  }
  const unique = new Map(out.map((item) => [JSON.stringify(item), item]));
  const issues = [...unique.values()].sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
  const errors = issues.filter((item) => item.severity === 'error');
  const warnings = issues.filter((item) => item.severity === 'warning');
  return {
    ok: errors.length === 0,
    checked: Boolean(spec?.semantics || spec?.semantic || hard.size && [...hard].some((item) => /^require-(supply|vdd|ground|gnd|bias)$/.test(item))),
    issueCount: issues.length,
    errorCount: errors.length,
    warningCount: warnings.length,
    issues,
    errors,
    warnings,
    clarifications: issues.filter((item) => item.clarification),
  };
}
