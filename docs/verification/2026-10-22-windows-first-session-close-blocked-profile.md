# Windows first-session close and blocked-item profile sharing

Tasks: T03, T04, T07, T25 (partial). Machine: Windows PC `DESKTOP-BAKIEMJ`, real interactive desktop, existing signed-in account and workspace `be28ae03-c64e-4695-80af-04f048f86f37` (about 1,100 TextPacks and 382 replacement-registry records in its sync state).

## Delivered identities

| Stage | Source | Evidence |
| --- | --- | --- |
| Previously installed | `1d1154f2` | EXE `d9f1d0da…`, preserved as `%LOCALAPPDATA%\Programs\TextText-previous-20261022T142332-37b1706a` |
| Intermediate install | `1c0df3f9` (product `56d144f7`) | Candidate `candidate-1d73465814c443bbab4f113040994f8c`; full `build.ps1` gates passed; preserved as `TextText-previous-20261022T145418-6fc251a8` (Core `7F79D0EF…`) |
| Current install | `67efe404` | Candidate `candidate-d536675390934b519770ad3b672e1b49`; full `build.ps1` gates passed; `TextText.Core.dll` `C6A0CBE6…`. The apphost EXE hash `B17D9164…` is unchanged between the two builds because the fix lives in Core. |

A stopped backup was taken before the first install: `%LOCALAPPDATA%\TextText-backups\before-56d144f7-20261022`. The vault (`%USERPROFILE%\TextText`, 208 files), the `Sync` state and `account.dpapi` match the live copies exactly. The `Agent` cache was copied only in part, because some of its plugin temp paths are too long. Install does not touch it.

## Failure observed on the installed app

- On source `56d144f7`, a new note was typed in the first editing session of a fresh launch. Normal close exited, and the pack saved the exact title and body (`Notes/Untitled 23.textpack`).
- The next normal launch stayed on "The connection is taking longer than expected. Open a workspace folder" for more than a minute, then recovered. CPU climbed throughout.
- Stack capture (`dotnet-stack`) showed `SyncEngine.Pull → ApplyPull → Save → TextPackStore.ReplacementBlockedItems → ReplacementRecoveryRegistry.AssertEntryReadable → OwnerHash → RetainedReplacementProfile.VerifyObserved/VerifyUnlocked`. Each registry entry re-verified the full retained profile chain while holding the store, so bridge listing waited past the renderer's 8 s bootstrap bound.
- `1d1154f2` had removed the same per-entry cost from inventory scans only.

The earlier "initial-session close refusal" could not be reproduced as a refusal on this source. With correct timing, both first-session closes below exit normally. The delay that does reproduce is in startup and open, behind the store.

## Fix

`67efe404` applies the existing store-serialized `RetainedReplacementProfile.InventoryVerification` scope to `ReplacementBlockedItems`. Per-entry recovery checks are unchanged. The owner bytes and profile chain are verified once at scope entry and again at scope exit, and a profile change during the pass refuses the whole result. Nested calls from an existing scan scope reuse that scope.

Focused regression: `RetainedProfileConcurrencyTests.BlockedItemsScope` registers 200 entries and checks four things.
- One shared verification still inspects all 200 entries (532 ms).
- Tampering during the pass refuses the result.
- A later pass rejects the changed profile.
- Restored bytes verify again.

The complete Core suite passed ("All native file and durable sync regression tests passed"). So did every `windows/scripts/build.ps1` gate: node runtime and relay tests 95/0, Core, Windows, LiveAcceptance, Agent, shared client vitest, TypeScript, UI build, publish, desktop smoke and the receipt seal. These ran under the PC's own elevated OpenSSH session, because the symlink scenario requires the privilege that the unelevated desktop token lacks.

## Actual installed acceptance (`67efe404`)

All edits used the normal UI: UIA focus and real SendKeys. All closes used `CloseMainWindow`. There was no force-close, reset or journal change.

