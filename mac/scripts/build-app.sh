#!/usr/bin/env bash
# Assemble mac/build/Write.app: the Swift binary + Sparkle.framework, signed
# inside-out (the partyparty recipe, minus the Helpers tree).
#
#   mac/scripts/build-app.sh                 -> auto-detects a Developer ID
#                                               Application identity, else ad-hoc
#   WRITE_SIGN_ID="Developer ID Application: ... (<TEAMID>)" mac/scripts/build-app.sh
#
# Identity/origin injection happens HERE, on the STAGED plist only; the
# committed mac/Info.plist keeps its neutral placeholders:
#   WRITE_BUNDLE_ID          -> CFBundleIdentifier
#   WRITE_PRODUCT_ORIGIN=https://texttext.app
#                            -> SUFeedURL = <origin>/appcast.xml (the app also
#                               derives its default server origin from SUFeedURL)
#   WRITE_SPARKLE_PUBLIC_KEY -> SUPublicEDKey
set -euo pipefail
cd "$(dirname "$0")/.."
MAC="$(pwd)"
APP="$MAC/build/Write.app"
ENT="$MAC/write.entitlements"
PB=/usr/libexec/PlistBuddy

require_release_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "Refusing: $name must be set to build Write.app." >&2
    exit 1
  fi
}

require_release_env WRITE_BUNDLE_ID
require_release_env WRITE_PRODUCT_ORIGIN
require_release_env WRITE_SPARKLE_PUBLIC_KEY

# Stable signing keeps macOS trust anchored across rebuilds. Prefer an
# explicit WRITE_SIGN_ID, else auto-detect a local Developer ID Application
# identity, else fall back to ad-hoc.
SIGN_ID="${WRITE_SIGN_ID:-}"
if [ -z "$SIGN_ID" ]; then
  SIGN_ID="$(security find-identity -p codesigning -v 2>/dev/null | awk -F'"' '/Developer ID Application/{print $2; exit}')"
  [ -z "$SIGN_ID" ] && SIGN_ID="-"
fi

if [ -n "${WRITE_APP_GROUP:-}" ] && ! [[ "$WRITE_APP_GROUP" =~ ^group\.[A-Za-z0-9.-]+$ ]]; then
  echo "Refusing: WRITE_APP_GROUP is not a valid application group: $WRITE_APP_GROUP" >&2
  exit 1
fi

# A signed release with extension profiles but no group produces an appex that
# codesign accepts but File Provider cannot launch. Development ad-hoc builds
# may omit the group; a Developer ID build may not.
FP_PROFILE="$MAC/profiles/Write_FileProvider_Developer_ID.provisionprofile"
if [ "$SIGN_ID" != "-" ] && [ -f "$FP_PROFILE" ] && [ -z "${WRITE_APP_GROUP:-}" ]; then
  echo "Refusing: WRITE_APP_GROUP must be set for a signed File Provider build." >&2
  exit 1
fi

echo ">> swift build (release)"
swift build -c release --triple arm64-apple-macosx14.0 --package-path "$MAC"
BIN="$(swift build -c release --triple arm64-apple-macosx14.0 \
  --package-path "$MAC" --show-bin-path)"

echo ">> assembling $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" "$APP/Contents/Frameworks"
cp "$BIN/Write" "$APP/Contents/MacOS/Write"
cp "$MAC/Info.plist" "$APP/Contents/Info.plist"
if [ -f "$MAC/AppIcon.icns" ]; then
  cp "$MAC/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
else
  echo "   (no AppIcon.icns yet; run mac/scripts/make-icon.sh)"
fi
if [ -n "${WRITE_BUILD_ATTESTATION:-}" ]; then
  [ -f "$WRITE_BUILD_ATTESTATION" ] || {
    echo "WRITE_BUILD_ATTESTATION does not exist: $WRITE_BUILD_ATTESTATION" >&2
    exit 1
  }
  cp "$WRITE_BUILD_ATTESTATION" \
    "$APP/Contents/Resources/AppHealthBuildAttestation.json"
fi

