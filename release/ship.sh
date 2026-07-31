#!/usr/bin/env bash
# One-command Texttext ship entry point. This is the owner-facing command:
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
#   release/ship.sh 0.13 --local-install
#   release/ship.sh 0.13 --skip-tests
#   release/ship.sh 0.13 --skip-web-deploy
set -euo pipefail
exec </dev/null
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
PB=/usr/libexec/PlistBuddy

mkdir -p "$ROOT/.write"
SHIP_LOCK="$ROOT/.write/delivery.lock"
acquire_ship_lock() {
  local owner_pid=""
  if mkdir "$SHIP_LOCK" 2>/dev/null; then
    printf '%s\n' "$$" > "$SHIP_LOCK/pid"
    printf '%s\n' "ship" > "$SHIP_LOCK/lane"
    printf '%s\n' "$ROOT" > "$SHIP_LOCK/repository"
    return 0
  fi
  if [ "$(cat "$SHIP_LOCK/lane" 2>/dev/null || true)" = "work" ]; then
    echo "An active Texttext work unit owns the delivery lane." >&2
    exit 75
  fi
  owner_pid="$(cat "$SHIP_LOCK/pid" 2>/dev/null || true)"
  if [ -n "$owner_pid" ] && kill -0 "$owner_pid" 2>/dev/null; then
    echo "Another Texttext ship owns the release lock (pid $owner_pid)." >&2
    exit 75
  fi
  rm -rf "$SHIP_LOCK"
  mkdir "$SHIP_LOCK" || exit 75
  printf '%s\n' "$$" > "$SHIP_LOCK/pid"
  printf '%s\n' "ship" > "$SHIP_LOCK/lane"
  printf '%s\n' "$ROOT" > "$SHIP_LOCK/repository"
}
release_ship_lock() {
  if [ "$(cat "$SHIP_LOCK/pid" 2>/dev/null || true)" = "$$" ]; then
    rm -rf "$SHIP_LOCK"
  fi
}
acquire_ship_lock
trap release_ship_lock EXIT INT TERM

# Texttext's public release identity is product configuration, not secret input.
# Keep it here so the owner-facing command is genuinely one command.
export WRITE_NOTARY_PROFILE="${WRITE_NOTARY_PROFILE:-write-notary}"
export WRITE_BUNDLE_ID="${WRITE_BUNDLE_ID:-net.writeapp.write.mac}"
export WRITE_APP_GROUP="${WRITE_APP_GROUP:-group.net.writeapp.write}"
export WRITE_PRODUCT_ORIGIN="${WRITE_PRODUCT_ORIGIN:-https://texttext.app}"
export WRITE_SPARKLE_PUBLIC_KEY="${WRITE_SPARKLE_PUBLIC_KEY:-qFmaq5ijn3m2sbiadmkBVvGIjz8v9+piqE/T+YZ1/u0=}"

VERSION=""
ALLOW_DIRTY=0
SKIP_TESTS=0
SKIP_WEB_DEPLOY=0
NO_PUBLISH=0
LOCAL_INSTALL=0

usage() {
  sed -n '1,15p' "$0" >&2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --allow-dirty) ALLOW_DIRTY=1 ;;
    --dry-run|--no-publish) NO_PUBLISH=1 ;;
    --local-install) NO_PUBLISH=1; LOCAL_INSTALL=1 ;;
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

if [ "$ALLOW_DIRTY" != "1" ] && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  dirty="$(git status --porcelain --untracked-files=no)"
  if [ -n "$dirty" ]; then
    echo "Refusing to ship with dirty tracked files. Commit or pass --allow-dirty." >&2
    git status --short --untracked-files=no >&2
    exit 1
  fi
fi

if [ -z "$VERSION" ]; then
  VERSION="$(node "$ROOT/scripts/release-version.mjs" next)"
fi

if ! [[ "$VERSION" =~ ^[0-9]+(\.[0-9]+)+$ ]]; then
  echo "Version must be dotted numeric, got: $VERSION" >&2
  usage
  exit 1
