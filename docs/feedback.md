# Agent Feedback

Open requests are listed below. Resolved observations remain as short records
so future agents do not reopen them.

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

## 2. Router should prefer the shortest direct path — resolved

The router now ranks clearance-safe candidates by pin conformity, length, and
turn count, while preserving explicit manual routes. The current behavior is
covered by router tests and documented in `AGENTS.md`.

## 3. Stale terminal-to-net bookkeeping on move — resolved

Move, transform, and load paths now preserve terminal/net bookkeeping,
reconnect coincident terminals only at committed positions, and re-route
affected nets. Model tests cover the move-after-coincident-connection case.

## Current status

Only item 1 remains open. It is an additive diagnostics feature: explain
router choices and make `eval` reports more actionable. Implement it only if
agent workflows show that the existing `state`, `nets`, and `eval` output are
insufficient.
