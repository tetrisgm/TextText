#!/usr/bin/env bash
# One-command Write ship entry point. This is the owner-facing command:
# verify the web app, cut the Mac app release, then deploy the public download
# and appcast routes as the final version marker. The lower-level release
# script builds and uploads immutable artifacts before the web deploy flips.
#
# Usage:
#   release/ship.sh                 # bumps the last version component
#   release/ship.sh 0.13            # explicit version
#   release/ship.sh 0.13 --allow-dirty
#   release/ship.sh 0.13 --dry-run  # verify/build locally; publish nothing
#   release/ship.sh 0.13 --no-publish
#   release/ship.sh 0.13 --skip-tests
#   release/ship.sh 0.13 --skip-web-deploy
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
PB=/usr/libexec/PlistBuddy

# Write's public release identity is product configuration, not secret input.
# Keep it here so the owner-facing command is genuinely one command.
export WRITE_NOTARY_PROFILE="${WRITE_NOTARY_PROFILE:-write-notary}"
export WRITE_BUNDLE_ID="${WRITE_BUNDLE_ID:-net.writeapp.write.mac}"
export WRITE_PRODUCT_ORIGIN="${WRITE_PRODUCT_ORIGIN:-https://write.ramine.net}"
export WRITE_SPARKLE_PUBLIC_KEY="${WRITE_SPARKLE_PUBLIC_KEY:-qFmaq5ijn3m2sbiadmkBVvGIjz8v9+piqE/T+YZ1/u0=}"

VERSION=""
ALLOW_DIRTY=0
SKIP_TESTS=0
SKIP_WEB_DEPLOY=0
NO_PUBLISH=0

usage() {
  sed -n '1,15p' "$0" >&2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --allow-dirty) ALLOW_DIRTY=1 ;;
    --dry-run|--no-publish) NO_PUBLISH=1 ;;
    --skip-tests) SKIP_TESTS=1 ;;
    --skip-web-deploy) SKIP_WEB_DEPLOY=1 ;;
    -h|--help) usage; exit 0 ;;
    -*)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
    *)
      if [ -n "$VERSION" ]; then
        echo "Only one version may be supplied." >&2
        exit 1
      fi
      VERSION="$1"
      ;;
  esac
  shift
done

next_version() {
  local current
  current="$("$PB" -c 'Print :CFBundleShortVersionString' "$ROOT/mac/Info.plist")"
  python3 - "$current" <<'PY'
import sys
parts = sys.argv[1].split(".")
if len(parts) < 2 or not all(part.isdigit() for part in parts):
    raise SystemExit(f"Cannot bump version: {sys.argv[1]}")
parts[-1] = str(int(parts[-1]) + 1)
print(".".join(parts))
PY
}

if [ -z "$VERSION" ]; then
  VERSION="$(next_version)"
fi

if ! [[ "$VERSION" =~ ^[0-9]+(\.[0-9]+)+$ ]]; then
  echo "Version must be dotted numeric, got: $VERSION" >&2
  usage
  exit 1
fi

if [ "$ALLOW_DIRTY" != "1" ] && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  dirty="$(git status --porcelain --untracked-files=no)"
  if [ -n "$dirty" ]; then
    echo "Refusing to ship with dirty tracked files. Commit or pass --allow-dirty." >&2
    git status --short --untracked-files=no >&2
    exit 1
  fi
fi

echo ">> ship Write $VERSION"

if [ "$SKIP_TESTS" != "1" ]; then
  echo ">> verify TypeScript"
  npx tsc --noEmit
  echo ">> test web"
  npm test
  echo ">> test Mac package"
  swift test --package-path "$ROOT/mac"
  echo ">> verify Next build"
  npm run build
fi

if [ "$NO_PUBLISH" = "1" ]; then
  echo ">> dry-run Mac app build"
  DRY_BUILD="$(( $("$PB" -c 'Print :CFBundleVersion' "$ROOT/mac/Info.plist") + 1 ))"
  APP_VERSION="$VERSION" \
  APP_BUILD_NUMBER="$DRY_BUILD" \
    "$ROOT/mac/scripts/build-app.sh"
  DRY_PLIST="$ROOT/mac/build/Write.app/Contents/Info.plist"
  [ "$("$PB" -c 'Print :CFBundleShortVersionString' "$DRY_PLIST")" = "$VERSION" ]
  [ "$("$PB" -c 'Print :CFBundleVersion' "$DRY_PLIST")" = "$DRY_BUILD" ]
  [ "$("$PB" -c 'Print :SUFeedURL' "$DRY_PLIST")" = "${WRITE_PRODUCT_ORIGIN%/}/appcast.xml" ]
  echo
  echo "Verified Write $VERSION (not published)"
  echo "  web build: .next"
  echo "  app build: mac/build/Write.app ($VERSION build $DRY_BUILD)"
  exit 0
fi

if [ -z "${BLOB_READ_WRITE_TOKEN:-}" ]; then
  export BLOB_READ_WRITE_TOKEN="$(node --input-type=module <<'NODE'
import pkg from "@next/env";
pkg.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
process.stdout.write(process.env.BLOB_READ_WRITE_TOKEN ?? "");
NODE
)"
fi

echo ">> release Mac app"
"$ROOT/mac/scripts/release.sh" "$VERSION"

if [ "$SKIP_WEB_DEPLOY" != "1" ]; then
  echo ">> deploy public web app"
  npx vercel --prod --yes
fi

