# TextPack presets and editable source, 2026-09-29

Source commits: `7d68733b` (sync and editable source), `e3c760a9`
(checked-in presets and example creation), and `b0fedca3` (agent Remix/edit).
These commits are local on `main`;
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

The agent can now copy a built-in look into a personal type, inspect its full
validated render definition, and edit that copy as an immutable successor.
Blueprint-authored types continue to use the blueprint editor. Definition edits
use the same schema-v1 render primitives and reject stale versions, incompatible
stored fields, built-in ids, and unreadable or outdated blueprint sources.

## Verification

- `npm run presets:check`: 11 packs and generated modules match.
- Focused Vitest: 9 files, 96 tests passed; separate database template
  lifecycle run: 7 tests passed.
- Agent Remix follow-up: 4 focused files, 133 tests passed; database template
  lifecycle passed 8 tests; TypeScript and a rebuilt production web bundle
  passed. Installed build 1116 reopened the signed-in workspace against that
  bundle after the local server restart.
- Focused Swift `TextBundlePackageTests`, `LiveTextTextSyncAPITests`, and
  `DocumentStoreTests` command passed with `-j 2`.
- `npx tsc --noEmit`, touched ESLint, `npm run build`, documentation verifier,
  and `git diff --check` passed. ESLint reported two existing unused symbols
  in `src/lib/store.ts` and no errors.
- Local Mac build 0.202 (1116), signed with three extensions and the bundled
  Codex runtime, was installed at `/Applications/TextText.app`. It opened the
  signed-in workspace against the local production server; `/templates`
  returned HTTP 200. This verifies installation and launch, not TextPack
  import behavior.

## Limits

- Handcrafted built-ins remain immutable. Agents can edit an independent Remix
  by supplying its full validated render definition; agents can edit types with
  matching blueprint source through the blueprint path. The gallery's own
  visual studio still edits blueprint-authored types, so direct-definition
  editing is currently an agent command path.
- Built-in example image URLs still point to app `/covers/` paths. Their packs
  do not embed those image binaries, so the examples are not standalone media
  bundles outside TextText.
- These changes passed local code, database, and native tests plus a production
  web build. An installed-app TextPack import and save round trip has not yet
  been exercised. The new agent Remix command has adapter and database proof,
  but has not yet been invoked by a live connected agent in the installed app.
  Explicitly visiting `/start?template=...&seed=1` a second time creates
  another draft; the app's example link disables prefetch.
