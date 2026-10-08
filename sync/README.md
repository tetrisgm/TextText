# Sync subsystem

TextText's sync engine has one contract across native files, direct file edits,
browser collaboration and server persistence. `src/sync` owns the production engine; this directory owns its executable
verification boundary. It tests production implementations, not a second model
of the merge algorithm. The app UI is a client of this subsystem.

## Implementation boundaries

| Responsibility | Production module |
| --- | --- |
| Full-document CRDT and TextPack projection | `src/sync/engine/collaboration.ts` |
| File merge and conflict preservation | `src/sync/engine/reconcile.ts`, `pack-reconcile.ts` |
| Durable server operations, receipts, locks and tombstones | `src/sync/engine/store.ts` |
| Client journal, replay, backoff and lifecycle | `src/sync/engine/client.ts` |
| Browser and native transport adapters | `src/local-vault/web-transport.ts`, `bridge.ts` |
| Native filesystem coordination and sync | `mac/Sources/TextTextFileProviderKit/LocalVault*` |
| Windows native files, outbox and shared checkpoints | `windows/TextText.Core/` (no WPF/WebView/account dependencies) |
| Native session ownership and authentication renewal | `mac/Sources/TextText/LocalVaultCollaboration.swift` |
| Authenticated HTTP boundary | `src/app/api/vault/` |

These modules share Yjs and the validated DocumentSnapshot/TextPack format.
Transport failures must not become document failures. Native and browser adapters
must preserve operation IDs, epoch fences and cancellation semantics. Filesystem
agents can change text.md directly without a parallel document.json rewrite.

## Required invariants

1. Persist pending edits before sending. Keep them through restart or failed ACK.
2. Retry the same operation, not a newly identified duplicate. An acknowledged
   operation appears exactly once after replay, including a killed server writer.
3. Successful reads cannot reset upload backoff. Transient 429/5xx/network errors
   retry automatically; recovered connectivity resumes without a user button.
4. Credential renewal may retry a rejected in-flight request only within the
   same bound workspace. Revocation, account changes and stale epochs fail closed.
5. Direct Markdown edits and CRDT edits preserve each other when safely mergeable.
   Ambiguous overlapping file replacements retain both versions. No silent loss.
6. Missing or evicted provider files are not deletion instructions. Explicit
   deletes use tombstones; stale writers cannot resurrect or overwrite them.
7. Renames retain item identity, metadata paths and pending operations.
8. Idle clients do not rewrite content. Search invalidates when file content changes.
9. Cookie-auth writes validate the configured public origin behind a proxy.
10. Local window/session lifetime must not cancel another live editor's session.
11. Restoring a deleted item preserves its identity but begins a new lifecycle.
    Pre-delete uploads and collaboration updates cannot modify the restored item.
    A passive client with an old pending delete must converge without deleting
    the restoration; newer local work remains recoverable. Retrying restoration
    cannot replace edits accepted after the original restore.

## Shared workspace manifests

The authenticated items manifest reports `fullAccess`, `canCreateContent`,
`writableFolders` and each item's/tombstone's `canEditContent`. These describe
current permissions; every server mutation still reauthorizes under its commit
lock. A partial listing omits inaccessible files, so absence never means deletion
or permission to recreate a missing item. Retain unauthorized local edits and
operation identities without continuously retrying a forbidden write.

New files may be uploaded only with workspace creation permission or inside a
listed writable folder (including descendants). Existing items use their exact
item capability. Move/delete currently require full workspace editing access.
Client caches retain permissions with their manifest and refresh them before
uploading; a missing capability is not an authorization grant.

ETags include capabilities so a role change invalidates an otherwise unchanged
manifest. The HTTP route maps a matching permission-aware ETag back to the raw
file revision before waiting on the filesystem, preserving long-poll behavior.
Core route regressions cover downgrade, scoped paths and unchanged long polls;
local PostgreSQL grants tests cover account-bound membership discovery.

## Commands

- `windows/scripts/build.ps1`: native Windows storage/agent checks, shared client tests, TypeScript, and a source-bound self-contained candidate.
- `windows/scripts/smoke.ps1`: real WebView editor plus actual native-window save/close handshake, isolated from user accounts.
- `npm run test:sync`: portable contracts, TypeScript, native Mac/HTTP tests and
  the portable Windows file/sync core regressions on the Mac.
- `npm run test:sync:core`: server/client tests and TypeScript on macOS/Linux.
- `npm run test:sync:client`: client/transport/merge/auth tests and TypeScript on Windows.
- `npm run test:sync:check`: require passing Mac core/native receipts for the
  current input fingerprint and Node version. Does not run tests or mutate files.