echo ">> App Intents metadata (xcodebuild const-values pass)"
# SwiftPM cannot emit the .swiftconstvalues the App Intents metadata
# processor requires, so a parallel xcodebuild pass produces them; the shipped
# binary stays the SwiftPM one above. The derived-data cache makes this fast
# after the first release. Metadata failure fails the build: the intents
# would silently be invisible to Shortcuts otherwise.
xcodebuild build -scheme Write -destination 'platform=macOS,arch=arm64' \
  -configuration Release -derivedDataPath "$MAC/.build/xcode-dd" \
  SWIFT_EMIT_CONST_VALUES=YES CODE_SIGNING_ALLOWED=NO -quiet
CONSTVALS="$MAC/build/appintents-constvals.txt"
find "$MAC/.build/xcode-dd" -name '*.swiftconstvalues' | sort > "$CONSTVALS"
[ -s "$CONSTVALS" ] || { echo "xcodebuild emitted no .swiftconstvalues" >&2; exit 1; }
APPINTENTS_SWIFT_CONST_VALS_LIST="$CONSTVALS" "$MAC/scripts/appintents-metadata.sh" \
  "$APP/Contents/MacOS/Write" "$APP"
rm -f "$CONSTVALS"

STAGED="$APP/Contents/Info.plist"
"$PB" -c "Set :CFBundleIdentifier $WRITE_BUNDLE_ID" "$STAGED"
"$PB" -c "Set :SUFeedURL ${WRITE_PRODUCT_ORIGIN%/}/appcast.xml" "$STAGED"
"$PB" -c "Set :SUPublicEDKey $WRITE_SPARKLE_PUBLIC_KEY" "$STAGED"
# The app locates the share inbox by this group id (scan-based; the app itself
# needs no app-group entitlement). Empty leaves the WRITE_APP_GROUP placeholder,
# which the resolver ignores.
if [ -n "${WRITE_APP_GROUP:-}" ]; then
  "$PB" -c "Set :WriteAppGroupIdentifier $WRITE_APP_GROUP" "$STAGED" 2>/dev/null \
    || "$PB" -c "Add :WriteAppGroupIdentifier string $WRITE_APP_GROUP" "$STAGED"
fi
# The app and the File Provider extension share a keychain access group to hand
# the sync token across: the app cannot write the app-group container (that write
# is sandbox-gated), but the keychain is not. The group is
# <TeamID>.net.writeapp.write.fp; stamp the resolved value so both bundles read
# the same string at runtime (Info.plist WriteKeychainAccessGroup).
TEAM="$(printf '%s' "$SIGN_ID" | sed -n 's/.*(\([A-Z0-9]\{8,\}\))$/\1/p')"
if [ -n "$TEAM" ]; then
  KC_GROUP="$TEAM.net.writeapp.write.fp"
  "$PB" -c "Set :WriteKeychainAccessGroup $KC_GROUP" "$STAGED" 2>/dev/null \
    || "$PB" -c "Add :WriteKeychainAccessGroup string $KC_GROUP" "$STAGED"
fi
if [ -n "${APP_VERSION:-}" ]; then
  [[ "$APP_VERSION" =~ ^[0-9]+(\.[0-9]+)+$ ]] || {
    echo "APP_VERSION must be dotted numeric, got: $APP_VERSION" >&2
    exit 1
  }
  "$PB" -c "Set :CFBundleShortVersionString $APP_VERSION" "$STAGED"
fi
if [ -n "${APP_BUILD_NUMBER:-}" ]; then
  [[ "$APP_BUILD_NUMBER" =~ ^[1-9][0-9]*$ ]] || {
    echo "APP_BUILD_NUMBER must be a positive integer, got: $APP_BUILD_NUMBER" >&2
    exit 1
  }
  "$PB" -c "Set :CFBundleVersion $APP_BUILD_NUMBER" "$STAGED"
fi

# Sparkle framework (auto-update): embed + make it discoverable via rpath.
if [ -d "$BIN/Sparkle.framework" ]; then
  cp -R "$BIN/Sparkle.framework" "$APP/Contents/Frameworks/Sparkle.framework"
  install_name_tool -add_rpath "@executable_path/../Frameworks" "$APP/Contents/MacOS/Write" 2>/dev/null || true
