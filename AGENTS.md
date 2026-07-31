<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes. Read the relevant guide under
`node_modules/next/dist/docs/` before changing Next.js APIs or conventions.
<!-- END:nextjs-agent-rules -->

# Texttext agent contract

Load the shared `workshop-delivery` skill. Use:

```sh
workshop rules audit texttext
workshop delivery audit texttext
```

`.workshop.json` owns portable PC preflights. The registered controller is the
only automatic delivery path.

## Verify

- Use `npx tsc --noEmit` and focused `npx vitest run <file>` while iterating.
- `npm run verify:release` is the only full product gate.
- Start a coherent work unit with `npm run work:start -- "short label"` and use
  `npm run work:summary`, `npm run work:doctor`, and `npm run work:finish` for
  its deterministic receipts.
- OAuth, well-known-document, or MCP handler changes must pass
  `python3 scripts/test-oauth-mcp-loop.py`.
- The zero-setup demo is `/@demo`; `/t/demo` redirects there.

## Product

- Read `DESIGN.md` before reader or editor visual work. Check every color in
  light and dark mode. Do not use em dashes in product copy.
- One validated schema-v1 `DocumentSnapshot` is the content model. Article,
  note, bookmark, gallery, and talk are presentation templates, not separate
  models.
- `src/components/document/DocumentRenderer.tsx` is the shared renderer.
  Render specs are validated data, never user HTML, CSS, JavaScript, or
  component names.
- `src/lib/store.ts` is the only content access point.
- Notes and bookmarks remain unlisted. Visibility fails closed. Every mutation
  writes `action_audit`.
- Collaboration uses full-document Yjs with awareness and epoch fencing.
- The UI, in-app assistant, and MCP server call one workspace-command surface;
  the app never calls its own MCP endpoint.
- External agents use hosted `/api/mcp`. Agents on this Mac use the `texttext`
  CLI and do not restore a loopback server.
- Full AI architecture is in `docs/ai-sidebar-architecture.md`.

## Database

`.env.local` must point to local Postgres. Development, tests, builds, and the
full gate never use production Neon. Production migrations load
`.env.release.local`. Run `scripts/setup-local-db.sh` when local Postgres is not
ready.

## Changelog

Use the installed `texttext:project-changelog` skill. The sole changelog item is:

```text
Shoku's Space/My Notes/Write Changelog.textpack
```

Resolve it by this full path, confirm the version that actually shipped, and do
not create a repository copy. Internal infrastructure-only changes need no
entry.
