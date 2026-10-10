# Model contracts

The rules every change to the drawing model, the symbols, the labels, and the
router keeps. `AGENTS.md` summarizes them; the tests named in each module
encode them exactly.

## Grid, transforms, and symbols

- `GRID` is 40. Component origins, terminals, wire points, and persisted label
  anchors are grid-aligned. Symbol-internal graphics may be off-grid.
- Component transforms are origin-anchored and pure. `r` rotates clockwise;
  horizontal and vertical mirrors use world axes. A component's
  `defaultMirrorX/Y` applies only when the corresponding option is omitted.
- The CLI must omit mirror flags unless the user explicitly supplied them, so
  symbol defaults (notably PMOS source-up and outward-facing output ports)
  remain effective.
- Symbol definitions live in `src/core/components/`; the registry is
  `components/index.js`. Geometry changes require a focused symbol test and an
  update to the visual guide when the standard changes.

The routing-sensitive symbol contract is:

| Family | Terminals at `rot=0` | Local footprint / default |
| --- | --- | --- |
| passives, switches, diode | `a=(-80,0)`, `b=(80,0)` | bbox `{-80,-40,160,80}` |
| NMOS / PMOS | `g=(-120,0)`, `d=(0,-80)`, `s=(0,80)` | bbox `{-120,-80,120,160}`; PMOS mirrors Y by default |
| bulk MOS | plain MOS plus `b=(0,0)` | bulk label offset `{40,-40}` |
| NPN / PNP | `b=(-160,0)`, `c=(0,-120)`, `e=(0,120)` | bbox `{-160,-120,160,240}`; PNP collector/emitter are inverted |
| current/voltage source, VCCS, VCVS | `a=(0,-80)`, `b=(0,80)` | bbox `{-40,-80,80,160}`; VCCS/VCVS are the diamond controlled sources |
| opamp, comparator, gm | `ip=(-200,-40)`, `im=(-200,40)`, `o=(160,0)` | `+` on top; differential variant adds `om=(160,-40)`, `op=(160,40)`; `gm` is the differential pins on a blunt (trapezoid) body; documents without `opampPolarityVersion` load mirrored so they draw as saved; comparators share the single-ended body, the clocked one adds `clk=(-200,0)` between the inputs |
| inverter/buffer | `a=(-120,0)`, `y=(120,0)` | tri-state variants add `en=(0,80)` |
| 2-input logic | `a=(-120,-40)`, `b=(-120,40)`, `y=(120,0)` | XOR/XNOR output is at `x=160`; 3-input adds `c` at `y=40` |
| mux2 | `a=(-80,-40)`, `b=(-80,40)`, `y=(80,0)`, `s=(0,160)` | tapered body |
| ADC / DAC | ADC `ain=(-200,0)`, `d=(200,0)`; reversed for DAC | bbox `{-200,-120,400,240}`; `adc_diff`/`dac_diff` replace the analog pin with `aip`/`aim` (`aop`/`aom`) at `y=-40`/`40` |
| DFF / latch | inputs at `(-80,-40)`, `(-80,40)`; outputs at `(80,-40)`, `(80,40)` | reset, when present, is `(0,120)`; bbox expands downward |
| ground / supply / VCM | ground `gnd=(0,0)`; supply `p=(0,0)`; VCM `vcm=(0,0)` | ground hangs down, supply hangs up, VCM is outline-only |
| ports | `p=(0,0)` | `port` is open-circle; boxed ports use `VI`/`VO`/`VIO` prefixes |
| block | `T1`…`T12` around the perimeter | default bbox `{-80,-80,160,160}`, resizable in even cell counts |
| signal_sum / signal_multiply | `n`, `s`, `w` inputs and `e` output on the circle at `(0,-40)`, `(0,40)`, `(-40,0)`, `(40,0)` | bbox `{-40,-40,80,80}`, 40-unit-radius circle with plus or multiply mark; unused terminals do not fail Design Check; optional negative inputs are owned sign labels |
| filter blocks | `in=(-80,0)`, `out=(80,0)` | `filter_lpf`/`hpf`/`bpf`/`notch`: bbox `{-80,-80,160,160}`, a box with the response sketched inside |
| gain | `in=(-80,0)`, `out=(80,0)` | `gain`: bbox `{-80,-80,160,160}`, a triangle with its tip on `out` and its centroid on the origin; its value is one coefficient, an owned math label inside it when short (`gainFitsInside`), else above it (horizontal flow) or right of it (vertical), in world terms |
| transfer function | `in=(-w/2,0)`, `out=(w/2,0)` | `tf_s`/`tf_z` (and the presets `tf_dac`, `tf_dac_rz`, `tf_delay`, `tf_zdelay`, which start with a DAC's NRZ or RZ pulse or a delay): the value is a MATLAB-style `tf([num], [den])` or a gain, in `s` highest power first and in `z` ascending powers of z^-1 (`'Variable','z'` for descending powers of z, `src/core/transfer-function.js`); an `s` block may instead be an expression in `s` with delays `exp(-s*T)` (or `'InputDelay', T`) drawn as an owned math label; the box (`ComponentInstance#bodySize`, at least `160x160`, whole pairs of cells) fits the equation by the model's own estimate, and a new definition reroutes its wires (`setPartValue`) |
| sampler | `in=(-80,0)`, `out=(80,0)` | `sampler`: bbox `{-80,-80,160,160}`, a sampling switch (s to z) whose value is its period `T`, drawn beside it like a long gain coefficient; z to s needs no part (an `H(s)` block reading a sampled signal is the DAC, its `H(s)` the pulse) |
| dither | `out=(40,0)` | `dither`: bbox `{-40,-40,80,80}`, a circle with a noise squiggle; its value is the shape and amplitude in full scale (`rect 1` is ±FS of the largest quantizer; `rect`/`tri` continuous, `bin`/`tern` two and three levels; `parseDither`), drawn beside it; a source in the transfer functions, random numbers in the simulations (sampled side only), scaled into the loop by a gain after it |
| quantizer | `in=(-80,0)`, `out=(80,0)` | `quantizer`: bbox `{-80,-80,160,160}`, a box with a staircase; its value is the level count `N` (default 2), drawn `N = 2` beside it; Schreier's levels, full scale `N - 1`; a gain of 1 plus its own error source (`E_{QZ1}`) in the transfer functions, rounding in the swing simulation |

All symbol linework is textbook style: butt-ended normal symbol strokes,
mitered geometry, filled polygon bars/arrows/slabs, and one-cell terminal
clearance. Variable passives compose the plain symbol plus their adjustment
arrow. `solder` is a terminal-less annotation dot, not an electrical symbol.
Use the component definition and its tests for exact path coordinates.

## Labels, ports, and nets

`circuit.labels` contains three mutually exclusive label roles:

1. an owned instance label (`owner` is a component refdes and `offset` is
   local);
2. a persistent electrical label (`netId` identifies one physical net); or
3. a free annotation (`owner:null`, `netId:null`).

Labels do not create connectivity. Physical net IDs remain separate even when
equal names create a deliberate virtual electrical connection. Use
`addNetLabel`, `renameNet`, and `renameNetLabel`; editor code must not assign
`net.name` directly. Net-label text is derived from the net, and removing one
label occurrence does not remove the net or its name. A net label never
becomes free text: copied with its wire it travels with it; copied alone it
carries only the name, and pasting it on a wire names that net (an unnamed net
takes it, a differently named one is renamed only after confirmation).

Component names and owned labels are one synchronized unique identity. Names
accept markup such as `M_{2}` and `R_{D}`; canonicalize for connectivity but
preserve authored markup for display. A descriptive name typed for a part
(`2-stage opamp`) keeps its text as the label and takes a derived identity
(`X2_stage_opamp`, `componentNameIdentity`); stored refdes and net-side port
renames stay strict. Default numeric labels use explicit
subscripts (`M_{1}`) while refdes connectivity remains `M1`. Never mutate the
circuit when rejecting a duplicate.

Owned and net labels default to the `parent` alignment: beside the part (or
at the side of its wire, for a net label) the text aligns toward it with the
full inset, and the box keeps the edge facing it fixed as the text grows;
above or below, the text is centered. A net label above or below its wire
that is aligned left or right keeps that edge where a two-cell box would have
it and grows away, so a wire stub's label edge stays on its terminal. Aligned text labels round their box up
to include that inset. Documents without `labelAlignVersion` 3 (or
`ownedLabelAlignVersion` 2) load their centered part and net labels as
`parent`. A net label may sit wherever its box touches its own wire -- along
an edge, or by one corner at a wire end -- without the wire running through
its text (`netLabelBoxTouches`, `Circuit#netLabelFits`); its anchor need not
lie on the wire. Dragged out past a wire end it sits beyond that end on the
far side, centred on the endpoint and aligned toward it
(`Circuit#netLabelDragPlacement`).

Interface ports are components and therefore also require unique identities.
While a port is the only interface pin on its physical net, its authored label
names that net in both directions. Multiple ports on a net retain their own
identities; name the net to make a virtual connection. A net name that cannot
be a component identity remains a net-only name. `port_filled` is a legacy
JSON alias for `port`.

Unnamed `ground`, `supply`, and `vcm` markers name an attached unnamed net
`V_{SS}`, `V_{DD}`, or `V_{CM}` and form shared AC-reference groups; the plain
spellings `VSS`/`VDD`/`VCM` are the same rails (`src/core/rail-names.js`), and
older documents' marker-named nets load respelled. A local owned
marker label is distinct from the global rail name; deleting it clears the
marker value and restores the global behavior. `GND` remains a compatibility
alias for an unnamed ground marker.

A MOS part may carry a size (`ComponentInstance#size`, `src/core/mos-size.js`:
W, L, multiplier, authored as `2u/400n x4`); its owned `mos-size` role label
is a projection of it, TeX with the part's name as W and L's subscript, and
deleting the label clears the size. With `replacesName` the size label stands
in for the name label, which stays the identity but is neither drawn nor
picked (`sizeReplacedNameLabels`, alongside joined supply bars' hidden labels).

Switches (`switch_open`, `switch_closed`) are the other role-labelled parts:
a switch's owned label names its phase (the controlling signal, stored as its
value; `$...$` is TeX drawn as math, compared by `phaseKey`), not its
identity, so several switches may share it. Switches on one
phase form a group that opens and closes together, in the drawing
(`setSwitchState`) and in beats; in beats a phase's complement (its name
with an overbar, `complementPhase`) stands opposite it, while the drawing
keeps each switch as drawn. Label text naming the switch's own refdes
clears the phase.

