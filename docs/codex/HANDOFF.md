# Texttext continuation handoff

Updated 2026-07-29. This is the only current continuation document.

## Start here

There is no unfinished implementation. The last body of work, native agents as
live collaborators, shipped as `0.142` build `148` and passed its end-to-end
acceptance test. Continue from the user's newest request.

One workflow defect worth fixing before it wastes another cycle: the ordering in
"Work and release workflow" below runs `verify:release` (step 5) BEFORE the
commit (step 7), but `release/ship.sh` rejects a receipt whose `sourceCommit` is
not `HEAD`. Committing always moves that commit, so the documented order always
yields a stale receipt and a refused ship, forcing a second full gate run. Either
run the gate on the already-committed source, or teach the ship to accept a
receipt whose source FINGERPRINT matches even when the commit differs.

Read these files before changing product code:

1. `AGENTS.md`
2. `CLAUDE.md`
3. `DESIGN.md`
4. `docs/plan-document-types.md`
5. `docs/review-2026-07-22.md`
6. `docs/ai-sidebar-architecture.md` for assistant or MCP work

Confirm the live state with `git status`, `git worktree list`, and
`git branch --no-merged main`. `main` is the only durable branch and release
source. Do not trust a version number copied from this handoff; inspect generated
release metadata, the public marker, appcast, and installed bundle.

## Live state at this handoff

This is a baseline, not a substitute for inspecting live `main`.

- Canonical source commit: `f23c1d9` (release metadata), implementation in
  `2ca38c1`.
- `main` and `origin/main` were synchronized and the worktree was clean.
- No secondary worktree or branch was left behind.
- Source release metadata, the public marker, the appcast, and
  `/Applications/Texttext.app` were all `0.142` build `148`.

## Completed body of work: native agents as live collaborators

Shipped in Texttext `0.142` build `148` and proven end to end (see the
acceptance test below). The required workflow, all working:

1. Claude, Codex, ChatGPT, or another MCP client finds an exact document.
2. The agent calls `open_item` and Texttext opens the exact workspace, folder,
   and document directly, including after a cold app launch.
3. The agent mutates that document through MCP without manual navigation.
4. The open Texttext document updates live.
5. The agent appears as a named collaborator with its provider icon, color,
   cursor, and selection, like a human collaborator in Notion.
6. Identity and presence remain correct when more than one agent or person is
   connected.

### Already shipped

- Hosted MCP exposes `open_item`, exact item operations, OAuth approval, and
  external-agent focus and presence.
- Native deep-link parsing, exact item opening, and cold-launch URL queuing are
  implemented.
- The native Mac app serves a local MCP endpoint at
  `http://127.0.0.1:47118/mcp`.
- Claude and Codex plugin instructions direct agents to call `open_item`, open
  the returned native URL, and then mutate the item.
- The collaboration UI recognizes ChatGPT, Claude, Codex, Cursor, and generic
  agents and has provider-specific names, icons, and colors.
- Hosted MCP mutations can publish external-agent presence.

### Implemented

The native MCP path now transports caller identity end to end. All ten items of
the former Required implementation section are done:

1. `src/lib/collab/agent-presence.server.ts` is the single presence
   construction site. It canonicalizes with `agentIdentity`, derives a stable
   client ID from the signed-in user ID plus the raw connection name, uses
   `agentProviderColor` with the deterministic `colorForSub` fallback, and
   encodes awareness with `createAgentAwareness`.
2. `src/lib/mcp/tools.ts` builds hosted-MCP presence through that helper; its
   duplicate construction is gone.
3. `src/app/api/collab/[postId]/agent-presence/route.ts` publishes presence for
   the native path. It requires a signed-in editor through
   `getCollabRequestAccess`, derives identity from the SESSION plus the declared
   connection name (so a local client cannot impersonate anyone), places the
   cursor with `agentSelectionAtEnd`, persists presence, signals the workspace,
   and returns no-store. It never mutates content.
4. `src/lib/ai/agent-protocol.ts` defines `WorkspaceAgentActor` and
   `WorkspaceAgentActivity`, and the executor takes an optional actor.
5. `LOCAL_AGENT_BRIDGE_VERSION` is `2` (the actor-carrying bridge).
6. `WorkspaceAgentToolsOptions.signalAgentActivity` signals before `open_item`,
   `update_item`, and `append_to_item`. The edited field is deterministic and
   body-first (body, then title, then subtitle). Signal failures are swallowed.
7. `useNativeAssistant.ts` forwards the actor into the executor and posts
   activity to the agent-presence route; a presence failure never blocks an edit.
8. `LocalAgentServer.swift` retains `initialize.params.clientInfo` name and
   version, keyed by `mcp-session-id` when present and otherwise by a bounded
   user-agent key, falls back to the user agent when a client omits
   `clientInfo`, forwards `bridge.call(name, args, "local-mcp", actor)`, and
   bounds plus expires the identity cache (`identityCacheLimit`,
   `identityCacheTTL`).
9. Focused coverage: `src/lib/__tests__/agent-presence-server.test.ts`,
   `src/lib/__tests__/agent-presence-route.test.ts`, presence-signalling cases
   in `src/lib/ai/__tests__/agent-tools.test.ts`, actor forwarding in
   `src/lib/ai/__tests__/local-agent-bridge.test.ts`, and identity transport in
   `mac/Tests/WriteTests/LocalAgentServerTests.swift`.
10. `scripts/verify-agent-interoperability.ts` (a `verify:release` gate) asserts
    the whole identity chain: bridge version, Swift `clientInfo` retention and
    actor forwarding, the bounded cache, the user-agent fallback, the three
    signal sites, route authorization, and that hosted MCP has not regrown its
    own presence construction.

