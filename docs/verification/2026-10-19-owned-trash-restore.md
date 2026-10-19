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

The fixture remains restored. Other saved versions, conflict copies, retained
attachments and Trash entries were preserved. This does not establish Windows
UI acceptance, concurrent delete/edit behavior, losing-intent safety, links or
comments restoration on a populated item, or complete T19/T26 acceptance.
