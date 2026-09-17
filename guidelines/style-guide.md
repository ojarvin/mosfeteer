# Schematic Style Guide

The visual and electrical standard every Mosfeteer drawing must meet. This is the canonical source for layout, visual geometry, naming, and label-authoring rules. `AGENTS.md` is authoritative for current runtime behavior and exact symbol geometry, terminals, routing, and editor UX; use it for implementation-specific details.

Companion docs:

- [CIRCUIT-AUTHOR.md](./CIRCUIT-AUTHOR.md) — the workflow that produces a
  drawing meeting this standard.
- `AGENTS.md` — current symbol geometry, terminal names, routing, and editor
  behavior (the live spec, not this guide).

The reference aesthetic is the **classic textbook look**: ordered transistor
arrays, straight rails, logical signal flow, zero redundant wiring. The
deliverable must also report clean in `eval`.

---

## 1. Goal

- Signals flow **left to right**: inputs in on the left, outputs out on the
  right.
- Rows and columns everywhere; every array, pair, and stack reads at a
  glance.
- Supplies form a **straight horizontal line at the top**; grounds form a
  straight horizontal line at the **bottom**.
- No overlaps, no stray long wires, no dangling terminals, no redundant
  parallel ground/supply runs. One device, one place, one purpose.
- A successful schematic is **electrically correct, readable, editable, and
  easy to review**. Passing `eval` alone is not sufficient — it doesn't
  check labels, signal-flow sense, or textbook polish.

### 1.1 Universal composition heuristics

When a topology-specific convention is unavailable, prefer the arrangement
that makes the electrical story obvious without relying on text:

- establish a primary reading direction and keep related signal paths
  visually parallel;
- use alignment, repetition, symmetry, and consistent spacing to expose
  functional relationships;
- separate functional blocks with whitespace and reserve corridors for wires,
  labels, and future edits;
- keep the shortest, clearest route for the most important signal paths;
  move a device rather than forcing a long or tangled wire;
- keep bias and reference circuitry visually distinct from the main signal path,
  but close enough that its purpose and controlled devices are easy to relate;
- make boundaries and ownership visible: a component label belongs in open
  space near its component, a port label faces the circuit, and a junction dot
  appears only where nets actually join;
- use names and labels to clarify external intent, not to compensate for an
  ambiguous or poorly routed topology.

These heuristics never authorize inventing electrical connections. If the
requested implementation leaves topology, polarity, biasing, feedback,
rail conventions, or port meaning ambiguous, the author must ask the user
before choosing among materially different circuits.

### 1.2 Visual balance and symmetry

“Pretty” means that the visual hierarchy is intentional, not merely that the
schematic has no errors. Review the whole fitted page as a figure:

- Keep the main signal path visually dominant: it should be the shortest,
  clearest path and should not be forced around secondary bias or feedback
  wiring.
- Balance visual mass around the page center. Avoid putting all large symbols,
  labels, or long routes on one side while leaving a large dead region on the
  other. Move blocks or widen the page rather than filling empty space with
  decorative wiring.
- Use consistent horizontal and vertical lanes. Parallel paths should share
  rows or have deliberate, repeated offsets; unrelated paths should not
  accidentally look like a matched group.
- Preserve symmetry wherever the circuit has a matched relationship:
  differential pairs, current mirrors, complementary devices, repeated stages,
  and cross-coupled structures. Symmetry includes device pitch, terminal rows,
  label clearance, bend positions, and route lengths—not only symbol placement.
- Place shared circuitry on the true geometric centerline when it is shared by
  matched halves. Keep the centerline visible through the whitespace and do not
  let labels or unrelated routes obscure it.
- Make asymmetry intentional and local. A bias input, supply entry, output
  load, or feedback return may break global symmetry, but it should not make a
  matched structure appear accidentally misaligned.
- Prefer a slightly larger, balanced composition over a compact composition
  with uneven whitespace. Empty space is part of the figure's hierarchy.

