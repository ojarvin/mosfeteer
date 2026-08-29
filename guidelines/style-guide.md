# Schematic Style Guide

The visual / electrical standard every schematic-spawner drawing must meet.
This is the **single canonical source** for layout, geometry, naming, and
labels — duplicated rules in other docs are bugs.

Companion docs:

- [CIRCUIT-AUTHOR.md](./CIRCUIT-AUTHOR.md) — the workflow that produces a
  drawing meeting this standard.
- `AGENTS.md` — current symbol geometry, terminal names, routing, and editor
  behavior (the live spec, not this guide).

The reference aesthetic is the **Razavi textbook look**: ordered transistor
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

---

## 3. Component reference

Command shape: `add <type> [refdes] [--at X Y] [--rot D] [--mirrorX] [--mirrorY] [--value V]`

`--mirrorX` / `--mirrorY` are **optional**: when omitted, the symbol's own
defaults apply (PMOS source-up, output ports mirrored outward). Only pass a
mirror flag to override that default.

| type | terminals | bbox (local units) |
|------|-----------|--------------------|
| resistor / capacitor / inductor / switch_open / switch_closed | `a` (left) `b` (right) | x:0..160, y:-40..40 |
| diode | `a` (left) `b` (right) | x:0..120, y:-40..40 |
| nmos / pmos | `g` (left) `d` (top-right) `s` (bottom-right) | x:0..120, y:-80..80 |
| npn / pnp | `b` (left) `c` (top-right) `e` (bottom-right) | x:0..160, y:-120..120 |
| current_source / current_sink / voltage_source | `a` (top) `b` (bottom) | x:-80..80, y:-80..80 |
| ground | `gnd` (top edge) | x:0..80, y:0..120 |
| supply | `p` (bottom edge) | x:-40..40, y:-80..0 |
| input / output / inputoutput | `p` (circuit side) | boxed port, id label on circuit-outer side |
| opamp / gates / inverter / buffer | `ip` / `im` / `a` / `b` in, `o` / `y` out | logic- or triangle-shaped bodies |

Notes:

- **Two-terminal parts** at `rot=0` point `b` right — the default for a
  horizontal run; `rot 90` makes them vertical.
- **MOS / BJT transistors** at `rot=0` have gate / base on the left and
  drain / collector top-right, source / emitter bottom-right. A **PMOS
  places source-up by default** (source top-right, drain bottom-right);
  verify `s` / `d` from the `add` output before wiring.
- **Mirroring builds matched pairs**: `--mirrorX` flips the body across the
  gate line so the two halves of a differential pair open like a mirror —
  drains face the shared output rows, sources face the shared tail row.
- **Ground** attaches with `gnd` on its top edge (place it below the net,
  hanging down off the wire). **Supply** attaches `p` on its bottom edge
  (drop it onto the rail above the net). Ports face their `p` into the
  circuit.
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
- **Never wire two supplies together; never wire two grounds together.** A
  supply / ground icon attached to a net is that net's rail connection;
  rails are implicitly global. Real wires between them are redundant
  clutter.
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
- Sanctioned exception: where the bus must pass *through* a body's
  interior and **every terminal on that net is a gate**, this single
  overlap is allowed — it is the documented special case for matched gate
  arrays. Flag it and justify it; never use it for any other net.

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

### 4.5b Mirrors and active loads: control terminals face inward

The same symmetry idea applies to a mirror / active-load pair sitting
above (or below) a differential core — e.g. the PMOS load of a 5T OTA.

- **Mirror the two load devices so their CONTROL terminals face each
  other.** The left load gets `--mirrorX` (its gate points right), the
  right load stays default (gate points left). Their gates then meet
  across a short open gap, so the mirror-gate connection is one clean wire
  with the bodies on the outer sides.
- **Align each load's output terminal (drain) to the corresponding core
  terminal's column** so the connection drops straight down — no diagonal
  or long detour. In the 5T OTA this means M4.d aligns with M1.d and M5.d
  with M2.d.
