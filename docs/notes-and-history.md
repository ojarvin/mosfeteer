# Notes and save history

Two things a design carries in its own file besides the drawing: notes
about it, and the states it was saved in. Both travel with the file to
another designer; neither is ever drawn or exported with the figure.

## Notes

`Circuit#notes` is Markdown text (`notes` in the file, left out when
empty). `Shift+N`, the toolbar's Notes, More → Notes, or `:notes` shows the notes
window (`src/web/notes-window.js`): the notes rendered, or -- Edit, a
double-click, Enter -- their source, until Esc or Ctrl/Cmd+Enter, which
leave the window the keyboard (Esc again closes it). Empty
notes open ready to write. In the source, Tab indents the lines under the
caret or selection by two spaces and Shift+Tab takes up to two away (the
field's own Ctrl+Z undoes either).

The notes are document data that never go stale, like the analysis
settings: typing marks the design unsaved (`markSettingsChanged`, and
`drawingOf` in main.js leaves `notes` out of what a settings edit may not
change), each finished edit -- a one-second pause or leaving the field --
is one undo step, and an undo of anything restores the notes of its
snapshot. Scripted: `notes`, `notes set TEXT`, `notes append TEXT` (a new
line; the rest of the command line is taken as written, so TeX keeps its
backslashes), `notes clear`.

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
  click opens it. Renaming a design relinks them like part links
  (`relinkDocumentState`); one to no design is struck through.

The Atlas search reads the notes (`designIndex` keeps them as one search
key, `searchDesign` matches a word found there).

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
  when the drawing differs from the newest; scripted commands, window-state
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
**Restore** puts the drawing back as it was (one undo step; Save keeps it);
the ⋯ menu pins it as a checkpoint (named, with a comment), renames or
unpins one, or starts a **new design from it** (unsaved, no history of its
own); × removes it (a checkpoint after asking). **Checkpoint…** pins the
drawing as it is now, saving it first when it has unsaved changes;
**Remove save points** removes every unpinned entry.

Tests: `test/notes.test.js`, `test/save-history.test.js`, the history test
in `test/server-documents.test.js` and `test/browser-persistence.test.js`,
and `test/browser/notes.test.js`, `test/browser/history.test.js`.
