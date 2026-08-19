#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURE="$(mktemp -d "${TMPDIR:-/tmp}/texttext-testflight-package.XXXXXX")"
trap 'rm -rf "$FIXTURE"' EXIT

APP="$FIXTURE/TextText.app"
TOOLS="$FIXTURE/tools"
LOG="$FIXTURE/invocations.log"
PACKAGE="$FIXTURE/output/TextText.pkg"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/PlugIns" "$TOOLS"
touch "$APP/Contents/MacOS/TextText" "$APP/Contents/embedded.provisionprofile"
for extension_name in \
  TextTextShareExtension \
  TextTextQuickLookPreview \
  TextTextFileProviderExtension; do
  mkdir -p "$APP/Contents/PlugIns/$extension_name.appex/Contents"
  touch "$APP/Contents/PlugIns/$extension_name.appex/Contents/embedded.provisionprofile"
done

cat >"$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>app.texttext.mac</string>
  <key>CFBundleShortVersionString</key><string>9.8</string>
  <key>CFBundleVersion</key><string>765</string>
</dict></plist>
PLIST

cat >"$TOOLS/codesign" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "-dv" ]; then
  echo 'Authority=Apple Distribution: TextText Test (ABCDEFGHIJ)' >&2
  exit 0
fi
if [ "${1:-}" = "-d" ]; then
  cat <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.security.app-sandbox</key><true/>
  <key>com.apple.application-identifier</key><string>ABCDEFGHIJ.app.texttext.mac</string>
  <key>com.apple.developer.team-identifier</key><string>ABCDEFGHIJ</string>
  <key>com.apple.security.application-groups</key>
  <array><string>ABCDEFGHIJ.group.app.texttext</string></array>
</dict></plist>
PLIST
fi
SCRIPT

cat >"$TOOLS/security" <<'SCRIPT'
#!/usr/bin/env bash
echo '  1) 0123456789ABCDEF "3rd Party Mac Developer Installer: TextText Test (ABCDEFGHIJ)"'
SCRIPT

cat >"$TOOLS/productbuild" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
printf 'productbuild %s\n' "$*" >>"$TEXTTEXT_TEST_LOG"
mkdir -p "$(dirname "${!#}")"
touch "${!#}"
SCRIPT

cat >"$TOOLS/pkgutil" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
[ "$1" = "--check-signature" ]
[ -f "$2" ]
printf 'pkgutil %s\n' "$*" >>"$TEXTTEXT_TEST_LOG"
SCRIPT

cat >"$TOOLS/verify-app" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
[ -f "$1/Contents/Info.plist" ]
[ "$2" = "--require-extensions" ]
SCRIPT
chmod +x "$TOOLS"/*

TEXTTEXT_TEST_LOG="$LOG" \
TEXTTEXT_TESTFLIGHT_SKIP_BUILD=1 \
TEXTTEXT_TESTFLIGHT_APP="$APP" \
TEXTTEXT_TESTFLIGHT_OUTPUT_PKG="$PACKAGE" \
TEXTTEXT_CODESIGN="$TOOLS/codesign" \
TEXTTEXT_SECURITY="$TOOLS/security" \
TEXTTEXT_PRODUCTBUILD="$TOOLS/productbuild" \
TEXTTEXT_PKGUTIL="$TOOLS/pkgutil" \
TEXTTEXT_VERIFY_APP="$TOOLS/verify-app" \
  "$ROOT/release/prepare-testflight-build.sh"

[ -f "$PACKAGE" ]
grep -F -- "--component $APP /Applications" "$LOG" >/dev/null
grep -F -- "--sign 3rd Party Mac Developer Installer: TextText Test (ABCDEFGHIJ)" "$LOG" >/dev/null
grep -F -- "pkgutil --check-signature $PACKAGE" "$LOG" >/dev/null

# A Store-shaped app without the sandbox must never become an upload artifact.
sed -i '' '/com.apple.security.app-sandbox/{N;d;}' "$TOOLS/codesign"
rm -f "$PACKAGE"
if TEXTTEXT_TEST_LOG="$LOG" \
  TEXTTEXT_TESTFLIGHT_SKIP_BUILD=1 \
  TEXTTEXT_TESTFLIGHT_APP="$APP" \
  TEXTTEXT_TESTFLIGHT_OUTPUT_PKG="$PACKAGE" \
  TEXTTEXT_CODESIGN="$TOOLS/codesign" \
  TEXTTEXT_SECURITY="$TOOLS/security" \
  TEXTTEXT_PRODUCTBUILD="$TOOLS/productbuild" \
  TEXTTEXT_PKGUTIL="$TOOLS/pkgutil" \
  TEXTTEXT_VERIFY_APP="$TOOLS/verify-app" \
    "$ROOT/release/prepare-testflight-build.sh" >/dev/null 2>&1; then
  echo "prepare-testflight-build accepted an unsandboxed app" >&2
  exit 1
fi

# Build numbers are App Store identities and must start at one.
/usr/libexec/PlistBuddy -c 'Set :CFBundleVersion 0' "$APP/Contents/Info.plist"
rm -f "$PACKAGE"
if TEXTTEXT_TEST_LOG="$LOG" \
  TEXTTEXT_TESTFLIGHT_SKIP_BUILD=1 \
  TEXTTEXT_TESTFLIGHT_APP="$APP" \
  TEXTTEXT_TESTFLIGHT_OUTPUT_PKG="$PACKAGE" \
  TEXTTEXT_CODESIGN="$TOOLS/codesign" \
  TEXTTEXT_SECURITY="$TOOLS/security" \
  TEXTTEXT_PRODUCTBUILD="$TOOLS/productbuild" \
  TEXTTEXT_PKGUTIL="$TOOLS/pkgutil" \
  TEXTTEXT_VERIFY_APP="$TOOLS/verify-app" \
    "$ROOT/release/prepare-testflight-build.sh" >/dev/null 2>&1; then
  echo "prepare-testflight-build accepted build number zero" >&2
  exit 1
fi
/usr/libexec/PlistBuddy -c 'Set :CFBundleVersion 765' "$APP/Contents/Info.plist"

echo "prepare-testflight-build: ok"
