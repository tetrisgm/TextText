# Shared PDF reader capture

Public PDF links now use the same authenticated extraction endpoint as HTML
articles. The existing public-address fetcher still validates/pins every redirect;
there is no additional network fetch from PDF.js. All three clients use this
endpoint, and save extracted Markdown through existing guarded enrichment writes.

Implementation uses pinned unpdf 1.8.1 (Mozilla PDF.js), following its
[document proxy API](https://github.com/unjs/unpdf). Parsing runs in a disposable
Node worker, without inherited environment or execution arguments. Diagnostics
are drained without recording document text. Input is limited to 8 MB, 200 pages,
2 million text characters, two workers, 8 seconds and a 128 MiB JavaScript heap.
The existing overall request deadline remains 15 seconds. Request cancellation
now cancels the fetch/parser. PDF text is escaped as inert Markdown.

## Evidence

- 31 tests in six suites passed: real PDF text/pages, malformed/empty documents,
  oversized streamed/declared input, cancellation, parser deadlines/concurrency,
  cleanup, sanitized errors, extraction authorization, and existing guarded
  capture/enrichment merge regressions.
- TypeScript passed after the final source changes.
- Dependency install changed only the pinned unpdf dependency and lock entry;
  existing development-only audit advisories were not introduced by it.
- Logs: `/tmp/texttext-pdf-capture-tests.log`,
  `/tmp/texttext-pdf-parent-types.log`.

Source `6e1a9ee7` deployed on Oracle. Real Safari capture failed, despite a
working traced-source worker: Turbopack spreads typed-array workerData into a
plain object. The bundled parser therefore received an empty byte array.
`b0f15c7b` sends `{ bytes }`, fixes cleanup to PDF.js loadingTask.destroy, and
adds an actual compiled-worker packaging gate. That gate fails the original
production bundle. Source parsing/lifecycle/endpoint suites (20 tests), Oracle
packaging tests (16) and TypeScript passed for the fix. The rebuilt compiled-worker
gate passed both after build and during packaging. Source `8090227e` deployed as
`texttext-oracle-20261008-8090227e-clean-epochs`; thirteen live deployment checks passed.
Fresh Safari loaded the corrected deployment and retried the earlier failed W3C
dummy PDF bookmark. The failure message disappeared and the reader displayed
“Dummy PDF file”. Automatic capture of a newly created PDF bookmark remains to verify.

## Automatic capture reader invalidation

Live Safari saved the same public PDF with `?verification=1220`. Background
capture completed, but the already open reader continued to show its pending
placeholder. Reloading displayed “Dummy PDF file”, proving saved extraction
succeeded and isolating the stale reader state. The worker refreshed the folder
listing, while the reader only reloaded on path changes or explicit reader edits.

Current source emits a targeted completion event and reloads that visible reader
only when it has no pending write or unsaved reader draft. The browser regression
creates a pending link and requires extracted text to appear without navigation
or reload. This change is not yet installed or deployed. TypeScript and five
enrichment/write-baseline tests pass; full shared browser verification passed,
including automatic capture appearing in the open reader without reload. The
fixture's keyboard ordering assertion now includes the previously added Parent
action. This is source acceptance; live acceptance remains after deployment.
Logs: `/tmp/texttext-auto-capture-reader-{types,unit,browser}.log`.

 This extracts embedded text; it does not perform
OCR, preserve the original PDF as a TextPack attachment, or provide transcripts
or automatic AI summaries. Empty/image-only PDFs leave the saved link usable.
