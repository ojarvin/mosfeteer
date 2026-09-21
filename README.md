<p align="center"><img src="docs/images/logo.svg" width="112" alt=""></p>

<h1 align="center">Mosfeteer</h1>

A keyboard-driven editor for textbook-style analog schematics, with auto-routed wires, symbolic small-signal analysis, and a CLI/HTTP interface for scripts and agents.

![Fitted folded-cascode OTA in the editor, with a bottom-left to top-right diagonal separating light and dark themes](docs/images/editor.png)

## Symbolic small-signal analysis

Pick input and output nets, and it derives `Z_in`, `Z_out`, `A_v`, poles, and zeros using textbook approximations. You can annotate the schematic with the results.

![Folded-cascode OTA and highlighted symbolic analysis equations in dark mode](docs/images/analysis.png)

## Fast editing

| Fuzzy insert with symbol previews | Right-click actions and per-device overrides |
| :---: | :---: |
| ![Highlighted fuzzy insert picker with live MOS symbol previews in light mode](docs/images/insert.png) | ![Highlighted per-device small-signal actions on the folded-cascode OTA in dark mode](docs/images/context-menu.png) |

Press `?` in the editor for the full keyboard reference.

## Symbols

The built-in symbol library covers analog and digital circuits in a consistent textbook style.

![Complete symbols reference sheet in light mode](docs/images/symbols.png)

## Install and run

The only requirement is [Node.js](https://nodejs.org/) 18 or newer. There are no packages to install.

```sh
git clone https://github.com/ojarvin/mosfeteer.git
cd mosfeteer
./start.sh                  # or: node launch.mjs
```

To start it by double-clicking instead:

- **Linux:** run `node launch.mjs --install` once. *Mosfeteer* then appears in your application launcher.
- **macOS:** double-click `Mosfeteer.command`, or run `node launch.mjs --install` once to add *Mosfeteer* to `~/Applications`.
- **Windows:** double-click `Mosfeteer.cmd`.

The launcher starts a small local server and opens the editor in an app-style Chromium window, or in your default browser if Chromium isn't installed. The server only accepts requests from the editor on your own machine. It stops by itself shortly after you close the last editor window. Launching again while it's running reuses the same server.

### Browser-only release

The checked-in `browser-only/` folder is a static release that does not need
Node, npm, or a local server. Double-click [`browser-only/index.html`](browser-only/index.html)
to open it in a browser. Open and Save use browser file pickers/downloads;
documents are cached locally for the document list, and **Forget from browser…**
removes a stale cached entry without deleting a downloaded file. SVG export
downloads directly; PNG export uses the browser's save picker when available. The CLI,
server workspace browser, live file sync, and PDF export are intentionally
omitted in this mode.

Developers can regenerate the release with `node scripts/build_browser_only.mjs`
(or `npm run browser-only`).

## Documents and sharing

Each schematic is one self-contained `.json` file. You can keep it anywhere and send it to anyone.

- **Workspace folder:** the document list shows this folder, and new documents are saved into it. The default is `~/Documents/Schematics`. Change it from the **⋯** menu, or start with `node launch.mjs <folder>`.
- **Open file…** (Ctrl/Cmd+O) and **Save as…** (Ctrl/Cmd+Shift+S) work with any folder, such as a project repository or a shared drive. Files opened from outside the workspace are listed under *Recent elsewhere*.
- **Drop** a `.json` file (for example, an email attachment) onto the window to open a copy. Saving it puts the copy in your workspace.
- If a file changes on disk (for example, after `git pull` or an edit by a coworker on a shared drive), an open document with no unsaved changes reloads automatically.
- `node launch.mjs path/to/amp.json` opens a document directly.
- **Export** writes SVG, PDF, and 3× PNG files into a folder you choose (by default, your OS Pictures folder in Node mode). Press Ctrl/Cmd+E to open the export dialog. PDFs are vector files printed by a Chrome, Chromium, Edge, or Brave install found on your machine; without one, the PDF contains the high-resolution image instead.

## Development

```sh
npm run serve   # dev server with auto-restart on source changes (http://127.0.0.1:47280/)
npm run symbols # regenerate the symbols reference document through the running server
npm test
```

Scripted editing goes through the CLI against a running server, for example `npm run cli -- amp "add nmos M1 --at 120 120"`. Here `amp` is `<workspace>/amp.json`.

## More

- [`AGENTS.md`](AGENTS.md): editor behavior and symbol specification
- [`docs/circuit-spec.md`](docs/circuit-spec.md): deterministic circuit generation
- [`docs/topological-small-signal.md`](docs/topological-small-signal.md): how the analysis works
