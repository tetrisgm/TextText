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
