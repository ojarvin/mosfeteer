# Placement, Wiring & Layout Guidelines (Analog)

> Agent workflow, live-server operations, current symbol geometry, and circuit
> learnings are documented in `agent-operations.md`, `diagram-quality.md`, and
> `agent-workflow.md`. Those documents and `AGENTS.md` are authoritative when
> this older reference conflicts with the current working-tree symbols.

Rules for placing components, drawing wires, and laying out clean,
**textbook-grade** analog schematics with `node src/cli/index.js <command>`.
The reference standard is the "Razavi look": ordered transistor arrays, straight
rails, logical signal flow, zero redundant wiring. The deliverable must also
report clean in `eval`.

## 1. Goal

- Signals flow **left to right**: inputs in on the left, outputs out on the right.
- Rows and columns everywhere; every array, pair, and stack reads at a glance.
- Supplies form a **straight horizontal line at the top**; grounds form a straight
  horizontal line at the **bottom**.
- No overlaps, no stray long wires, no dangling terminals, no redundant parallel
  ground/supply runs. One device, one place, one purpose.

## 2. The 40-grid contract

- The global grid step is `GRID = 40`. **Every** component transform origin, every
  terminal coordinate, and every wire/bend point must be a multiple of 40.
- Symbol-internal graphics are exempt — symbol bodies sit between terminals. You
  only place *origins* and *terminals*.
- `add --at`/`move` auto-snap, but **still use multiples of 40** so bbox edges,
  rails and wire bends all land on grid lines.
- `eval` reports `gridViolations` for any off-grid origin or terminal. A dirty
  report fails the task.

## 3. Component reference

Command shape: `add <type> [refdes] [--at X Y] [--rot D] [--mirrorX] [--mirrorY] [--value V]`

| type | terminals | bbox (local units) |
|------|-----------|--------------------|
| resistor / capacitor / inductor / diode | `a` (left) `b` (right) | x:0..120, y:-40..40 |
| nmos / pmos | `g`(left) `d`(top-right) `s`(bottom-right) | x:0..120, y:-40..40 |
| npn / pnp | `b`(left) `c`(top-right) `e`(bottom-right) | x:0..120, y:-40..40 |
| ground | `gnd` (top edge) | x:-40..40, y:0..40 |
| supply | `p` (bottom edge) | x:-40..40, y:-40..0 |
| input / output / inputoutput | `p` (right edge) | x:-40..0, y:-40..40 |

- **Two-terminal parts** (R/C/L/D) at `rot=0` point `b` right — the default for a
  horizontal run; `rot 90` makes them vertical.
- **Transistors**: at `rot=0` the gate/base is on the left, drain/collector
  top-right, source/emitter bottom-right. `mirrorX` flips the body across the
  gate line (gate stays on the same line; `d`/`s` swap to the other side of the
  gate column — this is how a matched pair is built, see §5.4).
- **Ground** attaches with `gnd` on its top edge (place it below the net, hanging
  down off the wire). **Supply** attaches `p` on its bottom edge (drop it onto the
  rail above the net). Ports face their `p` into the circuit.
- Transform order is **mirror -> rotate -> translate** (SVG `translate rotate scale`).

**Spacing**: at least one full 40-grid cell between adjacent footprints. Bbox
*edge touches* are legal (strict-overlap model); a deliberate touch is how stacks
and mirrored pairs share a boundary — never overlap.

## 4. Analog layout discipline (the method)

### 4.1 Supplies top rail, grounds bottom rail

- All `supply` symbols go on one line — the top rail (`--rot 180` so `p` faces the
  schematic, `p` on the rail line itself). All `ground` symbols go on one line —
  the bottom rail.
- **Never wire two supplies together; never wire two grounds together.** A
  supply/ground icon attached to a net is that net's rail connection; rails are
  implicitly global. Connecting them with real wires is redundant, clutters the
  drawing, and breaks the rows/columns above them.
- Only **local** device nets carry real wires: signal flow between gates/drains/
  sources and passive parts.

### 4.2 Rows and columns

- Place every transistor on a **row/column lattice**. NMOS devices occupy the
  **bottom rows**, PMOS devices the **top rows**. Rows are horizontal device
  lines (same `y`); columns are vertical stacks (same `x`).
- **A row** means devices side by side sharing a gate line. Ask: *which nets drive
  these gates?* Devices whose gates share a bias belong in the same row.
- **A column** means **stacking** — devices stacked so that the source of the
  upper device and the drain of the lower device sit on the **same grid line** and
  connect with a straight, minimum-length wire.

### 4.3 Rows: the shared-gate bus

- If several devices carry the **same gate bias**, align them vertically (same
  `y`) and draw **one horizontal wire across the row** connecting all their gates.
- Keep that bus clear of bodies: run it on the row's bbox **top edge** and drop a
  short tap at each gate column — taps that run along a gate column touch only
  bbox *edges*, which `eval` does not count as crossings.
- Sanctioned exception: where the bus must pass *through* a body's interior and
  **every terminal on that net is a gate**, this single overlap is allowed — it is
  the documented special case for matched gate arrays. Flag it to the human and
  justify it; never use it for any other net.

### 4.4 Columns: shared source/drain

- When stacking (columns), **align the shared terminal pair on one horizontal
  line**: upper device's `s` and lower device's `d` must match `x` (and `y`),
  giving a straight, ideally zero-length, connection.
