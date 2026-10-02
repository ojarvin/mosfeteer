# Beats

A beat is one step of a figure that builds itself up: which parts and labels
it shows, dims, or hides, which way its switches point, and which nets are
highlighted. Beats
are view state over **one** drawing. They never copy geometry, so fixing the
drawing fixes every beat. Code: `src/core/beats.js`; tests:
`test/beats.test.js`.

## The rules

1. **Unmentioned means always shown.** A part or label that no beat mentions
   is visible in every beat. Drawing something new therefore needs no beat
   edits, except in the editor: a part drawn *while a beat is on screen*
   appears from that beat on.
2. **A change carries forward.** A change made on beat *n* applies to beat
   *n* and to the following beats that looked the same, stopping at the first
   beat that already differed. Hiding a placeholder at beat 3 hides it for the
   rest of the talk; showing a part at beat 2 that already appeared at beat 4
   makes it appear at beat 2 instead.
3. **Beats never disturb each other.** Adding, deleting, or moving a beat
   leaves every other beat looking exactly as before. A new beat starts as a
   copy of the one before it.
4. **Wires, dots, and owned labels follow.** A beat draws only the wire
   needed to join what it shows: dangling ends are trimmed back to a shown
   terminal or a shown net label. A stub the drawing leaves open-ended stays
   whole while the wire or pin it hangs from shows, unless it runs through
   something hidden, such as the placeholder label it carried. A junction dot
   shows while three or more arms meet at it. An owned label shows with its
   part. A net label that no beat mentions follows the parts on its net.
   Wire that joins only dimmed parts is dimmed too, and a junction dot dims
   only when no shown wire runs through it. Dimmed parts are drawn in a
   solid grey (`--svg-dim` in the editor and presenter), so where faint
   strokes meet they do not double up.
5. **Switches and highlights are per beat** on top of the drawing's own
   positions and highlights, with the same carry-forward rule.

## Switch phases

A switch's label names its **phase**, the signal that controls it: edit the
label, or run `value S1 $\phi_1$`. A phase in `$...$` is TeX and draws as math,
like an equation; plain text such as `φ_{1}` works too. TeX phases compare
by what they draw, so `$\phi_1$`, `$\phi_{1}$`, and `$ \phi_1 $` are one
phase (but `$\phi_1$` and `$\varphi_1$` are two). The refdes stays the
switch's unique identity. Switches with the same phase are one group: flipping
one (`s`, or `switch φ_{1} closed`) flips them all, in the drawing and in
beats. Beats store positions per phase, so a switch added to a phase later
follows its beats without edits. A switch joining a phase takes the phase's
position; a switch starting a new phase brings its old phase's beats, so a
phase can be renamed one switch at a time. Labelling a switch with its own
name (`S_{3}`) takes it out of any phase.

A switch's right-click menu has **Phase**, to put the selected switches on an
existing phase, on none, or on a new one, and **Select → Same switch phase**.

Every phase has a **complement**, its name with an overbar: `$\varphi_1$` and
`$\overline{\varphi_1}$` (a plain-text phase's bar is math:
`$\overline{CLK}$`). The Phase menu offers each phase's complement as soon as
the phase exists. In beats a complement's switches stand opposite the
phase's: flipping either on a beat flips both, and a complement's first switch
takes the phase's beats the other way round. The drawing itself keeps every
switch as drawn -- all open, say -- until one is flipped there.

**Beats from phases / timing** (More menu, or the timing editor's **Make
beats**; `beat phases`) follows one flow: switches name their phases, a timing
diagram (when one is drawn) says which phases are high when, and the beats
step through that. When the drawing already has beats, the editor asks
whether the new beats replace them or are added after the beat on screen
(`beat phases --replace` or `--after N`). With a diagram, it adds one beat per state the diagram
steps through -- a run of slots with the same phases high -- named after the
phases high in it, so overlapping phases close together; a wave that ends as
it starts goes round, its last state being its first. Without a diagram, it
guesses one phase at a time: a beat per phase, in the order the phases were
first drawn, closing that phase's switches and opening every other phase's (a
complement is closed wherever its phase is open). Each beat shows its
equivalent circuit: the open switches are dimmed, and the rest splits
into islands joined through anything but a rail. An island's ends are the
rails, pins, and named nets (a virtual connection) it touches. An island keeps
working and stays shown, with the pins and rail markers on its wires, when it
has a device in it (anything but switches, pins, and rail markers) and at
least one end -- an integrator holding its charge, say -- or when its closed
switches join two ends, such as an output reset to VCM. Anything else is cut
off and dimmed, a capacitor floating between open switches included, so the
whole circuit stays readable. Switches without a phase keep their
drawn position. Only phases some switch is on make beats: a complement merely
offered in the menu makes none. The beats are ordinary beats, inserted after
the one on screen as one undoable edit.

**Timing diagram** (More menu or `Shift+K`, which also closes it; `timing`) draws one row per phase under the
drawing, in the phases' order with each complement right after its phase:
its wave, two cells tall with vertical edges, the waves centred on the
drawing's width, and the phase's name as a free label, right-aligned in a
column just left of them.
A wave is a row of slots, each high or low; a short wave holds its last
level. The waves repeat, so each row shows half a slot of its last level
before the start and of its first after the end, where its transitions are.

Non-overlap is kept between pairs of phases: by default every two that are
never high in the same slot. Where one of a pair falls as the other rises, a
one-cell gap opens in every row; in it the pair's fall comes early and its
rise late, so the two are never high at once, and other phases change as the
gap opens. A complement is its phase inverted, high in the gaps.