As a final visual test, temporarily ignore the labels and ask whether the
device groups, signal direction, symmetry axes, and feedback paths are still
obvious. Then restore the labels and check that they reinforce rather than
compete with that structure.


---

## 2. The 40-grid contract

- The global grid step is `GRID = 40`. **Every** component transform origin,
  every terminal coordinate, and every wire/bend point must be a multiple of
  40.
- Symbol-internal graphics are exempt — symbol bodies sit between
  terminals. You only place *origins* and *terminals*.
- `add --at` / `move` snap automatically, but still use multiples of 40 so
  bbox edges, rails, and wire bends all land on grid lines.
- `eval` reports `gridViolations` for any off-grid origin or terminal. A
  dirty report fails the task.

### 2.1 Airy spacing (avoid crammed schematics)

A professional schematic has room to breathe. Crammed layouts are the most
common readability failure — they look "correct but busy".

- **Use even-cell gaps** (2, 4, 6, 8 … grid cells) between rows and
  columns so shared nodes sit on grid points and the layout reads as
  deliberate. Two cells (80 units) is the minimum vertical gap between
  stacked rows; give differential pairs and mirror pairs a wide horizontal
  pitch (12+ cells) so labels and wires have room.
- **Keep bodies apart**: at least one full empty cell around every device,
  and a wide pitch for matched pairs so each half has its own label space
  and a clean wire corridor.
- **Plan the wire lanes**: after placing devices, every net should have a
  short, straight, unobstructed path. If a wire must detour around a body,
  widen the layout rather than forcing the route.
- **Space stacked elements evenly.** When a junction or solder dot sits
  between two devices in a vertical stack (e.g. a bias reference above a
  current source), center it: the gap from the device above to the dot
  should equal the gap from the dot to the device below (one grid square
  each). A junction glued onto a terminal looks cramped and uneven.
- **When in doubt, space it out.** Extra whitespace costs nothing and
  prevents label collisions and tangled wires. A drawing that is slightly
  large but clearly readable is better than a tight one that is hard to
  follow.
- **Reserve corridors**: after placing devices, mentally walk each wire;
  every net should need only short straight segments through open lanes.
- Verify the result is airy by reviewing the fitted view (`F`), not just by
  a clean `eval`.

### 2.2 Placement planning before wiring

Place the complete component set before drawing any wire. Treat placement as a
topology plan, not as a sequence of local additions:

- Put PMOS devices on deliberate upper rows and NMOS devices on deliberate
  lower rows. Leave a real open corridor between the rows; four grid cells
  (160 units) is a useful starting gap for MOS rows when labels and vertical
  branches must pass between them.
- Use shared columns for stacked devices: align the upper source with the lower
  drain, and keep the stack pitch equal to the device height so the shared node
  is a clean boundary connection.
- Put differential pairs and matched loads on wide, symmetric pitches. Choose
  the polarity-aware orientation that keeps both input terminals readable from
  the input side; reserve an open centerline for tail/current circuitry and
  balanced junctions.
- Keep bias-generation devices and bias sources in a distinct, compact area
  near the devices they control, without blocking the main signal corridor.
  Keep second-stage devices and output/compensation parts to the right, with a
  clear central corridor for horizontal signal flow.
- Align devices that share a gate net whenever practical. A straight gate bus
  is easier to inspect than several long taps; the documented MOS gate-bus
  exception is a fallback for intentional shared-gate geometry, not a reason to
  compress unrelated rows.
- For a current mirror, align the control terminals on a common row or column
  and orient the diode-connected reference so its gate/drain tie meets the
  control bus through open space. Align mirror outputs with the stages they
  feed; do not make a bias reference leg carry an avoidable long detour.
- Fit and review this placement before routing. If routing later produces many
  failures, move rows/columns and re-review instead of accumulating detours.

This placement pass may be submitted as one batched command request. The
routing pass starts only after the placement review.


---

## 3. Component reference

Command shape: `add <type> [refdes] [--at X Y] [--rot D] [--mirrorX] [--mirrorY] [--value V]`

`--mirrorX` / `--mirrorY` are **optional**: when omitted, the symbol's own
defaults apply (PMOS source-up, output ports mirrored outward). Only pass a
mirror flag to override that default.