- **Diode-connected device:** the drain-to-gate tie is a deliberate route;
  craft it explicitly with a full cell of clearance around the body and
  reach the gate with a short lead, rather than trusting the auto-router
  to hug the outline. The tie's junction sits in OPEN SPACE — never start
  the tie on a terminal pin or hug the body edge; route it under / around
  the body so it connects the control terminal to its own DRAIN (an
  over-the-top route can touch the source instead). Verify with `eval`
  (no `wireThroughBBoxes`).
- Symmetry axis, even gaps, and the two bodies mirrored "back to back"
  apply exactly as in §4.5: equal halves, gates inward, output terminals
  aligned.

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

---

## 5. Geometry and routing

- Place all origins, terminals, labels, and route points on the 40-unit
  grid.
- Keep component bounding boxes separated. Touching edges are preferable
  to positive-area overlaps when a compact layout is necessary.
- Keep every wire segment horizontal or vertical. **Never leave diagonal
  segments in JSON or SVG.**
- Route around component interiors. Boundary-hugging is acceptable where
  the router and evaluator define the boundary as non-interior.
- Prefer short, direct routes with few bends, but do not trade away
  readability.
- Use explicit routes for deliberate hand-edited wiring. Do not silently
  replace a user's manual route with a fresh autoroute.
- When moving a component, preserve the existing wire body and move only
  the terminal connection portions needed to keep pins attached.
- Avoid wire crossings. If a crossing is unavoidable, make the
  connectivity distinction obvious and use a junction only when the net is
  actually joined.
- **Let wires END at ports; tap loads in open wire.** A port (input /
  output pin) should be a wire endpoint, not a pass-through junction — a
  junction dot directly on a port pin looks bad. Loads and load capacitors
  join the wire at a point between junctions, well clear of the port
  terminal.

---

## 6. Visual structure

Use a consistent signal-flow layout unless the circuit convention suggests
otherwise:

- supplies at the top;
- ground or sinks at the bottom;
- inputs entering from the left;
- outputs leaving toward the right;
- active loads and mirrors grouped together;
- bias inputs placed near the devices they control.

Leave enough whitespace for labels and future edits. Do not hide a
terminal or wire under a symbol label. Component IDs should remain
readable and unique.

For differential structures:

- Mirror the right-hand device across the vertical center axis; do not
  merely place two identical unmirrored symbols side by side.
- Choose an even device pitch so the exact midpoint is itself a 40-unit
  grid point. Put shared tail or source circuitry on that midpoint.
- Give the pair enough pitch for separate instance labels and clean wire
  corridors; symmetry is not useful if labels overlap.
- Align both halves' corresponding output terminals on one horizontal row
  and corresponding shared terminals on another horizontal row.
- Center the tail current source or bias device so its shared terminal is
  on the midpoint grid column. Orient its gate / base toward the side
  where its bias source will enter.
- Keep output leads straight where possible. If both leads run to the
  right, make their final endpoints share the same horizontal row and
  avoid unnecessary doglegs.

These rules generalize by device type: use drain / source for MOS pairs,
collector / emitter for BJT pairs, and the corresponding output / common
terminals for other matched devices. The polarity may change, but the
visual contract does not: equal halves, one explicit centerline, aligned
terminal rows, and centered shared circuitry. Apply the same discipline to
PMOS input pairs, folded or cascode differential cores, active loads, and
complementary pairs.

For a three-terminal shared node, route the branch to a center junction
first, then route balanced left and right branches. Do not let JSON
terminal order create an asymmetric visual tree. Multi-branch junctions
(3+ terminals of one net) are marked automatically: the routing algorithm
places an actual `solder` component at the balanced junction, so the agent
never adds one by hand. Keep the shared branch off the terminal row so a
real T-junction (not a collinear line) exists. An ordinary corner does not
receive a dot, and different nets that merely cross never share one.

---

## 7. Naming

