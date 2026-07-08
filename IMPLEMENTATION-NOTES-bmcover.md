# Bookmark cover implementation notes

## Cover fallback chain

`src/lib/cover.ts` now resolves a cover source with a kind. Explicit `post.cover`
still wins, and `NO_COVER_VALUE` still suppresses all covers.

For bookmarks without an explicit cover, the chain is:

1. First suitable reader-body image from `firstHttpMarkdownImage`, matching the
   first markdown image whose URL is `http` or `https`.
2. `capture.screenshotUrl`, if it is an `http` or `https` URL.
3. First-party favicon at `https://<host>/favicon.ico`, derived from
   `capture.url` first, then `links[0].href`.

The reader and cards use the cover kind for rendering: screenshot covers keep a
top crop, body-image covers use the normal centered cover crop, and favicon
covers are contained and centered on a neutral field.

## Original link

The bookmark reader now shows a prominent labeled `Original link` block before
the saved screenshot. It links to `capture.url` first, then falls back to
`links[0].href`, and opens in a new tab with `target="_blank"` and
`rel="noopener noreferrer"`.

The saved original HTML and full-page capture links remain below the screenshot
as secondary capture links.

## Auto description

`saveBookmarkCapture` now fills `excerpt` only when the stored excerpt is blank.
It uses the merged capture data in this order:

1. `capture.description`
2. `capture.siteName`
3. URL host from `capture.url`, then `links[0].href`

The selected value is whitespace-normalized and truncated to 200 characters
with `...` when needed. Existing user-set excerpts are never overwritten.
