# Mosfeteer — agent context

Mosfeteer is a zero-dependency, Node 18+ schematic editor. It stores a
connectivity model and renders it as SVG. The repository is `ojarvin/mosfeteer`;
`origin` uses HTTPS.

## Choose a role first

- **Developer:** improve the application, tests, APIs, or documentation. Read
  [`guidelines/DEVELOPER.md`](guidelines/DEVELOPER.md).
- **Circuit author:** create or revise a drawing in the running editor. Read
  [`guidelines/CIRCUIT-AUTHOR.md`](guidelines/CIRCUIT-AUTHOR.md). Do not inspect or modify
  application source, tests, or configuration in this role.

Both roles follow [`guidelines/style-guide.md`](guidelines/style-guide.md).
This file records cross-cutting invariants and agent workflow. Exact behavior
belongs in the named source modules and tests; do not duplicate implementation
notes here.

## Repository map

- `src/core/` — pure model, symbols, geometry, routing, rendering, and
  symbolic analysis.
- `src/server/` — loopback HTTP server, document I/O, settings, and export.
- `src/web/` — browser editor, persistence adapter, interaction, and styles.
- `src/cli/index.js` — thin HTTP client for scripted editing.
- `test/` — Node test suite.
- `guidelines/` — role and visual-quality instructions.
- `docs/` — focused architecture, analysis, and beats docs.
- `launch.mjs`, `Mosfeteer.cmd` — launcher and its Windows double-click wrapper.

Useful commands:

```sh
npm test                         # all Node tests
npm run serve                    # watch server at 127.0.0.1:47280
npm run symbols                  # regenerate the symbol reference document
npm run cli -- amp "add nmos M1 --at 120 120"
node launch.mjs <folder-or-file> # launch with a workspace or document
```

There are no npm dependencies. `data/` and `node_modules/` are runtime/local
state and are ignored. Documents are portable `<name>.json` files;
do not add personal documents or generated server state to the repository.

## Non-negotiable model rules

### Grid, transforms, and symbols

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
| current/voltage source, VCCS | `a=(0,-80)`, `b=(0,80)` | bbox `{-40,-80,80,160}`; VCCS is the diamond controlled source |
| opamp | `ip=(-200,-40)`, `im=(-200,40)`, `o=(160,0)` | `+` on top; differential variant adds `om=(160,-40)`, `op=(160,40)`; documents without `opampPolarityVersion` load mirrored so they draw as saved |
| inverter/buffer | `a=(-120,0)`, `y=(120,0)` | tri-state variants add `en=(0,80)` |
| 2-input logic | `a=(-120,-40)`, `b=(-120,40)`, `y=(120,0)` | XOR/XNOR output is at `x=160`; 3-input adds `c` at `y=40` |
| mux2 | `a=(-80,-40)`, `b=(-80,40)`, `y=(80,0)`, `s=(0,160)` | tapered body |
| ADC / DAC | ADC `ain=(-200,0)`, `d=(200,0)`; reversed for DAC | bbox `{-200,-120,400,240}` |
| DFF / latch | inputs at `(-80,-40)`, `(-80,40)`; outputs at `(80,-40)`, `(80,40)` | reset, when present, is `(0,120)`; bbox expands downward |
| ground / supply / VCM | ground `gnd=(0,0)`; supply `p=(0,0)`; VCM `vcm=(0,0)` | ground hangs down, supply hangs up, VCM is outline-only |
| ports | `p=(0,0)` | `port` is open-circle; boxed ports use `VI`/`VO`/`VIO` prefixes |
| block | `T1`…`T12` around the perimeter | default bbox `{-80,-80,160,160}`, resizable in even cell counts |
| signal_sum / signal_multiply | `n`, `s`, `w` inputs and `e` output on the circle at `(0,-40)`, `(0,40)`, `(-40,0)`, `(40,0)` | bbox `{-40,-40,80,80}`, 40-unit-radius circle with plus or multiply mark; unused terminals do not fail Design Check; optional negative inputs are owned sign labels |

All symbol linework is textbook style: butt-ended normal symbol strokes,
mitered geometry, filled polygon bars/arrows/slabs, and one-cell terminal
clearance. Variable passives compose the plain symbol plus their adjustment
arrow. `solder` is a terminal-less annotation dot, not an electrical symbol.
Use the component definition and its tests for exact path coordinates.

### Labels, ports, and nets

