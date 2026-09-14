# Symbolic-analysis UI migration

The rewrite uses one concise option set. Exact full-RLC equations remain the
engine's source of truth; these options control only the displayed reduction.

## Canonical state

`migrateAnalysisFormState(saved, { isMosControlVoltageZero })` returns
`{ state, diagnostics }`. `state` contains the selected `input`, `output`,
`reference`, `mode`, `differentialSide`, and `acGrounds`; `models` contains only
triode entries such as `M2=triode`; and `options` contains:

| Option | Default | Meaning |
| --- | ---: | --- |
| `neglectBodyEffect` | `true` | Set `g_mb = 0`; does not change bulk connectivity. |
| `highIntrinsicGain` | `true` | Apply the general `g_m r_o \gg 1` reduction where `r_o` remains finite. |
| `neglectChannelLengthModulation` | `false` | Set `r_o \to \infty`. |
| `dominantPole` | `false` | Apply the optional final dominant-pole reduction to a multi-pole AC transfer. |

`r_o \to \infty` wins over `g_m r_o \gg 1` because the latter is redundant.
The same precedence applies per device. No additional cascode, load-dominance,
Miller, or DC-only switches are needed.

## Exact old-to-new migration

- `target` becomes `output`; `input`, `reference`, `mode`,
  `differentialSide`, and AC-ground selections are preserved.
- `ignoreBodyEffect`, `ignoreGmb`, `approxIgnoreBody`, and
  `bodyEffectIgnored` become
  `neglectBodyEffect`.
- `gmroLarge`, `assumeGmRoLarge`, `approxGmRo`, and `approxGmRoLarge` become
  `highIntrinsicGain`.
- `ignoreChannelLengthModulation`, `ignoreRo`, `approxIgnoreRo`, and
  `roInfinite` become
  `neglectChannelLengthModulation`.
- `dominantPoleApproximation`, `dominantPoleReduction`, and
  `approxDominantPole` become `dominantPole`.
- Legacy `approximations` list entries are accepted only for those four
  canonical options. Miller, cascode, and DC-only entries are dropped.
- `context`/`additionalContext` are dropped; the exact report and explicit
  selections are the durable sources of analysis context.
- `models`/`modelOverrides` retains `REF=triode` and drops every legacy
  `REF=current-source` entry. A safe conversion adds a per-device
  `neglectChannelLengthModulation` override.

Current-source conversion is safe only when the caller's
`isMosControlVoltageZero(refdes, details)` returns exactly `true` after proving
both `v_g-v_s` and `v_b-v_s` are identically zero. Otherwise the entry is
cleared and one deduplicated `legacy-mos-current-source` warning is returned for
that device. The helper never guesses from topology or from a numeric sample.

## Future concise UI labels and hints

Use these labels:

- “Ignore body effect (`g_mb = 0`)”
- “Assume high intrinsic gain (`g_m r_o \gg 1`)”
- “Ignore channel-length modulation (`r_o \to \infty`)”
- “Use dominant-pole approximation”
- “Device region” with `REF=triode` as the only override
- “AC-ground nets” with the hint “Comma-separated net names or terminal references.”

One short group hint is sufficient: “The exact symbolic result is computed
first. These options simplify only the displayed result.” Do not expose Miller,
cascode-reduction, DC-only, free-text context, or MOS current-source controls.
