# Agent Workflow

This guide defines the process an agent follows when asked to draw a new
circuit. Read it together with `agent-operations.md` (how to drive the editor,
and the live-viewing recipe), `diagram-quality.md` (the standard to meet), and
`placement.md` (layout discipline).

The workflow is a live, iterative session. The user watches every step, so the
session must be observable and the drawing must stay editable.

## Start So The User Sees You Live

The very first action is to make your work visible, then keep it visible:

1. **Start the server** (`./start.sh`) and open the app in a browser you drive.
2. **Tell the user the circuit name** (e.g. `5t-ota`) and ask them to load it in
   their own window once. Their editor re-syncs from the server every 500 ms, so
   every time you SAVE, their view updates and re-fits automatically.
3. **Save after every meaningful step** (`PUT /api/circuits/<name>` or the GUI
   Save button), and **fit the view** (F) after each edit.
4. If you use browser automation, keep ONE persistent connection (see
   `agent-operations.md` → "Reliable Automation") — reconnecting per command
   drops the page and can trigger the "Leave site?" prompt.

## Principles

- **Open the server and browser first**, before doing anything else, so the user
  can see each action as it happens.
- **Fit the view after every edit** so the change is visible; never leave the
  canvas zoomed away from what you just did.
- **Iterate at each step** toward a clean, professional, textbook-grade result:
  small corrections, `eval` after each, and only then move on.
- **Space components out** — an airy, balanced layout beats a correct-but-crammed
  one (`placement.md` §2.1, `diagram-quality.md` "Spacing").
- **Do not script around the application.** The editor and its command language
  provide every operation the workflow needs — place parts, wire, move, mirror,
  rotate, label, save. Use them.
- **Ask clarifying questions** about conventions that materially affect the
  drawing (input/output polarity, rail names, single-ended vs differential
  output, active-load style) before committing a large amount of work.

## Existing Designs Are Training Material

Before generating a circuit, query `/api/circuits` and inspect designs with a
similar topology. Read their `circuit.json`, `circuit.svg`, and `learnings.md`.
Learn from both successful patterns and recorded failures:

- component spacing and orientation;
- terminal conventions;
- label placement;
- route shapes that remain stable during edits;
- known symbol or router limitations.

Consult only `circuits/` and the global guides. Re-derive a topology from your
understanding of analog circuits and validate every net; do not copy a circuit
blindly.

## Drafting Order

Use this order for new diagrams:

1. **Place the functional components first**, without input/output pins.
2. **Apply connectivity-aware mirroring, rotation, spacing, and alignment.**
   Symbol defaults already give you PMOS source-up and mirrored output ports;
   add `--mirrorX` for the right-hand matched device. For differential
   structures, establish the center grid column and align shared-terminal rows;
   for mirror/active loads, face the control terminals inward (see
   `placement.md` "Differential symmetry" and "Mirrors and active loads").
   Keep gaps an even number of cells and give the layout room to breathe.
3. **Wire the functional components.** Junction solder dots at multi-terminal
   nodes are placed automatically by the routing — never add `solder`
   components by hand. Keep the shared branch off the terminal row so the
   junction is a real T. For deliberate ties (diode gate-to-drain), craft the
   route explicitly with body clearance.
4. **Add ground and supply symbols.**
5. **Add input and output pins last**, routing them from the already-established
   circuit rather than allowing them to dictate device placement.
6. **Label external signals** with the V_/I_ subscript pattern; do not label
   supply/ground; place port labels one square from the port, aligned toward it
   (see `diagram-quality.md` "Naming"/"Labels"). Instance labels appear
   automatically.

## Iteration With The User

Expose progress through the live browser, accept user feedback, and make small
corrections rather than regenerating the entire design. When a user asks for a
change, preserve accepted topology and manual routes unless the request
explicitly changes them. After each correction, rerun `eval` and update the
learning file if the correction revealed a reusable rule.

Before saving, review every component label position and every wire crossing.
Remove unrequested value or explanatory text, orient symmetric components toward
open label space, and rely on the router's automatic solder dots for junction
annotations.

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
temporary debugging output. Keep the file scalable: each new drawing attempt
adds its own verified observations to the relevant circuit's file, so guidance
accumulates without bloating the global guides.