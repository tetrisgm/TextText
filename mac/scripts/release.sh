#!/usr/bin/env bash
# Cut a Write.app release from the owner's Mac: bump, build, sign, notarize,
# staple, zip, sign the Sparkle appcast, then upload. No CI secrets; the
# local Developer ID cert, the notarytool profile, and the Sparkle private
# key in the login keychain do all the work.
#
# Usage:
#   WRITE_NOTARY_PROFILE=write-notary \
#   WRITE_BUNDLE_ID=<real bundle id> \
#   WRITE_PRODUCT_ORIGIN=https://texttext.app \
#   WRITE_SPARKLE_PUBLIC_KEY=<EdDSA public key> \
#   mac/scripts/release.sh <version X.Y>
#
# Ordering is load-bearing (a push must never point at a 404):
#   1. versioned zip is built and uploaded first (immutable URL)
#   2. appcast.xml is generated AFTER dist holds exactly one archive of the
#      version
#   3. versioned appcast is uploaded after the zip
#   4. src/generated/app-release.ts is updated; the outer ship command deploys
#      the website last, which flips /appcast.xml and /api/app/version
set -euo pipefail
cd "$(dirname "$0")/.."
MAC="$(pwd)"
PB=/usr/libexec/PlistBuddy
SPK="$MAC/.build/artifacts/sparkle/Sparkle/bin"

VERSION="${1:-}"
if ! [[ "$VERSION" =~ ^[0-9]+(\.[0-9]+)+$ ]]; then
  echo "Usage: mac/scripts/release.sh <version, e.g. 0.2>" >&2
  exit 1
fi

require_release_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "Refusing: $name must be set for a release." >&2
    exit 1
  fi
}

require_release_env WRITE_NOTARY_PROFILE
require_release_env WRITE_PRODUCT_ORIGIN
require_release_env WRITE_SPARKLE_PUBLIC_KEY
require_release_env WRITE_BUNDLE_ID
require_release_env WRITE_APP_GROUP

ORIGIN="${WRITE_PRODUCT_ORIGIN%/}"

# 1. Bump. CFBundleVersion is Sparkle's monotonic comparison key; it is
# auto-incremented here so no human ever hand-edits it. Advance past BOTH the
# source build AND any already-installed build: a ship that installed build N
# and then failed before the release commit landed restores the source to N-1,
# so a naive +1 would recompute the SAME N on retry and trip the "not newer than
# installed" guard below forever. Taking the max makes every retry move forward.
SOURCE_BUILD="$("$PB" -c 'Print :CFBundleVersion' "$MAC/Info.plist")"
INSTALLED_BUILD_FOR_BUMP=0
BUMP_INSTALLED_APP="${WRITE_INSTALLED_APP_PATH:-}"
if [ -z "$BUMP_INSTALLED_APP" ]; then
  for candidate in /Applications/Write.app "$HOME/Applications/Write.app"; do
    if [ -d "$candidate" ]; then BUMP_INSTALLED_APP="$candidate"; break; fi
  done
fi
if [ -n "$BUMP_INSTALLED_APP" ] && [ -f "$BUMP_INSTALLED_APP/Contents/Info.plist" ]; then
  INSTALLED_BUILD_FOR_BUMP="$("$PB" -c 'Print :CFBundleVersion' "$BUMP_INSTALLED_APP/Contents/Info.plist" 2>/dev/null || echo 0)"
fi
BUILD=$(( ( SOURCE_BUILD > INSTALLED_BUILD_FOR_BUMP ? SOURCE_BUILD : INSTALLED_BUILD_FOR_BUMP ) + 1 ))
"$PB" -c "Set :CFBundleShortVersionString $VERSION" "$MAC/Info.plist"
"$PB" -c "Set :CFBundleVersion $BUILD" "$MAC/Info.plist"
echo ">> version v$VERSION (build $BUILD)"

