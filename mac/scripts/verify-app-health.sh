#!/usr/bin/env bash
# Run the app's own content-blind reliability checks against a staged bundle.
# The workspace and state are isolated so release verification can never touch
# a person's documents or credentials.
set -euo pipefail

APP="${1:-}"
EXPECTED_VERSION="${2:-}"
EXPECTED_BUILD="${3:-}"
if [ ! -x "$APP/Contents/MacOS/TextText" ] || [ -z "$EXPECTED_VERSION" ] || [ -z "$EXPECTED_BUILD" ]; then
  echo "Usage: verify-app-health.sh <TextText.app> <version> <build>" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
"$SCRIPT_DIR/verify-apple-silicon-app.sh" "$APP" --require-extensions

ROOT="$(mktemp -d -t texttext-app-health)"
trap 'rm -rf "$ROOT"' EXIT
mkdir -p "$ROOT/state" "$ROOT/workspace"
REPORT="$ROOT/report.json"

TEXTTEXT_STATE_DIR="$ROOT/state" \
TEXTTEXT_SYNC_ROOT="$ROOT/workspace" \
TEXTTEXT_HEALTH_CHECK=1 \
  "$APP/Contents/MacOS/TextText" > "$REPORT"

python3 - "$REPORT" "$EXPECTED_VERSION" "$EXPECTED_BUILD" "$REPO_ROOT/mac/health-checks.json" <<'PY'
import json
import sys

path, version, build, manifest_path = sys.argv[1:]
with open(path, encoding="utf-8") as handle:
    report = json.load(handle)

# The canonical list lives in Swift (TextTextHealthChecks.required) and is
# generated into this manifest, so retiring a check is one edit rather than
# three hardcoded lists in three languages discovered over three failed ships.
with open(manifest_path, encoding="utf-8") as handle:
    required = set(json.load(handle)["required"])
ids = {check["id"] for check in report.get("checks", [])}
assert report.get("schemaVersion") == 1, "unexpected health schema"
assert report.get("appVersion") == version, "health report version mismatch"
assert report.get("buildNumber") == build, "health report build mismatch"
assert report.get("trigger") == "releaseVerification", "wrong health trigger"
assert report.get("status") == "pass", "staged app health is not pass"
assert required <= ids, "staged app omitted required health checks"
assert len(ids) == len(report.get("checks", [])), "staged app duplicated health checks"
assert all(check["status"] == "pass" for check in report["checks"]), (
    "staged app contains a non-passing check"
)
for check in report["checks"]:
    assert isinstance(check.get("durationMilliseconds"), int)
    assert all(isinstance(value, (int, float)) for value in check.get("metrics", {}).values())
print(f"   app health: {report['status']} ({len(report['checks'])} checks)")
PY
