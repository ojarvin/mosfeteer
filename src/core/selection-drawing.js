import { Circuit, Net } from './model.js';
import { renderDocument } from './document.js';
import { resolveCopySelection } from './selection.js';
import { GRID } from './grid.js';
import { junctionPoints, pointOnPath } from './wiring.js';

export const DRAWING_EXPORT_OPTIONS = Object.freeze({
  grid: false, terminals: false, junctions: false, background: true, netNames: true,
});

function schematicSubset(circuit, selection) {
  const { comps, freeLabels, nets, fragments } = resolveCopySelection(circuit, selection);
  const drawing = new Circuit();
  drawing.components = new Map(comps.map((comp) => [comp.refdes, comp]));
  drawing.nets = new Map(nets.map((net) => [net.id, net]));
  const labelIds = new Set(freeLabels.map((label) => label.id));
  drawing.labels = new Map([...circuit.labels].filter(([id, label]) =>
    labelIds.has(id) || (label.owner && drawing.components.has(label.owner)) ||
    (label.netId && drawing.nets.has(label.netId))));
  for (const [i, fragment] of fragments.entries()) {
    const net = new Net(drawing, {
      id: `${fragment.net.id}-selection-${i}`, name: fragment.net.name,
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
  }
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

/** Render a subset, never a crop. No selection means the entire document.
 * Model objects are read only: measured labels and authored routes stay intact.
 * Font embedding is supplied by the browser's standalone export adapter. */
export function selectionDrawing(document, selection = {}, options = {}) {
  const selected = ['refs', 'labels', 'netIds', 'wireKeys']
    .some((key) => [...(selection[key] || [])].length > 0);
  const drawing = !selected ? document : schematicSubset(document, selection);
  const padding = options.padding ?? GRID;
  if (!Number.isFinite(padding) || padding < 0) throw new Error('drawing padding must be a non-negative number');
  const bounds = drawing.bounds();
  const viewport = {
    x: bounds.x - padding, y: bounds.y - padding,
    w: Math.max(1, bounds.w + padding * 2), h: Math.max(1, bounds.h + padding * 2),
  };
  return renderDocument(drawing, { ...DRAWING_EXPORT_OPTIONS, ...options, viewport, emptyHint: false });
}