echo ">> [1/5] build + sign"
ATTESTATION="$MAC/build/app-health-attestation.json"
"$MAC/scripts/write-build-attestation.sh" "$ATTESTATION" "$VERSION" "$BUILD"
WRITE_BUILD_ATTESTATION="$ATTESTATION" "$MAC/scripts/build-app.sh"
"$MAC/scripts/verify-app-health.sh" "$MAC/build/Write.app" "$VERSION" "$BUILD"

echo ">> [2/5] notarize + staple"
"$MAC/scripts/notarize.sh"

echo ">> [3/5] package dist/Write-$VERSION.zip"
rm -rf "$MAC/dist" && mkdir -p "$MAC/dist"
ditto -c -k --keepParent "$MAC/build/Write.app" "$MAC/dist/Write-$VERSION.zip"

echo ">> [4/5] sign the Sparkle appcast"
if [ ! -x "$SPK/generate_appcast" ]; then
  echo "Sparkle tools missing; run: swift build --package-path mac" >&2
  exit 1
fi
if [ -z "${BLOB_READ_WRITE_TOKEN:-}" ]; then
  echo "BLOB_READ_WRITE_TOKEN must be set to publish (pull it from Vercel)." >&2
  exit 1
fi
# The appcast enclosure must be the IMMUTABLE Blob URL of the zip, not an
# /download/ route (that route only serves the stable Write.zip alias, which
# resolves through the release pointer). Derive the public Blob base from the
# token exactly as src/lib/app-release.ts does.
STORE_ID="$(printf '%s' "$BLOB_READ_WRITE_TOKEN" | sed -n 's/^vercel_blob_rw_\([A-Za-z0-9]*\)_.*$/\1/p' | tr 'A-Z' 'a-z')"
if [ -z "$STORE_ID" ]; then
  echo "Could not derive the Blob base from BLOB_READ_WRITE_TOKEN." >&2
  exit 1
fi
BLOB_BASE="https://$STORE_ID.public.blob.vercel-storage.com"
# Key source: SPARKLE_ED_KEY_FILE if set, else the login keychain (prompts
# once; click "Always Allow"). generate_appcast aborts if dist holds two
# archives of one version, which is why dist was recreated above.
if [ -n "${SPARKLE_ED_KEY_FILE:-}" ]; then
  "$SPK/generate_appcast" --ed-key-file "$SPARKLE_ED_KEY_FILE" \
    --download-url-prefix "$BLOB_BASE/downloads/" "$MAC/dist"
else
  "$SPK/generate_appcast" --download-url-prefix "$BLOB_BASE/downloads/" "$MAC/dist"
fi

