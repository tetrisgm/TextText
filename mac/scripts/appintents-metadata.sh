#!/usr/bin/env bash
# Build App Intents metadata for a SwiftPM-built TextText.app bundle.
#
# Usage:
#   mac/scripts/appintents-metadata.sh <built-binary-path> <bundle-path>
#
# The maintainer should call this after copying the SwiftPM binary into
# Contents/MacOS and before codesigning the app bundle.
#
# Const values come from an xcodebuild pass (SwiftPM cannot emit them):
# build-app.sh builds the TextText scheme with SWIFT_EMIT_CONST_VALUES=YES into
# a derived-data cache and passes the resulting .swiftconstvalues via
# APPINTENTS_SWIFT_CONST_VALS_LIST. Note the extractor also requires
# compile-time-literal spellings, e.g.
# TypeDisplayRepresentation(name: "...") rather than a string-literal
# assignment; it fails loudly naming the offending property otherwise.
#
# ONE PROCESSOR RUN PER MODULE. appintentsmetadataprocessor takes a single
# --module-name and resolves every declaration it parses against const values
# whose recorded typeName is "<module-name>.<Type>". The App Intents live in
# the TextTextAppIntents module and the AppShortcutsProvider lives in the app
# module (TextTextApp: the SwiftPM target name, not "TextText"), so no single
# module name can cover both. Feeding both modules' sources to one run with the
# wrong module name makes every const-value lookup miss, and the processor
# reports the miss as
#   error: The property 'parameterSummary' must have a compile-time static
#          value and cannot be computed or dynamic
# naming a property that is in fact perfectly static. Only properties that
# genuinely need the const values fail this way; literals like `title` are read
# straight from the source, which is why the mistake stayed invisible until the
# first parameterSummary was written.
#
# So this mirrors what Xcode does for a target and its dependency: run the
# library module first, then run the app module and hand it the library's
# extract.actionsdata via --static-metadata-file-list. That flag wants the
# .actionsdata file itself, not the enclosing .appintents bundle; pointing it
# at the bundle logs "Failed to decode metadata at:" and silently drops every
# intent. The app pass writes the merged bundle that ships.
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
TMP="${TMPDIR:-/tmp}/texttext-appintents-$$"
mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT

# Module names, and the source directory each one is built from. Keep these in
# step with mac/Package.swift: the library target is TextTextAppIntents at
# Sources/TextTextAppIntents, and the executable target is TextTextApp at
# Sources/TextText.
INTENTS_MODULE="TextTextAppIntents"
INTENTS_SOURCE_DIR="$MAC_DIR/Sources/TextTextAppIntents"
APP_MODULE="TextTextApp"
APP_SOURCE_DIR="$MAC_DIR/Sources/TextText"

PROCESSOR="$(xcrun --find appintentsmetadataprocessor)"
SWIFT_BIN="$(xcrun --find swift)"
TOOLCHAIN_DIR="$(cd "$(dirname "$SWIFT_BIN")/../.." && pwd)"
SDK_ROOT="$(xcrun --sdk macosx --show-sdk-path)"
XCODE_VERSION="$(xcodebuild -version | awk '/Build version/{print $3; exit}')"
TARGET_TRIPLE="$(swift -print-target-info | /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin)["target"]["triple"])')"
DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-14.0}"
CONST_VALS_LIST="${APPINTENTS_SWIFT_CONST_VALS_LIST:-$TMP/const-values.txt}"
# Platform convention: the processor materializes Metadata.appintents inside
# the resources directory it is pointed at.
RESOURCES="$APP/Contents/Resources"
METADATA="$RESOURCES/Metadata.appintents"

if [ -z "${APPINTENTS_SWIFT_CONST_VALS_LIST:-}" ]; then
  # SwiftPM builds can emit per-module const values with
  # -Xswiftc -emit-const-values; list any found next to the binary.
  find "$(dirname "$BIN")" -name '*.swiftconstvalues' 2>/dev/null | sort > "$CONST_VALS_LIST" || : > "$CONST_VALS_LIST"
fi

