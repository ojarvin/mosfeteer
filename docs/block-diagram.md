# Block-diagram core contract

Block diagrams are a separate document kind. The core model lives in
`src/core/block-model.js`; its router is `src/core/block-router.js`. It does not
import `Circuit`, `Net`, electrical routing, or the evaluator. It reuses the
standalone `LabelInstance` geometry for block-local annotations only.

## Persisted state

A version-one block document has this shape:

```json
{
  "kind": "block",
  "version": 1,
  "grid": 40,
  "blocks": [
    {
      "id": "B1",
      "text": "Input filter",
      "rect": { "x": 0, "y": 0, "w": 320, "h": 160 },
      "terminals": [
        { "id": "in", "side": "left", "offset": 80 },
        { "id": "out", "side": "right", "offset": 80 }
      ],
      "style": { "color": "#111", "lineStyle": "solid", "width": "normal", "bold": true, "italic": true },
      "drawOrder": 0
    },
    {
      "id": "B2",
      "text": "Output",
      "rect": { "x": 400, "y": 0, "w": 160, "h": 160 },
      "terminals": [
        { "id": "in", "side": "left", "offset": 80 },
        { "id": "out", "side": "right", "offset": 80 }
      ],
      "style": { "color": "#111", "lineStyle": "solid", "width": "normal", "bold": true, "italic": true },
      "drawOrder": 0
    }
  ],
  "labels": [
    { "id": "L1", "kind": "label", "text": "feedback", "anchor": { "x": 160, "y": -80 } }
  ],
  "arrows": [
    {
      "id": "A1",
      "from": { "block": "B1", "terminal": "out" },
      "to": { "block": "B2", "terminal": "in" },
      "routingMode": "auto",
      "points": [ { "x": 320, "y": 80 }, { "x": 400, "y": 80 } ],
      "style": { "color": "#111", "lineStyle": "solid", "width": "normal" },
      "drawOrder": 0
    }
  ]
}
```

`BlockDiagram.toJSON()` validates and returns this shape; use
`BlockDiagram.fromJSON()` for loading. The model stores blocks and arrows in
maps, while terminals are maps scoped to their block. IDs are stable and
scoped (`block.terminal`); geometry never infers an arrow relationship.

Block rectangles and terminal offsets are snapped to the 40-unit grid. New
blocks receive stable generic `T<n>` terminals at non-corner perimeter grid
points, with one unused grid square at each corner; legacy `in`/`out` terminals
remain loadable. A terminal stores only its side and offset along that side, so
moving or resizing a block recomputes its exact perimeter point. Resizing rejects
shapes too small to preserve generated terminals and clamps explicit terminals
to two grid cells. Block text is centered at the
rectangle center. Arrow endpoints are terminal identities, not free points.
Deleting a block cascades its incident arrows; deleting a referenced terminal
is rejected.

## Routing and arrowheads

Automatic arrows use `routeBlockArrow()` and avoid block interiors with a
one-grid-cell clearance. The first segment leaves the source terminal in its
outward direction, and the final segment approaches the target from outside
its block. Arrow crossings are visual crossings and never make junctions.
Fixed routes keep their interior waypoints while model mutations re-anchor
only their endpoint points.

`blockArrowGeometry(points)` returns `{ shaftPoints, tip, left, right }`.
The tip is exactly the last route point; the default filled head is 32 units
long and 36 units wide, using the final cardinal segment for orientation.

## Persistence, commands, and rendering

`src/core/document.js` is the document boundary. It dispatches by `data.kind`
(`block` selects `BlockDiagram.fromJSON()`, while a missing kind remains
legacy electrical state), validates through the selected model, and selects
the matching SVG renderer. The HTTP server, desktop storage, browser load/sync
path, and SVG export all use this boundary, so block data never passes through
`Circuit.fromJSON()` or electrical `evaluate()`.

`runCommand()` dispatches block documents to block-specific verbs: `help`,
`list`, `state`, `bounds`, block/terminal/connector add, move, resize, rename,
remove, annotation add/rename/move/remove, `svg`/`export`, and `save`.
Electrical verbs remain isolated from `BlockDiagram`. Annotation commands accept
labels, arrows, boxes, and multi-point lines; annotation text remains separate
from block and connector text. The existing `/api/circuits/<name>` transport and
`circuit.json`/`circuit.svg` filenames are shared by both document kinds. The
browser exposes separate New schematic and New block diagram actions, labels
the active type, and hides tools from the other domain. Click blocks to select
them (Shift/Ctrl-click adds or toggles selection), then use Move, Copy, or
arrow-key nudging; Delete removes them, and Enter/F2 or double-click edits
block text inline. Connected Move promotes a selected connector to its endpoint
blocks; Shift+Move detaches selected blocks or connectors while preserving their
visual geometry, while connectors internal to a detached block set remain
attached. Copying blocks preserves connectors wholly inside the copied set; copied
connectors are fixed visual arrows. Block-local labels, arrows, boxes, and lines
are independent annotations and never become electrical nets. In the browser,
`i` searches blocks, `w` exposes generic perimeter terminals, `m` moves with
connectors, and dragging a selected resize handle edits the rectangle. The
shared style controls, crosshair, dark mode, marquee, nudge, undo/redo, copy,
Delete, and annotation tools apply without invoking electrical pickers or
routing.
