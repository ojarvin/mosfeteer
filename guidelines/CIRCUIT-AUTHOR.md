# Circuit Author Guide

You draw, analyze, and document a circuit in the running editor. The user may
be watching live. Work in reviewable phases: place, route, label, then
analyze and document. [`style-guide.md`](./style-guide.md) is the visual and
electrical standard; this file is the procedure and the tool reference.

## Role contract

Stay in the **circuit-author lane**. Everything goes through the command
language (CLI, HTTP, or the editor's `:` prompt), never through source.

**Allowed:**

- read this guide, `style-guide.md`, `AGENTS.md`, and the focused `docs/`
  when an exact behavior matters (`docs/model.md` for symbols and nets,
  `docs/symbolic-analysis.md`, `docs/figures.md`, `docs/notes-and-history.md`
  for analyses, figures, and notes);
- read the requested design's `<workspace>/<name>.json` and the workspace's
  other designs as examples (`GET /api/workspace`, `GET /api/circuits/<name>`);
- run any command `help` lists against the requested design: drawing,
  sizing, analysis, annotation, notes, figures, beats, timing, report;
- run read-only checks (`eval`, `explain eval`, `state`, `nets`, `list`,
  `bounds`, `figures`, `svg`) as often as useful.

**Never:**

- read or modify `src/`, `test/`, package files, or configuration while
  drawing; never write circuit JSON directly or use implementation internals;
- edit `AGENTS.md`, the guidelines, or the user's agent configuration;
- create scratch, practice, or duplicate designs, or clear a design without
  an explicit request;
- invent electrical behavior the request leaves open without saying so;
- add text, values, or figures nobody asked for (the notes are always
  written and the design tagged; see **Sizes, analysis, figures, notes**);
- treat a clean `eval` as visual review, or report completion while a
  required decision or defect remains.

If the command language cannot express an edit, keep the design as it is,
name the missing operation, and report it (see **Report what the tools
lacked**).

## Electrical contract first

Before placing anything, write down the contract in compact terms: the
functional blocks and their devices, every terminal-to-net relation, signal
direction and polarity, feedback, bias sources, supplies, grounds, ports,
and the names and labels required.

Where more than one reasonable circuit fits the request (topology, polarity,
bias scheme, port meaning, supply convention), ask the user the smallest set
of concrete questions first. When the user has said to proceed without
asking, choose the textbook default and state each choice in the summary
and in the design's notes.

Defaults when the request leaves them open:

- **A complete circuit includes its bias.** Unless the request gives the
  bias voltages, generate every one of them on the drawing from a single
  reference current `I_{BIAS}` (an ideal `current_source`, the only bias
  input). A transistor stage, an amplifier, or a comparator is drawn with
  its bias generator, not with bare bias stubs.
- **Matched gate pairs face each other.** Every current mirror, and every
  pair of cascode or bias devices sharing a gate net, is drawn as a facing
  pair with the gates joined by one bus between them (`style-guide.md`
  §4.5b). Apply it to every such pair in the drawing, NMOS and PMOS alike.
- **Sizes are units and multipliers.** Matched and ratioed devices share one
  unit W/L; the ratio is the multiplier (`size M9 11.5u/1u x4` beside
  `size M10 11.5u/1u x1`), so the parts table shows it.
- **The design is checked, not only drawn.** For an analog block, work out
  and state: each device's saturation margin at the operating point, the
  input common-mode range (both limits and what sets each), the output
  swing, and the total supply current and power.

## Talking to the editor

The server is usually running (`npm run serve`, `127.0.0.1:47280`); check
with `curl -s 127.0.0.1:47280/api/workspace`. Use it; never start a second
editor on the same workspace. The first command naming a design creates it
and makes it the active one; an open browser follows it.

After the server's code changes (a developer edited it), it refuses
mutations with "Mosfeteer was updated since this server started"; ask the
user to relaunch it.

**CLI** (a thin client of the HTTP endpoint):

```sh
node src/cli/index.js amp "add nmos M1 --at 120 120"            # one command
node src/cli/index.js amp "add nmos M1 --at 0 0" "add nmos M2 --at 480 0 --mirrorX"
node src/cli/index.js amp -f place.txt                           # a script, one batch
node src/cli/index.js amp - <<'EOF'                              # the same from stdin
add pmos M3 --at 0 -400
connect M1.d M3.d --name V_{OUT}
EOF
node src/cli/index.js amp "svg review.svg"                       # written where the CLI runs
node src/cli/index.js amp help                                   # every command, current
```

- Each argument is one command. Never join commands with `;`: it is not a
  separator, and the extra words become arguments of the first command.
- A script (`-f FILE` or `-`) has one command a line; blank lines and lines
  starting with `#` are skipped. It is sent as one batch: run in order,
  saved once, stopped at the first error (the lines before it stay done),
  and the CLI exits 1.
- Files a command reads go with it: `notes load FILE`, `annotation dataplot
  FILE`. `svg FILE` is written by the CLI.
- `--json` adds the machine-readable result after `__JSON__`.
- Every mutating command saves the design. Saving is not approval.

**HTTP**: `POST /api/circuits/<name>/cmd` with `{"cmd": "line\nline"}` (or a
list of lines) runs a batch the same way; `GET /api/circuits/<name>` returns
the saved state.

**Browser** (for what only a browser shows: measured math, figures, the
windows): the user's open tab follows the active design. To look yourself,
start Chromium headless on a random debug port against the editor URL and
keep one CDP connection; the editor may open in the Atlas view, so click
**Back to <name>** first. `window.__run(command)` runs a command and returns
what it printed; `window.__circuit()` returns the live state. Stop only the
processes you started.

**Review images**: the SVG carries math (equation tables, model labels,
parts tables) as MathML in `foreignObject`. `rsvg-convert` and ImageMagick
leave it out; rasterize with Chromium (`chromium --headless --screenshot`)
or view the editor itself.

## Authoring workflow

1. **Placement.** State the topology and signal names, then place every
   part with explicit `--at` on the 40-grid: PMOS rows above NMOS rows,
   stacks in columns, matched pairs mirrored on one centerline, gate pairs
   facing each other, the bias generator left of the signal path with its
   reference branch leftmost (`style-guide.md` §2, §4, §4.5e). Read `list`
   for the world terminals; inspect the SVG. A part placed or moved so a
   pin lands on another part's pin is joined to it: clear the spot first
   (`rm` the old part, or move it away) and check `nets` for stray nets.
2. **Rails and ports.** `rail M9.s supply` / `rail M7.s ground` wires a
   rail marker one cell out from a pin. Add each port one cell of wire from
   the pin it drives (`add input VINP --at X Y`); ports on the same side
   share one column, so an output tapped from a node lines up with the
   input port on its side (`style-guide.md` §8).
3. **Placement review.** Fit and inspect. Ask about a materially different
   choice now, before routing.
4. **Routing.** One logical net at a time with `connect`. A net of three or
   more terminals in one `connect` gets a real junction from the router;
   `explain connect A.t B.t` dry-runs a two-terminal route. Then review each
   route against `style-guide.md` §5.1 and correct it with `net <id>
   segment-move X Y TO`: the straight run through X Y slides sideways to
   the line TO (a y for a horizontal run, an x for a vertical one), a
   junction at its end moving with it. A move that would overlap another
   net or cross a body is refused; one stopped by a neighbor says where it
   stopped. When a whole route is wrong (a feedback wire taken across the
   stages), draw it yourself: `connect REF.TERM --at X Y --via X,Y;X,Y`
   runs a wire from the pin through the --via points to X Y, a pin or a
   point on a wire, joining that net there. To take a wire away first,
   `net <id> segment-rm BRANCH SEG` (segments count from 1 along a branch,
   as `state` lists them); `disconnect REF.TERM` takes the pin off its net
   but leaves the wire.
5. **Names and labels.** Name nets for what they do: `connect ... --name
   V_{TAIL}`, `net N7 name V_{INP}`. A port's label follows its net's name,
   so `net <id> name V_{INP}` is how a port reads `V_{INP}`. Equal names on
   separate nets join them virtually: the bias generator's outputs reach
   the amplifier's gates this way, each labeled on both sides.
   `netlabel add NET TEXT X Y [--side above|below|left|right]` shows a name
   on a wire; `netlabel move LABEL X Y [--side S]` moves one. Place them by
   `style-guide.md` §8.1: a bus between a facing pair is labeled at its
   center, and the labels of one stack's buses share its centerline.
   A part named with markup (`add current_source I_{BIAS}`, `rename M1
   M_{IN}`) shows the markup as its label; its refdes is the plain form
   (`IBIAS`), and either form names it in later commands (`I_{BIAS}.a`).
6. **Check.** `eval` after each group; `explain eval` for repair hints;
   `nets` to see every terminal on the intended net. Then inspect the image.

### Sizes, analysis, figures, notes

Sizes and analysis when the request asks for them; notes and tags always.

- **Sizes**: `size M1,M2 28u/500n hide` (`beside` or `replace` draws them on
  the part); `partstable` puts a table of every size and value on the
  drawing; `value R1 10k`.
- **Small-signal equations**: `analyze equations OUT --input IN` derives
  as the analysis window does and prints every row: impedances, transfer
  functions, poles and zeros, and with `--noise thermal,flicker` the
  input-referred noise. Name the AC grounds with `--ac-ground NET,...`
  (rails already are). `--annotate` puts the equation table on the drawing
  and saves the form, so the window opens on the same analysis; run it
  again to rewrite the table in place. `--exclude Ports` leaves a row out;
  `--set millerApproximation=off` changes any window option.
- **The model**: `analyze model OUT --input IN [--ac-ground ...]` places the
  small-signal model as drawing-only parts (no analysis reads them).
- **Other analyses**: `analyze logic --annotate`, `synthesize logic ...
  --annotate`, `analyze signal-flow ... --annotate`, `analyze switched-cap
  --input IN --output OUT [--noise ktc] --annotate`. The kT/C noise table
  and the signal-flow and switched-capacitor plots read numbers their
  windows hold: make those from the editor's windows.
- **Bode plots**: `analyze bode OUT --input IN [--ac-ground ...]
  [--quantity transfer|output|input|loop] [--loop AT] --annotate` puts the
  magnitude and phase plots on the drawing, as the Plots window draws them
  at the design's Values (normalized: g_m in units of g, capacitors in
  units of C, ω in g/C). The port quantities are solved in numbers, so
  they plot even when the equations exceed the solver's budget. For an op
  amp, plot the loop gain (`--loop` at the input transistor's gate) for
  the phase margin, and the closed-loop gain.
- **When the equations exceed the solver's budget**: ground what is AC
  ground in the intended picture (`--ac-ground` the tail of a pair driven
  differentially), use `--dominant-pole`, or leave rows out with
  `--exclude "TITLE,TITLE"` (quote titles with spaces). DC rows and noise
  densities do not depend on capacitors: `drawing-only CC,CL on` for that
  solve, then `off` again, and say so in the notes.
- **Tags**: every design gets tags, without being asked: `AI-generated`,
  always, and three to six descriptive ones a search would use: what the
  circuit is and its distinguishing features (`tag add AI-generated ota
  telescopic cascode pmos-input bias-generator`). The Atlas finds designs
  by them (`#ota`). Keep the tags the user added.
- **Figures**: `figures` lists what is on the drawing; `figures --arrange`
  packs every figure again (tables right of the circuit, models and plots
  below).
- **Notes**: every design gets notes, written without being asked. The
  first lines are the `#` title and `Author: <your model name>` (for
  example `Author: Claude Opus 5.5`), then the circuit figure. Then, as the
  design has them: the topology and every choice made without asking;
  targets and process assumptions; the operating point (each device's
  current, overdrive, and size as unit × m); bias voltages and the bias
  generator; the analysis results with their figures; the input
  common-mode range and output swing; the total current and power; and
  how to size it toward gain, noise, and swing. A later change to the
  drawing updates the notes in the same pass.
  Write the Markdown to a file and `notes load notes.md`, or
  build it with `notes set TEXT` and `notes append TEXT` (`notes append`
  alone adds an empty line; indentation after `append ` is kept for nested
  lists). Mention parts and nets as `@M1`, `@V_{OUT}`; place figures with
  `![[circuit|caption]]` or `![[F1|caption]]` (ids from `figures`).
  `report` renders the notes with numbered figures.

### Choosing AC grounds

The analysis refuses an ambiguous or singular circuit rather than guess;
the error names the floating node (`no nonzero pivot for V(N16)`): ground
it or drive it.

- Bias nets driven from outside the drawing (a labeled gate stub) are AC
  ground: list them.
- A differential pair driven from one input: ground the other input and the
  tail (a virtual ground for a differential signal). Keep a current-mirror
  load's node live; grounding it drops the mirror's signal and half the
  noise sources.
- A symbolic solve too large for its budget says so; ground a node that is
  AC ground in the intended small-signal picture, and say which in the
  notes.

## Final verification

Before presenting the design:

- `eval` is clean: no unconnected terminals, overlaps, grid violations,
  wires through bodies, cross-net overlaps, or label overlaps;
- every multi-terminal net's `branches` reach all its terminals (`nets`,
  `state`);
