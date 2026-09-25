import { Circuit, Net } from './model.js';
import { renderDocument } from './document.js';
import { resolveCopySelection } from './selection.js';
import { GRID } from './grid.js';
import { junctionPoints, pointOnPath } from './wiring.js';

export const DRAWING_EXPORT_OPTIONS = Object.freeze({
  grid: false, terminals: false, junctions: false, background: true, netNames: true,
  // Leave room for browser MathML glyphs whose ink can extend beyond the
  // measured foreignObject box. The model bounds still determine placement;
  // this is only the final export safety margin.
  padding: GRID,
});

function schematicSubset(circuit, selection) {
  const { comps, freeLabels, nets, fragments } = resolveCopySelection(circuit, selection);
  const drawing = new Circuit();
  drawing.components = new Map(comps.map((comp) => [comp.refdes, comp]));
  drawing.nets = new Map(nets.map((net) => [net.id, net]));
  // Net highlights are keyed by the source document's electrical groups, and
  // a partial wire becomes a new fragment net below. Every drawn net therefore
  // takes its color from the source net it came from.
  const sourceOf = new Map(nets.map((net) => [net.id, net]));
  drawing.netHighlight = (net) => circuit.netHighlight(sourceOf.get(net?.id) || net);
  for (const [i, fragment] of fragments.entries()) {
    // A wholly selected net keeps its id so its net labels still name it.
    const keepId = fragment.whole && !drawing.nets.has(fragment.net.id);
    const net = new Net(drawing, {
      id: keepId ? fragment.net.id : `${fragment.net.id}-selection-${i}`, name: fragment.net.name,
      style: fragment.net.style, drawOrder: fragment.net.drawOrder,
      routingMode: 'fixed', fixedPaths: fragment.paths.map((points) => ({ points })),
      junctions: fragment.junctions,
    });
    // Fragment branch indices differ from the source. Carry each authored
    // segment's appearance to its new identity.
    const sourcePaths = fragment.net.paths();
    for (const [key, style] of Object.entries(fragment.net.wireStyles)) {
      const [sourceBranch, sourceSegment] = key.split(':').map(Number);
      const source = sourcePaths[sourceBranch];
      if (!source?.[sourceSegment] || !source[sourceSegment - 1]) continue;
      const span = [source[sourceSegment - 1], source[sourceSegment]];
      for (const [branch, path] of fragment.paths.entries()) {
        for (let segment = 1; segment < path.length; segment++) {
          if (pointOnPath(path[segment - 1], span) && pointOnPath(path[segment], span)) {
            net.wireStyles[`${branch}:${segment}`] = { ...style };
          }
        }
      }
    }
    drawing.nets.set(net.id, net);
    sourceOf.set(net.id, fragment.net);
  }
  const labelIds = new Set(freeLabels.map((label) => label.id));
  drawing.labels = new Map([...circuit.labels].filter(([id, label]) =>
    labelIds.has(id) || (label.owner && drawing.components.has(label.owner)) ||
    (label.netId && drawing.nets.has(label.netId))));
  // Junction dots are derived parts of complete wire topology. Internal paste
  // recreates them; an image must retain the existing dots without mutating or
  // repairing the source drawing. Partial islands retain only real junctions.
  const dots = new Set();
  for (const net of drawing.nets.values()) {
    const points = drawing.nets.get(net.id) === circuit.nets.get(net.id)
      ? [...net.junctions, ...circuit._netJunctions(net, net.paths())]
      : junctionPoints(net.paths(), [], true);
    for (const point of points) dots.add(`${point.x},${point.y}`);
  }
  for (const comp of circuit.components.values()) {
    if (comp.type === 'solder' && dots.has(`${comp.transform.x},${comp.transform.y}`)) {
      drawing.components.set(comp.refdes, comp);
    }
  }
  return drawing;
}

/** Whether a selection names anything to draw. */
export function hasDrawableSelection(selection = {}) {
  return ['refs', 'labels', 'netIds', 'wireKeys'].some((key) => [...(selection[key] || [])].length > 0);
}

/** The selected objects as a drawing of their own (a subset, never a crop);
 * no selection means the entire document. Model objects are shared read-only. */
export function selectionSubset(document, selection = {}) {
  return hasDrawableSelection(selection) ? schematicSubset(document, selection) : document;
}

/** Render a subset, never a crop. No selection means the entire document.
 * Model objects are read only: measured labels and authored routes stay intact.
 * Font embedding is supplied by the browser's standalone export adapter. */
export function selectionDrawing(document, selection = {}, options = {}) {
  const drawing = selectionSubset(document, selection);
  const padding = options.padding ?? GRID;
  if (!Number.isFinite(padding) || padding < 0) throw new Error('drawing padding must be a non-negative number');
  const bounds = drawing.inkBounds();
  const viewport = {
    x: bounds.x - padding, y: bounds.y - padding,
    w: Math.max(1, bounds.w + padding * 2), h: Math.max(1, bounds.h + padding * 2),
  };
  return renderDocument(drawing, { ...DRAWING_EXPORT_OPTIONS, ...options, viewport, emptyHint: false });
}
