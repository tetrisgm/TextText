<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# TextText

- Before reader/editor visual changes, read `DESIGN.md`; check light/dark colors. No em dashes in product copy.
- Content is one validated schema-v1 `DocumentSnapshot`; article/note/bookmark/gallery/talk are templates. Shared renderer: `src/components/document/DocumentRenderer.tsx`. Render specs are validated data, never user HTML/CSS/JS/component names.
- `src/lib/store.ts` is the sole content access point. Notes/bookmarks remain unlisted; visibility fails closed; every mutation writes `action_audit`.
- Collaboration uses full-document Yjs, awareness, and epoch fencing. UI, assistant, and MCP share workspace commands; the app never calls its own MCP endpoint.
- External agents use hosted `/api/mcp`; local agents use `texttext` CLI, never a restored loopback server. AI architecture: `docs/ai-sidebar-architecture.md`; development providers: `docs/AI-DEVELOPMENT.md` when needed.
- Release only when asked, using human-invoked `release/ship.sh` (`npm run ship`). Never automate builds/releases/reinstalls through jobs, hooks, schedules, commits, watchers, or installer scripts. Debug locally, never through public update channels.
- The owner has authorized one-off local TextText builds and installs to `/Applications/TextText.app` during requested work. Preserve current user content and verify the installed app; do not ask again for local-install permission. This does not authorize an Oracle deploy or public release.
- Local development/tests/builds use local Postgres, never production Neon. Before database or release-secret work, read `docs/DATABASE-OPERATIONS.md`.
- Shipped product changes use `texttext:project-changelog` and the existing `Shoku's Space/My Notes/TextText Changelog.textpack`; verify the shipped version. No repository changelog copy; infrastructure-only changes need no entry.
- No GitHub Actions workflows, secrets, or runners. GitHub hosts git; tests run locally on the Mac.

## Deploys

- Pushing to `main` deploys nothing. The web app runs on the Oracle server
  (`release/oracle/README.md`) and ships with the Mac app through `npm run ship`,
  run from the Mac only when the owner asks. The Vercel project `write` is
  paused; do not deploy to it.
- Cloud sessions cannot release: that needs the Mac's signing keys, Keychain and
  SSH access. Push a branch or open a PR and say what needs shipping.
- Nothing from the owner's Mac reaches cloud sessions: not their global
  instructions, logins, Keychain, or `~/dev/stack` (retired). Do not go looking
  for them.
