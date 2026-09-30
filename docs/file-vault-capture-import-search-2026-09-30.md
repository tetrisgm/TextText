# Folder capture, import, and search

Implemented in `4e7d4c56` and `587b06eb`. Installed local WIP is TextText
0.202 (1119) at `/Applications/TextText.app`. The matching local server uses
`.texttext/vault-capture-build`, identity `texttext-vault-capture-20260930`, and
the existing `.texttext/vault-server` replica. No public deployment occurred.

## Behavior

- Save a link or note writes directly to the selected folder. A standalone
  HTTP(S) URL becomes a bookmark with its source field and embedded template.
  Text remains a note. Capture also works in the web file editor.
- Import file uses a native picker for TextPack, TextBundle, or Markdown. It
  copies into the destination folder with a fresh identity and never replaces
  an existing file. Opaque entries, assets, and existing snapshots/templates
  survive; missing snapshots/templates are synthesized for web compatibility.
- Cmd-K opens on-demand local full-text search with clickable path/snippet
  results. Text-only ZIP reads avoid inflating attachments or adding history.
  Search caps enumeration, files, bytes, text size, and returned results; the
  UI reports truncated searches and skipped files. No background indexing or
  search network requests were added.

## Verification

Twelve native import/search/local tests passed, including duplicate identities,
opaque assets, unsafe paths, symlinks, malformed files, and search read limits.
Twelve TypeScript model/transport tests passed. Both browser suites passed,
including capture/search interactions and the existing conflict/recovery cases.
Full TypeScript and targeted ESLint passed. Capture was inspected in light and
dark. Signed Mac and isolated Next production builds passed.

Installed-app UI verification saved `https://example.com/verification-1119`
as a bookmark, imported `/tmp/texttext-import-1119.md`, found its unique body
marker with Cmd-K, and reopened it from the result. Both complete packs matched
the server replica byte for byte. The real web editor rendered the imported
snapshot and body. Both temporary packs were deleted recoverably from the web, disappeared on
the Mac, and left an empty outbox. No user notes were used.

Logs: `/tmp/texttext-vault-import-final-tests.log`,
`/tmp/texttext-vault-capture-final.log`, `/tmp/texttext-vault-capture-web.log`,
`/tmp/texttext-vault-1119-build.log`, `/tmp/texttext-vault-1119-install.log`, and
`/tmp/texttext-vault-capture-next.log`.

## Remaining scope

Link capture saves the URL; article extraction/enrichment is not yet wired to
the folder path. Share-extension/quick-capture outboxes, bulk imports, richer
Markdown reference/HTML assets, browser full-text search, and opening external
Markdown through macOS Open With need further integration. Shared live editing,
sharing/publication, and retirement of legacy database callers remain in the
main file-vault receipt. This batch does not claim those complete.
