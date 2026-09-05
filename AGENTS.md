# schematic-spawner — working context

Programmatic/agent-assisted schematic editor. Connectivity-based model rendered to SVG.
Repository: private `ojarvin/schematic-spawner`.
Push over HTTPS only: SSH is unavailable headlessly; `origin` is HTTPS and `gh` is the credential helper.

## Agent roles and source of truth

Choose a role from [`guidelines/README.md`](./guidelines/README.md):

- **Developer** — improve the application; read [`guidelines/DEVELOPER.md`](./guidelines/DEVELOPER.md).
- **Circuit author** — draw circuits in the running editor; read [`guidelines/CIRCUIT-AUTHOR.md`](./guidelines/CIRCUIT-AUTHOR.md).

Both roles share [`guidelines/style-guide.md`](./guidelines/style-guide.md). This file is the live specification for current symbol geometry, labels, routing, and editor UX. Keep it accurate when behavior changes.

## Visual and symbol rules

All symbols use the classic Razavi/textbook look: filled gate bars, arrowheads, and power slabs are `polygon` graphics with `fill:'foreground'`; symbol linework uses butt caps and miter joins. `style.js` stroke roles are `symbol` (normal, butt), `wire` (round endpoint caps, miter joins), `emph` (9.6), `ground` (11.6), `supply` (7.2), and legacy `LINE` / `THICK`. SVG defaults to bottom annotations, middle wires, and top components/labels; `drawOrder` only restacks objects within their category. `fontAttrs('instance'|'label')` is unchanged.

Labels support `_{...}` markup, such as `C_{GS}`. Owned instance labels auto-subscript a trailing numeral (`M1` renders as `M` with subscript `1`). Alignment, anchors, and the bbox model are unchanged; `textWidth` scales sub/superscript runs by ×0.62.

### Current symbol geometry (40-unit grid)

These values affect tests and wire routing:

- **resistor, capacitor, inductor, switch*, variable_***: terminals `a`(-80,0) and `b`(80,0); 160-wide bbox `{-80,-40,160,80}`. Capacitor plates are at x -12.94 and 12.94; the inductor coil spans x -58.49..58.49, centered on the origin. Diode uses the same centered footprint and terminals.
- **nmos, pmos**: `g`(-120,0), `d`(0,-80), `s`(0,80); bbox `{-120,-80,120,160}`. The gate has two filled bars at x -87.2..-75.6 and -66.3..-54.6. NMOS source arrow points out; PMOS source arrow points into the channel. PMOS has `defaultMirrorY:true`, placing its source up. **nmosb, pmosb** add `b`(0,0), `dir:{x:1,y:0}`, and `direction:'bulk'`; an internal symbol-style path joins the channel edge near x=-54.65 to `b`. PMOS bulk retains `defaultMirrorY:true`. Their bulk label offset is `{40,-40}` (one grid cell toward local drain); plain MOS labels remain `{40,0}`.
- **npn, pnp**: `b`(-160,0), `c`(0,-120), `e`(0,120); PNP has collector bottom and emitter top. Filled emitter arrow, `emph` base bar, bbox `{-160,-120,160,240}`, and label at `{40,0}` on the right.
- **ground**: `gnd`(0,0), stub to y40, three `ground`-width bars at y 40/63.26/84.19, bbox `{0,0,80,120}`. **supply**: `p`(0,0), filled slab above, bbox `{-40,-80,80,80}`.
- **vcm**: `vcm`(0,0), upward-escaping terminal, downward stub to y24, open outline-only downward triangle from y24 to y56 (56 wide, 32 deep), bbox `{-40,0,80,80}`. No instance label; normal `symbol` stroke.
- **current_source, voltage_source**: `a`(0,-80), `b`(0,80), circle radius 35 with leads from ±35, bbox `{-40,-80,80,160}`, label center offset `{-80,0}` so a one-square default label's bbox edge is 40 units left of the origin. Current source has a filled downward arrow; voltage source has ± marks. Ref prefixes `I` and `V`.
- **opamp**: `ip`(-200,40), `im`(-200,-40), `o`(160,0). **opamp_diff** adds `op`(160,-40) and `om`(160,40); both use bbox `{-200,-120,360,240}` and ref prefix `U`. Differential output leads leave the slanted edges at x≈12.8/12.81 and run to x=160. All polarity marks are 28 units, centered at y=±40: input −/+ at x≈-76; output is flipped +/− at x≈-38 (`op` top, `om` bottom), clear of the body. Plain opamp input marks use the same rows.
- **inverter, buffer**: `a`(-120,0), `y`(120 or 80,0).
- **and, or, nand, nor**: `a`(-120,-40), `b`(-120,40), `y`(120,0). **xor, xnor** use `y`(160,0). Logic ref prefix is `U`. Every body is one continuous closed path (`Z`). AND/NAND top edge meets the curved front without a seam. OR/NOR concave backs shift left by -8 to overlap input lead tips ending at x=-76.88. XOR/XNOR shift the body and extra input-side line left by -22 together; that line lands on wire tips at x≈-77, and wires stop there rather than entering the gap between curves. Output lead and negation bubble shift with the body. Buffer/inverter triangles are closed with `Z` for a sharp miter; the inverter apex is hidden by its bubble.
- **adc, dac**: `emph` outline. ADC has a pointed analog-input side and flat digital-output side; DAC is reversed. ADC terminals `ain`(-200,0), `d`(200,0); DAC terminals `d`(-200,0), `aout`(200,0). A short diagonal slash crosses the digital lead. Centered upright label-font text says `ADC` or `DAC`; bbox `{-200,-120,400,240}`.
- **solder**: annotation dot only, radius `SOLDER_DOT_RADIUS=12`, exact bbox `{-12,-12,24,24}`. It is selected at its junction grid point, not as a grid cell. Terminal-less annotations are exempt from `validateSymbol`'s bbox-on-grid rule and from routing-environment and `evaluate()` overlap checks.
- **port, port_filled**: Razavi circle marker, terminal `p`(0,0), circle left of the lead. **input, output, inputoutput**: boxed Razavi ports with ref prefixes `I`, `O`, `IO`, owned id label to the left at label offset `{-120,0}`. `output` has `defaultMirrorX:true`, putting its terminal on the circuit side and its box/arrow outward; the label offset mirrors with the symbol.
- **variable_resistor, variable_capacitor, variable_inductor**: composed at load time from the plain symbol definitions (`[...base.graphics, ...ADJUST]` in `variable.js`) so body geometry tracks the base. Adjustment arrow is a 45° shaft `M -48 48 L 36 -36` with filled head tip at (48,-48).

Label offsets: nmos/pmos `{40,0}`; nmosb/pmosb bulk labels `{40,-40}`; npn/pnp `{40,0}`; resistor/variable/capacitor/inductor/diode `{0,80}`; switch `{0,40}`; sources `{-80,0}`; ports `{-120,0}`; logic/opamps below the body.

`ComponentInstance` applies `defaultMirrorX/Y` only when the corresponding `opts.mirror*` is `undefined`. The CLI `add` command omits mirror flags unless explicitly passed, so symbol defaults apply everywhere.

## Labels, selection, and transforms

Labels are not symbols or components. They live in `circuit.labels: Map<id, LabelInstance>` and provide no connectivity. A `LabelInstance` has exactly one role:

1. owned instance label: `owner` is a component refdes and `offset` is local;
2. persistent electrical net label: `netId` identifies one physical net; or
3. free annotation: `owner:null`, `netId:null`, independent text and anchor.

A `netId` identifies one physical net and its drawable geometry. Nets with the same canonical name are only a logical naming/reporting group; equal names never connect separate physical nets.

Use `addNetLabel`, `renameNet`, and `renameNetLabel`; editor code must not assign `net.name` directly. Net-label text derives from the physical net name. Removing one label occurrence leaves the net and name intact. A provisional label on an unnamed net is committed atomically only after a non-empty name; otherwise it is discarded.

