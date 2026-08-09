# TextText unified document architecture

Status: implemented on `main`. This document is the architecture contract for
the unified document engine, not a future feature plan. The dynamic
document-types wave (2026-07-29) extended it: see "Wave-1 primitives" below.

## Product contract

TextText has one document model. Article, note, bookmark, gallery, and talk are
presentation templates and capability defaults, not separate content types.

The product must preserve these outcomes:

1. A local edit is visible immediately and remains usable offline.
2. A document can change its look without rewriting its content.
3. A document can publish publicly, remain reachable by an unlisted link, or be
   restricted to named people, a team, or a revocable guest link.
4. Imported content becomes editable data, including locally stored assets.
5. Multiple people can edit the same content without last-write-wins data loss.
6. The engine, not a document, owns executable code.
7. Existing Markdown clients continue to work while structured clients preserve
   the complete document.

## Canonical document

The canonical value is `DocumentSnapshot` in
`src/lib/documents/model.ts`:

```ts
type DocumentSnapshot = {
  schemaVersion: 1;
  content: {
    title: string;
    subtitle?: string;
    body: string;
    fields: Record<string, string | number | boolean | null | string[]>;
    tags: string[];
    assets: Array<{
      id: string;
      kind: "image" | "video" | "audio" | "file";
      src: string;
      alt?: string;
      caption?: string;
      contentType?: string;
      width?: number;
      height?: number;
    }>;
  };
  presentation: {
    template: { id: string; version: number };
    theme: ThemeTokens;
  };
};
```

Content and presentation are deliberately separate. A presentation edit never
changes title, body, fields, tags, or assets. A content edit never invents a
template.

The old `Post` fields remain a compatibility projection for listing, search,
feeds, and older clients. `src/lib/documents/legacy.ts` is the only conversion
layer. Compatibility `type` is never derived from a custom template, because a
look must not change privacy or folder behavior.

## Portable file format

Every TextText item is represented as a `.textpack`. Its package contains:

```text
Document.textpack/
  info.json
  text.md
  document.json
  assets/
```

`text.md` is the human-editable Markdown projection. `document.json` is the
strict structured snapshot. Assets are package-local. The Finder projection
uses the package as a single tidy item.

The sync protocol in `src/lib/documents/sync.ts` uses the versioned media type
`application/vnd.texttext.document+json`. Structured clients transfer a strict
envelope containing both Markdown and the document. Older clients continue to
send and receive raw Markdown.

When an external editor changes `text.md`, explicit Markdown title, body, and
known frontmatter values win. Structured fields not represented in Markdown,
assets, and presentation remain intact. Unknown frontmatter never becomes a
render instruction. Deterministic key ordering prevents hash churn.

The native implementation in `mac/Sources/TextTextFileProviderKit` materializes and
uploads `document.json`, rewrites remote asset URLs to package-local paths, and
selects the structured document hash when available. Legacy Markdown-only
packages remain valid.

## Presentation engine

### Primitive boundary

A primitive is a trusted engine implementation selected by a closed `type`
discriminator. A document or template supplies validated bindings and tokens,
not React, HTML, CSS, selectors, scripts, event handlers, URLs to code, or raw
style strings.

The closed render node vocabulary is defined in
`src/lib/presentation/schema.ts`:

- Layout: `stack`, `group`, `masthead`, `divider`, `spacer`
- Text: `text`, `prose`, `byline`, `metadata`
- Media: `cover`, `image`, `video`, `gallery`

A representative primitive declaration is:

```ts
{
  type: "cover",
  id?: "hero",
  bind: "content.fields.cover",
  alt?: "content.title",
  showWhen?: "content.fields.cover",
  fit: "cover" | "contain",
  height: "compact" | "medium" | "large" | "viewport"
}
```

Bindings can only address declared content paths. The validator checks that a
primitive can consume the bound field kind. For example, a gallery can consume
`content.assets`, while an image cannot consume a number.

### Template definition

A `TemplateDefinition` has four parts:

```ts
type TemplateDefinition = {
  schemaVersion: 1;
  engineVersion: 1;
  id: string;
  version: number;
  name: string;
  description?: string;
  fields: DocumentFieldDefinition[];
  item: RenderNode;
  collection: {
    layout: "list" | "cards" | "timeline" | "index" | "single";
    columns: 1 | 2 | 3 | 4;
    gap: SpacingToken;
    sort: SortRule[];
    item: RenderNode;
  };
  capabilities: Capability[];
  theme: ThemeTokens;
};
```

Capabilities are declarations for app-owned verbs: assets, capture,
collaboration, comments, import, publish, and search. A declaration can expose
or hide product controls. It does not grant permission and cannot execute code.
Permissions are always resolved below the tool and UI layers.

The built-ins in `src/lib/presentation/templates.ts` are the first five rows of
the same model: article, note, bookmark, gallery, and talk. Built-in identifiers
are reserved and immutable.

### Validator

`validateTemplateDefinition` is the render gate for built-ins, database rows,
AI output, MCP output, previews, readers, and export. It enforces:

