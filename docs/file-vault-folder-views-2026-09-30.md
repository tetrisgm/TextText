# File-backed folder presentations

Folder designs are ordinary, self-contained TextPacks in their containing
folder. An explicit `content.fields.texttextFolderView: "v1"` marker identifies
a definition, including after a rename. A filename alone never hides a note.
Multiple or malformed definitions produce an error and preserve access to files.

## Implemented

- Reading list, Contact sheet and Reference index presets preview real immediate
  members. Keep writes only the definition; cancel writes nothing. Existing
  definitions use the preview's original revision. Concurrent changes reject
  Keep, even if the listing refreshes while the preview is open.
- New definitions use an exact-path import that refuses occupied destinations.
  No automatic suffix creates a second competing folder definition.
- Cards/list reuse DocumentCollectionRenderer. Index is an accessible table.
  Named views reuse validated collection specifications. Unsupported layouts
  explicitly fall back to a readable list.
- Native Customize folder targets its design file. Agent proposals render the
  actual members with pagination; the existing guarded Keep flow persists it.
- Thumbnails load serially for at most 24 visible items. Querying reads metadata
  before pagination and skips image inflation. Truncated/unavailable metadata
  causes explicit fallback rather than silently hiding files.

## Evidence

- 17 model/preset/query/proposal tests: `/tmp/texttext-folder-model-tests.log`.
- 28 server/preview/transport tests: `/tmp/folder-metadata-ts-tests.log`.
- Six Swift store/import tests: `/tmp/folder-metadata-swift-tests.log`.
- Full TypeScript and scoped ESLint passed.
- Browser fixture covers preview/cancel/keep/reopen, unchanged member files,
  all three presets, concurrent definition rejection, and assistant folder
  preview/pagination/Keep. Earlier editor/conflict/capture/image journeys still
  pass: `/tmp/texttext-folder-ui-browser.log`.
- Light/dark reference table screenshots were inspected:
  `/tmp/texttext-folder-reference-{light,dark}.png`.

## Limits and next acceptance

The discovery scan is sequential and bounded: 2,048 immediate packs, 256 MiB
compressed bytes, 4 MiB returned metadata and 16 definitions. Exceeding a bound
reports failure and leaves files readable. A metadata index is still needed for
large collections. Query materialization is capped at 2,048 files and 8 MiB;
creation/update/publication date sorting is not available from current metadata.
A collection projection contains bounded title/excerpt/tags/scalar fields, not
full document content. Custom layouts needing unavailable fields report fallback.

Installed build 1130 created Reading/Folder view.textpack through preview and
Keep, then reopened the same reference index after leaving the folder. All three
pre-existing Reading pack SHA-256 values stayed unchanged, and the new design
file converged byte-for-byte with the local server. Native visual inspection
caught long source URLs squeezing Tags/Open. Fixed column widths and a bounded
overflow container correct that; the browser fixture now includes a real long
source URL and all checks pass. Build 1131 is installed and its actual native table was visually verified with
readable Tags/Open columns and wrapped URLs. Screenshot:
`/tmp/texttext-native-folder-reference-1131.png`. Build/install logs:
`/tmp/texttext-{build,install}-1131.log`. The installer health-report check was
not used because this sandboxed WIP writes its report in a different location;
actual installed UI and pack-byte checks supply the recorded acceptance evidence.

## Real provider and cross-app acceptance

Build 1132 is installed. The real native agent proposed a two-column Reading
collection, recovered from schema rejection using validation feedback, then
refined heading size, spacing and alphabetical title sorting. Before Keep, all
folder file hashes were unchanged. The pending proposal survived replacement
and restart of the app; comparison, Keep and reopening the folder passed.
Only `Reading/Folder view.textpack` changed. Its collection uses cards, two
columns and ascending title sorting. The three member files stayed unchanged;
the kept definition matches the local server byte-for-byte.

The live web Gallery Contact sheet preview exposed a missing cover binding.
`54cc8c89` projects the bounded thumbnail into the cover field and makes query
completeness specific to referenced fields. Unrelated omitted annotations no
longer reject a complete title sort. Successful corrected proposals clear the
prior validation notice. Unit, browser, six Swift store tests, full TypeScript
and scoped ESLint passed after these fixes.

Web preview/Keep now shows the real Gallery image. Its new definition synced
byte-for-byte to native. Installed 1132 reopened that contact sheet with the
image visible; the existing Gallery member remained unchanged. The live local
server uses `.texttext/vault-folder-final-build`, deployment identity
`texttext-vault-folders-final-20260930`.

Evidence:

- Native agent design: `/tmp/texttext-native-folder-agent-1132.png`.
- Web contact sheet: `/tmp/texttext-web-contact-sheet.png`.
- Synced native contact sheet: `/tmp/texttext-native-contact-sheet-1132.png`.
- Before hashes: `/tmp/texttext-folder-provider-before.json` and
  `/tmp/texttext-gallery-folder-before.json`.
- Browser regressions: `/tmp/texttext-folder-feedback-browser.log`.
- Query/cover tests: `/tmp/texttext-folder-cover-tests.log`.
- Swift tests: `/tmp/folder-metadata-fields-swift.log`.
- TypeScript/lint: `/tmp/texttext-folder-fixes-{tsc,eslint}.log`.
- Build/install: `/tmp/texttext-{build,install}-1132.log`.
- Web build: `/tmp/texttext-vault-folders-final-build.log`.

The sandboxed installer health-report gate was not used; actual installed UI
and file-byte checks supply the acceptance evidence. Overall visual polish,
large-collection indexing and sustained performance acceptance remain open.
No public release or push.
