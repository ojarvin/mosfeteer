# Developer Guide

You are improving the application itself: code quality, cohesion, features,
tests, API surface, and the agent-facing documentation. This doc is your
operating manual.

For the **circuit-author** role (drawing circuits), see
[CIRCUIT-AUTHOR.md](./CIRCUIT-AUTHOR.md). For visual quality, see
[style-guide.md](./style-guide.md). For current behavior details (symbol
geometry, label model, router specifics, editor hotkeys), see `AGENTS.md`.

## Mission

Make schematic-spawner better for the next agent on the same project — and the
one after that. Your work should leave the codebase a little easier to
understand and a little faster to use than you found it.

- **Quality over churn.** Don't rename things for taste. Don't refactor what
  isn't broken. Don't add features nobody asked for.
- **Cohesion over cleverness.** A single, predictable path beats five clever
  ones. When you add a feature, integrate it into the existing command
  language, API, or symbol set — don't fork a parallel interface.
- **Tests travel with code.** A change without a test for the new behavior is
  not done. A change that breaks an existing test is not done.
- **AGENTS.md is the live spec.** If you change a symbol, a routing rule, or
  an editor behavior, update `AGENTS.md` in the same commit so future agents
  see truth, not folklore.

## Architecture

```
src/
├── core/
│   ├── model.js        Circuit, Component, Net, LabelInstance. Pure data + ops.
│   ├── commands.js     Command language (runCommand). One entry point for
│   │                   the editor, the CLI, and any future API.
│   ├── router.js       smartRoute + astar fallback; pin escapes; clearance.
│   ├── wiring.js       Wire geometry, branch joining, normalizePath.
│   ├── wireedit.js     Wire drag/edit primitives.
│   ├── render.js       SVG renderer (svgString).
│   ├── ascii.js        Coarse ASCII preview.
│   ├── circuitSpec.js  Versioned generator-facing topology contract.
│   ├── semantic.js     Pure checks for declared analog intent.
│   ├── generator.js    Topology compiler and placement facades.
│   ├── placement.js    Phase 2 deterministic analog placer.
│   ├── routing.js      Phase 3 deterministic batch router.
│   ├── components/
│   │   ├── index.js    Symbol registry: getSymbol(type), symbolTypeNames.
│   │   ├── nmos.js …   One file per symbol. Each exports a factory returning
│   │                   { def: { terminals, bbox, graphics, labelOffset, ... } }.
│   │   └── variable.js Composed symbols (variable_resistor/cap/inductor).
│   ├── grid.js         GRID = 40; snap/ceilGrid.
│   ├── geometry.js     bbox/transform helpers.
│   └── style.js        Stroke roles (symbol/wire/emph/ground/supply) and font attrs.
├── web/
│   ├── serve.js        Static + HTTP API (circuits, commands, generation).
│   ├── persistence.js  Desktop preload or browser HTTP persistence adapter.
│   ├── index.html      Single-page app entry.
│   ├── main.js         Editor (input, render, undo/redo, ghost, wire drag).
│   └── style.css       Layout, dark mode, toolbars.
├── desktop/
│   ├── main.js         Electron app lifecycle and IPC handlers.
│   ├── preload.cjs     Narrow renderer-to-main storage bridge.
│   └── storage.js      Secure Linux/macOS native workspace storage.
└── cli/
    └── index.js        Thin HTTP client over command and generation endpoints.
test/                   Node test runner (`node --test`).
fixtures/circuit-spec/  Topology-only CircuitSpec examples.
circuits/<name>/        Saved user circuits (gitignored).
guidelines/             Role docs + style guide.
AGENTS.md               Current runtime behavior spec (live doc — maintain it).
```

### Labels and physical nets

`LabelInstance` has exactly three roles: an owned instance label with an
`owner` refdes and local `offset`; a persistent electrical label with a
`netId`; or a free annotation with neither `owner` nor `netId`. A `netId` is a
physical net identity. Equal canonical names group nets logically for naming
and reporting, but do not connect their geometry or terminals.

