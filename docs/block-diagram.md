# Block-diagram core contract

Block diagrams are a separate document kind. The core model lives in
`src/core/block-model.js`; its router is `src/core/block-router.js`. Neither
module imports `Circuit`, `Net`, `LabelInstance`, electrical routing, or the
evaluator.

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
    }
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

Block rectangles and terminal offsets are snapped to the 40-unit grid. A
terminal stores only its side and offset along that side, so moving or resizing
a block recomputes its exact perimeter point. Block text is centered at the
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
`list`, `state`, `bounds`, `add-block`, `add-arrow`, `svg`/`export`, and `save`.
Electrical verbs remain isolated from `BlockDiagram`. The existing
`/api/circuits/<name>` transport and `circuit.json`/`circuit.svg` filenames are
shared by both document kinds. The browser loads and renders block documents
in a read-only view; editing interactions remain electrical-circuit only.
