# Reader and persistent highlights

Source commits: `a3cb0637`, `c0a80b59`. Installed app **0.202 (1127)** includes this reader slice.

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

## Installed native verification

On build 1127, native pointer drag selected a passage in the Figma saved link.
Highlight selection became enabled. Adding a note, switching documents and
reopening retained the quote, note and yellow highlight painting in WKWebView.
The on-disk document.json contained one readerHighlights row with quote,
prefix/suffix, source and the exact test note. Local-server bytes matched native.
Screenshot: `/tmp/texttext-native-highlight-20260930.png`.

The test annotation was then removed through the UI. The original article stayed
intact, the highlight list was empty on disk and both replicas converged again.
This verifies native light-mode selection, painting and persistence. Native dark
mode remains unverified; earlier light/dark browser screenshots are separate
proof. Full article offline images and unopened-link capture remain pending.

## Next

File-backed template/agent customization, multiplayer, source image archiving,
durable unopened-link capture and the remaining full brief remain active work.
No public release, push or persistent job was performed for this verification.
