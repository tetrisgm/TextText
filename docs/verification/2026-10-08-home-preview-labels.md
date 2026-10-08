# Home saved-title stability and external-edit invalidation

The shared grid now retains only bounded title/excerpt labels, weakly owned by
one listing object. Returning from a document to home can display the saved title
before serialized preview reads complete. New listings never reuse these labels,
even when workspace root and paths are unchanged. Images, full snapshots and
object URLs are not retained; labels are bounded to 128 items, 240 title characters
and 300 excerpt characters. Normal preview reads still revalidate.

The focused browser test exposed an existing invalidation bug: the preview effect
used serialized listing/path values, so a file-change notification with unchanged
paths did not restart preview loading. It now also depends on listing identity.

Verification:

- Three unit regressions passed: remount display labels, same-path new-listing and
  workspace invalidation, missing paths and memory bounds.
- Rebuilt shared offline UI passed `verify-browser.mjs --preview-labels-only`.
  Preview requests were deliberately held while returning home; the saved title
  remained visible. An external title edit with unchanged path triggered a fresh
  listing; the cached label disappeared and the newly read title appeared.
- TypeScript check passed after the source changes.

Logs: `/tmp/texttext-preview-labels-build.log`,
`/tmp/texttext-preview-labels-browser-fixed.log`,
`/tmp/texttext-preview-labels-types.log`.

Source acceptance only. No updated client install, Oracle deployment, native
Safari interaction or broad performance result is implied.
