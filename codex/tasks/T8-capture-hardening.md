# T8: bookmark capture agent hardening (Mac, Swift)

Make the Mac capture agent robust: PDFs, oversized pages, and a retry/backoff
ladder. Swift only; do not touch the web/TS capture code.

## Context (read first)

`mac/Sources/Write/CaptureAgent.swift` drains pending bookmarks and PUTs
readable text + original HTML + screenshot to `/api/sync/v1/captures/{id}`
(multipart: meta JSON, readable, screenshot PNG, html file). The server caps
artifacts at 25 MB and the readable field at 2 MB (413 over) and marks a
failure when meta carries `error`. Read the file fully.

## File ownership (STRICT)

- EDIT ONLY: `mac/Sources/Write/CaptureAgent.swift`. You MAY add new files
  under `mac/Sources/Write/` (e.g. `PDFCapture.swift`).
- NEVER touch: any other Swift file, Info.plist, anything under `src/`.
- Commit nothing. Verify: `swift build --package-path mac` (Sparkle downloads
  may be blocked in sandbox; a focused typecheck of the changed files is an
  acceptable fallback, say so).

## What to build

1. **PDFs**: when the page (or the URL) is a PDF (content-type
   application/pdf or a .pdf URL), skip the WebView HTML path. Use PDFKit
   (PDFDocument) to render page 1 to a PNG screenshot and extract the text
   (PDFDocument.string) as the readable markdown. Upload with capturedBy
   "mac" like the HTML path. If PDFKit yields nothing, report a failure.
2. **Size safety**: before upload, if readable text exceeds ~2 MB, truncate
   to a clean boundary with a trailing note; if the screenshot PNG exceeds
   ~25 MB, re-encode smaller (downscale) rather than failing outright; if the
   HTML exceeds 25 MB, drop the html part but still upload the rest.
3. **Retry/backoff**: on a transient upload failure (network error, 5xx),
   retry with exponential backoff (e.g. 3 tries, 2s/6s/18s), then leave the
   bookmark pending for the next drain rather than marking it failed. A 4xx
   (except 429) is terminal: mark failed. Keep the drain loop alive on any
   single-item error (it already is; preserve that).
4. Keep it main-thread-safe for all WebKit/PDFKit UI work exactly as the
   existing code is.

## Conventions

Match the file's style. No em dashes including comments.

## Verify

swift build clean (or focused typecheck if Sparkle blocks). Walk through in
your summary: a PDF URL capture, a 40 MB screenshot, and an upload that 500s
twice then succeeds.