`circuit.labels` contains three mutually exclusive label roles:

1. an owned instance label (`owner` is a component refdes and `offset` is
   local);
2. a persistent electrical label (`netId` identifies one physical net); or
3. a free annotation (`owner:null`, `netId:null`).

Labels do not create connectivity. Physical net IDs remain separate even when
equal names create a deliberate virtual electrical connection. Use
`addNetLabel`, `renameNet`, and `renameNetLabel`; editor code must not assign
`net.name` directly. Net-label text is derived from the net, and removing one
label occurrence does not remove the net or its name.

Component names and owned labels are one synchronized unique identity. Names
accept markup such as `M_{2}` and `R_{D}`; canonicalize for connectivity but
preserve authored markup for display. Default numeric labels use explicit
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
`parent`.

Interface ports are components and therefore also require unique identities.
While a port is the only interface pin on its physical net, its authored label
names that net in both directions. Multiple ports on a net retain their own
identities; name the net to make a virtual connection. A net name that cannot
be a component identity remains a net-only name. `port_filled` is a legacy
JSON alias for `port`.

Unnamed `ground`, `supply`, and `vcm` markers name an attached unnamed net
`VSS`, `VDD`, or `VCM` and form shared AC-reference groups. A local owned
marker label is distinct from the global rail name; deleting it clears the
marker value and restores the global behavior. `GND` remains a compatibility
alias for an unnamed ground marker.

Switches (`switch_open`, `switch_closed`) are the other role-labelled parts:
a switch's owned label names its phase (the controlling signal, stored as its
value; `$...$` is TeX drawn as math, compared by `phaseKey`), not its
identity, so several switches may share it. Switches on one
phase form a group that opens and closes together, in the drawing
(`setSwitchState`) and in beats. Label text naming the switch's own refdes
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
(`VSS`/`VDD`/`VCM`), and a cancel reverts the whole edit.

Persistent net highlights (`circuit.netHighlights`) are document data keyed
by `netGroupKey`, so one color covers a whole electrical group: equally named
nets and every net on one unnamed rail. Colors are unique palette tokens that
cycle forward and wrap to clear. The renderer paints the group's wires, net
labels, junction dots, rail markers, and interface ports (the parts a net
hover glows) in that color without changing their own styles.

### Rendering and math

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

### Beats

`circuit.beats` holds presentation steps over the one drawing
([`docs/beats.md`](docs/beats.md), `src/core/beats.js`). Beats are view state
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
  does. `route` is a compatibility alias; new code uses `paths()` and
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
  take it up that way. Detached moves split selected wire islands
  without moving unselected islands.
- Wire editing is transactional. A click without sufficient movement does not
  mutate the model; invalid overlaps restore the pre-drag document; mouseup or
  Enter creates one history entry.

`evaluate()` / Design Check reports dangling terminals, body/wire and label
overlaps, illegal body crossings, diagonal managed wires, off-grid geometry,
and cross-net collinear overlap. Saving does not require a clean report.

## Small-signal analysis contract

The v2 pipeline builds one exact full-RLC MNA model for `Z_in(s)`, `Z_out(s)`,
and `A_v(s)`, then presents derived equations. The main implementation is in
`src/core/analysis/`; the user-facing contract is summarized in
[`docs/symbolic-analysis.md`](docs/symbolic-analysis.md).

- Independent DC current sources open, voltage sources short, and DC
  power/reference rails share AC ground. Capacitors contribute `sC`; inductors
  use an MNA branch-current stamp.
- A selected input/output port is never silently made the AC reference. Whole
  virtual-name groups follow the selected node. Unused input ports are held at
  AC ground. Ambiguous, singular, floating, or unsupported selections return a
  diagnostic rather than a guessed equation.
- Three-terminal MOS bulk is implicitly tied to VSS/VDD; four-terminal MOS
  uses its actual bulk. Body effect may be omitted without reconnecting the
  bulk. `r_o → infinity` and infinite resistor attributes remove branches
  before solving when safe; triode uses its separate `r_{ds}` model.
- Model simplifications affect conversion/solving: body effect, channel-length
  modulation, Miller reduction, and MOS parasitics. Equation approximations
  affect presentation only: high intrinsic gain and dominant pole. The
  normalized option defaults and labels are in `src/web/analysis-options.js`.
