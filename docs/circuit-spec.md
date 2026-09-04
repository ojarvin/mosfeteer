# CircuitSpec (Phase 0)

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
symmetry). The arrays in a spec are descriptive phase-0 metadata; their
interpretation belongs to later generation phases.

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