fi

if [ "$NO_PUBLISH" != "1" ]; then
  node "$ROOT/scripts/release-version.mjs" assert-free "$VERSION"

  # Fail before expensive release gates when production cannot accept the
  # migration or serve the deployed app. This query is read-only.
  if [ ! -f "$ROOT/.env.release.local" ]; then
    echo "Missing .env.release.local (production DB creds required to ship)." >&2
    exit 1
  fi
  echo ">> preflight production database"
  (
    set -a
    . "$ROOT/.env.release.local"
    set +a
    case "${DATABASE_URL:-}" in
      *neon.tech*) ;;
      *) echo "Refusing: release DATABASE_URL is not the prod Neon DB." >&2; exit 1 ;;
    esac
    DATABASE_URL="$DATABASE_URL" npx tsx "$ROOT/scripts/work-unit.ts" run \
      --name database.preflight --timeout 60 --no-reuse -- \
      node "$ROOT/scripts/verify-production-database.mjs"
  )
fi

echo ">> ship Texttext $VERSION"

if [ "$SKIP_TESTS" != "1" ]; then
  echo ">> verify exact release source"
  npx tsx "$ROOT/scripts/verify-release.ts"
else
  echo ">> reuse exact release receipt"
  npx tsx "$ROOT/scripts/verify-release.ts" --check
fi
RELEASE_GATE_RECEIPT="$ROOT/.write/release-gate-receipt.json"
export WRITE_RELEASE_GATE_RECEIPT="$RELEASE_GATE_RECEIPT"

echo ">> evaluate workflow capability contracts"
WORKFLOW_CAPABILITY_RECEIPT="$ROOT/mac/build/workflow-capability-receipt.json"
"$ROOT/mac/scripts/verify-workflow-capabilities.sh" \
  "$WORKFLOW_CAPABILITY_RECEIPT"
export WRITE_WORKFLOW_CAPABILITY_RECEIPT="$WORKFLOW_CAPABILITY_RECEIPT"

if [ "$NO_PUBLISH" = "1" ]; then
  echo ">> verify one dry-run web build"
  npx tsx "$ROOT/scripts/work-unit.ts" run \
    --name web.dry_build --timeout 1800 -- npm run build
  echo ">> dry-run Mac app build"
  DRY_BUILD="$(( $("$PB" -c 'Print :CFBundleVersion' "$ROOT/mac/Info.plist") + 1 ))"
  DRY_ATTESTATION="$ROOT/mac/build/app-health-attestation.json"
  "$ROOT/mac/scripts/write-build-attestation.sh" \
    "$DRY_ATTESTATION" "$VERSION" "$DRY_BUILD"
  APP_VERSION="$VERSION" \
  APP_BUILD_NUMBER="$DRY_BUILD" \
  WRITE_BUILD_ATTESTATION="$DRY_ATTESTATION" \
    "$ROOT/mac/scripts/build-app.sh"
  DRY_PLIST="$ROOT/mac/build/Texttext.app/Contents/Info.plist"
  [ "$("$PB" -c 'Print :CFBundleShortVersionString' "$DRY_PLIST")" = "$VERSION" ]
  [ "$("$PB" -c 'Print :CFBundleVersion' "$DRY_PLIST")" = "$DRY_BUILD" ]
  [ "$("$PB" -c 'Print :SUFeedURL' "$DRY_PLIST")" = "${WRITE_PRODUCT_ORIGIN%/}/appcast.xml" ]
  "$ROOT/mac/scripts/verify-app-health.sh" \
    "$ROOT/mac/build/Texttext.app" "$VERSION" "$DRY_BUILD"
  EXPECTED_BUILD="$DRY_BUILD"
  if [ "$LOCAL_INSTALL" != "1" ]; then
    echo
    echo "Verified Texttext $VERSION (not published)"
    echo "  web build: .next (one production build)"
    echo "  app build: mac/build/Texttext.app ($VERSION build $DRY_BUILD)"
    exit 0
  fi
fi