- `reduceNetwork` pre-reduces parallel branches only. It records equivalence
  proofs used by presentation; do not add series pre-reduction to the solver.
  `report-adapter.js` re-renders every displayed AC/DC row, so pass its
  equivalence options and provenance through every row, including poles/zeros.
- The GUI calls `adaptCombinedReport(analyzeSmallSignalV2(...))`, never the v2
  analyzer directly. Provenance is opt-in and only decorates live equation
  MathML; it must not leak into labels, documents, or exports.

Read the focused tests before changing this pipeline. In particular, the
analysis corpus, report-adapter, provenance, Miller, parasitics, reduction,
and topology tests encode behavior that prose cannot safely replace.

## Editor, persistence, and entry points

`runCommand(circuit, line, io)` in `src/core/commands.js` is the single command
language used by the prompt, `window.__run`, the CLI, and
`POST /api/circuits/<name>/cmd`. Add commands to both `dispatch()` and
`commandHelp()` and test success plus an error case.

The server serializes load/run/save per document and writes atomically. The
browser synchronizes the active document by revision/ETag and pauses polling
while hidden. Save invalidates stale sync responses. `src/server/documents.js`
and `src/web/persistence.js` are the persistence boundary; `data/` is not a
fixture directory.

Core keyboard vocabulary:

| Context | Keys |
| --- | --- |
| normal | `i` insert, `w` wire, `m` move, `Shift+M` detached move, `c` copy, `Shift+A` align to (selection outline edge/point, then another object's), `r` rotate, `Shift+R`/`Ctrl+R` mirrors, `x` check, `u`/`Shift+U` undo/redo |
| view | `f` fit, `#` grid, `Shift+C` crosshair, `Shift+G` guides, `Shift+D` theme, `Shift+P` side panel, `?` help, `:` command line (log drawer) |
| editing | `dd`/Delete delete, `p` paste, `y` copy, `Ctrl/Cmd+S` save, `Ctrl/Cmd+O` open, `9` net highlight tool, `8` remove all highlights, `Space` tap labelled wire stubs on the selected parts' unconnected terminals (`src/core/stubs.js`; a stub that would short is skipped) |
| beats | `Shift+B` beat strip, `+` add a beat, `Alt+→`/`Alt+←` (or PageDown/PageUp) step, `h` hide / `Shift+H` dim the selection from this beat on, `s` flip switches, `Shift+F5` present |
| wire/insert | Enter commits, Escape cancels; `F3` toggles new-wire routing mode; `/` flips the draft corner; hold `Alt` for symmetric placement/copy or cursor snapping to the nearest terminal or free wire end while wiring; a click on a free wire end (`Circuit#openWireEnds`) finishes a draft there like a terminal |
| pointer | drag from a multi-terminal pin wires (drop in space opens quick-add); Ctrl/Cmd-drag copies a part, label, or annotation, or branches a wire; right-drag/hold a part for the radial menu; Shift-drag in Delete is a knife that deletes every wire, part, and annotation it cuts; Space-drag pans; double-click paper inserts |

View toggles are handled before mode-specific keys, except printable insert
query text before a ghost exists. Any tool can be picked straight from another
(key or toolbar), dropping the old tool's uncommitted work as Escape would;
re-picking Wire keeps a half-drawn wire, and in Wire mode a letter naming a
terminal of the part being pointed at still picks that terminal.
`Ctrl+Shift+R` is intentionally unbound.
Selection is role-aware across components, labels, nets, annotations, and wire
runs; clicking a selected object again selects the next object stacked at that
point (`nextStackedSelection`), and a press there drags the selected one.
Component/managed-wire transactions are one undo entry.

The browser exposes `window.__circuit()`, `window.__run(command)`, and
`window.__load(state)` for isolated verification. Headless browser tests must
use one persistent CDP connection, temporary ports/directories, real mouse
events for double-click (`clickCount: 2`), and only terminate processes they
started. Never use a broad `pkill`.

## Maintenance rules

- Read the relevant guideline, source module, and tests before changing code.
- Add or update a focused test with every behavior change. Run `npm test`.
- Browser-visible changes need an isolated smoke check when practical.
- Update this file only for durable cross-cutting invariants. Put detailed
  feature contracts in focused docs and implementation-specific facts in
  source/tests. Remove stale prose instead of appending to this file.
- Keep role expectations in `guidelines/`, visual standards in
  `guidelines/style-guide.md`, and analysis/routing details in the
  focused `docs/` files.
