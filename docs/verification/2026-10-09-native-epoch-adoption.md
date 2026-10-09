# Native epoch adoption

Mac and Windows now accept a newer epoch over a pending checkpoint only when
its recovery operation ID, old epoch and exact update match the intent already
persisted by the native store. The incoming intent must be marked adopted;
identity, active lease, path, projection hash and journal generation guards
remain in force. The old checkpoint is archived before replacement. Both
bridges advertise `epoch-adoption` for the shared client's capability check.

## Verification

- `dotnet run --project windows/TextText.Core.Tests --configuration Release`:
  passed, including intent mismatch, failed checkpoint, external changes,
  archived adoption, later edits and interrupted-adoption replay.
  Log: `/tmp/texttext-native-adoption-dotnet.log`.
- `swift test --package-path mac --filter LocalVaultSharedEditingTests`:
  37 passed. Log: `/tmp/texttext-native-adoption-swift.log`.
- `swift test --package-path mac --filter LocalVaultSessionLifecycleTests`:
  1 passed. Log: `/tmp/texttext-native-adoption-lifecycle.log`.

- Windows desktop compilation on the Mac with `EnableWindowsTargeting=true`:
  passed with zero warnings/errors. Log: `/tmp/texttext-native-adoption-winbuild.log`.

Fable's implementation was interrupted by its session limit. Parent review
fixed a test helper's visibility and ran the tests above. No user journals
were modified, and nothing was installed or deployed for this patch.

## Remaining

The editor's live document rebind and semantic undo helper are unfinished.
The client core also needs the crash-window and document-lifetime repairs in
`/tmp/texttext-epoch-core-review.md`. Native unit tests do not establish physical
six-client acceptance. Capability consumption and live checkpoint adoption must
be verified together before delivery.
