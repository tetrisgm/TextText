#!/usr/bin/env bash
# Run the app's own content-blind reliability checks against a staged bundle.
# The workspace and state are isolated so release verification can never touch
# a person's documents or credentials.
set -euo pipefail

APP="${1:-}"
EXPECTED_VERSION="${2:-}"
EXPECTED_BUILD="${3:-}"
if [ ! -x "$APP/Contents/MacOS/Write" ] || [ -z "$EXPECTED_VERSION" ] || [ -z "$EXPECTED_BUILD" ]; then
  echo "Usage: verify-app-health.sh <Texttext.app> <version> <build>" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
"$SCRIPT_DIR/verify-apple-silicon-app.sh" "$APP" --require-extensions

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
    "selftest.document_projection",
    "selftest.public_link",
    "selftest.native_agent_contract",
    "workflow.document_engine",
    "workflow.collaboration",
    "workflow.folder_trash_restore",
    "workflow.sharing_access",
    "workflow.comments",
    "workflow.bookmark_recapture",
    "workflow.cover_assets",
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