| type | terminals | bbox (local units) |
|------|-----------|--------------------|
| resistor / capacitor / inductor / switch_open / switch_closed | `a` (left) `b` (right) | x:-80..80, y:-40..40 |
| diode | `a` (left) `b` (right) | x:-80..80, y:-40..40 |
| nmos / pmos | `g` (left) `d` (top) `s` (bottom) | bbox `{-120,-80,120,160}`; drain and source leads end at their terminals and share the wire-cap overlap |
| nmosb / pmosb | `g` (left) `d` (top) `s` (bottom) `b` (channel center) | bbox `{-120,-80,120,160}`; bulk pin points right with a visible internal path ending at the terminal and sharing the wire-cap overlap |
| npn / pnp | `b` (left) `c` (top) `e` (bottom) | x:-160..0, y:-120..120 |
| current_source / voltage_source | `a` (top) `b` (bottom) | body x:-40..40, y:-80..80; default label center offset x:-80 (bbox edge x:-40) |
| ground | `gnd` (top edge) | x:0..80, y:0..120 |
| vcm | `vcm` (top edge) | x:-40..40, y:0..80 |
| supply | `p` (bottom edge) | x:-40..40, y:-80..0 |
| input / output / inputoutput | `p` (circuit side) | boxed port, id label on circuit-outer side |
| adc / dac | ADC: `ain` in, `d` out; DAC: `d` in, `aout` out | ADC point-to-flat left-to-right; DAC flat-to-point left-to-right; one diagonal slash marks the digital bus; centered `ADC` / `DAC` label |
| block | `T1`…`T12`, every non-corner grid slot per side | resizable schematic shell (default 160×160) with centered editable caption; selected blocks expose eight resize handles, preserve connected terminal identities, and unused terminals do not fail Design Check |

Notes:

- **Two-terminal parts** at `rot=0` point `b` right — the default for a
  horizontal run; their origin is the electrical midpoint and `rot 90` makes
  them vertical.
- **MOS / BJT transistors** at `rot=0` have gate / base on the left and
  drain / collector at the channel origin, source / emitter below it. A
  **PMOS places source-up by default** (source top, drain bottom);
  verify `s` / `d` from the `add` output before wiring.
- Bulk variants add `b` at the channel center `(0,0)`, directed right
  (`dir:{x:1,y:0}`), with a symbol path joining the channel edge to that pin.
  Their owned bulk label is one cell toward the local drain, offset
  `{x:40,y:-40}`; transforms carry that offset toward the semantic drain.
- **Mirroring builds matched pairs**: `--mirrorX` flips the body across the
  gate line so the two halves of a differential pair open like a mirror —
  drains face the shared output rows, sources face the shared tail row.
- **Ground** attaches with `gnd` on its top edge (place it below the net,
  hanging down off the wire). **Supply** attaches `p` on its bottom edge
  (drop it onto the rail above the net). Ports face their `p` into the
  circuit.
- **Schematic blocks** mix functional abstraction into a transistor-level
  drawing. Double-click the body or its component-row entry to edit the
  centered caption. Their perimeter pins use ordinary schematic wires, and
  the body remains an obstacle for overlap and wire-through checks. Resize a
  selected block with the same eight handles used by block diagrams; the
  opposite corner stays fixed, touched managed nets are rerouted atomically,
  and the size is persisted per instance.
- Transform order is **mirror → rotate → translate**.

**Spacing**: keep at least one full 40-grid cell between adjacent
footprints. Bbox *edge touches* are legal (the overlap model is strict); a
deliberate touch is how stacks and mirrored pairs share a boundary — never
overlap.

---

## 4. Analog layout discipline

### 4.1 Supplies top rail, grounds bottom rail

- All `supply` symbols go on one line — the **top rail**. All `ground`
  symbols go on one line — the **bottom rail**.
- Connect each supply or ground symbol directly to the intended local net.
  Symbols on the same visual rail remain independent: never wire two supplies
  together or two grounds together unless the topology explicitly requires it.
  The symbol is the rail connection; extra rail-to-rail wiring is clutter.
