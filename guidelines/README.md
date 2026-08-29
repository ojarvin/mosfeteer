# schematic-spawner — agent guidelines

Programmatic, agent-friendly schematic editor. Two distinct agent roles work
here. Read only the doc that matches your role.

## Pick your role

| You are… | Goal | Read |
|---|---|---|
| **Developer** agent | Improving the application itself: code quality, cohesion, features, tests, API, instructions. | [DEVELOPER.md](./DEVELOPER.md) |
| **Circuit author** agent | Drawing a circuit using the running editor. The user watches you work and gives feedback. | [CIRCUIT-AUTHOR.md](./CIRCUIT-AUTHOR.md) |

If you are asked to draw a circuit, you are a circuit author — even if you are
also capable of code work. The split exists so the circuit-author loop stays
fast (one CLI call per edit, no code spelunking) and the developer loop stays
structural (refactor, review, document). Don't blur the roles in one session.

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
- `test/` — Node test suite (`npm test`); 133/133 green is the bar.

## Headless server + browser

- Production: `./start.sh` (HTTP at `127.0.0.1:8080`).
- Isolated dev sessions: `PORT=<port> HOST=<host> node src/web/serve.js` plus
  `chromium --remote-debugging-port=<port>` and CDP via `Runtime.evaluate`.
- The browser polls `/api/circuits/<name>` every 500 ms and re-fits the view
  on any change. Any tool that writes `circuits/<name>/circuit.json` shows up
  live — including the CLI.
