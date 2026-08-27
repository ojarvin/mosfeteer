#!/usr/bin/env bash
# schematic-spawner — start the web client and open it in your browser.
# Usage: ./start.sh   (project root). Ctrl-C stops the server.
set -euo pipefail
cd "$(dirname "$0")"

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8080}"
URL="http://${HOST}:${PORT}/"

open_url() {
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL" >/dev/null 2>&1 &
  elif command -v open >/dev/null 2>&1; then
    open "$URL" >/dev/null 2>&1 &
  elif command -v sensible-browser >/dev/null 2>&1; then
    sensible-browser "$URL" >/dev/null 2>&1 &
  fi
}

# If our server is already up, just open the browser.
if curl -s -m 1 -o /dev/null -w '%{redirect_url}' "$URL" 2>/dev/null | grep -q 'src/web/index.html'; then
  echo "schematic-spawner already running at $URL — opening browser."
  open_url
  exit 0
fi

echo "Starting schematic-spawner at $URL (Ctrl-C to stop)"
(sleep 1; open_url) &
exec node src/web/serve.js