| Cycle | Note | First-session close | Fresh reopen |
| --- | --- | --- | --- |
| C1 | `Notes/Untitled 24.textpack` | Exited in 4.5 s | Workspace ready in 9.7 s with no timeout notice; exact title and body rendered |
| C2 | `Notes/Untitled 26.textpack` | Exited in 5.4 s | Exact title and body rendered at 14.3 s; close from the reopened note exited in 0.1 s |

Both packs contain the exact typed title and body in `document.json` and in the projection. `Notes/Untitled 25.textpack` is an empty note created by an extra New note action during sampling. It is retained.

## Hosted readback

Independent authenticated reads through the Mac's signed-in `texttext` CLI (`search` and `read --json` only, no writes) found all three items with an exact title and body:
- `77f489c0` at `Notes/Untitled 23.textpack`
- C1 `ebba9c44` at `Notes/Untitled 24.textpack`
- C2 `17815179` at `Notes/Untitled 26.textpack`

## Follow-up scan cost (`680a8581`)

After `67efe404`, a later launch still reached the bootstrap timeout. Stacks showed per-file `TextPackStore.Read` work during sync scans:
- `FolderCaseRename.AssertReadable`, which took the exclusive lease and read and validated every journal, twice per file
- `ReplacementRecoveryRegistry.OwnerHash`, which reread the owner with reparse checks

Within one store-serialized scan, the first folder-case outcome, whether success or error, now stands for every file. The scan repeats the check before returning and refuses the result if the outcome changed. Scoped registries reuse the owner hash that `InventoryVerification` pins and rereads at disposal.

The new regression `FolderCaseTests` "inventory checks folder history once and refuses a change during the scan" checks one folder-case check across 300 files and refuses a journal flipped to conflict mid-scan. The Core suite and every `build.ps1` gate passed.

The 1,100-file inventory benchmark went from 4,710 ms to 1,982 ms. A redundant-rescan patch for `ProtectedPathDecision` would save about 1 of roughly 11 scans per pass. It was prepared and deliberately not landed, because it is low value and its test is fragile.

## New notes editable during slow listing (`listing-capabilities`)

On Windows the native listing always sends an explicit `fullAccess`. So a note the store had just created stayed read-only until its listing row arrived, which took 17–90 s behind busy scans.

`listingCapabilities` now accepts the item this session just created, matched by root, identity and path. It is editable only while no listing row names that path or identity, and only where its folder still accepts new content. Once a row appears, the listing decides. Viewers, other roots, other identities and paths, and unwritable folders stay denied. The native store still enforces every write.

Tests:
- 3 new `listing-capabilities` tests.
- Windows `build.ps1` shared client suite 777/777, TypeScript, and every other gate passed (candidate `candidate-0c0c29a8fa734fb99cd6977e5942dce7`).
- `vitest run src/local-vault` on the PC: 577/612. All 35 failures are in `epoch-recovery-client.test.ts`, whose Node store fixture fsyncs a directory, which Windows refuses (`EPERM`). This is unrelated to the change. Mac-side `npm test` was not run because the Mac was unreachable.

Installed acceptance C3 (final install): after New note, the note was editable and typed while the startup "connection is taking longer than expected" notice was still visible. First-session close exited in 3.5 s. `Notes/Untitled 27.textpack` holds the exact title and body. A fresh reopen rendered them exactly at 12.8 s, and close from the reopened note exited in 0.1 s.

## Remaining measured shortfalls (not fixed here)

- Startup can still show the 8 s bootstrap timeout notice while sync scans hold the store; a restored note can show "Opening document…" for tens of seconds. New notes are now editable meanwhile. Stacks show the store held by `SyncEngine.SyncAsync → ScanForSync → ScanInventory` full-workspace scans. This misses the T25 targets (cached workspace usable p95 < 2 s) and the owner's "keep working during startup" priority. It is the next Windows task.
- Hosted readback of C1 and C2 was not independently checked here; the Mac became unreachable over SSH during this session.
- This checkout initially failed hash-pinned node tests because Windows Git's system `core.autocrlf=true` produced CRLF files. Builds need a repository-local `core.autocrlf=false` checkout.
