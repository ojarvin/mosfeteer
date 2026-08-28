# Agent Operations Guide

This guide explains how an agent should operate schematic-spawner. The goal is to
create a real, editable circuit in the running web application, not merely to
describe a circuit in chat.

The global guides form the complete drawing workflow. Read them before doing
anything:

- `agent-workflow.md` — the step-by-step process for building a circuit and
  recording per-circuit learnings.
- `diagram-quality.md` — the electrical, geometric, and visual standard the
  result must meet.
- `placement.md` — how to lay devices out (rows, columns, mirrors, stacks) and
  wire them cleanly.
- `AGENTS.md` — current symbol geometry, the label model, and routing/editor
  behavior.

When asked to draw a circuit, operate the live editor exactly as this guide
describes. Do not inspect application internals or invent ad-hoc scripts: the
editor and its command language already expose every operation the workflow
needs (place components, wire, move, mirror, rotate, label, save). If the app
does not offer an operation you think you need, that is a signal to adjust the
drawing approach, not to script around the tool.

## Start A Live Session

Run the project from its root:

```sh
./start.sh
```

`start.sh` starts `src/web/serve.js` and opens `/` in your browser. The server
is normally at `http://127.0.0.1:8080/`. Use `PORT=<port> ./start.sh` (and a
separate debug Chrome on its own debugging port) when you need a session
isolated from the user's production instance.

Keep the server and the visible browser window open for the whole task: the
user watches each action you take. Do not silently replace the user's design.
After every meaningful edit, **fit the view to the drawing** so the change is
visible — press `F` (or dispatch the normal-mode `F` key event from automation).

## How The User Watches You Work (read this first)

The app's editor polls the server every 500 ms (`syncActiveCircuit`) and applies
remote changes to whatever circuit is loaded — **so the user can watch you live
by simply loading the circuit you are building, in a browser of their own.**

- The agent builds in a browser it drives (visible, or headless for automation).
- The user opens the app in their own window and **loads the circuit name** once
  (type it in the name box → Load). From then on, every time you SAVE that
  circuit, their view updates automatically (and re-fits).
- Therefore: **save after every meaningful step** (`PUT /api/circuits/<name>` or
  the GUI Save button). Saving writes both `circuit.json` and `circuit.svg`.
- The two browsers never share state except through the saved file. If the user
  is not watching a named circuit, nothing you do will appear — tell them the
  name to load at the start.

## Reliable Automation (pitfalls that cost a whole session)

- **Pin one browser tab and keep ONE persistent CDP connection** for the whole
  session (e.g. a small polling daemon). Reconnecting per command drops the
  page's debugger connection and can trigger the "Leave site?" prompt (the app
  has a `beforeunload` handler for unsaved changes).
- **Never `pkill -f` a pattern that appears in your own command line** — it
  matches and kills your own shell. Use a `quit` command in your daemon instead.
- **`syncActiveCircuit` can silently revert your tab's local state** to the
  server file when your local state has no "unsaved" changes. Build
  deterministically and, after every save, **verify the FILE** with
  `GET /api/circuits/<name>` — never trust only the live tab.
- **Check multi-terminal net coverage via `branches`, not just `eval`.** `eval`
  reports a terminal "connected" if it is in a net even when no wire reaches it.
  A 3+ terminal net is stored as `branches` (one polyline per arm); confirm
  every terminal's world position appears in some branch.
- Prefer the app's command language (`window.__run`) over mouse/keyboard
  simulation: place parts, wire, move, mirror, rotate, name, save. Use mouse
  input only for things the command line lacks (label text edits).

## Drive The Editor

Two equivalent ways to make the editor do something:

1. The **command prompt** — the `:` input in the top toolbar. Type a command
   and press Enter.
2. **`window.__run('<command line>')`** — the same command language, exposed for
   automation (CDP `Runtime.evaluate`).

Every command runs against the live circuit, pushes an undo step, and
re-renders the canvas. After running a command, call `window.__circuit()` to
read back `{comps, nets, labels}` and verify the result; `window.__load(state)`
loads a complete version-1 state object into the visible editor.

You may also use the mouse and keyboard directly (insert mode `i` places parts,
wire mode `w` draws wires, `r`/`R` rotate, `x`/`X` mirror, `dd` deletes, `v`
box-selects, Ctrl+A selects all, `u`/`U`/Ctrl+Z/Ctrl+Y undo/redo). The command
language below is the reliable path for agents; prefer it for everything in the
workflow, and back up each step with `window.__circuit()`.

### Command reference

```text
clear                          start an empty circuit
add <type> [refdes] [--at X Y] [--rot D] [--mirrorX] [--mirrorY] [--value V]
move <refdes> <X> <Y>          move, snapped to the 40-grid
rotate <refdes> [deg=90]       rotate by multiples of 90
mirror <refdes> <x|y>          flip along an axis
value <refdes> <V>             set value text
rename <refdes> <new>          rename a component (updates its instance label)
rm <refdes>                    remove a component
connect REF.TERM REF.TERM ... [--name N]     (alias wire) join terminals into one net
disconnect REF.TERM            detach one terminal from its net
nets                           list nets with terminals and lengths
net <id> add|drop|name|rm ...  manage a net, e.g. net N1 add R1.a ; net N1 name OUT
list                           list components with world terminals
state                          full JSON state
bounds                         drawing extents
eval                           quality report (unconnected/overlaps/off-grid/diagonals)
ascii                          coarse ASCII layout preview
svg [file] [--grid]            export SVG (needs file I/O; the browser returns the string with --json)
save <file> | load <file>      JSON snapshot I/O (needs file I/O)
help                           full command list
```

