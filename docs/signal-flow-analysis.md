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
- **Gains** `gain`: `y = k x`, the triangle pointing the way the signal
  goes, its one coefficient (a number or a symbol: `k`, `0.5`, `a_1`,
  `2*g_m`) drawn inside it when it fits, above it otherwise.
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

The solve reduces the graph the way it is done by hand
(`eliminateSignals`): each signal is a weighted sum of others, so the
cheapest node (fewest inputs times readers) is removed next, a self-loop
folding into `1/(1 - L)`, with common factors cancelled as the coefficients
grow. A fourth-order modulator with a dozen symbolic coefficients solves in a
fraction of a second this way, where a generic matrix elimination runs out
of its work limit.

Results are exact rational functions with the common factors cancelled
(`polynomial-gcd.js`), shown in `s` as descending powers with a monic
denominator, and in `z` over the denominator's highest power: the
denominator runs `1, z^-1, z^-2 ...` and the numerator keeps the powers it
has (`1 - z`, not `(-1 + z^-1)/z^-1`). Numeric ones also list their zeros
and poles.

A wire ending on a sum's, a multiplier's, or a transfer function's input
draws an arrowhead into it without being asked (render.js
`withSignalArrows`), merged with any it has; a gain's triangle already
shows the way, so its input takes none.

Symbols in the results (`a_1`, `k`) each get a row under **Coefficients**: a
slider through the E24 values from 0.001 to 1000 and a field for any value
(negative too), starting at 1. The graph and the poles and zeros use these
numbers -- symbolic results show their roots "at the coefficients below" --
while the equations stay symbolic; moving one redraws as it moves. The
numbers are saved with the document (`analysisValues.coefficients`), as the
Bode sketch's ratios are (`analysisValues.bode`): a slider move edits the
document (it shows as unsaved) without making an undo entry or marking the
derived equations stale (main.js `markSettingsChanged`).

Responses go onto one **graph** of magnitudes, a colour per trace
named by its ratio (`OUT/IN`) in that colour, its dB axis fitted to the
curves in whole 20 dB steps: over relative frequency in `s`,
over `f/fs` from `10^-4` to `1/2` in `z`. Traces stay across derives, so
responses from different settings or outputs can be compared; each can be
hidden or removed, and **Add to graph** brings a removed one back. A graph
holds one variable (an `s` result clears a `z` graph). **Annotate graph**
puts it under the drawing at its left edge, as a plot annotation
(`plot.kind: 'response'`, `responseFigure` in `bode-figure.js`) with the
traces' names as math labels in their colours beside it, children of its
box, lined up once the browser has measured them (main.js
`alignLabelColumn`), and the coefficients' numbers under them one a line; **Annotate equations** writes the equations under the drawing.

Scripted: `analyze signal-flow --output NET --input PORT,... [--zero PORT,...]
[--const PORT=VALUE,...]`.
