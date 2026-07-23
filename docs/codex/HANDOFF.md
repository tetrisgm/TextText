# Texttext: Claude handoff

Updated 2026-07-22. This is the only current continuation document.

## Start here

The queued body of work is **AI-driven document types**: an engine of render
primitives plus app-executed capabilities, over which a document type is
validated data (fields, item render, container-as-page render, capability
declaration), authored by AI or picked from a fork-to-own gallery, compiled to
HTML, on the existing `.textpack` content model. It is DESIGN, not started, and
is being built collaboratively with Codex, so treat the plan as a proposal to
iterate and verify, not a spec to execute blindly. Otherwise continue from the
user's newest request, and do not resurrect work from older prompts, screenshots,
or the historical briefs under `docs/codex/` unless the user asks.

Read these files before changing product code:

1. `AGENTS.md`
2. `CLAUDE.md`
3. `DESIGN.md`
4. `docs/plan-document-types.md` (the plan) and `docs/review-2026-07-22.md` (the
   review that scoped it) for the document-types work
5. `docs/ai-sidebar-architecture.md` for AI, assistant, or MCP work

## Repository state at handoff

- Repository: `/Users/shokunin/dev/write`
- Durable branch: `main` only
- Remote: `origin/main`
- Feature and release source commit: `aea7650` records Texttext `0.103`
- The later commits on `main` only refresh continuation documentation.
- No temporary worktrees, unmerged branches, or uncommitted product changes
  existed when this handoff was prepared.

Always confirm the live state with `git status`, `git worktree list`, and
`git branch --no-merged main` rather than assuming this snapshot is still current.

## Shipped product state

Texttext `0.103`, build `109`, is the coherent shipped release for this body of
work. At handoff time all of the following matched:

- Source metadata: `src/generated/app-release.ts`
- Mac source version: `mac/Info.plist`
- Installed app: `/Applications/Write.app`
- Public marker: `https://texttext.app/api/app/version`
- Sparkle feed: `https://texttext.app/appcast.xml`
- Immutable archive and signed enclosure named by the generated release metadata

The installed app was running from `/Applications/Write.app`. Release metadata
files are authoritative. Never copy a version from this handoff into a ship
command without checking those files and probing the public marker first.

## Completed current feature set

The current release includes and verifies:

- Apple Foundation Models prewarming, readiness reporting, bounded retries, and
  native assistant execution.
- The shared 31-tool workspace contract used by the UI assistant and hosted MCP.
- Reader text selection without accidental marquee selection.
- Comments created from selected text and displayed as inline threads.
- Bookmark recapture in the edit menu, original-source captions, and Reader or
  Full display modes.
- One responsive search control across workspace, folder, and item surfaces,
  including find-in-item highlighting.
- One Column views rendered as expanded vertical cards.
- The former Grid view renamed Cards, with image and text-only card treatments
  and the star inside each card.
- Immediate removal of trashed items from Recent.
- Work-unit instrumentation, exact-source verification receipts, release gate
  reuse, and the one-command release workflow.

Do not redo these features based on an old acceptance-criteria document. A newly
observed regression is a new task and should be reproduced against the installed
current release first.

## Current body of work: AI-driven document types

See `docs/plan-document-types.md` for the full plan and `docs/review-2026-07-22.md`
for the review that scoped it. The load-bearing decisions:

- One engine (a game-engine model): render primitives are pure and declarative
  and a type composes them; capabilities (import, sync, collaboration, AI,
  publish, search) are app-executed and a type only declares them. Compose-only:
  a type is validated data, never code that runs alongside the engine.
- Content stays portable data in the `.textpack` (Markdown body + typed fields +
  assets). HTML is compiled output, never the stored source.
- The hard prerequisite is the **fail-closed privacy rework**: today privacy is a
  denylist, so a novel type would publish by default across four-plus sites. Flip
  it to an allow-list before any type becomes user-definable. A closed
  `validateRenderSpec` must gate any rendered spec.
- The plan lists ordering constraints, not fixed phases; the public gallery is
  last because import is the only untrusted-input surface.

Intersecting pending work to coordinate with, not duplicate:

- **Collaboration durability** (core, not a side feature): make the owner a
  first-class Yjs co-editor, an invite/accept binding step, live cursors, and
  close the known between-sessions holes. Its access half is the sharing and
  permission model (public link, team, named writers). CRDT/sync only touch
  document content; the render and the engine are separate layers.
- **BYO cloud AI**: a "use my cloud key" override so the AI authoring loop can
  reach Claude or GPT, not only the on-device model.

A separately discussed idea, not assigned: a macOS-aware reading-size preference
that respects system accessibility choices. Do not build it unless asked.

