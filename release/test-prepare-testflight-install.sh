#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURE="$(mktemp -d "${TMPDIR:-/tmp}/texttext-testflight-switch.XXXXXX")"
trap 'rm -rf "$FIXTURE"' EXIT

APPLICATIONS="$FIXTURE/Applications"
TRASH="$FIXTURE/Trash"
mkdir -p "$APPLICATIONS" "$TRASH"

make_app() {
  local path="$1"
  local identifier="$2"
  local receipt="${3:-0}"

  mkdir -p "$path/Contents/MacOS"
  touch "$path/Contents/MacOS/TextText"
  cat > "$path/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>$identifier</string>
  <key>CFBundleShortVersionString</key><string>0.175</string>
  <key>CFBundleVersion</key><string>182</string>
</dict></plist>
EOF
  if [ "$receipt" = "1" ]; then
    mkdir -p "$path/Contents/_MASReceipt"
    touch "$path/Contents/_MASReceipt/receipt"
  fi
}

make_app "$APPLICATIONS/TextText.app" app.texttext.mac
make_app "$APPLICATIONS/TextText 2.app" app.texttext.mac 1
make_app "$APPLICATIONS/TextText 3.app" example.unrelated

TEXTTEXT_APPLICATIONS_DIR="$APPLICATIONS" \
TEXTTEXT_TRASH_DIR="$TRASH" \
TEXTTEXT_SKIP_OPEN_TESTFLIGHT=1 \
  "$ROOT/release/prepare-testflight-install.sh"

[ ! -e "$APPLICATIONS/TextText.app" ]
[ ! -e "$APPLICATIONS/TextText 2.app" ]
[ -e "$APPLICATIONS/TextText 3.app" ]
[ -e "$TRASH/TextText 0.175 (182) Standalone.app" ]
[ -e "$TRASH/TextText 0.175 (182) TestFlight.app" ]

make_app "$APPLICATIONS/TextText.app" app.texttext.mac 1
TEXTTEXT_APPLICATIONS_DIR="$APPLICATIONS" \
TEXTTEXT_TRASH_DIR="$TRASH" \
TEXTTEXT_SKIP_OPEN_TESTFLIGHT=1 \
  "$ROOT/release/prepare-testflight-install.sh"

[ -e "$APPLICATIONS/TextText.app" ]

REFUSAL_APPLICATIONS="$FIXTURE/Refusal Applications"
mkdir -p "$REFUSAL_APPLICATIONS"
make_app "$REFUSAL_APPLICATIONS/TextText.app" example.unrelated
if TEXTTEXT_APPLICATIONS_DIR="$REFUSAL_APPLICATIONS" \
  TEXTTEXT_TRASH_DIR="$TRASH" \
  TEXTTEXT_SKIP_OPEN_TESTFLIGHT=1 \
  "$ROOT/release/prepare-testflight-install.sh" >/dev/null 2>&1; then
  echo "prepare-testflight-install accepted an unrelated canonical app" >&2
  exit 1
fi
[ -e "$REFUSAL_APPLICATIONS/TextText.app" ]

echo "prepare-testflight-install: ok"
