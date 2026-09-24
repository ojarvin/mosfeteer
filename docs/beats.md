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
   Wire that joins only dimmed parts is dimmed too.
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

- **Editor.** `Shift+B` (or More → Beats) shows the beat strip; `+` adds a
  beat after the one on screen. `Alt+→`/`Alt+←` or PageDown/PageUp step
  through them, stopping at either end; before the first is the whole
  drawing. The beat on screen draws what it dims faint and what it hides
  fainter still; both stay selectable. `h` hides the selection from this beat
  on (or shows it again), `Shift+H` dims it, `s` flips selected switches (from
  this beat on, or in the drawing when no beat is shown), and the highlight
  tool colors nets for this beat on. The dot beside each beat says how the
  selection looks there; clicking it shows or hides it in that beat alone.
- **Presenting.** `Shift+F5` shows the beats full screen from the current one,
  in the editor's light or dark theme. Every beat keeps the whole drawing's
  frame, so only what changes moves.
- **Export.** The export dialog exports the whole drawing, one beat, or every
  beat as numbered files (`name-1.svg`, `name-2.svg`, ...) that line up.
- **Commands.** `beat list|add|rm|rename|move|show|dim|hide|switch` and
  `svg --beat N`; see `help`.
