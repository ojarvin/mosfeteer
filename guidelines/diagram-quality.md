# Successful Diagram Guide

A successful schematic is electrically correct, readable, editable, and easy
to review. Passing a parser check alone is not sufficient.

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
an asymmetric visual tree. Place a solder dot only at the actual multi-branch
junction or crossing; an ordinary corner does not receive a dot.

## Labels

Use labels for external interfaces and important internal nodes. At minimum,
label:

- supply rails;
- ground;
- every input;
- every output;
- bias/reference nodes;
- feedback or mirror nodes when their purpose is not obvious.

Labels are separate `LabelInstance` objects, not component types. Owned instance
labels identify components; free labels identify circuit signals. Keep free labels
off component bodies and route paths.

Do not add extra descriptive text or component values by default. Unless the user
asks for values or annotations, the only component text should be the inherent
instance label. For mirror-symmetric parts such as resistors, capacitors,
inductors, diodes, and switches, choose the available mirror/orientation that
places the instance label in the clearest open space. For example, a horizontal
resistor with room above should be mirrored vertically so its label is above the
body rather than below it.

At every wire crossing, determine whether the crossing wires belong to the same
named net. If they do, place a `solder` dot at the crossing. Same-net crossings
must never be left visually ambiguous. Do not add a solder dot to crossings of
different nets.

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
