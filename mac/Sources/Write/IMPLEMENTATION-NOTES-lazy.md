# IMPLEMENTATION-NOTES-lazy

Readable extraction still runs against the live `WKWebView` DOM. It now waits until after the page finishes, computes the bounded full-page snapshot size, resizes the offscreen webview to that size, sets lazy images to eager, promotes common lazy attributes into `src` and `srcset` when the current value is missing or a known placeholder, dispatches viewport events, scrolls through the page, waits briefly, and resets to the top before extracting readable markdown, original HTML, and the screenshot.

Image URL selection now prefers `currentSrc` when it looks like a real content image, then the largest matching `picture` or `img srcset` candidate, then real-content `src`, then lazy data attributes and lazy data srcsets. URLs are absolutized against `document.baseURI` or the final page URL, and `data:` URIs are skipped.

The image filter skips known placeholders such as contentstack `default-cubic`, generic placeholder or spacer names, 1x1 pixels, transparent or blank images, rendered images under 64 px in either dimension, tiny natural images when no rendered size exists, images inside non-content containers, and URL or label patterns for ads, trackers, logos, favicons, sprites, icons, avatars, and profile photos. Real article figures, screenshots, and diagrams remain eligible when they are rendered at content size and do not match those patterns.

The existing 2 MB readable markdown cap is unchanged in `truncateReadable`.

This still needs a real-Mac capture test against a lazy-loading article such as gamedeveloper.com/contentstack, followed by a new Mac app build for distribution.
