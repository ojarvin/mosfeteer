# Symbolic-analysis UI contract

The analysis form controls one exact full-RLC solve. Presentation options are
applied afterward and do not alter the exact result.

## Canonical state

Persist only these selections:

- `input`
- `output`
- `reference`
- `acGrounds`
- `deviceRegions`, containing triode overrides only
- `options`

`options` contains:

| Key | Default | Label |
| --- | ---: | --- |
| `neglectBodyEffect` | `true` | Ignore body effect (`g_mb = 0`) |
| `highIntrinsicGain` | `true` | Assume high intrinsic gain (`g_m r_o \gg 1`) |
| `neglectChannelLengthModulation` | `false` | Ignore channel-length modulation (`r_o \to \infty`) |
| `dominantPole` | `false` | Use dominant-pole approximation |

Ignoring channel-length modulation takes precedence over the high-intrinsic-
gain assumption for the affected device because the latter then adds no
information.

## Form copy

Use this introduction:

> Select the input and output nodes. The analysis derives gain and impedances
> from one symbolic RLC model; frequency-dependent results include poles and
> zeros.

Use this options hint:

> The exact symbolic result is computed first. These options simplify only the
> displayed equations.

Use **AC-ground nets** with the hint:

> Comma-separated net names or terminal references.

Use **Device region** for structured triode selection.

## Persistence boundary

Normalize saved state when loading it, discard unknown fields, and filter all
component and net references against the current circuit. A new unnamed
schematic starts with default state; a named schematic restores its validated
state across close/reopen and reload.

The report adapter must keep selected-port metadata separate from the three
derived quantities. Render equations in this order:

1. `Z_{in}(s)`
2. `Z_{in}(0)`
3. `Z_{out}(s)`
4. `Z_{out}(0)`
5. `A_v(s)`
6. `A_v(0)`
7. poles
8. zeros
9. assumptions

Hide AC rows that contain no `s`, empty pole/zero rows, and assumptions that do
not change the displayed equations.
