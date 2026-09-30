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
source URL and all checks pass. Build 1131 packages the correction.
Real provider folder refinement remains unverified. The live web
server still runs the preceding image build, so its new folder metadata routes
require a local rebuild before web acceptance. No public release or push.
