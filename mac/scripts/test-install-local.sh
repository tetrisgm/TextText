#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FIXTURE="$(mktemp -d "${TMPDIR:-/tmp}/texttext-install-local.XXXXXX")"
trap 'rm -rf "$FIXTURE"' EXIT

make_app() {
  local path="$1" identifier="$2" version="$3" build="$4"
  mkdir -p "$path/Contents/MacOS"
  : > "$path/Contents/MacOS/TextText"
  chmod +x "$path/Contents/MacOS/TextText"
  cat > "$path/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>$identifier</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>CFBundleVersion</key><string>$build</string>
</dict></plist>
EOF
}

run_installer() {
  HOME="$FIXTURE/Home" \
  TEXTTEXT_APPLICATIONS_APP="$FIXTURE/Applications/TextText.app" \
  TEXTTEXT_SOURCE_APP="$FIXTURE/Source/TextText.app" \
  TEXTTEXT_TRASH_DIR="$FIXTURE/Trash" \
  TEXTTEXT_ADDITIONAL_APPLICATIONS_DIRS="$FIXTURE/Home/Applications" \
  TEXTTEXT_SKIP_BINARY_VERIFICATION=1 \
  TEXTTEXT_SKIP_LAUNCH=1 \
  TEXTTEXT_REQUIRE_RUNTIME_HEALTH="${TEXTTEXT_REQUIRE_RUNTIME_HEALTH:-0}" \
  TEXTTEXT_EXPECTED_VERSION="${TEXTTEXT_EXPECTED_VERSION:-0.181}" \
  TEXTTEXT_EXPECTED_BUILD="${TEXTTEXT_EXPECTED_BUILD:-185}" \
    "$ROOT/mac/scripts/install-local.sh" "$@"
}

mkdir -p "$FIXTURE/Applications" "$FIXTURE/Home/Applications" "$FIXTURE/Source" "$FIXTURE/Trash"
make_app "$FIXTURE/Source/TextText.app" app.texttext.mac 0.181 185
make_app "$FIXTURE/Applications/TextText.app" app.texttext.mac 0.181 184
make_app "$FIXTURE/Applications/TextText 2.app" app.texttext.mac 0.180 183
make_app "$FIXTURE/Home/Applications/TextText.app" app.texttext.mac 0.179 182
make_app "$FIXTURE/Applications/TextText 3.app" example.unrelated 1.0 1

run_installer >/dev/null

[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$FIXTURE/Applications/TextText.app/Contents/Info.plist")" == "185" ]]
[[ ! -e "$FIXTURE/Applications/TextText 2.app" ]]
[[ ! -e "$FIXTURE/Home/Applications/TextText.app" ]]
[[ -e "$FIXTURE/Applications/TextText 3.app" ]]
[[ "$(find "$FIXTURE/Trash" -maxdepth 1 -name '*.app' | wc -l | tr -d ' ')" == "3" ]]

# A new app that cannot prove exact runtime health must restore the prior
# canonical bundle and every staged duplicate.
rm -rf "$FIXTURE/Applications/TextText.app" "$FIXTURE/Applications/TextText 2.app" "$FIXTURE/Trash"
mkdir -p "$FIXTURE/Trash" "$FIXTURE/Health"
make_app "$FIXTURE/Applications/TextText.app" app.texttext.mac 0.181 184
make_app "$FIXTURE/Applications/TextText 2.app" app.texttext.mac 0.180 183
cat > "$FIXTURE/Health/latest.json" <<'EOF'
{"schemaVersion":1,"appVersion":"0.181","buildNumber":"185","generatedAt":"2099-01-01T00:00:00Z","status":"fail","checks":[{"id":"build.attestation","status":"fail"}]}
EOF
if TEXTTEXT_REQUIRE_RUNTIME_HEALTH=1 \
  TEXTTEXT_HEALTH_WAIT_SECONDS=1 \
  TEXTTEXT_RUNTIME_HEALTH_PATH="$FIXTURE/Health/latest.json" \
    run_installer >/dev/null 2>&1; then
  echo "install-local accepted a failing runtime health report" >&2
  exit 1
