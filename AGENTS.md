# schematic-spawner — working context

Programmatic/agent-assisted schematic editor. Connectivity-based model rendered to SVG.
Git repo → private `ojarvin/schematic-spawner`.
**Push only over HTTPS** (SSH permanently unavailable headless, "Permission denied (publickey)");
`origin` = HTTPS URL, `gh` is the credential helper.

## Agent generation instructions

Two distinct roles work here. Pick yours from
[`guidelines/README.md`](./guidelines/README.md):

- **Developer agent** (improving the app): read
  [`guidelines/DEVELOPER.md`](./guidelines/DEVELOPER.md).
- **Circuit author agent** (drawing circuits): read
  [`guidelines/CIRCUIT-AUTHOR.md`](./guidelines/CIRCUIT-AUTHOR.md).

Both roles share the visual standard in
[`guidelines/style-guide.md`](./guidelines/style-guide.md). This file is the
**live spec** for current symbol geometry, the label model, routing behavior,
and editor UX — skim it whenever you need an exact number.

## Symbol style (Razavi look)

- All symbols use the classic textbook look: **filled gate bars /
  arrowheads / power slabs** via a `polygon` primitive with
  `fill:'foreground'`; symbol linework uses **butt caps / miter joins**.
- `style.js` stroke roles (select with `style:'…'` in a graphic):
  `symbol` (normal, butt), `emph` (9.6), `ground` (11.6), `supply` (7.2),
  plus the legacy `LINE` (round, wires) / `THICK`. `fontAttrs('instance'|'label')`
  unchanged.
- **Labels support subscripts:** `_{...}` markup (e.g. `C_{GS}`); owned
  instance labels auto-subscript a trailing numeral (M1 → M with subscript 1).
  Alignment/anchors/bbox model unchanged (`textWidth` scales sub/super runs
  ×0.62).

## Current symbol geometry (affects tests / wire tests)

- **resistor / capacitor / inductor / switch\* / variable\_\***: terminals
  `a`(-80,0) (left) / `b`(80,0) (right) on the 40-grid; resistor / capacitor / inductor /
  switch all **160 wide**, bbox `{-80,-40,160,80}` (cap plates at x
  -12.94/12.94, inductor coil spans x -58.49..58.49 — centered on the
  origin). Diode uses the same centered 160-wide footprint, terminals
  `a`(-80,0) / `b`(80,0), bbox `{-80,-40,160,80}`.
- **nmos / pmos**: terminals `g`(-120,0), `d`(0,-80), `s`(0,80), bbox
  `{-120,-80,120,160}`; gate = two filled bars (x -87.2..-75.6, -66.3..-54.6);
  NMOS source arrow (filled) points OUT, PMOS points INTO the channel.
  `defaultMirrorY:true` on pmos → placed source-up. `ComponentInstance`
  applies `defaultMirrorX/Y` only when `opts.mirror*` is `undefined`; the
  CLI `add` command omits the mirror flags unless `--mirrorX/--mirrorY` is
  given, so **symbol defaults apply everywhere** (output ports come out
  mirrorX, pmos source-up).
- **npn / pnp**: terminals `b`(-160,0), `c`(0,-120), `e`(0,120) [pnp: c
  bottom, e top]; filled emitter arrow; base bar `emph`. bbox
  `{-160,-120,160,240}`. **Label on the right at `{40,0}`** (one square
  past the body).
- **ground**: `gnd`(0,0), stub to y40, three `ground`-width bars (y
  40/63.26/84.19), bbox `{0,0,80,120}`. **supply**: `p`(0,0), filled slab
  above, bbox `{-40,-80,80,80}`.
- **vcm**: `vcm`(0,0), upward-escaping terminal with a downward stub to y24
  and an open, outline-only downward triangle from y24 to y56 (56 wide, 32
  deep), bbox
  `{-40,0,80,80}`; no instance label and normal `symbol` stroke.
- **current_source / current_sink / voltage_source**: `a`(0,-80)/`b`(0,80),
  circle r43, filled arrow (or ± marks); bbox `{-80,-80,160,160}`.
  refPrefix `I` / `V`.