else
  echo "!! Sparkle.framework not found in $BIN" >&2
  exit 1
fi
chmod +x "$APP/Contents/MacOS/Write"

codesign_one() { # $1=path  $2=entitlements (optional)
  local path="$1" ent="${2:-}"
  local args=(--force)
  if [ "$SIGN_ID" = "-" ]; then
    args+=(--sign -)
  else
    # Hardened runtime + secure timestamp: both required for notarization.
    args+=(--options runtime --timestamp --sign "$SIGN_ID")
  fi
  [ -n "$ent" ] && args+=(--entitlements "$ent")
  codesign "${args[@]}" "$path"
}

# The main app carries the app-group entitlement so it can write the File
# Provider credential handoff into the shared container the sandboxed extension
# reads. That is a restricted entitlement: it needs an embedded Developer ID
# provisioning profile authorizing the group. With the profile present (and a
# real identity + WRITE_APP_GROUP), sign with the app-group entitlement; without
# it, sign with empty entitlements so dev/ad-hoc builds still succeed (the File
# Provider just cannot authenticate).
APP_PROFILE="$MAC/profiles/Write_App_Developer_ID.provisionprofile"
MAIN_ENT="$(mktemp -t write-main-ent)"
if [ -f "$APP_PROFILE" ] && [ "$SIGN_ID" != "-" ] && [ -n "${WRITE_APP_GROUP:-}" ]; then
  cp "$APP_PROFILE" "$APP/Contents/embedded.provisionprofile"
  # codesign does NOT expand $(AppIdentifierPrefix); substitute the resolved
  # team-prefixed keychain group (computed above) just like the app group.
  /usr/bin/sed \
    -e "s/WRITE_APP_GROUP/${WRITE_APP_GROUP}/g" \
    -e "s/WRITE_KEYCHAIN_GROUP/${KC_GROUP:-}/g" \
    "$ENT" > "$MAIN_ENT"
  echo ">> main app: app-group + keychain entitlement + embedded profile"
else
  printf '%s\n' \
    '<?xml version="1.0" encoding="UTF-8"?>' \
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">' \
    '<plist version="1.0"><dict/></plist>' > "$MAIN_ENT"
  echo ">> main app: no app-group profile; signing without the app-group entitlement"
fi

echo ">> codesigning inside-out ($SIGN_ID)"
SPK="$APP/Contents/Frameworks/Sparkle.framework"
if [ "$SIGN_ID" = "-" ]; then
  codesign --force --deep --sign - "$SPK"   # ad-hoc: deep is fine for local dev
else
  # Developer ID: Sparkle's nested helpers first, then the framework. Never
  # use --deep with a real identity.
  V="$SPK/Versions/B"
  for n in "XPCServices/Installer.xpc" "XPCServices/Downloader.xpc" "Autoupdate" "Updater.app"; do
    [ -e "$V/$n" ] && codesign_one "$V/$n"
  done
  codesign_one "$SPK"
fi
codesign_one "$APP/Contents/MacOS/Write" "$MAIN_ENT"
# Extensions are assembled and signed here, inside-out, so the main app's
# signature (next line) seals them. No-op unless mac/profiles/ holds the
# provisioning profiles and a real Developer ID identity is in use.
"$MAC/scripts/embed-extensions.sh" "$APP" "$SIGN_ID" "${WRITE_APP_GROUP:-}" \
  "$WRITE_BUNDLE_ID" \
  "$("$PB" -c 'Print :CFBundleShortVersionString' "$STAGED")" \
  "$("$PB" -c 'Print :CFBundleVersion' "$STAGED")"
codesign_one "$APP" "$MAIN_ENT"
rm -f "$MAIN_ENT"

echo ">> verify"
codesign --verify --strict --verbose=2 "$APP"
if [ "$SIGN_ID" = "-" ]; then
  "$MAC/scripts/verify-apple-silicon-app.sh" "$APP"
else
  "$MAC/scripts/verify-apple-silicon-app.sh" "$APP" --require-extensions
fi
echo ">> built $APP"
