# New saves after a conflicted Windows upload

Windows marked an upload conflicted, then skipped the item forever because every
outbox entry blocked scanning. A later coherent local save could not be offered to
the server and the item could not become collaboration-ready.

`RetrySupersededUploads` replaces only a superseded upload, preserving its payload
and original base revision and using a new command identity. It requires one
operation, matching baseline/path/lifecycle/identity, writable access, no active
editor or pending intent, and rechecked current bytes. Server compare-and-swap
still decides whether to merge or retain a conflict. No timer retry loop is added.

The new regression fails before the fix and passes afterward. Parent reran the
native core suite on the Mac successfully (`/tmp/texttext-upload-recovery-parent.log`).
It covers unchanged-byte fencing, superseded payload preservation, a new command,
continued conflict, lifecycle mismatch and successful readiness restoration.
Fable also ran the agent suite. Report: `/tmp/texttext-upload-recovery-fable.md`.

The retained full1235 fixture has a later coherent seven-marker local file and an
older incoherent fenced payload. This fix may let the server reconcile the newer
file; physical recovery is not yet verified. Windows build/install and six-client
acceptance remain required.

## Installed recovery

Windows candidate `candidate-4a1d3e5a3e7a4bedaca9e871bc713d03` built from
`488746b2` passed its gates and native desktop smoke. The canonical installer
verified candidate and staged bytes and preserved the previous app at
`TextText-previous-20261009T010612-ca002da8`. Log:
`/tmp/texttext-win488-install.log`.

After normal app startup, the full1235 conflicted upload disappeared through the
engine's own sync pass. Baseline hash/revision became
`0a885019f9bfbf6a5d053186c1615989ef44211856e47db7d36a4028754761b0`,
Refresh false, outbox empty. No journal/state was cleared. Selected state receipt:
`/tmp/texttext-win488-recovery-state.txt`.

Independent Mac iCloud TextPack inspection then found all six `pc-app:full1235`
markers, `pc-cli:full1235:00` and `mac-app:installed1237:00` exactly once in the
saved document body. This proves the retained edits passed through cloud sync to
Mac. It does not prove the still-outstanding six-actor simultaneous test.
