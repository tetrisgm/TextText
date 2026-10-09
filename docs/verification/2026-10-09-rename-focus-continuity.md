# Editor continuity through an external rename (Mac 1238 focus loss)

Builds on `033b1824`. Physical evidence: `/tmp/texttext-rename1238-physical.md`
(fixture `243d5ab9-b356-4e70-8453-85f90010b503`, Mac 1238). After the atomic
rename the editor was still present with the new path, but focus had left the
body and the paste timed out. No recovery banner.

## Root cause (verified in code, not the review's exact chain)

The Mac listing identifies rows from the sync manifest cache
(`LocalVaultSyncTransport.capabilities().pathIdentities`,
`LocalVaultWindowController.withCapabilities`). A filesystem rename shows the
new path immediately but the manifest still names the old one, so the row for
the new path has no `itemId` for one or more listings. `locateVaultItem` then
misses, `selected.path` stays at the old path, which is absent from the listing,
and `listingCapabilities.edit(oldPath)` returns explicit `false`. `readOnly`
flips, the editor swaps to the display component, and the body, caret and undo
manager are destroyed. When the manifest catches up the editor remounts with a
fresh undo stack and no focus. The local-mode editor's own `vault-changed`
handler had the same miss and raised the "moved or deleted" conflict.

## Fix

- `locateVaultItemOrResolve`: when the listing has no row for the identity and
  none at the opened path, ask the store (`resolveItemId`, which reads the
  file's `textTextId`, not the manifest). Only an unidentified row at that path
  may be adopted; the listing row still decides permission. Used by the
  `VaultApp` refresh (before publishing the listing) and by the local editor's
  relocation path, which still verifies identity by reading the file.
- `listingCapabilities.editItem(itemId, path)`: answers from the unique
  identity row when the opened path left the listing. Unknown or ambiguous
  identities and explicit `canEditContent: false` stay denied. No read-only
  bypass is cached.

## Proof

- `src/local-vault/__tests__/rename-editor-continuity.browser.mjs`: native
  listing, edit, type, then stale listing (new path, no id), then identified
  listing, then explicit revocation. Asserts the same body element stays
  mounted and focused, undo reverts the typing, save writes only to the new
  path, and revocation removes editing. Fails on `033b1824` with
  `{"marked":null,"focused":false,"readOnly":true}`; passes with the fix.
- Unit: `listing-capabilities.test.ts`, `item-location.test.ts`.
- `tsc` clean; `vitest run src/local-vault` 358 passed; neighbouring browser
  tests `listing-capabilities` and `open-item-move` pass.

## Limits

Not rebuilt or installed; physical Mac re-verification of 1238 fixture pending.
Pre-existing failures in `collaboration-client.test.ts` (3 epoch/journal cases)
reproduce on `033b1824` without this change.
