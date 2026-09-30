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

**Beats from switch phases** (More menu; `beat phases`) adds one beat per
phase, in the order the phases were first drawn, named after the phase. Each
closes that phase's switches and opens every other phase's -- a complement is
closed wherever its phase is open -- and shows the
phase's equivalent circuit: the open switches are dimmed, and the rest splits
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

**Timing diagram** (More menu; `timing`) draws one row per phase under the
drawing, in the phases' order with each complement right after its phase:
the phase's name as a free label, right-aligned in a column left of the
waves, and its wave, two cells tall with vertical edges. A wave is typed as
slots, one character each: `1` high, `0` low, `x` don't care (a crossed
band); a short wave holds its last level. The waves repeat, so each row shows
half a slot of its last level before the start and of its first after the
end, where its transitions are. With **Non-overlap gaps** (on unless turned
off), every slot boundary where some phase changes gets a one-cell gap in
every row: a phase falling there has already fallen and one rising has not
yet risen, so no two phases are high at once.

The menu item opens a form that stays open beside the drawing: one field per
phase, started from the diagram already drawn, else from the beats (one slot
per beat, high where the phase's switches are closed; **Fill from beats**
refills it), with the slot width in cells and the gaps. **Draw** (Enter)
draws the diagram, or redraws it where its waves start, and the waves can be
changed again. A complement left empty is its phase inverted -- high in the
gaps -- and keeps following it; any other phase left empty is low. The
command takes the same waves: `timing φ1=10 φ2=01 --slot 2`, a phase named
by its text, TeX, row number, or `~φ1` for its complement; rows not named
keep their waves, `--beats` retakes them from the beats, and `--no-gaps` /
`--gaps` set the gaps.

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

- **Editor.** The beat strip starts closed, showing the whole drawing;
  `Shift+B` (or More → Beats) shows it, and `+` adds a
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
