# schematic-spawner — agent guidelines

Programmatic, agent-friendly schematic editor. Two distinct agent roles work
here. Read only the doc that matches your role.

## Pick your role

| You are… | Goal | Read |
| **Developer** agent | Improving the application itself: code quality, cohesion, features, tests, API, instructions. | [DEVELOPER.md](./DEVELOPER.md) |
| **Circuit author** agent | Drawing a circuit in the running editor for the user. | [CIRCUIT-AUTHOR.md](./CIRCUIT-AUTHOR.md) |

If the request is to draw or revise a circuit, use the circuit-author lane even
if implementation work would be possible. Read `CIRCUIT-AUTHOR.md` before
acting and obey its role contract: operate through the editor interface, touch
only the requested circuit, and do not inspect or modify application source,
tests, project configuration, or global agent configuration. If the request is
to change the editor itself, use the developer lane instead.

The two lanes are intentionally not interchangeable. The author lane follows a
two-phase placement-then-routing workflow with user review at the boundary;
the developer lane optimizes for repository changes and verification.

Both roles share the visual quality bar — see [style-guide.md](./style-guide.md).

## Repo layout

- `AGENTS.md` — current symbol geometry, label model, routing, editor
  behavior. Both roles skim it when a specific behavior matters; the developer
  keeps it accurate, the author doesn't edit it.
- `guidelines/` — role-specific docs and the style guide (this directory).
- `circuits/<name>/` — saved circuits (`circuit.json` + `circuit.svg` +
  optional `learnings.md`); the circuit author's source of truth.
- `src/core/` — pure model: `model.js` (Circuit, Component, Net, Label),
  `commands.js` (command language), `router.js` (smartRoute + A*),
  `wiring.js` (wire geometry), `render.js` (SVG), `components/` (symbols),
  `grid.js`, `geometry.js`, `ascii.js`.
- `src/web/` — HTTP server (`serve.js`) and the in-browser editor
  (`index.html`, `main.js`, `style.css`).
- `src/cli/index.js` — single-command CLI; thin HTTP client over the server.
- `test/` — Node test suite (`npm test`); current count is reported by the test runner.

## Headless server + browser

- Production: `./start.sh` (HTTP at `127.0.0.1:8080`).
- Isolated dev sessions: `PORT=<port> HOST=<host> node src/web/serve.js` plus
  `chromium --remote-debugging-port=<port>` and CDP via `Runtime.evaluate`.
- The browser polls `/api/active` and the active circuit endpoint every 500 ms.
  CLI commands set the active circuit and the browser auto-loads it; mutated
  commands persist `circuit.json` and `circuit.svg`.