- Only **local** device nets carry real wires: signal flow between gates /
  drains / sources and passives.

### 4.2 Rows and columns

- Place every transistor on a **row / column lattice**. NMOS devices occupy
  the **bottom rows**, PMOS devices the **top rows**. Rows are horizontal
  device lines (same `y`); columns are vertical stacks (same `x`).
- **A row** means devices side by side sharing a gate line. Ask: *which
  nets drive these gates?* Devices whose gates share a bias belong in the
  same row.
- **A column** means **stacking** — devices stacked so the source of the
  upper device and the drain of the lower device sit on the same grid
  line and connect with a straight, minimum-length wire.

### 4.3 Rows: the shared-gate bus

- If several devices carry the **same gate bias**, align them vertically
  (same `y`) and draw **one horizontal wire across the row** connecting all
  their gates.
- Keep that bus clear of bodies: run it on the row's bbox **edge** and
  drop a short tap at each gate column — taps that run along a gate
  column touch only bbox *edges*, which `eval` does not count as crossings.
- Sanctioned exception: a shared gate bus may pass *through* a MOS body's
  interior, including a bulk variant, when every MOS gate it crosses belongs
  to the same physical net. The crossing must touch that component's gate
  terminal and follow the gate axis; diode-connected gate/drain terminals and
  a current-source feed may share the net. `eval` and the autorouter recognize
  only this constrained MOS exception. Flag and justify it; never use it for
  any other net.

### 4.4 Columns: shared source / drain

- When stacking (columns), **align the shared terminal pair on one
  horizontal line**: the upper device's `s` and the lower device's `d`
  must match both `x` and `y`, giving a straight, ideally zero-length,
  connection.
- Device pitch for a clean stack equals the symbol's own height (160
  units for MOS, 240 for BJT), so `s` / `d` coincide exactly on the shared
  boundary.

### 4.5 Differential symmetry

- Differential nets (`INP / INN`, `OUTP / OUTN`, …) must read as **mirror
  images**. The two matched devices go side by side; **one side carries
  `--mirrorX`** so the pair opens like a mirror.
- Choose a pitch that leaves label clearance and puts a 40-grid point at
  the exact symmetry axis. Do not merely place two identical unmirrored
  symbols side by side.
- Align corresponding drain / collector terminals on one row and source /
  emitter terminals on another. Center shared tail / source circuitry on
  the symmetry axis and orient its gate / base toward its bias source.
- Keep the two halves identically oriented except for the intentional
  mirror.
- **Align ports that share a side on one column.** When inputs (or an
  input and the output) both leave the same edge, put their terminals on
  the same `x` so the edge reads as a clean vertical line — e.g. the
  right-hand input and the single-ended output both on the right, aligned.
- For a three-terminal shared node, route to a centered junction, then
  split into balanced left / right branches. The router places a solder
  dot only at that true multi-branch junction — never add one by hand, and
  never expect one at an ordinary bend.

These rules apply equally to NMOS, PMOS, BJT, folded, cascode, active-
load, and complementary differential structures. Change the polarity and
terminal names as needed, but retain equal spacing, matched mirroring,
aligned rows, and centered shared circuitry.

### 4.5b Current mirrors and active loads

Use the topology—not a named amplifier—as the source of truth for mirror
orientation:

- Align matched control terminals on a common row or column. Orient the pair
  so the control bus is short, clear, and does not pass through unrelated
  bodies; matched output terminals should align with the stages they feed.
- Make the diode-connected reference unmistakable: its gate/drain tie should
  enter open space, use a short direct route, and avoid the body and source
  terminal. Do not rely on a body-hugging autoroute when a small placement move
  makes the reference leg obvious.
- Keep the bias reference separate from the main signal path but close to the
  mirror it controls. Preserve equal spacing and label clearance for matched
  devices, adapting the facing convention to NMOS, PMOS, BJT, or active-load
  polarity.

