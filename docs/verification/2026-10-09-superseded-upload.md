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
