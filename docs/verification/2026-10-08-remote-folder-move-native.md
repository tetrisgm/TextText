# Remote folder move with offline edits

Source-only follow-up. No client install or deployment is claimed.

The Windows sync engine previously uploaded a dirty local file to its old path
after a remote folder move. Moves retain the content revision, so comparing
only that revision did not discover the location change before upload. A
regression using path-strict server preconditions reproduced the failure.

Windows now adopts the remote path while preserving current local bytes before
uploading against the original content baseline. If interruption occurs between
the filesystem rename and baseline persistence, restart recognizes that the
current local and remote paths already match and finishes adoption without
issuing another remote rename. Durable local edits are retained. The fake server
now rejects upload/rename path mismatches and replays rename receipts.

Mac already implements this ordering. Its new regression verifies exact edited
bytes at the moved path, matching remote bytes, removal of the old file path
and no additional upload after engine restart.

Verified on the Mac:

- Original Windows regression failed: `/tmp/texttext-windows-remote-folder-before.log`.
- Fixed Windows suite passed 164 assertions:
  `/tmp/texttext-windows-remote-folder-after.log`.
- All 27 Mac sync tests passed, including the new case:
  `/tmp/texttext-mac-remote-folder-tests.log`.
- Seven gate regressions passed. Windows core/test sources now invalidate the
  source fingerprint; generated .NET output does not.
- The mandatory native gate passed all required Swift suites and 164 Windows
  core assertions: `/tmp/texttext-folder-move-native-gate.log`.

Unrelated working edits were present, so these are not frozen release receipts.
Actual Windows candidate verification/install and multi-client acceptance remain
pending. Before shared folder controls ship, also exercise remote moves with
already-persisted unacknowledged upload operations and active shared editors;
the new offline-edit test does not prove those separate orderings.
