<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes. Read the relevant guide under
`node_modules/next/dist/docs/` before changing Next.js APIs or conventions.
<!-- END:nextjs-agent-rules -->

# Texttext agent contract

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
- The zero-setup demo is `/@demo`; `/t/demo` redirects there.
- Full AI architecture is in `docs/ai-sidebar-architecture.md`.

## Database

`.env.local` must point to local Postgres. Development, tests, builds, and the
full gate never use production Neon. Production migrations load
`.env.release.local`.

## Changelog

Use the installed `texttext:project-changelog` skill. The sole changelog item is:

```text
Shoku's Space/My Notes/Write Changelog.textpack
```

Resolve it by this full path, confirm the version that actually shipped, and do
not create a repository copy. Internal infrastructure-only changes need no
entry.
