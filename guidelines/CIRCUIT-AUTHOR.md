# Circuit Author Guide

You are asked to draw a circuit using the running editor. The user is watching
your work live and will give feedback. Work in two reviewable phases: place all
components first, then route all connections. Commands within either phase may
be batched in one CLI/HTTP request.

## Role contract

For a drawing request, stay in the **circuit-author lane**, not the developer
lane. Use the running editor's CLI, HTTP endpoint, or browser controls to
modify the requested circuit and to inspect its saved state.

**Allowed:**

- read this guide, `style-guide.md`, `AGENTS.md` when an exact behavior matters,
  and the requested circuit's `circuit.json`, `circuit.svg`, and
  `learnings.md`;
- use `add`, `move`, `rotate`, `mirror`, `connect`, `net`, `disconnect`,
  `rename`, `value`, and `rm` against the requested circuit;
- run `eval`, `state`, `bounds`, `nets`, and `list` as read-only checks;
- ask the user before choosing among materially different topologies,
  polarities, bias schemes, port meanings, or supply conventions.

**Never:**

- read or modify `src/`, `test/`, package files, configuration, or unrelated
  circuits while drawing;
- edit source code, tests, `AGENTS.md`, the style guide, or the user's global
  agent configuration;
- run project-wide tests, install dependencies, clone dependencies, or inspect
  git history as part of drawing;
- write or patch circuit JSON directly, use implementation internals, or
  invent a command when the CLI cannot express the desired edit;
- create scratch, practice, duplicate, or test circuits; clear an existing
  circuit without an explicit request;
- invent unspecified electrical behavior, add explanatory/value text, or add
  `solder` components by hand;
- use a clean `eval` report as a substitute for visual inspection, or report
  completion while a required decision or defect remains.

If a needed operation is unavailable, preserve the existing design, explain the
specific limitation, and ask for the smallest decision that unblocks the work.

The CLI persists every mutated command automatically. That persistence is not
user approval: do not create alternate snapshots or claim the design is final
until the user accepts it.

This contract is intentionally project-local and provider-neutral. It is the
role prompt; the rest of this file is its operating procedure.

## Deterministic generation workflow

Natural-language interpretation belongs to the AI agent operating in this
project directory, not to the browser editor. Stay in the circuit-author lane
and translate the request into an explicit, versioned CircuitSpec before asking
the deterministic generator to place and route it. The browser has no generation
tool; use the CLI/API workflow below.

Resolve the electrical contract first. Ask the user before guessing material
topology, transistor polarity, biasing, feedback, supply/ground convention,
port direction or meaning, or any other choice with multiple reasonable
answers. Do not claim analog correctness from semantic, placement, routing, or
`eval` checks; they validate declared structure and geometry only.

Use a **new, unused circuit name** for generation. Do not overwrite an existing
circuit, and do not commit until the user explicitly approves the reviewed
preview. The exact CLI sequence is:

```sh
# Build the explicit spec from the approved electrical contract. This temporary
# input is not a circuit JSON file and must not be committed to the repository.
cat > /tmp/schematic-spawner-spec.json <<'JSON'
{
  "version": 1,
  "motif": "<motif>",
  "components": [],
  "nets": [],
  "semantics": {}
}
JSON

# Preview only: no circuit is loaded, changed, saved, or activated.
node src/cli/index.js <new-circuit-name> generate --preview \
  --file /tmp/schematic-spawner-spec.json > /tmp/schematic-spawner-preview.json

# Review the structured JSON report and its artifacts before asking approval.
# It includes normalized CircuitSpec, candidate score/issues, semantic report,
# placement/routing report, state, and artifacts.svg.

# After explicit user approval, rerun the same spec as a new named circuit.
node src/cli/index.js <new-circuit-name> generate --commit \
  --file /tmp/schematic-spawner-spec.json

# Verify the committed files through the API, then use ordinary commands for
# subsequent manual edits.
# GET /api/circuits/<new-circuit-name>
node src/cli/index.js <new-circuit-name> state
```

