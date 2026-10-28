# Notes and save history

Two things a design carries in its own file besides the drawing: notes
about it, and the states it was saved in. Both travel with the file to
another designer; neither is ever drawn or exported with the figure. The
notes are the text of the design's report, below.

## Notes

`Circuit#notes` is Markdown text (`notes` in the file, left out when
empty). `Shift+N`, the toolbar's Notes, More → Notes, or `:notes` shows the notes
window (`src/web/notes-window.js`): the notes rendered, or -- Edit, a
double-click, Enter -- their source, until Esc or Ctrl/Cmd+Enter, which
leave the window the keyboard (Esc again closes it). Empty
notes open ready to write. In the source, Tab indents the lines under the
caret or selection by two spaces and Shift+Tab takes up to two away (the
field's own Ctrl+Z undoes either). Typing `[[` lists the workspace's other
designs, and `@` the design's parts and named nets (`noteCompletion`,
`src/web/notes-completion.js`): matches at the start of a name first,
narrowed as you type; a net is left out when a part of its name would win
the mention. Up/Down choose, Enter or Tab puts the choice in, Esc closes
the list only. **Copy** puts the notes on the
clipboard as plain Markdown (`notesMarkdown`): a mention as its name, in
`$...$` when it has a subscript or superscript, a design link as the
design's name; code is left as written.

A picture pasted into the source (a screenshot, a bench capture) is kept
in the design beside the notes (`Circuit#pictures`, `pictures` in the
file: PNG, JPEG, or WebP data URLs by number, compressed as a picture
pasted onto the drawing is, `storedImage`) and placed at the caret as
`![](picture:1)`; text in the brackets is its caption. The window and the
report draw it, at most their width; one placed with no picture of its
number reads struck through. Only the pictures the notes place are saved,
and an undo takes a picture back with the text that placed it. Copy puts
each picture into the Markdown as its data.

The notes are document data that never go stale, like the analysis
settings: typing marks the design unsaved (`markSettingsChanged`, and
`drawingOf` in main.js leaves `notes` out of what a settings edit may not
change), each finished edit -- a one-second pause or leaving the field --
is one undo step, and an undo of anything restores the notes of its
snapshot. Scripted: `notes`, `notes set TEXT`, `notes append TEXT` (a new
line; the rest of the command line is taken as written, so TeX keeps its
backslashes), `notes clear`, `notes markdown` (what Copy copies).

Rendering (`src/core/notes-markdown.js`, pure): `#` headings, paragraphs,
`-`/`*`/`1.` lists and `- [ ]` task lists (an item indented two spaces
more than the one before starts a sublist under it; any other line
indented past an item continues it; a tab counts as two spaces), `>` quotes, fenced code, `|`
tables, `---` rules, `**bold**`, `*italic*`, `~~struck~~`, `` `code` ``,
`[text](https://...)` links (http, https, mailto only), and `$...$` /
`$$...$$` math through the labels' own TeX (`texToMathML`). Everything else
is escaped: notes never put HTML into the page.

References (`src/core/notes.js`):

- **Mentions.** `@M1`, `@V_{out}`, or `@{a name with spaces}` names a part
  or a net of the design. Parts are found first, by name or label; nets by
  name; both compared through markup, as the Atlas search does (`@vout`
  finds `V_{out}`, and `@VDD` finds the supply part VDD before the net
  `V_{DD}`). A mention that finds nothing is drawn struck through. Hovering
  one glows its part or net on the canvas; a click selects it.
  `Circuit#renameComponent` and `#renameNet` rewrite the mentions of what
  they rename in the same undo step -- a net's once no other net keeps the
  old name -- except inside code.
- **Design links.** `[[amp]]` names another design of the workspace; a
  click opens it, and its right-click menu also shows it in a reference
  window (the one showing it already, else an empty one, else a new one;
  `showDesignInReference`). Renaming a design relinks them like part links
  (`relinkDocumentState`); one to no design is struck through, and Design
  Check and the Atlas's Check list it with the broken links
  ([`hierarchy.md`](hierarchy.md)).

The Atlas search reads the notes (`designIndex` keeps them as one search
key, `searchDesign` matches a word found there).

## Report

