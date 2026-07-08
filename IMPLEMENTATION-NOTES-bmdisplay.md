# Implementation notes: bookmark screenshot display

## Surfaces

- `resolveCover` now returns `capture.screenshotUrl` for bookmark posts when `post.cover` is empty. `NO_COVER_VALUE` still suppresses all covers, and an explicit `post.cover` still wins.
- The reader hero marks that resolved screenshot cover with `.is-capture-cover`.
- The bookmark reader now renders a capture section after the masthead with a scrollable full-page screenshot frame plus links to the original URL, saved original HTML, and full page capture.
- `PostCard` and `BookmarkCard` mark captured screenshot thumbnails for top cropping. `BookmarkCard` uses an explicit cover when set, the screenshot when no explicit cover exists, and no thumbnail when neither exists.

## Cropping

- Hero and card thumbnails keep `object-fit: cover`.
- Captured screenshots use `object-position: top` so tall captures preview the page header.
- The full reader capture uses an `overflow: auto` frame with the image at natural height, so the whole tall screenshot can be inspected without squashing.

## Light and dark check

- New reader surfaces use `var(--bg)`, `var(--bg-soft)`, `var(--ink)`, `var(--ink-2)`, `var(--muted)`, and `var(--hairline)`, which already flip by theme.
- Accent text remains floored with `color-mix(in srgb, var(--post-accent, var(--ink-2)) 60%, var(--ink))`.
- Motion stays unchanged. The existing cover reveal remains the only load animation, and the capture frame adds no motion.

## Verification

- `npx tsc --noEmit`
