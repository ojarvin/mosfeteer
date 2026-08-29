# Circuit Author Guide

You are asked to draw a circuit using the running editor. The user is watching
your work live and will give feedback. Your job is to deliver a textbook-grade
schematic, one command at a time, while the user watches.

**Do not read the application source code.** The command language and the
live editor expose every operation the workflow needs. Inspecting
implementation details will slow you down and tempt you to script around
the tool. If the editor lacks an operation you think you need, change your
approach — do not invent one.

Companion docs:

- [style-guide.md](./style-guide.md) — the visual / electrical standard your
  output must meet.
- [README.md](./README.md) — repo layout and the developer-vs-author split.
- `AGENTS.md` — current symbol geometry, terminal names, label model,
  routing details; skim when you need an exact number.

## The fast loop

Every edit is one command. The user's browser shows it within ~500 ms. You
make a small change, see the result, ask for feedback, iterate.

```sh
# Production server + browser for the user:
./start.sh                    # HTTP at 127.0.0.1:8080, browser opens

# Then drive it from the CLI (each call = one server-side command):
node src/cli/index.js <circuit> "add nmos M1 --at 120 120"
node src/cli/index.js <circuit> "connect M1.s M2.s --name TAIL"
node src/cli/index.js <circuit> "eval"
node src/cli/index.js <circuit> "state"          # dump JSON
```

Or run an interactive REPL bound to one circuit:

```sh
node src/cli/index.js <circuit>
sch> add pmos M2 --at 120 -120
sch> connect M1.d M2.d --name OUT
sch> eval
sch> quit
```

The browser polls `circuits/<name>/circuit.json` every 500 ms and re-fits the
view on every change. Every CLI call writes the file; the user sees it live.

A bare `node src/cli/index.js` (no `<circuit>`) enters a circuit picker
after a moment — but the named-circuit form above is the one you want.

## Start so the user sees you live

1. **Start the server.** `./start.sh` (or `PORT=<p> node src/web/serve.js`
   for an isolated session, with its own chromium on a unique debug port).
2. **Tell the user to open the app** at `http://127.0.0.1:<port>/` once
   and leave it open. They don't type a circuit name or click anything —
   the browser auto-loads whatever you start editing.
3. **Pick a circuit name** (e.g. `5t-ota`, `low-voltage-cascode`) and run
   your first command against it. The server marks it active; the user's
   browser picks it up on the next poll (≤ 500 ms) and loads it.
4. **Drive the loop** from the CLI — one command per shell call. Every
   mutated command is persisted to `circuits/<name>/circuit.json` and
   `circuits/<name>/circuit.svg`; the user's view re-renders
   automatically.
5. **Fit the view after every edit** — press `F` in the browser, or send
   the `F` key event over CDP. Never leave the canvas zoomed away from
   what you just did. (You can also run `fitView` indirectly via the CLI
   if you wire one, but the easiest is just to send the key event.)

The user does **not** load the circuit by hand, does **not** click Save,
and does **not** refresh — the live session takes care of it.

## Reliable automation (don't lose a session to these)

- **One persistent CDP connection for the whole session.** Reconnecting per
  command drops the page's debugger and can trigger the "Leave site?"
  prompt (the app has a `beforeunload` handler for unsaved changes).
- **Never `pkill -f` a pattern that appears in your own command line** — it
  matches and kills your own shell. Use a `quit` command in your daemon
  instead.
- **Headless never fires native `dblclick`.** Use real
  `Input.dispatchMouseEvent` with `clickCount: 2`. Inline editors are
  `input[style*="position: absolute"]`. Ctrl+A =
  `keyDown('a', { modifiers: MOD, code: 'KeyA', keyCode: 65 })`.
- **`syncActiveCircuit` can silently revert local state** when there are
  no unsaved changes. Build deterministically and, after every save,
  **verify the file** with `GET /api/circuits/<name>` — never trust only
  the live tab.
- **Multi-terminal net coverage lives in `branches`, not just `eval`.**
  `eval` reports a terminal "connected" if it's in a net even when no wire
  reaches it. A 3+ terminal net is stored as `branches` (one polyline per
  arm); confirm every terminal's world position appears in some branch.

## Inspect existing circuits

