#!/usr/bin/env bash
# Notarize + staple mac/build/Texttext.app so Gatekeeper fully accepts it.
#
# REFUSES to run unless WRITE_NOTARY_PROFILE is set: notarization submits the
# binary to Apple, and that must never happen implicitly.
#
# ONE-TIME owner setup (needs your Apple credentials; nothing is committed):
#   1. Create an app-specific password at appleid.apple.com
#      (Sign-In & Security -> App-Specific Passwords).
#   2. Store a reusable notarytool profile in your login keychain:
#        xcrun notarytool store-credentials "write-notary" \
#          --apple-id "<apple-id-email>" --team-id "<TEAMID>"
#      (paste the app-specific password when prompted)
#
# Then: WRITE_NOTARY_PROFILE=write-notary mac/scripts/notarize.sh
set -euo pipefail
cd "$(dirname "$0")/.."
MAC="$(pwd)"
APP="$MAC/build/Texttext.app"
ZIP="$MAC/build/Texttext-notarize.zip"

PROFILE="${WRITE_NOTARY_PROFILE:-}"
if [ -z "$PROFILE" ]; then
  echo "Refusing to submit: WRITE_NOTARY_PROFILE is not set." >&2
  echo "Set it to your notarytool keychain profile, e.g.:" >&2
  echo "  WRITE_NOTARY_PROFILE=write-notary mac/scripts/notarize.sh" >&2
  echo "(One-time setup instructions are at the top of this script.)" >&2
  exit 1
fi

[ -d "$APP" ] || { echo "Build the app first: mac/scripts/build-app.sh" >&2; exit 1; }

echo ">> zipping the app for submission (ditto, never zip -r)"
rm -f "$ZIP"
ditto -c -k --keepParent "$APP" "$ZIP"

echo ">> submitting to Apple notary service (waits; usually 1-5 min)"
xcrun notarytool submit "$ZIP" --keychain-profile "$PROFILE" --wait
# Debug rejections with:
#   xcrun notarytool log <submission-id> --keychain-profile "$PROFILE"
# (it names the offending nested binary)

echo ">> stapling the ticket to the app"
xcrun stapler staple "$APP"
xcrun stapler validate "$APP"
rm -f "$ZIP"
echo ">> notarized + stapled: $APP"
spctl -a -vvv -t exec "$APP" 2>&1 | head -3 || true
