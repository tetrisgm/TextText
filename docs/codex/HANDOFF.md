# Texttext continuation handoff

Updated 2026-07-29. This is the only current continuation document.

## Start here

There is no unfinished implementation. The last body of work, the `texttext` CLI
and the retirement of the loopback MCP server, shipped as `0.146` build `152`,
and the documentation and changelog were made current in `0.147` build `153`.
Continue from the user's newest request.

Read these files before changing product code:

1. `AGENTS.md`
2. `CLAUDE.md`
3. `DESIGN.md`
4. `docs/agent-interoperability.md` for anything an agent touches
5. `docs/plan-document-types.md`
6. `docs/review-2026-07-22.md`
7. `docs/ai-sidebar-architecture.md` for assistant or MCP work

Confirm the live state with `git status`, `git worktree list`, and
`git branch --no-merged main`. `main` is the only durable branch and release
source. Do not trust a version number copied from this handoff; inspect generated
release metadata, the public marker, appcast, and installed bundle.

## Live state at this handoff

This is a baseline, not a substitute for inspecting live `main`.

- Source commit `9564408` (release metadata); the CLI landed in `38ff316` and
  `513404e`, the documentation sweep in `8a28f0e` and `858a520`.
- `main` and `origin/main` were synchronized and the worktree was clean.
- No secondary worktree or branch was left behind.
- Source release metadata, the public marker, the appcast, and
  `/Applications/Texttext.app` were all `0.147` build `153`.
- `net.writeapp.write.autobuild` had been left launchctl-DISABLED since
  2026-07-20, so pushes silently never shipped. It is enabled and running again.
  `launchctl bootstrap` on a disabled job fails with a useless
  `Input/output error`; run `launchctl enable gui/$(id -u)/<label>` first.

## Completed body of work: agents on this Mac use a CLI, not a port

Shipped in `0.146`. `docs/agent-interoperability.md` is the reference for what
exists; `docs/archive/2026-07-29-plan-texttext-cli.md` records why.

The shape: an agent with a shell edits documents as files through the `texttext`
CLI, which ships inside the app bundle and is authenticated by construction
because it runs as the user and reads the device credential the app already
stores. Hosted MCP at `/api/mcp` stays, for clients with no shell.

What that bought, beyond convenience:

- **Presence became free.** Every mutating command publishes presence before it
  acts and clears it after, so an agent appears as a named collaborator simply
  by working. Nothing to remember, nothing to signal.
- **Section anchoring replaced field cursors.** An agent has a region of
  interest, not a caret. `--section "## Pricing"` puts the avatar at the heading
  and changes only that span.
- **Intent reaches the audit row.** `--message` records what a change was for.
- **The `.textpack` format is owned in one place.** The CLI reuses
  `WriteFileProviderKit/TextBundlePackage.swift`, so an agent never touches the
  zip and that corruption class stops existing. Writes are atomic through
  `replaceItemAt`.
- **A whole security problem was deleted rather than mitigated.** The loopback
  MCP server is gone, so there is no port, no transport guard, and no local
  trust model to get right. (The live CSRF hole it had, a `text/plain` POST from
  any web page executing blind writes, was closed in `0.145` first, then made
  moot.) Do not reintroduce a local listening socket.

### Deliberately not done

The CLI plan proposed an `AGENTS.md` at the File Provider workspace root, for
agents arriving without the plugin. Skipped: anything written there syncs and
becomes a visible document in the user's workspace, which contradicts the rule
that the workspace holds content, not engineering files. The in-product "Working
with AI agents" note and the `plugins/texttext` skills cover the same need.

## Current architecture

Texttext has one document model. Article, note, bookmark, gallery, and talk are
validated presentation templates and capability defaults, not separate content
models.

The implemented rebuild includes:

- Strict schema-versioned `DocumentSnapshot` content and presentation data
- One item-first creation surface on Home and inside every folder for notes,
  links, drafts, and pasted content
- One collection renderer with List, One column, and Cards views for every folder
- Immediate local creation with title, body, and selected look preserved while
  server persistence and capture continue in the background