### 4.5c Cross-coupled, fully differential structures

- Maintain consistent mirrored placement through the entire design, not only
  in the input pair or active load. Use one explicit centerline and preserve
  equal device rows, columns, and routing clearances on both sides.
- Choose the gate-facing convention from the topology: same-side gates may
  face each other as a paired bus, while cross-coupled gates must face the
  opposite-side outputs. Do not mix conventions between matched stages.
- Keep equal vertical gaps in stacked devices and align corresponding stack
  boundaries on the same rows.
- Place output ports at the outer routing corners, with enough open space for
  their labels; never let a port label cross a feedback route or device body.
- Draw cross-coupling routes as a matched pair. Their horizontal legs must be
  at equal `+/-` grid offsets from the vertical midpoint, with corresponding
  bends and clearances mirrored.
- Final manual cleanup may compress spacing and remove redundant bends, but
  it must preserve symmetry and must not introduce label crossings.

### 4.5d Cross-coupled gate latches

For a visually balanced NOR latch or similar cross-coupled gate pair:

- mirror both gates individually across the horizontal center axis so their
  instance labels face away from the central wiring corridor;
- place the two external input ports on symmetric outer rows;
- determine `Q` and `QB` from the Boolean equations, not from which gate is
  drawn uppermost. Swap output port identities if the initial placement gives
  the opposite polarity;
- use `cross A1 A2 B1 B2` for a matched fixed cross when the four terminals form
  a rectangle; it creates diagonal routes between opposite corners with an
  unsoldered central crossing;
- if a deliberate diagonal fixed span is required, keep it in open space,
  symmetric, and free of solder dots at crossings. Add junction dots only
  where a feedback branch joins its own output wire;
- connect the output ports only after the X is complete when manual routing is
  required. A single multi-terminal autoroute may reduce or reshape the
  intended X.

After manual label edits, verify that the output symbols still have connected
electrical terminals. A visible `Q` or `QB` annotation does not itself connect
to a net; inspect `eval` and confirm the output terminal appears in the
corresponding net branch.

---

## 5. Geometry and routing

- Place all origins, terminals, labels, and route points on the 40-unit
  grid.
- Keep component bounding boxes separated except for deliberate shared-boundary
  topology such as a stacked device pair.
- Keep wire segments horizontal or vertical by default. Diagonal segments are
  allowed only when they materially clarify a deliberate cross-coupled or
  otherwise topology-specific structure; use them sparingly and symmetrically.
  Do not use diagonals merely to save space.
- Route around component interiors. Boundary-hugging is acceptable where
  the router and evaluator define the boundary as non-interior.
- Prefer short, direct orthogonal routes with few bends, but do not trade away
  readability. Avoid loops and redundant parallel branches; one branch should
  represent one intended connection.
- Use explicit routes for deliberate hand-edited wiring. Do not silently
  replace a user's manual route with a fresh autoroute.
- When moving a component, preserve the existing wire body whenever possible;
  use the editor's connected-move behavior to reroute or translate affected
  connectivity only as required to keep pins attached.
- Avoid wire crossings. If a crossing is unavoidable, make the connectivity
  distinction obvious. A real branching net gets one visible junction dot at
  its actual open-space T/cross junction; an ordinary bend or crossing gets no
  dot, and never add a `solder` component by hand.
- **Treat coincident physical nets as distinct.** Equal net names do not connect
  separate nets. A positive-length collinear overlap between different physical
  nets is an electrical violation, not a junction, and must never be repaired
  by auto-merging. Select or highlight one physical net when coincident
  geometry must be targeted for deliberate repair.
- **Same-net reconnects are normalized at repair boundaries.** When copy/move
  makes endpoint-coincident pieces of one managed net reconnect, positive
  collinear overlap is pruned. Reducer overlap boundaries are not junctions;
  reserve junction dots for actual joined topology.
- **Let wires END at ports; tap loads in open wire.** A port (input /
  output pin) should be a wire endpoint, not a pass-through junction — a
  junction dot directly on a port pin looks bad. Loads and load capacitors
  join the wire at a point between junctions, well clear of the port
  terminal.

