@AGENTS.md

# Write: working notes

Apple-grade multi-tenant blogging platform (Next.js App Router). A craft-first
small commercial product; there is no moat in publishing tools and that is
decided, so the bet is taste. Sibling repo: ~/dev/ramine.net (the personal
portfolio this was extracted from; it stays its own thing).

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

## Verify

- `npx tsc --noEmit` for types, `npm run build` for the full check (this app
  is small; building is cheap, unlike ramine.net).
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
- Content model: a workspace (blogs row) holds three system folders (Blog,
  Notes, Bookmarks); posts carry folder_id and a type (article/project/talk
  are Blog's public kinds; note and bookmark are unlisted FOREVER, enforced
  at the action, store, sync, and MCP layers). Every item round-trips as a
  markdown file (src/lib/markdown-files.ts render + parse).
- Machine surfaces: /api/sync/v1 (bearer wsk_ tokens, manifest hashes,
  If-Match conflicts) and /api/mcp (same tokens, 7 tools). Tokens are minted
  at /connect; agent docs live at /docs/ai and /llms.txt. Every mutation
  writes an action_audit row.
- `src/lib/store.ts`: the ONLY content access point (demo seed without
  DATABASE_URL, Neon Postgres with it). Routes never import demo.ts directly.
- `src/lib/modes.ts`: validated declarative view specs (AI generates specs,
  never code).
- `src/styles/`: tokens.css (neutral palette), broadsheet.css (reader),
  apple.css (editor chrome, scoped .applecms).
- `src/components/Reader.tsx`: the reader.

## Deploy

Vercel (Neon Postgres + Blob wired via env). Work directly on `main`; do not
leave product work on feature branches. Ramine decides when a version is ready
to release. At that point, ship the exact clean and verified `main` commit with
the owner-facing command, update production and the installed Mac app, and
verify that source, public artifacts, website, appcast, and installed build all
match. Never release from a temporary subagent branch or worktree.