- **opamp**: `ip`(-200,40), `im`(-200,-40), `o`(160,0). **opamp_diff**
  (fully differential): same bbox `{0,-120,360,240}`-style
  `{-200,-120,360,240}`, same two inputs, plus `op`(160,-40) & `om`(160,40)
  — two output leads exit the triangle's slanted edges at the input rows
  (x≈12.8/12.81) and run to x=160. All four polarity marks are 28-unit
  (same size), centered on the input/output rows y=±40: input −/+ at x≈-76,
  output **flipped** +/− at x≈-38 (op top, om bottom), kept clear of the
  body's slanted edges. The plain opamp's input marks sit on the same rows
  y=±40. refPrefix `U` for both. **inverter/buffer**: `a`(-120,0), `y`(120
  or 80, 0). **gates** (and/or/nand/nor): `a`(-120,-40), `b`(-120,40),
  `y`(120,0); xor/xnor `y`(160,0). refPrefix `U`. **Gate bodies**: every
  body is ONE continuous closed path (`Z`). AND/NAND's top edge meets the
  curved front at the same point (no seam/kink). OR/NOR's concave back is
  shifted left (-8) so it overlaps the input lead tips (which end at
  x=-76.88). XOR/XNOR shift the body AND the extra input-side line left
  (-22) together (fixed spacing); the extra line lands ON the wire tips
  (x≈-77 at the input rows) and the wires stop there — they never extend
  into the gap between the two curves. The output lead and negation bubble
  shift with the body. Buffer/inverter triangle bodies are closed with `Z`
  so the apex is a sharp miter (the inverter's apex hides behind its
  bubble).
- **solder**: pure annotation dot (`SOLDER_DOT_RADIUS=12`); its bbox is
  exactly the drawn dot (`{-12,-12,24,24}`) — not a grid cell — because
  solder is placed on and selected at the junction grid point directly.
  `validateSymbol` exempts terminal-less annotations from the bbox-on-grid
  rule. Excluded from the routing env and from `evaluate()` overlap checks.
- **port / port_filled** (Razavi circle markers): `p`(0,0), circle left of
  the lead. **input/output/inputoutput** are Razavi-style boxed ports
  (refPrefix `I`/`O`/`IO` + owned id label to the LEFT at labelOffset
  `{-120,0}`); **output defaults to `defaultMirrorX:true`** (terminal on
  the circuit side, box+arrow outward) — the label offset mirrors with
  the symbol.
- **variable_\*** (adjustable): composed at load time from the plain
  resistor / capacitor / inductor definitions (`[...base.graphics,
  ...ADJUST]` in `variable.js`) so they track the base body geometry.
  The adjustment arrow is a 45° shaft + filled head over the centered body
  (shaft `M -48 48 L 36 -36`, head tip at (48,-48)).
- **labelOffsets**: nmos/pmos `{40,0}`, npn/pnp `{40,0}` (right side);
  resistor / variable / cap / inductor / diode `{0,80}`, switch `{0,40}`;
  sources
  `{80,0}`; ports `{-120,0}`; logic / opamp below body.

## Label model