Editor `L` starts persistent electrical net-label placement. A click must land on one unambiguous physical wire; at a crossing, one selected/highlighted net must identify the target or placement is rejected. Named nets add another label occurrence. Unnamed nets open the provisional inline edit described above. `Shift+N` starts persistent free-annotation placement. Both modes remain active until Escape. Editing a net label renames its physical net; editing an annotation or owned label changes only that label.

`LabelInstance` fields: `id`, `text`, `align` (`center|left|right`), `owner` (`refdes|null`), local grid-snapped `offset` for owned labels, world grid-snapped `anchor`, and net-label `netSide` (`above|below|left|right`).

Label bboxes use tight per-glyph widths (`LABEL_FONT_SIZE=38`, matching rendered `INSTANCE_FONT` / `LABEL_FONT`; `LABEL_CHAR_W=8` at font 12 for the bold/italic label face; narrow/default/wide buckets) and `LABEL_CAP_H=round(38*0.7)=27`. Rendering expands the tight box to even grid-cell multiples in both dimensions (`colWidth()` / `rowHeight()`), minimum two cells. Free and owned labels center on their anchors. Net labels keep the electrical anchor on the wire and put one box edge on it: `above` for horizontal paths and `left` for vertical paths. `setText` always updates the box. `textPos()` returns the `<text>` `{x,y,anchor}`, horizontally aligned inside the box and vertically centered.

Inline label editing supports `_{...}` and `^{...}` rendered as tspans. Ctrl+, and Ctrl+. wrap a selection as subscript/superscript; repeating the same operation unwraps it, and a mixed selection makes every touched group plain text. The pure helper is `model.js` `applyMarkup(text,s,e,mark)` and is unit-tested.

`addComponent` auto-creates an owned instance label (`text=refdes`, centered). Every symbol uses `refPos:null` plus `labelOffset`; no id is drawn as legacy plain font-12 `refPos` text. `fromJSON` constructs components with `noLabel:true`, then loads `data.labels` and drops orphaned owned labels. `nextRefdes(prefix)` returns the smallest unused positive index, reusing numbers after deletion.

Style controls and style paste recolor component owned labels and annotation child labels. Coloring a whole net also updates all per-segment wire color overrides.

Transforms are origin-anchored and pure: component origin never moves, repeated transforms remain stable and grid-aligned. In Virtuoso mode and ghosts, `r` rotates clockwise, `Shift+r` mirrors horizontally, and `Ctrl+r` mirrors vertically; `Ctrl+Shift+r` is unbound. CLI `rotate`/`mirror` use the same component transform. Set transforms use the exact selection midpoint, including half-grid midpoints, so odd-width sets mirror stably. Mirrors use world horizontal/vertical axes even after component rotation. Free labels are never orbited by transforms. Rotating a multi-component set rotates positions and individual orientations around the set midpoint.

Owned labels follow components. Net labels stay attached to drawable paths, switch above/below or left/right according to drag side, and keep their bbox edge on the wire; dragging projects attachment to the nearest drawable point. Free annotations and wire geometry move independently. Annotation defaults are calculated once: box labels center above the top edge with their bottom edge touching it; arrow labels attach a text-box corner to the arrow base according to arrow quadrant. Later movement is independent.

Selection is role-aware across components, owned labels, free annotations, net labels, and wire segments. `selLabels:Set` plus primary `selLabel` supports multi-label selection; Shift-clicking an annotation and its text label in either order preserves both. `setLabelSelection(ids,primary)` updates both; `setSelection` and Escape clear both. `editorOverlay` highlights every `selLabels`. Shift+ArrowLeft/Right cycles label alignment. Nudge with h/j/k/l or arrows moves wires with components by passing a `moved` map to `rerouteNet`; nets whose terminals all share a delta translate rigidly, like a drag. `dd`/Delete removes the selected role-aware set. Double-click opens an inline `<input>`; Enter/blur commits and Escape cancels. The palette has a label button.