- Closed render primitives with type-compatible content bindings
- Immutable built-in and workspace template versions
- Constrained AI template operations shared by UI, native assistant, and MCP
- Three-column keyboard-accessible template gallery using real engine previews
- One renderer for app, public links, previews, and HTML export
- Explicit fail-closed `private`, `link`, or `public` visibility
- Revocable guest capability links with viewer, commenter, or editor roles
- Full-document Yjs collaboration with awareness, cursors, selections, offline
  IndexedDB outbox, bounded retry, and epoch fencing
- Structured `.textpack` projection containing `text.md`, `document.json`, and
  package-local assets
- Raw Markdown compatibility for older clients
- App-owned engine and native projection health evaluations
- Request-scoped on-device assistant tools so an item command edits the active
  item instead of accidentally creating a second one
- Retryable sync polling failures with bounded backoff instead of raw 500 errors

The bespoke Reader, ProjectReader, TalkReader, body editor, edit layer, and
editor preview route were removed. Do not reintroduce them.

## Load-bearing contracts

- `src/lib/store.ts` is the only content access boundary.
- Every mutation writes an `action_audit` row.
- Notes and bookmarks remain private and unlisted.
- Missing or unknown visibility is private.
- Template identity and capability declarations never grant access.
- Documents and templates are data only. No user HTML, CSS, JavaScript, React,
  remote code, or arbitrary component names enter the engine.
- Every persisted live or trashed item has a validated schema-v1
  `DocumentSnapshot`. Persisted reads never reconstruct one from legacy columns.
- Raw Markdown and text are explicit import/export compatibility formats.
  Legacy columns are search and old-client projections, not a second document.
- Every render spec passes `validateTemplateDefinition` before rendering.
- A document pins an exact immutable template version.
- File Provider is a durable projection, not the local edit hot path.
- The app renders local Yjs edits immediately and reconciles the network in the
  background.
- The server-mediated relay is the collaboration foundation. P2P is optional
  future transport work only if measurements justify it.
- The UI, in-app assistant, and MCP consume one workspace command contract. The
  app never calls its own MCP endpoint, and the app ships no local listening
  socket.
- Agents on this Mac use the `texttext` CLI. Agents elsewhere use hosted MCP.
- The same creation surface appears on Home and inside folders. It accepts plain
  text, Markdown, or a URL. A URL selects the bookmark look automatically. The
  first nonempty line becomes the initial title and the full pasted text remains
  the document body. For a pasted ChatGPT, Claude, or Codex transcript, the first
  user prompt becomes the title while the full conversation remains intact.
- Article, note, bookmark, gallery, and talk choices in the creation surface are
  looks for the same canonical item. Do not add folder-specific creation forms or
  duplicate folder renderers.
- Never reintroduce `Response.redirect()` in the OAuth approval route.
- Use no em dashes in code, documentation, or product copy.

## Key files

- Canonical model: `src/lib/documents/model.ts`
- Markdown compatibility: `src/lib/documents/legacy.ts`
- Structured sync: `src/lib/documents/sync.ts`
- Visibility: `src/lib/documents/visibility.ts`
- Render schema: `src/lib/presentation/schema.ts`
- Built-ins: `src/lib/presentation/templates.ts`
- Constrained authoring: `src/lib/presentation/operations.ts`
- Renderer: `src/components/document/DocumentRenderer.tsx`
- Unified editor: `src/components/document/UnifiedDocumentEditor.tsx`
- Template chooser: `src/components/document/TemplateGallery.tsx`
- Yjs mapping: `src/lib/collab/document.ts`
- Relay provider: `src/lib/collab/provider.ts`
- Agent presence construction: `src/lib/collab/agent-presence.server.ts`
- Store boundary: `src/lib/store.ts`
- Agent CLI: `mac/Sources/TexttextCLI`, `mac/Sources/TexttextCLICore`
- CLI presence route: `src/app/api/agent/presence/route.ts`
- Native package projection: `mac/Sources/WriteFileProviderKit/TextBundlePackage.swift`
- Migration: `scripts/migrate-unified-documents.mjs`
- Canonical enforcement: `scripts/migrate-enforce-canonical-documents.mjs`
- Canonical audit: `scripts/audit-canonical-documents.ts`
- Release evaluation: `scripts/verify-document-engine.ts`
- Agent surface evaluation: `scripts/verify-agent-interoperability.ts`

## Single-source-of-truth generators

