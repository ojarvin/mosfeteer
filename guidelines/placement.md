# Placement, Wiring & Layout Guidelines (Analog)

Rules for placing components, drawing wires, and laying out clean,
**textbook-grade** analog schematics. Use them with the live editor — see
`agent-operations.md` for how to drive it and `agent-workflow.md` for the
overall process. The reference standard is the "Razavi look": ordered transistor
arrays, straight rails, logical signal flow, zero redundant wiring. The
deliverable must also report clean in `eval`.

## 1. Goal

- Signals flow **left to right**: inputs in on the left, outputs out on the
  right.
- Rows and columns everywhere; every array, pair, and stack reads at a glance.
- Supplies form a **straight horizontal line at the top**; grounds form a
  straight horizontal line at the **bottom**.
- No overlaps, no stray long wires, no dangling terminals, no redundant parallel
  ground/supply runs. One device, one place, one purpose.

## 2. The 40-grid contract

- The global grid step is `GRID = 40`. **Every** component transform origin,
  every terminal coordinate, and every wire/bend point must be a multiple of 40.
- Symbol-internal graphics are exempt — symbol bodies sit between terminals. You
  only place *origins* and *terminals*.
- `add --at`/`move` snap automatically, but **still use multiples of 40** so bbox
  edges, rails, and wire bends all land on grid lines.
- `eval` reports `gridViolations` for any off-grid origin or terminal. A dirty
  report fails the task.

### 2.1 Airy spacing (avoid crammed schematics)

The goal is a drawing that breathes: ordered rows, generous clear space between
bodies, and visible corridors for every wire and label. A crammed layout reads
as noise no matter how correct the netlist is.

- **Keep gaps between rows and columns an EVEN number of grid cells** (2, 4, 6,
  8 …). Even gaps keep the symmetry axis and shared nodes on grid points and
  make the layout look deliberate. Two cells (80 units) is the minimum vertical
  gap between stacked rows; give differential pairs and mirror pairs a wide
  horizontal pitch (12+ cells) so labels and wires have room.
- **Leave at least one full cell of clear space around every body** for wires to
  pass. Route deliberate ties (e.g. a diode's gate-to-drain) with a full cell of
  clearance from the body edge — never hug the outline.
- **Reserve corridors**: after placing devices, mentally walk each wire; every
  net should need only short straight segments through open lanes. If wires must
  detour or cross bodies, widen the layout instead of fighting it.
- **Bigger is better than tighter.** When in doubt, increase the pitch. Labels
  overlap and wires tangle far more often from crowding than from excess space.
- Verify the result is airy by reviewing the fitted view (F), not just by a
  clean `eval`.

## 3. Component reference

Command shape: `add <type> [refdes] [--at X Y] [--rot D] [--mirrorX] [--mirrorY] [--value V]`

`--mirrorX`/`--mirrorY` are **optional**: when omitted, the symbol's own defaults
apply (PMOS source-up, output ports mirrored outward). Only pass a mirror flag to
override that default.

| type | terminals | bbox (local units) |
|------|-----------|--------------------|
| resistor / capacitor / inductor / switch_open / switch_closed | `a` (left) `b` (right) | x:0..160, y:-40..40 |
| diode | `a` (left) `b` (right) | x:0..120, y:-40..40 |
| nmos / pmos | `g` (left) `d` (top-right) `s` (bottom-right) | x:0..120, y:-80..80 |
| npn / pnp | `b` (left) `c` (top-right) `e` (bottom-right) | x:0..160, y:-120..120 |
| current_source / current_sink / voltage_source | `a` (top) `b` (bottom) | x:-80..80, y:-80..80 |
| ground | `gnd` (top edge) | x:0..80, y:0..120 |
| supply | `p` (bottom edge) | x:-40..40, y:-80..0 |
| input / output / inputoutput | `p` (circuit side) | boxed port, id label on the circuit-outer side |
| opamp / gates / inverter / buffer | `ip`/`im`/`a`/`b` in, `o`/`y` out | logic- or triangle-shaped bodies |

Notes:

- **Two-terminal parts** at `rot=0` point `b` right — the default for a
  horizontal run; `rot 90` makes them vertical.
- **MOS/BJT transistors** at `rot=0` have gate/base on the left and
  drain/collector top-right, source/emitter bottom-right. A **PMOS places
  source-up by default** (source top-right, drain bottom-right); verify `s`/`d`
  from the `add` output before wiring.
- **Mirroring builds matched pairs**: `--mirrorX` flips the body across the gate
  line so the two halves of a differential pair open like a mirror — drains face
  the shared output rows, sources face the shared tail row.
- **Ground** attaches with `gnd` on its top edge (place it below the net, hanging
  down off the wire). **Supply** attaches `p` on its bottom edge (drop it onto
  the rail above the net). Ports face their `p` into the circuit.
- Transform order is **mirror -> rotate -> translate**.

**Spacing**: keep at least one full 40-grid cell between adjacent footprints.
Bbox *edge touches* are legal (the overlap model is strict); a deliberate touch
is how stacks and mirrored pairs share a boundary — never overlap.

## 4. Analog layout discipline

### 4.1 Supplies top rail, grounds bottom rail

- All `supply` symbols go on one line — the **top rail**. All `ground` symbols
  go on one line — the **bottom rail**.
- **Never wire two supplies together; never wire two grounds together.** A
  supply/ground icon attached to a net is that net's rail connection; rails are
  implicitly global. Real wires between them are redundant clutter.
- Only **local** device nets carry real wires: signal flow between
  gates/drains/sources and passives.

### 4.2 Rows and columns

- Place every transistor on a **row/column lattice**. NMOS devices occupy the
  **bottom rows**, PMOS devices the **top rows**. Rows are horizontal device
  lines (same `y`); columns are vertical stacks (same `x`).
- **A row** means devices side by side sharing a gate line. Ask: *which nets
  drive these gates?* Devices whose gates share a bias belong in the same row.
- **A column** means **stacking** — devices stacked so the source of the upper
  device and the drain of the lower device sit on the same grid line and connect
  with a straight, minimum-length wire.

### 4.3 Rows: the shared-gate bus

- If several devices carry the **same gate bias**, align them vertically (same
  `y`) and draw **one horizontal wire across the row** connecting all their
  gates.
- Keep that bus clear of bodies: run it on the row's bbox **edge** and drop a
  short tap at each gate column — taps that run along a gate column touch only
  bbox *edges*, which `eval` does not count as crossings.
- Sanctioned exception: where the bus must pass *through* a body's interior and
  **every terminal on that net is a gate**, this single overlap is allowed — it
  is the documented special case for matched gate arrays. Flag it and justify
  it; never use it for any other net.

### 4.4 Columns: shared source/drain

- When stacking (columns), **align the shared terminal pair on one horizontal
  line**: the upper device's `s` and the lower device's `d` must match both `x`
  and `y`, giving a straight, ideally zero-length, connection.
- Device pitch for a clean stack equals the symbol's own height (160 units for
  MOS, 240 for BJT), so `s`/`d` coincide exactly on the shared boundary.