Selecting a net from the side panel or double-clicking its wire selects its junction solder components too. A highlighted net draws a blue halo over its paths and an r13 ring plus dot over each junction solder; devices are not highlighted. `opts.nets` carries highlighted nets and `opts.netSolder` carries their solder points.

The nets list and wire highlighting identify the physical net targeted by wire repair. When two physical nets occupy coincident geometry, select/highlight exactly one of them before editing; the selected net is the target, so either coincident net can be deliberately repaired without merging the nets. For tied wire picks, an explicit `selectedNets` preference outranks `diagnosticSelection.nets`; the diagnostic preference applies only when it identifies exactly one tied candidate. Stale or non-candidate IDs are ignored, and original iteration order is the deterministic fallback. Cross-net positive-length collinear overlap remains an electrical violation and is never auto-merged. Equal net names do not change this physical-net distinction.

## Virtuoso editor

Normal mode uses this vocabulary:

- `i` starts fuzzy placement. Type to filter components and labels; Enter or Tab picks the best match, then click or Enter places the ghost. Fuzzy ranking is prefix > substring > subsequence, with shorter matches first. `#insert-menu` shows the live query and filtered entries; its `PLACEMENT` map labels the hotkey column. All printable keys, including h/j/k/l, append to the query. Arrow keys move the cursor. `t` selects a label ghost only in insert mode; normal-mode `t` does nothing for labels. Escape first drops a ghost back to search, then exits insert.
- `w` is the only Wire command. It starts from a terminal, existing wire, or free grid point. Clicks on terminals commit immediately; other clicks add committed route points. The live preview autoroutes each leg from the source through those points to the cursor. Press Enter to commit at any nonterminal point, including an open-ended wire. F3 toggles orthogonal/diagonal routing for new wires. There is no uppercase-W protected-wire editor mode.
- `m` arms connected move. Before a ghost exists, drag from empty space to box-select a complete set; click any member of a preselected component/label/net/wire set to start the same whole-set ghost, regardless of whether the hit is a component, label, annotation, or wire. Moving any selected component, label, annotation, or wire segment carries or re-routes its electrical connectivity; the moving set and connected wires are faint ghosts until the destination commits. `Shift+m` arms detached move with the same source-hit rule: selected wire islands split from their nets, move with the selected component set, and retain selected terminal connections; unselected islands remain floating. Wire can reconnect split ends.
- `c` starts repeated copy. Before a ghost exists, drag from empty space to box-select a complete set; when a set is already selected, clicking any of its members—including a wire—starts the same complete copy source rather than narrowing the selection. Move the ghost, then click or Enter to commit; each later click commits another copy at that cursor. The clicked source point is the copy anchor, not the set bbox center. Relative geometry is preserved. Rotate/mirror before placement persist; each transform uses the current copy point and rebases the follow origin, so later motion is only pointer delta. Escape cancels the ghost and returns to copy-tool source selection.
- `x` runs Check; `Shift+x` saves without checking. The Design check panel has Clear; deleting an object clears stale report and focus.

Connected move/transform ghosts remain one atomic history entry. Insert ghosts use the same world-space transform semantics. Touching pins connect only at committed position, never during a drag.

### Wire interaction

Terminal clicks have priority in Wire mode: `nearestTerminal` accepts a click within `max(GRID/2,12px/unit)`, even when a wire crosses the pin. A wire click selects its segment(s) and highlights them orange; Shift-click toggles `selectedWires` keys of the form `netId:branch:segment`, with `selectedWire` as primary. Dragging moves every selected run: same-orientation runs move as a group; other orientations stay put but selected. A single aligned segment between topology points is independently bounded; adjacent aligned segments move together only when both are selected. Ordinary straight pin-to-pin runs cannot drag unless explicitly bounded by topology (`moveWireRun` keeps direct pins fixed).

