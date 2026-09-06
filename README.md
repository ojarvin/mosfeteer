# Schematic Spawner

Schematic Spawner is a programmatic circuit schematic editor. It combines a connectivity-aware circuit model, automatic routing, an interactive web editor, SVG rendering, and a CLI/API command interface.

![Folded-cascode OTA — light mode](docs/images/folded-cascode-ota-light.png)

![Folded-cascode OTA — dark mode](docs/images/folded-cascode-ota-dark.png)

## Quick start

```sh
npm install
npm start
```

Open the URL printed by the server. Use the editor directly, or run commands through the CLI:

```sh
npm run cli -- add nmos M1 --at 120 120
```

Run the test suite with:

```sh
npm test
```

## Project layout

- `src/core/` — circuit model, symbols, routing, and SVG renderer
- `src/web/` — browser editor and HTTP server
- `src/cli/` — command-line client
- `test/` — Node.js test suite

## Deterministic generation

The circuit-author agent translates an approved electrical request into an
explicit CircuitSpec, then uses the CLI to preview and commit a generated
circuit. The editor has no natural-language generation tool and does not invoke
an AI provider. The deterministic API and workflow are documented in
[`guidelines/CIRCUIT-AUTHOR.md`](guidelines/CIRCUIT-AUTHOR.md) and
[`docs/circuit-spec.md`](docs/circuit-spec.md).
