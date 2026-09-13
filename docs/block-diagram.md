# Block-diagram core contract

The contract below describes the current implementation. The proposed editor
convergence is tracked separately in
[One editor, two component palettes](plans/unified-block-editor.md).

Block diagrams are a separate document kind. The core model lives in
`src/core/block-model.js`; its router is `src/core/block-router.js`. It does not
import `Circuit`, `Net`, electrical routing, or the evaluator. It reuses the
standalone `LabelInstance` geometry for block-local annotations and connector-attached labels. Connector labels are visual only and never electrical nets.

New ordinary blocks are four grid squares by four grid squares.

Right-clicking a block, connector, or label opens the same **Select same** menu
as schematic mode, with matching by object type, color, or line style.
Selection gestures are editor-wide: a plain click replaces the mixed selection,
while Shift-click, Ctrl-click, or Command-click toggles only the clicked object
and preserves selected objects of every other kind.

At commit time, a floating connector endpoint that coincides with exactly one
block terminal attaches to it. This applies both when placing or moving a block
onto an endpoint and when dragging the hanging endpoint onto a terminal.

Moving a connected block is a connector-repair boundary. Every affected
connected connector is routed afresh around a two-grid-square block clearance
envelope. This intentionally favors consistently loop-free geometry over
retaining fixed bend points after a block move; manual segment edits remain
fixed until another connected block move requires repair.

Box selection includes every connector segment whose two endpoints are inside
the marquee. Dragging one selected segment moves all selected runs with the same
orientation; selected runs of the other orientation remain selected and still.

Arrow and box annotations move by dragging their geometry. Move/copy previews
include the complete shape and its child label. Block-move previews may pass
through temporarily invalid positions; routing resumes when the pointer reaches
a valid position, while an invalid destination cannot be committed. At shared
connector trunks, an explicitly selected connector endpoint wins, with stable
connector order as the fallback.

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
grid point, with one unused grid square at each corner; older `in`/`out` terminal
data remains loadable. A terminal stores only its side and offset along that side, so
moving or resizing a block recomputes its exact perimeter point. A side being
pulled inward stops one grid square beyond the last connected terminal it
would pass; otherwise the rectangle may shrink to the ordinary minimum size.
Unused generated terminals may be repositioned or discarded, while explicit
terminals are clamped to the resized perimeter. Block text is centered at the
rectangle center. Attached arrow endpoints are terminal identities; detached
visual connectors may have free endpoints.
Deleting a block preserves its incident connectors as detached fixed visuals,
including the surviving endpoint and connector labels. Deleting a referenced
terminal is rejected.

## Routing and arrowheads

Fresh automatic arrows use `routeBlockArrow()` and avoid block interiors with a
one-grid-cell clearance; connected block moves reroute with two cells of
clearance. The first segment leaves the source terminal in its
outward direction, and the final segment approaches the target from outside
its block. No connector runs parallel along a block edge: the adjacent route
lane stays at least one grid square away so the arrowhead points into the
block. Fan-out connectors may share the same terminal and common starting
trunk before branching. A solder-style dot marks the true branch point of a
shared trunk; ordinary geometric crossings remain unconnected and receive no
dot. Junction dots derive from current connector geometry, so segment and
endpoint edits reposition or remove them automatically. Connector
simplification removes every 180-degree reversal so moving a block cannot
leave folded-back sticks in the route. Fixed-route edits also restore the
mandatory terminal-facing source and target legs; dragging the arrow-end run
cannot leave the arrow tangent to the block edge.
Fixed routes keep their interior waypoints while model mutations re-anchor
only their endpoint points. Automatic routing minimizes bend count before
route length, so a longer safe outside L wins over a shorter staircase. Among
routes with the same bend count, the centered dogleg is preferred; grid search
is the fallback.

`blockArrowGeometry(points)` returns `{ shaftPoints, tip, left, right }`.
The tip is exactly the last route point; the default filled head is 32 units
long and 36 units wide, using the final cardinal segment for orientation.

## Persistence, commands, and rendering

`src/core/document.js` is the document boundary. It dispatches by `data.kind`
(`block` selects `BlockDiagram.fromJSON()`, while a missing kind is treated as
electrical state), validates through the selected model, and selects
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
unambiguous terminal on commit. Ctrl+C copies one selected object's
style for Ctrl+Shift+V; `c` remains the copy-ghost tool for creating new blocks.
Block-local labels, connector labels, arrows, boxes, and lines are visual objects
and never become electrical nets; connector labels follow their connectors. In
the browser, `i` searches blocks, `w` exposes generic perimeter terminals, `m`
moves with connectors, and dragging a selected resize handle edits the rectangle.
Terminals stay hidden outside Connector mode; selected annotation arrows, boxes,
and lines show draggable endpoints, corners, or vertices. The shared style
controls, crosshair, dark mode, marquee, nudge, undo/redo, copy, Delete,
annotation tools, and Shift+L connector-label placement apply without invoking
electrical pickers or routing.

Double-click a block to edit its text. Selected or actively edited labels show
their calculated bounding boxes and anchors, matching schematic labels.

Connector endpoints are draggable and may be reattached to any unambiguous
terminal on the same or another block; all block terminals are visible during
that drag. Connector-path picking uses the snapped grid cursor rather than the
raw pointer position. The preview uses the same automatic route as commit. Moving a block
with a half-attached connector keeps its attached endpoint connected while the
free endpoint remains fixed. Inline text editors commit with Enter;
Shift+Enter inserts a persisted line break in block text and all label roles.