- Device pitch for a clean stack: place the lower device `80` below the upper one
  (the symbol's own height) so `s`/`d` coincide exactly on the shared boundary.
- Matched pairs are the same idea applied sideways (§4.5).

### 4.5 Differential symmetry

- Differential nets (`INP/INN`, `INM/INT`, `OUTP/OUTN`, …) must read as **mirror
  images**. The two matched devices go side by side; **one side carries
  `--mirrorX`** so the pair opens like a mirror.
- Choose a pitch that leaves label clearance and puts a 40-grid point at the
  exact symmetry axis. Mirror the right-hand device with `--mirrorX`; do not
  merely place two identical unmirrored symbols side by side.
- Align corresponding drain/collector terminals on one row and
  source/emitter terminals on another. Center shared tail/source circuitry on
  the symmetry axis and orient its gate/base toward its bias source.
- Keep the two halves identically oriented except for the intentional mirror.
- For a three-terminal shared node, route to a centered junction, then split
  into balanced left/right branches. Add a solder dot only at that true
  multi-branch junction or at a crossing, never at an ordinary bend.

These rules apply equally to NMOS, PMOS, BJT, folded, cascode, active-load, and
complementary differential structures. Change the polarity and terminal names as
needed, but retain equal spacing, matched mirroring, aligned rows, and centered
shared circuitry.

### 4.6 Labels

- **Every device is labeled** with its reference designator (`M1`, `R1`, …) and a
  value where meaningful (`--value`).
- On transistors the designator sits on the **bulk/substrate side**: below the
  body for NMOS, above for PMOS (the body is on the rail-facing side of the row it
  occupies). Place the label so it never collides with wires.

## 5. Design recipe: two-pass placement, then wiring

Work matches the editor workflow (normal/insert). Device placement comes first;
wiring comes last.

### Pass 1 — scatter

- Add **every** device needed: supply rail up top, grounds reserved for the bottom,
  all passives and transistors positioned roughly in the regions they belong to.
- Do not obsess over alignment yet; just get all parts onto the canvas.

### Pass 2 — iterate rows and columns

Order of refinement:
1. **Differential matching** — build each diff pair as a mirrored pair (§4.5).
2. **Shared biases** — bring same-bias gates onto one row for a shared-gate bus (§4.3).
3. **Shared S/D** — line up stacked source/drain terminals for straight wires (§4.4).
4. **Overall connectivity** — route mentally: every terminal should need only a
   short straight Manhattan wire to its net; signal path flows left → right.
5. Snap supply/ground rows to the top/bottom rails.
After each iteration: `eval` — it must stay clean (no bbox overlaps).

Then **lock the placement** — do not keep moving devices while wiring.

### Wiring

- Wire with `connect REF.TERM REP.TERM … [--name N]`. Orthogonal wires only.
- Wires must **not** cross another component's footprint (`wireThroughBBoxes`);
  keep route corridors clear. The only exceptions are the ones already sanctioned
  in §4.3.
- Prefer a short jump over a long parallel run; prefer a shared node (junction)
  over N parallel grounds.
- Name nets (`vcc`, `gnd`, `out`, `outn`, `bias`, `S`, …) with `net <id> name X`.
- If the wiring comes out awkward (long detours, bodies in the way, crossings),
  **go back to Pass 2** and repair the placement; don't fight the layout with
  long wires.

### Finish

- Re-check `eval`: **no dangling terminals**, no incomplete nodes.
- **Last step:** add the `ground` symbol to every net that needs to connect to
  ground, and the `supply` symbols onto the top rail, per each net's needs. Do not
  tie them together with wires (§4.1). Placing them last keeps them from blocking
  the device lattice.

## 6. Verified micro-examples (build these to internalize the method)

### Mirrored differential pair (shared S/D on center line)

```
clear
add nmos M1 --at 0 0
add nmos M2 --at 240 0 --mirrorX
connect M1.s M2.s --name S
connect M1.d M2.d
```

Result: `M1.d`(120,-40) and `M2.d`(120,-40) coincide; same for `s` — two straight
zero-length wires, bboxes touch at `x=120`. INP/INN drive `M1.g`/`M2.g` (the outer
gates) as separate nets.

### Vertical stack (shared S/D, straight line)

```
clear
add nmos M1 --at 0 0
add nmos M2 --at 0 80
connect M1.s M2.d --name N
```

`M1.s` and `M2.d` coincide at (120,40); bboxes touch along `y=40`. Extend the
column by adding the next device at `--at 0 160`, etc.

### Hierarchy of supplies / grounds

```
clear
add supply VDD1 --at 0 -160 --value VDD
add supply VDD2 --at 480 -160 --value VDD   # same rail line; separate symbol, no wire
add ground GND1 --at 160 200
add ground GND2 --at 560 200               # bottom rail; separate symbol, no wire
```

Both supplies sit on `y=-160`, both grounds on `y=200`; there is **no net between
them** — each cools its own local net.

## 7. Verification checklist

Run after every mutation and before reporting success:

```
eval
```

"Good" = empty `unconnectedTerminals`, `overlappingBBoxes`, `wireThroughBBoxes`,
and `gridViolations`, and component/terminal/net counts match intent. For the
machine report:

```
eval --json
```

Then eyeball layout cheaply:

```
ascii
```

Then study the real coordinates:

```
svg data/x.svg --grid
```

`--grid` shows the 40-unit grid; read the source — every `translate(x y)` and net
point a multiple of 40, rails flat on the top/bottom lines, rows sharing one `y`,
columns sharing one `x`, S/D junctions on the lattice. Optionally `png data/x.png`.

Workflow with the human:

- **One small change at a time**; `eval` after each.
- **Show the diff**; don't make the human guess what changed.
- **Don't rearrange approved layout**; build on it.
- When `eval` is clean, `ascii` reads top-to-bottom as supplies→signal→ground, and
  the layout looks like a textbook figure, that snapshot is the deliverable.
