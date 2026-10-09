#!/usr/bin/env bash
# Contract test for verify-app-health.sh: the host never creates or removes
# anything inside the app's sandbox container, the app is asked for its own
# isolated run directory, and the report contract is still enforced.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WRAPPER="$SCRIPT_DIR/verify-app-health.sh"
bash -n "$WRAPPER"

FIXTURE="$(mktemp -d -t texttext-verify-app-health-test)"
trap 'rm -rf "$FIXTURE"' EXIT
APP="$FIXTURE/TextText.app"
mkdir -p "$APP/Contents/MacOS" "$FIXTURE/Home"
/usr/libexec/PlistBuddy -c 'Add :CFBundleIdentifier string app.texttext.fixture' \
  "$APP/Contents/Info.plist" >/dev/null

# The stub records the environment it was launched with and prints a report
# whose status comes from TEXTTEXT_FIXTURE_STATUS. It writes nothing to disk
# except the recorded environment, mirroring an app that keeps its state in
# its own container.
cat > "$APP/Contents/MacOS/TextText" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
{
  echo "HEALTH_CHECK=${TEXTTEXT_HEALTH_CHECK:-}"
  echo "ISOLATION_ID=${TEXTTEXT_HEALTH_ISOLATION_ID:-}"
  echo "STATE_DIR=${TEXTTEXT_STATE_DIR:-}"
  echo "VAULT_CONFIG=${TEXTTEXT_VAULT_CONFIG:-}"
} > "$TEXTTEXT_FIXTURE_ENV_OUT"
python3 - "$TEXTTEXT_FIXTURE_MANIFEST" "$TEXTTEXT_FIXTURE_STATUS" <<'PY'
import json, sys
manifest, status = sys.argv[1:]
required = json.load(open(manifest, encoding="utf-8"))["required"]
checks = [
    {"id": cid, "status": "pass", "durationMilliseconds": 1, "metrics": {"ok": 1}}
    for cid in required
]
if status != "pass":
    checks[-1]["status"] = status
print(json.dumps({
    "schemaVersion": 1,
    "appVersion": "1.2",
    "buildNumber": "34",
    "trigger": "releaseVerification",
    "status": status,
    "checks": checks,
}))
PY
STUB
chmod +x "$APP/Contents/MacOS/TextText"

run_wrapper() {
  HOME="$FIXTURE/Home" \
  TEXTTEXT_HEALTH_SKIP_BINARY_VERIFICATION=1 \
  TEXTTEXT_FIXTURE_ENV_OUT="$FIXTURE/env.txt" \
  TEXTTEXT_FIXTURE_MANIFEST="$REPO_ROOT/mac/health-checks.json" \
  TEXTTEXT_FIXTURE_STATUS="$1" \
  TEXTTEXT_STATE_DIR="$FIXTURE/host-state-must-not-leak" \
  TEXTTEXT_VAULT_CONFIG="$FIXTURE/host-vault-must-not-leak.json" \
    "$WRAPPER" "$APP" 1.2 34
}

run_wrapper pass >/dev/null

grep -q '^HEALTH_CHECK=1$' "$FIXTURE/env.txt" || { echo "wrapper did not request a health check" >&2; exit 1; }
grep -q '^ISOLATION_ID=34-[0-9][0-9]*$' "$FIXTURE/env.txt" || {
  echo "wrapper did not hand the app a build-scoped isolation token" >&2; exit 1; }
grep -q '^STATE_DIR=$' "$FIXTURE/env.txt" || {
  echo "wrapper leaked a host TEXTTEXT_STATE_DIR into the app" >&2; exit 1; }
grep -q '^VAULT_CONFIG=$' "$FIXTURE/env.txt" || {
  echo "wrapper leaked a host TEXTTEXT_VAULT_CONFIG into the app" >&2; exit 1; }
if [ -e "$FIXTURE/Home/Library" ]; then
  echo "wrapper created directories under the (sandbox-owned) home" >&2; exit 1
fi
if grep -q 'Library/Containers' "$WRAPPER"; then
  echo "wrapper still reaches into the sandbox container from the host" >&2; exit 1
fi

if run_wrapper warning >/dev/null 2>&1; then
  echo "wrapper accepted a non-pass report" >&2; exit 1
fi
if run_wrapper fail >/dev/null 2>&1; then
  echo "wrapper accepted a failing report" >&2; exit 1
fi

echo "verify-app-health.sh contract: ok"