- `--mirrorX`/`--mirrorY` are **optional**. When omitted, the symbol's own
  defaults apply (PMOS places source-up; output ports place mirrored outward).
  Pass a mirror flag only to override that default.
- `add` without `--at` picks an automatic position; prefer explicit `--at` on
  the grid.
- Saving through the browser uses the **GUI Save** button (equivalently
  `PUT /api/circuits/<name>`), which writes both `circuit.json` and
  `circuit.svg`. The `save`/`svg` commands require file I/O the browser does not
  provide — do not rely on them in a live session.

## Inspect Existing Circuits

Read the list first:

```text
GET /api/circuits
GET /api/circuits/<name>
```

Each saved circuit lives in `circuits/<name>/` as `circuit.json` and
`circuit.svg`, possibly with a `learnings.md`. Before creating a related design,
load and inspect the existing JSON and its learnings file. Existing designs in
`circuits/` are the only training material to consult; do not go hunting through
the codebase. Use your general knowledge of analog circuits to decide what a
topology must contain, and check the guides here for how to draw it.

## Construct A Circuit

Prefer the visible editor and small, observable operations:

```text
: add nmos M1 --at 120 120
: add pmos M2 --at 120 -120
: connect M1.d M2.d --name OUT
: eval
```

Work in this order (details in `agent-workflow.md`): functional components first
→ connectivity-aware mirroring and alignment → wiring → supply/ground →
input/output pins last. Then label rails and signals, and fit the view.

For a large design you may construct a complete version-1 JSON state and load it
with `window.__load(state)`; every component must be grid-aligned, nets
reference terminals as `{comp, term}`, and explicit routes are preserved when
present. Prefer incremental steps in the editor so the user can watch.

The current grid is 40 units. Terminal names depend on the symbol (see
`placement.md` for the full table):

```text
nmos/pmos: g d s
npn/pnp:   b c e
two-pin parts: a b
ports:     p
ground:    gnd
supply:    p
sources:   a b
```

## Symbol placement notes (current)

- **PMOS places source-up by default** (`defaultMirrorY`). `add pmos M1 --at X Y`
  already puts the source at the top and the drain at the bottom; no flag is
  needed. Verify from the `add` output that `s` is at y−80 and `d` at y+80
  relative to the gate row before wiring.
- **Output ports place mirrored** (terminal on the circuit side, box+arrow
  outward). Right-hand pair devices get `--mirrorX` so the pair opens like a
  mirror.
- **Junction solder dots are placed by the router automatically** — never add a
  `solder` component by hand. Connecting 3+ terminals of one net auto-creates a
  real `solder` at the balanced junction (keep the shared branch off the shared
  terminal row so a true T-junction exists) and prunes it when the junction
  dissolves.
- **Port identifiers are owned label objects.** `add input VINP` auto-creates
  the bold-italic identifier label "VINP". Font-12 value text is not rendered —
  do not set component values to convey names.
- **Supply and ground carry no automatic labels.** Identify the VDD rail with a
  free label object when its name must appear.

Use `Circuit.fromJSON` semantics when creating or reloading states (the editor
does this automatically). Never duplicate symbol geometry in a circuit file.

## Iterate With The User

Use this loop:

1. State the intended topology and signal names.
2. Place a logical block or small group of components.
3. Connect its nets and let the user see the result (fit the view).
4. Run `eval` and inspect the rendered view.
5. Fix topology, placement, labels, or routes before continuing.
6. Ask the user to confirm ambiguous conventions such as input polarity or
   supply naming.
7. Save only after the user accepts the design.

Avoid one opaque batch operation when live browser automation is available.
Keep the circuit editable after every meaningful step.

## Save And Learn

Use the GUI Save control or `PUT /api/circuits/<name>`. Saving must produce
both `circuits/<name>/circuit.json` and `circuits/<name>/circuit.svg`. The JSON
is the source of truth; the SVG is a review/export artifact.

When placing components, do not add explanatory or value text unless the user
explicitly requests it. Components render only their inherent instance labels by
default.

After a non-obvious routing or symbol issue, update `circuits/<name>/learnings.md`
(structure in `agent-workflow.md`). Record the problem, the observed cause, the
successful fix, and any reusable coordinate or terminal convention. Keep it
specific to that circuit and useful to the next agent. Do not put generated
circuit data or learnings in `AGENTS.md`.

## Final Verification

Before presenting a circuit as complete:

```text
: eval
: state
```

Confirm that:

- every required electrical terminal is connected or intentionally exposed;
- there are no component overlaps;
- there are no off-grid coordinates;
- there are no diagonal wire segments;
- wires do not run through component interiors;
- labels identify external pins, supplies, ground, and output;
- the browser view and saved SVG agree with the JSON topology.