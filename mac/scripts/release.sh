#!/usr/bin/env bash
# Cut a Write.app release from the owner's Mac: bump, build, sign, notarize,
# staple, zip, sign the Sparkle appcast, then upload. No CI secrets; the
# local Developer ID cert, the notarytool profile, and the Sparkle private
# key in the login keychain do all the work.
#
# Usage:
#   WRITE_NOTARY_PROFILE=write-notary \
#   WRITE_BUNDLE_ID=<real bundle id> \
#   WRITE_PRODUCT_ORIGIN=https://<product-domain> \
#   WRITE_SPARKLE_PUBLIC_KEY=<EdDSA public key> \
#   mac/scripts/release.sh <version X.Y>
#
# Ordering is load-bearing (a push must never point at a 404):
#   1. versioned zip is built and uploaded first (immutable URL)
#   2. appcast.xml is generated AFTER dist holds exactly one archive of the
#      version, and uploaded after the zip
#   3. the stable /download/Write.zip alias flips AFTER the appcast
#   4. the advertised app-version marker (GET /api/app/version) flips LAST
set -euo pipefail
cd "$(dirname "$0")/.."
MAC="$(pwd)"
PB=/usr/libexec/PlistBuddy
SPK="$MAC/.build/artifacts/sparkle/Sparkle/bin"
ORIGIN="${WRITE_PRODUCT_ORIGIN:-https://write.example.com}"
ORIGIN="${ORIGIN%/}"

VERSION="${1:-}"
if ! [[ "$VERSION" =~ ^[0-9]+(\.[0-9]+)+$ ]]; then
  echo "Usage: mac/scripts/release.sh <version, e.g. 0.2>" >&2
  exit 1
fi
if [ -z "${WRITE_NOTARY_PROFILE:-}" ]; then
  echo "Refusing: WRITE_NOTARY_PROFILE must be set for a release (see notarize.sh)." >&2
  exit 1
fi

# 1. Bump. CFBundleVersion is Sparkle's monotonic comparison key; it is
# auto-incremented here so no human ever hand-edits it.
BUILD="$(( $("$PB" -c 'Print :CFBundleVersion' "$MAC/Info.plist") + 1 ))"
"$PB" -c "Set :CFBundleShortVersionString $VERSION" "$MAC/Info.plist"
"$PB" -c "Set :CFBundleVersion $BUILD" "$MAC/Info.plist"
echo ">> version v$VERSION (build $BUILD)"

echo ">> [1/5] build + sign"
"$MAC/scripts/build-app.sh"

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

echo ">> [5/5] upload artifacts + flip the release pointer"
# Uploads Write-$VERSION.zip (immutable) then appcast.xml, then writes
# releases/mac/current.json LAST. /appcast.xml, /download/*, and
# /api/app/version all resolve through that pointer.
( cd "$MAC/.." && node scripts/publish-mac-release.mjs "$VERSION" "$BUILD" )

echo
echo "Released v$VERSION (build $BUILD)"
echo "  feed:     $ORIGIN/appcast.xml"
echo "  download: $ORIGIN/download/Write.zip"
