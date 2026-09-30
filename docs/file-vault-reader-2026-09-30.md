# Reader and persistent highlights

Source commits: `a3cb0637`, `c0a80b59`. Installed app remains **0.202 (1121)**;
this reader slice has not yet been packaged or installed.

Saved links open in a shared-DocumentRenderer reading view with an explicit Edit
switch. Notes continue opening directly in the editor. Captured-source comparison
uses the shared renderer rather than raw Markdown. Switching back to reading
flushes the current draft through the existing guarded save path.

Selected passages can be highlighted and annotated. Excerpts, surrounding
context, source identity and notes live in `content.fields.readerHighlights` in
the same TextPack. Quotes are bounded to 2,000 characters, context to 64 on each
side, notes to 20,000, rows to 500. Identical anchors are deduplicated. Changed or
ambiguous anchors never move silently to another occurrence. Original excerpts
remain in the annotation list. CSS Highlight painting leaves React's DOM intact
and is limited to rendered text up to 200,000 characters; the excerpt list also
works without that browser API.

## Evidence

- Three focused highlight tests passed: unique/ambiguous/changed anchoring,
  content preservation, duplicate avoidance, bounds and malformed external rows.
  `/tmp/texttext-reader-tests.log`.
- Full TypeScript and scoped ESLint passed. An initial unrelated email type
  failure coincided with another worker's dependency update; that worker fixed
  `share-email.ts`, and the later full check passed. Their files were preserved.
- Offline UI scenario passed creation, capture, reading, selection, visible
  highlight painting, annotation, closing/reopening, and persisted file readback.
  Existing editor/conflict/recovery scenarios also passed, with no HTTP/fetch.
  `/tmp/texttext-reader-browser-final.log`.
- Light/dark screenshots inspected:
  `/tmp/texttext-article-reader-light.png`, `/tmp/texttext-article-reader-dark.png`.

The capture fixture was discovered to ignore create body/source parameters,
creating a plain note. It is corrected to model saved links. The prior article
receipt's expanded browser-capture claim was premature; this final run is the
first verified passing expanded capture/highlight scenario. Its independent
installed native capture/refresh proof remains valid.

## Next

Package this with the next visual-capture slice, then verify native selection,
light/dark rendering and persistence in the installed app. Do not call native
highlight support verified based solely on Chromium's CSS Highlight test.
Folder image/GIF capture, source image archiving, durable unopened-link capture,
multiplayer and the remaining full brief are still active work.

Concurrent files to preserve: package.json, package-lock.json,
src/lib/share-email.ts, plus the three previously listed unrelated files.
No server restart, install, push, release or persistent job in this slice.