- Labels are NOT a component / symbol type: separate
  `circuit.labels: Map<id, LabelInstance>` (like solder — no terminals,
  don't provide connectivity by themselves). `LabelInstance` has three roles:
  an owned instance label (`owner` = component refdes, with a local `offset`),
  a persistent electrical net label (`netId` = one physical net), or a free
  annotation (`owner:null`, `netId:null`, independent text/anchor).
- **Physical versus logical nets:** a `netId` identifies one physical net and
  its drawable geometry. Nets with the same canonical name form a logical
  group for naming/reporting only; a shared name does not electrically connect
  separate physical nets.
- Net-label text is derived from its physical net name. Use the canonical model
  APIs (`addNetLabel`, `renameNet`, `renameNetLabel`) rather than writing
  `net.name` in editor code. Removing a net label removes only that occurrence;
  the physical net and its name remain. A provisional label on an unnamed net
  is committed atomically only after a non-empty name is entered, otherwise it
  is discarded.
- `LabelInstance`: `id, text, align (center|left|right), owner
  (refdes|null), offset (local grid-snapped when owned), anchor (world
  grid-snapped)`.
- **Bbox model**: tight text bbox computed from per-glyph widths
  (`LABEL_FONT_SIZE=38` matches the rendered `INSTANCE_FONT` /
  `LABEL_FONT` size; `LABEL_CHAR_W=8` at font 12 for the bold + italic
  label face; narrow / default / wide buckets) and `LABEL_CAP_H =
  round(38*0.7) = 27` height. The rendered box expands the tight box to
  **even multiples of a grid cell in BOTH dimensions** (`colWidth()` /
  `rowHeight()`, min 2 cells) and is **centered on the anchor**, so the
  box center is always on a grid point. The box always updates on
  `setText`. `bbox()` = centered box; `textPos()` returns the `<text>`
  `{x, y, anchor}` so the text is horizontally aligned inside the box
  (left/right/center) and **vertically centered** (baseline `y = anchor.y
  + LABEL_CAP_H/2`).
- **Sub / superscript editing**: labels support `_{...}` / `^{...}`
  markup (rendered as tspans). The inline label editor wraps a text
  selection with **Ctrl+, / Ctrl+.** (subscript / superscript); pressing
  again on the selection unwraps it, and a mixed selection reverts every
  touched group to plain text. The pure toggle lives in `model.js` as
  `applyMarkup(text, s, e, mark)` (unit-tested).
- **All components** auto-create an owned instance label in `addComponent`
  (text=refdes, align center) — every symbol sets `refPos:null` +
  `labelOffset`, so no id is drawn as plain font-12 `refPos` text.
- `fromJSON` uses `noLabel:true` then loads `data.labels`, drops orphaned
  owned labels.
- `nextRefdes(prefix)` returns smallest unused positive index (reuse after
  deletion).
- **Rotate / mirror is origin-anchored (pure, stable).** In Virtuoso mode,
  `r` rotates clockwise, `Shift+r` mirrors horizontally, and
  `Ctrl+Shift+r` mirrors vertically. The CLI `rotate` / `mirror` commands use
  the same origin-anchored transform: the origin never moves, so repeated
  transforms never translate the component and always stay on the 40-grid.
  Free labels are not orbited by rotate / mirror.
- Editor UX (main.js): labels are inserted through **insert mode** (`t`
  picks a label ghost, Enter/click commits at cursor; no normal-mode `t`).
  `L` starts persistent electrical net-label placement: a click must land on
  one unambiguous physical wire; at a crossing, one selected/highlighted net
  must identify the target or placement is rejected. Named nets add another
  occurrence; unnamed nets open a provisional inline edit. `Shift+N` starts
  persistent free-annotation placement. Both modes remain active until
  Escape. Net-label edits rename the physical net; annotation and owned-label
  edits change only their own text.
  Shift+ArrowLeft/Right cycle align; nudge h/j/k/l (and arrow keys) —
  **nudging moves the wires with the components** (a `moved` map is passed
  to `rerouteNet`, so nets whose terminals all ride nudged components
  translate rigidly, exactly like a drag); dd/Delete removes;
  double-click inline `<input>` (Enter/blur commit, Esc cancel); palette
  "label" button. **Multi-label selection** supported: `selLabels:Set`
  (plus `selLabel` = primary id), extends/deselects component `multi`.
  `setLabelSelection(ids, primary)` sets both; `setSelection`/Escape
  clears both. Selection overlay highlights all `selLabels`
  (`editorOverlay` `opts.selLabels`).
- Selection, move, and delete are role-aware: owned labels follow their
  components, net labels stay on their drawable net path, and free annotations
  move independently. Deleting a net-label occurrence does not delete or
  rename its physical net.

## Virtuoso mode

- The editor uses the Virtuoso command vocabulary in normal mode: `i` starts
  fuzzy placement; type to filter components and labels, press Enter to pick
  the best match, then click or press Enter to place the ghost.
- `w` is the single Wire command. It starts the wire workflow from a terminal,
  an existing wire, or a free grid point; click intermediate points and finish
  on a terminal or wire. `F3` toggles the route choice for new wires between
  orthogonal and diagonal. There is no separate uppercase-`W` protected-wire
  command.
- `m` arms connected move: moving a selected component carries or re-routes
  its electrical connectivity. `Shift+m` arms detached move: the moved
  terminal is removed from its net while the existing wire geometry is left in
  place as dangling wire geometry.
- `c` copies the selected set and arms placement of the copy. `r` rotates
  clockwise, `Shift+r` mirrors horizontally, and `Ctrl+Shift+r` mirrors
  vertically. Transforms are origin-anchored.
- `x` runs Check. `Shift+x` runs Check & Save.

### Persistent Design check

The right-side **Design check** panel retains the latest Check report until
another check is run. Its categories cover dangling/unconnected terminals,
component and label overlaps (including component–label and label–label
overlaps), wire body drills (segments through component bodies), managed
diagonal segments, grid errors, and cross-net collinear wire overlaps. Each
reported issue can focus the relevant component or net in the editor; Check &
Save saves after running the same report.

### Legacy fixed-net compatibility

Persisted nets with `routingMode: "fixed"` and literal paths remain loadable and
renderable, including legacy diagonal paths. This data compatibility does not
add a protected uppercase-`W` editor mode.

## Routing & connectivity

- **Touching pins connect:** `Circuit#connectCoincident()` joins any
  terminal that lands exactly on another component's terminal into one
  net (runs in `addComponent`, `moveComponent`, `setTransform`,
  `fromJSON`). Dropping a ground onto a MOS source connects them;
  dragging either component apart keeps the net and routes a wire between
  them. `fromJSON` runs it after loading explicit nets (guarded by
  `_loading`).
- **Managed nets are reduced to a minimum spanning tree (no parallel wires /
  loops).** Wiring two points that are already connected in the same managed
  net
  must never pile up duplicate or looped wires: every `wireTo`,
  `wirePointTo`, `connect`, `fromJSON`, and every drag commit
  (wireseg + component drags in `canvasMouseUp`, CLI `move`) runs
  `Circuit#_reduceNet`, which calls `reduceBranches` (wiring.js). That is
  a deterministic Kruskal MST over the net's connectivity graph — the
  conventional ratsnest-style reduction (KiCad `RN_NET::kruskalMST`,
  EAGLE RATSNEST): terminals + junctions (T/cross points) are the
  vertices, each polyline run between two vertices is an edge weighted by
  its Manhattan length, and parallel edges (2-cycles) and cycle edges are
  dropped, keeping the cheapest connected structure. Collinearly
  OVERLAPPING runs (a wire dragged on top of a same-net wire) are split
  at the overlap boundaries first, so the shared span becomes a parallel
  edge and merges into one drawn wire — no hidden overlapping geometry.
  Ties break by insertion order (older branches win), so the result is
  idempotent and deterministic; bridges are never removed and terminals
  always stay branch endpoints (wire legs keep re-anchoring on move).
  Closed single-branch loops are opened first so they reduce like any
  path. Covered by `reduceBranches` unit tests (wireedit.test.js) and the
  `wireTo`/`fromJSON`/drag-commit model tests.
- **Balanced routes keep terminal legs.** `normalizePath` (wiring.js)
  merges a collinear middle point ONLY when the run is monotonic; a point
  where the polyline reverses direction (e.g. the balanced route's
  terminal visit `(120,120)→(120,80)→(120,120)`) is a real vertex and is
  preserved. Without this, `clonePath` / `fromJSON` / render silently
  dropped a 3-way junction's terminal leg (the terminal stayed in the net
  but its wire vanished). Covered by `test/wireedit.test.js`.
