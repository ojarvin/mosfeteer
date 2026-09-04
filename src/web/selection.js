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

/**
 * Choose a wire hit after geometric distances have been computed.
 *
 * The first (nearest) candidate remains the default.  Only candidates at
 * effectively the same distance participate in preference resolution:
 * explicit selected nets take precedence, while diagnostic focus is useful
 * only when it names exactly one tied net.  Candidate order is the
 * deterministic final fallback, and unknown preference IDs are ignored.
 */
export function chooseWireHitCandidate({
  candidates = [],
  selectedNets = new Set(),
  diagnosticNets = new Set(),
} = {}) {
  if (!candidates.length) return null;
  const nearest = candidates.reduce((best, candidate) =>
    candidate.distance < best.distance ? candidate : best);
  const scale = Math.max(1, Math.abs(nearest.distance));
  const tied = candidates.filter(({ distance }) =>
    Math.abs(distance - nearest.distance) <= 1e-9 * scale);
  const selected = tied.filter(({ net }) => selectedNets.has(net.id));
  if (selected.length) return selected[0];
  const diagnostic = tied.filter(({ net }) => diagnosticNets.has(net.id));
  const diagnosticNetsInTie = new Set(diagnostic.map(({ net }) => net.id));
  if (diagnosticNetsInTie.size === 1) return diagnostic[0];
  return tied[0];
}
