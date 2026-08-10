#!/usr/bin/env bash
# One command to try this branch in the Mac app.
#
# The Mac client is a native window around the web app, so trying a change
# means running both. Doing that by hand is two terminals and an ordering rule
# (server first, or the client shows the live site's sign-in page and looks
# broken), which is friction in front of the only question that matters: does
# the thing work.
#
# This starts the web server, waits for it, opens the app, and takes both down
# together when you press Ctrl-C.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${PORT:-3000}"
ORIGIN="http://localhost:${PORT}"
cd "$ROOT"

if curl -fsS -o /dev/null --max-time 2 "$ORIGIN" 2>/dev/null; then
  echo "Using the server already running on ${ORIGIN}."
  STARTED_SERVER=0
else
  echo "Starting the web app on ${ORIGIN} ..."
  npm run dev -- --port "$PORT" >/tmp/texttext-dev-server.log 2>&1 &
  SERVER_PID=$!
  STARTED_SERVER=1
  # Take the server down with the app, so Ctrl-C leaves nothing behind.
  trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT INT TERM
fi

printf 'waiting for the web app '
for _ in $(seq 1 90); do
  if curl -fsS -o /dev/null --max-time 2 "$ORIGIN" 2>/dev/null; then
    printf '\nweb app is up\n'
    echo "Building and opening the Mac app. First build takes a minute."
    TEXTTEXT_SERVER="$ORIGIN" TEXTTEXT_DEV_NO_MOVE=1 \
      swift run --package-path "$ROOT/mac" TextTextApp
    exit 0
  fi
  printf '.'
  sleep 1
done

printf '\n'
if [ "${STARTED_SERVER}" = "1" ]; then
  echo "The web app did not start. Its log:" >&2
  tail -30 /tmp/texttext-dev-server.log >&2
else
  echo "${ORIGIN} stopped answering." >&2
fi
exit 1