ORIGIN="${WRITE_PRODUCT_ORIGIN:-}"
if [ -n "$ORIGIN" ]; then
  ORIGIN="${ORIGIN%/}"
  EXPECTED_BUILD="$("$PB" -c 'Print :CFBundleVersion' "$ROOT/mac/Info.plist")"
  VERIFY_QUERY="ship_verify=$(date +%s)-$$"
  echo ">> verify public release"
  PUBLIC_APPCAST="$(curl -fsS -H 'Cache-Control: no-cache' "$ORIGIN/appcast.xml?$VERIFY_QUERY")"
  PUBLIC_VERSION="$(printf '%s' "$PUBLIC_APPCAST" | sed -n 's|.*<sparkle:shortVersionString>\([^<]*\)</sparkle:shortVersionString>.*|\1|p' | head -1)"
  PUBLIC_BUILD="$(printf '%s' "$PUBLIC_APPCAST" | sed -n 's|.*<sparkle:version>\([0-9][0-9]*\)</sparkle:version>.*|\1|p' | head -1)"
  PUBLIC_ZIP_URL="$(printf '%s' "$PUBLIC_APPCAST" | sed -n 's|.*<enclosure[^>]* url="\([^"]*\)".*|\1|p' | head -1)"
  PUBLIC_SIGNATURE="$(printf '%s' "$PUBLIC_APPCAST" | sed -n 's|.*<enclosure[^>]* sparkle:edSignature="\([^"]*\)".*|\1|p' | head -1)"
  [ "$PUBLIC_VERSION" = "$VERSION" ] || { echo "Public appcast version is $PUBLIC_VERSION, expected $VERSION." >&2; exit 1; }
  [ "$PUBLIC_BUILD" = "$EXPECTED_BUILD" ] || { echo "Public appcast build is $PUBLIC_BUILD, expected $EXPECTED_BUILD." >&2; exit 1; }
  [ -n "$PUBLIC_ZIP_URL" ] || { echo "Public appcast is missing an enclosure URL." >&2; exit 1; }
  [ -n "$PUBLIC_SIGNATURE" ] || { echo "Public appcast enclosure is missing sparkle:edSignature." >&2; exit 1; }
  curl -fsSI "$PUBLIC_ZIP_URL" >/dev/null
  curl -fsSI "$ORIGIN/download/Write.zip" >/dev/null
  PUBLIC_API="$(curl -fsS -H 'Cache-Control: no-cache' "$ORIGIN/api/app/version?$VERIFY_QUERY")"
  API_VERSION="$(printf '%s' "$PUBLIC_API" | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])')"
  API_BUILD="$(printf '%s' "$PUBLIC_API" | python3 -c 'import json,sys; print(json.load(sys.stdin)["buildNumber"])')"
  [ "$API_VERSION" = "$VERSION" ] || { echo "Public app version API is $API_VERSION, expected $VERSION." >&2; exit 1; }
  [ "$API_BUILD" = "$EXPECTED_BUILD" ] || { echo "Public app build API is $API_BUILD, expected $EXPECTED_BUILD." >&2; exit 1; }
  echo "   appcast:  $PUBLIC_VERSION ($PUBLIC_BUILD)"
  echo "   zip:      $PUBLIC_ZIP_URL"
  echo "   version:  $API_VERSION ($API_BUILD)"
fi

echo ">> install verified Mac app"
INSTALL_PATH="${WRITE_INSTALLED_APP_PATH:-/Applications/Write.app}"
INSTALL_PARENT="$(dirname "$INSTALL_PATH")"
INSTALL_NEW="$INSTALL_PARENT/.Write.app.new.$$"
INSTALL_OLD="$INSTALL_PARENT/.Write.app.previous.$$"
rm -rf "$INSTALL_NEW" "$INSTALL_OLD"
ditto "$ROOT/mac/build/Write.app" "$INSTALL_NEW"
osascript -e 'tell application id "net.writeapp.write.mac" to quit' >/dev/null 2>&1 || true
for _ in 1 2 3 4 5; do
  pgrep -x Write >/dev/null 2>&1 || break
  sleep 0.4
done
if [ -e "$INSTALL_PATH" ]; then mv "$INSTALL_PATH" "$INSTALL_OLD"; fi
mv "$INSTALL_NEW" "$INSTALL_PATH"
rm -rf "$INSTALL_OLD"
defaults write net.writeapp.write.mac SUEnableAutomaticChecks -bool true
defaults write net.writeapp.write.mac SUAutomaticallyUpdate -bool true
open -a "$INSTALL_PATH"
sleep 1
INSTALLED_VERSION="$("$PB" -c 'Print :CFBundleShortVersionString' "$INSTALL_PATH/Contents/Info.plist")"
INSTALLED_BUILD="$("$PB" -c 'Print :CFBundleVersion' "$INSTALL_PATH/Contents/Info.plist")"
[ "$INSTALLED_VERSION" = "$VERSION" ] || { echo "Installed app version is $INSTALLED_VERSION, expected $VERSION." >&2; exit 1; }
[ "$INSTALLED_BUILD" = "$EXPECTED_BUILD" ] || { echo "Installed app build is $INSTALLED_BUILD, expected $EXPECTED_BUILD." >&2; exit 1; }
codesign --verify --strict --verbose=2 "$INSTALL_PATH"
pgrep -x Write >/dev/null || { echo "Installed Write app did not launch." >&2; exit 1; }
echo "   installed: $INSTALLED_VERSION ($INSTALLED_BUILD)"

echo
echo "Shipped Write $VERSION"
if [ -n "$ORIGIN" ]; then
  echo "  download: $ORIGIN/download"
  echo "  appcast:  $ORIGIN/appcast.xml"
fi