fi
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$FIXTURE/Applications/TextText.app/Contents/Info.plist")" == "184" ]]
[[ -e "$FIXTURE/Applications/TextText 2.app" ]]

# A passing report from an older launch must not approve a new swap merely
# because its version and build happen to match.
rm -rf "$FIXTURE/Applications/TextText.app" "$FIXTURE/Applications/TextText 2.app" "$FIXTURE/Trash"
mkdir -p "$FIXTURE/Trash"
make_app "$FIXTURE/Applications/TextText.app" app.texttext.mac 0.181 184
make_app "$FIXTURE/Applications/TextText 2.app" app.texttext.mac 0.180 183
cat > "$FIXTURE/Health/latest.json" <<'EOF'
{"schemaVersion":1,"appVersion":"0.181","buildNumber":"185","generatedAt":"2000-01-01T00:00:00Z","status":"pass","checks":[]}
EOF
if TEXTTEXT_REQUIRE_RUNTIME_HEALTH=1 \
  TEXTTEXT_HEALTH_WAIT_SECONDS=1 \
  TEXTTEXT_RUNTIME_HEALTH_PATH="$FIXTURE/Health/latest.json" \
    run_installer >/dev/null 2>&1; then
  echo "install-local accepted a stale passing runtime health report" >&2
  exit 1
fi
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$FIXTURE/Applications/TextText.app/Contents/Info.plist")" == "184" ]]
[[ -e "$FIXTURE/Applications/TextText 2.app" ]]

# With no explicit diagnostic path, the installer asks the installed executable
# for one fresh report. This is the production path because app-group state is
# intentionally unreadable to an ordinary shell.
rm -rf "$FIXTURE/Applications/TextText.app" "$FIXTURE/Applications/TextText 2.app" "$FIXTURE/Trash"
mkdir -p "$FIXTURE/Trash"
make_app "$FIXTURE/Applications/TextText.app" app.texttext.mac 0.181 184
make_app "$FIXTURE/Applications/TextText 2.app" app.texttext.mac 0.180 183
cat > "$FIXTURE/Source/TextText.app/Contents/MacOS/TextText" <<'EOF'
#!/bin/sh
cat <<'JSON'
{"schemaVersion":1,"appVersion":"0.181","buildNumber":"185","generatedAt":"2099-01-01T00:00:00Z","status":"pass","checks":[]}
JSON
EOF
chmod +x "$FIXTURE/Source/TextText.app/Contents/MacOS/TextText"
TEXTTEXT_REQUIRE_RUNTIME_HEALTH=1 TEXTTEXT_HEALTH_WAIT_SECONDS=3 run_installer >/dev/null
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$FIXTURE/Applications/TextText.app/Contents/Info.plist")" == "185" ]]

# Cleanup is transactional too. If a prior bundle cannot move to Trash, the
# previous canonical app and every duplicate return to their original paths.
rm -rf "$FIXTURE/Applications/TextText.app" "$FIXTURE/Applications/TextText 2.app" "$FIXTURE/Trash"
mkdir -p "$FIXTURE/Trash"
make_app "$FIXTURE/Applications/TextText.app" app.texttext.mac 0.181 184
make_app "$FIXTURE/Applications/TextText 2.app" app.texttext.mac 0.180 183
chmod 500 "$FIXTURE/Trash"
if run_installer >/dev/null 2>&1; then
  echo "install-local accepted a cleanup failure" >&2
  exit 1
fi
chmod 700 "$FIXTURE/Trash"
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$FIXTURE/Applications/TextText.app/Contents/Info.plist")" == "184" ]]
[[ -e "$FIXTURE/Applications/TextText 2.app" ]]

# Identity mismatches fail before the installed bundle is touched.
if TEXTTEXT_EXPECTED_BUILD=999 run_installer >/dev/null 2>&1; then
  echo "install-local accepted a mismatched expected build" >&2
  exit 1
