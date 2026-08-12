#!/usr/bin/env bash
# Replace the one canonical local TextText installation with a verified bundle.
# This is a deliberate developer action. It never launches a second copy from
# the checkout or leaves an old TextText bundle beside the installed one.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP="${TEXTTEXT_APPLICATIONS_APP:-/Applications/TextText.app}"
SOURCE="${TEXTTEXT_SOURCE_APP:-$ROOT/mac/build/TextText.app}"
PB="${TEXTTEXT_PLIST_BUDDY:-/usr/libexec/PlistBuddy}"
PARENT="$(dirname "$APP")"
STAGE="$PARENT/.TextText.app.new.$$"
OLD="$PARENT/.TextText.app.previous.$$"
TRASH="$HOME/.Trash"

[[ -d "$SOURCE" ]] || { echo "Missing built app: $SOURCE" >&2; exit 1; }
bundle_id="$($PB -c 'Print :CFBundleIdentifier' "$SOURCE/Contents/Info.plist" 2>/dev/null || true)"
[[ "$bundle_id" == "app.texttext.mac" ]] || {
  echo "Refusing to install bundle id '$bundle_id'; expected app.texttext.mac." >&2
  exit 1
}

mkdir -p "$PARENT"
rm -rf "$STAGE" "$OLD"
ditto "$SOURCE" "$STAGE"

executable="$APP/Contents/MacOS/TextText"
if [[ -x "$executable" ]]; then
  pids="$(ps ax -o pid=,command= | awk -v executable="$executable" '$2 == executable { print $1 }')"
  if [[ -n "$pids" ]]; then
    kill -TERM $pids 2>/dev/null || true
    for _ in {1..20}; do
      pids="$(ps ax -o pid=,command= | awk -v executable="$executable" '$2 == executable { print $1 }')"
      [[ -z "$pids" ]] && break
      sleep 0.25
    done
    [[ -z "$pids" ]] || { echo "TextText did not quit; refusing replacement." >&2; rm -rf "$STAGE"; exit 1; }
  fi
fi

if [[ -e "$APP" ]]; then
  mv "$APP" "$OLD"
fi
mv "$STAGE" "$APP"
if [[ -e "$OLD" ]]; then
  mkdir -p "$TRASH"
  mv "$OLD" "$TRASH/TextText.previous.$$.app"
fi
open -g "$APP"
echo "Installed and launched one canonical copy: $APP"
