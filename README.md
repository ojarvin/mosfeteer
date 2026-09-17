# Schematic Spawner

A keyboard-driven editor for textbook-style analog schematics and block diagrams, with auto-routed wires, symbolic small-signal analysis, and a CLI/HTTP interface for scripts and agents.

![Editor with a folded-cascode OTA](docs/images/editor.png)

## Symbolic small-signal analysis

Pick input and output nets, and it derives `Z_in`, `Z_out`, `A_v`, poles, and zeros using textbook approximations. You can annotate the schematic with the results.

![Small-signal analysis dock](docs/images/analysis.png)

## Fast editing

| Fuzzy insert with symbol previews | Right-click actions and per-device overrides |
| :---: | :---: |
| ![Insert picker](docs/images/insert.png) | ![Context menu](docs/images/context-menu.png) |

Press `?` in the editor for the full keyboard reference.

## Symbols

![All available symbols](docs/images/symbols.png)

## Quick start

```sh
npm install
npm run desktop   # Electron app (Linux, macOS)
npm start         # browser + HTTP API for CLI/agent automation
npm test
```

Scripted editing goes through the CLI, for example `npm run cli -- add nmos M1 --at 120 120`.

## More

- [`AGENTS.md`](AGENTS.md): editor behavior and symbol specification
- [`docs/circuit-spec.md`](docs/circuit-spec.md): deterministic circuit generation
- [`docs/topological-small-signal.md`](docs/topological-small-signal.md): how the analysis works
- [`docs/block-diagram.md`](docs/block-diagram.md): block diagrams