`dd`/Delete calls `Circuit#deleteWireSegments`; all cuts use one branch snapshot so indices do not shift, and remaining geometry splits into connected components. A click that does not move, or moves less than threshold, never mutates the net. `dragMoved()` requires both >6 px client movement and >`GRID/2` world movement. Escape calls `cancelDrag()` and restores every pre-drag polyline. History is pushed once on mouseup; undo/redo round-trips a committed drag. A plain wire click sets `drag=null` before returning, preventing a later mousemove from causing a sticky reroute.

Normal picking order is label → exact terminal → wire (`pickWire`) → component bbox → empty space. Wires render behind bodies by default, but remain selectable and draggable inside or along a component body.

Wire-mode construction starts with a terminal, empty-space point (`wire.source={x,y}`), or existing wire (`{x,y,netId}`). Clicks on terminals commit immediately; clicks elsewhere add route points. The preview autoroutes each leg from the source through committed points to the cursor, and Enter commits the resulting managed route at a free point or wire interior, so an endpoint need not be a terminal. Collinear points collapse where valid. Enter on wire interior merges nets: the junction is a mid-wire anchor in `net.junctions`, both target-wire halves are walked, and a solder dot is created. `rerouteNet` and `routeNet` walk all anchors (terminals and junctions). At a coincident cross-net span, selection/highlighting of one physical net is required to identify the wire being edited; the overlap itself does not create a junction.

During partial connected-set moves, outside wire bodies remain fixed and boundary legs re-anchor; branches wholly inside the moved set translate with same-delta endpoint terminals. Connected component moves, rotations, and mirrors reroute every touched net holistically from terminals plus environment (`rerouteNet`) rather than hand-carrying wire bodies. Detached moves split selected islands and leave unselected islands in place. If every terminal of a net rides a moved component by the same delta (including Ctrl+A drags), translate all branches, route, and junctions rigidly. A polyline whose endpoint terminals ride components with matching deltas also translates; differing deltas re-anchor both legs while retaining the authored body. `_pruneDanglingBranches` drops branches whose endpoints are neither terminals, junction anchors, nor points shared by at least two branches; intentionally detached floating islands are retained.

## Routing and connectivity invariants

`Circuit#connectCoincident()` joins terminals that land exactly together. It runs in `addComponent`, `moveComponent`, `setTransform`, and `fromJSON`; loading runs it after explicit nets with `_loading` guarding recursion. Dropping ground on a MOS source connects them. Moving either component apart retains the net and routes a wire between them.

Managed nets are reduced to a deterministic minimum spanning tree by `Circuit#_reduceNet` → `reduceBranches` in `wiring.js` when geometry is freshly created, explicitly edited, loaded, or intentionally re-routed. Topology growth through `wireTo`, `wirePointTo`, and `connect` appends one smart-routed branch and preserves every existing branch; it does not reduce or refresh the whole net. Explicit wire edits and transform/reroute commands remain the user-controlled geometry changes. Vertices are terminals and T/cross junctions; each polyline run between vertices is an edge weighted by Manhattan length. Parallel/duplicate and cycle edges are removed only at those explicit repair boundaries, including collinear overlaps after splitting at overlap boundaries. Reducer overlap boundaries are not junctions. Managed same-net positive collinear overlaps are pruned when endpoint-coincident pieces reconnect after copy/move; cross-net positive overlaps remain violations and are never merged automatically. Old…

`normalizePath` removes a collinear middle point only on a monotonic run. A reversal at a terminal or junction is a real vertex and is preserved; this prevents clone/fromJSON/render from dropping a terminal leg in a balanced three-way net. Joined managed nets store explicit `net.branches` (polylines) and `net.junctions` (mid-wire anchors); single route-null two-terminal nets may derive their route from `Net.points()`.

### Router behavior

For orthogonal managed routes, `smartRoute` adds candidates that escape one grid cell outward along each terminal's `dir` (`applyDir`) before bending. Thus gate→drain leaves the gate west and approaches the drain from north, outside the body. Escaped candidates are preferred even for aligned pins; two gates sharing a column use a gate-facing U in a one-cell-off channel instead of a body-hugging straight line. Facing escapes collapse to a straight wire. `main.js` and `commands.js` `pinDir` prefer `t.dir`, falling back to bbox heuristics.