- **Router pin escapes for orthogonal managed routes:** `smartRoute` generates
  "escaped" candidates that
  extend one grid cell OUTWARD from each pin (in its terminal `dir`, via
  `applyDir`) before bending, so a gate→drain wire leaves the gate west
  and approaches the drain from the north — a clean outside bend that
  never drills the body. The conform score prefers the escaped candidates
  for EVERY pin pair — including aligned ones (two gates sharing a column
  route as a gate-facing U in the channel one cell off the bodies, never
  as a straight run hugging the body edge). Facing pins (escapes collinear
  with the target) still collapse to a straight wire. Both `main.js` and
  `commands.js` `pinDir` honor `t.dir` first (bbox heuristic is the
  fallback). `scoreCandidate` ranks: bbox crossings, overlap, wire cross,
  component clearance, label clearance, pin conformity, LENGTH, then turn
  count — so among clearance- and direction-equal routes the shortest (and
  for symmetric placements, the symmetric) one wins.
- **Clearance:** `hardSafe` (router.js) keeps every committed segment at
  least one grid cell from every component bbox (pin-connected legs
  exempt); the routing env also carries `labelRects` — label boxes are
  SOFT obstacles (`labelScore` in `scoreCandidate`): the router prefers a
  channel one cell clear of a label when one exists, but never hard-blocks
  a connection through a label. Solder dots are excluded from both. Net labels
  remain attached to their physical net and must stay on drawable paths when
  moved or repaired; Check reports label/component and label/label overlaps.
  **Fresh layouts avoid other nets' wires:** `_netEnv(excludeNetId)`
  collects every OTHER net's explicit branches into `wires`, and
  `rerouteNet` / `_layoutFresh` / `Net.points()` pass the net's own id, so
  a re-laid-out net never collinearly overlaps a different net's drawn wire
  (crossing is still legal). Collinear overlap with another net is the one
  pattern that is never auto-created.
