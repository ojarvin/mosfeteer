# Successful Diagram Guide

A successful schematic is electrically correct, readable, editable, and easy
to review. Passing a parser check alone is not sufficient.

This is the quality standard the drawing process must meet; produce the drawing
through the live editor following `agent-operations.md` (how to drive it) and
`agent-workflow.md` (the process), with the layout discipline in
`placement.md`.

## Electrical Correctness

- Implement the requested topology, not merely the requested component count.
- Use meaningful net names such as `VDD`, `GND`, `VIN+`, `VIN-`, `OUT`, and bias
  names where they clarify intent.
- Connect every device terminal required by the topology.
- Leave only intentional external terminals dangling, and label them.
- Use the correct device polarity and orientation. For example, the default PMOS
  orientation has source up and drain down.
- Make current mirrors, diode connections, differential pairs, and tail sources
  visually and electrically unambiguous.

## Geometry And Routing

- Place all origins, terminals, labels, and route points on the 40-unit grid.
- Keep component bounding boxes separated. Touching edges are preferable to
  positive-area overlaps when a compact layout is necessary.
- Keep every wire segment horizontal or vertical. Never leave diagonal segments
  in JSON or SVG.
- Route around component interiors. Boundary-hugging is acceptable where the
  router and evaluator define the boundary as non-interior.
- Prefer short, direct routes with few bends, but do not trade away readability.
- Use explicit routes for deliberate hand-edited wiring. Do not silently replace
  a user's manual route with a fresh autoroute.
- When moving a component, preserve the existing wire body and move only the
  terminal connection portions needed to keep pins attached.
- Avoid wire crossings. If a crossing is unavoidable, make the connectivity
  distinction obvious and use a junction only when the net is actually joined.

### Spacing: airy and balanced, never crammed

A professional schematic has room to breathe. Crammed layouts are the most
common readability failure — they look "correct but busy".

- **Use even-cell gaps** (2, 4, 6, 8 … grid cells) between rows and columns so
  shared nodes sit on grid points and the layout reads as deliberate.
- **Keep bodies apart**: at least one full empty cell around every device, and
  a wide pitch for matched pairs/mirrors so each half has its own label space
  and a clean wire corridor.
- **Plan the wire lanes**: after placing devices, every net should have a short,
  straight, unobstructed path. If a wire must detour around a body, widen the
  layout rather than forcing the route.
- **When in doubt, space it out.** Extra whitespace costs nothing and prevents
  label collisions and tangled wires. A drawing that is slightly large but
  clearly readable is better than a tight one that is hard to follow.
- Review the fitted view (F), not just the report: if any two labels overlap or
  a wire threads tightly between bodies, increase spacing and re-check.

## Visual Structure

Use a consistent signal-flow layout unless the circuit convention suggests
otherwise:

- supplies at the top;
- ground or sinks at the bottom;
- inputs entering from the left;
- outputs leaving toward the right;
- active loads and mirrors grouped together;
- bias inputs placed near the devices they control.

Leave enough whitespace for labels and future edits. Do not hide a terminal or
wire under a symbol label. Component IDs should remain readable and unique.

For differential structures:

- Mirror the right-hand device across the vertical center axis; do not merely
  place two identical unmirrored symbols side by side.
- Choose an even device pitch so the exact midpoint is itself a 40-unit grid
  point. Put shared tail or source circuitry on that midpoint.
- Give the pair enough pitch for separate instance labels and clean wire
  corridors; symmetry is not useful if labels overlap.
- Align both halves' corresponding output terminals on one horizontal row and
  corresponding shared terminals on another horizontal row.
- Center the tail current source or bias device so its shared terminal is on the
  midpoint grid column. Orient its gate/base toward the side where its bias
  source will enter.
- Keep output leads straight where possible. If both leads run to the right,
  make their final endpoints share the same horizontal row and avoid unnecessary
  doglegs.

