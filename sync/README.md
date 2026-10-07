# Sync subsystem

TextText's sync engine has one contract across native files, direct file edits,
browser collaboration and server persistence. This directory owns its executable
verification boundary. It tests production implementations, not a second model
of the merge algorithm. The app UI is a client of this subsystem.

## Implementation boundaries

| Responsibility | Production module |
| --- | --- |
| Full-document CRDT and TextPack projection | `src/lib/vault/collaboration.ts` |
| File merge and conflict preservation | `src/lib/vault/reconcile.ts`, `pack-reconcile.ts` |
| Durable server operations, receipts, locks and tombstones | `src/lib/vault/server-store.ts` |
| Client journal, replay, backoff and lifecycle | `src/local-vault/collaboration-client.ts` |
| Browser and native transport adapters | `src/local-vault/web-transport.ts`, `bridge.ts` |
| Native filesystem coordination and sync | `mac/Sources/TextTextFileProviderKit/LocalVault*` |
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

## Commands

- `npm run test:sync`: portable contracts, TypeScript and native Mac/HTTP tests.
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
A failed rerun invalidates the earlier receipt before tests start. A source change
during execution prevents a receipt. Source, tests, package lock and gate code
are fingerprinted, including additions and deletions. Prose is excluded.

The existing manually invoked release command runs this gate. Even `--skip-tests`
requires matching receipts; it cannot silently waive sync verification. Receipts
live in ignored `.texttext/sync/`. Windows client success cannot stand in for native
Mac success. No hooks, scheduled builds, deployments or source-editing bots are
installed. Automatic runtime recovery is tested; a code regression blocks the
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
