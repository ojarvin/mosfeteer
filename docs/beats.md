# Beats

A beat is one step of a figure that builds itself up: which parts and labels
it shows, which way its switches point, and which nets are highlighted. Beats
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
   terminal or a shown net label. A junction dot shows while three or more
   arms meet at it. An owned label shows with its part. A net label that no
   beat mentions shows while any part on its net shows.
5. **Switches and highlights are per beat** on top of the drawing's own
   positions and highlights, with the same carry-forward rule.

Placeholders fall out of rule 4: to stand in for a bias transistor until it
appears, put a net label (or a port) on the gate net, hide it from the beat
where the transistor appears, and the wire to it disappears with it.

## Stored form

`circuit.beats` is an ordered list. Each beat stores only its changes
relative to the beat before (the first beat is relative to the drawing):

```json
"beats": [
  { "id": "b1", "name": "Signal path", "hide": ["M3", "M4"] },
  { "id": "b2", "name": "Bias", "show": ["M3", "M4"], "hide": ["L2"] },
  { "id": "b3", "name": "Phase 2", "switches": { "S1": "closed" }, "highlights": { "name:VX": "red" } }
]
```

An object whose first entry is a `show` is hidden before it. A document
without `beats` has none. References to deleted objects are dropped on save;
renaming a part renames its references.

## Where beats appear

- **Editor.** The beat strip (More → Beats, or `B`) lists the beats. The beat
  on screen fades what it hides; faded objects stay selectable. `h` shows or
  hides the selection from this beat on, `s` flips selected switches (from
  this beat on, or in the drawing when no beat is shown), and the highlight
  tool colors nets for this beat on. The dot beside each beat says whether the
  selection shows there; clicking it changes that beat alone. `]`/`[` step.
- **Presenting.** `Shift+F5` shows the beats full screen from the current one.
  Every beat keeps the whole drawing's frame, so only what changes moves.
- **Export.** The export dialog exports the whole drawing, one beat, or every
  beat as numbered files (`name-1.svg`, `name-2.svg`, ...) that line up.
- **Commands.** `beat list|add|rm|rename|move|show|hide|switch` and
  `svg --beat N`; see `help`.