fi
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$FIXTURE/Applications/TextText.app/Contents/Info.plist")" == "184" ]]

# Exercise the real stop/rollback functions without sending input or signals.
# Refused normal quit must never escalate or move a running application's bundle.
(
  eval "$(sed -n '/^stop_apps() {/,/^}/p' "$ROOT/mac/scripts/install-local.sh")"
  SKIP_LAUNCH=0
  quit_calls=0
  signal_calls=0
  apps_are_running() { return 0; }
  osascript() { quit_calls=$((quit_calls + 1)); }
  sleep() { :; }
  app_pids() { echo 999999; }
  kill() { signal_calls=$((signal_calls + 1)); }
  if stop_apps "$FIXTURE/Applications/TextText.app"; then
    echo "install-local accepted a refused normal quit" >&2
    exit 1
  fi
  [[ "$quit_calls" == "1" && "$signal_calls" == "0" ]]
  # A normal quit that completes during polling still succeeds.
  running_checks=0
  apps_are_running() {
    running_checks=$((running_checks + 1))
    [[ "$running_checks" -lt 3 ]]
  }
  stop_apps "$FIXTURE/Applications/TextText.app"
  [[ "$quit_calls" == "2" && "$signal_calls" == "0" ]]
)
(
  eval "$(sed -n '/^rollback() {/,/^}/p' "$ROOT/mac/scripts/install-local.sh")"
  APP="$FIXTURE/Applications/TextText.app"
  OLD="$FIXTURE/previous.app"
  FAILED="$FIXTURE/failed.app"
  STAGE="$FIXTURE/stage.app"
  HAD_CANONICAL=0
  INSTALL_WAS_RUNNING=0
  cleanup_sources=()
  cleanup_destinations=()
  duplicate_originals=()
  duplicate_staged=()
  mutations=0
  stop_apps() { return 1; }
  mv() { mutations=$((mutations + 1)); }
  rm() { mutations=$((mutations + 1)); }
  launch_canonical() { mutations=$((mutations + 1)); }
  if rollback; then
    echo "install-local accepted rollback while the app refused quit" >&2
    exit 1
  fi
  [[ "$mutations" == "0" ]]
)

# The EXIT/signal handler must also preserve STAGE after refused rollback.
# Run the actual handler in a child because it intentionally exits the shell.
(
  eval "$(sed -n '/^rollback() {/,/^}/p' "$ROOT/mac/scripts/install-local.sh")"
  eval "$(sed -n '/^abort_install() {/,/^}/p' "$ROOT/mac/scripts/install-local.sh")"
  eval "$(sed -n '/^fail_install() {/,/^}/p' "$ROOT/mac/scripts/install-local.sh")"
  APP="$FIXTURE/Applications/TextText.app"
  OLD="$FIXTURE/previous.app"
  FAILED="$FIXTURE/failed.app"
  STAGE="$FIXTURE/stage.app"
  HAD_CANONICAL=0
  INSTALL_WAS_RUNNING=0
  SWAP_ACTIVE=1
  cleanup_sources=()
  cleanup_destinations=()
  duplicate_originals=()
  duplicate_staged=()
  stop_apps() { return 1; }
  mv() { echo move >> "$FIXTURE/abort-mutations"; }
  rm() { echo remove >> "$FIXTURE/abort-mutations"; }
  launch_canonical() { echo launch >> "$FIXTURE/abort-mutations"; }
  : > "$FIXTURE/abort-mutations"
  if ( abort_install ); then
    echo "install-local abort accepted refused rollback" >&2
    exit 1
  fi
  [[ ! -s "$FIXTURE/abort-mutations" ]]
  if ( trap abort_install EXIT; fail_install "Fixture health failure" ); then
    echo "install-local failure accepted refused rollback" >&2
    exit 1
  fi
  [[ ! -s "$FIXTURE/abort-mutations" ]]
)

echo "install-local: ok"
