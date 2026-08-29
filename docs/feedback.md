# Agent Feedback

Open improvement requests collected from a live circuit-author session.
Each item is a real problem the user observed; the resolution will go here
once implemented.

---

## 1. Programmatic diagnostics for the agent

The agent falls back to reading `circuit.svg` to understand what's wrong
when it should be able to query the model directly. The router especially
should expose explanations, not just a final polyline.

**What is needed:**

- A way for the agent to ask "why is this wire shaped like this?" without
  reading the SVG.
- A way to ask "where would this terminal connect if I added it here?" —
  a dry-run `smartRoute` that returns the path + the reason it picked
  that path (clearance, pin escape, body crossings avoided).
- `eval` should explain violations in plain language, not just list
  refdes+coordinates. "M1.g is connected to net N1 but no wire reaches
  it: the wire was dropped on move because the pin left the shared grid
  point." That kind of trace.
- Possibly: an `--explain` mode on `connect` and `add` that returns the
  router's reasoning alongside the result.

**Why now:** the circuit-author loop is bottlenecked by the agent's
ability to debug its own work. Better diagnostics shorten every iteration.

---

## 2. Router should prefer the shortest direct path

Observed example: a wire from the input port (vertical center) to the
PMOS gate was routed with a bend that joins at the PMOS gate's row. The
user expects: "straight right, join in the middle" — a direct path that
ends perpendicular to whichever net point is closest.

**What is needed:**

- `smartRoute` should default to "shortest direct path that respects
  body clearance + pin escapes". When several paths are equally clear,
  pick the one with the fewest bends; when several have the same bends,
  pick the shortest.
- Manual hand-drawn routes (CLI `connect` with explicit intermediate
  points) should still be honored verbatim. Only the auto-route
  candidates change.
- The CIRCUIT-AUTHOR guide should be updated to say "trust the
  autoroute, only adjust routes when there's overlap or congestion".

**Why now:** the autoroute is the default path, so it should be the
one that looks correct. Currently the agent has to second-guess it.

---

## 3. Stale terminal-to-net bookkeeping on move

When a component moves, terminal-to-net membership goes stale.

**Repro (observed):** a component's terminal was connected to a net via
`connectCoincident` (or `connect`). When the component is later moved
away, the net sometimes disappears from the model — but the component's
serialized state still claims the terminal is in a net, or `eval`
reports it as connected when no wire reaches it.

**What is needed:**

- `moveComponent` (and `setTransform`) must keep the net / terminal
  bookkeeping in sync:
  - A terminal that leaves its coincident partner must be **removed**
    from the partner's net. If the net becomes empty, **delete it**.
  - A terminal that lands on a new coincident partner must **join**
    that net (`connectCoincident`).
  - Re-route every affected net after either change.
- `fromJSON` must run the same cleanup on load so a stale JSON file
  doesn't leak phantom connections.
- `eval` must be the single source of truth for "is this terminal
  connected", and the report should mention any terminal whose stored
  net ref doesn't match its world position.

**Why now:** this is a correctness bug. The model is currently
inconsistent with itself, which makes every other operation suspect.

---

## How to apply these

These are **developer-agent** tasks (per `guidelines/DEVELOPER.md`), not
circuit-author work. Tackle in this order:

1. **#3 (the bug)** — fix first; everything else is built on top of a
   trustworthy model.
2. **#2 (router preference)** — small change to scoring; add a test.
3. **#1 (diagnostics)** — additive, can ship incrementally.