Signal names are lowercase-free, typed signal names with a leading
voltage or current letter and a subscript for the rest: `V_{INP}`,
`V_{INN}`, `V_{BIAS}`, `V_{OUT}`, `V_{DD}`, `I_{BIAS}`, `V_{REF}`. In JSON,
net names and port refdes use the plain form (`VINP`, `VOUT`, `BIAS`);
the label text carries the markup (`V_{INP}`). Name nets for their purpose
(`TAIL`, `GND`, `VDD`, `VOUT`, `DIODE`, `BIAS`) — a net's name appears in
the editor's net list, so it should tell the reader what the node does.

---

## 8. Labels

Use labels for external interfaces and important internal nodes. At
minimum, label:

- every input and output (the port labels);
- bias / reference nodes;
- feedback or mirror nodes when their purpose is not obvious.

**Do not label supply or ground.** The supply and ground symbols already
say it; adding "VDD" / "GND" text is redundant clutter. Rail *names*
still matter for the net name (a net named `VDD` is fine).

Labels are separate `LabelInstance` objects, not component types. Owned
instance labels identify components; free labels identify circuit signals.
Keep free labels off component bodies and route paths.

**No font-12 value / refdes text.** Component identifiers are dedicated
owned label objects. Ports auto-create their identifier label from the
refdes (refPrefix `I` / `O` / `IO`, so `add input VINP` labels the pin
"VINP"). Do not set component `value` text to convey names.

Label text supports subscripts with `_{...}` markup (e.g. `C_{GS}`,
`M_{1}`); owned instance labels render trailing digits as a subscript
(M1 → M with subscript 1) for the textbook look. Alignment (center / left
/ right), anchors, and the grid-snapped box model are unchanged.

**Port labels sit one grid square from the port symbol, aligned toward
it.** Left-of-port labels are `align: right`; right-of-port labels are
`align: left`. The label box edge is 40 units clear of the port box —
never overlapping the symbol. Horizontal ports are the common case; keep
the same one-square rule for any label near a symbol.

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

---

## 9. Electrical correctness

- Implement the requested topology, not merely the requested component
  count.
- Use meaningful net names such as `VDD`, `GND`, `VIN+`, `VIN-`, `OUT`,
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
node src/cli/index.js demo clear
node src/cli/index.js demo "add nmos M1 --at 0 0"
node src/cli/index.js demo "add nmos M2 --at 480 0 --mirrorX"
node src/cli/index.js demo "connect M1.s M2.s --name TAIL"
```

The two sources meet on the symmetry column; `M1.d` and `M2.d` sit on one
shared row for the load / output wiring. Give the pair enough pitch for
clean label space.

### Vertical stack (shared source / drain on one grid line)

```sh
node src/cli/index.js demo "add nmos M1 --at 0 0"
node src/cli/index.js demo "add nmos M2 --at 0 160"
node src/cli/index.js demo "connect M1.s M2.d --name N"
```

`M1.s` and `M2.d` coincide; bboxes touch along the shared boundary. Extend
the column by adding the next device one symbol height (160 for MOS)
below.

### Supplies on a rail, grounds on a rail

```sh
node src/cli/index.js demo "add supply VDD --at 240 -320"
node src/cli/index.js demo "add supply VDD2 --at 720 -320"
node src/cli/index.js demo "add ground GND --at 240 320"
node src/cli/index.js demo "add ground GND2 --at 600 320"
```

Both supplies sit on the same top rail line and both grounds on the same
bottom rail line; there is **no net between them** — each icon cools its
own local net. Identify a rail with a free label (e.g. "VDD") where its
name must appear.

---

## 11. Evaluation checklist

Run after every mutation and before reporting success:

```sh
node src/cli/index.js <circuit> eval
```

**Treat any of these as a defect unless explicitly justified:**

- `unconnectedTerminals` — dangling pins that aren't intentional ports
- `overlappingBBoxes` — bodies intersect
- `gridViolations` — origin or terminal off the 40-grid
- `wireThroughBBoxes` — a wire runs through a body interior
- `diagonalWireSegments` — none should remain in the JSON or SVG

`eval --json` gives the machine-readable report.

`eval` **ignores labels** — it reports a terminal "connected" if it is in
a net even when no wire reaches it, and it never checks that a label box
is clear. In addition to `eval`, verify:

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
