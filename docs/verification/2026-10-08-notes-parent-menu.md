# Notes Parent menu verification

The shared Notes creation and full editing menus expose Parent. Creation stores
stable document IDs in the same TextPack snapshot as editing; folders are unchanged.
The inline picker uses theme colors and closes on Done. Menu shortcuts select by
name so adding Parent does not redirect Link, Image or Template shortcuts.

## Checks

- `npx tsc --noEmit`: passed after correcting the overview callback contract
  and keeping reference arrays in the validated document fields.

- `npm run test:note-template:browser`: passed all three scripts, including
  relocation with pending typing and reference-picker concurrency regressions.
- `node src/local-vault/__tests__/note-template.browser.mjs`: passed after adding
  explicit search-focus assertions for both creation and editing.
- The fixture creates a card with its parent, removes and re-adds the parent from
  the full editing menu, saves/reopens, and verifies stable identity and retained
  title/body. Existing template insertion shortcuts and light/dark checks passed.

Source change only; not yet installed or deployed.