Use `addNetLabel`, `renameNet`, and `renameNetLabel` for electrical-label and
net-name changes; do not write `net.name` from editor code. Net-label text is
derived from its physical net name, and removing one occurrence leaves the net
and its name intact. Net labels are placed on drawable wire paths; the editor's
`L` tool requires an unambiguous physical wire, using one selected/highlighted
net to resolve a crossing. `Shift+N` places one free annotation and then
returns to selection; `a` and `b` likewise place one arrow or box annotation.

Selection, movement, deletion, routing, and Check must preserve the role: owned
labels follow components, net labels remain on their paths, and annotations are
independent. Complete copied physical nets carry their net labels through paste
with fresh IDs and translated anchors; a net label must never become an
annotation.

### Three entry points, one command language

`runCommand(circuit, line, io)` in `src/core/commands.js` is the single editing path. The editor command prompt, `window.__run`, CLI, and `POST /api/circuits/<name>/cmd` all call it. Add new commands to `dispatch` and `commandHelp()` so every entry point exposes them.

### State vs. file I/O

`runCommand` accepts an optional `io` object (`writeTextFile`, `readTextFile`,
`rasterize`). The HTTP path passes nothing: the server does its own saving on
every mutated result. The CLI also passes nothing; saving is the server's job.
Local file I/O remains available for the standalone `node src/cli/index.js`
tool only when explicitly given an `io` (rare — most operations should go
through the server).

## Workflow

1. **Read AGENTS.md first.** It's the spec. Out-of-date sections are bugs.
2. **Read the relevant source.** Don't guess — open the file and the test.
3. **Plan in one paragraph.** "I will change X by doing Y because Z."
4. **Write the test first (or alongside) when adding behavior.**
5. **Run `npm test`** and confirm green before commit.
6. **Browser-verify when the change is user-visible.** The CDP harness lives
   in `/tmp/opencode/`; see "Headless verification" below.
