# Agent Feedback

## Open request: programmatic diagnostics

Expose actionable diagnostics for agent workflows instead of requiring SVG
inspection. The model should explain router choices (including dry-run paths,
clearance, pin escapes, and avoided body crossings), and `eval` should report
plain-language causes and traces for violations. An optional `--explain` mode
for `connect` and `add` may return router reasoning alongside command results.

Prioritize this if existing `state`, `nets`, and `eval` output remain
insufficient for agents to debug their own circuit-authoring work.
