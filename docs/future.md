# Possible future features

Ideas kept for later. Nothing here is planned or promised.

## Groups

- `Ctrl+G` groups the selection; a group selects and moves as one.
- The groups must stay visible: a list of groups and what each contains,
  and a way to see a group on the drawing.
- Ungrouping must be one step (`Ctrl+Shift+G`, and from the list).
- Open question: how groups interact with beats, arrange, and copy/paste.

## Agent window

A chat with a coding agent installed on the user's machine, working on the
open design: "draw a 5T OTA", then iterate on what it drew.

- One agent per design, one at a time. The session belongs to the open
  design; switching designs or closing the window ends it.
- Mosfeteer's server is an ACP client (Agent Client Protocol, JSON-RPC over
  stdio): it starts the agent, keeps the session open between messages, and
  relays replies, tool calls and permission requests to the window.
- The agent edits the design through a Mosfeteer MCP server handed to it
  when the session opens, bound to that design: run commands (the command
  language), read the design, render a picture of it, list symbols. No
  shell access needed.
- Each turn is one undo step; the editor saves before a turn and takes no
  edits of its own while one runs.
- Agents come from the ACP registry (`registry.json`: npx, uvx or binary
  per agent) or a custom command. Settings shows each one's state: not
  installed, needs sign-in, ready, error; a model picker from the agent's
  session config options.
- Sign-in is the agent's own; Mosfeteer never holds credentials. An API key
  works for every provider. Subscription logins depend on the vendor's
  terms (Anthropic's 2026 terms restrict Pro/Max logins in third-party
  tools and the Agent SDK); check them before offering one.
- Server mode only: the browser-only build cannot start processes.
- Before building: read the ACP spec (initialize, authentication, session
  config options; v1 now, v2 draft), the registry format, and the vendors'
  current terms.