### 4.5 Differential symmetry

- Differential nets (`INP/INN`, `OUTP/OUTN`, …) must read as **mirror images**.
  The two matched devices go side by side; **one side carries `--mirrorX`** so
  the pair opens like a mirror.
- Choose a pitch that leaves label clearance and puts a 40-grid point at the
  exact symmetry axis. Do not merely place two identical unmirrored symbols side
  by side.
- Align corresponding drain/collector terminals on one row and source/emitter
  terminals on another. Center shared tail/source circuitry on the symmetry axis
  and orient its gate/base toward its bias source.
- Keep the two halves identically oriented except for the intentional mirror.
- For a three-terminal shared node, route to a centered junction, then split
  into balanced left/right branches. The router places a solder dot only at that
  true multi-branch junction — never add one by hand, and never expect one at an
  ordinary bend.

These rules apply equally to NMOS, PMOS, BJT, folded, cascode, active-load, and
complementary differential structures. Change the polarity and terminal names as
needed, but retain equal spacing, matched mirroring, aligned rows, and centered
shared circuitry.

### 4.5b Mirrors and active loads: control terminals face inward

The same symmetry idea applies to a mirror/active-load pair sitting above (or
below) a differential core — e.g. the PMOS load of a 5T OTA.

- **Mirror the two load devices so their CONTROL terminals face each other.**
  The left load gets `--mirrorX` (its gate points right), the right load stays
  default (gate points left). Their gates then meet across a short open gap, so
  the mirror-gate connection is one clean wire with the bodies on the outer
  sides.
- **Align each load's output terminal (drain) to the corresponding core
  terminal's column** so the connection drops straight down — no diagonal or
  long detour. In the 5T OTA this means M4.d aligns with M1.d and M5.d with M2.d.
- **Diode-connected device:** the drain-to-gate tie is a deliberate route; craft
  it explicitly with a full cell of clearance around the body and reach the gate
  with a short lead, rather than trusting the auto-router to hug the outline.
  Verify with `eval` (no `wireThroughBBoxes`).
- Symmetry axis, even gaps, and the two bodies mirrored "back to back" apply
  exactly as in §4.5: equal halves, gates inward, output terminals aligned.

### 4.6 Labels

- **Every device is labeled** with its instance label (an owned
  `LabelInstance`, created automatically; the refdes renders bold-italic beside
  the body). **Free labels** identify circuit signals: rails, inputs, outputs,
  bias nodes, mirror nodes.
- On transistors the designator sits on the bulk side at gate height (the right
  side of the body for the current symbols). Place labels so they never collide
  with wires.
- Label text supports subscripts with `_{...}` markup (e.g. `C_{GS}`); owned
  instance labels render a trailing numeral as a subscript automatically.