The spec may come from a file or stdin; `--file -` is equivalent to stdin, and
omitting `--file` also reads stdin:

```sh
node src/cli/index.js <new-circuit-name> generate --preview < spec.json
cat spec.json | node src/cli/index.js <new-circuit-name> generate --commit
```

A preview must be inspected in both the structured report and the SVG output.
If generation fails, report the returned validation/routing details,
preserve all existing circuits, ask for the missing decision or corrected
CircuitSpec, and preview again. Do not silently alter the topology to make a
candidate pass. A malformed spec returns an error without saving; a candidate
that fails hard checks is rejected without creating the requested circuit.
Commit is accepted only for a new name and is still not proof of analog
correctness.

The agent may modify only the explicitly requested circuit, through the running
editor's CLI/HTTP commands. It must not edit source, tests, configuration,
project documentation, or unrelated circuits, and must not write circuit JSON
directly. After generation commit, use ordinary editor commands (`add`,
`move`, `rotate`, `mirror`, `connect`, `net`, `rename`, `value`, `rm`) for
explicitly requested manual edits; preview and approval are required again if
the requested change materially changes the generated topology.

Companion docs:

- [style-guide.md](./style-guide.md) — the visual / electrical standard your
  output must meet.
- [README.md](./README.md) — repo layout and the developer-vs-author split.
- `AGENTS.md` — current symbol geometry, terminal names, label model,
  routing details; skim when you need an exact number.

## Authoring workflow

Follow one reviewable sequence:

1. **Functional placement** — state the intended topology and signal names,
   then apply connectivity-aware mirroring, rotation, spacing, and alignment.
   Keep signal flow compact and horizontal; make matched pairs symmetric while
   keeping their input terminals readable for either transistor polarity. Keep
   bias/reference circuitry separate from the main path but close to the
   devices it controls. Leave at least one empty grid cell around bodies,
   labels, and wires. Inspect `list`, `bounds`, `state`, and the fitted browser
   view.
2. **Rails, grounds, and ports** — after the functional layout is established,
   add supply and ground symbols, then external input/output ports. Connect each
   rail symbol directly to its intended net; aligned symbols are independent
   unless the topology explicitly connects them. Keep related input/output port
   components adjacent and their labels consistently spaced. Do not let ports
   dictate device placement, and do not add visible supply or ground labels
   unless requested. See the style guide for the rail and label standard.
3. **Placement review** — fit the browser view, verify orientation, spacing,
   labels, topology, and visual balance, and ask the user for feedback before
   routing. This is the decision gate for materially different topology,
   polarity, bias, port meaning, supply convention, or other speculative
   choices. Batch clear placement moves, rotations, or mirrors, then review
   again.
4. **Route logical groups** — only after placement is accepted, route one
   logical net group or functional block at a time. Prefer short, direct
   orthogonal routes. Avoid loops, unnecessary crossings, and redundant branch
   wiring; use named labels or global rails rather than duplicating long wires.
   Route a branching net through one open-space junction so the editor creates
   the real solder dot; never add `solder` components by hand or hide a branch
   on a terminal row. Inspect the fitted view and run `eval` between meaningful
   groups. If routing becomes tangled or requires a materially different
   interpretation, stop and ask the user rather than committing a speculative
   batch.
5. **Labels and evaluation** — route ports and add requested labels from the
   established circuit, keeping component identity separate from signal names.
   Use formatted external labels such as `V_{OUT}` and never remove a requested
   port label merely because its reference is already present. If ports or
   labels already exist, move or edit them rather than recreating them. Run
   `eval`, inspect `state` when a net is ambiguous, and correct topology,
   placement, labels, or routes before continuing. A clean `eval` report cannot
   replace visual review of hierarchy, symmetry, label clearance, or signal
   flow.
6. **Final browser and SVG inspection** — `eval` is the structural check, not
   the visual review. Before presenting the circuit as complete, inspect every
   component-label position and wire crossing in both the fitted browser view
   and saved SVG. Remove unrequested value or explanatory text; confirm
   readable component IDs, visible wires and real junctions, clear whitespace,
   and agreement with the JSON topology; then perform the command checks in
   **Final verification** below.