Some lists used to be written out in several languages at once, so retiring one
entry cost several failed releases, each revealing the next stale copy. Where
that happened, one file is canonical and a script regenerates the rest. A
`--check` mode runs inside `npm run verify:release`, so drift fails locally
instead of during a ship.

- Health checks: `WriteHealthChecks.required` in
  `mac/Sources/Write/AppHealthReporter.swift` is canonical.
  `npx tsx scripts/sync-health-checks.ts` writes `mac/health-checks.json`, which
  both `mac/scripts/verify-app-health.sh` and `AppHealthReporterTests` read.

If you add a check, edit the Swift list and regenerate. If you find another
triplicated list, do the same rather than fixing the copies.

## Local database safety

`.env.local` must point to local Postgres `texttext_dev`. Routine development,
tests, builds, and `verify:release` never touch production Neon. Run
`bash scripts/setup-local-db.sh` once if local Postgres is not ready.

Production Neon is touched only by deployed code and release migrations using
`.env.release.local`. Never point `.env.local` at Neon and never run tests or dev
migrations against production.

## Work and release workflow

1. Prove repository root, branch, status, and worktrees.
2. Start one work unit with `npm run work:start -- "short label"`.
3. Work directly on `main` unless another integrator owns the checkout.
4. Preserve unrelated work and batch one coherent change, verifying with focused
   type checks and tests while developing.
5. Commit the coherent unit (do not push yet).
6. Use `npm run verify:release` once, ON THAT COMMIT, as the full exact-source
   gate. The fingerprint hashes the commit id plus the working-tree diff, so
   gating before committing, or with a dirty tree, guarantees a stale receipt and
   a refused ship. If the gate fails, amend the unpushed commit. Never edit a
   tracked file while the gate runs.
7. Run `npm run work:finish`, then push. `release/ship.sh` refuses to start while
   a work unit owns the delivery lane, exiting 75 (a neutral deferral, not a
   failure).
8. Ship meaningful product work with `release/ship.sh`.
9. Verify source, immutable archive, appcast, public marker, website, installed
   bundle version and build, signature, and running app all agree.
10. Add user-facing changes to the in-product changelog, which is exactly
    `Shoku's Space/My Notes/Write Changelog.textpack`. Address it by that path,
    never by title (see AGENTS.md; naming it by title once split the history
    across two notes). The `texttext` CLI writes it.

For OAuth, discovery, or MCP handler changes, also run the bounded OAuth MCP loop
described in `AGENTS.md`.

## Intentional exclusions

Do not invent backlog work for arbitrary HTML, CSS, JavaScript, P2P, full website
generation, or mandatory cloud AI. Those are deliberate first-version cuts.
Continue from the user's newest request.

## Paste into a fresh agent

```text
cd /Users/shokunin/dev/write

Continue Texttext from canonical main and own the work through a shipped,
installed, verified result. First read AGENTS.md, CLAUDE.md, DESIGN.md,
docs/codex/HANDOFF.md, docs/agent-interoperability.md,
docs/plan-document-types.md, and docs/ai-sidebar-architecture.md. Then inspect
live main, status, worktrees, unmerged branches, release metadata, public
marker, appcast, and installed bundle. The handoff baseline was clean commit
a321489 at 0.146 build 152, but live state wins.

There is no unfinished implementation. Take the newest request and deliver it
end to end.

Preserve the canonical document engine and its invariants: store.ts is the only
content boundary, every mutation is audited, notes and bookmarks stay private,
visibility fails closed, templates are validated data, Yjs is the local edit
hot path, File Provider is a projection, the app never consumes its hosted MCP
endpoint, and the app ships no local listening socket. Agents on this Mac use
the texttext CLI; agents elsewhere use hosted MCP. Do not restore bespoke
document types, readers, or the retired loopback MCP server. Use no em dashes.

Start one instrumented work unit. Work directly on main unless another active
integrator owns the checkout. Batch the implementation, run focused checks while
developing, then commit the coherent unit and run the exact-source release gate
once ON that commit. For MCP or OAuth handler changes, run the bounded OAuth MCP
loop too. Push, ship once with release/ship.sh, update the installed app and the
in-product changelog note named in AGENTS.md, verify source, public artifacts,
website, installed version/build, and running behavior agree, and leave main
clean with no temporary refs. Do not stop at a plan, branch, local build, or
handoff.
```
