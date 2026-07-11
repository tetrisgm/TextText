#!/usr/bin/env bash
# Build App Intents metadata for a SwiftPM-built Write.app bundle.
#
# Usage:
#   mac/scripts/appintents-metadata.sh <built-binary-path> <bundle-path>
#
# The maintainer should call this after copying the SwiftPM binary into
# Contents/MacOS and before codesigning the app bundle.
#
# KNOWN LIMITATION (verified 2026-07-11, Xcode 26.6 toolchain): the
# processor requires .swiftconstvalues files that only Xcode's per-file
# frontend invocations emit; the SwiftPM driver ignores -emit-const-values
# and -emit-const-values-path at every level tried, so this script fails
# loudly on a plain SwiftPM build. It is therefore NOT wired into
# build-app.sh yet. When const values are available (toolchain support or
# an xcodebuild step), pass them via APPINTENTS_SWIFT_CONST_VALS_LIST and
# wire this in after the binary copy, before codesigning. Until then the
# intents work in-process; only Shortcuts-app discovery is deferred.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <built-binary-path> <bundle-path>" >&2
  exit 64
fi

BIN="$1"
APP="$2"

if [ ! -x "$BIN" ]; then
  echo "Binary is not executable: $BIN" >&2
  exit 66
fi
if [ ! -d "$APP/Contents" ]; then
  echo "Bundle path does not look like an app: $APP" >&2
  exit 66
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MAC_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TMP="${TMPDIR:-/tmp}/write-appintents-$$"
mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT

PROCESSOR="$(xcrun --find appintentsmetadataprocessor)"
SWIFT_BIN="$(xcrun --find swift)"
TOOLCHAIN_DIR="$(cd "$(dirname "$SWIFT_BIN")/../.." && pwd)"
SDK_ROOT="$(xcrun --sdk macosx --show-sdk-path)"
XCODE_VERSION="$(xcodebuild -version | awk '/Build version/{print $3; exit}')"
TARGET_TRIPLE="$(swift -print-target-info | /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin)["target"]["triple"])')"
DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-14.0}"
SOURCE_LIST="${APPINTENTS_SOURCE_FILE_LIST:-$TMP/sources.txt}"
CONST_VALS_LIST="${APPINTENTS_SWIFT_CONST_VALS_LIST:-$TMP/const-values.txt}"
# Platform convention: the processor materializes Metadata.appintents inside
# the resources directory it is pointed at.
RESOURCES="$APP/Contents/Resources"
METADATA="$RESOURCES/Metadata.appintents"

if [ -z "${APPINTENTS_SOURCE_FILE_LIST:-}" ]; then
  find "$MAC_DIR/Sources/Write" "$MAC_DIR/Sources/WriteAppIntents" -name '*.swift' | sort > "$SOURCE_LIST"
fi
if [ -z "${APPINTENTS_SWIFT_CONST_VALS_LIST:-}" ]; then
  # SwiftPM builds can emit per-module const values with
  # -Xswiftc -emit-const-values; list any found next to the binary.
  find "$(dirname "$BIN")" -name '*.swiftconstvalues' 2>/dev/null | sort > "$CONST_VALS_LIST" || : > "$CONST_VALS_LIST"
fi

mkdir -p "$RESOURCES"
rm -rf "$METADATA"
set +e
"$PROCESSOR" \
  --output "$RESOURCES" \
  --toolchain-dir "$TOOLCHAIN_DIR" \
  --module-name Write \
  --sdk-root "$SDK_ROOT" \
  --xcode-version "$XCODE_VERSION" \
  --platform-family macOS \
  --deployment-target "$DEPLOYMENT_TARGET" \
  --target-triple "$TARGET_TRIPLE" \
  --source-file-list "$SOURCE_LIST" \
  --swift-const-vals-list "$CONST_VALS_LIST" \
  --app-shortcuts-app-name-override \
  --no-app-shortcuts-localization \
  --force
STATUS=$?
set -e

# Producing nothing must be a loud failure: the app would ship with intents
# invisible to Shortcuts while this step claims success.
if [ "$STATUS" -ne 0 ]; then
  echo "appintentsmetadataprocessor failed with exit $STATUS" >&2
  exit "$STATUS"
fi
if [ ! -d "$METADATA" ] || [ -z "$(ls -A "$METADATA" 2>/dev/null)" ]; then
  echo "appintentsmetadataprocessor produced no metadata at $METADATA" >&2
  exit 65
fi

echo "Processor: $PROCESSOR"
echo "Wrote $METADATA ($(du -sh "$METADATA" | cut -f1))"
