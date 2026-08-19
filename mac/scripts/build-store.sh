#!/usr/bin/env bash
# Build the App Store edition of TextText.app: sandboxed, no Sparkle, signed
# Apple Distribution against the MAC_APP_STORE profiles in mac/profiles.
#
#   mac/scripts/build-store.sh              -> distribution build, for upload
#   TEXTTEXT_STORE_LOCAL=1 mac/scripts/build-store.sh
#                                           -> the same shape, signed for
#                                              development so it runs on this Mac
#
# The two exist because a distribution-signed build cannot launch outside the
# App Store or TestFlight: macOS refuses to spawn it ("Launchd job spawn
# failed"). Testing the Store shape locally needs a development identity and a
# MAC_APP_DEVELOPMENT profile naming this Mac, which is what the LOCAL mode
# selects. Same sandbox, same entitlements, same app group either way, so what
# gets tested is what gets uploaded.
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT="$(pwd)"

# SwiftPM rewrites Package.resolved to match the Store-only manifest, which
# intentionally excludes Sparkle. Preserve the standalone lockfile so preparing
# a TestFlight package cannot silently dirty or weaken the Developer ID lane.
PACKAGE_RESOLVED="$ROOT/mac/Package.resolved"
PACKAGE_RESOLVED_BACKUP="$(mktemp "${TMPDIR:-/tmp}/texttext-package-resolved.XXXXXX")"
PACKAGE_RESOLVED_PRESENT=0
if [ -f "$PACKAGE_RESOLVED" ]; then
  cp "$PACKAGE_RESOLVED" "$PACKAGE_RESOLVED_BACKUP"
  PACKAGE_RESOLVED_PRESENT=1
fi
restore_package_resolution() {
  local status=$?
  trap - EXIT
  if [ "$PACKAGE_RESOLVED_PRESENT" = "1" ]; then
    cp "$PACKAGE_RESOLVED_BACKUP" "$PACKAGE_RESOLVED"
  else
    rm -f "$PACKAGE_RESOLVED"
  fi
  rm -f "$PACKAGE_RESOLVED_BACKUP"
  exit "$status"
}
trap restore_package_resolution EXIT

export TEXTTEXT_STORE=1
export TEXTTEXT_BUNDLE_ID="${TEXTTEXT_BUNDLE_ID:-app.texttext.mac}"
export TEXTTEXT_PRODUCT_ORIGIN="${TEXTTEXT_PRODUCT_ORIGIN:-https://texttext.app}"
# build-app.sh prefixes this with the team for a Store build, because the
# provisioning profile only grants groups matching "<team>.*".
export TEXTTEXT_APP_GROUP="${TEXTTEXT_APP_GROUP:-group.app.texttext}"

if [ "${TEXTTEXT_STORE_LOCAL:-0}" = "1" ]; then
  export TEXTTEXT_STORE_PROFILE_SUFFIX="Dev"
  IDENTITY_MATCH="Apple Development"
else
  export TEXTTEXT_STORE_PROFILE_SUFFIX="AppStore"
  IDENTITY_MATCH="Apple Distribution"
fi

if [ -z "${TEXTTEXT_SIGN_ID:-}" ]; then
  TEXTTEXT_SIGN_ID="$(security find-identity -p codesigning -v 2>/dev/null \
    | awk -F'"' -v m="$IDENTITY_MATCH" '$0 ~ m {print $2; exit}')"
  if [ -z "$TEXTTEXT_SIGN_ID" ]; then
    echo "Refusing: no \"$IDENTITY_MATCH\" identity in the keychain." >&2
    exit 1
  fi
  export TEXTTEXT_SIGN_ID
fi

echo ">> Store edition ($IDENTITY_MATCH)"
"$ROOT/mac/scripts/build-app.sh"
