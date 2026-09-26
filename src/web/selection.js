export { copySelectionParts } from '../core/selection.js';

/** Convert any standalone visual label, including a net label, to the
 * label-only clipboard shape. Deliberately omits owner/netId so the pasted
 * object is a floating annotation rather than electrical topology. */
export function copyableLabelPayload(label) {
  if (!label || label.owner) return null;
  const anchor = typeof label.anchorWorld === 'function' ? label.anchorWorld() : label.anchor;
  return {
    id: label.id,
    kind: label.kind,
    parent: label.parent || null,
    text: label.text,
    align: label.align,
    x: anchor.x,
    y: anchor.y,
    end: label.kind === 'label' ? null : { ...label.end },
    points: label.kind === 'line' ? label.points.map((point) => ({ ...point })) : null,
    style: { ...(label.style || {}) },
    // An equation stays an equation, with its measured box until it renders.
    math: !!label.math,
    mathBox: (label.math && typeof label.toJSON === 'function' && label.toJSON().mathBox) || null,
  };
}

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

/**
 * Click-to-cycle through stacked objects. `candidates` are the selection keys
 * under a click in pick order (topmost first); `current` is the key of what
 * is selected now. A click on the selected object moves on to the next one
 * under it, wrapping around; anything else keeps the ordinary topmost pick.
 * Returns the key to select instead, or null to keep the ordinary pick.
 */
export function nextStackedSelection(candidates = [], current = null) {
  const index = current ? candidates.indexOf(current) : -1;
  if (index < 0 || candidates.length < 2) return null;
  return candidates[(index + 1) % candidates.length];
}

/**
 * The selection a plain press on a component arms a move for. A press on a
 * member of the current selection confirms the whole mixed selection (its
 * labels, wires, and nets ride along); a press on any other component
 * replaces it with that component's group, so nothing selected earlier (a
 * double-clicked net, say) tags along into a move or copy.
 */
export function componentPressSelection({ refdes, selectedRefs = new Set(), selectedLabelIds = new Set(), group = [refdes] } = {}) {
  if (selectedRefs.has(refdes)) {
    return { refs: [...selectedRefs], labelIds: [...selectedLabelIds], keepMixed: true };
  }
  return { refs: [...group], labelIds: [], keepMixed: false };
}