- Strict objects with no unknown keys
- Closed primitive, field, capability, token, and layout vocabularies
- Declared and type-compatible bindings
- Unique field ids, enum values, capabilities, and node ids
- Maximum 12 levels, 160 nodes, 80 fields, and 40 children per container
- Versioned engine and schema contracts
- No HTML, CSS, JavaScript, arbitrary component names, or arbitrary URL fetches

No invalid template reaches `DocumentRenderer`.

### Compilation targets

`src/components/document/DocumentRenderer.tsx` is the common compiler for the
interactive app and public route. It resolves bindings, sanitizes links and
media sources, renders Markdown without raw HTML, and applies only engine CSS.

`src/lib/presentation/export.server.tsx` uses the same renderer and engine CSS
to produce standalone HTML. Exported asset references are resolved from the
package by the export workflow. There is no second presentation implementation.

The same template version therefore controls:

- In-app reading
- Public and capability-link routes
- Folder item previews
- Template gallery previews
- Server HTML export

## Template authoring

Templates are immutable, workspace-scoped versions in `document_templates`.
Built-ins ship in code. A gallery selection pins an exact template reference on
the document. A customized template uses a workspace-owned id and creates the
next immutable version. Existing documents never change presentation merely
because a newer version exists.

AI does not emit an entire executable page. It emits at most 32 constrained
operations from `src/lib/presentation/operations.ts`:

- Set name or description
- Set capabilities
- Replace the declared field list
- Set closed theme tokens
- Replace the item composition
- Replace the collection item composition
- Set collection layout and columns

Every operation is applied to the previous valid template and the complete
result is validated before the next operation. A failed step changes nothing.

The UI assistant, workspace-configured provider, and MCP all consume the shared
tool definitions in `src/lib/ai/tools.ts`. They execute through the same
workspace command boundary. The app never calls its own MCP endpoint.

The configured provider selects a base template and emits bounded token or
composition operations. Preview is a real render through the validator, not a
picture or generated HTML. More capable models can propose broader operation
sequences and research content, but receive no wider render authority.

## Template gallery

`src/components/document/TemplateGallery.tsx` presents three columns when space
allows, does not preselect a look, and previews the current document through the
actual engine. Arrow keys move spatially, Enter previews or confirms, and Escape
or Backspace returns. Selecting a look updates presentation only.

Imported gallery templates are always forked into a workspace-owned immutable
version before use. Import never inserts a database definition without strict
validation.

## Privacy and access

Privacy is explicit and fail-closed. `posts.visibility` is one of `private`,
`link`, or `public`, with `private` as the database and application default.

`src/lib/documents/visibility.ts` is the common resolver:

- Missing visibility is private.
- Note and bookmark compatibility items remain private even if public is
  requested.
- A template id or capability declaration never changes visibility.
- Public listings and adjacent navigation select only explicit public rows.
- Folder membership, not template kind, controls containment.

Named account and team permissions continue through the item access model.
Revocable document capability links add viewer, commenter, or editor access for
guests. Only a SHA-256 token digest is stored. The access route exchanges the
secret link for an HTTP-only scoped session cookie. Every capability creation,
revocation, use, template mutation, and content mutation is audited through
`src/lib/store.ts`.

## Collaboration

Yjs is the merge model. It is independent of transport. The canonical Y document
maps title, subtitle, body, fields, assets, tags, and presentation in
`src/lib/collab/document.ts`.

The current baseline transport is the server-mediated relay in
`src/lib/collab/provider.ts` and `src/app/api/collab`:

- Local Yjs mutations render immediately.
- Updates enter an IndexedDB outbox before network success is required.
- A bounded retry loop drains updates with epoch fencing.
- Polling applies remote updates and materializes canonical document state.
- Awareness carries user identity, cursor, and selection.
- Owner, named editor, and guest editor sessions join the same document.
- Access loss stops the loops instead of retrying forever.
- Epoch retirement discards stale-generation edits rather than merging them
  over an authoritative reset.

The server remains authoritative for persistence, access, publication, and
revision fencing. A local or peer fast path can implement the transport
interface later if measurements justify it. P2P is not a dependency and is not
part of the first version.

Template definitions sync as immutable workspace records, not character-level
CRDT state. A document pins `{id, version}`, so concurrently created later
versions do not mutate an open document.

Collaboration has three app-owned evaluators:

- `scripts/verify-collaboration.ts` is the fast deterministic release check. It
  makes browser, native Mac, agent, and delayed offline clients edit one
  document, exchanges updates in different orders, replays the offline update,
  and requires identical content and state vectors. It also proves awareness
  for all four clients and token-level presentation merging.
- `npm run eval:collaboration:live` is the destructive local soak. It uses a
  scratch local Postgres workspace and the real relay, presence, materializer,
  revision fence, store boundary, and audit log. It removes every scratch row
  in a `finally` block and reports content-blind counts and timings only.

