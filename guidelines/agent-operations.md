# Agent Operations Guide

This guide explains how an AI agent should operate schematic-spawner. The goal is
to create a real, editable circuit in the running web application, not merely to
describe a circuit in chat.

## Start A Live Session

Run the project from its root:

```sh
./start.sh
```

`start.sh` starts `src/web/serve.js` and opens `/`. The server is normally at
`http://127.0.0.1:8080/`. Use `PORT=<port> ./start.sh` when an isolated session is
needed. Keep the server running while constructing the design so the user can
watch each action.

An agent with browser automation should use the visible browser window and issue
small, observable operations. Do not silently replace the user's design.

## Inspect Existing Circuits

The server provides:

```text
GET /api/circuits
GET /api/circuits/<name>
PUT /api/circuits/<name>
```

Each saved circuit is stored in `circuits/<name>/` as `circuit.json` and
`circuit.svg`. Read the list first. Before creating a related design, load and
inspect the existing JSON and any circuit-specific `learnings.md` file.

The browser debug hook is useful for inspection:

```js
window.__circuit()
```

It returns components, nets, routes, and labels. The web command hook is:

```js
window.__run('eval')
```

Use it only for supported commands. `window.__load(state)` can load a complete
version-1 state object into the visible editor.

## Construct A Circuit

Prefer the visible editor for incremental work:

```text
: clear
: add nmos M1 --at 240 240
: add resistor R1 --at 480 240 --value 10k
: connect M1.d R1.a --name out
: eval
```

For a larger design, construct a complete version-1 JSON state and load it into
the browser. Every component must have a grid-aligned transform. Net terminals
use `{comp, term}` objects, for example `{comp:"M1", term:"d"}`. Preserve explicit
routes when the agent has manually designed them; use `route: null` only when
auto-routing is intended.

The current grid is 40 units. Available terminal names depend on the symbol:

```text
nmos/pmos: g d s
npn/pnp:   b c e
two-pin parts: a b
ports:     p
ground:    gnd
supply:    p
```

Use `Circuit.fromJSON` semantics when creating or reloading states. This ensures
the current symbol geometry is applied to old designs. Never duplicate symbol
geometry in a circuit file.

## Iterate With The User

Use this loop:

1. State the intended topology and signal names.
2. Place a logical block or small group of components.
3. Connect its nets and let the user see the result.
4. Run `eval` and inspect the rendered view.
5. Fix topology, placement, labels, or routes before continuing.
6. Ask the user to confirm ambiguous conventions such as input polarity or
   supply naming.
7. Save only after the user accepts the design.

Avoid one opaque batch operation when live browser automation is available.
Keep the circuit editable after every meaningful step.

## Save And Learn

Use the GUI Save control or the API. Saving must produce both:

```text
circuits/<name>/circuit.json
circuits/<name>/circuit.svg
```

The JSON is the source of truth. The SVG is a review/export artifact.

When placing components, do not add explanatory or value text unless the user
explicitly requests it. Components should render only their inherent instance
labels by default. Use the component's `value` field only when that value is part
of the requested deliverable.

After a non-obvious routing or symbol issue, update:

```text
circuits/<name>/learnings.md
```

Record the problem, the observed cause, the successful fix, and any reusable
coordinate or terminal convention. Keep it specific to that circuit and useful
to the next agent. Do not put generated circuit data or learnings in `AGENTS.md`.

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
