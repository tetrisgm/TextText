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

echo "install-local: ok"