- `npm run eval:collaboration:browser` is the live participation proof. It
  starts the built server, signs in two dev-login accounts as two real people,
  shares one item between them, and drives two Chromium browsers plus a real
  agent. It asserts what a person can SEE rather than what converges: that each
  human's caret paints in the other's browser under their own name, that an
  agent joins the same presence row as a named collaborator with a caret of its
  own, that an agent's create, update, and append land in an already-open
  editor with no reload, that an agent write reaches BOTH humans while they are
  both typing without losing anyone's words, and that a right-sidebar assistant
  edit is indistinguishable from a human's. It kills its server in a finally
  block and writes screenshots for the record.

The release check catches deterministic merge regressions without network or
database variability. The local soak proves the full persistence path when
collaboration or sync code changes. The browser proof is what catches a
regression that converges correctly and still shows a person nothing.

## Performance contract

The browser editor operates on a preloaded local document and does not navigate
to enter edit mode. The target budgets are:

- Keystroke to local paint p95 below 32 ms
- Cached item open below 100 ms
- Edit toggle without a document reload
- Network, capture, materialization, and presence updates never replace a newer
  local value

File Provider is a durable projection and interoperability surface, not the edit
hot path. Server refreshes reconcile by revision and cannot blindly overwrite an
active local Y document.

## Migration and compatibility

`scripts/migrate-unified-documents.mjs` is additive and idempotent. It adds
canonical document, explicit visibility, exact template reference, immutable
template versions, guest capability links, relative comment anchors, and collab
awareness/baseline columns. Existing rows are backfilled into schema version 1.
Existing published articles, projects, and talks remain public; notes and
bookmarks remain private.

`scripts/migrate-enforce-canonical-documents.mjs` then makes the canonical
snapshot mandatory for every live and trashed row. The database rejects a
missing or structurally invalid snapshot, and the release audit validates the
full schema plus all search projections. Persisted reads fail loudly instead of
synthesizing a document from compatibility columns.

During the client compatibility window:

- Structured clients use the versioned document envelope and document hash.
- Old clients use raw Markdown and Markdown hash.
- Writes update both canonical document and legacy projection atomically through
  `store.ts`.
- Raw Markdown and text imports are converted explicitly at the write boundary.
- Compatibility columns are indexes and old-client projections, not a second
  stored document.

Legacy bespoke readers and editor layers were removed after all routes moved to
the unified renderer and editor. They must not be reintroduced.

## App-owned verification

`scripts/verify-document-engine.ts` is a deterministic release evaluation. It
proves built-in validation, constrained authoring, safe HTML compilation,
deterministic sync projection, fail-closed privacy, and concurrent Yjs merging.

The Mac health reporter includes:

- `workflow.document_engine` for the server evaluation
- `workflow.collaboration` for deterministic four-client convergence
- `selftest.document_projection` for native `.textpack` document and asset
  round-trip

The release gate runs these checks with the normal web, native, and sync suites.
Results are uploaded by the existing app health pipeline. The real-relay
collaboration soak stays out of the fast ship path and runs against the local
database when relevant collaboration code changes.

## Explicit first-version cuts

The following are deliberately outside the engine contract:

- Arbitrary user HTML, CSS, JavaScript, React, or remote code
- Full websites or pixel-perfect cloning
- General-purpose arbitrary file synchronization
- P2P as the persistence or permission foundation
- Character-level collaborative editing of template definitions
- A distinct database content model per presentation

The gallery can produce valid looks without AI. A connected provider or an
external agent can propose constrained changes through the same command surface.

## Dependency order for future engine changes

Changes follow dependencies rather than marketing phases:

1. Extend the strict schema and validator.
2. Add the trusted primitive implementation and engine CSS.
3. Add deterministic renderer and export coverage.
4. Extend the constrained operation grammar if AI must control it.
5. Add storage and sync migration only if the content shape changed.
6. Add app-owned health coverage.
7. Expose the capability in gallery, UI, assistant, and MCP from the shared
   command surface.

No new primitive or field ships if privacy, offline projection, export, or
collaboration cannot preserve it.


## Wave-1 primitives (2026-07-29)

Grounded in an 8-domain research sweep of text-based document types and the
Notion and Coda galleries, synthesized into a primitives matrix and reviewed
adversarially. What shipped:

Field types: `rows` (an array of typed records; sub-fields are scalars, max 8,
no nesting), enum options with `tone` (closed six-value engine tint) and `icon`
(one emoji) plus field-level `multiple`, and number `format`
(plain, currency, percent, minutes, rating).

Render nodes: `badge`, `facts`, `checklist`, `rows` (table, steps, timeline,
tiles), `progress`, `callout`, `quote`. Inside rows-bound nodes bindings use
the `row.*` namespace, validated against the exact rows field the node binds.

Collections: sort by `content.fields.<id>` and declarative `filters`
(eq, neq, isSet, notSet, gt, gte, lt, lte, contains), applied identically by
SQL (GIN jsonb_path_ops index) and in process
(`src/lib/documents/collection-query.ts`).

Catalog: 23 built-in templates in six categories (Text, Plan, Track, Collect,
Work, Publish), every one validated at module load. `TEMPLATE_CATALOG` in
`src/lib/presentation/templates.ts` is the grouping.

Deliberately deferred: response records (polls, RSVPs need a server-side
respond command), calendar and heatmap layouts, derived-value bindings, auto
table-of-contents and backlink chrome, per-template seed content.