### End-to-end acceptance test: PASSED on 0.142 build 148

Run against the installed, signed-in app, driven entirely through local MCP with
no manual navigation. Re-run this if the identity chain changes.

1. Initialized `http://127.0.0.1:47118/mcp` with
   `clientInfo.name` of `codex-cli` and, separately, `claude-code`.
2. Found the exact `Texttext Changelog` note
   (`62dcdf1f-434e-427e-a428-8fe765272fdc`, folder `notes`) through `search`.
3. `open_item` navigated the installed app to that exact note.
4. `update_item` prepended the 0.142 entry; the open note showed the new text
   live, with no manual refresh.
5. Presence rows confirmed server-side in `collab_presence`, three distinct
   collaborators on one document:
   - `Codex`, `#111827`, `agent-c80c536faa5a4cf8`,
     awareness `provider:"codex"`, `participantType:"agent"`,
     `selection.field:"body"` (from `open_item`)
   - `Claude`, `#d97757`, `agent-aa2b10e27a4eaaed`,
     awareness `provider:"claude"`, `participantType:"agent"`,
     `selection.field:"title"` (from an `update_item` that changed only the
     title, which is the deterministic field choice working end to end)
   - the human, with no provider and no `participantType`
6. The app rendered both agents as named collaborators with their provider
   icons beside the human avatar, and Claude's cursor appeared in the title in
   its own color, matching its declared selection field.
7. Persistence verified by reading the item back; `action_audit` recorded
   `mcp.update_item`. The mutation and both agents' presence reached the open
   client without a refresh (the client displayed state it did not write).
8. Two distinct identities stayed two distinct collaborators: different stable
   client IDs, names, and colors, with no collapsing.

Scope note: the reader in step 7 was the running app rather than a second
independently signed-in browser, so cross-device delivery still rests on the
release gate's live-client evaluation rather than on this manual run.

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
  app never calls its own MCP endpoint.
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
- Store boundary: `src/lib/store.ts`
- Native package projection: `mac/Sources/WriteFileProviderKit/TextBundlePackage.swift`
- Migration: `scripts/migrate-unified-documents.mjs`
- Canonical enforcement: `scripts/migrate-enforce-canonical-documents.mjs`
- Canonical audit: `scripts/audit-canonical-documents.ts`
- Release evaluation: `scripts/verify-document-engine.ts`

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
   gate. The fingerprint hashes the commit id, so gating before committing
   guarantees a stale receipt and a refused ship. If the gate fails, amend the
   unpushed commit. Never edit a tracked file while the gate runs.
7. Run `npm run work:finish`, then push. `release/ship.sh` refuses to start while
   a work unit owns the delivery lane, exiting 75 (a neutral deferral, not a
   failure).
8. Ship meaningful product work with `release/ship.sh`.
9. Verify source, immutable archive, appcast, public marker, website, installed
   bundle version and build, signature, and running app all agree.
10. Add user-facing changes to the in-product Texttext Changelog note.

For OAuth, discovery, or MCP handler changes, also run the bounded OAuth MCP loop
described in `AGENTS.md`. The current document rebuild extends MCP tools but does
not alter OAuth discovery or approval.

## Intentional exclusions

Do not invent backlog work for arbitrary HTML, CSS, JavaScript, P2P, full website
generation, or mandatory cloud AI. Those are deliberate first-version cuts.
Continue from the user's newest request.

## Paste into Claude

```text
cd /Users/shokunin/dev/write

Continue Texttext from canonical main and own the work through a shipped,
installed, verified result. First read AGENTS.md, CLAUDE.md, DESIGN.md,
docs/codex/HANDOFF.md, docs/plan-document-types.md,
docs/review-2026-07-22.md, and docs/ai-sidebar-architecture.md. Then inspect
live main, status, worktrees, unmerged branches, release metadata, public
marker, appcast, and installed bundle. The handoff baseline was clean commit
5a6ffca, source and installed release 0.141 build 147, but live state wins.

The body of work is "native agents as live collaborators" in HANDOFF.md.
Implement every item in its Required implementation section. The exact gap is
that the native loopback MCP server currently discards initialize.clientInfo,
the page bridge forwards no actor, and local open/edit/append operations publish
no agent presence. Unify hosted and native presence construction, carry the
provider identity end to end, signal activity before local open and mutation,
preserve content mutations when presence is unavailable, and add focused
TypeScript, route, bridge, Swift, health, and release-evaluation coverage.

Completion requires the End-to-end acceptance test in HANDOFF.md. Do not prove
it by manually navigating the UI. Use local MCP to find the exact Texttext
Changelog note, call open_item so the installed app opens that exact workspace,
folder, and note, mutate it through MCP, and capture the app showing the live
content change plus the correct Codex or Claude avatar and cursor or selection.
Repeat with two identities and verify persistence, action audit, and delivery to
a second client without refresh.

Preserve the canonical document engine and its invariants: store.ts is the only
content boundary, every mutation is audited, notes and bookmarks stay private,
visibility fails closed, templates are validated data, Yjs is the local edit
hot path, File Provider is a projection, and the app never consumes its hosted
MCP endpoint. Do not restore bespoke document types or readers. Use no em
dashes.

Start one instrumented work unit. Work directly on main unless another active
integrator owns the checkout. Batch the implementation, run focused checks while
developing, then run the exact-source release gate once. For MCP or OAuth handler
changes, run the bounded OAuth MCP loop too. Commit and push one coherent unit,
ship once with release/ship.sh, update the installed app and the in-product
Texttext Changelog note, verify source, public artifacts, appcast, website,
installed version/build, and running behavior agree, and leave main clean with
no temporary refs. Do not stop at a plan, branch, local build, or handoff.
```
