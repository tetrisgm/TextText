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

Pending standalone packaging/runtime and live reader acceptance. No deployment
of this change is claimed here. This extracts embedded text; it does not perform
OCR, preserve the original PDF as a TextPack attachment, or provide transcripts
or automatic AI summaries. Empty/image-only PDFs leave the saved link usable.
