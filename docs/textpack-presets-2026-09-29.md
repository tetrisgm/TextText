# TextPack presets and editable source, 2026-09-29

Source commits: `7d68733b` (sync and editable source) and `e3c760a9`
(checked-in presets and example creation). These commits are local on `main`;
no public push or release was part of this check.

The active catalog now has 11 checked-in `.textpack` files in
`presets/builtin/`. Each contains the validated look and a complete preview
`DocumentSnapshot`. `npm run presets:generate` produces separate browser-safe
definition and example modules; `npm run presets:check` verifies the committed
output against the packs. Normal rendering imports definitions without loading
the example bodies. The 18 retired looks remain resolvable for pinned items.

The public template example action now creates one private draft from the full
snapshot, with its exact look, compatible item kind, and destination folder.
It carries fields, tags, and assets in the same insert. Choosing a look without
the example still starts blank.

Structured sync, the Mac File Provider, the local CLI, and GitHub backup now
carry an optional `template-source.json` beside `template.json`. The server
accepts source only when its blueprint compiles to the embedded look. Invalid
or unmatched optional source is discarded while the document remains usable.
GET, manifests, write validators, and write responses agree on the structured
hash. Direct Mac package creation now sends the embedded look through the live
API instead of dropping it through a legacy fallback.

## Verification

- `npm run presets:check`: 11 packs and generated modules match.
- Focused Vitest: 9 files, 96 tests passed; separate database template
  lifecycle run: 7 tests passed.
- Focused Swift `TextBundlePackageTests`, `LiveTextTextSyncAPITests`, and
  `DocumentStoreTests` command passed with `-j 2`.
- `npx tsc --noEmit`, touched ESLint, `npm run build`, documentation verifier,
  and `git diff --check` passed. ESLint reported two existing unused symbols
  in `src/lib/store.ts` and no errors.

## Limits

- Handcrafted built-ins have no blueprint source. A gallery Remix copies their
  compiled look but cannot be changed with `update_item_type` until there is
  an agent path for editing a full validated render definition. Agent-authored
  workspace types with matching blueprint source can be updated and carried
  through TextPacks.
- Built-in example image URLs still point to app `/covers/` paths. Their packs
  do not embed those image binaries, so the examples are not standalone media
  bundles outside TextText.
- These changes passed local code, database, and native tests plus a production
  web build. An installed-app TextPack import and save round trip has not yet
  been exercised. Explicitly visiting `/start?template=...&seed=1` a second
  time creates another draft; the app's example link disables prefetch.