`hardSafe` keeps committed segments at least one grid cell from every component bbox, exempting valid pin-connected escape legs. The shared MOS gate-bus exception allows a managed segment through the strict interior of an NMOS/PMOS body, including bulk variants, only if at least two MOS gate terminals share that physical net, the segment touches the crossed device's gate pin, and it follows that gate axis. `hardSafe`, automatic move validation, and `evaluate().wireThroughBBoxes` use the same exception; it never permits source, drain, bulk, passive, supply, or unrelated-net body crossings. Boundary-hugging is legal.

The routing environment includes `labelRects` as soft obstacles: `labelScore` prefers a one-cell-clear channel when available but never blocks a route through a label. Solder dots are excluded. Net labels remain electrically anchored to a drawable path and put a bbox edge on it. Fresh layout uses `_netEnv(excludeNetId)` to include every other net's explicit branches as wires, so `rerouteNet`, `_layoutFresh`, and `Net.points()` never auto-create collinear overlap with another net; crossings remain legal. `crossNetOverlaps` reports existing cross-net collinear spans.

Two-point candidate scoring is lexicographic: `[bboxCrossings, overlap, wireCross, componentClearance, labelClearance, pinConform, turns, length]`. After safety and spacing, fewer visible bends win before route length. A* (`astar`) is the live `smartRoute` fallback, not dead code. Diagonal candidates are filtered according to route mode.

Three or more terminals use `steinerBranches`/`steinerRoute` through `autoRoute`, `balancedPaths`, and `balancedRoute` for fresh layouts and explicit full-net reroutes. A topology-growth click does not invoke those whole-net optimizers: it previews a smart route and commits only the new branch. The exact rectilinear Steiner attempt uses Dreyfus–Wagner subset DP on every coarse-grid cell in the terminals' padded bbox, under hard body clearance. Edge cost is one cell plus pin-conformity penalties (`CONFORM_SIDE=30` for perpendicular escape; `CONFORM_OPP=8` for opposite direction) and label clearance (`LABEL_EPS`). The first cell from a pin follows its direction; for example, a differential-pair virtual-ground source escapes downward and the T lands below the pair row, never on the pin row. The DP minimizes total tree length. Large nets fall back to an MST-of-shortest-paths Steiner 2-approximation, so all fresh layouts remain routable.

## Design Check and compatibility

The right-side **Design check** panel retains the latest report until another Check, object deletion, or Clear. Categories: dangling/unconnected terminals; component, component–label, and label–label overlaps; wire drills through component bodies; managed diagonal segments; grid errors; and cross-net collinear wire overlaps. Each issue focuses its component or net. Normal selection clears diagnostic focus without discarding the report. Save writes the design without requiring a passing check.

Persisted `routingMode:"fixed"` nets with literal paths, including legacy diagonals, remain loadable/renderable. This compatibility does not create a protected uppercase-W editor mode. Fixed paths re-anchor endpoints on component movement without autorouting; moving a complete selected set translates fixed paths with it.

## Web UI and persistence

