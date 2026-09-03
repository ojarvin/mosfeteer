/**
 * Return the selected component that should own a move gesture, or null when
 * the hit is not a member of a preselected component set. Wire and label hits
 * are source confirmation for the set rather than standalone edit requests.
 */
export function selectedSetMoveSource({
  selectedRefs = [],
  components = new Map(),
  componentRef = null,
  wire = null,
  label = null,
  selectedWireKeys = new Set(),
  selectedNetIds = new Set(),
  touchedNetIds = new Set(),
  selectedLabelIds = new Set(),
} = {}) {
  const refs = [...selectedRefs];
  const hasDesignComponent = refs.some((refdes) => components.get(refdes)?.type !== 'solder');
  if (!hasDesignComponent) return null;
  const wireKey = wire ? `${wire.net.id}:${wire.branch}:${wire.seg}` : null;
  const wireMember = wire && (
    selectedWireKeys.has(wireKey) ||
    selectedNetIds.has(wire.net.id) ||
    touchedNetIds.has(wire.net.id)
  );
  const labelMember = label && (
    selectedLabelIds.has(label.id) ||
    (label.netId && selectedNetIds.has(label.netId))
  );
  if (!componentRef && !wireMember && !labelMember) return null;
  return componentRef || refs.find((refdes) => components.get(refdes)?.type !== 'solder') || refs[0] || null;
}

/** Return selected nets whose entire terminal set rides the moved components.
 * Terminal-less selected nets are complete by definition. */
export function completeSelectedNetIds({ selectedNetIds = new Set(), nets = new Map(), selectedRefs = [] } = {}) {
  const refs = new Set(selectedRefs);
  return new Set([...selectedNetIds].filter((id) => {
    const net = nets.get(id);
    return net && (!net.terminals.length || net.terminals.every((terminal) => refs.has(terminal.comp)));
  }));
}
