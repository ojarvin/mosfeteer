# Block-diagram core contract

Block diagrams are a separate document kind. The core model lives in
`src/core/block-model.js`; its router is `src/core/block-router.js`. It does not
import `Circuit`, `Net`, electrical routing, or the evaluator. It reuses the
standalone `LabelInstance` geometry for block-local annotations and connector-attached labels. Connector labels are visual only and never electrical nets.

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
    { "id": "L1", "kind": "label", "text": "feedback", "anchor": { "x": 160, "y": -80 } },
    { "id": "L2", "kind": "label", "text": "signal", "connectorId": "A1", "connectorT": 0.5, "anchor": { "x": 360, "y": 80 } }
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
blocks receive stable generic `T<n>` terminals at every non-corner perimeter
grid point, with one unused grid square at each corner; legacy `in`/`out` terminals
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
only their endpoint points. Fresh diagonal layouts prefer a single bend near
mid-route when the simple path is clear; obstacle routing remains the fallback.

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
block text inline, including names in the Blocks panel. Select-mode dragging
moves a selected block set directly. Move, Copy, and Shift+Move use a modal
click-source then click/Enter-destination workflow; when a set is selected, the
source click must hit a member of that set. Connected Move promotes a selected
connector to its endpoint blocks, translates internal connectors without
changing their relative geometry, and reroutes boundary connectors. Shift+Move
detaches selected blocks or connectors while preserving their visual geometry,
while connectors internal to a detached block set remain attached. Copying a
selected block set copies its internal connectors and connector labels; copying
a connector alone creates a detached visual arrow that can reattach only at an
unambiguous terminal on commit. Drag a visible terminal along its block edge
to move it onto a free perimeter terminal. Ctrl+C copies one selected object's
style for Ctrl+Shift+V; `c` remains the copy-ghost tool for creating new blocks.
Block-local labels, connector labels, arrows, boxes, and lines are visual objects
and never become electrical nets; connector labels follow their connectors. In
the browser, `i` searches blocks, `w` exposes generic perimeter terminals, `m`
moves with connectors, and dragging a selected resize handle edits the rectangle.
The shared style controls, crosshair, dark mode, marquee, nudge, undo/redo,
copy, Delete, annotation tools, and Shift+L connector-label placement apply
without invoking electrical pickers or routing.
