# Bookmark Reader Images Implementation Notes

## Where Images Were Dropped

`mac/Sources/Write/CaptureAgent.swift` injects `readableExtractionScript` into the offscreen `WKWebView`. The previous extractor selected `article`, `main`, or `body`, then read only `innerText` or `textContent`. That converted the page to text before Swift saw it, so all element nodes, including `<img>`, were discarded.

Swift then built reader markdown from `ReadableExtraction.paragraphs` only, which meant there was no later opportunity to recover image tags.

## Current Emission

The extractor now walks the readable root DOM in document order and emits `blocks`:

- `text` blocks for readable text.
- `image` blocks for accepted content images.

`markdown(from:title:)` now prefers that ordered block stream. Text blocks are emitted as before. Image blocks become markdown images in place:

```markdown
![alt](https://example.com/image.jpg)
```

The old `paragraphs` array is still emitted and decoded as a fallback for compatibility.

## URL Handling

Image sources are resolved in the WebView against `window.location.href`, which is the final loaded page URL. The extractor checks, in order:

- `<picture><source srcset=...>`
- `img[srcset]`
- `img[data-srcset]`
- `currentSrc`
- `src`
- common lazy-load attributes such as `data-src`, `data-original`, `data-lazy-src`, `data-hi-res-src`, and `data-image`

For `srcset`, it picks a reasonable display candidate, preferring the widest candidate up to 1600w, or a density up to 2x. Protocol-relative URLs are forced to `https:`. Non-HTTP schemes and `data:` URIs are skipped.

## Filtering Heuristics

The extractor skips obvious non-content images:

- Known dimensions under 32 px in either direction.
- Empty, overlong, `data:`, or non-HTTP image URLs.
- Common ad, beacon, tracker, analytics, spacer, sprite, clear, blank, and 1x1 URL or metadata patterns.
- Images inside hidden elements or skipped structural elements such as `nav`, `footer`, `aside`, `form`, `script`, `style`, and `iframe`.

The filter is intentionally conservative so normal article photos, illustrations, charts, and figure images remain in the reader markdown.

## Size Cap And Scope

The existing 2 MB readable markdown cap remains enforced by `truncateReadable(_:)` during capture preparation. Screenshot capture and original HTML capture are unchanged.

Only future captures are affected. Existing bookmarks need a re-capture, and the Mac app needs a new build before this behavior appears in use.

## Verification

`swift build --package-path mac` was validated in this sandbox using writable temp caches and SwiftPM sandbox disablement because the environment blocks user cache writes and nested `sandbox-exec`. A real Mac capture test is still needed to verify images from live article pages render as expected end to end.
