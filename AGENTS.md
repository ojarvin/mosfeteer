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
This file is the short list of cross-cutting invariants. The full contracts
live in the focused docs below and, exactly, in the source and its tests;
read the one for the area you change before changing it.

| Area | Contract |
| --- | --- |
| Symbols, labels, nets, rendering, routing | [`docs/model.md`](docs/model.md) |
| Editor, persistence, keys, windows | [`docs/editor.md`](docs/editor.md) |
| Small-signal analysis | [`docs/symbolic-analysis.md`](docs/symbolic-analysis.md) |
| Signal-flow analysis, swing, optimizer | [`docs/signal-flow-analysis.md`](docs/signal-flow-analysis.md) |
| Wiring internals | [`docs/wiring-architecture.md`](docs/wiring-architecture.md) |
| Beats, linked designs, Atlas | [`docs/beats.md`](docs/beats.md), [`docs/hierarchy.md`](docs/hierarchy.md), [`docs/atlas.md`](docs/atlas.md) |

## Repository map

- `src/core/` — pure model, symbols, geometry, routing, rendering, and
  symbolic analysis.
- `src/server/` — loopback HTTP server, document I/O, settings, and export.
- `src/web/` — browser editor, persistence adapter, interaction, and styles.
- `src/cli/index.js` — thin HTTP client for scripted editing.
- `browser-only/` — the generated single-folder build (`npm run browser-only`).
- `test/` — Node test suite.
- `guidelines/` — role and visual-quality instructions.
- `docs/` — focused contracts and architecture.
- `launch.mjs`, `Mosfeteer.cmd` — launcher and its Windows double-click wrapper.

```sh
npm test                         # all Node tests
npm run serve                    # watch server at 127.0.0.1:47280
npm run browser-only             # regenerate browser-only/
curl 127.0.0.1:47280/api/symbols.svg  # every symbol, drawn live (also Learn → Symbols)
npm run cli -- amp "add nmos M1 --at 120 120"
node launch.mjs <folder-or-file> # launch with a workspace or document
```

There are no npm dependencies. `data/` and `node_modules/` are runtime/local
state and are ignored. Documents are portable `<name>.json` files; do not add
personal documents or generated server state to the repository.

## Invariants

**Model.** `GRID` is 40: component origins, terminals, wire points, and
persisted label anchors are on it. Transforms are origin-anchored and pure
(`r` clockwise, mirrors on world axes); a symbol's `defaultMirrorX/Y` applies
only when the option is omitted, so the CLI omits mirror flags the user did
not give. Symbols live in `src/core/components/` (registry `index.js`); the
routing-sensitive terminal table is in `docs/model.md` and a geometry change
needs a symbol test.

**Connectivity is topological.** Geometry is a route, not connectivity.
Crossings never connect; a solder dot (three or more arms) or a wire endpoint
does. Labels never create connectivity, and physical net IDs stay separate
when equal names make a virtual connection. Edit names through
`addNetLabel`, `renameNet`, and `renameNetLabel`, never `net.name`. Component
names and owned labels are one unique identity; a rejected duplicate never
mutates the circuit. Interactive shorts of differently named nets ask in one
picker; scripted commands never prompt and record a `netNameWarnings` entry.

**Routing preserves authored geometry.** Committed wire keeps a cell clear of
bodies; moves reroute only the legs that must change; wire edits are
transactional (one undo entry, invalid drops restore). Cross-net collinear
overlap is a Design Check error and is never auto-merged. Tidy repairs
(`src/core/tidy.js`) never guess intent.

**Rendering.** Annotations draw under wires, parts and labels above;
`drawOrder` reorders only within a category. Exports frame the ink
(`Circuit#inkBounds`). Persisted or exported text never carries provenance
markers.

**Analysis.** The small-signal GUI calls
`adaptCombinedReport(analyzeSmallSignalV2(...))`; every transfer function
and noise column comes from the one MNA solve; ambiguous selections return a
diagnostic, never a guess. Signal-flow analysis refuses rather than guesses
too. Analysis settings and slider values are document data
(`Circuit#analysisValues`): a change is `markSettingsChanged`, saved but never
stale, one undo entry per finished adjustment.

**Editor state.** `runCommand(circuit, line, io)` (`src/core/commands.js`) is
the one command language for the prompt, `window.__run`, the CLI, and the
HTTP API; a new command goes in `dispatch()` and `commandHelp()` with a
success and an error test. Beats, peek bubbles, and the trail are view
state, never geometry. What the windows show (`Circuit#windows`) is saved
with the design but never makes it unsaved and survives undo. Feature
modules reach editor state through `editor` (`editor-state.js`) and import
`main.js` only as `./main.js`.

**Persistence.** The server serializes load/run/save per document and writes
atomically; `src/server/documents.js` and `src/web/persistence.js` are the
boundary. Only `.json` files that load as a design join a workspace.

## Workflow

- Read the relevant guideline, doc, source module, and tests first.
- Every behavior change gets a focused test; `npm test` must pass.
- Rebuild `browser-only/` (`npm run browser-only`) and commit it with the
  change; `test/browser-only-build.test.js` fails on a stale build.
- Browser-visible changes need an isolated smoke check: one persistent CDP
  connection, temporary ports and directories, real mouse events for
  double-click (`clickCount: 2`), and only processes you started (never a
  broad `pkill`). `window.__circuit()`, `window.__run(command)`, and
  `window.__load(state)` serve isolated verification.
- Update this file only for durable cross-cutting invariants; put feature
  contracts in the focused docs and implementation facts in source and
  tests. Remove stale prose instead of appending.
