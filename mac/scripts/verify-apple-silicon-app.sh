#!/usr/bin/env bash
# Verify Write-owned executables are arm64-only. Sparkle stays universal so
# its updater framework and helper executables are not thinned unnecessarily.
set -euo pipefail

APP="${1:-}"
REQUIRE_EXTENSIONS=0
if [ "${2:-}" = "--require-extensions" ]; then
  REQUIRE_EXTENSIONS=1
elif [ -n "${2:-}" ]; then
  echo "Usage: verify-apple-silicon-app.sh <Write.app> [--require-extensions]" >&2
  exit 64
fi
if [ -z "$APP" ] || [ ! -f "$APP/Contents/Info.plist" ]; then
  echo "Usage: verify-apple-silicon-app.sh <Write.app> [--require-extensions]" >&2
  exit 64
fi

PB=/usr/libexec/PlistBuddy

require_arm64() {
  local label="$1"
  local executable="$2"
  if [ ! -x "$executable" ]; then
    echo "$label executable is missing: $executable" >&2
    exit 1
  fi
  local architectures
  architectures="$(/usr/bin/lipo -archs "$executable")" || {
    echo "$label is not a readable Mach-O executable." >&2
    exit 1
  }
  if [ "$architectures" != "arm64" ]; then
    echo "$label architectures are '$architectures', expected arm64 only." >&2
    exit 1
  fi
}

MAIN_NAME="$("$PB" -c 'Print :CFBundleExecutable' "$APP/Contents/Info.plist")"
require_arm64 "Write" "$APP/Contents/MacOS/$MAIN_NAME"

EXTENSION_COUNT=0
for extension_name in \
  WriteShareExtension \
  WriteQuickLookPreview \
  WriteFileProviderExtension; do
  extension="$APP/Contents/PlugIns/$extension_name.appex"
  plist="$extension/Contents/Info.plist"
  if [ ! -f "$plist" ]; then
    if [ "$REQUIRE_EXTENSIONS" = "1" ]; then
      echo "$extension_name bundle is missing." >&2
      exit 1
    fi
    continue
  fi
  executable_name="$("$PB" -c 'Print :CFBundleExecutable' "$plist")"
  require_arm64 "$extension_name" "$extension/Contents/MacOS/$executable_name"
  EXTENSION_COUNT=$((EXTENSION_COUNT + 1))
done

echo "   architecture: arm64 (Write + $EXTENSION_COUNT extensions)"
