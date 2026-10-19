# Installed Mac Trash and restore acceptance

Product: canonical `/Applications/TextText.app`, 0.204 (1269), source `4eca8353`.
This is a bounded T19 installed check, not six-client or full recovery acceptance.

## Owned fixture and approved repair

CLI creation requested existing `Notes` but its legacy inventory resolved lowercase
`notes`, creating a separate folder with one empty owned test note. The owner
approved proposal `20d86a6b-40d1-493d-a017-7c747b2269ce`. Actual signed-in browser
review applied its exact rename to `CLI recovery acceptance 20261019 ad9bf5f1`.
Independent canonical folder listing retained `Notes`, removed lowercase `notes`,
and showed the recovery folder. No access changes or unrelated content edits.

Item: `ad9bf5f1-179b-44aa-87d3-adeef4e78916`.
Path: `CLI recovery acceptance 20261019 ad9bf5f1/Installed 1269 trash restore acceptance 20261019-ad9bf5f1.textpack`.
The repair preserved hash `fad373fc3ad071fe78417ab0bcc6cc22f5441d50bac15cd7e7e933a3fc94388a`.
The installed Mac subsequently materialized and opened the item. Catalog visibility
alone was not counted as this proof.

## Actual normal UI sequence

1. Open the owned fixture, More → Delete → Delete file. Source confirms this is
   retained deletion; the active folder became empty.
2. Open Search and actions → Trash and recovery. Select the exact server deleted
   item, not an unrelated recovery copy. UI offered restoration with existing
   links and comments.
3. Independent authenticated `list_trash` showed the same UUID/path/hash before
   restoration, alongside the untouched earlier unrelated Trash item.
4. Choose Restore item. Normal UI returned to the same item and title.
5. Independent UUID read returned the same exact Markdown and identity. Current
   Trash excluded this item and preserved the earlier unrelated item.
6. Normal CmdQ, canonical app reopen: same restored item/title/path displayed.
   Native state retained lifecycle `e4aee76b-c598-4594-bafc-9a1b01fb71e3`, no same-item
   outbox or conflict, server revision `51190ded133b1abb3b6e8f86c418cf1046f71874fa45ad87b405a14476a9d2cf`.

Restore changed the archive revision; byte-identical archives are not claimed.
The rendered local projection hash is separately recorded. The first attempted
readback equality assertion included the archive hash and failed; exact Markdown
and identity comparison then passed. The first `list_trash` attempt incorrectly
supplied unsupported `limit`, was rejected without mutation, and is preserved.
One app reopen observation timed out; the next bound the normally reopened app.

## Private evidence

Under `/private/tmp/`:

- `texttext-native-trash-restore-recovery-applied-20261019.png`
- `texttext-cli-recovery-{folders,item}-after-20261019.json`
- `texttext-owned-trash-before-restore-{,valid-}20261019.json`
- `texttext-owned-trash-after-restore{,-list}-20261019.json`
- `texttext-owned-trash-restored-ui-20261019.{txt,png}`
- `texttext-owned-trash-normal-reopen-20261019.{txt,png}`
- `texttext-owned-trash-normal-reopen-state-20261019.json`

At this initial checkpoint the fixture was restored, with other saved versions,
conflict copies, retained attachments and Trash entries preserved. The empty-item
check alone did not establish populated body/comment restoration; the follow-up
below extends that evidence. Windows UI, concurrent delete/edit behavior,
losing-intent safety, links and complete T19/T26 acceptance remain separate.

## Populated follow-up and retained concurrent-change failure

The same owned fixture was populated through the normal Mac editor with exact
body `Owned restore body survives Trash and normal reopen. 20261019 ad9bf5f1.`
and one CLI-authored comment, UUID `72bd21ae-cc5c-4cbd-86f1-a3f972661e02`.
Actual native Comments showed that comment and Agent attribution.

The first populated deletion did **not** complete. The server comment advanced
the full archive revision to `68cdee18585c6ce6d02a2aaff6acfe6c47373ec19311370cf8337e8846494788`
before the native document baseline acknowledged it. The stale delete met a
compare-and-swap conflict. Both complete local and remote packs were retained;
their document/text entries matched, while the remote copy included the comment.
The server item remained live. This is a safe refusal, not a successful Trash
operation, and a comment-panel read is not a mirror-baseline acknowledgement.
Diagnosis: `/private/tmp/texttext-owned-populated-delete-cas-diagnosis-20261019.json`,
SHA-256 `ae8c1ae3da1e95fe3ab2331cc9e618c0e0690cad84007a2d7bee31e424dc04ca`.

For this owned fixture only, the exact retained remote pack was copied with
exclusive create to its absent original path. Its hash matched an independent
current server read. No existing file was overwritten; no journal or conflict
record was edited; all copies stayed intact. The normal mirror then adopted the
matching remote/local hash and cleared the conflict. This is explicitly external
file recovery, not a normal recovery-UI pass. Private repair and acknowledgement:
`/private/tmp/texttext-owned-populated-trash-external-recovery{,-ack}-20261019.json`.

After that actual acknowledgement, a fresh normal native Trash operation
completed without a concurrent write. Independent `list_trash` contained the
same UUID/path and comment-bearing archive hash. Normal Trash and recovery →
Restore item returned the populated note. Independent before/after reads kept
the exact Markdown and item UUID. Full comment objects matched exactly, including
the same comment UUID, attribution, original timestamps and open status; only
archive revisions changed. Normal CmdQ and canonical app reopen retained the
exact body; actual Comments again showed Open1 and the original comment.

Private evidence under `/private/tmp/`: `texttext-owned-populated-restore-` files
`complete-before`, `complete-after`, `comments-before`, `comments-after` (JSON),
`normal-ui`, `reopen-ui` (TXT/PNG), plus
`texttext-owned-populated-ordinary-trash-settled-20261019.json`. Earlier conflict
UI/state/server evidence and the initial not-yet-settled Trash listing remain.
An initial native typing attempt left a partial body and an empty capture dialog;
it was cancelled, then the owned body was set exactly and observed before save.
One stale AX control lookup was rejected without action. Reopen's first observer
timed out; the next observed the normally launched app. None count as passes.

This adds ordinary populated body/comment restoration and normal reopen evidence.
Concurrent-change user guidance, same-identity recovery choices, external links,
other platforms and complete T19/T26 acceptance remain open.
