# Wiring Architecture

## Goals

The managed wiring model is a topological graph with orthogonal, grid-aligned
geometry. Deliberate diagonal segments are allowed inside managed nets and are
protected one segment at a time: the autorouter never replaces them, while the
orthogonal parts of the same net route normally. Electrical
connectivity is independent from component placement and from the visual route
chosen for a net. A route may be changed without changing the terminal set, and
a topology operation may preserve every existing path unless the user explicitly
deletes geometry.

## Canonical data model

Each `Net` owns:

- `terminals`: component terminal references, the electrical endpoints.
- `branches`: explicit managed orthogonal polylines. Every branch is an
  editable wire path; a branch endpoint is either a terminal or a junction.
- `junctions`: explicit grid points where two or more branches are joined.
  Branch endpoints can imply junctions, but geometric crossings alone never
  create connectivity; explicit joins are serialized for stable agent output.
- `name` and `id`: user-facing identity only; neither affects geometry.

`route` remains a compatibility alias for the primary branch in JSON and the
debug API. New code must use `paths()`/`wireSegments()` instead of choosing
between `route`, `branches`, or `points()`.

An unmaterialized two-terminal net has no branches and receives a route
suggestion on demand. Fresh multi-terminal layouts may use Steiner optimization,
but topology growth never replaces explicit managed paths: `wireTo`,
`wirePointTo`, and `connect` normally commit only the newly suggested branch. A
no-waypoint request already connected by explicit topology is a no-op; an
explicit target path can instead split that path and record a deliberate
same-net join at a crossing. Existing geometry otherwise changes only through
an explicit wire edit, transform, reroute, or another operation whose purpose
is to repair geometry.

## Automatic routing

`smartRoute` searches a four-neighbor grid. Component bboxes are inflated by
one grid cell, so body clearance is a hard constraint rather than a scoring
preference. Endpoint escape cells are temporarily permitted and the first and
last edges must follow terminal directions when directions are available.

Candidate paths are ordered by:

1. body crossings and hard-clearance violations,
2. collinear overlap with existing wires,
3. component and label clearance,
4. pin-direction conformity,
5. visible bend count,
6. Manhattan length, each segment within two cells of a block-diagram or
   signal-flow part counting three cells more (`roomScore`),
7. bends near the route's midpoint, then crossings with existing wires.

Around block-diagram and signal-flow parts (`roomyType` in
`components/categories.js`) a wire may also leave a pin two cells before it
bends, so among routes with as few bends a short detour buys two cells of
room from the blocks it passes. Schematic parts keep their one cell.

Crossings are legal and remain visually unambiguous because solder dots are
created only at electrical junctions, not at a crossing of unrelated nets.

For fresh multi-terminal layouts and explicit full-net reroutes, the router
may compute an exact rectilinear Steiner minimum tree over a coarse-grid graph
(Dreyfus–Wagner subset DP; see `steinerBranches` in `router.js`). Its admission
limits and cancellation behavior are in `router.js` and its tests; requests outside those limits fall back to the
MST-of-shortest-paths approximation. Total length is the primary objective under
hard body clearance, with terminal-direction and label preferences as tie-breaks;
a three-way Y becomes one centered T-junction.

During wire drawing, `smartRoute` is a live suggestion for the current draft.
Committing that draft appends the chosen branch and preserves all prior
managed paths. A wire interior is a valid endpoint; when multiple coincident
paths are possible, the selected branch identity is required and preserved
through the join. Existing geometry otherwise changes only through an explicit
wire edit, transform, reroute, or another operation whose purpose is to repair
geometry.
Existing hand-drawn branches are treated as fixed obstacles when another net
is routed, and a fresh managed layout excludes other nets' wire spans.

## Stroke wiring

`src/core/stroke-wiring.js` turns one dragged path into wires. Which
terminals a run means is decided from the whole run:

- a terminal is a candidate where the run comes nearest it, within its
  reach: 1.75 cells (in the editor, at least 40 pixels, but no further than
  halfway to its nearest neighbour), and a quarter nearer than any other
  terminal there unless within half a cell;
- a candidate is deliberate within half a cell, at a turn, where the
  stroke slows to half its usual speed, or at the run's start or end; a
  deliberate one is kept, a passing one only when it costs less to keep
  than to leave out;
- two terminals of one part in a row cost little when the run passes
  through the part (in at one pin against its outward direction, out at
  the other along its) and much when it skims past, so a gate beside a
  source rail is left out;
- running back the way it came over the last terminal lets it go, and on
  over the one before, that one too; Backspace mid-stroke lets go of the
  last one.

Consecutive visits link into one net, except:

- two terminals of one part never link (the stroke passes through it);
- terminals already on two different nets never link (no shorts);
- from a net of two or more terminals, a terminal of a net the stroke
  already left is a return to that net, not a link.

A run's first link is deliberate: it may also be a diode connection (MOS
drain–gate, BJT collector–base) or join two wired nets whose names do not
conflict. A visit that does not link starts the next net. A lifted pen
(Alt let go) ends a run; the next run starts fresh. Each link is wired in
stroke order as a click on its first pin and then its second would wire
it, so the stroke decides connectivity and the router the geometry.

## Editing and selection

Hit testing returns `{netId, branch, segment}`. A stationary managed-wire click
can begin a wire draft at an interior point; a drag remains segment selection
and editing. Otherwise, a plain click selects that wire segment; **shift+click
toggles more segments into the multi-selection** (a set of
`"netId:branch:segment"` keys). Dragging any selected segment moves every
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

- every managed wire point is on the 40-unit grid;
- every managed branch is orthogonal and has no duplicate/collinear interior points;
- branch endpoints that represent terminals equal the live terminal position;
- no committed segment enters a component body or overlaps another net's wire;
- all terminal connectivity is represented by exactly one net;
- deleting a wire can only remove connectivity, never invent it.

The model exposes invariant validation for tests and agent workflows. UI code
uses model operations rather than mutating route arrays directly.