7. **Update AGENTS.md** if a symbol, command, or behavior changed.
8. **Update guidelines/** if the change shifts role expectations or the style
   guide. A new command goes in CIRCUIT-AUTHOR's command reference; a new
   layout rule goes in style-guide.md.

### When to touch which doc

| Change | Touch |
|---|---|
| Symbol geometry, terminal names, bbox | `AGENTS.md` + add/update component test |
| Command language change | `CIRCUIT-AUTHOR.md` command reference + `commands.js#commandHelp()` |
| New HTTP route or CLI flag | `CIRCUIT-AUTHOR.md` (where the user sees it) |
| Routing rule or geometry rule | `AGENTS.md` (current behavior) + `style-guide.md` if it changes the visual standard |
| Workflow / role split change | The relevant role doc |
| Editor hotkey | `AGENTS.md` ("Web UI" section) |

## Tests

`npm test` runs the Node test runner over `test/**/*.test.js`. Tests use plain
`node --test`; no Jest or transpilation. JSON fixtures live under
`fixtures/`. Read one existing `test/<thing>.test.js` before writing a new one.

Add a test for any new behavior, any new command, any new symbol, and any
edge case in `Circuit` that you touch. If a test would be slow, factor the
behavior into a pure helper and test the helper.

When you fix a bug, write the failing test first, watch it fail, then fix.

## Adding a new symbol

1. Create `src/core/components/<name>.js` exporting a factory:

   ```js
   export function my_symbol() {
     return {
       def: {
         refPrefix: 'X',                  // optional; auto-refdes base
         terminals: [
           { name: 'a', x: -80, y: 0,  dir: { x: -1, y: 0 } },
           { name: 'b', x: 80,  y: 0,  dir: { x:  1, y: 0 } },
         ],
         bbox: { x: -80, y: -40, w: 160, h: 80 },
         graphics: [
           // { kind:'line'|'polyline'|'polygon'|'circle'|'text'|'arc', ... }
           // style: 'symbol' | 'wire' | 'emph' | 'ground' | 'supply' | 'LINE' | 'THICK'
         ],
         labelOffset: { x: 0, y: 80 },   // one-square label gap, grid-snapped
         refPos: null,                   // owned label auto-created
       },
     };
   }
   ```

2. Register it in `src/core/components/index.js`.
3. Confirm it appears in `symbolTypeNames()` and `getSymbol(type)`.
4. Add a test in `test/components.test.js` (or a new file): symbol builds,
   `bboxWorld()` correct, terminals snap to grid, instance label auto-creates.
5. Add a CDP smoke test in `/tmp/opencode/` if the symbol has user-visible
   quirks (e.g. mirror defaults).
6. Update `AGENTS.md` symbol geometry table + `style-guide.md` reference
   table.

`Circuit.fromJSON` intentionally rejects types absent from the registry: the
model and renderer require a real symbol definition. `npm start` and
`npm run serve` run the server in Node watch mode, so changing the imported
registry restarts it automatically. A server started directly with
`node src/web/serve.js` must be restarted after symbol-source changes.

## Adding a new CLI command or HTTP route

The command language lives in `src/core/commands.js`. Every command:

1. Has a parser entry in `dispatch()` that returns `{ text, json, mutated }`.
2. Is documented in `commandHelp()` (which the CLI prints on `help`).
3. Has a test in `test/commands.test.js` covering the happy path + at least
   one error case.

For a **new HTTP route** in `src/web/serve.js`, follow the existing patterns
in `handleCircuitApi`: parse the URL, validate the path, read/write through
`Circuit.fromJSON`/`toJSON`, return JSON. Reject anything that doesn't match
the `^[A-Za-z0-9][A-Za-z0-9_-]*$` name pattern. Never serve files outside
`ROOT`.

For a **new CLI flag**, edit `src/cli/index.js` and update the help text. CLI
flags are the user's only view of the CLI surface — keep them honest.

## Headless verification (CDP)

The headless tests live outside the repo and use no flaky network.
The pattern is:

```js
// 1. launch debug chromium on a unique port
// 2. start the server on a unique port (PORT=... node src/web/serve.js)
// 3. open one persistent CDP connection per session
// 4. drive via Runtime.evaluate: window.__run('add nmos M1 --at 120 120')
// 5. assert via window.__circuit() or DOM state
// 6. close cleanly (no pkill of the parent shell pattern)
```

Headless **never fires native `dblclick`**. Use real
`Input.dispatchMouseEvent` with `clickCount: 2`. Inline editors are
`input[style*="position: absolute"]`. Ctrl+A =
`keyDown('a', { modifiers: MOD, code: 'KeyA', keyCode: 65 })`.

See `/tmp/opencode/` for existing examples (`mos_label_test.mjs`,
`feature_test.mjs`, `ghost_test.mjs`, `wiredrag_test.mjs`).

## Style & code quality

- **Pure functions where possible.** `Circuit` ops that take a `circuit`
  argument (vs. methods) are easier to test and easier to reason about.
- **Small, named helpers.** If a function fits on one screen and has a name,
  it's done.
- **No defensive `try/catch` around model code.** Errors should bubble — the
  command language surfaces them with file/line context.
- **Comments explain why, not what.** If a comment restates the code, delete
  it. If a comment explains a non-obvious invariant or trade-off, keep it.
- **One style per file.** Match surrounding code; if the file uses tabs,
  use tabs; if `const`, then `const`.
- **Don't fight `eval`.** It is the single source of truth for "is this
  drawing OK?". Add a new violation category there, don't paper over it in
  the renderer.

## Debugging

- `node --inspect-brk src/web/serve.js` for the server.
- The editor exposes `window.__circuit()` (returns `{ comps, nets, labels }`)
  and `window.__run(cmd)` from the dev console.
- `window.__load(state)` overwrites the visible circuit — useful for
  reproducing a bug from a saved `circuit.json`.
- The browser polls `circuit.json` every 500 ms; writing a file from
  outside the editor shows up live.
