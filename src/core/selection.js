import { extractWireFragments } from './model.js';

/** Owned labels bring their component; other labels remain visual selections. */
export function copySelectionParts({ labels = [], refs = [], netIds = [] } = {}) {
  const copyRefs = new Set(refs);
  for (const label of labels) if (label.owner) copyRefs.add(label.owner);
  return {
    refs: copyRefs,
    netIds: new Set(netIds),
    labels: labels.filter((label) => !label.owner),
  };
}

/** One selection rule for in-editor copies and standalone drawings. Wire keys
 * use the editor's net:branch:segment identity (segments are one-based). */
export function resolveCopySelection(circuit, { refs = [], labels = [], netIds = [], wireKeys = [] } = {}) {
  const copy = copySelectionParts({ labels, refs, netIds });
  for (const id of copy.netIds) {
    for (const terminal of circuit.nets.get(id)?.terminals || []) copy.refs.add(terminal.comp);
  }
  const comps = [...copy.refs].map((ref) => circuit.components.get(ref)).filter(Boolean);
  const compRefs = new Set(comps.map((comp) => comp.refdes));
  const labelIds = new Set(copy.labels.map((label) => label.id));
  const parentIds = new Set(copy.labels.filter((label) => ['arrow', 'box', 'line'].includes(label.kind)).map((label) => label.id));
  const freeLabels = [...circuit.labels.values()].filter((label) => !label.owner &&
    (labelIds.has(label.id) || (!label.isNetLabel?.() && parentIds.has(label.parent))));
  const wires = new Map();
  for (const key of new Set(wireKeys)) {
    const [id, branch, segment] = key.split(':');
    if (!wires.has(id)) wires.set(id, []);
    wires.get(id).push({ branch: Number(branch), segment: Number(segment) });
  }
  const nets = [];
  const fragments = [];
  for (const net of circuit.nets.values()) {
    const selected = wires.get(net.id) || [];
    const paths = net.paths();
    const segmentCount = paths.reduce((count, path) => count + path.slice(1)
      .filter((point, i) => point.x !== path[i].x || point.y !== path[i].y).length, 0);
    const internal = net.terminals.length && net.terminals.every((terminal) => compRefs.has(terminal.comp));
    const completeTerminalless = !net.terminals.length &&
      (copy.netIds.has(net.id) || (selected.length > 0 && selected.length === segmentCount));
    if ((internal && (!selected.length || selected.length === segmentCount)) || completeTerminalless) {
      nets.push(net);
    } else if (selected.length) {
      for (const island of extractWireFragments(paths, selected, net.junctions)) fragments.push({ net, ...island });
    }
  }
  return { comps, freeLabels, nets, fragments };
}