Supplies may join their bars (`joinBar`, `src/core/supply-bars.js`). A joined
bar is visual only: it never adds connectivity, and it breaks between
differently named supplies, across other parts, and across wires. Every supply
on a bar keeps the rail name in its own owned label; the bar shows one of them
and hides the rest only while it stays joined.

`solder` joins nets only when at least three wire arms meet at its grid point.
Fewer arms leave a plain annotation, which `syncJunctionSolders` may prune.
Placement is atomic: Escape or an outside click removes the pending dot.

Any interactive edit that shorts nets with different given names (a solder
dot, a wire or pin drag, a splice, a move onto a pin) asks which name the merged
net keeps, in one shared picker; Escape or an outside click cancels the whole
edit. Scripted commands never prompt: the model keeps one name and records a
`netNameWarnings` entry for Design Check. Joining an unnamed `ground`,
`supply`, or `vcm` marker to a net with another given name is the same kind of
short: the editor asks, in the same picker, to rename the net to the rail
(`V_{SS}`/`V_{DD}`/`V_{CM}`), and a cancel reverts the whole edit.

A net named with a bit range, `D[7:0]` or `D<7:0>`, is a bus
(`src/core/bus.js`): by the Virtuoso convention it stands for the parallel
nets `D[7]` ... `D[0]`, so a net named for one bit (`D[1]` or `D<1>`; the
brackets are one notation) is virtually connected to that bit
(`netNamesConnect`), while two different bits are not. Each bus or bit name
is its own `netGroupKey`, and highlights keep probe order: a bus or bit net
shows the latest probe on any name it connects to (`busNetHighlight`), so a
bit's probe colors that bit and the bus, and a bus probe clears its bits' own
colors so they all show the bus color (`applyNetProbe`). The net list lists
bits under their bus, and hovering a bus glows all its bits (a bit, the bus).
The renderer draws a one-cell 45-degree slash on a multi-bit net at each
pin, whole cells clear of the drawn part along the pin (`busTerminalMarks`: at
an ADC's terminal, a cell out from a port, two from a pin on a body's edge
such as a sum or block, for an arrowhead; two pins close together on one
plain wire share one slash mid-way). A bus net's right-click "Show bit
count" (`net <id> bitcount on|off`, `net.busCount`) puts its width beside each
slash; each count drags on its own, keeping its offset from its slash. A port named that way folds the range into its
identity (`D_{OUT}[3:0]` is `DOUT_3_0`) and keeps it in its label and net
name. Buses are for digital nets: small-signal analysis joins nets by exact
name only.

