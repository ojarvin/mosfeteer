# CircuitSpec (Phase 0–2)

`CircuitSpec` is the versioned, generator-facing description of topology. It is
not a saved `Circuit`, and it does not contain placement, routing, graphics, or
editor state. Manual editing continues to use `Circuit` and the existing
commands.

## Contract

```json
{
  "version": 1,
  "motif": "resistor-divider",
  "components": [{"id":"R1", "type":"resistor", "value":"10k"}],
  "nets": [{"id":"out", "name":"VOUT", "terminals":[{"component":"R1","terminal":"b"}]}],
  "constraints": {"hard": [], "soft": []}
}
```

Component and net IDs are unique identifiers. A terminal may occur in zero or
one net, never in two. Every referenced component and terminal must exist in
the current symbol registry. Net names are optional and are trimmed during
normalization. Components, nets, and terminals are sorted by ID, and omitted
optional fields are omitted consistently; normalization returns a detached
value and never mutates its input.

The pure seam is `normalizeCircuitSpec` (also exported as
`validateCircuitSpec`) in `src/core/circuitSpec.js`. It validates the complete
spec before a future phase may apply anything to a `Circuit`; malformed
ownership therefore cannot partially mutate an editor circuit.

## Phase 1 compiler

`expandCircuitSpec` expands the six fixture-backed motifs listed below. An
explicit `components`/`nets` pair is accepted for any of those motifs; when
omitted, the small built-in template is expanded. Template component values
may be supplied with `values: {"R1":"10k"}`. `openTerminals` records deliberate
unconnected pins, and `ports` records `{id, type, net}` declarations (the
normalizer also accepts `direction`/`netId` aliases). Component `role`, `group`,
and `template` hints plus net `kind` and `logicalGroup` are retained as
semantic metadata.

`generateCircuit(spec)` returns `{spec, topology, circuit, report}`. It first
normalizes the expanded spec, then stages a temporary `Circuit` from explicit
component and physical-net membership. Components have zero placement only in
that temporary validation circuit; generated topology contains no placement,
wire path, routing, labels, or time-based IDs. Passing a live `Circuit` as the
first argument is supported for transactional callers; it is never changed.
Use `tryGenerateCircuit` when a structured `{ok:false, error}` result is more
convenient than the normal throwing validation boundary.

## Phase 2 placement

`placeCircuit(spec)` in `src/core/placement.js` consumes the normalized topology
(or a `generateCircuit` result) and returns `{ok, placements, ports, rails,
corridors, report}`. It is pure: each candidate is evaluated with the model's
`ComponentInstance.bboxWorld()` and `worldTerminals()` geometry, and no live
`Circuit` is changed. Candidates use stable component ordering, 40-unit
origins, analog PMOS/NMOS rows, matched groups, transistor columns/stacks,
and left/right declared ports. Supply and ground metadata is reported as top
and bottom rails; no wire or label geometry is fabricated.

The search is bounded (`MAX_PLACEMENT_CANDIDATES`), integer-scored with the
canonical candidate tuple, and deterministic. Bounding-box and critical or
feedback corridor conflicts are hard failures rather than topology guesses.
Constraint `groups`, `rows`, `columns`, `spacing`, and `corridors` are the
placement-owned vocabulary; unknown hard/soft strings remain in
`report.deferredConstraints` for later phases. `tryPlaceCircuit` is the
non-throwing adapter.

## Phase 3 deterministic routing

`routeCircuit` in `src/core/routing.js` consumes a normalized spec plus a Phase 2
placement (or computes the placement), materializes each declared physical net,
and calls `Circuit#rerouteNet` for fresh managed geometry. Nets are routed in a
stable priority order (semantic kind, terminal count, name, then ID); retries
are bounded and only change that deterministic order. Fixed paths and authored
managed paths supplied by an existing `Circuit` are retained. Equal names never
merge physical nets.

The result is `{ok, spec, placement, circuit, state, metrics, report}` for a
valid candidate, or a structured failure without a circuit. Metrics include
reachability, body/overlap and diagonal violations, collinear cross-net
violations, perpendicular crossings, bends, length, clearance, label overlap,
and placement symmetry. Named nets receive labels only after a drawable path
exists, through `Circuit#addNetLabel`; no parallel wire graph or router is
created. `tryRouteCircuit` is the non-throwing adapter. Routing attempts are
bounded by `MAX_ROUTING_ATTEMPTS`.

## Ambiguity policy

Phase 0 rejects ambiguity rather than guessing: duplicate IDs, unknown symbols
or terminals, missing references, and a terminal owned by multiple nets are
errors. An unowned terminal is simply unspecified topology. Equivalent names
do not merge physical nets. Future generators must surface unresolved intent
to the caller instead of silently choosing a topology.

## Constraint vocabulary

**Hard constraints** are gates: violations make a candidate invalid (terminal
ownership, satisfiable required topology, and unique IDs). **Soft constraints**
rank otherwise-valid candidates (compactness, readable signal flow, and
symmetry). Placement interprets its documented geometry constraints; other
hard and soft entries remain deferred for later generation phases.

## Candidate score

Candidates compare lexicographically, lower first, using this stable tuple:

`[hardViolations, topologyViolations, wireCrossings, componentClearance, labelClearance, pinConformity, turns, length]`

Missing numeric fields are zero in the phase-0 helper `candidateScore`. New
score dimensions may only be appended in a future contract version.

## Initial fixtures

The small corpus under `fixtures/circuit-spec/` covers `resistor-divider`,
`rc-filter`, `common-source`, `differential-pair`, `current-mirror`, and
`5t-ota`. Fixtures describe topology only and are intentionally not placed or
routed.
