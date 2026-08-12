#!/usr/bin/env bash
# Make the canonical application path available before TestFlight installs.
#
# Apple's TestFlight installer will update an app that it owns, but it will not
# overwrite a Developer ID build at /Applications/TextText.app. In that case it
# creates "TextText 2.app", leaving two bundles with the same identifier and
# File Provider domain. This command is the deliberate handoff between those
# channels: it moves only verified TextText bundles to Trash, then opens
# TestFlight. Workspace state lives outside the app bundle and is not touched.
set -euo pipefail

PB="${TEXTTEXT_PLIST_BUDDY:-/usr/libexec/PlistBuddy}"
APPLICATIONS_DIR="${TEXTTEXT_APPLICATIONS_DIR:-/Applications}"
TRASH_DIR="${TEXTTEXT_TRASH_DIR:-$HOME/.Trash}"
BUNDLE_ID="app.texttext.mac"
CANONICAL_APP="$APPLICATIONS_DIR/TextText.app"

plist_value() {
  "$PB" -c "Print :$2" "$1/Contents/Info.plist" 2>/dev/null || true
}

bundle_id() {
  plist_value "$1" CFBundleIdentifier
}

app_pids() {
  local app
  local executable
  for app in "$@"; do
    executable="$app/Contents/MacOS/TextText"
    ps ax -o pid=,command= | awk -v executable="$executable" '$2 == executable { print $1 }'
  done
}

apps_are_running() {
  [ -n "$(app_pids "$@")" ]
}

stop_apps() {
  local pids
  local attempt

  apps_are_running "$@" || return 0
  osascript -e 'tell application id "app.texttext.mac" to quit' </dev/null >/dev/null 2>&1 || true
  for attempt in {1..10}; do
    apps_are_running "$@" || return 0
    sleep 0.5
  done

  pids="$(app_pids "$@")"
  [ -z "$pids" ] || kill -TERM $pids 2>/dev/null || true
  for attempt in {1..10}; do
    apps_are_running "$@" || return 0
    sleep 0.5
  done

  return 1
}

trash_destination() {
  local app="$1"
  local version
  local build
  local channel
  local destination

  version="$(plist_value "$app" CFBundleShortVersionString)"
  build="$(plist_value "$app" CFBundleVersion)"
  version="${version:-unknown}"
  build="${build:-unknown}"
  channel="Standalone"
  [ ! -e "$app/Contents/_MASReceipt/receipt" ] || channel="TestFlight"

  destination="$TRASH_DIR/TextText $version ($build) $channel.app"
  if [ -e "$destination" ]; then
    destination="$TRASH_DIR/TextText $version ($build) $channel $(date +%Y%m%d-%H%M%S)-$$.app"
  fi
  printf '%s\n' "$destination"
}

if [ ! -d "$APPLICATIONS_DIR" ]; then
  echo "Applications directory does not exist: $APPLICATIONS_DIR" >&2
  exit 1
fi

if [ -e "$CANONICAL_APP" ] && [ "$(bundle_id "$CANONICAL_APP")" != "$BUNDLE_ID" ]; then
  echo "Refusing: $CANONICAL_APP is not the TextText bundle ($BUNDLE_ID)." >&2
  exit 1
fi

shopt -s nullglob
verified_apps=()
move_apps=()

if [ -e "$CANONICAL_APP" ]; then
  verified_apps+=("$CANONICAL_APP")
  if [ ! -e "$CANONICAL_APP/Contents/_MASReceipt/receipt" ]; then
    move_apps+=("$CANONICAL_APP")
  fi
fi

for candidate in "$APPLICATIONS_DIR"/TextText\ [0-9]*.app; do
  if [ "$(bundle_id "$candidate")" != "$BUNDLE_ID" ]; then
    echo "Leaving unrelated app in place: $candidate"
    continue
  fi
  verified_apps+=("$candidate")
  move_apps+=("$candidate")
done

if [ "${#move_apps[@]}" -gt 0 ]; then
  if ! stop_apps "${verified_apps[@]}"; then
    echo "TextText did not quit. Nothing was moved; quit it and try again." >&2
    exit 1
  fi

  mkdir -p "$TRASH_DIR"
  moved_apps=()
  moved_destinations=()
  for app in "${move_apps[@]}"; do
    destination="$(trash_destination "$app")"
    echo "Moving to Trash: $app"
    if ! mv "$app" "$destination"; then
      echo "Could not move $app to Trash; restoring earlier moves." >&2
      for (( index=${#moved_apps[@]}-1; index>=0; index-- )); do
        mv "${moved_destinations[$index]}" "${moved_apps[$index]}" || {
          echo "Restore failed: ${moved_destinations[$index]} -> ${moved_apps[$index]}" >&2
        }
      done
      exit 1
    fi
    moved_apps+=("$app")
    moved_destinations+=("$destination")
  done
elif [ -e "$CANONICAL_APP" ]; then
  echo "TestFlight already owns $CANONICAL_APP; it can update in place."
else
  echo "$CANONICAL_APP is already clear for TestFlight."
fi

if [ "${TEXTTEXT_SKIP_OPEN_TESTFLIGHT:-0}" != "1" ]; then
  if ! open -a TestFlight; then
    echo "The path is ready. Open TestFlight manually to install TextText." >&2
    exit 1
  fi
fi

echo "Ready: install or update TextText in TestFlight."