Persistent net highlights (`circuit.netHighlights`) are document data keyed
by `netGroupKey`, so one color covers a whole electrical group: equally named
nets and every net on one unnamed rail. Colors are unique palette tokens that
cycle forward and wrap to clear. The renderer paints the group's wires, net
labels, junction dots, rail markers, and interface ports (the parts a net
hover glows) in that color without changing their own styles.

## Rendering and math

- The renderer layers annotations below wires and components/labels above
  them. `drawOrder` only reorders objects within their category.
- `style.js` owns the stroke-role table (`symbol`, `wire`, `annotation`,
  `emph`, `ground`, `supply`, plus legacy fallbacks) and the public helpers
  `strokeAttrs`, `styleAttrs`, `fontAttrs`, and `escapeSvg`.
- Solid wires and terminal leads share square-capped `wire-ink` paths so
  terminal joints rasterize once. Per-segment wire elements remain transparent
  hit targets; ghost/dashed strokes retain their own painted elements.
- Exports, the page guide, and fit-to-view frame the visible extent
  (`Circuit#inkBounds`: drawn symbol graphics, wires, label text), not the
  grid-rounded boxes, plus the export padding; only a drawn grid snaps the
  frame to whole cells. Design Check's label overlaps compare label text with
  other text and with a part's individual strokes (`inkTouches`), and labels
  steer the router by their text; placement still uses the grid boxes.