- **Multi-terminal managed nets route as an exact rectilinear Steiner minimum
  tree**
  (`steinerBranches` / `steinerRoute` in router.js, used by `autoRoute`,
  `balancedPaths`, `balancedRoute`). Dreyfus–Wagner subset DP over a coarse-grid
  graph (every cell of the terminals' padded bbox); edge cost is one cell plus
  penalties for pin-direction conformity (`CONFORM_SIDE=30` for a
  perpendicular escape, `CONFORM_OPP=8` for an opposite-direction one — the
  first cell from a pin must continue in the pin's direction, e.g. a diff-pair
  virtual-ground net's source pins escape DOWN and the T lands one cell below
  the pair row, never a pin-row trunk) and label clearance (LABEL_EPS) — total
  length is the primary objective, one-cell body clearance is a hard
  constraint, labels steer softly, and the bend/junction count falls
  out of the length optimum (a three-way Y becomes a single centered T at the
  coordinate median). Nets too large for the exponential DP fall back to the
  MST-of-shortest-paths Steiner 2-approximation, so any net is routable.
- **Wire-mode click priority:** terminal clicks (within `max(GRID/2,
  12px/unit)` via `nearestTerminal`) always start / end a wire in wire mode,
  even when a wire passes through the pin.
- **Wire click = select, click-and-drag = re-route.** A plain click on a wire
  selects its segment(s) and highlights them (orange in `editorOverlay`);
  **shift+click toggles more segments into the selection** (`selectedWires`
  set of `"netId:branch:segment"` keys, `selectedWire` = primary), and
  **drag-drag moves every selected run together** (same-orientation runs move
  as a group; runs of the other orientation stay put but stay selected). `dd` /
  Delete removes all selected segments at once via `Circuit#deleteWireSegments`
  (cuts are applied against one branch snapshot, so indices never shift under
  one another; the net splits into the connected components that remain). A
  click that never moves the pointer (or moves < threshold) just selects —
  it never mutates the net. A straight pin-to-pin run can't be dragged
  (`moveWireRun` keeps both pins fixed). **Escape cancels an in-progress drag**
  (`cancelDrag()` restores every pre-drag polyline) — the history entry is
  pushed once on mouseup, so undo/redo round-trip a committed drag.
  **`dragMoved()` = pointer moved BOTH >6px (client) AND >`GRID/2` (world)**,
  so jittery clicks never drag at any zoom, and a "drag" that never actually
  moves the run is still treated as a click (route restored, no history).
  **A plain click clears the drag state** — the wireseg click path in
  `canvasMouseUp` sets `drag = null` before returning, so a bare mousemove
  after clicking a wire never re-routes it (the old "sticky drag").
  **Wires win over component bodies in hit-testing:** normal-mode picking
  is label → exact terminal → wire (`pickWire`) → component bbox → empty
  space, so a wire running along/inside a component bbox is selectable and
  draggable (wires render on top; the body is only picked when no wire is
  under the cursor).
- **Highlighted net highlights its wires and junction solder dots only.**
  `editorOverlay` draws a blue halo over the net's paths and an r13 ring +
  dot over each junction solder; devices are NOT highlighted. `opts.nets`
  carries the highlighted nets and `opts.netSolder` the solder points.
- **Cross-net collinear overlap warning.** `crossNetOverlaps` (wiring.js)
  returns collinear overlapping spans between DIFFERENT nets; the editor
  recomputes it whenever wire geometry changes and renders the offending
  spans in red (`opts.warnOverlaps`) plus a `⚠ wire overlap with another
  net (highlighted)` status marker. Dragging net1's run onto a parallel
  run of net2 shows the warning live during the drag and it persists until
  the overlap is resolved.
- **Nets are renamable from the right toolbar:** double-click a net name
  in the nets list opens an inline `<input>` (Enter/blur commits through
  `Circuit#renameNet`, Esc cancels). A plain click re-renders the list and replaces
  the row, so the browser's native `dblclick` never fires — the rename
  double-click is detected manually in the click handler (timing + position
  fallback, like labels and wires). **Shift-click in the right-toolbar lists
  multi-selects:** components toggle in/out of the component selection,
  nets toggle in/out of the highlighted-net set (plain click replaces).
  **`Ctrl+A` selects every component, every label, and every non-empty net.**
  **Double-clicking a wire in the editor selects its net** (blue halo), via
  `ev.detail>=2` + a manual timing fallback (the headless CDP driver never
  fires a native `dblclick`).
- **Segment wire building:** in wire mode click a terminal (source), then
  click points to build the wire in segments; clicking or pressing
  **Enter** on a target terminal connects them (the hand-drawn path becomes
  the selected orthogonal or diagonal route, with collinear points collapsed
  where applicable). Pressing
  **Enter** on another wire's interior merges the two nets: the junction
  becomes a mid-wire anchor (`net.junctions`), the route walks both
  halves of the target wire from the junction, and a **solder** marks
  it. `rerouteNet` / `routeNet` walk nets that carry junctions through
  all anchors (terminals + junctions).
  **Terminal-to-terminal auto-routes that grow a net re-optimize it:**
  when a no-waypoint `wireTo` adds a NEW terminal to a net that now has
  3+ terminals (meet lands on a component terminal, not a wire interior),
  the net is re-laid-out fresh (`rerouteNet 'refresh'` → balanced Steiner
  `balancedPaths`), exactly like `connect()`. Chaining pairwise routes
  would otherwise leave an unbalanced bent net with the junction solder
  dot sitting on the port terminal (e.g. the CMOS inverter input net:
  VIN.p→M2.g then VIN.p→M1.g must become the centered T at (160,0), 600u).
  Wire-interior splices and waypoint-shaped routes still keep their drawn
  geometry.
- **Wiring starts from any point:** empty-space click in wire mode starts
  a free-point draft (`wire.source={x,y}`); clicking an existing wire
  starts a branch (`{x,y,netId}` — junction+solder materialize on
  commit). Committing a free/on-wire draft onto a terminal or wire
  **splices it into the target net preserving that net's existing wire**
  (never overwrites the route).
- **Connected drags re-route holistically:** moving / rotating / mirroring a
  component re-routes every touched net from its terminals + environment
  (`rerouteNet`), never hand-carrying wire bodies. Detached moves instead
  remove the moved terminal from its net while leaving the existing wire
  geometry as dangling wire geometry. Touching pins connect only at the
  COMMITTED position (mouseup / `move` command), never mid-drag.
  **Set moves carry their wires:** when EVERY terminal of a net rides a
  moved component by the same delta (a Ctrl+A multi-select drag), the whole
  net geometry — branches, route, junctions — is translated rigidly with
  the set. Polylines whose two ends ride DIFFERENT moved components do the
  same (or re-route fresh between the two new pins when the deltas differ).
  A defensive `_pruneDanglingBranches` then drops any branch whose endpoints
  are neither terminals, junction anchors, nor points shared by >=2 branches
  — floating stubs that lead nowhere never survive a component move
  (1-terminal deliberate wire stubs are left alone).
- **Clearance & consistency:** `smartRoute` keeps at least one grid cell
  of clearance from every component body (excluding the pin-escape legs),
  even if it means a longer way around. `Net.points()` uses the same
  escape-aware routing for route-null two-terminal nets, so committed and
  rendered wires always agree. Joined (multi-way) nets store explicit
  `net.branches` (list of polylines) and `net.junctions` (mid-wire
  anchor grid points); the renderer draws every branch and the model
  walks branches for bounds / length / eval.
- **Insert hotkeys → fuzzy search:** insert mode is type-driven — typing
  filters the component / label list (`fuzzyScore`: prefix > substring >
  subsequence, shorter wins), Enter picks the best match as a ghost,
  click/Enter places, Esc drops the ghost back to search, Esc again
  exits insert. Arrow keys move the cursor; all printable keys (incl.
  `h j k l`) go into the query. The `#insert-menu` dropdown shows the
  live query + filtered entries. (`PLACEMENT` map still labels the menu's
  hotkey column.)
- **Visual mode:** `v` (normal) anchors the cursor and draws a green box
  as `hjkl` / arrows move it; Enter commits the box selection
  (`applyBoxSelection` — components by bbox, labels by bbox, nets by
  route; shared with the mouse marquee) and exits; Esc cancels. Status
  bar shows VISUAL. **Marquee selection only captures objects COMPLETELY
  inside the box** (`rectContained`; a net only when every route point is
  inside) — merely intersecting a box selects nothing.

## Web UI

- **Zoom is clamped** so a grid cell never exceeds ~120px on screen
  (`minViewW()`) and the drawn grid never exceeds ~1000 lines
  (`maxViewW()`). `fitView`, drag-zoom, wheel zoom, right-click zoom-out
  and `resizeView` all clamp.
- **Dark mode**: `html.dark` class toggles CSS variables; the inline SVG
  ink is recolored via attribute-value CSS overrides
  (`html.dark .canvas svg [stroke="#111"] { stroke: #dde1e8 }`,
  `[fill="#fff"] → var(--paper)`, etc.) — presentation attributes are
  overridden by CSS, so no core renderer changes were needed and
  colored overlays (halos, wire source) are untouched. `#btn-theme`
  toggles, persisted in localStorage (`schematic-spawner:theme`),
  defaults to system `prefers-color-scheme`.
- **`#` toggles the grid** (`setGrid()`); `#btn-grid` mirrors it.
  Toolbar buttons carry `title` tooltips.
- **Z-order:** wires render ON TOP of component bodies (svgString draws
  components, then nets, then pin/junction dots) so an overlapping wire
  stays visible and clickable; labels and the overlay (selection halos,
  net highlights) draw last.
- **`D` toggles dark mode** (plus `#btn-theme`).
- **Copy / paste on selected sets:** `c` (with `y` / `Ctrl/Cmd+C` as aliases)
  captures the selected components + free annotations + every complete
  physical net whose terminals all sit on selected components (and explicitly
  selected complete terminal-less nets), keeping route / branches / junctions.
  Net labels travel only with their complete physical net; paste gives them
  fresh label/net ids and translated on-path anchors. They never degrade into
  annotations. `p` / `Ctrl/Cmd+V` (`pasteClipboard`) re-instantiates everything
  at the cursor, preserving relative positions and connectivity.
- Side-panel lists are condensed (smaller row padding / fonts) so the
  components / nets / terminals lists stay short.
- The design dropdown refuses to switch while the current design is dirty;
  save first with `Ctrl/Cmd+S` or the Save button. The selection is restored to
  the current design and an unsaved-changes warning is logged.

## Fast loop: CLI → server → browser

- **`POST /api/circuits/<name>/cmd`** — body `{ "cmd": "<line>" }` or
  `{ "cmd": "line1\nline2\n..." }`. Server loads the named circuit (or
  starts a new one), runs `runCommand` for each line, persists
  `circuits/<name>/circuit.json` + `circuit.svg` if any line mutated,
  and returns `{ name, mutated, results, state }`. The CLI is a thin
  HTTP client (`src/cli/index.js`) over this endpoint.
- **`GET /api/active`** → `{ active: "<name>" | "" }`. The server tracks
  the active circuit in memory and persists to `data/active.json`. Every
  `POST .../cmd` sets `active = <name>`; the browser's `syncActiveCircuit`
  polls this endpoint and **auto-loads** the active circuit on first open
  or whenever it changes. The user only has to keep the browser tab
  open — they never type a circuit name or click Load.
- **`PUT/POST /api/active`** → `{ active: "<name>" }` to set explicitly.
  **`DELETE /api/active`** → clears it.
- The browser poll is 500 ms (existing `syncActiveCircuit`). The same
  poll still syncs content updates for the loaded circuit. So one
  tick = "is the active different? switch if so" + "is the file
  different? merge if so". A switch whose load fails (the agent marked a
  brand-new circuit active before its first file write) does NOT advance
  the "seen active" state: the poll retries on every tick (logged once)
  until the circuit file appears — no manual refresh needed.