## Architecture and safety contracts

- `main` is the only durable branch and release source.
- `src/lib/store.ts` is the only content access boundary.
- Notes and bookmarks remain private and unlisted at every layer.
- Every mutation writes an `action_audit` row.
- UI, in-app assistant, and MCP consume one workspace command contract. The app
  never calls its own MCP endpoint.
- Apple on-device models are the default AI provider on eligible Macs. Optional
  cloud providers and external MCP clients augment that local-first path.
- Never reintroduce `Response.redirect()` in the OAuth approval route because its
  immutable headers previously caused production approval failures.
- Follow the typography, contrast, motion, theme, and copy rules in `DESIGN.md`.
- Do not use em dashes in product copy, documentation, or release notes.

The detailed implemented AI state lives in
`docs/ai-sidebar-architecture.md`. The files `docs/codex/mcp-brief.md` and
`docs/codex/ui-batch-brief.md` are historical inputs, not pending queues.

## Local development environment (read before running anything)

The database is split local vs prod as of 2026-07-22, because dev, CI, and gate
traffic against the prod Neon database burned its free-tier transfer cap. Do not
undo this:

- `.env.local` `DATABASE_URL` points at a LOCAL Postgres
  (`postgres://<you>@localhost:5432/texttext_dev`, Homebrew `postgresql@17`). All
  routine work (dev, tests, `npm run build`, `verify:release`) runs local and
  never touches Neon. Set it up once with `bash scripts/setup-local-db.sh` (it
  creates the `write_change_seq` sequence, pushes the schema, and seeds the demo).
- `src/lib/db/client.ts` is dual-driver by URL: a `neon.tech` URL uses the Neon
  HTTP driver (production), any other URL uses `node-postgres` (local).
- Prod Neon is only ever touched by the deployed app and by release migrations,
  which load prod creds from `.env.release.local` (gitignored, mode 600) and
  refuse to migrate anything that is not the `neon.tech` endpoint.
- Do NOT point `.env.local` at prod Neon, and do NOT run migrations or tests
  against it. Schema changes for local work run against `texttext_dev`.

## Work and verification workflow

For each coherent body of work:

1. Prove the repository and inspect branch hygiene before editing.
2. Run `npm run work:start -- "short label"`.
3. Work directly on `main` unless another integrator is already writing there.
4. Run checks through the work-unit recipes so receipts include exact source and
   closed, capped child processes.
5. Use `npm run work:summary` while diagnosing slow work.
6. Use `npm run verify:release` as the only full release gate.
7. Run `npm run work:finish` after final verification.
8. Commit and push one coherent unit once.
9. Ship meaningful product work with `release/ship.sh`. It bumps the next free
   version when no version is supplied, publishes immutable artifacts first,
   flips public markers last, installs the Mac app, and verifies the result.
10. Do not build or ship documentation-only changes.

For OAuth, MCP discovery, or MCP handler changes, also run:

```sh
AUTH_DEV_LOGIN=1 npm run dev
python3 scripts/test-oauth-mcp-loop.py http://localhost:3000
```

Use a bounded dev-server process and stop it after the gate. The OAuth loop is a
release blocker for that surface.

Meaningful user-facing work also gets a newest-first entry in the in-product
`Texttext Changelog` note as described in `AGENTS.md`.

## Handoff maintenance

Update this file only when work is genuinely unfinished or architecture changes.
Record exact completed, pending, verification, release, and blocker state. Do not
paste an accumulating backlog into it. Completed detail belongs in Git history,
the architecture documents, and the in-product changelog.

## Paste into Claude

```text
cd /Users/shokunin/dev/write

Continue the Texttext project from clean main. Read AGENTS.md, CLAUDE.md, DESIGN.md,
docs/codex/HANDOFF.md, and docs/ai-sidebar-architecture.md before changing code.
The handoff is authoritative: the previous feature batch is complete and shipped
as Texttext 0.103 build 109, and the old MCP and UI briefs are historical references,
not active task lists. Do not redo completed work.

First fetch and fast-forward main, then verify branch hygiene and the current
source, public release marker, appcast, installed app version, and running app.
Continue from my newest request. If I have not supplied a new product request,
report that there is no active implementation rather than inventing a backlog.

For actual product work, start a work unit with npm run work:start, work directly
on main, preserve unrelated changes, verify once through the receipt-based work
commands, commit and push one coherent unit, ship it with release/ship.sh, update
the installed app and in-product Texttext Changelog, and verify source, public
artifacts, feed, website, installed version, and running behavior all agree.
Do not create a feature branch or leave work for me to integrate. Do not ship
documentation-only changes. Use no em dashes.
```
