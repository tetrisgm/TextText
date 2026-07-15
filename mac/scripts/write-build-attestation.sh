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

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SOURCE_COMMIT="$(git -C "$ROOT" rev-parse HEAD)"
mkdir -p "$(dirname "$OUTPUT")"

python3 - "$OUTPUT" "$VERSION" "$BUILD" "$SOURCE_COMMIT" <<'PY'
import datetime
import json
import os
import sys

output, version, build, commit = sys.argv[1:]
suites = [
    "web.types",
    "web.unit",
    "native.unit",
    "web.build",
    "apple.eval",
]
payload = {
    "schemaVersion": 1,
    "appVersion": version,
    "buildNumber": build,
    "sourceCommit": commit,
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
