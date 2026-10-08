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

## Persisted Windows upload follow-up

A second regression failed when an upload was durably queued before a remote
folder move. The engine now adopts the moved path before draining that upload,
only if its base content revision and lifecycle still match. It retains the
staged bytes and any later local edits, uses a new operation identity for the
changed path, and completes interruption between filesystem move and journal
save. Fresh denied permissions defer the operation. Changed remote content
continues to preserve a conflict instead of being silently overwritten. A lost
acknowledgement still replays the original receipt before adopting the new path.

The complete portable Windows core suite passed 171 assertions on the Mac:
`/tmp/texttext-queued-move-after.log`. The pre-fix failing regression is in
`/tmp/texttext-queued-move-before.log`. This follow-up remains source-only.
Mac persisted-outbox ordering and active shared editors remain separate required
checks; no cross-platform completion or install is claimed.

## Persisted Mac upload follow-up

The matching Mac regression also reproduced a queued-path conflict. Before
retrying a path-only move, the adapter now indexes identities with bounded
reads, verifies unique local identity, unchanged base revision/lifecycle and
fresh write permission, and carries current local bytes to the remote path.
It durably copies the original payload and attribution to a fresh operation
identity before committing the new journal entry. The old payload is removed
only after persistence. Later local edits upload against the staged content ACK.

All 31 Mac sync tests passed in `/tmp/texttext-mac-queued-move-final.log`,
including later edits, interrupted local adoption, denied permission followed
by restored permission, and original receipt replay after a lost ACK.
The failing pre-fix test is `/tmp/texttext-mac-queued-move-before.log`.
These remain source tests; actual client installs, shared editor ordering and
live multi-client folder moves are not yet attested.

The mandatory native gate also passed all required Swift suites and 171 Windows
core assertions: `/tmp/texttext-queued-move-native-gate.log`. The store-mode
Swift run regenerated `Package.resolved` without Sparkle; that generated change
was restored to the recorded release dependency file. This is working-tree
verification, not a frozen release attestation.
