# TextText: architecture

A multi-tenant publishing platform: Next.js App Router on Vercel, plus a native
macOS app that mounts the workspace as a Finder location.

This is the current architecture map. Verify live behavior and generated
release metadata rather than relying on historical handoffs.

## Tenancy and URLs

- `src/proxy.ts` (Next 16 proxy, not middleware) keeps authenticated workspace
  routes on the platform origin and rewrites each `{handle}.{root-domain}`
  request to the matching `/t/{handle}` reader with all viewer credentials
  removed. Reserved subdomains live in `src/lib/tenants.ts`.
- Private workspace routes retain `/t/{handle}` and `/@{username}` for editing,
  shares, and collaboration. Published pages live at
  `{handle}.{root-domain}/{folder}/{slug}` and never read a viewer session.
- `/start` is the single entry into a workspace. Signing in claims the browser's
  guest workspace.
- Local dev: `npm run dev`, then `demo.localhost:3000` for the public demo.
  Legacy `/@demo` and `/t/demo` links redirect there.

## Content model

One canonical document. Every live or trashed item carries a validated
schema-v1 `DocumentSnapshot` (`src/lib/documents/model.ts`).

Article, note, bookmark, gallery, and talk are validated presentation templates
and capability defaults, not separate content models. The `post_type` column and
`src/lib/markdown-files.ts` survive as legacy search projections and Markdown
import/export compatibility, not as a second document.

Notes and bookmarks stay unlisted forever. Visibility fails closed
(`src/lib/documents/visibility.ts`): missing or unknown means private.

## Data

- Postgres. `src/lib/db/client.ts` picks the driver by URL: a `neon.tech` URL
  uses the Neon HTTP driver, anything else uses node-postgres. Schema in
  `src/lib/db/schema.ts`.
- `src/lib/store.ts` is the ONLY content access point. Without `DATABASE_URL` it
  serves the demo seed (`src/lib/demo.ts`) so the app runs with zero setup.
  Routes never import `demo.ts` directly.
- Every mutation writes an `action_audit` row.
- Media goes to Vercel Blob.

## Rendering

`src/components/document/DocumentRenderer.tsx` is the one renderer, used by the
app, public links, previews, and HTML export. Render specs are validated data
(`src/lib/presentation/schema.ts`, `templates.ts`), never user HTML, CSS,
JavaScript, or component names. A document pins an exact immutable template
version.

The bespoke Reader, ProjectReader, and TalkReader are gone. Do not reintroduce
them.

Styles: `src/styles/tokens.css` (neutral palette), `broadsheet.css` (reader
chrome), `apple.css` (editor chrome, scoped `.applecms`). Read `DESIGN.md`
before touching either; the accent rule, the 60% ink contrast floor, and the
motion rule are contracts.

## Collaboration

Full-document Yjs with awareness, cursors, and epoch fencing. The client renders
local edits immediately and reconciles the network in the background.
`src/lib/collab/agent-presence.server.ts` is the single construction site for
external-agent presence, shared by hosted MCP and the CLI.

## Machine surfaces

- `/api/sync/v1`: bearer `wsk_` tokens, manifest hashes, If-Match conflicts.
- `/api/mcp`: hosted MCP for agents that are not on the user's Mac.
- The `texttext` CLI (`mac/Sources/TextTextCLI`): for agents that ARE on the
  user's Mac. It edits documents as files and publishes presence automatically.
  There is no local MCP server.
- Tokens are minted at `/connect`. Agent docs are at `/docs/ai` and `/llms.txt`.

`docs/agent-interoperability.md` is the reference for all of the above.

## Native macOS app

`mac/` (SwiftPM). It hosts the web experience, serves the workspace through a
File Provider extension so it appears as a Finder sidebar location, ships the
`texttext` CLI, and updates through Sparkle. The File Provider is a durable
projection, not the local edit hot path.

## Auth

Sign in with Apple, Google, or email through Auth.js. `/connect` mints machine
tokens and manages OAuth client approvals. See `docs/production-auth.md`.

## Positioning (decided, do not relitigate)

A craft-first small commercial product. There is no defensible moat in
publishing tools; the bet is taste, not lock-in. Content is exportable Markdown,
always.
