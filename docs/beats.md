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

Placeholders fall out of rule 4: to stand in for a bias transistor until it
appears, put a net label (or a port) on the gate net, hide it from the beat
where the transistor appears, and the wire to it disappears with it.

## Growing a build

"Grow beats from here" (a part's context menu; `beat grow ID ...`) drafts
beats from a starting part or pin (`growOrder`/`growBeats` in `beats.js`):

1. **Signal path.** The start, then everything one connection further out.
   A connection leaves a part through a drain, source, output, or two-terminal
   lead, never back out of a gate, base, or input: a drain reaches the next
   stage's gate, but a gate does not reach its bias generator.
2. **Bias.** One beat per control line the shown parts hang from, in the
   order they were reached, named after the line (`Bias V_{BN}`). It brings
   what drives the line: the parts conducting on it and the stacks in series
   with them.
3. **The rest**, if anything is still unreached, together.

Supply and ground rails (a rail marker, or a net named VDD, VSS, GND, or VCM)
never count as connections. A pin or rail marker appears with the first part
on its own wire, and equation labels wait for the last beat. The result is a
set of ordinary beats, inserted after the one on screen as one undoable edit.

## Stored form

`circuit.beats` is an ordered list. Each beat stores only its changes
relative to the beat before (the first beat is relative to the drawing):

```json
"beats": [
  { "id": "b1", "name": "Signal path", "hide": ["M3", "M4"] },
  { "id": "b2", "name": "Bias", "show": ["M3", "M4"], "dim": ["M1"], "hide": ["L2"] },
  { "id": "b3", "name": "Phase 2", "switches": { "S1": "closed" }, "highlights": { "name:VX": "red" } }
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
