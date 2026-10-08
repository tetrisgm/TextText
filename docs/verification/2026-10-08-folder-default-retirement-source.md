# Folder defaults and template retirement: source verification

Source cohort: `197c7552`, with native CLI changes `eaf1c25e`, `5f74d92a`,
`af658589` and server/Windows discovery fix `a0d9391b`.
This is source evidence. Installed Mac/Windows remain 1189; no new live claim.

## Covered behavior

- Generic creation honors an explicit folder default. Explicit kind/template
  choices override it, and supplied content overrides starter content.
- UI creation imports a complete TextPack once. Attachment size refusal occurs
  before creating a file; existing items retain their embedded presentation.
- Custom template retirement is an identity-wide, reversible TextPack record.
  Existing items retain their look. Replayed commands cannot recreate a removed
  retirement marker. Current permissions and pinned source revisions are checked.
- Server/Windows discovery handles 2,050 ordinary notes and caches bounded
  metadata, including negative results. Warm scans read zero archives. External
  replacement, rename and duplicate marked definitions are covered.
- Discovery retains 64 MiB individual-pack and 4 MiB metadata/response bounds.
  This does not certify arbitrarily large packs or folders.

## Evidence

- Server/Windows discovery: 26 tests; TypeScript and scoped lint passed.
  `/tmp/folder-scale-final-tests.log`, `/tmp/folder-scale-tsc.log`,
  `/tmp/folder-scale-lint.log`.
- Browser template intent: explicit choice overrides the folder default using
  one complete import. `/tmp/folder-default-browser.log`.
- Note template creation/edit/reopen and icon creation/edit/removal passed in
  both themes. `/tmp/texttext-atomic-note-template.log`,
  `/tmp/texttext-atomic-note-icon.log`. These fixtures are not live Safari proof.
- Native CLI creation/remote transport: 39 focused tests; final 16-test local
  review covered corrupt unrelated packs, direct Markdown retirement edits and
  directory casing. `/tmp/local-folderdefault-final.log`,
  `/tmp/local-folderdefault-review-final.log`.
- Gate integrity: four tests passed after adding metadata discovery to the
  required core and shared-client test lists.

Native scale equivalent `163b9a02` passed 17 focused tests. The combined clean
source `5254ff85` then passed 662 core tests, TypeScript, and required native
sync plus 40 local/remote CLI creation tests. Gate `5254ff85` now requires both
creation suites and refuses a zero-test match. Exact-source receipts were saved;
log `/tmp/texttext-sync-5254ff85.log`. Build 1190 is in preparation, not yet
accepted as installed.

Before installation, the existing app was inspected: 0.204 (1189),
signed in at the intended iCloud workspace. Its open dedicated verification
note and saved TextPack contain both 1189 platform markers exactly once and
retain the four original headings. No user content was changed for this check.