if [ "$LOCAL_INSTALL" != "1" ]; then
echo ">> migrate database (production only)"
# The dev DB (.env.local) is a LOCAL Postgres, so migrations must load the
# production Neon creds from the release-only file. Guard hard: never migrate
# anything that is not the prod Neon endpoint, so a misconfigured machine can
# never point a release at a local or throwaway database.
set -a
. "$ROOT/.env.release.local"
set +a
case "${DATABASE_URL:-}" in
  *neon.tech*) ;;
  *) echo "Refusing: migration DATABASE_URL is not the prod Neon DB." >&2; exit 1 ;;
esac
DATABASE_URL="$DATABASE_URL" npx tsx "$ROOT/scripts/work-unit.ts" run \
  --name database.migrations --timeout 900 --no-reuse -- \
  "$ROOT/scripts/run-release-migrations.sh"

if [ -z "${BLOB_READ_WRITE_TOKEN:-}" ]; then
  export BLOB_READ_WRITE_TOKEN="$(node --input-type=module <<'NODE'
import pkg from "@next/env";
pkg.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
process.stdout.write(process.env.BLOB_READ_WRITE_TOKEN ?? "");
NODE
)"
fi

echo ">> release Mac app"
npx tsx "$ROOT/scripts/work-unit.ts" run \
  --name mac.release --timeout 7200 --no-reuse -- \
  "$ROOT/mac/scripts/release.sh" "$VERSION"
EXPECTED_BUILD="$("$PB" -c 'Print :CFBundleVersion' "$ROOT/mac/Info.plist")"
DEPLOYMENT_VERSION="${VERSION//./_}"
# This identity lets Next detect an app window that survived a web deployment.
# The assistant itself uses stable JSON commands, while remaining Server Action
# calls recover with a hard navigation instead of submitting stale action ids.
export NEXT_DEPLOYMENT_ID="${NEXT_DEPLOYMENT_ID:-write-${DEPLOYMENT_VERSION}-${EXPECTED_BUILD}}"
echo "   web deployment identity: $NEXT_DEPLOYMENT_ID"

if [ "$SKIP_WEB_DEPLOY" != "1" ]; then
  echo ">> align Vercel runtime database"
  # Production migrations and the deployed app must use the same database.
  # Feed the secret over stdin so it never appears in process arguments or logs.
  [ -n "${DATABASE_URL:-}" ] || {
    echo "Release DATABASE_URL is missing before the Vercel deployment." >&2
    exit 1
  }
  npx tsx "$ROOT/scripts/work-unit.ts" run \
    --name web.production_database --timeout 300 --no-reuse -- \
    node "$ROOT/scripts/sync-vercel-runtime-env.mjs"

  echo ">> deploy public web app"
  # A linked Vercel project can turn `vercel --prod` into a Git deployment,
  # which clones HEAD and silently omits the release marker generated above.
  # Build locally after that marker exists, then deploy those exact outputs.
  npx tsx "$ROOT/scripts/work-unit.ts" run \
    --name web.production_build --timeout 2400 -- \
    npx vercel build --prod --yes
  npx tsx "$ROOT/scripts/work-unit.ts" run \
    --name web.production_deploy --timeout 1800 --no-reuse -- \
    npx vercel deploy --prebuilt --prod --yes
fi

