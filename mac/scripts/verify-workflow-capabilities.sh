#!/usr/bin/env bash
# Produce a content-blind receipt for web-owned workflow command contracts.
set -euo pipefail

OUTPUT="${1:-}"
if [ -z "$OUTPUT" ]; then
  echo "Usage: verify-workflow-capabilities.sh <output.json>" >&2
  exit 64
fi
if [ "${WRITE_RELEASE_GATES_VERIFIED:-0}" != "1" ]; then
  echo "Refusing to issue workflow receipts before the release gates pass." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SOURCE_COMMIT="$(git -C "$ROOT" rev-parse HEAD)"
CONTRACT_HASH="$(shasum -a 256 "$ROOT/src/lib/ai/tools.ts" | awk '{print $1}')"

cd "$ROOT"
npx tsx mac/scripts/workflow-capability-eval.ts \
  "$OUTPUT" "$SOURCE_COMMIT" "$CONTRACT_HASH"
