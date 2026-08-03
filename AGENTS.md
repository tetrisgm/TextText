<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes. Read the relevant guide under
`node_modules/next/dist/docs/` before changing Next.js APIs or conventions.
<!-- END:nextjs-agent-rules -->

# TextText agent contract

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

## Releases

Releases and store uploads happen only when the owner asks. Releasing is a
decision, not a trigger.

No launchd job, cron entry, CI schedule, watcher, or git hook may build,
publish, deploy, notarize, upload, or reinstall this project on its own. A
commit is not a release signal, and neither is a timer. Do not install, arm,
or restore such a job, and do not add a script whose purpose is to run one.

`release/ship.sh` (`npm run ship`) is a deliberate command a human runs. It
must never be wrapped in a watcher, loop, or scheduler.

Debugging happens locally. Never diagnose by pushing a build to a store, to
the public appcast, or to any user-visible update channel.

## Database

`.env.local` must point to local Postgres. Development, tests, builds, and the
full gate never use production Neon.

Production release credentials live in the macOS login Keychain, never in a
plaintext file: service `texttext-release`, accounts `DATABASE_URL` and
`BLOB_READ_WRITE_TOKEN`, read through `release/secrets.sh`. Store or rotate one
with `release/secrets.sh store <NAME>`. A missing secret stops the release
rather than letting it target the wrong database or bucket. Never pass a
credential as a command argument, and never echo one into a log.

## Changelog

Use the installed `texttext:project-changelog` skill. The sole changelog item is:

```text
Shoku's Space/My Notes/TextText Changelog.textpack
```

Resolve it by this full path, confirm the version that actually shipped, and do
not create a repository copy. Internal infrastructure-only changes need no
entry.
