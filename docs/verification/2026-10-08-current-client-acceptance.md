# Current client acceptance

Product source `e19d53c3`; Mac 0.204 (1221), current Oracle delivery recorded in
[PDF receipt](2026-10-08-pdf-capture.md). Windows candidate is verified but not installed.

## Installed Mac search cache

Actual signed-in installed client, real iCloud Workspace, existing verification
note `Notes/Parent menu live verification 1218.textpack`:

- Search `Cache1221p7m4` first returned no matches.
- Opened the existing note, appended `Cache1221p7m4 saved-body verification.`,
  finished editing, and searched the same previously absent marker.
- Search immediately returned the correct note; reopen preserved its text.
- Independent ZIP inspection of the canonical iCloud TextPack confirmed the
  saved title, original body and appended marker.

This verifies saved-body cache invalidation, not a new latency benchmark.

## File sharing

`verify-file-sharing.ts` passed against the current compiled production bundle
on a temporary loopback server using local Postgres, existing Ada/Grace test
accounts and an isolated verification vault. No production accounts or user
workspace files were modified. The verifier now opens Publish from More.

Uninvited access was denied. A commenter could read/comment but not write,
resolve or publish. Public rendering excluded private comments. Unpublish and
revocation immediately removed access; Shared with me updated. Zero browser
runtime errors. Log `/tmp/texttext-sharing-e19d53c3-acceptance.log`.

## Collaboration

`verify-file-collaboration.ts` passed on the same local production bundle and
isolated vault. The verifier now exits editing before using the sidebar and
opens reader-first files explicitly for editing.

Two accounts passed live presence/comments, concurrent edit convergence,
writer-scoped undo/redo, offline reconnect, independent same-origin tab journals,
offline reload recovery, exact canonical TextPack persistence and no repeat idle
mutation uploads. A new folder/file appeared and opened with live content in
the other account without reload. Permission downgrade denied writes and the
open editor noticed it. Zero browser runtime errors.

Log `/tmp/texttext-collaboration-e19d53c3-acceptance.log`. Final TypeScript passed,
log `/tmp/texttext-sharing-verifier-types.log`. Test fixtures were cleaned by
the verifiers and the temporary server was stopped. These are local compiled
production acceptance tests, not physical second-device iCloud certification.


## Installed Mac share-extension inspection

On Mac 1221, actual Safari File > Share did not list TextText. System Settings
Sharing explicitly listed `TextText Share` with its switch off. The installed
Info.plist identifies `app.texttext.mac.share`; read-only `pluginkit -m -A -D -i
app.texttext.mac.share` confirmed registration at version 0.204. This is an
activation gap, not evidence that the signed extension was omitted.

UI automation could read the sheet but toggle actions failed with invalidated
element errors; subsequent settings-window scrolling failed with
`noWindowsAvailable`, including after rebinding and resetting the UI session.
No successful enablement or capture is claimed. The temporary public Safari
tab was closed, returning to the existing TextText workspace tab.

Next: enable this extension through the ordinary Sharing settings, then verify
an actual public-link capture into the current iCloud workspace. Quick Look
and interactive File Provider acceptance remain separate.
