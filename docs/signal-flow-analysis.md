# Signal-flow analysis

The analysis window's second mode (`Shift+S`, then **Signal flow** at its
top): transfer functions of a block diagram rather than a circuit. A drawing
with signal-flow parts and no devices opens in it. Code:
`src/core/analysis/signal-flow.js` (the analysis), `src/web/signal-flow-ui.js`
(the mode); tests: `test/signal-flow-analysis.test.js`.

## The diagram

Each wire is one signal. The parts are:

- **Transfer-function blocks** `tf_s` and `tf_z` (`src/core/transfer-function.js`):
  `y = H x`, from the block's MATLAB-style definition. Symbolic coefficients
  stay symbols in the result.
- **Sum junctions** `signal_sum`: `e = ± n ± s ± w` over the connected
  inputs, the signs from the junction's negative inputs.
- **Multiply junctions** `signal_multiply`: a gain. All inputs but one must
  be constants (a source set to *zero* or *constant*, wired straight to the
  junction); two signals multiplied have no transfer function and are
  refused.
- **Sources** are the signals nothing in the diagram drives: an input
  port's, or any wire that is read (a named stub, say). Any signal can be
  the output. Names are shown as written (`OUT`, `V_{OUT}`).

A signal has at most one driver: a block's `out` or a junction's `e`. Two
drivers, a part on a signal wire that is none of the above, or blocks in
both `s` and `z` (a sampled loop needs a sampler and a conversion, not
supported yet) return a diagnostic, never a guessed answer.

## Sources and results

Pick the output and set each source to **input**, **zero**, or a
**constant**; every source starts as an input. Each input gets its transfer
function to the output from one exact solve (one right-hand side per input),
so an SDM's STF and NTF come out together. A constant matters only where it
multiplies a signal: elsewhere superposition removes it, as for zero.

Results are exact rational functions with the common factors cancelled
(`polynomial-gcd.js`), shown in `s` as descending powers with a monic
denominator, and in `z` over the denominator's highest power: the
denominator runs `1, z^-1, z^-2 ...` and the numerator keeps the powers it
has (`1 - z`, not `(-1 + z^-1)/z^-1`). Numeric ones also list their zeros
and poles.

Numeric responses go onto one **graph** of magnitudes, a colour per trace
with its equation beside it in that colour: over relative frequency in `s`,
over `f/fs` from `10^-4` to `1/2` in `z`. Traces stay across derives, so
responses from different settings or outputs can be compared; each can be
hidden or removed, and **Add to graph** brings a removed one back. A graph
holds one variable (an `s` result clears a `z` graph). **Annotate graph**
puts it on the drawing as a plot annotation (`plot.kind: 'response'`,
`responseFigure` in `bode-figure.js`) with the traces' equations as math
labels in their colours, children of its box; **Annotate equations** writes
the equations under the drawing.

Scripted: `analyze signal-flow --output NET --input PORT,... [--zero PORT,...]
[--const PORT=VALUE,...]`.