- Old behavior (CLI writes `data/state.json`, GUI Save writes
  `circuits/<name>/circuit.json`, two unrelated paths) is gone.

## Editor behavior — hotkeys

- Virtuoso normal mode: `i` fuzzy placement; `w` the single Wire command;
  `F3` toggles orthogonal vs diagonal routing; `m` connected move;
  `Shift+m` detached move; `c` copy; `r` rotate clockwise;
  `Shift+r` horizontal mirror; `Ctrl+Shift+r` vertical mirror; `x` Check;
  `Shift+x` Check & Save. Uppercase `W` is not a separate wire mode.
- `t` in insert mode places a label ghost; `v` enters visual mode.
  `Esc` cancels a ghost, box, or drag.
- `dd` delete selection (chord). `Delete` / `Backspace` same.
- `u` / `Ctrl+Z` undo; `U` / `Ctrl+Y` / `Ctrl+R` redo.
- `p` / `Ctrl/Cmd+V` paste at cursor. (`y` and `Ctrl/Cmd+C` remain copy
  aliases; `yy` is not required.)
- `Ctrl/Cmd+S` saves the current design.
- Ctrl/Cmd-drag a selected component set to duplicate it, then drag the copy.
- `hjkl` move cursor; in visual mode, grow box; in insert mode, part of
  the query.