These rules generalize by device type: use drain/source for MOS pairs,
collector/emitter for BJT pairs, and the corresponding output/common terminals
for other matched devices. The polarity may change, but the visual contract does
not: equal halves, one explicit centerline, aligned terminal rows, and centered
shared circuitry. Apply the same discipline to PMOS input pairs, folded or
cascode differential cores, active loads, and complementary pairs.

For a three-terminal shared node, route the branch to a center junction first,
then route balanced left and right branches. Do not let JSON terminal order create
an asymmetric visual tree. Multi-branch junctions (3+ terminals of one net) are
marked automatically: the routing algorithm places an actual `solder` component
at the balanced junction, so the agent never adds one by hand. Keep the shared
branch off the terminal row so a real T-junction (not a collinear line) exists.
An ordinary corner does not receive a dot, and different nets that merely cross
never share one.

## Naming

Signal names are lowercase-free, typed signal names with a leading voltage or
current letter and a subscript for the rest: `V_{INP}`, `V_{INN}`, `V_{BIAS}`,
`V_{OUT}`, `V_{DD}`, `I_{BIAS}`, `V_{REF}`. In JSON, net names and port refdes
use the plain form (`VINP`, `VOUT`, `BIAS`); the label text carries the markup
(`V_{INP}`). Name nets for their purpose (`TAIL`, `GND`, `VDD`, `VOUT`,
`DIODE`, `BIAS`) — a net's name appears in the editor's net list, so it should
tell the reader what the node does.

## Labels

Use labels for external interfaces and important internal nodes. At minimum,
label:

- every input and output (the port labels);
- bias/reference nodes;
- feedback or mirror nodes when their purpose is not obvious.

**Do not label supply or ground.** The supply and ground symbols already say it;
adding "VDD"/"GND" text is redundant clutter. Rail *names* still matter for the
net name (a net named `VDD` is fine).

Labels are separate `LabelInstance` objects, not component types. Owned instance
labels identify components; free labels identify circuit signals. Keep free labels
off component bodies and route paths.

**No font-12 value/refdes text.** Component identifiers are dedicated owned label
objects. Ports auto-create their identifier label from the refdes (refPrefix
`I`/`O`/`IO`, so `add input VINP` labels the pin "VINP"). Do not set component
`value` text to convey names.

Label text supports subscripts with `_{...}` markup (e.g. `C_{GS}`, `M_{1}`);
owned instance labels render trailing digits as a subscript (M1 → M with
subscript 1) for the textbook look. Alignment (center/left/right), anchors, and
the grid-snapped box model are unchanged.

**Port labels sit one grid square from the port symbol, aligned toward it.**
Left-of-port labels are `align: right`; right-of-port labels are `align: left`.
The label box edge is 40 units clear of the port box — never overlapping the
symbol. Horizontal ports are the common case; keep the same one-square rule for
any label near a symbol.

Do not add extra descriptive text or component values by default. Unless the user
asks for values or annotations, the only component text should be the inherent
instance label. For mirror-symmetric parts such as resistors, capacitors,
inductors, diodes, and switches, choose the available mirror/orientation that
places the instance label in the clearest open space. For example, a horizontal
resistor with room above should be mirrored vertically so its label is above the
body rather than below it.

## Evaluation Checklist

Run the built-in evaluation and treat any of these as a defect unless explicitly
justified:

```text
unconnected terminals
overlapping bboxes
grid violations
wireThroughBBoxes
diagonal route segments
unexpectedly long or tangled routes
```

Then inspect the SVG or browser view. Check that the visual interpretation matches
the electrical netlist, especially at coincident terminals and multi-terminal
junctions.

## Review Standard

The final result should let another engineer answer these questions without
opening the JSON:

1. What is the signal flow?
2. Which nodes are inputs, outputs, supply, ground, and bias?
3. Which devices form each functional block?
4. Are mirrored or diode-connected devices oriented correctly?
5. Can the design be modified without first untangling the wires?
