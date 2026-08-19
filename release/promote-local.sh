#!/usr/bin/env bash
# Promote the exact committed main revision to production and install one
# canonical Developer ID app on this Mac. This intentionally does not publish
# Sparkle artifacts, update the appcast, create a TestFlight build, or upload.
#
# Usage:
#   release/promote-local.sh
set -euo pipefail
exec </dev/null
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
PB="/usr/libexec/PlistBuddy"
ORIGIN="https://texttext.app"
BUNDLE_ID="app.texttext.mac"
PRODUCTION_CHANGED=0
PROMOTION_COMPLETE=0
PREVIOUS_DEPLOYMENT_URL=""

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  sed -n '1,9p' "$0"
  exit 0
fi
if [[ "$#" -ne 0 ]]; then
  echo "Usage: release/promote-local.sh" >&2
  exit 2
fi

mkdir -p "$ROOT/.texttext"
LOCK="$ROOT/.texttext/delivery.lock"
# The bounded command runner keeps one durable work-unit identity. A pristine
# checkout may not have one yet, so initialize and immediately close a harmless
# unit before this command takes the promotion lock.
if [[ ! -f "$ROOT/.texttext/current-work-unit.json" ]]; then
  npx tsx "$ROOT/scripts/work-unit.ts" begin "Initialize local promotion receipts"
  npx tsx "$ROOT/scripts/work-unit.ts" finish >/dev/null
fi
acquire_lock() {
  local owner_pid="" owner_lane=""
  if mkdir "$LOCK" 2>/dev/null; then
    printf '%s\n' "$$" > "$LOCK/pid"
    printf '%s\n' "promote-local" > "$LOCK/lane"
    printf '%s\n' "$ROOT" > "$LOCK/repository"
    return 0
  fi
  owner_lane="$(cat "$LOCK/lane" 2>/dev/null || true)"
  if [[ "$owner_lane" == "work" ]]; then
    echo "An active TextText work unit owns the delivery lane." >&2
    exit 75
  fi
  owner_pid="$(cat "$LOCK/pid" 2>/dev/null || true)"
  if [[ -n "$owner_pid" ]] && kill -0 "$owner_pid" 2>/dev/null; then
    echo "Another TextText delivery owns the release lock (pid $owner_pid)." >&2
    exit 75
  fi
  rm -rf "$LOCK"
  mkdir "$LOCK" || exit 75
  printf '%s\n' "$$" > "$LOCK/pid"
  printf '%s\n' "promote-local" > "$LOCK/lane"
  printf '%s\n' "$ROOT" > "$LOCK/repository"
}
finish_promotion() {
  local status=$?
  trap - EXIT INT TERM HUP
  if [[ "$PRODUCTION_CHANGED" == "1" && "$PROMOTION_COMPLETE" != "1" && -n "$PREVIOUS_DEPLOYMENT_URL" ]]; then
    echo "Promotion did not complete. Restoring the previous production deployment." >&2
    npx vercel rollback "$PREVIOUS_DEPLOYMENT_URL" --yes >/dev/null 2>&1 || \
      echo "Automatic Vercel rollback failed; restore $PREVIOUS_DEPLOYMENT_URL manually." >&2
    [[ "$status" != "0" ]] || status=1
  fi
  if [[ -n "${DEPLOY_LOG:-}" ]]; then rm -f "$DEPLOY_LOG"; fi
  if [[ -n "${INSPECT_LOG:-}" ]]; then rm -f "$INSPECT_LOG"; fi
  if [[ "$(cat "$LOCK/pid" 2>/dev/null || true)" == "$$" ]]; then
    rm -rf "$LOCK"
  fi
  exit "$status"
}
acquire_lock
trap finish_promotion EXIT INT TERM HUP

[[ "$(git branch --show-current)" == "main" ]] || {
  echo "Refusing: local promotion runs only from main." >&2
  exit 1
}
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Refusing: commit or revert every source change before promotion." >&2
  git status --short >&2
  exit 1
fi
git fetch --quiet origin main
SOURCE_COMMIT="$(git rev-parse HEAD)"
[[ "$SOURCE_COMMIT" == "$(git rev-parse origin/main)" ]] || {
  echo "Refusing: main and origin/main are not the same commit." >&2
  exit 1
}

VERSION="$($PB -c 'Print :CFBundleShortVersionString' "$ROOT/mac/Info.plist")"
SOURCE_BUILD="$($PB -c 'Print :CFBundleVersion' "$ROOT/mac/Info.plist")"
[[ "$VERSION" =~ ^[0-9]+(\.[0-9]+)+$ ]] || {
  echo "Source app version is invalid: $VERSION" >&2
  exit 1
}
[[ "$SOURCE_BUILD" =~ ^[1-9][0-9]*$ ]] || {
  echo "Source app build is invalid: $SOURCE_BUILD" >&2
  exit 1
}

