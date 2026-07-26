# Texttext continuation handoff

Updated 2026-07-26. This is the only current continuation document.

## Start here

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
  the document body.
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
4. Preserve unrelated work and batch one coherent change.
5. Use `npm run verify:release` once as the full exact-source gate.
6. Run `npm run work:finish` after verification.
7. Commit and push the coherent unit once.
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

Continue Texttext from canonical main. Read AGENTS.md, CLAUDE.md, DESIGN.md,
docs/codex/HANDOFF.md, docs/plan-document-types.md,
docs/review-2026-07-22.md, and docs/ai-sidebar-architecture.md before editing.

Texttext now has one canonical DocumentSnapshot and a closed, data-only
presentation engine. Article, note, bookmark, gallery, and talk are templates,
not separate content models. The old bespoke readers and editor stack were
deleted. Do not restore them. Preserve fail-closed visibility, store.ts as the
only content boundary, audited mutations, notes/bookmarks private, exact
immutable template versions, local-first Yjs editing, structured .textpack sync,
and raw Markdown compatibility.

First inspect live main, worktrees, unmerged branches, release metadata, public
marker, appcast, and installed bundle. Continue only from my newest request. For
product work, start one work unit, work directly on main, verify once with the
receipt-based release gate, commit and push one coherent unit, ship once with
release/ship.sh, update the installed app and in-product changelog, and verify
the complete release. Do not create a feature branch or ask me to integrate it.
Use no em dashes.
```
