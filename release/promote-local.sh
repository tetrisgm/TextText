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
# The delivery lock serializes promotions; the timestamp distinguishes retries
# of the same committed source without changing the source version.
PROMOTION_ID="tt-${BUILD}-${SOURCE_COMMIT:0:8}-$(printf '%x' "$(date -u +%s)")"

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

echo ">> guard the private Oracle database"
npx tsx "$ROOT/scripts/work-unit.ts" run \
  --name database.promotion_preflight --timeout 120 --no-reuse -- \
  "$ROOT/release/oracle/database.sh" --check

echo ">> back up and run every production migration and backfill"
npx tsx "$ROOT/scripts/work-unit.ts" run \
  --name database.promotion_migrations --timeout 1800 --no-reuse -- \
  "$ROOT/release/oracle/database.sh" --migrate

echo ">> build and deploy the exact source to Oracle"
# Build this committed source rather than accepting an unrelated caller-supplied
# archive. The Oracle helper verifies the archive and restores the prior app if
# its health or authenticated workflow smoke fails. Database credentials stay
# on the server; that mandatory smoke completes before the local install.
TEXTTEXT_ORACLE_ARTIFACT= npx tsx "$ROOT/scripts/work-unit.ts" run \
  --name web.promotion_deploy --timeout 3600 --no-reuse -- \
  "$ROOT/release/oracle/deploy.sh"

smoke_page() {
  local url="$1" expected="$2" body="" attempt
  for attempt in {1..30}; do
    body="$(curl -fsSL --max-time 10 -H 'Cache-Control: no-cache' "$url?promotion=$PROMOTION_ID-$attempt" || true)"
    if [[ "$body" == *"$expected"* ]]; then return 0; fi
    [[ "$attempt" == "30" ]] || sleep 2
  done
  return 1
}

echo ">> verify the exact build at the public product origin"
node --input-type=module - "$ORIGIN" "$PROMOTION_ID" <<'JS'
const [origin, expected] = process.argv.slice(2);
let found = false;
for (let attempt = 1; attempt <= 30; attempt += 1) {
  try {
    const response = await fetch(`${origin}/api/app/build?promotion=${expected}-${attempt}`, {
      headers: { "cache-control": "no-cache" },
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok && (await response.json()).buildId === expected) {
      found = true;
      break;
    }
  } catch {}
  if (attempt < 30) await new Promise((resolve) => setTimeout(resolve, 2000));
}
if (!found) throw new Error("The product origin is not serving the promoted build.");
JS

smoke_page "$ORIGIN/docs/item-types" "Build item types with AI" || {
  echo "The product origin did not render the item-type guide." >&2
  exit 1
}
smoke_page "$ORIGIN/signin" "Sign in" || {
  echo "The production sign-in route did not render." >&2
  exit 1
}

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

echo
echo "Promoted and installed TextText $VERSION build $BUILD"
echo "  source:     $SOURCE_COMMIT"
echo "  production: $ORIGIN"
echo "  app:        $INSTALLED"
echo "  publishing: none (Sparkle and TestFlight unchanged)"
