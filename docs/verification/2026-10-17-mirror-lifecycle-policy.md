# Shared mirror lifecycle classification

October 17 T11 slice after `0daff4cd` shared retry timing. Source/isolated-host validation only; installed acceptance is separate.

## Contract and ownership

The packaged TypeScript policy classifies restored lifecycle metadata and pending operations. Seventeen identical serialized vectors run through the host and native adapters. Missing/deleted remote state, missing lifecycle, and editor ownership defer classification. Legacy metadata adopts a lifecycle only against the exact known remote revision. A stale deletion is retired; a stale edit is fenced with its original recovery bytes. Already-conflicted legacy operations retain their fence, including Windows legacy `conflict` operations. IDs, payloads, queue order and attribution remain native.

Native engines prepare decisions while holding existing workspace ownership. An action-bearing batch refreshes the remote manifest and compares revision, lifecycle, path and deletion state before queue mutation. Local baseline, original pending operation, intent and editor ownership are rechecked after awaits. Mac also checks its separate conflict record. A no-op batch adds no manifest refresh or lifecycle journal write. Recovery payloads are streamed one item at a time; the Mac conflict download gets another remote/ownership check before retirement.

Mac requires coherent bounded staged bytes with the original hash before clearing an old pending upload/rename. Both recovery copies are fsynced before journal retirement, and persistence failures restore in-memory state. Native intent cleanup compares the exact captured intent under the existing store lock so a newer deletion survives. Windows preserves each operation's position and durable identity; rename operations without an embedded payload keep their existing queue fence.

A local server snapshot cannot atomically lock a later backend restore. A restore after the final read remains possible; existing outbound revision CAS and lifecycle checks remain in place. Decisions do not grant authority to overwrite newer remote content, and conflict handling preserves staged bytes.

## Focused evidence (update after final gate)

- TS policy/host: 24 tests pass, `/private/tmp/texttext-t11-lifecycle-ts.log`.
- Packaged browser fixture passes all shared vectors offline and rejects old page identity after reload: `/private/tmp/texttext-t11-lifecycle-bundle.log`; fixture `/private/tmp/texttext-t11-lifecycle-policy-fixture`.
- Full portable Windows Core passes, including all lifecycle vectors/regressions and no-op manifest-count checks: `/private/tmp/texttext-t13-local-rename-final.log` (exit 0, full-suite terminal success). Earlier `/private/tmp/texttext-t13-local-rename-before.log` passed lifecycle checks then intentionally failed at the separately reproduced raw-rename bug.
- Actual WKWebView: both policy-host tests pass with the rebuilt fixture, including all lifecycle vectors with the production window closed: `/private/tmp/texttext-lifecycle-publish-wk-final.log` (exit 0). The same run passes ten stable-store tests.
- Final focused Swift lifecycle source: all 52 `LocalVaultSyncTests` pass in `/private/tmp/texttext-publish-result-before.log`, including missing/corrupt payload, restore during policy RPC, deletion-intent retention, and restore during conflict download. That combined run intentionally fails only the independent publication-result red test.
- Earlier failures are retained: `/private/tmp/texttext-t11-lifecycle-swift.log` had two recovery-count assertions (existing reporting repeats the same two paths); `/private/tmp/texttext-lifecycle-samepath-swift-final.log` exposed a non-UUID deletion fixture ID correctly rejected by production validation. Tests now assert unique paths and use a stable UUID. Product behavior was not relaxed.

### Actual PC follow-up, October 18

Product source `8cf38c26` was copied from an immutable Git archive, SHA-256 `6e15e68734ef80c92bdcd542a86005da1668d189e94a70f647be1a7a373f347a`, into the existing private test checkout. Shared UI and desktop test builds passed. The first Core run exposed a test apphost runtime-discovery failure; `ce5a5481` explicitly launches owned child tests through the running private runtime. With those test-only changes, the complete actual PC Core suite passed, including restore/rename regressions. Remote log: `C:\Users\Shokunin\dev\texttext-native-8cf38c26-core-runtime.log`.

The full interactive PC desktop smoke passed, task exit 0, including all shared lifecycle vectors in visible and hidden WebView2, page reload fencing, production policy factory, retained-state authentication recovery, composition and normal close/activation guards. Local receipts: `/private/tmp/texttext-lifecycle-pc-smoke-20261018.log` and `/private/tmp/texttext-lifecycle-pc-desktop-20261018.log`; remote receipt directory `windows/build/mirror-lifecycle-smoke-20261018` in the private checkout. WebView2 was 155.0.4283.62. No candidate was installed or sealed by this check.

## Remaining explicit work

T11 is not complete: remaining queue eligibility, binary lifecycle, missing-remote/placeholder behavior and page-process recovery are separate slices. The new policy currently adds an RPC per eligible remote item (per queued operation on Windows); measure large-workspace latency before choosing a shared batched request contract. Do not add a native fallback.

T14 must separately address generic `preserveConflict`/`preserveDeletedConflict` callsites that still allow missing staged bytes via `try?`; this slice requires bytes specifically on lifecycle retirement. Existing different native recovery layouts remain: Mac saves separate conflict records then retires the old pending entry; Windows retains an explicitly conflicted outbox entry.

## Source and repeat commands

- Shared policy, vectors and host: `src/sync/engine/mirror-lifecycle*`, `sync/fixtures/mirror-lifecycle.json`, `src/local-vault/mirror-policy-host*`, `scripts/build-local-vault.mjs`.
- Native adapters/engines: `LocalVaultMirrorPolicy.swift`, `LocalVaultSync.swift`, `MirrorPolicy.cs`, and the `ReconcileLifecycles` helper/callsite in `SyncEngine.cs`.
- Intent CAS primitives: `LocalVaultDeviceState.swift`, `TextPackStore.cs`.
- Test helpers, engine regressions and actual WK/WebView2 vector fixtures were extended; `SyncEngine.cs` and Core `Program.cs` also contain the separately coordinated raw-rename slice.

```sh
npx vitest run --config sync/vitest.client.config.mts src/sync/engine/mirror-lifecycle.test.ts src/local-vault/mirror-policy-host.test.ts
TEXTTEXT_MIRROR_POLICY_BUNDLE=/private/tmp/texttext-t11-lifecycle-policy-fixture node src/local-vault/__tests__/mirror-policy.browser.mjs
TEXTTEXT_STORE=1 swift test --package-path mac --jobs 2 --filter LocalVaultSyncTests
dotnet run --project windows/TextText.Core.Tests/TextText.Core.Tests.csproj --configuration Release
```

Preserve and restore `mac/Package.resolved` exactly around SwiftPM commands. The final native campaign must provide the rebuilt fixture to both actual host tests.