- **Signal labels use the V_/I_ subscript pattern** (`V_{INP}`, `V_{INN}`,
  `V_{BIAS}`, `V_{OUT}`, `I_{BIAS}`): the leading voltage/current letter with the
  rest subscripted. Name the port to match (refdes `VINP` → owned label
  `V_{INP}`). Do NOT label supply/ground — the supply and ground symbols are
  self-explanatory; adding "VDD"/"GND" text is redundant clutter.
- **Horizontal port labels sit one grid square from the port box, aligned toward
  it.** Left-of-port labels use `align: right` (text hugs the port side of its
  box), right-of-port labels use `align: left`. The label box edge is 40 units
  from the port box edge — never overlapping or touching the symbol.
- Do not set component `value` text to convey names — font-12 value text is not
  rendered; port names come from the port's owned label.

## 5. Design recipe: placement first, wiring last

Work in the drafting order from `agent-workflow.md`. Device placement comes
first; wiring comes last.

**Pass 1 — scatter**: add **every** device needed — supply rail reserved for
the top, grounds for the bottom, all passives and transistors positioned roughly
in the regions they belong to. Do not obsess over alignment yet; just get all
parts onto the canvas.

**Pass 2 — iterate rows and columns**, in this order:

1. **Differential matching** — build each diff pair as a mirrored pair (§4.5).
2. **Shared biases** — bring same-bias gates onto one row for a shared-gate bus
   (§4.3).
3. **Shared S/D** — line up stacked source/drain terminals for straight wires
   (§4.4).
4. **Overall connectivity** — route mentally: every terminal should need only a
   short straight Manhattan wire to its net; signal path flows left → right.
5. Snap supply/ground rows to the top/bottom rails.

After each iteration, `eval` — it must stay clean (no bbox overlaps). Then
**lock the placement** — do not keep moving devices while wiring.

**Wiring**:

- Wire with `connect REF.TERM REF.TERM … [--name N]`. Orthogonal wires only.
- Wires must **not** cross another component's footprint (`wireThroughBBoxes`);
  keep route corridors clear.
- Prefer a short jump over a long parallel run; prefer a shared junction over N
  parallel grounds.
- Name meaningful nets (`VDD`, `GND`, `VINP`, `VINN`, `OUT`, `BIAS`, `TAIL`, …)
  with `connect ... --name N` or `net <id> name N`.
- If the wiring comes out awkward (long detours, bodies in the way, crossings),
  **go back to Pass 2** and repair the placement; don't fight the layout with
  long wires.

**Finish**:

- Re-check `eval`: **no dangling terminals**, no incomplete nodes.
- **Last step:** add the `ground` symbol to every net that needs to connect to
  ground, and the `supply` symbols onto the top rail, per each net's needs. Do
  not tie them together with wires (§4.1). Placing them last keeps them from
  blocking the device lattice.

## 6. Verified micro-examples

These short command sequences build the core patterns. Verify them with `eval`
after each, then fit the view (F).

### Mirrored differential pair (shared sources on the center column)

```
clear
add nmos M1 --at 0 0
add nmos M2 --at 480 0 --mirrorX
connect M1.s M2.s --name TAIL
```

The two sources meet on the symmetry column; `M1.d` and `M2.d` sit on one shared
row for the load/output wiring. Give the pair enough pitch for clean label
space.

### Vertical stack (shared source/drain on one grid line)

```
clear
add nmos M1 --at 0 0
add nmos M2 --at 0 160
connect M1.s M2.d --name N
```

`M1.s` and `M2.d` coincide; bboxes touch along the shared boundary. Extend the
column by adding the next device one symbol height (160 for MOS) below.

### Supplies on a rail, grounds on a rail

```
clear
add supply VDD --at 240 -320
add supply VDD2 --at 720 -320
add ground GND --at 240 320
add ground GND2 --at 600 320
```

Both supplies sit on the same top rail line and both grounds on the same bottom
rail line; there is **no net between them** — each icon cools its own local net.
Identify a rail with a free label (e.g. "VDD") where its name must appear.

## 7. Verification checklist

Run after every mutation and before reporting success:

```
eval
```

"Good" = empty `unconnectedTerminals`, `overlappingBBoxes`,
`wireThroughBBoxes`, `diagonalWireSegments`, and `gridViolations`, and the
component/terminal/net counts match intent. For the machine report use
`eval --json`. Then eyeball the layout with `ascii`, and study real coordinates
with `state` — every origin and route point a multiple of 40, rails flat on the
top/bottom lines, rows sharing one `y`, columns sharing one `x`, S/D junctions
on the lattice.

In the browser: **fit the view (F)** and check that the rendered drawing matches
the netlist — the same rules, now visually.

Workflow with the human:

- **One small change at a time**; `eval` after each.
- **Show the result** (fit the view); don't make the human guess what changed.
- **Don't rearrange approved layout**; build on it.
- When `eval` is clean, `ascii` reads top-to-bottom as supplies→signal→ground,
  and the layout looks like a textbook figure, that snapshot is the deliverable.