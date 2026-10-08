#!/usr/bin/env bash
# Manual, isolated sync regression suite. Never contacts production or installs.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "${1:-}" != "--native-only" ]; then
  exec node sync/verify.mjs "$@"
fi
# SwiftPM's Store manifest omits Sparkle; preserve the standalone resolution.
lock_copy=$(mktemp)
cp mac/Package.resolved "$lock_copy"
test_log=$(mktemp)
trap 'cp "$lock_copy" mac/Package.resolved; rm -f "$lock_copy" "$test_log"' EXIT
TEXTTEXT_STORE=1 TEXTTEXT_VAULT_HTTP_TEST=1 swift test --package-path mac --jobs 2 \
  --filter 'LocalVault(SyncTests|SharedEditingTests|RecoveryTests|DeviceStateTests|HTTPContractTests|SessionLifecycleTests|ConnectionControllerTests|CollaborationTests)|DocumentCreationTests|RemoteDocumentStoreTests' 2>&1 | tee "$test_log"
# Swift exits successfully even if a filter selects zero tests. Fail closed.
for suite in Sync SharedEditing Recovery DeviceState HTTPContract SessionLifecycle ConnectionController Collaboration; do
  grep -Eq "Test Case '.*LocalVault${suite}Tests .*' passed" "$test_log" || {
    echo "Required native sync suite did not execute: LocalVault${suite}Tests" >&2
    exit 1
  }
done

for suite in DocumentCreation RemoteDocumentStore; do
  grep -Eq "Test Case '.*${suite}Tests .*' passed" "$test_log" || {
    echo "Required native creation suite did not execute: ${suite}Tests" >&2
    exit 1
  }
done