---

## 6. Visual structure

Unless circuit convention dictates otherwise, use supplies at the top, grounds or sinks at the bottom, inputs from the left, outputs to the right, grouped active loads/mirrors, and bias inputs near the devices they control. Leave whitespace for labels and future edits; never hide terminals or wires under labels; keep component IDs readable and unique.

For differential or matched structures, apply the full symmetry rules in §4.5: mirror the right-hand device across the vertical center axis, use an even pitch whose midpoint is on the 40-grid, center shared tail/source circuitry there, align corresponding output and shared terminals on common rows, orient bias terminals toward their source, and leave enough pitch for labels and wire corridors. Keep output leads straight where possible and align same-side endpoints. The same visual contract applies across MOS, BJT, folded/cascode, active-load, and complementary pairs: equal halves, one centerline, aligned rows, and centered shared circuitry.

For a three-terminal shared node, route first to a centered junction, then split into balanced left/right branches. Do not let terminal order make the tree asymmetric. Follow the junction rule in §5: multi-branch junctions receive an automatic `solder` component only at the real open-space T-junction; never add one by hand or expect one at an ordinary corner. Keep the shared branch off the terminal row, and never add a dot where different nets merely cross.

---

## 7. Naming

Signal names are lowercase-free, typed signal names with a leading
voltage or current letter and a subscript for the rest: `V_{INP}`,
`V_{INN}`, `V_{BIAS}`, `V_{OUT}`, `V_{DD}`, `I_{BIAS}`, `V_{REF}`. In JSON,
net names and port refdes use the plain form (`VINP`, `VOUT`, `BIAS`);
the label text carries the markup (`V_{INP}`). For digital or control signals
that are not naturally voltages or currents, use a concise plain name such as
`CLK`, `RESET`, or `EN` consistently at both the port and net level.
Differential suffixes such as `P` / `N` are preferred over mixing them with
`+` / `-` notation. Name nets for their purpose
(`TAIL`, `VSS`, `VDD`, `VOUT`, `DIODE`, `BIAS`) — a net's name appears in
the editor's net list, so it should tell the reader what the node does.

`netId` identifies one physical net and its drawable geometry. Separate
physical nets may share a canonical name for logical grouping and reporting,
but a shared name never connects them electrically.

---

## 8. Labels

Use labels for external interfaces and important internal nodes. At
minimum, label:

- every input and output (the port labels);
- bias / reference nodes;
- feedback or mirror nodes when their purpose is not obvious.

**Do not add visible labels to supply or ground symbols unless the user
requests them.** The symbols already communicate their usual meaning.
Supply/ground net names may still be meaningful in the model and net list.
When a visible rail name is explicitly required, use one deliberate label,
not repeated labels on every symbol.

Labels are separate `LabelInstance` objects, not component types. There are
three roles: owned instance labels (`owner` = component refdes, with a local
offset), persistent electrical net labels (`netId` = one physical net), and
free annotations (`owner:null`, `netId:null`, independent text/anchor). Owned
labels identify components; net labels name a physical wire; free annotations
are independent text. Keep free annotations off component bodies and route
paths; net labels belong on drawable wire paths.

Use the canonical `addNetLabel`, `renameNet`, and `renameNetLabel` APIs for
electrical labels and net names. Net-label text follows the physical net name;
removing one label occurrence does not remove or rename its net. In the editor,
`L` persistently places a net label only on an unambiguous physical wire; at a
crossing, select/highlight the intended net first. `Shift+N` places one free
annotation and then returns to selection; `a` places a multi-point arrow by
clicking vertices and committing with Enter, while `b` places one box. The
generic insert-menu entry is also an annotation. `l`
draws a non-electrical multi-point line annotation with rounded caps; its
snapped vertices and segments remain editable.

Selection and editing preserve these roles: owned labels follow their
components, net labels remain on their drawable paths, and annotations move
independently. Deleting a net-label occurrence leaves the physical net and its
name intact. Clipboard operations carry net labels only with a complete copied
physical net, using fresh net/label IDs and translated on-path anchors; they
never turn them into annotations.