The menu item opens an editor beside the drawing: a grid with a row of slots
per phase, started from the diagram already drawn, else from the beats (one
slot per beat, high where the phase's switches are closed; **From beats**
refills it). Click a slot to flip it, or move a cursor with the arrows and
type `1` or `0`; the empty cell after the last slot adds one. `+` repeats
the slot at the cursor in every row -- a state held one slot longer -- `*` (**Repeat all**) copies
every wave once after itself, a second period to edit, and Delete removes
a slot. The slot width is in cells, and **Never overlap** lists
every pair of phases to keep apart (**Automatic** returns to the default).
A row's edges can also move off the slot boundaries by whole cells: `[` and
`]` move the cursor row's falling edges a cell earlier or later, `{` and `}`
its rising edges (or the **Fall** and **Rise** buttons) -- a bottom plate's
switch opening a cell before its top plate's is its phase's wave with the
fall a cell early. The row shows its shift (`↓−1`). A complement following
its phase takes the phase's shifts the other way round: the phase falling
early, it rises early. Every change redraws the diagram in place, and an
editing session is one undo entry. A complement follows its phase inverted until one of its own
slots is changed; any other phase with no wave is low.

Rows need not be switch phases: **Signals** in the editor (or `timing
--add CLK,EN`) adds rows of the diagram's own -- a clock, an enable, every
row of a drawing with no switches at all -- low throughout to start with;
**Remove row** (`--rm`) takes one away, and the diagram goes with its last
row. The drawn diagram keeps them (`timing.signal`). A signal is drawn like
a phase, a barred one following it inverted, but it switches nothing: it
makes no beats, and is kept apart from another row only when its pair is
ticked.

The command takes the same waves: `timing φ1=10 φ2=01 --slot 2`, a phase
named by its text, TeX, row number, or `~φ1` for its complement; rows not
named keep their waves, `--beats` retakes them from the beats,
`--gaps auto|none|φ1:φ2,...` sets the pairs kept apart, and
`--fall φ1'=-1` / `--rise PHASE=N` shift edges by cells.

A new diagram is placed with its waves centred on the drawing's width, as
high as the drawing leaves room for it -- floating up into an empty part of
the drawing -- else below everything. After that it stays where it stands:
drag it anywhere, and redraws keep it there. It does not move out of the way
of later drawing; **Re-place** (`timing --place`) puts it where the drawing
has room again. Rows move up and down with Alt+↑/↓ (or the **Row** buttons;
`timing --order φ2,φ1`), and keep that order.

The diagram's annotations remember their phase and wave, so drawing it again
replaces it rather than adding another. They are ordinary lines otherwise:
drag vertices to adjust one by hand (a redraw then replaces that edit).

Placeholders fall out of rule 4: to stand in for a bias transistor until it
appears, put a net label (or a port) on the gate net, hide it from the beat
where the transistor appears, and the wire to it disappears with it.

## Stored form

`circuit.beats` is an ordered list. Each beat stores only its changes
relative to the beat before (the first beat is relative to the drawing):

```json
"beats": [
  { "id": "b1", "name": "Signal path", "hide": ["M3", "M4"] },
  { "id": "b2", "name": "Bias", "show": ["M3", "M4"], "dim": ["M1"], "hide": ["L2"] },
  { "id": "b3", "name": "Phase 2", "switches": { "φ_{2}": "closed", "S5": "open" }, "highlights": { "name:VX": "red" } }
]
```

An object whose first entry is a `show` is hidden before it. A document
without `beats` has none. References to deleted objects are dropped on save;
renaming a part renames its references.

## Where beats appear

- **Editor.** The beats window starts closed, showing the whole drawing;
  `Shift+B` (or its toolbar button, or More → Beats) shows it, and `+` adds a
  beat after the one on screen. `Alt+→`/`Alt+←` or PageDown/PageUp step
  through them, stopping at either end; before the first is the whole
  drawing. The beat on screen draws what it dims faint and what it hides
  fainter still; both stay selectable. `h` hides the selection from this beat
  on (or shows it again), `Shift+H` dims it, `s` flips selected switches (from
  this beat on, or in the drawing when no beat is shown), and the highlight
  tool colors nets for this beat on. The dot beside each beat says how the
  selection looks there; clicking it shows or hides it in that beat alone.
  Drag a beat's chip along the strip to move it. Ctrl/Cmd-click or
  Shift-click beats to pick several; Delete (or the chip's menu) then
  removes them as one undoable edit, and the menu's **Merge** turns them into
  one beat at the first of them: each object as visible as in the most
  visible of them, every switch closed that any of them closes (two switch
  phases active at once), and a net's first highlight among them. TeX phase
  names join in one formula (`$\phi_1, \phi_2$`). The other beats keep
  their look.
- **Presenting.** `Shift+F5` shows the beats full screen from the current one,
  in the editor's light or dark theme. Every beat keeps the whole drawing's
  frame, so only what changes moves.
- **Export.** The export dialog exports the whole drawing, one beat, or every
  beat: one PDF with a page per beat (`name.pdf`, vector where Chromium can
  print it, else a page of image each), and numbered SVG and PNG files
  (`name-1.svg`, `name-2.svg`, ...). All share the drawing's frame, so the
  pages and files line up.
- **Commands.** `beat list|add|rm|rename|move|merge|show|dim|hide|switch` and
  `svg --beat N`; see `help`.
