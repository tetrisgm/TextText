#!/usr/bin/env bash
# Run the app's own content-blind reliability checks against a staged bundle.
# The workspace and state are isolated so release verification can never touch
# a person's documents or credentials.
set -euo pipefail

APP="${1:-}"
EXPECTED_VERSION="${2:-}"
EXPECTED_BUILD="${3:-}"
if [ ! -x "$APP/Contents/MacOS/Write" ] || [ -z "$EXPECTED_VERSION" ] || [ -z "$EXPECTED_BUILD" ]; then
  echo "Usage: verify-app-health.sh <Write.app> <version> <build>" >&2
  exit 1
fi

ROOT="$(mktemp -d -t write-app-health)"
trap 'rm -rf "$ROOT"' EXIT
mkdir -p "$ROOT/state" "$ROOT/workspace"
REPORT="$ROOT/report.json"

WRITE_STATE_DIR="$ROOT/state" \
WRITE_SYNC_ROOT="$ROOT/workspace" \
WRITE_HEALTH_CHECK=1 \
  "$APP/Contents/MacOS/Write" > "$REPORT"

python3 - "$REPORT" "$EXPECTED_VERSION" "$EXPECTED_BUILD" <<'PY'
import json
import sys

path, version, build = sys.argv[1:]
with open(path, encoding="utf-8") as handle:
    report = json.load(handle)

required = {
    "bundle.release",
    "build.attestation",
    "bundle.extensions",
    "selftest.markdown_identity",
    "selftest.filename_codec",
    "selftest.document_assets",
    "selftest.public_link",
    "state.persistence",
    "sync.index",
    "workspace.storage",
    "finder.provider",
}
ids = {check["id"] for check in report.get("checks", [])}
assert report.get("schemaVersion") == 1, "unexpected health schema"
assert report.get("appVersion") == version, "health report version mismatch"
assert report.get("buildNumber") == build, "health report build mismatch"
assert report.get("trigger") == "releaseVerification", "wrong health trigger"
assert report.get("status") != "fail", "staged app health failed"
assert required <= ids, "staged app omitted required health checks"
assert all(
    check["status"] == "pass"
    for check in report["checks"]
    if check["id"].startswith("selftest.") or check["id"] == "build.attestation"
), "staged app self-tests or build attestation failed"
for check in report["checks"]:
    assert isinstance(check.get("durationMilliseconds"), int)
    assert all(isinstance(value, (int, float)) for value in check.get("metrics", {}).values())
print(f"   app health: {report['status']} ({len(report['checks'])} checks)")
PY