**No font-12 value / refdes text.** Component identifiers are dedicated
owned label objects. Every labeled symbol, including ports, keeps its
component name and owned label synchronized. Ports auto-create their
identifier label from the refdes (refPrefix `VI` / `VO` / `VIO`, so numeric
defaults use explicit textbook markup such as `V_{I1}`). Do not set component
`value` text to convey names.

Label text supports subscripts with `_{...}` markup (e.g. `C_{GS}`,
`M_{1}`); component names and owned instance labels are synchronized
and unique. Numeric defaults persist explicit markup (`M_{1}`) while the
connectivity id remains `M1`; plain trailing digits are never auto-subscripted.
Label bounds are stable,
grid-snapped, and centered on the anchor for every alignment. Alignment (center
/ left / right) changes only the text position within that box (left edge,
center, or right edge); changing text length may resize the box symmetrically
around the same center. The dimensions and markup metrics are shared with the
inline preview.

**Keep related input/output ports adjacent to their signal endpoints.** Put
inputs on the input side and outputs on the output side; when several ports
share an edge, align and space them consistently rather than scattering them
around the drawing.

**Port labels sit one grid square from the port symbol, aligned toward
it.** Left-of-port labels are `align: right`; right-of-port labels are
`align: left`. The label box edge is 40 units clear of the port box —
never overlapping the symbol. Use the same gap and baseline for a related set,
and use `_{...}` subscript markup consistently (`V_{INP}`, `V_{OUT}`).
Horizontal ports are the common case; keep the same one-square rule for any
label near a symbol.

**Edge symbols put their label on the OUTSIDE.** A current source,
capacitor, or other part at the edge of the drawing gets its label on
the outer side (mirror the symbol so the label flips outward). Small
labels need no extra spacing — keep them close to the symbol; only a
wide label or a body on the outer side calls for a bigger gap.

Do not add extra descriptive text or component values by default. Unless
the user asks for values or annotations, the only component text should
be the inherent instance label. For mirror-symmetric parts such as
resistors, capacitors, inductors, diodes, and switches, choose the
available mirror / orientation that places the instance label in the
clearest open space. For example, a horizontal resistor with room above
should be mirrored vertically so its label is above the body rather than
below it.

### 8.1 Analysis annotations

Keep symbolic-analysis annotations compact and subordinate to the schematic.
Place them below the figure, align them with its left edge, and leave two grid
cells of clearance. Use the order `Z_{in}(s)`, `Z_{in}(0)`, `Z_{out}(s)`,
`Z_{out}(0)`, `A_v(s)`, `A_v(0)`, poles, zeros, assumptions; omit rows that add
no information. AC rows, poles, and zeros appear only when reactive terms
remain after cancellation.

Prefer a proven expression that exposes the circuit's stages and loading:
signed effective transconductance times parallel output impedances, and a
product of gains at independent internal signal boundaries. Preserve finite
load and degeneration terms unless an explicit assumption removes them.
Use the shared MathML renderer in both the report and schematic annotations
so fractions, subscripts, and parallel operators appear as mathematical notation.
Feedback and reciprocal loading prevent an independent-stage split. Order powers of `s` from
highest to lowest, combine repeated factors as powers, keep useful common
factors in frequency expressions. Flatten small resistive branch sums, place
each transistor’s `g_m r_o` factors together, and remove redundant parentheses.
Compose nested fractions into one numerator and denominator, including
reciprocal sums in Miller identities. Keep proven parallel impedances intact.
Put all multiplying pole/zero factors in the numerator of the fraction.
Measure individual MathML lines and convert padding to screen units; do not
measure full-width multiline wrappers. Ignore sub-pixel measurement noise at
grid boundaries so label edges and fraction centerlines stay fixed across
zoom and reload. Persist the measured even-grid math footprint so the first
frame after loading uses the same aligned box. List only assumptions that change a
displayed equation, including any applied Miller modeling transform. Keep
DC-conducting feedback in the solved model and expose its verified compact
relations; do not invent resistor-loading or feedthrough assumptions. The complete exact result remains in the analysis report,
not as extra prose on the drawing.

