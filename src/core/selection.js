import { canonicalNetName, extractWireFragments } from './model.js';
import { pointOnPath } from './wiring.js';

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
 * use the editor's net:branch:segment identity (segments are one-based).
 * A selected net never brings the parts on its terminals: without them it is
 * copied as its whole wire, carrying its net labels, and its pin ends become
 * free wire ends. */
export function resolveCopySelection(circuit, { refs = [], labels = [], netIds = [], wireKeys = [] } = {}) {
  const copy = copySelectionParts({ labels, refs, netIds });
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
    } else if (copy.netIds.has(net.id)) {
      const all = paths.flatMap((path, branch) => path.slice(1).map((_, i) => ({ branch, segment: i + 1 })));
      const islands = extractWireFragments(paths, all, net.junctions)
        .map((island) => ({ net, ...island, whole: true, netLabels: [] }));
      // Each net label rides the island it sits on; one off every path, the first.
      for (const label of circuit.netLabels(net)) {
        const home = islands.find((island) => island.paths.some((path) => pointOnPath(label.anchorWorld(), path))) || islands[0];
        home?.netLabels.push(label);
      }
      fragments.push(...islands);
    } else if (selected.length) {
      // A selected net label rides the copied piece of wire it sits on.
      const onNet = copy.labels.filter((label) => label.netId === net.id);
      for (const island of extractWireFragments(paths, selected, net.junctions)) {
        const netLabels = onNet.filter((label) => island.paths.some((path) => pointOnPath(label.anchorWorld(), path)));
        fragments.push({ net, ...island, ...(netLabels.length ? { netLabels } : {}) });
      }
    }
  }
  // A net label never becomes loose text: it travels with its copied wire, or
  // on its own it carries only its net's name (`netLabels`), which a paste
  // attaches to another wire.
  const carried = new Set([...nets.map((net) => net.id), ...fragments.filter((fragment) => fragment.whole).map((fragment) => fragment.net.id)]);
  const riding = new Set(fragments.flatMap((fragment) => fragment.netLabels || []));
  return {
    comps,
    freeLabels: freeLabels.filter((label) => !label.netId),
    netLabels: freeLabels.filter((label) => label.netId && !carried.has(label.netId) && !riding.has(label)),
    nets,
    fragments,
  };
}

/** What pasting a copied net label named `name` onto `net` does: 'same' adds
 * another label of the net's own name, 'name' gives an unnamed net the name
 * (joining it by name to every net called that), and 'rename' would rename a
 * differently named net, which the editor confirms first. */
export function netLabelPasteKind(net, name) {
  if (!net.name) return 'name';
  return canonicalNetName(net.name) === canonicalNetName(name) ? 'same' : 'rename';
}