- `F` fit view; `D` toggle dark mode; `#` toggle grid; `?` keymap.
- All printable keys (incl. `h j k l`) in insert mode append to the
  fuzzy query.

## Working-context notes

- `npm test` = **182/182** green (model / commands / router / render /
  wireedit / multinet / symbols). The HTTP endpoint reuses `runCommand()` and is
  covered by the existing tests; the CLI is a thin client over it and is
  exercised by `npm test` only for argument parsing (the server itself is
  verified by the smoke test below).
- CDP browser suites (headless chromium) live in `/tmp/opencode/`:
  - `mos_label_test.mjs` — NMOS / PMOS hotkeys, PMOS defaultMirrorY,
    MOS id label on bulk side / gate height, double-click inline edit,
    Ctrl+A + marquee label selection, wire follows moved / rotated /
    mirrored terminal.
  - `feature_test.mjs` — insert-mode `#insert-menu`, switch components,
    normal-mode `t` is no-op for labels, owned-label moves when its
    component is nudged, `u`/`U` undo / redo, mixed component+free-
    label Ctrl+A drag.
  - `ghost_test.mjs` — insert-menu is `pointer-events:none` and hides
    during ghost, `n` / `p` / `t` etc. select ghosts, Escape cancels,
    all parts get owned instance labels.
  - `wiredrag_test.mjs` — `__circuit().nets[i].route` is the live
    array; drag an interior run collapses a corner, drag a run
    touching a terminal extends with a connector.