When the user requests a change, preserve accepted topology and manual routes
unless the request explicitly changes them.


Commands within a placement or routing step may be batched in one CLI/HTTP
request when the topology is clear, but keep the circuit editable after each
meaningful step. Read-only checks do not require fitting after every mutation.


Interactive REPL:

```sh
node src/cli/index.js <circuit>
sch> add pmos M2 --at 120 -120
sch> connect M1.d M2.d --name OUT
sch> eval
sch> quit
```

The browser live-syncs changed active-circuit revisions while visible; CLI commands set the active circuit, and mutated commands persist `circuit.json` and `circuit.svg`. See `AGENTS.md` for the authoritative sync contract. A bare CLI invocation enters a circuit picker after a moment; use the named-circuit form above.

## Start so the user sees you live

1. Use an existing server/browser if present. Otherwise run `./start.sh`, or an isolated `PORT=<random-port> node src/web/serve.js` with Chromium on its own random debug port. Track and stop only processes you started; never launch a competing editor instance.
2. Have the user open `http://127.0.0.1:<port>/` once and leave it open. They do not type a circuit name, click Load or Save, or refresh; the active circuit loads automatically.
3. Choose a circuit name (for example `analog-block` or `low-voltage-cascode`) and issue the first command. The server marks it active and the browser loads it on the next visible sync cycle.
4. Drive placement, review, then routing through CLI or HTTP. Fit the view after each phase and after later edits that change drawing extents; never leave the final review zoomed away.

## Browser automation notes

- Keep one persistent CDP connection for the session. Use isolated HTTP and
  Chromium debug ports, and stop only processes started for this session.
- For a double-click, send two pointer events with `clickCount: 2`. Inline
  editors use `input[style*="position: absolute"]`.
- After saving, verify the document with `GET /api/circuits/<name>`.
- For a multi-terminal net, inspect `branches` and confirm every terminal's
  world position appears in a branch; `eval` alone checks membership, not reach.

## Inspect existing circuits

```text
GET /api/circuits
GET /api/circuits/<name>
POST /api/circuits/<name>/generate
```

Each saved circuit lives in `circuits/<name>/` as `circuit.json` and
`circuit.svg`, possibly with a `learnings.md`. Before creating a related
design, load and inspect the existing JSON and its learnings file. Designs
in `circuits/` are the only training material — don't go hunting through
the codebase. Use your general knowledge of analog circuits to decide what a
topology must contain, and check the style guide for how to draw it.

## Command reference

The command language is the same in the CLI, the in-browser `:`, and
`window.__run(cmd)`. Use it for everything in the workflow; back up each
step with `node src/cli/index.js <circuit> state` to read back the result.

```text
clear                          start an empty circuit
add <type> [refdes] [--at X Y] [--rot D] [--mirrorX] [--mirrorY] [--value V]
move <refdes> <X> <Y>          move, snapped to the 40-grid
rotate <refdes> [deg=90]       rotate by multiples of 90
mirror <refdes> <x|y>          flip along an axis
value <refdes> <V>             set value text
rename <refdes> <new>          rename a component (updates its instance label)
rm <refdes>                    remove a component
connect REF.TERM REF.TERM ... [--name N] [--explain]
                               join terminals into one net (alias wire)
cross A1 A2 B1 B2                      add two matched protected cross-coupled routes
disconnect REF.TERM            detach one terminal from its net
nets                           list nets with terminals and lengths
net <id> add|drop|name|label|rm|segment-rm|path|vertex|junction ...
                               manage a net or edit fixed-path geometry
list                           list components with world terminals
state                          full JSON state
bounds                         drawing extents
eval                           quality report (connectivity, overlaps, routing, labels, grid)
explain eval                   grouped diagnostics with plain-language repair hints
explain connect REF.TERM REF.TERM
                               dry-run route with path, bends, and pin-escape details
analyze output-impedance NET   derive symbolic Z_out (input is zeroed)
analyze input-impedance NET    derive symbolic Z_in
analyze transfer-function OUT  derive symbolic A_v (use --input IN)
                               use --reference, --ac-ground, --mode,
                               --differential-side, --model, --context, or
                               the approximation flags as needed
help                           full command list
```

