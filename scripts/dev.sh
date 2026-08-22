#!/bin/sh
#
# Cross-platform dev watcher for volume-mounted Node services inside Docker.
#
# Usage: dev.sh <entry-file>
#
# By default uses "node --watch" which relies on inotify and works correctly on:
#   - Linux hosts (native inotify on bind mounts)
#   - macOS Docker Desktop 4.15+ with VirtioFS (default since late 2023)
#   - Windows hosts with the project stored in the WSL2 filesystem
#
# Set WATCH_POLL=1 to switch to nodemon polling instead. Use this when inotify
# events do not propagate into the container — most commonly when running Docker
# Desktop on Windows with the project on the Windows host filesystem (C:\...).
# start.bat sets this automatically.

set -eu

ENTRY="$1"
WATCH_DIR="$(dirname "$ENTRY")"

if [ "${WATCH_POLL:-0}" = "1" ]; then
    exec node_modules/.bin/nodemon \
        --legacy-watch \
        --watch "$WATCH_DIR" \
        --watch data \
        --ext js,ts,json \
        "$ENTRY"
else
    exec node --watch "$ENTRY"
fi