find "$INTENTS_SOURCE_DIR" -name '*.swift' | sort > "$TMP/intents-sources.txt"
find "$APP_SOURCE_DIR" -name '*.swift' | sort > "$TMP/app-sources.txt"

# Split the const values by the module that emitted them. A file carrying
# another module's records makes that module's declarations resolve against
# the wrong --module-name, which is the failure described at the top.
grep "/$INTENTS_MODULE\.build/" "$CONST_VALS_LIST" > "$TMP/intents-constvals.txt" || :
grep -v "/$INTENTS_MODULE\.build/" "$CONST_VALS_LIST" > "$TMP/app-constvals.txt" || :
if [ ! -s "$TMP/intents-constvals.txt" ]; then
  echo "No .swiftconstvalues for $INTENTS_MODULE in $CONST_VALS_LIST" >&2
  echo "Every intent would export without its parameter summaries." >&2
  exit 65
fi

run_processor() { # $1=module $2=output-dir $3=source-list $4=const-vals-list, rest passed through
  local module="$1" output="$2" sources="$3" constvals="$4"
  shift 4
  "$PROCESSOR" \
    --output "$output" \
    --toolchain-dir "$TOOLCHAIN_DIR" \
    --module-name "$module" \
    --sdk-root "$SDK_ROOT" \
    --xcode-version "$XCODE_VERSION" \
    --platform-family macOS \
    --deployment-target "$DEPLOYMENT_TARGET" \
    --target-triple "$TARGET_TRIPLE" \
    --source-file-list "$sources" \
    --swift-const-vals-list "$constvals" \
    --app-shortcuts-app-name-override \
    --no-app-shortcuts-localization \
    --force \
    "$@"
}

# Pass 1: the library module that declares the intents, entities and queries.
INTENTS_OUT="$TMP/$INTENTS_MODULE"
mkdir -p "$INTENTS_OUT"
set +e
run_processor "$INTENTS_MODULE" "$INTENTS_OUT" "$TMP/intents-sources.txt" "$TMP/intents-constvals.txt"
STATUS=$?
set -e
if [ "$STATUS" -ne 0 ]; then
  echo "appintentsmetadataprocessor failed for $INTENTS_MODULE with exit $STATUS" >&2
  exit "$STATUS"
fi
INTENTS_ACTIONS="$INTENTS_OUT/Metadata.appintents/extract.actionsdata"
if [ ! -f "$INTENTS_ACTIONS" ]; then
  echo "appintentsmetadataprocessor produced no $INTENTS_MODULE metadata" >&2
  exit 65
fi
printf '%s\n' "$INTENTS_ACTIONS" > "$TMP/static-metadata.txt"

# Pass 2: the app module, which owns the AppShortcutsProvider and writes the
# merged bundle that ships inside the app.
mkdir -p "$RESOURCES"
rm -rf "$METADATA"
set +e
run_processor "$APP_MODULE" "$RESOURCES" "$TMP/app-sources.txt" "$TMP/app-constvals.txt" \
  --static-metadata-file-list "$TMP/static-metadata.txt"
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

# The merge is the step most likely to fail quietly: if the static metadata is
# handed over in a shape the processor cannot decode it logs one line and
# writes a bundle with no intents in it. Count what actually landed.
/usr/bin/python3 - "$METADATA/extract.actionsdata" <<'PY'
import json, sys

with open(sys.argv[1]) as handle:
    data = json.load(handle)
actions = data.get("actions") or {}
shortcuts = data.get("autoShortcuts") or []
missing = [
    name
    for name in ("CreateDocumentIntent", "AppendTextToDocumentIntent",
                 "SearchDocumentsIntent", "OpenDocumentIntent")
    if name not in actions
]
if missing:
    sys.exit("Metadata is missing the Shortcuts intents: " + ", ".join(missing))
if not shortcuts:
    sys.exit("Metadata carries no App Shortcuts")
summaries = sum(1 for action in actions.values() if action.get("actionConfiguration"))
print(f"Intents: {len(actions)}  App Shortcuts: {len(shortcuts)}  Parameter summaries: {summaries}")
PY

echo "Processor: $PROCESSOR"
echo "Wrote $METADATA ($(du -sh "$METADATA" | cut -f1))"
