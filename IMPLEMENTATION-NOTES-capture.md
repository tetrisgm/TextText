# Capture Implementation Notes

## PDF capture

- Direct PDFs are handled before the WKWebView HTML path when the URL ends in `.pdf` or a HEAD probe returns `application/pdf`.
- If WKWebView fails in a PDF-like way, including WebKit frame interruption, unsupported content, or `not an HTTP response`, the agent retries through the PDF path.
- PDF downloads use the existing `BoundedDownloader` and are capped at 40 MB before PDFKit sees the bytes.
- The PDF response is accepted when the content type is PDF, the URL ends in `.pdf`, or the returned bytes contain a `%PDF-` header near the start.
- PDFKit renders pages into one tall PNG composite, capped by the same screenshot geometry limits as web captures.
- Extractable `PDFDocument.string` text becomes the readable markdown. If no text is extractable, the capture still succeeds with a short readable note.
- The original PDF bytes are sent through the existing multipart `html` field as `application/pdf`; the route stores them as `original.pdf` and keeps the URL in the existing capture artifact slot.

## Oversized-page handling

- Web captures now measure the document height and snapshot up to a bounded height instead of using an unbounded full-page artifact.
- Screenshot render geometry is 1280 px wide, at least 2000 px tall, capped at 14000 px tall and 18 million pixels.
- Screenshot PNG uploads are resized until they are at or below 20 MB.
- Original artifacts from the Mac agent are capped at 40 MB. Oversized HTML originals are omitted; oversized PDFs are rejected by the bounded PDF download path.
- Readable markdown is still capped at 2 MB and truncated client-side before upload.
- The captures route raises the per-artifact cap from 25 MB to 50 MB.
- If an uploaded screenshot, original artifact, or readable extraction is still over the server cap, the route records `captureStatus="failed"` with a specific size-limit error instead of returning a bare 413. Blob artifacts are not written on that failed path.

## Real-Mac checks

- `swift build --package-path mac` verifies compilation, but this headless environment cannot run WKWebView or visually validate PDFKit rendering.
- Check on a real Mac with:
  - a direct PDF URL with a `.pdf` suffix;
  - a PDF URL without a `.pdf` suffix where the server returns PDF bytes;
  - a large single-page HTML document such as an RFC;
  - `nodejs.org/api/all.html`.