# A failed prior promotion may have installed a build newer than source. Scan
# all known app locations and advance past the greatest TextText build found.
MAX_BUILD="$SOURCE_BUILD"
shopt -s nullglob
installed_candidates=(
  /Applications/TextText.app
  /Applications/TextText\ [0-9]*.app
  "$HOME/Applications/TextText.app"
  "$HOME/Applications"/TextText\ [0-9]*.app
)
for candidate in "${installed_candidates[@]}"; do
  [[ -f "$candidate/Contents/Info.plist" ]] || continue
  candidate_id="$($PB -c 'Print :CFBundleIdentifier' "$candidate/Contents/Info.plist" 2>/dev/null || true)"
  [[ "$candidate_id" == "$BUNDLE_ID" ]] || continue
  candidate_build="$($PB -c 'Print :CFBundleVersion' "$candidate/Contents/Info.plist" 2>/dev/null || true)"
  [[ "$candidate_build" =~ ^[1-9][0-9]*$ ]] || continue
  (( candidate_build > MAX_BUILD )) && MAX_BUILD="$candidate_build"
done
BUILD=$((MAX_BUILD + 1))
PROMOTION_ID="texttext-${VERSION//./_}-${BUILD}-${SOURCE_COMMIT:0:12}-$(date -u +%Y%m%d%H%M%S)-$$"

export TEXTTEXT_BUNDLE_ID="$BUNDLE_ID"
export TEXTTEXT_APP_GROUP="group.app.texttext"
export TEXTTEXT_PRODUCT_ORIGIN="$ORIGIN"
export TEXTTEXT_SPARKLE_PUBLIC_KEY="qFmaq5ijn3m2sbiadmkBVvGIjz8v9+piqE/T+YZ1/u0="
export NEXT_DEPLOYMENT_ID="$PROMOTION_ID"

echo ">> promote committed main ${SOURCE_COMMIT:0:12}"
echo "   app identity: $VERSION build $BUILD"
echo "   web identity: $PROMOTION_ID"

echo ">> verify exact source"
npx tsx "$ROOT/scripts/verify-release.ts"
RELEASE_GATE_RECEIPT="$ROOT/.texttext/release-gate-receipt.json"
export TEXTTEXT_RELEASE_GATE_RECEIPT="$RELEASE_GATE_RECEIPT"

echo ">> verify workflow capability contract"
WORKFLOW_CAPABILITY_RECEIPT="$ROOT/mac/build/workflow-capability-receipt.json"
"$ROOT/mac/scripts/verify-workflow-capabilities.sh" "$WORKFLOW_CAPABILITY_RECEIPT"
export TEXTTEXT_WORKFLOW_CAPABILITY_RECEIPT="$WORKFLOW_CAPABILITY_RECEIPT"

echo ">> build exact attested Developer ID app"
ATTESTATION="$ROOT/mac/build/app-health-attestation.json"
"$ROOT/mac/scripts/texttext-build-attestation.sh" "$ATTESTATION" "$VERSION" "$BUILD"
APP_VERSION="$VERSION" \
APP_BUILD_NUMBER="$BUILD" \
TEXTTEXT_BUILD_ATTESTATION="$ATTESTATION" \
  "$ROOT/mac/scripts/build-app.sh"
BUILT_APP="$ROOT/mac/build/TextText.app"
[[ "$($PB -c 'Print :CFBundleShortVersionString' "$BUILT_APP/Contents/Info.plist")" == "$VERSION" ]]
[[ "$($PB -c 'Print :CFBundleVersion' "$BUILT_APP/Contents/Info.plist")" == "$BUILD" ]]
[[ "$($PB -c 'Print :TextTextServerOrigin' "$BUILT_APP/Contents/Info.plist")" == "$ORIGIN" ]]
codesign --verify --strict --verbose=2 "$BUILT_APP"
SIGNATURE_DETAILS="$(codesign -dv --verbose=4 "$BUILT_APP" 2>&1)"
if ! grep -q '^Authority=Developer ID Application:' <<<"$SIGNATURE_DETAILS"; then
  echo "Refusing: the promoted app is not signed by a Developer ID Application identity." >&2
  exit 1
fi
"$ROOT/mac/scripts/verify-app-health.sh" "$BUILT_APP" "$VERSION" "$BUILD"

echo ">> load and guard the production database"
. "$ROOT/release/secrets.sh"
require_release_secret DATABASE_URL
DATABASE_URL="$DATABASE_URL" node "$ROOT/scripts/verify-production-database.mjs"

echo ">> run every production migration and backfill"
DATABASE_URL="$DATABASE_URL" npx tsx "$ROOT/scripts/work-unit.ts" run \
  --name database.promotion_migrations --timeout 1800 --no-reuse -- \
  "$ROOT/scripts/run-release-migrations.sh"

echo ">> align the Vercel runtime database"
DATABASE_URL="$DATABASE_URL" npx tsx "$ROOT/scripts/work-unit.ts" run \
  --name web.promotion_database --timeout 300 --no-reuse -- \
  node "$ROOT/scripts/sync-vercel-runtime-env.mjs"

echo ">> record the current production rollback target"
INSPECT_LOG="$(mktemp -t texttext-promote-inspect)"
export TEXTTEXT_PROMOTION_INSPECT_LOG="$INSPECT_LOG"
npx tsx "$ROOT/scripts/work-unit.ts" run \
  --name web.promotion_rollback_target --timeout 120 --no-reuse -- \
  bash -c 'npx vercel inspect texttext.app --format=json > "$TEXTTEXT_PROMOTION_INSPECT_LOG"'