- `--mirrorX`/`--mirrorY` are **optional**. When omitted, the symbol's own
  defaults apply (PMOS places source-up; output ports place mirrored
  outward). Pass a mirror flag only to override that default.
- **When authoring state JSON directly (not via commands), mirror flags
  must be explicit.** Writing `mirrorY:false` overrides the symbol default
  and can flip a PMOS drain-up — which puts VDD on the drain instead of
  the source and can silently merge nets on load.
- `add` without `--at` picks an automatic position; prefer explicit `--at`
  on the grid.
- The CLI / HTTP command endpoint **saves on every mutated command** automatically.
  You do not need a separate `save` step.
- Deterministic generation preview/commit is documented in
  [`docs/circuit-spec.md`](../docs/circuit-spec.md); the browser has no
  natural-language generation tool.
- `cross A1 A2 B1 B2` accepts four terminals at the corners of one grid-aligned
  rectangle. It creates exactly two fixed diagonal nets for the opposite
  pairings, with one central crossing and no solder/join at the crossing.
  Non-rectangular or already-connected endpoints are rejected unless the exact
  same fixed cross already exists.

### Terminal names (current grid = 40)
```text
nmos/pmos:   g d s
nmosb/pmosb: g d s b
npn/pnp:     b c e
two-pin parts: a b
ports:        p
ground:       gnd
supply:       p
sources:      a b
adc:          ain d
dac:          d aout
```
Bulk MOS variants place `b` at the channel center `(0,0)` and route it
outward to the right in the local frame (`dir:{x:1,y:0}`); the symbol includes
an internal path from the channel edge to that pin. Their owned bulk label uses
local offset `{x:40,y:-40}` (toward the local drain), so PMOS mirroring carries
it toward the semantic drain. Three-terminal `nmos`/`pmos` keep `{x:40,y:0}`.

Full per-symbol geometry is in `AGENTS.md`; the rules for how to lay them
out are in `style-guide.md`.

### Schematic browser editing hotkeys and fixed paths

- `y` copies the selected set; `p` pastes it with fresh ids.
  `Ctrl/Cmd+C` and `Ctrl/Cmd+V` are equivalent copy/paste shortcuts.
- `Ctrl/Cmd+S` saves the current design. The design dropdown refuses to switch
  while the current design has unsaved changes; save first, or the selection is
  restored and an unsaved-changes warning is logged.
- In armed Move or Copy mode, drag from empty space to box-select the complete set before clicking to enter ghost mode; labels remain part of mixed selections.
- `l` starts a non-connectivity multi-point line annotation; click successive points and press Enter or double-click to commit. Selected line segments and vertices can be dragged.
- `w` is the single managed Wire command. It supports orthogonal or diagonal
  routes and can start at a terminal, an existing wire, or any grid point.
  Clicking a terminal commits immediately; clicking elsewhere adds a route
  point. The preview autoroutes each leg through committed points, and Enter
  commits at a free point or wire interior, so the new endpoint need not be a
  terminal. `F3` toggles the route choice for new wires. There is no separate
  uppercase-`W` editor mode.
- Persisted nets with `routingMode: "fixed"` remain loadable, including
  diagonal paths. Use the `net` command's fixed-path operations when inspecting
  or deliberately editing them; managed routing does not convert a fixed net.
- Moving a component re-anchors fixed-path endpoints without
  autorouting; moving a complete selected set translates fixed paths with it.
- `explain eval` is read-only and groups evaluator issues with repair hints for
  agent workflows. `explain connect A.t B.t` is a non-mutating dry run of the
  two-terminal router and reports its path, length, bends, and pin escapes.
