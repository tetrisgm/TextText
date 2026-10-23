#!/usr/bin/env bash
# Human-invoked full sync gate. Keep the producer output for failure diagnosis.
set -euo pipefail
cd "$(dirname "$0")/.."
export TEXTTEXT_MIRROR_POLICY_BUNDLE="$(mktemp -d "${TMPDIR:-/tmp}/texttext-mirror-policy.XXXXXX")"
node src/local-vault/__tests__/mirror-policy.browser.mjs
exec node scripts/with-local-database.mjs node sync/verify.mjs "$@"
