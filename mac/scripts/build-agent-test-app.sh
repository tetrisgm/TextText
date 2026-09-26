#!/usr/bin/env bash
# Manual isolated Store-shaped agent test. Never installs or releases an app.
# Usage: mac/scripts/build-agent-test-app.sh /absolute/path/to/codex [http://localhost:3000]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RUNTIME="${1:?Pass the existing official Codex executable}"
ORIGIN="${2:-http://localhost:3000}"
case "$RUNTIME" in /*) ;; *) echo "Runtime path must be absolute." >&2; exit 2 ;; esac
[ -x "$RUNTIME" ] || { echo "Runtime is not executable." >&2; exit 2; }
python3 - "$ORIGIN" <<'PY'
import sys, urllib.parse
try:
    origin = urllib.parse.urlsplit(sys.argv[1])
    valid = (origin.scheme == "http" and origin.hostname in ("localhost", "127.0.0.1")
             and origin.port is not None and origin.username is None and origin.password is None
             and origin.path in ("", "/") and not origin.query and not origin.fragment)
except ValueError:
    valid = False
if not valid:
    sys.exit("This test build accepts only a local test origin with an explicit port.")
PY
codesign --verify --strict "$RUNTIME"
TEST_ROOT="$(mktemp -d /tmp/texttext-agent-test.XXXXXX)"
APP="$TEST_ROOT/TextText Agent Test.app"
cp "$ROOT/mac/Package.resolved" "$TEST_ROOT/Package.resolved"
restore_lockfile() { cp "$TEST_ROOT/Package.resolved" "$ROOT/mac/Package.resolved"; }
trap restore_lockfile EXIT
TEXTTEXT_STORE=1 swift build --package-path "$ROOT/mac" --product TextTextApp --jobs 4
BIN="$(TEXTTEXT_STORE=1 swift build --package-path "$ROOT/mac" --show-bin-path)"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Helpers" "$APP/Contents/Resources"
cp "$BIN/TextTextApp" "$APP/Contents/MacOS/TextText"
cp -L "$RUNTIME" "$APP/Contents/Helpers/codex"
cp "$ROOT/mac/Info.plist" "$APP/Contents/Info.plist"
[ ! -f "$ROOT/mac/AppIcon.icns" ] || cp "$ROOT/mac/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
RUNTIME_VERSION="$("$RUNTIME" --version)"
SOURCE_REVISION="$(git -C "$ROOT" rev-parse HEAD)"
python3 - "$APP" "$ORIGIN" "$RUNTIME_VERSION" "$TEST_ROOT" "$ROOT/mac" "$SOURCE_REVISION" <<'PY'
import hashlib, pathlib, plistlib, sys
app, origin, version, root, source, revision = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3], pathlib.Path(sys.argv[4]), pathlib.Path(sys.argv[5]), sys.argv[6]
digest = hashlib.sha256()
for file in sorted((source / "Sources").rglob("*.swift")) + [source / "Package.swift", source / "Info.plist"]:
    digest.update(str(file.relative_to(source)).encode() + b"\0" + file.read_bytes())
info = app / "Contents/Info.plist"
values = plistlib.loads(info.read_bytes())
values.update(CFBundleIdentifier="app.texttext.agenttest", CFBundleName="TextText Agent Test", CFBundleDisplayName="TextText Agent Test", CFBundleVersion="1", TextTextServerOrigin=origin, TextTextEmbeddedAgentRuntime=True, TextTextEmbeddedAgentVersion=version, TextTextSourceRevision=revision, TextTextNativeSourceDigest=digest.hexdigest())
# Launch Services applies this explicit local origin on every reopening. It
# outranks any linked credential origin and activates the existing dev guard
# that prevents writes to the real File Provider domain and handoff.
values["LSEnvironment"] = {"TEXTTEXT_SERVER": origin, "TEXTTEXT_DEV_FILEPROVIDER": "0"}
for key in ("TextTextAppGroupIdentifier", "TextTextKeychainAccessGroup", "CFBundleURLTypes", "CFBundleDocumentTypes", "SUFeedURL", "SUPublicEDKey"):
    values.pop(key, None)
info.write_bytes(plistlib.dumps(values))
for name, entitlements in {
    "parent.entitlements": {"com.apple.security.app-sandbox": True, "com.apple.security.network.client": True, "com.apple.security.files.user-selected.read-write": True},
    "helper.entitlements": {"com.apple.security.app-sandbox": True, "com.apple.security.inherit": True},
}.items():
    (root / name).write_bytes(plistlib.dumps(entitlements))
PY
codesign --force --sign - --options runtime --entitlements "$TEST_ROOT/helper.entitlements" "$APP/Contents/Helpers/codex"
codesign --force --sign - --options runtime --entitlements "$TEST_ROOT/parent.entitlements" "$APP"
codesign --verify --deep --strict "$APP"
printf 'Isolated sandbox app: %s\nOrigin: %s\nRuntime: %s\nBase revision: %s\n' "$APP" "$ORIGIN" "$RUNTIME_VERSION" "$SOURCE_REVISION"
printf 'Launch manually: open -n "%s"\n' "$APP"