- An active page guide (`src/core/page-guide.js`, an app preference) pads a
  drawing export to its exact width, centred, so the figure at full column
  width gets the guide's text size. The editor draws the same frame.
- Labels support `_{...}` and `^{...}`. Math uses the vendored Latin Modern
  Math face in `src/web/fonts/`; exports embed it when the drawing contains
  math. Persisted/exported text never contains provenance markers.

## Linked designs

A part may link loosely to another design of the workspace by name
(`ComponentInstance#link`, [`docs/hierarchy.md`](hierarchy.md)): no
connectivity, and a missing design is just a broken link. The editor peeks at
it in a bubble beside the drawing (`o`) or enters it with a trail back up
(`Alt+↓`/`Alt+↑`); bubbles and the trail are editor state, never saved, but
open bubbles export with the drawing (the design nested as vector SVG,
render.js `extras`).

## Beats

`circuit.beats` holds presentation steps over the one drawing
([`docs/beats.md`](beats.md), `src/core/beats.js`). Beats are view state
only: they list parts and labels to show, dim, or hide, switch positions, and
highlights as changes relative to the previous beat, and never copy or move
geometry; switch positions are kept per phase, so a switch added to a phase
follows its beats. Unmentioned objects show in every beat; wires, junction dots, and
owned labels follow what they join. Edit beats through the `beats.js` helpers,
which keep every other beat's look unchanged. The renderer takes one resolved
beat as `opts.beat`; the beat on screen is editor state and is never saved.

## Connectivity and routing

The model is topological; geometry is a route, not connectivity.

- A net owns terminals, managed branches, explicit junctions, and optional
  name. Crossings do not connect; a solder dot or an explicit wire endpoint
  does. A placed, moved, or pasted part's pin that is on no net and lands on
  the middle of exactly one managed wire tees into it with a junction
  (`Circuit#teeTerminalsOntoWires`); a pin already on a net never does. A
  lone part placed, moved, copied, or pasted with both series pins free on one
  straight managed segment is spliced into it in series first
  (`Circuit#spliceIntoSegment`). `route` is a compatibility alias; new code uses `paths()` and
  `wireSegments()`.
- `smartRoute` is grid-based and keeps committed wire at least one cell from
  component bodies, except for the documented shared MOS gate-bus exception.
  Terminal escape directions are preferred. Cross-net collinear overlap is a
  Design Check error and is never auto-merged.
- Fresh multi-terminal layouts may use the bounded Steiner router; topology
  growth normally appends one branch and preserves existing geometry. Fixed or
  authored paths change only through an explicit edit, transform, reroute, or
  topology repair.
- Moving, rotating, mirroring, or resizing components reroutes touched managed
  nets whose terminal anchors move, while preserving geometry for touched nets
  whose connected terminals stay put. If all terminals share one displacement,
  translate the net rigidly. Otherwise only the legs at moved terminals change;
  a pin's leg slides along itself or moves sideways by stretching the next
  segment, and a junction travels with the move only when a moved arm cannot
  take it up that way, or when it is on wire selected with the moved parts. Detached moves split selected wire islands
  without moving unselected islands.
- Wire editing is transactional. A click without sufficient movement does not
  mutate the model; invalid overlaps restore the pre-drag document; mouseup or
  Enter creates one history entry.

`evaluate()` / Design Check reports dangling terminals, body/wire and label
overlaps, illegal body crossings, diagonal managed wires, off-grid geometry,
and cross-net collinear overlap. Saving does not require a clean report.
The safe repairs -- a fresh reroute, snapping an off-grid part, moving a
crowded label to the nearest clear spot -- are `src/core/tidy.js`; the
editor offers them per issue and as Fix all, and `Shift+T` applies them to
a selection. Anything needing intent (a dangling pin, overlapping parts) is
never guessed.
