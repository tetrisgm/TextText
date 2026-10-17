# Native document leases

T09, October 17. Source and isolated process verification; not installed acceptance.

## Reproduction and change

Independent Mac `LocalVaultSync` actors and Windows `SyncEngine`/`SharedEditingStore` instances could open the same document concurrently. New regressions failed before the fix on both implementations (`/private/tmp/texttext-t09-native-owner-before-{mac,windows}.log`). The prior account-adoption lease deliberately allowed ordinary actors and was not a document ownership fence.

The active document session now retains a device-private OS lock: nonblocking `flock` on Mac and an exclusive file handle on Windows. Acquisition occurs before retained-state recovery or session publication. The descriptor survives checkpoints and is released with the existing session. Lock files are never deleted or expired; process death releases the OS lock. A replacement receives a new session token, so a late old token cannot checkpoint through it. No content format, credential, tunnel, daemon or installed job changed.

## Verification

- `LocalVaultSharedEditingTests/testIndependentActorsCannotOwnTheSameDocument`: failed before, passed after. A second actor cannot displace the active one; normal release permits a new token.
- `LocalVaultSharedEditingTests/testKilledNativeOwnerReleasesLeaseAndPreservesPendingJournal`: an isolated child xctest process opens a saved pending document, a competing actor is refused, the parent sends SIGKILL to its own child, then takes over without deleting a lock. Exact journal and text survive; the terminated owner's token is refused. The helper skips outside this controlled parent invocation.
- Windows `DocumentOwnershipTests` runs equivalent competing-instance and killed-child tests through the production core. A pending journal including `retained-process-operation` survives byte-for-byte, as does its TextPack; old-token checkpoint is refused. The portable .NET core suite passed on the Mac (`/private/tmp/texttext-t09-process-dotnet.log`).
- Full `bash scripts/test-sync.sh --native-only` passed: 42 Mac app, 119 Kit (four helper/manual skips), 40 agent tests and Windows Core. Log `/private/tmp/texttext-t09-document-lease-native-gate.log`.
- Physical Windows PC: copied the four changed core/test files into the existing staging checkout and ran its full Release core suite with the installed build SDK. All competing-actor, killed-child, exact journal/file and stale-token assertions passed, followed by the complete core suite (exit 0). Receipt `C:\Users\Shokunin\dev\texttext-t09-document-lease-core.log`. No app install or machine configuration changed.
- Focused Mac logs: `/private/tmp/texttext-t09-native-owner-after-mac.log` and `/private/tmp/texttext-t09-process-mac.log`. Windows core before/after logs: `/private/tmp/texttext-t09-native-owner-{before,after}-windows.log`.

## Remaining scope

This establishes competing document session exclusion and process-death takeover. Background mirror cooperation across separate actors, mixed-version writers, physical current-app account transitions, and wider editor/IME continuity still require their own checks. Installed binaries remain unchanged. Do not treat this as proof that a second process's background sync already honors the new document lock.

## Follow-up: duplicate open in one Windows store

The same-store `OpenAsync` path implicitly closed an existing session before opening another. The new duplicate-view regression failed against that path (`/private/tmp/texttext-t09-duplicate-open-before.log`). It now refuses the duplicate without changing ownership. The caller must finish saving and explicitly close its own handle before replacement.

The full Windows Core suite passes on the Mac after the fix (`/private/tmp/texttext-t09-duplicate-open-after.log`). The existing late-close test now checkpoints pending work, verifies duplicate refusal, explicitly releases, reopens the retained journal, and verifies a late old close/checkpoint cannot affect the replacement. It retains its pending-content and stale-token assertions. The newer physical PC check shares the SSH dependency in the [workspace-writer receipt](2026-10-17-native-workspace-writer.md).
