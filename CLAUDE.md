@AGENTS.md

# Texttext: working notes

Apple-grade multi-tenant blogging platform (Next.js App Router). A craft-first
small commercial product; there is no moat in publishing tools and that is
decided, so the bet is taste. The personal portfolio this was extracted from
stays its own separate project.

## Continuation

When taking over existing work, read `docs/codex/HANDOFF.md` after this file,
`AGENTS.md`, and `DESIGN.md`. It is the only current handoff and it wins over
this file whenever the two disagree, because it is updated per body of work.

Everything under `docs/archive/` is a delivered or superseded historical record.
Each one opens with a banner naming what replaced it. Never treat one as current
status, and when a plan finishes, move it there rather than leaving it beside the
live docs.

## Hard rules

- NO em dashes anywhere in copy, prose, or docs.
- Read DESIGN.md before touching the reader or editor styles. The accent
  rule, the 60% ink contrast floor, and the motion rule are contracts.
- Every color decision is checked in BOTH light and dark mode.
- Never commit credentials. Apple/DB secrets are owner-created, env only.
- Conserve money and tokens. Batch commits into coherent units (never one per
  micro-edit); push and deploy a unit ONCE, never per commit; never re-deploy a
  no-op or re-run a passing build; no redundant builds/migrations/verification
  passes/duplicate agents. Each push and `vercel --prod` is a paid build. Ship
  verified work promptly, but batched. (Global rule, all projects.)

## Local database (read before running anything)

`.env.local` `DATABASE_URL` points at a LOCAL Postgres
(`postgres://<you>@localhost:5432/texttext_dev`). Dev, tests, builds, and
`verify:release` never touch production Neon. Run `bash scripts/setup-local-db.sh`
once if local Postgres is not ready. `src/lib/db/client.ts` picks the driver by
URL: a `neon.tech` URL uses the Neon HTTP driver, anything else uses
node-postgres. Production Neon is touched ONLY by deployed code and by release
migrations, which load `.env.release.local`. Never point `.env.local` at Neon and
never run tests or dev migrations against production; that is what burned the
free-tier transfer cap.

## Verify

- `npx tsc --noEmit` for types and focused `npx vitest run <file>` while working.
- `npm run verify:release` is the SOLE full gate, and shipping consumes its
  exact receipt. Run it on the already-committed source (see AGENTS.md), or
  `release/ship.sh` will reject the receipt as stale.
- The app is plain DOM: browser preview works and screenshots are meaningful.
- Demo content needs zero setup: `npm run dev`, then the demo lives at
  `/@demo` (`/t/demo` and `demo.localhost:3000` redirect there). If the demo
  breaks, the scaffold is broken.

## Layout

- `src/proxy.ts`: `/@{username}` -> `/u/{username}` path rewrite, then
  host -> `/t/{handle}` tenant rewrite (Next 16 proxy, not middleware).
- URL model: unclaimed guest blogs live at `/t/{three-word-handle}`; claimed
  blogs live at `/@{username}` (served by `src/app/u/[username]`). `/start`
  is the single entry point into a workspace; signing in claims the browser's
  guest workspace.
- Content model: ONE canonical document. Every live or trashed item carries a
  validated schema-v1 `DocumentSnapshot` (`src/lib/documents/model.ts`).
  Article, note, bookmark, gallery, and talk are validated presentation
  templates and capability defaults, NOT separate content models. The
  `post_type` column and `src/lib/markdown-files.ts` remain as legacy search
  projections and Markdown import/export compatibility, not a second document.
  Notes and bookmarks stay unlisted forever, and visibility fails closed
  (`src/lib/documents/visibility.ts`): missing or unknown means private.
- Rendering: `src/components/document/DocumentRenderer.tsx` is the one renderer
  for the app, public links, previews, and HTML export. Render specs are
  validated data (`src/lib/presentation/schema.ts`, `templates.ts`), never user
  HTML, CSS, JavaScript, or component names. A document pins an exact immutable
  template version. The bespoke Reader, ProjectReader, and TalkReader are gone;
  do not reintroduce them.
- Machine surfaces: `/api/sync/v1` (bearer `wsk_` tokens, manifest hashes,
  If-Match conflicts) and `/api/mcp` (same tokens, 30 workspace tools) for
  remote agents. Agents ON THIS MAC use the `texttext` CLI instead
  (`mac/Sources/TexttextCLI`), which edits documents as files and publishes
  presence automatically; the loopback MCP server was retired in 0.146. Tokens
  are minted at `/connect`; agent docs live at `/docs/ai` and `/llms.txt`. Every
  mutation writes an `action_audit` row.
- `src/lib/store.ts`: the ONLY content access point (demo seed without
  DATABASE_URL, Postgres with it). Routes never import demo.ts directly.
- Collaboration: full-document Yjs with awareness, cursors, and epoch fencing.
  `src/lib/collab/agent-presence.server.ts` is the single construction site for
  external-agent presence, shared by hosted MCP and the native path.
- `src/styles/`: tokens.css (neutral palette), broadsheet.css (reader chrome),
  apple.css (editor chrome, scoped .applecms).

## Deploy

Vercel (Neon Postgres + Blob wired via env). Work directly on `main`; do not
leave product work on feature branches. The owner decides when a version is ready
to release. At that point, ship the exact clean and verified `main` commit with
the owner-facing command, update production and the installed Mac app, and
verify that source, public artifacts, website, appcast, and installed build all
match. Never release from a temporary subagent branch or worktree.