- CDP notes: headless **never fires native `dblclick`** — dispatch
  clickCount 1 then 2 (real CDP `Input.dispatchMouseEvent` with
  `clickCount:2`); the inline `<input>` selector is
  `input[style*="position: absolute"]`; Ctrl+A =
  `keyDown('a',{modifiers:MOD,code:'KeyA',keyCode:65})`;
  `__circuit().comps` returns **serialized** (flat
  `{refdes,type,x,y,rot,mx,my}`, no `transform`) so assert on `c.x`.
  Inline-editor Escape closes the editor first; a second Escape exits
  insert mode.
- Router: scoring `[bboxCrossings, wireCross, overlap, conform, turns,
  length]` with diagonal filtering; `segThroughInterior` (wires
  leaving a boundary pin straight through own body are violations;
  boundary-hugging legal); `evaluate().wireThroughBBoxes` uses it.
  `astar()` is the live `smartRoute` fallback (NOT dead code).
- `window.__circuit()` debug hook returns `{ comps, nets, labels }`
  where labels include a `world` anchor.
- `window.__run(cmd)` runs a single command on the visible circuit.
- `window.__load(state)` overwrites the visible circuit from a JSON
  state object.
- Demo circuit is **gone** (`src/core/templates.js` deleted, `demo`
  command + `#btn-demo` toolbar button removed). `test/commands.test.js`
  uses a tiny inline `smallCircuit()` for report / svg tests.

## Test-env facts

- **CDP sessions:** use isolated random HTTP and Chromium debug ports for each
  developer session. Track the server/browser processes you own and shut down
  those exact processes only; never use broad `pkill` against the live editor
  or a shared browser.
- `serve.js` sends `Cache-Control: no-store`; `index.html` `main.js?v=7`.
- `circuits/`, `data/`, `node_modules/` are gitignored. `data/active.json`
  is the live record of which circuit the agent is editing.
- Browser open without an active circuit loads an empty editor (or the
  localStorage draft); as soon as the agent POSTs a command, the active
  circuit switches and the browser auto-loads it.