- Zoom is clamped so a grid cell is never over about 120 px and the grid never exceeds about 1000 lines. `fitView`, drag-zoom, wheel zoom, right-click zoom-out, and `resizeView` all clamp via `minViewW()` / `maxViewW()`.
- `html.dark` toggles CSS variables. Inline SVG presentation attributes are recolored by CSS overrides (for example, `.canvas svg [stroke="#111"]` and `[fill="#fff"]`), so core renderer colors need not change. Dark mode makes the crosshair amber, hides it outside the drawing area, and leaves colored halos/wire-source overlays untouched. `C` and `#btn-crosshair` toggle it. `#btn-theme` toggles and persists `schematic-spawner:theme` in localStorage, defaulting to system `prefers-color-scheme`.
- `#` calls `setGrid()`; `#btn-grid` mirrors it. Toolbar buttons have `title` tooltips. SVG z-order is crosshair, bottom annotations, middle wires, top components/labels, pin/junction dots, then selection/net overlays. Back/Front restacks selected objects only within their default layer.
- `?` and Help open a modal keyboard/command reference. The search field receives focus, typing filters the reference, and only the reference pane scrolls. Escape closes it.
- Copy mode is `c` (`y` and Ctrl/Cmd+C aliases). If nothing is selected, the source click copies the clicked component, label, or wire; otherwise the complete selected component/label/wire/net set is copied regardless of click location. The clicked point is the cursor anchor. A ghost follows the cursor; click/Enter commits and later clicks commit more copies without leaving copy mode. Escape cancels the ghost to source selection. A single copied object carries color, line style, and width; a set has no style source. Ctrl+Shift+V applies a single copied object's style to the current selection wherever supported.
- A complete physical net is copied only when all its terminals are on selected components, or when a complete terminal-less net is explicitly selected. Its route/branches/junctions and net labels are preserved; pasted labels and nets receive fresh IDs and translated on-path anchors, never becoming annotations. `p` / Ctrl/Cmd+V (`pasteClipboard`) remains one-shot paste at the cursor and preserves relative positions/connectivity.
- Components/nets/terminals side lists are condensed. Switching designs from the dropdown prompts when dirty: Keep cancels; Discard abandons unsaved changes and loads the selected circuit.

### CLI → server → browser fast loop

`POST /api/circuits/<name>/cmd` accepts `{ "cmd":"<line>" }` or `{ "cmd":"line1\nline2\n..." }`. The server loads the named circuit or starts one, runs `runCommand` for each line, saves `circuits/<name>/circuit.json` and `circuit.svg` if anything mutated, and returns `{ name, mutated, results, state }`. The CLI (`src/cli/index.js`) is a thin HTTP client over this endpoint.


`GET /api/active` returns `{active:"<name>"|""}`. The server tracks the active circuit in memory and persists it to `data/active.json`; every command POST sets it. `PUT`/`POST /api/active` sets it explicitly; `DELETE` clears it. `syncActiveCircuit` polls every 500 ms, switches/auto-loads the active circuit on first open or change, and still merges file updates for the loaded circuit. A valid named browser draft restored on reload wins the first active poll, so the currently edited schematic is not replaced by stale server-active state; later active changes still load normally. If a newly marked active circuit has no file yet, the failed load does not advance the seen-active state; polling retries each tick and logs once until the file appears. Users do not need to type a circuit name or click Load.

- Normal: `i` insert/search, `w` Wire, F3 route mode, `m` connected move, Shift+`m` detached move, `c` repeated copy, `r` rotate, Shift+`r` horizontal mirror, Ctrl+`r` vertical mirror, `v` visual, `x` Check, Shift+`x` Save.
- Insert: `t` label ghost, Tab best match, printable keys query, arrows/hjkl cursor, `r`/Shift+`r`/Ctrl+`r` world transforms, Escape ghost/search exit.
- Visual: `v` anchors a green box; hjkl/arrows grow it; Enter commits `applyBoxSelection` and exits. In Delete mode Enter deletes fully contained selection and stays armed. Mouse marquee uses the same complete-containment rule, deletes on mouseup in Delete mode, and selects nets only when every route point is inside. Intersection alone selects nothing. Escape cancels; status says VISUAL.
- Delete: `dd`, Delete, or Backspace deletes the selected component/label/net/wire set. With no selection Delete/Backspace arms persistent Delete mode; clicks delete until Escape. In Wire mode Backspace removes the latest uncommitted vertex.
- History: `u`/Ctrl+Z undo; `U`/Ctrl+Y redo. Insert-search typing treats `u` as query text. Undo while a ghost is active cancels an uncommitted ghost first; undo while Copy/Move is armed removes only the last action and re-arms the tool. Copy-ghost undo cancels the uncommitted ghost before undoing its last committed copy.
- Paste/style/save: `p` / Ctrl/Cmd+V one-shot paste; `y` / Ctrl/Cmd+C copy aliases; Ctrl/Cmd+Shift+V style paste; Ctrl/Cmd+S save. Ctrl/Cmd-drag duplicates a selected component set, then lets the copy move.
- Cursor/view: hjkl moves the cursor; F fits; D toggles dark mode; `#` grid; C crosshair; `?` help (Escape closes). Ctrl+i toggles italic and Ctrl+b bold on selected labels. `Ctrl+Shift+r` is intentionally unbound.