The notes are also the text of the design's report (`src/core/report.js`,
`buildReport`): a printable HTML document, and the PDF the server prints
from it with headless Chromium (`printHtmlToPdf`). The export dialog's
**Report** (or the notes window's **Report…**) writes it as PDF and HTML;
browser-only mode writes the HTML, which prints from the browser. Scripted:
`report [--file F.html] [--guide G] [--name TITLE]` lists its figures and
warnings, and writes the HTML.

- **Figures.** A line that is only `![[target]]` or `![[target|caption]]`
  (a quote's lines too, never code) places a figure, numbered `Fig. N` in
  the order the notes place them (`noteFigures`). A target is `circuit`
  (the drawing without the figures the tools annotated, as `coreBounds`
  counts it), `drawing` (all of it), `beat N` (the circuit as that beat
  shows it), or an annotated figure's id (`F2`, `timing`; the `figures`
  command lists them). An embed inside a line stays text. Typing `![[`
  offers the targets.
- **Sections.** `![[amp]]` on a line of its own, naming another design of
  the workspace (and no figure of this one), puts that design's notes there
  as a section: its `#` heading a level below the heading the embed stands
  under (the title's when none; its name when it has no `#` heading),
  its own figures, mentions and references, its figures numbered on from
  the report's, and its citations in the report's one list. Sections nest.
  A design is one section, where the report first embeds it: embedding it
  again, or the report's own design, reads "See amp", and a design link
  `[[amp]]` links to its section. A design whose notes place nothing is its
  circuit. Renaming a design follows into the embeds (`relinkNotes`). The
  editor reads the designs from the workspace; the server gives the `report`
  command every design of the workspace (`embeddedDesignNames`).
- **References.** `[[#target]]` reads `Fig. N`, a link to the first figure
  of that target; one to no figure reads `Fig. ?` and is a warning. Typing
  `[[#` offers the targets. A mention links to the first figure that shows
  its part or net; a design link is the design's name.
- **Citations.** `[^https://...]`, `[^doi:10.1000/xyz]` (through
  doi.org), or `[^source|title]` reads `[N]`, numbered by first use; one
  source (as written, case aside) is one number, its title the first one
  given. A source that is no web address (a book) is listed as its text,
  with no link. The notes, in the window and the report, end with the
  numbered References list; a click on `[N]` goes to its entry. Copy puts
  `[N]` and the list in the Markdown (`noteCitations`).
- **Contents.** A `[TOC]` line (any case, never in code) puts the contents
  there and numbers the headings (1, 1.1, ...): every heading but the title
  (a `#` heading the notes start with), References included. Each entry
  links to its heading. One contents: the first
  `[TOC]` (`numberSections`); notes without one are not numbered. In a
  report the numbering runs through the included designs' sections, whose
  own `[TOC]` lines are dropped.
- **Outline.** Empty notes can start as a report: the notes window's
  **Outline** (shown while the notes are empty) or `notes outline` writes a
  heading, a `[TOC]`, a Circuit section, an Operation section (the timing diagram, a figure a
  beat), an Analysis section (the annotated equations, models, plots, and
  noise tables), a Sizing section (the parts tables), and a Blocks section
  embedding each design its parts link to, once, each figure with a
  caption and each section with a line to replace (`notesOutline`). Only
  what the drawing has is placed: an analysis is in it once annotated.
  One undo step; written notes are never replaced.
- **Example.** Learn → Tutorial → **Report example** opens a first-order
  delta-sigma modulator as a new, unsaved design
  (`src/web/examples/report-example.js`); its integrator links to a
  switched-capacitor integrator with correlated level shifting, whose notes
  are a section of the modulator's report. No file is written: while the
  workspace has no design of its name, the integrator is known -- to the
  link and its peek, the notes, the report -- from the bundle
  (`src/web/example-designs.js`, an `example:` path), and opening it opens
  it unsaved. Saving the modulator saves the integrator beside it; one
  already there is left as it is.
- **In the notes window** a figure shows as its number, target, and caption,
  its target in red when there is nothing of that name to draw.
- **Sizes.** Every figure is drawn at the page guide's width (the A4 one
  without a guide), centered: one narrower than the guide is padded to it,
  so its text is the guide's size; one wider is fitted to it, its text
  smaller, and the report warns. The page is A4 with 25 mm margins, its side
  margins narrowing (to 12 mm) for a guide wider than 16 cm; a figure wider
  or taller than the page is scaled to fit, with the same warning. A plot
  is drawn again for the report (a copy; the drawing is left as it is), its
  box resized in its own proportions to three fifths of the guide's width
  (narrower where its legend would reach past the guide), its legend
  beside it, with its own text -- ticks, axis names, legend -- at the
  guide's size; on the canvas a plot's text is smaller than the labels'.
- **Layout.** The notes' `#` heading titles the report; without one the
  design's name does. Notes that place no figure get the whole drawing on
  top, unnumbered. Headings stay with what follows, figures are never split
  across pages, and pages are numbered.

## Save history

A design's file keeps its save history (`history`, `src/core/save-history.js`):
the drawing as it was at each of the last ten Saves (save points), and any
of them pinned under a name and a comment as a checkpoint that is never
rotated out.

- **What a save point is.** `historyText(state)`: the document without its
  history, windows, saved names, and tags, one JSON value a line. Notes and
  analysis settings are in it; restoring a save point brings them back. Math
  labels (and aligned plain annotations) keep their measured size (`mathBox`), so a save point viewed
  outside the editor lays its math out as the editor did; a label merely
  measured again is no change of drawing (no new save point).
- **Storage.** Entries newest first, each a line patch from the entry before
  it -- the newest from the file's own drawing -- with the hash of its text;
  the history has the hash of the text its newest patch starts from
  (`base`). Ten save points of a 240 KB design take about 5 KB.
- **Every writer carries it.** Whatever writes a document file passes the
  state through `settledHistory` with the file's previous contents: the
  server's `PUT /api/document` and command runs (`src/server/app.js`), and
  the browser-only adapter (`src/web/persistence.js`). The chain is read
  against the previous file, the state as sent, or a base text the editor
  sends (`historyBase`: a design saved under a new name, or first saved
  from a dropped file); failing those, the file's own history if it fits;
  failing both, the history is written as it came -- never applied, never
  dropped. A history that fits no text (the file edited outside the
  editor) stays unreadable rather than guessed at, until the history window's
  **Remove it and start afresh** takes it out.
- **Save points.** Only the editor's Save (`savePoint`) adds one, and only
  when the history does not hold the drawing already; scripted commands, window-state
  writes, and tag or relink rewrites carry the history over without one.
  The oldest unpinned entries beyond ten go; pinned ones stay.
- **Not drawing.** `Circuit#history` is stored as read and never makes the
  design unsaved (`drawingText` in document-session.js). Undo, redo, and a
  preview transaction keep it as it is (`applyJson`, like the windows'
  state); the editor takes the history each write returns.

More → History, or `:history`, shows the history window
(`src/web/history-window.js`), which reads the history from the file each
time it shows it or the file changes, and writes every change straight to
the file -- unsaved drawing edits stay unsaved. Per entry: **View** shows it
in a reference window (read-only, not remembered with the windows);
**Restore** puts the drawing back as it was and writes it to the file with
no save point of its own, so the entry is marked as the file's and nothing
is left to save (one undo step; a drawing the file had that is in no entry
becomes a save point first);
the ⋯ menu pins it as a checkpoint (named, with a comment), renames or
unpins one, or starts a **new design from it** (unsaved, no history of its
own); × removes it (a checkpoint after asking). **Checkpoint…** pins the
drawing as it is now, saving it first when it has unsaved changes;
**Remove save points** removes every unpinned entry.

Scripted (`history`, `src/core/commands.js`; the CLI and HTTP, run on the
file): `history [list]`; `history checkpoint [NAME] [--comment TEXT]` pins
the drawing; `history pin ENTRY [NAME] [--comment TEXT]` pins or renames
one, `history unpin`, `remove`, and `restore ENTRY` -- ENTRY an id or a
checkpoint's name. A restore keeps the drawing it replaces as a save point
when it is none yet, as the window's does. A history that fits no drawing
is refused. In the editor, where the drawing may be ahead of its file, a
`history` command with arguments points to the window instead.

Tests: `test/notes.test.js`, `test/save-history.test.js`, the history test
in `test/server-documents.test.js` and `test/browser-persistence.test.js`,
and `test/browser/notes.test.js`, `test/browser/history.test.js`.