PREVIOUS_DEPLOYMENT_URL="$(python3 -c 'import json,sys
url=json.load(open(sys.argv[1], encoding="utf-8")).get("url", "")
print(url if url.startswith("https://") else ("https://" + url if url else ""))' "$INSPECT_LOG" 2>/dev/null || true)"
rm -f "$INSPECT_LOG"
INSPECT_LOG=""
unset TEXTTEXT_PROMOTION_INSPECT_LOG
[[ "$PREVIOUS_DEPLOYMENT_URL" =~ ^https://[A-Za-z0-9.-]+\.vercel\.app$ ]] || {
  echo "Could not identify the current production deployment for rollback." >&2
  exit 1
}
echo "   rollback target: $PREVIOUS_DEPLOYMENT_URL"

echo ">> build production outputs with a unique identity"
npx tsx "$ROOT/scripts/work-unit.ts" run \
  --name web.promotion_build --timeout 2400 --no-reuse -- \
  npx vercel build --prod --yes

echo ">> deploy the exact prebuilt outputs"
DEPLOY_LOG="$(mktemp -t texttext-promote-deploy)"
export TEXTTEXT_PROMOTION_DEPLOY_LOG="$DEPLOY_LOG"
PRODUCTION_CHANGED=1
npx tsx "$ROOT/scripts/work-unit.ts" run \
  --name web.promotion_deploy --timeout 1800 --no-reuse -- \
  bash -c 'set -o pipefail; npx vercel deploy --prebuilt --prod --yes --no-color 2>&1 | tee "$TEXTTEXT_PROMOTION_DEPLOY_LOG"'
DEPLOYMENT_URL="$(grep -Eo 'https://[^[:space:]]+\.vercel\.app' "$DEPLOY_LOG" | head -1 | sed $'s/\033\[[0-9;]*m//g' || true)"
rm -f "$DEPLOY_LOG"
unset TEXTTEXT_PROMOTION_DEPLOY_LOG
[[ "$DEPLOYMENT_URL" =~ ^https://[A-Za-z0-9.-]+\.vercel\.app$ ]] || {
  echo "Could not read the immutable deployment URL from Vercel output." >&2
  exit 1
}
echo "   deployment: $DEPLOYMENT_URL"

# Make the alias step explicit, then prove both the immutable deployment and
# the product origin. A cache-busting query prevents an old static response
# from impersonating the new deployment.
npx tsx "$ROOT/scripts/work-unit.ts" run \
  --name web.promotion_alias --timeout 300 --no-reuse -- \
  npx vercel alias set "$DEPLOYMENT_URL" texttext.app

smoke_page() {
  local url="$1" expected="$2" body="" attempt
  for attempt in {1..30}; do
    body="$(curl -fsSL -H 'Cache-Control: no-cache' "$url?promotion=$PROMOTION_ID-$attempt" || true)"
    if [[ "$body" == *"$expected"* ]]; then return 0; fi
    [[ "$attempt" == "30" ]] || sleep 2
  done
  return 1
}

echo ">> smoke the deployed product"
smoke_page "$DEPLOYMENT_URL/docs/item-types" "Build item types with AI" || {
  echo "The immutable deployment did not render the item-type guide." >&2
  exit 1
}
smoke_page "$ORIGIN/docs/item-types" "Build item types with AI" || {
  echo "The product origin did not resolve to the promoted app." >&2
  exit 1
}
smoke_page "$ORIGIN/signin" "Sign in" || {
  echo "The production sign-in route did not render." >&2
  exit 1
}

echo ">> run authenticated production workflow smoke"
TEXTTEXT_ORIGIN="$ORIGIN" DATABASE_URL="$DATABASE_URL" \
  npx tsx "$ROOT/scripts/verify-workflow-live.ts"

echo ">> atomically replace and health-gate the canonical Mac app"
TEXTTEXT_SOURCE_APP="$BUILT_APP" \
TEXTTEXT_EXPECTED_VERSION="$VERSION" \
TEXTTEXT_EXPECTED_BUILD="$BUILD" \
TEXTTEXT_REQUIRE_RUNTIME_HEALTH=1 \
  "$ROOT/mac/scripts/install-local.sh"

INSTALLED="/Applications/TextText.app"
[[ "$($PB -c 'Print :CFBundleShortVersionString' "$INSTALLED/Contents/Info.plist")" == "$VERSION" ]]
[[ "$($PB -c 'Print :CFBundleVersion' "$INSTALLED/Contents/Info.plist")" == "$BUILD" ]]
codesign --verify --strict --verbose=2 "$INSTALLED"
PROMOTION_COMPLETE=1

echo
echo "Promoted and installed TextText $VERSION build $BUILD"
echo "  source:     $SOURCE_COMMIT"
echo "  production: $ORIGIN"
echo "  app:        $INSTALLED"
echo "  publishing: none (Sparkle and TestFlight unchanged)"