```text
GET /api/circuits
GET /api/circuits/<name>
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
connect REF.TERM REF.TERM ... [--name N]     (alias wire) join terminals into one net
disconnect REF.TERM            detach one terminal from its net
nets                           list nets with terminals and lengths
net <id> add|drop|name|rm ...  manage a net, e.g. net N1 add R1.a ; net N1 name OUT
list                           list components with world terminals
state                          full JSON state
bounds                         drawing extents
eval                           quality report (unconnected/overlaps/off-grid/diagonals)
ascii                          coarse ASCII layout preview
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
- The CLI / HTTP endpoint **saves on every mutated command** automatically.
  You do not need a separate `save` step.

### Terminal names (current grid = 40)

```text
nmos/pmos: g d s
npn/pnp:   b c e
two-pin parts: a b
ports:     p
ground:    gnd
supply:    p
sources:   a b
```

Full per-symbol geometry is in `AGENTS.md`; the rules for how to lay them
out are in `style-guide.md`.

## Drafting order

Work in this order for a new diagram:

1. **Place the functional components first**, without input/output pins.
2. **Apply connectivity-aware mirroring, rotation, spacing, alignment.**
   Symbol defaults already give you PMOS source-up and mirrored output
   ports; add `--mirrorX` for the right-hand matched device. For
   differential structures, establish the center grid column and align
   shared-terminal rows; for mirror/active loads, face the control
   terminals inward. Keep gaps an even number of cells and give the
   layout room to breathe.
3. **Wire the functional components.** Junction solder dots at multi-
   terminal nodes are placed automatically — never add `solder`
   components by hand. Keep the shared branch off the terminal row so
   the junction is a real T.
4. **Add ground and supply symbols.**
5. **Add input and output pins last**, routing them from the already-
   established circuit rather than letting them dictate device placement.
6. **Label external signals** with the `V_{...}` / `I_{...}` subscript
   pattern; do not label supply/ground. Place port labels one square from
   the port, aligned toward it. Instance labels appear automatically.

After each step: `eval`, then fit the view, then iterate.

## Iterate with the user

The loop:

1. State the intended topology and signal names.
2. Place a logical block or small group of components.
3. Connect its nets and let the user see the result (fit the view).
4. Run `eval` and inspect the rendered view.
5. Fix topology, placement, labels, or routes before continuing.
6. Ask the user to confirm ambiguous conventions (input polarity, supply
   naming, single-ended vs differential output, active-load style) before
   committing a large amount of work.
7. Save only after the user accepts the design.

Avoid one opaque batch operation when live browser automation is available.
Keep the circuit editable after every meaningful step. When the user asks
for a change, preserve accepted topology and manual routes unless the
request explicitly changes them.

Before saving, review every component label position and every wire
crossing. Remove unrequested value or explanatory text; orient symmetric
components toward open label space; rely on the router's automatic solder
dots for junction annotations.

## Save and learn

Saving produces both `circuits/<name>/circuit.json` (source of truth) and
`circuits/<name>/circuit.svg` (review/export artifact). The CLI / HTTP
endpoint already saves on every mutated command; for an explicit "snapshot
now" use the GUI Save button or `PUT /api/circuits/<name>`.

When placing components, do not add explanatory or value text unless the
user explicitly requests it. Components render only their inherent
instance labels by default.

After a non-obvious routing or symbol issue, update
`circuits/<name>/learnings.md`. Structure:

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

Only record verified observations. Do not record speculative explanations
or temporary debugging output. Keep the file scalable: each new drawing
attempt adds its own verified observations to the relevant circuit's file,
so guidance accumulates without bloating the global guides. If a learning
is general (not specific to this circuit), consider promoting it to
`style-guide.md` instead — but only when it's a stable rule, not a one-off
fix.

## Final verification

Before presenting a circuit as complete:

```sh
node src/cli/index.js <circuit> eval
node src/cli/index.js <circuit> state
```

Confirm that:

- every required electrical terminal is connected or intentionally exposed;
- there are no component overlaps;
- there are no off-grid coordinates;
- there are no diagonal wire segments;
- wires do not run through component interiors;
- labels identify external pins, supplies, ground, and output;
- the browser view and saved SVG agree with the JSON topology.

Then fit the view in the browser (`F`) and walk the same checks by eye.