- `node sync/verify.mjs --client-only --check`: check the current platform's client receipt.

Two workers / two Swift jobs bound resource use. Tests use temporary directories,
fake credentials and local HTTP fixtures; no production account or vault is used.
`recovery.test.ts` uses reproducible seeds for mixed writers, reordered delivery,
external file replacement and lost acknowledgements. Existing suites include
actual child-process termination and a native-to-TypeScript HTTP contract.
The core gate also runs hosted file-agent commands, comment operations and agent
presence: lost acknowledgements, reused operation keys, commit-time authority,
comment replay/attribution, cleanup, and expiry use the production file store.
A failed rerun invalidates the earlier receipt before tests start. A source change
during execution prevents a receipt. Source, tests, package lock and gate code
are fingerprinted, including additions and deletions. Prose is excluded.
The Windows core, native desktop adapters and regression sources are included;
generated .NET `bin`/`obj` output and downloaded desktop `Runtime` are excluded. Windows candidate builds also execute these
tests on Windows, where filesystem behavior is platform-specific.

The public entry points are `src/sync/client.ts` and `src/sync/server.ts`.
Old import locations contain only compatibility exports. Dependency tests follow
the engine's runtime imports and reject UI, routes and account/store dependencies;
the client entry additionally rejects Node dependencies. Native LocalVault files
are checked against AppKit/SwiftUI/WebKit imports. The native filesystem adapter
remains in its existing independently compiled Swift library.

The existing manually invoked release command runs this gate. Even `--skip-tests`
requires matching receipts; it cannot silently waive sync verification. Receipts
live in ignored `.texttext/sync/`. Windows client success cannot stand in for native
Mac success. Normal local Mac build commands also check receipts and automatically rerun
verification when stale; a regression stops them before compilation/signing.
No hooks, scheduled builds, deployments or source-editing bots are installed. Automatic runtime recovery is tested; a code regression blocks the
release and must be fixed, never hidden by retrying tests until they pass.

## Extending the subsystem

Add each reproduced defect as a failing regression in the relevant production
suite, or as a cross-boundary scenario here. Add its suite to `vitest.config.mts`
if it is not included. Preserve failure details and seed in assertions so a future
change can reproduce the exact case. Validate input fingerprints rather than
reusing a claim that an older commit passed. Install dependencies with npm 11.10.0 (the Mac version); npm 10 on the PC
misresolves the existing esbuild lock. Run on Mac and Windows after portable
filesystem, process or path changes. Mac-native tests remain required separately.

Actual second-device iCloud delivery and power-loss behavior require physical
integration checks; provider-absence and SIGKILL tests do not establish either.
See `docs/verification/2026-10-07-sync-failure-audit.md` for the live baseline.


The Windows directory-fsync probe returned EPERM. Server crash/persistence tests
therefore run on POSIX hosts; no fsync was removed or weakened. Windows verifies
its actual supported client boundary, not server power-loss durability. A missing
or skipped native suite fails the Mac gate even if Swift exits with status zero.

## Version compatibility

`fixtures/v1-pending-journal.json` was captured from source `5085642a` before the
engine extraction. Keep it as historical data; do not regenerate it with the
current implementation to make tests pass. It contains an old TextPack, baseline,
pending upload and original operation ID. `compatibility.test.ts` reopens and
replays it against the current engine, verifying the exact final text and one
operation. An unknown future journal is preserved unchanged with zero network
requests. Add fixtures when introducing a new persisted/protocol version, and
retain earlier versions for the supported upgrade window. Version migrations
must be explicit and tested for interruption before changing stored user data.

## Shared product surface

Mac `main.tsx`, Windows `windows-main.tsx`, and web `WebVault.tsx` mount
`VaultApp`. That app owns the collection views and the same document editor and
collaboration client. Both native bundles use `scripts/build-local-vault.mjs`;
the Windows entry adds its RPC transport. `sync/shared-ui.test.ts` guards those
composition and packaging boundaries in both core and Windows client gates.
It does not claim identical native authentication, menus, or filesystem behavior.

Remaining platform differences requiring behavioral tests are the Mac Swift
file transport, Windows RPC/local search cache, and web server search/storage.
Windows already delegates ordinary item/template operations through the web
transport with a native fetch adapter. Native filesystem persistence remains
Swift/C# because provider coordination and durability are platform responsibilities.
The architecture gate prevents replacing shared composition with a platform view;
real browser/editor and native smoke tests remain required to prove behavior.
