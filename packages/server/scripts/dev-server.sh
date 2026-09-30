#!/bin/sh
# Crash-only server (spec §7.2): after every exit, wait 1 s and start again, reloading project files from disk.
# Ctrl+C stops the loop.
trap 'exit 130' INT TERM
cd "$(dirname "$0")/.." || exit 1
while true; do
  pnpm exec tsx src/main.ts
  echo "[fm-server] exited with status $?; restarting in 1 s" >&2
  sleep 1
done
