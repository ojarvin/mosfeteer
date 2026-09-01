# Wiring Architecture

## Goals

The wiring model is a topological graph with orthogonal, grid-aligned geometry.
Electrical connectivity is independent from component placement and from the
visual route chosen for a net. A route may be changed without changing the
terminal set, and a topology operation may preserve every existing path unless
the user explicitly deletes geometry.

## Canonical data model

Each `Net` owns:

- `terminals`: component terminal references, the electrical endpoints.
- `branches`: explicit orthogonal polylines. Every branch is an editable wire
  path; a branch endpoint is either a terminal or a junction.
- `junctions`: grid points where two or more branches meet. These are derived
  from branch endpoints and geometric intersections, then serialized for stable
  agent output.
- `name` and `id`: user-facing identity only; neither affects geometry.

`route` remains a compatibility alias for the primary branch in JSON and the
debug API. New code must use `paths()`/`wireSegments()` instead of choosing
between `route`, `branches`, or `points()`.

An unmaterialized two-terminal net has no branches and receives a route
suggestion on demand. Explicit managed routes may be re-laid out when topology
changes require a fresh optimization; fixed legacy paths remain protected.

## Automatic routing

`smartRoute` searches a four-neighbour grid. Component bboxes are inflated by
one grid cell, so body clearance is a hard constraint rather than a scoring
preference. Endpoint escape cells are temporarily permitted and the first and
last edges must follow terminal directions when directions are available.

Candidate paths are ordered by:

1. body crossings and hard-clearance violations,
2. collinear overlap and crossings with existing wires,
3. component and label clearance,
4. pin-direction conformity,
5. Manhattan length,
6. visible bend count.

Crossings are legal and remain visually unambiguous because solder dots are
created only at electrical junctions, not at a crossing of unrelated nets.

For multi-terminal nets, the router computes the exact rectilinear Steiner
minimum tree over a coarse-grid graph (Dreyfus–Wagner subset DP; see
`steinerBranches` in router.js). Total length is the primary objective under
hard body clearance, with terminal-direction and label preferences as
tie-breaks; a three-way Y becomes one centered T-junction. Nets too large for
the exponential DP fall back to the MST-of-shortest-paths approximation.
Existing hand-drawn branches are treated as fixed obstacles when another net
is routed, and a fresh managed layout excludes other nets' wire spans.

## Editing and selection

Hit testing returns `{netId, branch, segment}`. A plain click selects that wire
segment; **shift+click toggles more segments into the multi-selection** (a set
of `"netId:branch:segment"` keys). Dragging any selected segment moves every
selected run of the same orientation together; `dd`/Delete removes all selected
segments at once (cuts are applied against one branch snapshot so indices never
shift under one another). A double click selects the complete net, including
all branches and its solder dots. Deleting a segment splits the affected path;
a connectivity rebuild walks the remaining wire graph and splits terminal
groups into nets.

Dragging a segment edits only its owning branch. Endpoints attached to terminals
remain fixed; an endpoint move inserts a short orthogonal connector. Component
moves translate attached branch endpoints, preserve user-drawn interiors, and
reroute only the necessary endpoint legs. Multi-object moves apply one delta to
all selected paths before one connectivity/routing commit.

## Solder dots

For each net, branch endpoints and geometric intersections are counted. A dot
is required at a point where at least three same-net wire arms meet, or where a
terminal joins an existing wire. Crossings between different nets do not create
dots. Solder dots are explicit terminal-less annotations in the model and are
excluded from routing obstacles and overlap checks; auto-created dots are tagged
so they can be removed when topology changes.

## Invariants

- every wire point is on the 40-unit grid;
- every branch is orthogonal and has no duplicate/collinear interior points;
- branch endpoints that represent terminals equal the live terminal position;
- no committed segment enters a component body or overlaps another net's wire;
- all terminal connectivity is represented by exactly one net;
- deleting a wire can only remove connectivity, never invent it.

The model exposes invariant validation for tests and agent workflows. UI code
uses model operations rather than mutating route arrays directly.
