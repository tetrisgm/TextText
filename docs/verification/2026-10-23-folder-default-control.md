# Folder default control, October 23

`de9dd346` adds a distinct **Default for new items** control to folder customization. It pins a validated built-in template in the folder's own definition for future generic creation. The guarded write checks the folder view's revision, retains its exact Markdown and collection template, and refuses a changed view. A folder without a view gets one standard-layout definition through an atomic create-only import. Explicit template choices still override the folder default.

Focused checks passed on both PC and Mac: seven `folder-view.test.ts` cases, the real bundled `folder-default-ui.browser.mjs` interactions (one guarded update and one create-only import, both preserving collection design), and `tsc --noEmit`. Installed light/dark behavior remains to be checked in the next unified release; this is source verification, not installed acceptance.
