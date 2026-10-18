# Folder grid derived-view invalidation

T15 bounded audit of actual shared `FolderPresentation` and `VaultDocumentGrid`. No production correction was needed in this slice: a fresh listing identity already invalidates cached labels, metadata and visible previews; stale asynchronous reads are discarded, and thumbnail object URLs are revoked when replaced or unmounted.

## Gate

`node src/local-vault/__tests__/grid-invalidation.browser.mjs`

Pass log: `/private/tmp/texttext-grid-invalidation-browser-20261018.log`.

Actual Chromium renders the real components with controlled read-only folderViews/preview responses. Assertions cover unchanged-path body/title/thumbnail replacement, moved path routing, delete/restore, delayed old-listing and old-workspace preview refusal, thumbnail URL cleanup after replacement/deletion/unmount, and no idle echo reads or mutation commands. The fixture uses existing valid note template/schema rather than modifying product templates for visibility. Its isolated browser is closed at completion.

Source SHA-256 for `src/local-vault/__tests__/grid-invalidation.browser.mjs`:
`b6b7be98dc37cc8475353a3395f70edd28499c29e6228cf5bf201e6987b835d2`.

This proves the component behavior after an actual new listing input, not native filesystem notification delivery, iCloud eviction, installed-app behavior, or the complete six-client acceptance matrix. Those physical/provider gates remain separate.
