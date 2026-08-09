#!/usr/bin/env bash
# Launch the Mac client against a local server.
#
# The client is a native window around the web app, so it needs the web app
# running. Starting it too early, or with no server at all, used to look
# exactly like the app being broken: it fell through to the product origin and
# showed a sign-in page from the live site. This waits, and says what it is
# talking to.
set -euo pipefail

ORIGIN="${TEXTTEXT_SERVER:-http://localhost:3000}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

printf 'waiting for %s ' "$ORIGIN"
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null --max-time 2 "$ORIGIN" 2>/dev/null; then
    printf '\nserver is up\n'
    TEXTTEXT_SERVER="$ORIGIN" TEXTTEXT_DEV_NO_MOVE=1 \
      exec swift run --package-path "$ROOT/mac" TextText
  fi
  printf '.'
  sleep 1
done

printf '\n'
cat >&2 <<MSG
$ORIGIN did not answer.

Start the web app first, in another terminal:

    npm run dev

Then run this again. To point at a different server:

    TEXTTEXT_SERVER=https://example.test npm run mac:dev
MSG
exit 1
