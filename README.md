<p align="center"><img src="docs/images/logo.svg" width="112" alt=""></p>

<h1 align="center">Mosfeteer</h1>

<p align="center">A keyboard-driven editor for textbook-style analog schematics, with auto-routed wires and symbolic small-signal analysis.</p>

![A folded-cascode OTA in the editor, split diagonally between the light and dark themes](docs/images/editor.png)

## Symbolic analysis

Pick the input and output nets to derive `Z_in`, `Z_out`, `A_v`, and any poles and zeros, simplified the way a textbook would. Hover or click any term to light up the devices it comes from, then annotate the schematic with the results.

![Derived OTA equations; the locked g_m9 r_o9 r_o8 term highlights M9 and M8 on the schematic](docs/images/analysis.png)

## Fast editing

Press `i` and type to insert a part. Wires route themselves around parts on the grid, and Design Check (`x`) catches dangling pins, overlaps, and off-grid geometry. Press `?` for every shortcut.

![Fuzzy insert picker filtered to MOS transistors, open beside the OTA](docs/images/insert.png)

| Persistent net highlights (`9`) | Right-drag a part for quick actions |
| :---: | :---: |
| ![The OTA with its V_XN, V_XP, V_OUT, and tail nets each highlighted in a different color](docs/images/highlight.png) | ![Radial menu around M9 with rotate, mirror, move, copy, and delete](docs/images/radial.png) |

## Symbols

Analog, digital, and mixed-signal symbols share one textbook style, plus resizable blocks and signal-flow nodes for block diagrams.

![A selection of passive, source, transistor, amplifier, reference, port, logic, flip-flop, and ADC symbols](docs/images/symbols.png)

## Install and run

All you need is [Node.js](https://nodejs.org/) 18 or newer. There is nothing else to install.

```sh
git clone https://github.com/ojarvin/mosfeteer.git
cd mosfeteer
./start.sh                  # or: node launch.mjs
```

The editor opens in an app-style Chromium window, or your default browser. To get a desktop launcher, run `node launch.mjs --install` once on Linux or macOS; on Windows, double-click `Mosfeteer.cmd`.

**No Node?** Open [`browser-only/index.html`](browser-only/index.html) directly. It is the same editor, using the browser's file pickers and downloads, without the CLI or PDF export.

## Documents

- Each schematic is a single `.json` file you can keep in a repository or share like any other file.
- New documents are saved to a workspace folder, `~/Documents/Schematics` by default. **Open** (Ctrl/Cmd+O) and **Save as** work with any folder.
- An open document with no unsaved changes reloads when its file changes on disk, for example after a `git pull`.
- **Export** (Ctrl/Cmd+E) writes SVG, PDF, and PNG.

## Scripting

The editor, the CLI, and the HTTP API all run the same command language:

```sh
npm run cli -- amp "add nmos M1 --at 120 120"   # edits <workspace>/amp.json
```

## Development

```sh
npm run serve   # dev server with auto-restart (http://127.0.0.1:47280/)
npm test
```

- [`AGENTS.md`](AGENTS.md): editor behavior and the symbol specification
- [`docs/circuit-spec.md`](docs/circuit-spec.md): deterministic circuit generation
- [`docs/topological-small-signal.md`](docs/topological-small-signal.md): how the analysis works