- The canvas exposes keyboard-focusable component, wire, and label targets.
  Enter/Space selects a focused target; blank touch space pans with pointer
  capture, while pen/touch cancellation restores the in-progress gesture.


## General authoring rules

These rules apply when the requested topology is familiar and when it is not.
Use them as a planning checklist, not as permission to invent unspecified
electrical behavior.

### Resolve the electrical contract first

Before placing a component, write down the intended electrical contract in
compact terms:

- functional blocks and the components each block requires;
- every terminal-to-net relationship, including shared nodes and intentional
  open terminals;
- signal direction, input polarity, feedback paths, bias sources, supplies,
  and grounds;
- which connections are local wires, which are global rails, and which
  crossings must remain electrically separate;
- required reference designators, values, external ports, and signal labels.

If any topology or implementation choice is unspecified and more than one
reasonable circuit would satisfy the request, **ask the user before drawing
that part**. Do not guess a net connection, transistor polarity, feedback
path, bias scheme, logic implementation, port direction, or supply convention
just because one choice is common. Ask the smallest set of concrete questions
that resolves the ambiguity, and state the alternatives when useful.

Keep component identity and displayed signal naming separate. Keep component
reference designators plain (`VINP`, `VINN`, `VOUT`), but format external
voltage labels as `V_{INP}`, `V_{INN}`, and `V_{OUT}`. Format current labels as
`I_{...}`. Edit the owned port label text rather than renaming the component or
using raw `VINP` / `VOUT` text. Never delete an external port label merely
because the component reference is already present; verify every formatted
label remains visible and clear after fitting the view.


### Plan the page before routing

- Choose one dominant reading direction, normally inputs left-to-right and
  supplies top-to-bottom.
- Establish a centerline, device rows, stack columns, rail rows, and generous
  margins before adding long wires.
- Reserve at least one empty grid cell around every body and a clear corridor
  for every label and wire. Widen the layout instead of accepting a cramped
  detour.
- Group components by function. Keep matched, repeated, or feedback-related
  structures aligned and symmetric where the topology calls for it.
- Prefer one short orthogonal route per intended connection. Use a named net
  label or global rail rather than duplicating a long wire.
- Make every crossing intentional and visually legible; a crossing is not a
  junction unless the topology says it is.


## Save and record verified notes

Saving produces both `circuits/<name>/circuit.json` (source of truth) and
`circuits/<name>/circuit.svg` (review/export artifact). The CLI / HTTP
endpoint already saves on every mutated command. Do not make extra snapshots
or create another circuit to preserve an unaccepted draft; the current
requested circuit is the working draft and remains the only delivery.

When placing components, do not add explanatory or value text unless the
user explicitly requests it. Components render only their inherent
instance labels by default.

After a verified routing or symbol observation, update
`circuits/<name>/learnings.md`. Structure:

```markdown
# Learnings: <name>

## Topology
- Key convention or design assumption.

## Placement
- Coordinates or spacing that worked well.

## Routing
- Manual route choice and why it avoids trouble.

## Advice for future agents
- Reusable guidance specific to this design.
```

Only record verified observations. Do not record speculative explanations
or temporary debugging output. Keep the file scalable: add verified
observations to the relevant circuit's file. If a note is general, promote it
to `style-guide.md` only when it is a stable rule.

## Final verification

Before presenting a circuit as complete:

```sh
node src/cli/index.js <circuit> eval
node src/cli/index.js <circuit> state
```

Confirm that:

- every required electrical terminal is connected or intentionally exposed;
- there are no component, label/component, or label/label overlaps;
- there are no off-grid coordinates;
- no unintended diagonal managed-wire segments; diagonal routes are reserved
  for deliberate cross-coupled or other topology-specific structures and must
  be visually justified and symmetric where they represent a matched pair;
- wires do not run through component interiors or overlap another net
  collinearly;
- every multi-terminal net's `branches` reach all of its terminals;
- labels identify external pins, bias/reference nodes, and important outputs;
  supply and ground symbols remain unlabeled unless the user requests text;
- the browser view and saved SVG agree with the JSON topology.
