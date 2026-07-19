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
RELEASE_GATE_RECEIPT="${WRITE_RELEASE_GATE_RECEIPT:-}"
if [ -z "$RELEASE_GATE_RECEIPT" ] || [ ! -f "$RELEASE_GATE_RECEIPT" ]; then
  echo "Refusing to attest a build without the exact release gate receipt." >&2
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
  "$WORKFLOW_CONTRACT_HASH" "$CAPABILITY_RECEIPT" \
  "$RELEASE_GATE_RECEIPT" <<'PY'
import datetime
import json
import os
import sys

output, version, build, commit, contract_hash, capability_path, gate_path = sys.argv[1:]
required_gates = {
    "web.types",
    "web.unit",
    "native.unit",
    "native.live_ai",
    "apple.eval",
}
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
with open(gate_path, encoding="utf-8") as handle:
    gate_receipt = json.load(handle)
gate_checks = gate_receipt.get("checks")
if gate_receipt.get("schemaVersion") != 1:
    raise SystemExit("Release gate receipt has the wrong schema.")
if gate_receipt.get("sourceCommit") != commit:
    raise SystemExit("Release gate receipt does not match the source commit.")
if not isinstance(gate_receipt.get("sourceFingerprint"), str) or len(gate_receipt["sourceFingerprint"]) != 64:
    raise SystemExit("Release gate receipt has no source fingerprint.")
if not isinstance(gate_checks, list):
    raise SystemExit("Release gate receipt has no checks.")
gate_ids = [check.get("id") for check in gate_checks if isinstance(check, dict)]
if set(gate_ids) != required_gates or len(gate_ids) != len(required_gates):
    raise SystemExit("Release gate receipt does not contain the required checks.")
for check in gate_checks:
    duration = check.get("durationMilliseconds")
    if check.get("status") != "pass" or not isinstance(duration, int) or duration < 0:
        raise SystemExit("Release gate receipt contains a non-passing or invalid check.")
suites = [
    {
        "id": check["id"],
        "status": "pass",
        "durationMilliseconds": check["durationMilliseconds"],
    }
    for check in gate_checks
] + [
    {"id": capability_id, "status": "pass", "durationMilliseconds": 0}
    for capability_id in capability_ids
]
payload = {
    "schemaVersion": 1,
    "appVersion": version,
    "buildNumber": build,
    "sourceCommit": commit,
    "workflowContractHash": contract_hash,
    "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "releaseGateDurationMilliseconds": gate_receipt.get("totalDurationMilliseconds", 0),
    "suites": suites,
}
temporary = output + ".tmp"
with open(temporary, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, indent=2, sort_keys=True)
    handle.write("\n")
os.replace(temporary, output)
os.chmod(output, 0o600)
PY
