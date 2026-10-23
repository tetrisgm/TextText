# Windows startup native reads, October 22

Phase 2 work in progress. These checks do not establish installed acceptance or
the five-launch listing/editability targets.

The tested source is preserved in PC stash
`bac70feec271069be85f81b980f8e107378f9e94`
(`phase2-tested-native-reads-pending-phase1`), pending the Phase 1 exit check.
Apply it without dropping the stash after the unified release is verified.

## Installed evidence

The installed Windows process `44676` initially stalled on the UI dispatcher in
`MainWindow.OpenWorkspace -> WindowsBridge -> SyncEngine.Load ->
ValidateFolderState -> TextPackStore.Resolve -> CheckLinks`. A subsequent native
stack at `2026-10-23T06:00:56Z` showed the listing's `Inventory -> ScanInventory`
holding the store while `SyncAsync -> Load -> ValidateReplacementRegistry`
waited. The owner observed a blank workspace with the bootstrap timeout notice.

The active registry contains 382 retained replacement records, including 368 for
one item. None has an explicit resolution. Nothing was deleted or reset.
Profile/owner reuse does not eliminate each record's recovery validation.

## Changes and checks

- Path inspection performs one attribute query per ancestor instead of file
  existence, directory existence, then attributes. Missing destinations remain
  allowed; linked ancestors, cloud-tag checks, and other inspection errors retain
  their guards. Six focused path assertions pass, including missing leaves and
  dangling linked ancestors.
- Listing permissions attempt the existing sync gate immediately, with the same
  cached/default fallback and refresh behavior. Mutation accessors remain gated.
  The focused bridge regression fails with the original two-second wait
  (2,044 ms), then passes with the change (7 ms). Restrictive cached permissions
  stay restrictive during a later busy pass.
- A 32-record, single-item fixture counts exactly one inventory scan and 32
  record validations, then repeats all 32 on the next scan. Corrupting the oldest
  displaced bytes still fences the document without changing its current bytes.
  This disproves an assumed benefit from same-item result caching within a normal
  inventory scan; no such cache was added. The fixture scan took 487 ms.

Elevated PC checks: Core suite 1,790 assertions passed; Windows bridge suite 132
passed; four repeated-history assertions passed separately. The latter fixture
and observation callback were added after the full Core executable started and
were compiled and checked independently. Existing nullable compiler warnings
remain. `git diff --check` passed.

The Core inventory fixture reported 1,094 ms for 1,100 files and 250 ms for 200
blocked entries. These are fixture timings, not controlled installed before/after
measurements. Real installed acceptance remains required.

## Mac portable checks

The changed sources were copied to
`/private/tmp/texttext-phase2-portable.Pv9MKg`, outside the held Mac checkout.
The copy uses tracked source from `b0463854` plus the Windows changes described
above and a read-only dependency link to the existing `node_modules`. No files
in `~/dev/TextText` or the owner's `mac/Package.resolved` were changed.

With `PATH=/opt/homebrew/bin:$PATH`, both commands exited zero:

```sh
/opt/homebrew/bin/dotnet run --project windows/TextText.Core.Tests/TextText.Core.Tests.csproj --configuration Release
/opt/homebrew/bin/dotnet run --project windows/TextText.Windows.Tests/TextText.Windows.Tests.csproj --configuration Release --artifacts-path windows/build/portable-bridge
```

Core: 1,625 assertions, seven explicit Windows-only fixture skips. Bridge: 74
assertions, one Windows-only filesystem fixture skip. The new repeated-history
fixture requires Windows's replacement primitive and identity index, so it runs
on the PC and explicitly skips on the Mac. The six path checks passed on both.
The Mac held-gate listing regression completed in 7 ms, with restrictive cached
permissions preserved.

The first copied-source run exposed the missing Windows-only guard in the new
fixture; that guard was added. A second run exposed an omitted `src/sync`
dependency in the temporary copy; the tracked dependency was copied before the
successful run. Both failed logs remain retained. Final Mac logs are
`/private/tmp/texttext-phase2-core-portable-final.log` and
`/private/tmp/texttext-phase2-bridge-portable.log`.

PC evidence is retained under `%TEMP%`: `texttext-phase2-core-tests.log`,
`texttext-phase2-counter-tests.log`, `texttext-phase2-bridge-red.log`,
`texttext-phase2-bridge-green.log`, and
`texttext-startup-stack-44676-20261023T060056Z.txt`.

No UI actions were performed after the owner stopped Computer Use. No application
build, installation, or normal-close acceptance was performed by this work lane.
