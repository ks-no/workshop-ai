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
# events do not propagate into the container - most commonly when running Docker
# Desktop on Windows with the project on the Windows host filesystem (C:\...).
# start.bat sets this automatically.

set -eu

ENTRY="$1"

# nodemon is a devDependency, so it only exists after `pnpm install`. start.bat
# sets WATCH_POLL=1 unconditionally, so a fresh clone on Windows used to die here
# with "not found" the moment the container started - and the service just looked
# down. Fall back to node --watch instead: file changes may not be picked up, but
# the sandbox runs, which is what the participant came for.
if [ "${WATCH_POLL:-0}" = "1" ] && [ ! -x node_modules/.bin/nodemon ]; then
    echo "dev.sh: WATCH_POLL=1, men node_modules/.bin/nodemon mangler." >&2
    echo "dev.sh: bruker node --watch. Kjør 'pnpm install' på verten for" >&2
    echo "dev.sh: automatisk omlasting av endringer på Windows." >&2
    WATCH_POLL=0
fi

if [ "${WATCH_POLL:-0}" = "1" ]; then
    # --exec node is not optional: nodemon picks an executor from the file
    # extension, and for .ts that is ts-node, which is not installed anywhere in
    # this repo. Without it every service died with "ts-node: not found" the
    # moment nodemon existed - so a Windows box that had run an install was worse
    # off than one that had not. Node 24 type-strips .ts on load; that is the
    # whole build step here, and nodemon only has to restart it.
    # Cross-service imports (including the token client) and apps/shared are
    # dependencies too. Watching apps avoids a second, stale import graph here.
    # Never watch state: a request writing a log would restart its own server.
    exec node_modules/.bin/nodemon \
        --legacy-watch \
        --exec node \
        --watch apps \
        --watch data \
        --ext js,ts,json \
        "$ENTRY"
else
    exec node --watch "$ENTRY"
fi