ORIGIN="${WRITE_PRODUCT_ORIGIN:-}"
if [ -n "$ORIGIN" ]; then
  ORIGIN="${ORIGIN%/}"
  echo ">> verify public release"
  PUBLIC_APPCAST=""
  PUBLIC_API=""
  PUBLIC_VERSION=""
  PUBLIC_BUILD=""
  PUBLIC_HARDWARE_REQUIREMENTS=""
  API_VERSION=""
  API_BUILD=""
  for attempt in {1..30}; do
    VERIFY_QUERY="ship_verify=$(date +%s)-$$-$attempt"
    PUBLIC_APPCAST="$(curl -fsS -H 'Cache-Control: no-cache' "$ORIGIN/appcast.xml?$VERIFY_QUERY" || true)"
    PUBLIC_VERSION="$(printf '%s' "$PUBLIC_APPCAST" | sed -n 's|.*<sparkle:shortVersionString>\([^<]*\)</sparkle:shortVersionString>.*|\1|p' | head -1)"
    PUBLIC_BUILD="$(printf '%s' "$PUBLIC_APPCAST" | sed -n 's|.*<sparkle:version>\([0-9][0-9]*\)</sparkle:version>.*|\1|p' | head -1)"
    PUBLIC_HARDWARE_REQUIREMENTS="$(printf '%s' "$PUBLIC_APPCAST" | sed -n 's|.*<sparkle:hardwareRequirements>\([^<]*\)</sparkle:hardwareRequirements>.*|\1|p' | head -1)"
    PUBLIC_API="$(curl -fsS -H 'Cache-Control: no-cache' "$ORIGIN/api/app/version?$VERIFY_QUERY" || true)"
    API_VERSION="$(printf '%s' "$PUBLIC_API" | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])' 2>/dev/null || true)"
    API_BUILD="$(printf '%s' "$PUBLIC_API" | python3 -c 'import json,sys; print(json.load(sys.stdin)["buildNumber"])' 2>/dev/null || true)"
    if [ "$PUBLIC_VERSION" = "$VERSION" ] && [ "$PUBLIC_BUILD" = "$EXPECTED_BUILD" ] && \
       [ "$PUBLIC_HARDWARE_REQUIREMENTS" = "arm64" ] && \
       [ "$API_VERSION" = "$VERSION" ] && [ "$API_BUILD" = "$EXPECTED_BUILD" ]; then
      break
    fi
    if [ "$attempt" -lt 30 ]; then
      echo "   waiting for public release marker ($attempt/30): appcast ${PUBLIC_VERSION:-unavailable} (${PUBLIC_BUILD:-unavailable}, ${PUBLIC_HARDWARE_REQUIREMENTS:-no architecture}), API ${API_VERSION:-unavailable} (${API_BUILD:-unavailable})"
      sleep 2
    fi
  done
  PUBLIC_ZIP_URL="$(printf '%s' "$PUBLIC_APPCAST" | sed -n 's|.*<enclosure[^>]* url="\([^"]*\)".*|\1|p' | head -1)"
  PUBLIC_SIGNATURE="$(printf '%s' "$PUBLIC_APPCAST" | sed -n 's|.*<enclosure[^>]* sparkle:edSignature="\([^"]*\)".*|\1|p' | head -1)"
  [ "$PUBLIC_VERSION" = "$VERSION" ] || { echo "Public appcast version is $PUBLIC_VERSION, expected $VERSION." >&2; exit 1; }
  [ "$PUBLIC_BUILD" = "$EXPECTED_BUILD" ] || { echo "Public appcast build is $PUBLIC_BUILD, expected $EXPECTED_BUILD." >&2; exit 1; }
  [ "$PUBLIC_HARDWARE_REQUIREMENTS" = "arm64" ] || { echo "Public appcast hardware requirement is '$PUBLIC_HARDWARE_REQUIREMENTS', expected arm64." >&2; exit 1; }
  [ -n "$PUBLIC_ZIP_URL" ] || { echo "Public appcast is missing an enclosure URL." >&2; exit 1; }
  [ -n "$PUBLIC_SIGNATURE" ] || { echo "Public appcast enclosure is missing sparkle:edSignature." >&2; exit 1; }
  curl -fsSI "$PUBLIC_ZIP_URL" >/dev/null
  curl -fsSI "$ORIGIN/download/Texttext.zip" >/dev/null
  curl -fsSI "$ORIGIN/download/Write.zip" >/dev/null
  [ "$API_VERSION" = "$VERSION" ] || { echo "Public app version API is $API_VERSION, expected $VERSION." >&2; exit 1; }
  [ "$API_BUILD" = "$EXPECTED_BUILD" ] || { echo "Public app build API is $API_BUILD, expected $EXPECTED_BUILD." >&2; exit 1; }
  GUEST_SMOKE_DIR="$(mktemp -d)"
  GUEST_SMOKE_COOKIES="$GUEST_SMOKE_DIR/cookies"
  GUEST_SMOKE_RESULT="$(
    curl -sS -L \
      -c "$GUEST_SMOKE_COOKIES" \
      -b "$GUEST_SMOKE_COOKIES" \
      -o /dev/null \
      -w '%{http_code} %{url_effective}' \
      "$ORIGIN/try?ship_verify=$VERIFY_QUERY"
  )"
  rm -rf "$GUEST_SMOKE_DIR"
  GUEST_SMOKE_STATUS="${GUEST_SMOKE_RESULT%% *}"
  GUEST_SMOKE_URL="${GUEST_SMOKE_RESULT#* }"
  [ "$GUEST_SMOKE_STATUS" = "200" ] || {
    echo "Guest start flow returned $GUEST_SMOKE_STATUS at $GUEST_SMOKE_URL." >&2
    exit 1
  }
  echo "   appcast:  $PUBLIC_VERSION ($PUBLIC_BUILD, $PUBLIC_HARDWARE_REQUIREMENTS)"
  echo "   zip:      $PUBLIC_ZIP_URL"
  echo "   version:  $API_VERSION ($API_BUILD)"
  echo "   guest:    $GUEST_SMOKE_URL"

  # Live-execute the shared workspace workflows against the just-deployed prod
  # (an isolated scratch workspace, torn down in the script's finally), asserting
  # the real mutation and its audit row. This is the executable complement to the
  # content-blind capability receipts above. Needs DB access; skipped without it.
  if [ -n "${DATABASE_URL:-}" ]; then
    echo ">> verify workspace workflows on the live release"
    WRITE_ORIGIN="$ORIGIN" DATABASE_URL="$DATABASE_URL" \
      npx tsx "$ROOT/scripts/verify-workflow-live.ts"
  else
    echo "   (skipping live workflow probe: DATABASE_URL not set)"
  fi
fi
fi

echo ">> install verified Mac app"
INSTALL_PATH="${TEXTTEXT_INSTALLED_APP_PATH:-${WRITE_INSTALLED_APP_PATH:-/Applications/Texttext.app}}"
LEGACY_INSTALL_PATH="/Applications/Write.app"
INSTALL_PARENT="$(dirname "$INSTALL_PATH")"
INSTALL_NEW="$INSTALL_PARENT/.Texttext.app.new.$$"
INSTALL_OLD="$INSTALL_PARENT/.Texttext.app.previous.$$"
LEGACY_OLD="$INSTALL_PARENT/.Write.app.previous.$$"
INSTALL_EXECUTABLE="$INSTALL_PATH/Contents/MacOS/Write"
LEGACY_EXECUTABLE="$LEGACY_INSTALL_PATH/Contents/MacOS/Write"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

installed_write_pids() {
  ps ax -o pid=,command= | awk \
    -v executable="$INSTALL_EXECUTABLE" \
    -v legacy="$LEGACY_EXECUTABLE" \
    '$2 == executable || $2 == legacy { print $1 }'
}

installed_write_is_running() {
  [ -n "$(installed_write_pids)" ]
}

stop_installed_write() {
  local pids
  local attempt

  installed_write_is_running || return 0
  osascript -e 'tell application id "net.writeapp.write.mac" to quit' </dev/null >/dev/null 2>&1 || true
  for attempt in {1..10}; do
    installed_write_is_running || return 0
    sleep 0.5
  done

  pids="$(installed_write_pids)"
  [ -z "$pids" ] || kill -TERM $pids 2>/dev/null || true
  for attempt in {1..10}; do
    installed_write_is_running || return 0
    sleep 0.5
  done

  pids="$(installed_write_pids)"
  [ -z "$pids" ] || kill -KILL $pids 2>/dev/null || true
  for attempt in {1..10}; do
    installed_write_is_running || return 0
    sleep 0.2
  done
  return 1
}

launch_installed_write() {
  local attempt
  local launch_path
  local settle
  local stable

  launch_path="$INSTALL_PATH"
  if [ ! -e "$launch_path" ] && [ -e "$LEGACY_INSTALL_PATH" ]; then
    launch_path="$LEGACY_INSTALL_PATH"
  fi
  "$LSREGISTER" -f "$launch_path" </dev/null >/dev/null 2>&1 || true
  for attempt in {1..5}; do
    if open -g "$launch_path" </dev/null >/dev/null 2>&1; then
      for settle in {1..20}; do
        if installed_write_is_running; then
          for stable in {1..8}; do
            sleep 0.25
            installed_write_is_running || break
          done
          installed_write_is_running && return 0
        fi
        sleep 0.25
      done
    fi
    sleep "$attempt"
  done
  return 1
}

rollback_installed_write() {
  local failed_install="$INSTALL_PARENT/.Texttext.app.failed.$$"

  stop_installed_write || true
  rm -rf "$failed_install"
  [ ! -e "$INSTALL_PATH" ] || mv "$INSTALL_PATH" "$failed_install"
  if [ -e "$INSTALL_OLD" ]; then
    mv "$INSTALL_OLD" "$INSTALL_PATH"
  fi
  if [ -e "$LEGACY_OLD" ]; then
    mv "$LEGACY_OLD" "$LEGACY_INSTALL_PATH"
  fi
  if [ "$INSTALL_WAS_RUNNING" = "1" ]; then
    launch_installed_write || true
  fi
  rm -rf "$failed_install" "$INSTALL_NEW" "$INSTALL_OLD" "$LEGACY_OLD"
}

fail_installed_write() {
  echo "$1" >&2
  rollback_installed_write
  exit 1
}

rm -rf "$INSTALL_NEW" "$INSTALL_OLD" "$LEGACY_OLD"
ditto "$ROOT/mac/build/Texttext.app" "$INSTALL_NEW"
INSTALL_WAS_RUNNING=0
installed_write_is_running && INSTALL_WAS_RUNNING=1
if ! stop_installed_write; then
  rm -rf "$INSTALL_NEW"
  echo "The running Texttext app did not quit before installation." >&2
  exit 1
fi
if [ -e "$INSTALL_PATH" ]; then mv "$INSTALL_PATH" "$INSTALL_OLD"; fi
if [ "$LEGACY_INSTALL_PATH" != "$INSTALL_PATH" ] && [ -e "$LEGACY_INSTALL_PATH" ]; then
  mv "$LEGACY_INSTALL_PATH" "$LEGACY_OLD"
fi
mv "$INSTALL_NEW" "$INSTALL_PATH"
defaults write net.writeapp.write.mac SUEnableAutomaticChecks -bool true
defaults write net.writeapp.write.mac SUAutomaticallyUpdate -bool true
INSTALLED_VERSION="$("$PB" -c 'Print :CFBundleShortVersionString' "$INSTALL_PATH/Contents/Info.plist")"
INSTALLED_BUILD="$("$PB" -c 'Print :CFBundleVersion' "$INSTALL_PATH/Contents/Info.plist")"
[ "$INSTALLED_VERSION" = "$VERSION" ] || fail_installed_write "Installed app version is $INSTALLED_VERSION, expected $VERSION."
[ "$INSTALLED_BUILD" = "$EXPECTED_BUILD" ] || fail_installed_write "Installed app build is $INSTALLED_BUILD, expected $EXPECTED_BUILD."
codesign --verify --strict --verbose=2 "$INSTALL_PATH" || fail_installed_write "Installed Texttext app failed code-signature verification."
if ! "$ROOT/mac/scripts/verify-apple-silicon-app.sh" \
  "$INSTALL_PATH" --require-extensions; then
  fail_installed_write "Installed Texttext app failed Apple silicon verification."
fi
if [ "$INSTALL_WAS_RUNNING" = "1" ]; then
  launch_installed_write || fail_installed_write "Installed Texttext app did not launch after bounded retries."
fi
rm -rf "$INSTALL_OLD" "$LEGACY_OLD"
echo "   installed: $INSTALLED_VERSION ($INSTALLED_BUILD)"

if [ "$INSTALL_WAS_RUNNING" = "1" ]; then
  echo ">> verify installed app health"
  LOCAL_HEALTH="$HOME/Library/Application Support/Write/health/latest.json"
  LOCAL_HEALTH_VERSION=""
  LOCAL_HEALTH_BUILD=""
  LOCAL_HEALTH_STATUS=""
  # Wait for the installed app to write a health report for THIS version/build, and
  # prefer a clean "pass" once it does. Some runtime checks (notably finder.provider,
  # the File Provider mount) legitimately report "warning" for the first seconds
  # after a fresh install while the domain registers, then settle. Give them time.
  for attempt in {1..90}; do
    if [ -f "$LOCAL_HEALTH" ]; then
      LOCAL_HEALTH_VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8")).get("appVersion", ""))' "$LOCAL_HEALTH" 2>/dev/null || true)"
      LOCAL_HEALTH_BUILD="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8")).get("buildNumber", ""))' "$LOCAL_HEALTH" 2>/dev/null || true)"
      LOCAL_HEALTH_STATUS="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8")).get("status", ""))' "$LOCAL_HEALTH" 2>/dev/null || true)"
    fi
    if [ "$LOCAL_HEALTH_VERSION" = "$VERSION" ] && [ "$LOCAL_HEALTH_BUILD" = "$EXPECTED_BUILD" ] && [ "$LOCAL_HEALTH_STATUS" = "pass" ]; then
      break
    fi
    [ "$attempt" -eq 90 ] || sleep 1
  done
  [ "$LOCAL_HEALTH_VERSION" = "$VERSION" ] || { echo "Installed app did not write a $VERSION health report." >&2; exit 1; }
  [ "$LOCAL_HEALTH_BUILD" = "$EXPECTED_BUILD" ] || { echo "Installed app health build is $LOCAL_HEALTH_BUILD, expected $EXPECTED_BUILD." >&2; exit 1; }
  # A "fail" is a hard block. A residual "warning" (never "fail") is non-blocking:
  # it is a soft, usually transient signal (e.g. the File Provider mount still warming
  # up moments after install) and must not wedge the autobuild ship loop. The uploaded
  # health gate below (health:review --fail-on-failure) already blocks only on failure.
  case "$LOCAL_HEALTH_STATUS" in
    pass)
      echo "   local health: pass"
      ;;
    warning)
      LOCAL_HEALTH_WARN_CHECKS="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1], encoding="utf-8")); print(", ".join(c.get("id","?") for c in d.get("checks", d.get("suites", [])) if c.get("status")=="warning"))' "$LOCAL_HEALTH" 2>/dev/null || true)"
      echo "   local health: warning (non-blocking) [${LOCAL_HEALTH_WARN_CHECKS}]" >&2
      ;;
    *)
      echo "Installed app health is '${LOCAL_HEALTH_STATUS:-missing}', expected pass or warning." >&2
      exit 1
      ;;
  esac

  if [ "$LOCAL_INSTALL" != "1" ]; then
    echo ">> verify uploaded app health"
    npm run health:review -- \
      --app-identifier "$WRITE_BUNDLE_ID" \
      --version "$VERSION" \
      --build "$EXPECTED_BUILD" \
      --wait-seconds 30 \
      --require-reports \
      --fail-on-failure
  fi
else
  echo "   Texttext was not running before installation; leaving it closed and deferring runtime health until next launch."
fi

echo
if [ "$LOCAL_INSTALL" = "1" ]; then
  echo "Installed local Texttext $VERSION build $EXPECTED_BUILD"
else
  echo "Shipped Texttext $VERSION"
  if [ -n "$ORIGIN" ]; then
    echo "  download: $ORIGIN/download"
    echo "  appcast:  $ORIGIN/appcast.xml"
  fi
fi