## Verification and test-environment facts

`npm test` runs the Node test runner over `test/**/*.test.js` (model, commands, router, render, wireedit, multinet, symbols, and CircuitSpec). The HTTP endpoint reuses `runCommand`; CLI tests cover argument parsing. Use the browser smoke tests below for server/editor behavior rather than relying on unit tests alone.

Headless CDP suites live in `/tmp/opencode/`:

- `mos_label_test.mjs`: NMOS/PMOS hotkeys, PMOS defaultMirrorY, MOS bulk-side/gate-height labels, inline edit, Ctrl+A/marquee labels, and wires following moved/rotated/mirrored terminals.
- `feature_test.mjs`: insert menu, switches, normal-mode `t`, owned-label nudge, undo/redo, and mixed component/free-label Ctrl+A drag.
- `ghost_test.mjs`: insert-menu pointer-events/hiding, ghost selection (`n`, `p`, `t`, etc.), Escape, and owned labels on all parts.
- `wiredrag_test.mjs`: live `__circuit().nets[i].route`, interior-run corner collapse, and terminal-run connector extension.

CDP rules: use one persistent connection per session, isolated random HTTP and Chromium debug ports, and terminate only processes you started. Never use broad `pkill`. Headless Chromium does not fire native `dblclick`; use real `Input.dispatchMouseEvent` with clickCount 1 then 2. Inline editors match `input[style*="position: absolute"]`. Ctrl+A is `keyDown('a',{modifiers:MOD,code:'KeyA',keyCode:65})`. `__circuit().comps` is serialized flat `{refdes,type,x,y,rot,mx,my}` with no `transform`; assert `c.x` etc. Inline-editor Escape closes the editor first; a second Escape exits insert mode.

Debug hooks: `window.__circuit()` returns `{comps,nets,labels}`, with label `world` anchors; `window.__run(cmd)` runs one command on the visible circuit; `window.__load(state)` replaces the visible circuit from JSON. The demo circuit is gone (`src/core/templates.js`, `demo`, and `#btn-demo` were removed); command report/SVG tests use an inline `smallCircuit()`.

`serve.js` sends `Cache-Control: no-store`; `index.html` references `main.js?v=7`. `circuits/`, `data/`, and `node_modules/` are gitignored; `data/active.json` is the live active-circuit record. With no active circuit, the browser opens an empty editor or localStorage draft; the first command POST marks its circuit active and the browser loads it automatically.

When starting a server, `npm start` and `npm run serve` use Node watch mode, so imported source changes—including the symbol registry—restart the process automatically. Direct `node src/web/serve.js` launches a fixed process and must be restarted after source changes.

## Generated placement

Phase 2's pure analog placement seam is `src/core/placement.js` (`placeCircuit` /
`tryPlaceCircuit`), documented in `docs/circuit-spec.md`. It consumes normalized
topology, uses `ComponentInstance` world geometry, and returns component
placements plus declared ports, rail metadata, reserved corridors, and a
bounded deterministic report; it does not mutate or route a `Circuit`.

Phase 3's pure batch-routing seam is `src/core/routing.js` (`routeCircuit` /
`tryRouteCircuit`). It materializes declared physical nets through the model's
public reroute machinery, preserves fixed/authored paths, retries a bounded set
of stable net orders, and returns a routed circuit plus structured metrics or an
atomic failure; equal net names never merge physical nets.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
