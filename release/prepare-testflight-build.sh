#!/usr/bin/env bash
# Build and package the sandboxed TextText edition for an owner-invoked
# TestFlight upload. This command prepares a signed .pkg only. It never uploads,
# installs, opens TestFlight, or changes either installed TextText channel.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PB="${TEXTTEXT_PLIST_BUDDY:-/usr/libexec/PlistBuddy}"
CODESIGN="${TEXTTEXT_CODESIGN:-/usr/bin/codesign}"
PRODUCTBUILD="${TEXTTEXT_PRODUCTBUILD:-/usr/bin/productbuild}"
PKGUTIL="${TEXTTEXT_PKGUTIL:-/usr/sbin/pkgutil}"
SECURITY="${TEXTTEXT_SECURITY:-/usr/bin/security}"
VERIFY_APP="${TEXTTEXT_VERIFY_APP:-$ROOT/mac/scripts/verify-apple-silicon-app.sh}"
BUILD_STORE="${TEXTTEXT_BUILD_STORE:-$ROOT/mac/scripts/build-store.sh}"
APP="${TEXTTEXT_TESTFLIGHT_APP:-$ROOT/mac/build/TextText.app}"
BUNDLE_ID="app.texttext.mac"

if [ "${TEXTTEXT_TESTFLIGHT_SKIP_BUILD:-0}" != "1" ]; then
  "$BUILD_STORE"
fi

INFO="$APP/Contents/Info.plist"
if [ ! -f "$INFO" ]; then
  echo "Refusing: TestFlight app is missing: $APP" >&2
  exit 1
fi

plist_value() {
  "$PB" -c "Print :$1" "$2" 2>/dev/null || true
}

identifier="$(plist_value CFBundleIdentifier "$INFO")"
version="$(plist_value CFBundleShortVersionString "$INFO")"
build="$(plist_value CFBundleVersion "$INFO")"
if [ "$identifier" != "$BUNDLE_ID" ]; then
  echo "Refusing: bundle id is '$identifier', expected '$BUNDLE_ID'." >&2
  exit 1
fi
if [ -z "$version" ] || [ -z "$build" ] || ! [[ "$build" =~ ^[1-9][0-9]*$ ]]; then
  echo "Refusing: app version/build metadata is incomplete or invalid." >&2
  exit 1
fi
if [ -e "$APP/Contents/Frameworks/Sparkle.framework" ] \
  || [ -n "$(plist_value SUFeedURL "$INFO")" ] \
  || [ -n "$(plist_value SUPublicEDKey "$INFO")" ]; then
  echo "Refusing: the TestFlight app contains standalone Sparkle update metadata." >&2
  exit 1
fi
if [ ! -f "$APP/Contents/embedded.provisionprofile" ]; then
  echo "Refusing: the TestFlight app has no embedded App Store profile." >&2
  exit 1
fi

"$CODESIGN" --verify --strict --verbose=2 "$APP"
"$VERIFY_APP" "$APP" --require-extensions

signing_authority="$($CODESIGN -dv --verbose=4 "$APP" 2>&1 \
  | awk -F= '$1 == "Authority" { print $2; exit }')"
if [[ "$signing_authority" != "Apple Distribution:"* ]]; then
  echo "Refusing: app is signed by '$signing_authority', expected Apple Distribution." >&2
  exit 1
fi

for extension_name in \
  TextTextShareExtension \
  TextTextQuickLookPreview \
  TextTextFileProviderExtension; do
  extension="$APP/Contents/PlugIns/$extension_name.appex"
  if [ ! -f "$extension/Contents/embedded.provisionprofile" ]; then
    echo "Refusing: $extension_name has no embedded App Store profile." >&2
    exit 1
  fi
  "$CODESIGN" --verify --strict --verbose=2 "$extension"
done

entitlements="$(mktemp "${TMPDIR:-/tmp}/texttext-testflight-entitlements.XXXXXX")"
trap 'rm -f "$entitlements"' EXIT
if ! "$CODESIGN" -d --entitlements :- "$APP" >"$entitlements" 2>/dev/null; then
  echo "Refusing: could not read the signed app entitlements." >&2
  exit 1
fi

sandbox="$(plist_value com.apple.security.app-sandbox "$entitlements")"
application_identifier="$(plist_value com.apple.application-identifier "$entitlements")"
team="$(plist_value com.apple.developer.team-identifier "$entitlements")"
app_group="$(plist_value 'com.apple.security.application-groups:0' "$entitlements")"
if [ "$sandbox" != "true" ]; then
  echo "Refusing: the TestFlight app is not sandboxed." >&2
  exit 1
fi
if [ -z "$team" ] || [ "$application_identifier" != "$team.$BUNDLE_ID" ]; then
  echo "Refusing: the signed application identifier does not match its team and bundle id." >&2
  exit 1
fi
if [ "$app_group" != "$team.group.app.texttext" ]; then
  echo "Refusing: the signed app group is '$app_group', expected '$team.group.app.texttext'." >&2
  exit 1
fi

installer_identity="${TEXTTEXT_INSTALLER_ID:-}"
if [ -z "$installer_identity" ]; then
  installer_identity="$($SECURITY find-identity -p basic -v 2>/dev/null \
    | awk -F'"' '/3rd Party Mac Developer Installer/{print $2; exit}')"
fi
if [[ "$installer_identity" != "3rd Party Mac Developer Installer:"* ]]; then
  echo "Refusing: no 3rd Party Mac Developer Installer identity is available." >&2
  exit 1
fi

artifact_dir="${TEXTTEXT_TESTFLIGHT_ARTIFACT_DIR:-$ROOT/release/artifacts}"
package="${TEXTTEXT_TESTFLIGHT_OUTPUT_PKG:-$artifact_dir/TextText-$version-$build-TestFlight.pkg}"
if [ -e "$package" ]; then
  echo "Refusing to overwrite existing package: $package" >&2
  exit 1
fi
mkdir -p "$(dirname "$package")"

"$PRODUCTBUILD" \
  --component "$APP" /Applications \
  --sign "$installer_identity" \
  "$package"
"$PKGUTIL" --check-signature "$package"

echo "Prepared TestFlight package: $package"
echo "Version: $version ($build)"
echo "No upload or installation was performed."