- labels name the ports, bias and reference nodes, and the output; supply
  and ground symbols stay unlabeled unless asked;
- the image matches the netlist: junctions only where nets join, mirrored
  parts the right way round, signal flow left to right, symmetric halves
  symmetric;
- figures do not overlap the circuit or each other (`figures`), and math is
  checked in a browser rendering;
- every gate-sharing pair faces itself; ports sit one cell from their pins,
  same-side ports in one column; net labels follow `style-guide.md` §8.1;
- the notes exist, start with the title and the `Author:` line, state every
  choice made without asking, and match the drawing as it is now; read
  them back from the saved file (`notes`, `tag list`) as the last step,
  since an editor window saving an older copy overwrites them;
- `tag list` shows `#AI-generated` and a few descriptive tags.

## Report what the tools lacked

End the summary with what got in the way: a missing command, a misleading
message, a guide statement that proved wrong. Name the command and what
happened. Do not edit the guides yourself; the user or a developer decides
what changes.

## Reference

`help` is the full, current command list. The commands an author uses most:

```text
add TYPE [REF] --at X Y [--rot D] [--mirrorX] [--mirrorY] [--value V]
move REF X Y | rotate REF [D] | mirror REF x|y | rename REF NEW | rm REF | swap REF TYPE
connect REF.T REF.T ... [--name N] | connect REF.T --at X Y --via X,Y;... | disconnect REF.T | cross A1 A2 B1 B2
rail REF.T ground|supply|vcm | stubs REF ... | net ID name|label|add|drop|rm ...
net ID segment-move X Y TO
netlabel add NET [ID] TEXT X Y [--side S] | netlabel move LABEL X Y [--side S]
annotation add [ID] TEXT X Y | box ID... [--text T]
size REF[,REF] W/L [xM] [hide|beside|replace] | value REF V | partstable
analyze equations OUT --input IN [--ac-ground ...] [--noise ...] [--annotate]
analyze bode OUT --input IN [--quantity Q] [--loop AT] [--annotate]
analyze model OUT --input IN | analyze transfer-function|output-impedance|... NET
analyze logic|signal-flow|switched-cap ... [--annotate] | synthesize logic ...
figures [--arrange] | notes [set|append|load|clear|markdown|outline] | report | tag add|rm|list ...
timing ... | beat ... | switch ... | history checkpoint NAME
list | nets | state | bounds | eval | explain eval | explain connect A.t B.t | svg [FILE]
```

Terminal names (grid 40):

```text
nmos/pmos:   g d s                nmosb/pmosb: g d s b
npn/pnp:     b c e                two-pin parts: a b
ports:       p                    ground: gnd    supply: p
sources:     a b                  gm: ip im op om
adc: ain d   dac: d aout          adc_diff: aip aim d    dac_diff: d aop aom
filter_*:    in out
```

`--mirrorX`/`--mirrorY` are optional: omitted, the symbol's defaults apply
(PMOS source up, output ports facing out). Pass one only to override.

In the editor, `:` opens the same command line, which also runs editor
actions by description; `?` opens Learn, whose guides cover the windows and
keys.
