# Agent Workflow And Learnings

## Existing Designs Are Training Material

Before generating a circuit, query `/api/circuits` and inspect designs with a
similar topology. Read their `circuit.json`, `circuit.svg`, and `learnings.md`.
Learn from both successful patterns and recorded failures:

- component spacing and orientation;
- terminal conventions;
- label placement;
- route shapes that remain stable during edits;
- known symbol or router limitations.

Do not copy a circuit blindly. Re-derive its topology and validate every net.

## Circuit-Specific Learning File

Every saved circuit may have a companion file:

```text
circuits/<name>/learnings.md
```

Use this structure:

```markdown
# Learnings: <name>

## Topology
- Key convention or design assumption.

## Placement
- Coordinates or spacing that worked well.

## Routing
- Manual route choice and why it avoids trouble.

## Problems And Fixes
- Problem: ...
  Cause: ...
  Fix: ...

## Advice For Future Agents
- Reusable guidance specific to this design.
```

Only record verified observations. Do not record speculative explanations or
temporary debugging output.

## User-Agent Iteration

The agent should expose progress through the live browser, accept user feedback,
and make small corrections rather than regenerating the entire design. When a
user asks for a change, preserve accepted topology and manual routes unless the
request explicitly changes them. After each correction, rerun evaluation and
update the learning file if the correction revealed a reusable rule.

Before saving, review every component label position and every wire crossing.
Remove unrequested value or explanatory text, orient symmetric components toward
open label space, and add solder annotations for same-net crossings.

## Drafting Order

Use this order for new diagrams:

1. Place the functional components first, without input/output pins.
2. Apply connectivity-aware mirroring, rotation, spacing, and alignment. For
   differential structures, establish the center grid line and align D/S rows.
   Remember: place PMOS with an explicit `--mirrorY` (source up); `add pmos`
   alone leaves the drain on top.
3. Wire the functional components. Junction solder dots at multi-terminal nodes
   are placed automatically by the routing, so do not add `solder` components by
   hand — keep the shared branch off the terminal row so the junction is a real T.
4. Add ground and supply symbols.
5. Add input and output pins last, routing them from the already-established
   circuit rather than allowing them to dictate device placement.

Existing saved circuits are revalidated through `Circuit.fromJSON` on load, so
current symbol geometry and auto-placed junction solders are applied even to old
designs.
