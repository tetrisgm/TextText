# File vault recovery

## Implemented

Trash and recovery exposes retained deleted files and conflict copies. Version
history is available beside the current file. Preview reads a selected immutable
copy, verifies its hash and shows saved text with attachment/design information.
Restore imports the complete original pack with a fresh identity and a separate
filename through the ordinary file command. Original files and retained sources
remain untouched. A recovered folder design cannot be placed into a folder
that already has a marked design through this UI.

Native recovery handles `.texttext/history`, Trash and conflicts. History is
matched by embedded identity, so renamed files retain access to revisions.
Legacy native Trash lacks original-path metadata and uses the saved title or
heading for a recovered name. Server recovery includes delete receipts and externally
deleted item tombstones backed by history. Both API reads authorize through the
existing workspace boundary and `store.ts`. Restoring uses the audited write
path; viewing recovery does not create mutations.

Discovery is on demand, bounded and reports truncation. Native scans at most
2,048 entries / 256 MiB, server scans at most 128 MiB of retained packs and 8 MiB
of metadata, with 200 returned choices. Individual recovery reads are capped at
32 MiB. Paths, symlinks and revision hashes are checked. The UI retains only one
full selected recovery pack and displays at most 50,000 body characters.

## Verification

- 11 native recovery/import tests, including full original bytes, fresh identity,
  opaque entries/assets, unchanged retained copy, hash tampering, traversal,
  symlinks and bounds: `/tmp/texttext-native-recovery-tests.log`.
- 29 server/transport tests, including externally deleted tombstones:
  `/tmp/vault-recovery-tombstones-tests.log`.
- Two route tests for authorized exposure and denied access:
  `/tmp/vault-recovery-route-tests.log`.
- Browser preview/cancel leaves all files unchanged; restore passes exact retained
  pack bytes to import; existing files stay unchanged; Version history, Escape,
  reopen and close pass: `/tmp/texttext-recovery-browser.log`.
- Native dialog lifetime closes the browser top layer explicitly. Local keyboard
  layers defer to open native dialogs.
- Light/dark fixture screenshots: `/tmp/texttext-recovery-{light,dark}.png`.

## Current acceptance and limits

Installed 1133 restored the deleted `texttext-native-1122` image test pack.
Every retained entry including two attachments was preserved; only text.md's
identity changed. All 29 pre-existing visible/retained hashes were unchanged.
The restored pack converged byte-for-byte with the local server. Evidence:
`/tmp/texttext-recovery-native-{before,receipt}.json` and
`/tmp/texttext-native-recovery-1133.png`.

Installed review exposed generic Trash names and duplicate React sibling keys
between the recovery dialog and selected editor. The keys now have distinct
prefixes; a regression verifies the dialog DOM is removed and the editor remains
visible. Six final native recovery tests cover frontmatter titles. Build 1134
is running for final installed verification. Live web recovery has not yet been
rebuilt and exercised. This is restore-as-copy,
not rollback of the current identity. Restoring an earlier folder design over
its active definition with a guarded comparison remains separate work.
Large histories require indexing/pagination beyond bounded discovery; files
larger than 32 MiB remain on disk but cannot be restored through this UI yet.
No permanent-delete control, public deployment or release was added.
