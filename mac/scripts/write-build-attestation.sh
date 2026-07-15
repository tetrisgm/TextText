#!/usr/bin/env bash
# Write the content-blind release-gate receipt embedded in Write.app.
set -euo pipefail

OUTPUT="${1:-}"
VERSION="${2:-}"
BUILD="${3:-}"
if [ -z "$OUTPUT" ] || [ -z "$VERSION" ] || [ -z "$BUILD" ]; then
  echo "Usage: write-build-attestation.sh <output.json> <version> <build>" >&2
  exit 1
fi
if [ "${WRITE_RELEASE_GATES_VERIFIED:-0}" != "1" ]; then
  echo "Refusing to attest a build before the release gates pass." >&2
  exit 1
fi
CAPABILITY_RECEIPT="${WRITE_WORKFLOW_CAPABILITY_RECEIPT:-}"
if [ -z "$CAPABILITY_RECEIPT" ] || [ ! -f "$CAPABILITY_RECEIPT" ]; then
  echo "Refusing to attest a build without a workflow capability receipt." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SOURCE_COMMIT="$(git -C "$ROOT" rev-parse HEAD)"
WORKFLOW_CONTRACT_HASH="$(shasum -a 256 "$ROOT/src/lib/ai/tools.ts" | awk '{print $1}')"
mkdir -p "$(dirname "$OUTPUT")"

python3 - \
  "$OUTPUT" "$VERSION" "$BUILD" "$SOURCE_COMMIT" \
  "$WORKFLOW_CONTRACT_HASH" "$CAPABILITY_RECEIPT" <<'PY'
import datetime
import json
import os
import sys

output, version, build, commit, contract_hash, capability_path = sys.argv[1:]
required_capabilities = {
    "workflow.folder_trash_restore",
    "workflow.sharing_access",
    "workflow.comments",
    "workflow.bookmark_recapture",
    "workflow.cover_assets",
}
with open(capability_path, encoding="utf-8") as handle:
    capability_receipt = json.load(handle)
checks = capability_receipt.get("checks")
if capability_receipt.get("schemaVersion") != 1:
    raise SystemExit("Workflow capability receipt has the wrong schema.")
if capability_receipt.get("sourceCommit") != commit:
    raise SystemExit("Workflow capability receipt does not match the source commit.")
if capability_receipt.get("contractHash") != contract_hash:
    raise SystemExit("Workflow capability receipt does not match the command contract.")
if not isinstance(checks, list):
    raise SystemExit("Workflow capability receipt has no checks.")
capability_ids = [check.get("id") for check in checks if isinstance(check, dict)]
if len(capability_ids) != len(checks) or len(set(capability_ids)) != len(capability_ids):
    raise SystemExit("Workflow capability receipt has invalid or duplicate checks.")
if set(capability_ids) != required_capabilities:
    raise SystemExit("Workflow capability receipt does not contain the required checks.")
if any(set(check) != {"id", "status"} or check.get("status") != "pass" for check in checks):
    raise SystemExit("Workflow capability receipt contains a non-passing check.")
suites = [
    "web.types",
    "web.unit",
    "native.unit",
    "web.build",
    "apple.eval",
] + capability_ids
payload = {
    "schemaVersion": 1,
    "appVersion": version,
    "buildNumber": build,
    "sourceCommit": commit,
    "workflowContractHash": contract_hash,
    "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "suites": [{"id": suite, "status": "pass"} for suite in suites],
}
temporary = output + ".tmp"
with open(temporary, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, indent=2, sort_keys=True)
    handle.write("\n")
os.replace(temporary, output)
os.chmod(output, 0o600)
PY