echo ">> verify staged appcast"
APP_PLIST="$MAC/build/Write.app/Contents/Info.plist"
APPCAST="$MAC/dist/appcast.xml"
APP_VERSION="$("$PB" -c 'Print :CFBundleShortVersionString' "$APP_PLIST")"
APP_BUILD="$("$PB" -c 'Print :CFBundleVersion' "$APP_PLIST")"
APP_FEED="$("$PB" -c 'Print :SUFeedURL' "$APP_PLIST")"
APP_PUBLIC_KEY="$("$PB" -c 'Print :SUPublicEDKey' "$APP_PLIST")"
APPCAST_BUILD="$(sed -n 's|.*<sparkle:version>\([0-9][0-9]*\)</sparkle:version>.*|\1|p' "$APPCAST" | head -1)"
APPCAST_VERSION="$(sed -n 's|.*<sparkle:shortVersionString>\([^<]*\)</sparkle:shortVersionString>.*|\1|p' "$APPCAST" | head -1)"
APPCAST_HARDWARE_REQUIREMENTS="$(sed -n 's|.*<sparkle:hardwareRequirements>\([^<]*\)</sparkle:hardwareRequirements>.*|\1|p' "$APPCAST" | head -1)"
APPCAST_ZIP_URL="$(sed -n 's|.*<enclosure[^>]* url="\([^"]*\)".*|\1|p' "$APPCAST" | head -1)"
APPCAST_SIGNATURE="$(sed -n 's|.*<enclosure[^>]* sparkle:edSignature="\([^"]*\)".*|\1|p' "$APPCAST" | head -1)"
EXPECTED_ZIP_URL="$BLOB_BASE/downloads/Write-$VERSION.zip"

[ "$APP_VERSION" = "$VERSION" ] || { echo "Built app version is $APP_VERSION, expected $VERSION." >&2; exit 1; }
[ "$APP_BUILD" = "$BUILD" ] || { echo "Built app build is $APP_BUILD, expected $BUILD." >&2; exit 1; }
[ "$APP_FEED" = "$ORIGIN/appcast.xml" ] || { echo "Built app feed is $APP_FEED, expected $ORIGIN/appcast.xml." >&2; exit 1; }
[ -n "$APP_PUBLIC_KEY" ] && [ "$APP_PUBLIC_KEY" != "REPLACE_WITH_SPARKLE_PUBLIC_KEY" ] || { echo "Built app has no real Sparkle public key." >&2; exit 1; }
[ "$APPCAST_VERSION" = "$VERSION" ] || { echo "Appcast shortVersionString is $APPCAST_VERSION, expected $VERSION." >&2; exit 1; }
[ "$APPCAST_BUILD" = "$BUILD" ] || { echo "Appcast sparkle:version is $APPCAST_BUILD, expected $BUILD." >&2; exit 1; }
[ "$APPCAST_HARDWARE_REQUIREMENTS" = "arm64" ] || { echo "Appcast hardware requirement is '$APPCAST_HARDWARE_REQUIREMENTS', expected arm64." >&2; exit 1; }
[ "$APPCAST_ZIP_URL" = "$EXPECTED_ZIP_URL" ] || { echo "Appcast zip URL is $APPCAST_ZIP_URL, expected $EXPECTED_ZIP_URL." >&2; exit 1; }
[ -n "$APPCAST_SIGNATURE" ] || { echo "Appcast enclosure is missing sparkle:edSignature." >&2; exit 1; }

INSTALLED_APP="${WRITE_INSTALLED_APP_PATH:-}"
if [ -z "$INSTALLED_APP" ]; then
  for candidate in /Applications/Write.app "$HOME/Applications/Write.app"; do
    if [ -d "$candidate" ]; then
      INSTALLED_APP="$candidate"
      break
    fi
  done
fi
if [ -n "$INSTALLED_APP" ] && [ -f "$INSTALLED_APP/Contents/Info.plist" ]; then
  INSTALLED_VERSION="$("$PB" -c 'Print :CFBundleShortVersionString' "$INSTALLED_APP/Contents/Info.plist")"
  INSTALLED_BUILD="$("$PB" -c 'Print :CFBundleVersion' "$INSTALLED_APP/Contents/Info.plist")"
  echo "   installed app: $INSTALLED_VERSION ($INSTALLED_BUILD)"
  if [ "$APPCAST_BUILD" -le "$INSTALLED_BUILD" ]; then
    echo "Appcast build $APPCAST_BUILD is not newer than installed build $INSTALLED_BUILD." >&2
    exit 1
  fi
else
  echo "No installed Write.app found; skipping installed-build comparison."
fi
echo "   built app: $APP_VERSION ($APP_BUILD)"
echo "   appcast:   $APPCAST_VERSION ($APPCAST_BUILD, $APPCAST_HARDWARE_REQUIREMENTS)"
echo "   feed:      $APP_FEED"
echo "   zip:       $APPCAST_ZIP_URL"

echo ">> [5/5] upload artifacts"
# Uploads immutable Write-$VERSION.zip and appcast-$VERSION.xml, then writes
# src/generated/app-release.ts. The outer ship command deploys that generated
# marker so /appcast.xml, /download/*, and /api/app/version flip together.
( cd "$MAC/.." && node scripts/publish-mac-release.mjs "$VERSION" )

echo
echo "Released v$VERSION (build $BUILD)"
echo "  feed:     $ORIGIN/appcast.xml"
echo "  download: $ORIGIN/download/Write.zip"
