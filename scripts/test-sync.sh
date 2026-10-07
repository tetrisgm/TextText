#!/usr/bin/env bash
# Manual, isolated sync regression suite. Never contacts production or installs.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "${1:-}" != "--native-only" ]; then
  npx vitest run --maxWorkers=2 \
    src/local-vault/collaboration-client.test.ts src/local-vault/web-transport.test.ts \
    src/local-vault/bridge.test.ts src/local-vault/presence-client.test.ts \
    src/lib/vault/server-collaboration.test.ts src/lib/vault/server-store.test.ts \
    src/lib/vault/collaboration.test.ts src/lib/vault/reconcile.test.ts \
    src/lib/vault/pack-reconcile.test.ts src/lib/vault/server-presence.test.ts
  npx tsc --noEmit --pretty false
fi
# SwiftPM's Store manifest omits Sparkle; preserve the standalone resolution.
lock_copy=$(mktemp)
cp mac/Package.resolved "$lock_copy"
trap 'cp "$lock_copy" mac/Package.resolved; rm -f "$lock_copy"' EXIT
TEXTTEXT_STORE=1 TEXTTEXT_VAULT_HTTP_TEST=1 swift test --package-path mac --jobs 2 \
  --filter 'LocalVault(SyncTests|SharedEditingTests|RecoveryTests|DeviceStateTests|HTTPContractTests|SessionLifecycleTests|ConnectionControllerTests|CollaborationTests)'
