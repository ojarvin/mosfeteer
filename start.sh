#!/bin/sh
# Mosfeteer — double-click or run ./start.sh. Needs Node.js 18+.
# Finds Node even when a desktop session does not have your shell's PATH
# (nvm, mise, volta, fnm, Homebrew), then hands over to launch.mjs.
cd "$(dirname "$0")" || exit 1

find_node() {
  [ -n "$MOSFETEER_NODE" ] && [ -x "$MOSFETEER_NODE" ] && { echo "$MOSFETEER_NODE"; return; }
  command -v node 2>/dev/null && return
  for candidate in \
    "$HOME/.local/share/mise/shims/node" \
    "$HOME/.volta/bin/node" \
    "$HOME/.local/share/fnm/aliases/default/bin/node" \
    /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
    [ -x "$candidate" ] && { echo "$candidate"; return; }
  done
  latest=$(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -n 1)
  [ -n "$latest" ] && echo "$latest"
}

NODE=$(find_node)
if [ -z "$NODE" ]; then
  echo "Mosfeteer needs Node.js 18 or newer: https://nodejs.org/" >&2
  exit 1
fi
exec "$NODE" launch.mjs "$@"
