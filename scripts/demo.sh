#!/usr/bin/env bash
# Demo: the collaboration server (crash-only restart loop, spec §7.2) plus the web app.
# Ctrl+C stops both.
set -euo pipefail
cd "$(dirname "$0")/.."

export VITE_SERVER_URL="${VITE_SERVER_URL:-ws://localhost:8787}"

cleanup() {
  trap - INT TERM EXIT
  kill 0 2>/dev/null || true   # every process in this script's process group
}
trap cleanup INT TERM EXIT

pnpm dev:server &
pnpm dev &

echo
echo "  Server: $VITE_SERVER_URL"
echo "  Alice:  http://localhost:5173/?name=Alice"
echo "  Bob:    http://localhost:5173/?name=Bob"
echo

wait