---

## 9. Electrical correctness

- Implement the requested topology, not merely the requested component
  count.
- Use meaningful net names such as `VDD`, `VSS`, `VIN+`, `VIN-`, `OUT`,
  and bias names where they clarify intent.
- Connect every device terminal required by the topology.
- Leave only intentional external terminals dangling, and label them.
- Use the correct device polarity and orientation. For example, the
  default PMOS orientation has source up and drain down.
- Make current mirrors, diode connections, differential pairs, and tail
  sources visually and electrically unambiguous.

---

## 10. Verified micro-examples

These short command sequences build the core patterns. Verify with
`eval` after each, then fit the view (`F`).

### Mirrored differential pair (shared sources on the center column)

```sh
node src/cli/index.js <circuit> clear
node src/cli/index.js <circuit> "add nmos M1 --at 0 0"
node src/cli/index.js <circuit> "add nmos M2 --at 480 0 --mirrorX"
node src/cli/index.js <circuit> "connect M1.s M2.s --name TAIL"
```

The two sources align on one row and connect through a centered tail or
junction; `M1.d` and `M2.d` sit on one shared row for the load / output wiring.
Give the pair enough pitch for clean label space.

### Vertical stack (shared source / drain on one grid line)

```sh
node src/cli/index.js <circuit> "add nmos M1 --at 0 0"
node src/cli/index.js <circuit> "add nmos M2 --at 0 160"
node src/cli/index.js <circuit> "connect M1.s M2.d --name N"
```

`M1.s` and `M2.d` coincide; bboxes touch along the shared boundary. Extend
the column by adding the next device one symbol height (160 for MOS)
below.

### Supplies on a rail, grounds on a rail

```sh
node src/cli/index.js <circuit> "add supply VDD --at 240 -320"
node src/cli/index.js <circuit> "add supply VDD2 --at 720 -320"
node src/cli/index.js <circuit> "add ground VSS --at 240 320"
node src/cli/index.js <circuit> "add ground VSS2 --at 600 320"
```

Both supplies sit on the same top rail line and both grounds on the same
bottom rail line; there is **no net between them** — each icon connects to its
own local physical net. Do not add visible `VDD` or `VSS` text unless requested;
the symbols provide that visual convention. If a visible rail name is requested,
use one deliberate label rather than labeling every icon.
---

## 11. Evaluation checklist

Run after each meaningful mutation or milestone, and before reporting success:

```sh
node src/cli/index.js <circuit> eval
```

**Treat any of these as a defect unless explicitly justified:**
- diagonal segments used without a clear cross-coupled or topology-specific
  purpose
- `unconnectedTerminals` — dangling pins that aren't intentional ports
- `overlappingBBoxes` — bodies intersect
- `gridViolations` — origin or terminal off the 40-grid
- `wireThroughBBoxes` — a wire runs through a body interior

`eval --json` gives the machine-readable report.

`eval` reports electrical connectivity and wire geometry separately from label
placement. Check also reports label/component and label/label overlaps; label
boxes remain soft routing obstacles, so they steer routes but do not block a
connection. In addition to `eval`, verify:

- every terminal's world position appears in some net `branch` (a 3+
  terminal net stores one polyline per arm; `route` is only the first);
- no label box overlaps a component bbox (or another label box) — check
  the label bboxes against the component bboxes, since a moved part can
  land on an instance label.

Then inspect the SVG or browser view. Check that the visual interpretation
matches the electrical netlist, especially at coincident terminals and
multi-terminal junctions.

---

## 12. Review standard

The final result should let another engineer answer these questions
without opening the JSON:

1. What is the signal flow?
2. Which nodes are inputs, outputs, supply, ground, and bias?
3. Which devices form each functional block?
4. Are mirrored or diode-connected devices oriented correctly?
5. Can the design be modified without first untangling the wires?

If any answer requires reading the netlist, the drawing isn't done yet.
