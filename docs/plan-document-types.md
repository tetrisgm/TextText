# Plan: AI-driven document types

Status: design, not yet started. This is the buildable plan for the third item
in `docs/review-2026-07-22.md` (custom item types). It is meant to be handed to
Codex for a further iteration, so every claim is anchored to a real `file:line`
and every risk carries a concrete fix. The owner iterates on this with Codex
next; nothing here is implemented yet.

Reference products: the vision named "Koda", but that name does not resolve to a
document-type builder. The architecture described (the document as an interface
over structured fields, custom document kinds at the document and page level) is
**Coda**. The purest match to "a first-class Type that owns its fields, its item
look, and its collection view" is **Anytype**. The best AI-authoring pattern is
**Airtable Omni** (the model emits an editable spec, not opaque output). The
distribution loop is **Coda "Copy doc" / Notion "Duplicate"** (a shared type is
just a copyable unit with an owner-controlled copy flag).

## 0. The north star (what this is actually for)

The owner stated the goal plainly, and it sets the priorities for everything
below:

1. **Write documents really fast.**
2. **Give them any shape** you want, by talking with AI or picking a template.
3. **Publish to the internet** when you want, because the document has a link.
4. **Or keep it gated**: reachable by link, or restricted to specific accounts /
   a team.
5. **Import something and make it editable**: bring an external thing in and turn
   it into a first-class document you can reshape, improve, and save.

The spine is 1 to 5, and **collaboration is part of the spine, not a side
feature**: adding people to a document or page and editing together to improve it
is core, and it is in goal 5 verbatim ("edit and collaborate and improve"). What
the owner set aside is the peer-to-peer *transport mechanism*, NOT collaboration
itself. The server-mediated relay is the right mechanism and already partly
exists (the Yjs relay + presence + revision CAS); peer-to-peer sockets do not
remove the server (signaling, TURN relay, persistence, permission enforcement,
offline peers all stay server jobs), so P2P adds complexity, not less, which is
the only thing to avoid. Collaboration is crucial and still has real work to be
solid: make the owner a first-class co-editor, an invite / accept binding step,
live cursors, and close the known between-sessions durability holes (tracked in
the collaboration review and its follow-ups). It is a core parallel track to the
document-types work, and the permission model in section 5 (public link, team,
named writers) is its access half.
Point 5 falls straight out of the content model: because a document is
structured content-data (fields + body + assets), **import is just a capability
that normalizes an external thing (a page, a file, a captured site, a template)
into that model**, after which edit / reshape / publish / gate all work
uniformly. It is bookmark capture generalized. The honest boundary is the render
fork: import brings the CONTENT in cleanly (then shape the look with AI or a
type); it does not clone the source's arbitrary CSS pixel-for-pixel.

---

## 1. The vision, restated in this codebase's terms

Three capabilities, at three altitudes:

1. **Fields.** A document type declares what structured fields it has (a recipe
   has ingredients, time, servings; a review has a rating and a verdict). Today
   the field vocabulary is a fixed frontmatter allowlist and there is no place
   to put a custom field.
2. **Item render.** One document of a type renders in a look that suits it. Today
   the look is one of three hardcoded React readers picked by a ternary.
3. **Container render (folder-as-page).** A folder that holds those documents is
   a page with its own look (a 3-up gallery of covers, a timeline, an index).
   Today a folder has no stored look; the public path uses one blog-wide layout
   and the workspace path uses one of three hardcoded components.

Plus two cross-cutting capabilities:

- **AI authoring and gallery-pick, identically.** A type is a validated JSON
  object. The AI authors one by emitting that JSON; the gallery ships a library
  of the same objects. Picking one and generating one produce the same artifact.
- **Page-level permission.** A container page can be public by link, team-only,
  or shared to named writers. Named-writer sharing on a folder already exists and
  is solid; public-link and team-only do not exist yet.

The bet of the whole product is taste, so the plan deliberately keeps rendering
inside designer-controlled contracts and resists turning the type system into a
programming environment.

---

## 2. The core model: `DocumentType`

One validated object with three sections, generalizing the existing
`validateModeSpec` discipline in `src/lib/modes.ts` (schemaVersion gate, key
allowlist, reject-unknown-keys, rebuild a fresh frozen object, validate the
built-ins at module init, referential-integrity check). This is the pattern to
extend, not replace.

```jsonc
{
  "schemaVersion": 1,
  "id": "type.blogpost",          // stable id, never the display name
  "slug": "blogpost",             // workspace-unique, cannot collide with built-ins
  "name": "Blog post",
  "visibility": "public",         // "public" | "unlisted"  (see section 8)

  // (a) FIELDS: the document's data shape. A constrained JSON-Schema subset.
  //     Every field has a STABLE id (rename changes only the label).
  "fields": [
    { "id": "f_title",    "type": "text",     "label": "Title",    "required": true },
    { "id": "f_subtitle", "type": "text",     "label": "Subtitle", "visibility": "public" },
    { "id": "f_cover",    "type": "image",    "label": "Cover" },
    { "id": "f_body",     "type": "richtext", "label": "Body" }
  ],

  // (b) ITEM: how ONE document renders. An allowlisted layout tree.
  //     Leaves bind a field id by path only. No expressions, no CSS, no code.
  "item": {
    "root": {
      "type": "Stack", "direction": "vertical", "gap": "lg",
      "children": [
        { "type": "Cover", "bind": "f_cover" },
        { "type": "Text",  "role": "title",    "bind": "f_title" },
        { "type": "Text",  "role": "subtitle", "bind": "f_subtitle", "showWhen": "f_subtitle" },
        { "type": "Body",  "bind": "f_body" }
      ]
    }
  },

  // (c) CONTAINER: how the FOLDER-as-PAGE renders its documents.
  //     Reuses the existing ViewSort. A card is an item-tree reused per document.
  "container": {
    "views": [
      { "id": "grid", "layout": "grid", "columns": 3, "gap": "md",
        "sort": [{ "field": "publishedAt", "direction": "desc" }],
        "card": { "root": { "type": "Stack", "children": [
          { "type": "Cover", "bind": "f_cover" },
          { "type": "Text", "role": "title", "bind": "f_title" }
        ] } } }
    ],
    "defaultViewId": "grid"
  }
}
```

The built-in kinds (article, project, talk, note, bookmark) get recast as
`DocumentType` rows so there is one code path, not a ternary plus a registry.
The three sections above are the render half. A type also declares a fourth
part, its **capabilities** (which app-executed verbs it uses, e.g. the bookmark
type declares capture; any type can opt into collaboration), covered in section
3. Capabilities are declared by reference and run by the app, never shipped as
code in the document.

### Field types (the closed level-a vocabulary)

`text`, `richtext` (constrained markdown, the existing body pipeline),
`image`, `date`, `url`, `enum`, `number`, `boolean`, `reference`. Each field
carries `id`, `label`, `required`, an optional `visibility`, and type-specific
constraints. This subset validates a document's data; it is not a layout
language (JSON Schema describes data poorly for presentation, which is why item
and container render are a separate tree).

---

## 3. The safe render-spec grammar (the load-bearing safety design)

This is where the feature is won or lost. Both adversarial passes and the render
research converged on one conclusion: **the render spec must be data that names
what to show, never data that is what to run.** Every prior system that let
authored content reach an evaluator (MDX, unsandboxed templates, loose
deserializers) produced RCE or XSS. The blueprint is Microsoft Adaptive Cards:
a versioned JSON tree of allowlisted primitives where the host owns styling and
content is bound by reference.

### The mental model: a game engine

The clearest frame for this is a game engine. The **engine** is a library of
render primitives (cover, masthead, byline, gallery, prose, card, and whatever
gets added), implemented by us in HTML, CSS, and JavaScript, versioned, and
shipped with the app. A **document type is a game**: it does not carry its own
rendering pipeline, it *refers to* engine primitives and composes them. Primitives
evolve, and every type that uses them inherits the improvement, which is what
makes global restyle work (patch the engine, every document re-renders). This is
the same closed-vocabulary-of-primitives idea as Adaptive Cards and server-driven
UI, in the language the product actually thinks in.

Two rules make the engine model hold, and both come straight from the analogy:

- **HTML and CSS live INSIDE the primitives, not in the per-document layer.** The
  primitives are hand-written by us, trusted, theme-correct. A type author (human
  or AI) composes them; the library emits the HTML. So "the renderer is HTML and
  CSS" is true at the engine level and "a type is data" is true at the authoring
  level, both at once. HTML is not given up, it is relocated into the trusted
  engine.
- **Compose-only, never run-alongside.** A library you *can* use is not a library
  you can *only* use. A game engine gives primitives but does NOT sandbox the
  game: a Unity build is still arbitrary code you would never run from a stranger.
  So a type must be a **composition that can only reference library primitives**
  (config and data), not free HTML/CSS/JS that merely imports the library. The
  instant a type could run code alongside the engine, a shared or gallery-imported
  type is arbitrary code in another user's browser. This single choice is what
  buys taste, consistency, fields, global restyle, safety-when-shared,
  portability, and AI reliability all at once.

Content stays data, not baked HTML: the engine feeds on the document's content
(text, images, typed fields) and compiles it to HTML for three outputs (in-app,
the public URL, and a downloadable self-contained export). HTML is a build
product, never the source, so a global restyle can always reach every document
(a baked-HTML document is frozen and unreachable). See section 4 for where that
content physically lives.

### Two kinds of primitive: render vs capability

The engine provides two categories of thing, and conflating them is a mistake.
A real game engine is not only a renderer; it also ships systems (physics,
netcode, audio, asset loading). A game references those systems and triggers
them; it does not implement them or embed a server in a level file. Same here:

- **Render primitives** are pure and declarative (content + composition -> HTML,
  no I/O, no state, no network). These are what a type composes, and they can
  safely be data in the document.
- **Capabilities (verbs / systems)** are things the app EXECUTES: import-to-
  editable (normalize an external page / file / captured site / template into the
  content model, of which bookmark capture is the first instance: screenshot,
  parse, extract, convert to item format), sync (manifest, change cursor,
  conflict resolution), collaboration (the Yjs relay, presence, revision CAS),
  AI ops, publish-to-feed, search. These live in the app and server, never in
  the document. A type DECLARES which capabilities it uses (the bookmark type
  declares "on create, capture"); it never ships their code.

So a `DocumentType` is really four parts: fields, item render, container render,
and a **capability declaration**. The declaration follows the same compose-only
rule as rendering: name the capability, the app runs it, the document carries no
executable code.

This is also the precise answer to "can collaboration just be JavaScript loaded
in the item?" No. The CRDT *merge algorithm* (Yjs) is portable JS, but
*multiplayer* is getting an edit to another person and back, live, with presence,
durable state, and permission checks, which is irreducibly a shared
server-mediated channel both peers connect to. A file cannot be its own relay,
cannot host presence, cannot be the authoritative store, cannot enforce access.
Even the "just import a library" stacks (y-webrtc, y-websocket, Liveblocks,
PartyKit) are always a client library PLUS a server behind it. Collaboration is
an engine capability the app provides (already built: the collab relay + append
log + presence), invoked when a document is co-edited, not loaded from the file.
The compose-only safety rule seals it from the other side: a document running
loaded JS is the arbitrary-code-in-a-reader's-browser case we ruled out.

### The three closed vocabularies

- **Item layout primitives:** `Stack` (direction, gap, align), `Group`,
  `Cover` (full-bleed image slot), `Field`, `Body` (renders the richtext field
  through the existing sanitized markdown pipeline), `Text` (bound with a
  token-named `role`: title, subtitle, caption, meta), `Image`, `Divider`,
  `Spacer`. Every leaf either binds a field id or is static structure.
- **Container layout:** `Collection` with `layout` in
  `grid | list | gallery | timeline | index | single`, `columns`, `gap`, a
  `sort` (reuse the existing `ViewSort`), an optional `filter`, and a `card`
  sub-template (an item-tree reused per document).
- **Binding:** a leaf references a field by id or dotted path only
  (`{ "bind": "f_cover" }`). The only permitted logic is `showWhen: "<fieldId>"`
  (present-or-absent). No arbitrary expressions, no string interpolation into
  markup, no template string language.

### The safety rules the validator must enforce (all six, from day one)

1. **Allowlist every node `type`.** A node type not in the registry cannot
   render (the server-driven-UI discipline).
2. **Type-check every leaf, not just the node set.** A `bind` / `role` / `text`
   slot that receives an array or object instead of a string is the ProseMirror
   and React-Server-Components type-confusion attack (both shipped CVSS-10 RCEs).
   Coerce-or-reject each leaf; build a fresh object; never spread untrusted
   attrs into a serializer.
3. **The body is sanitized markdown only.** remark to rehype with a URI-scheme
   allowlist (`https:`, `mailto:`; never `data:` or `javascript:`), no raw-HTML
   passthrough, never MDX, never author-supplied component code. Reuse the
   existing `isSafeLinkHref` guard (`content.ts` / `markdown-files.ts:500`) for
   every `image` and `url` field value.
4. **Style props are token names, never raw CSS or color.** `role`, `tone`,
   `gap`, `emphasis` resolve against the existing `tokens.css` and
   `broadsheet.css`. The interpreter applies the DESIGN.md contracts (the 60%
   ink-contrast floor via `color-mix(in srgb, var(--post-accent) 60%, var(--ink))`,
   accent-as-structure-only, the measure widths, the motion rule). A spec can
   pick which accent hue and which slots appear; it can never emit a color or a
   class that floods a surface or breaks the floor. This is what keeps custom
   types theme-correct in both light and dark by construction.
5. **Per-field visibility is honored at render.** A field marked
   `visibility: "unlisted"` can never be bound into a public render. Section 8's
   privacy fix is doc-level; this is the field-level counterpart.
6. **`schemaVersion` is checked first and a build refuses versions it does not
   understand** (no silent tolerance). See section 9 for the version-tolerance
   nuance that avoids a crash-on-boot.

### The gate

`validateRenderSpec` plus its rejection test becomes a release gate the way
`python3 scripts/test-oauth-mcp-loop.py` gates OAuth. The interpreter contract
is: pure data, no I/O, no network, no HTML passthrough, hard bounds on iteration
and nesting, and re-validate on import (never trust a publisher's validation).

---

## 4. Storage, sync, and how a type travels

### The content-format decision

The container stays `.textpack` (a zipped textbundle: `text.md` + `assets/` +
`info.json`), unchanged. Markdown stays as the **body** format: in the engine
model the file must hold content as data the engine feeds on, and for prose,
portable Markdown is the right tool (it round-trips, opens in Bear/Ulysses, and
is what the prose primitive renders). What changes is that a document is no
longer *only* Markdown: it gains **typed fields** (carried as frontmatter, keyed
by stable field id, emitted in a declared order) and a lightweight **`type:`
reference**. Content stays data (text, images, typed fields); it never becomes
baked HTML, because the engine compiles content to HTML as output, and a baked
document would be unreachable by a global restyle. The type definition and its
render composition do NOT live in the file (see below); the file references the
type by slug, and an export writes a resolved snapshot sidecar so the artifact
is self-describing.

### The closed lists a custom field dies at today

Anchored in the format map. A document is always one Markdown file: `---`
frontmatter (each line one JSON scalar or array) plus body.
`renderPostMarkdownFile` (`markdown-files.ts:169-221`) is the sole emitter;
`parsePostMarkdownFile` (`:291-378`) the sole parser. A custom field currently
dies at five closed lists: the parse `switch` allowlist (`:316-369`),
`METADATA_KEYS` (`:271-279`), the `ParsedPostFields` type (`:236-258`), the
`post_type` pgEnum (`schema.ts:34-40`), and the `savePost` write set
(`store.ts:3501-3523`). There is no `metadata` column on `posts` and no jsonb
bag beyond the three strongly-typed ones (gallery, links, capture).

### Where the type definition lives: a `custom_types` table (the render authority)

```
custom_types {
  id, workspace_id, slug, name, visibility,
  schema_version,
  fields jsonb,               // ordered array of field defs
  item_render_spec jsonb,
  container_render_spec jsonb,
  origin_id, origin_version,  // provenance for gallery imports (section 7)
  content_hash,               // immutable snapshot identity
  revision                    // same CAS primitive as posts/folders
}
```

Validated on write by `validateTypeDef` in the spirit of `validateModeSpec`.
This is the authority for both private and shared pages, because of a key
architectural fact from the sharing map: **a shared or public page is not
rendered by the visitor's client from a file. It is server-rendered by the
owner's Next app reading the owner's Postgres through `src/lib/store.ts`.** There
is no path where a non-owner downloads a raw textpack and renders it; the file
endpoints all require a `wsk_` bearer scoped to the owner's blog. So the type
def does not need to travel to a viewer at all: the same server that loads the
post loads its type row and hands the render spec to the interpreter.

### Where per-document field VALUES live: `posts.metadata jsonb`

New column. Holds the values keyed **by stable field id, never the display
name** (see the migration hazard in section 9).

### The frontmatter reference: `type: <slug>` round-trips the file

Two policy flips, both already scoped: add the type slug to the recognized-key
set so `type: recipe` is not shunted to `unknownKeys[]`, and replace the
`post_type` pgEnum with a text column plus a soft ref to `custom_types.slug`.
This mirrors the existing `writeId` / `writeFolderId` / `writeKind` precedent
(`MarkdownIdentity.swift:17-19`), keys the Mac injects locally and strips before
upload (`SyncEngine.swift:1300`): a proven pattern for extra frontmatter that
lives with the file but is handled specially.

### The hazard the sync map surfaced: jsonb key order flaps the hash

The manifest hashes exact rendered bytes (`markdownFileHash`,
`markdown-files.ts:162-163`) and `renderFrontmatter` emits keys in insertion
order. **Postgres jsonb does not preserve key order** (it normalizes to sorted,
deduped keys). If frontmatter emission derives its order from the jsonb, the
Mac writes fields in order A, the server re-renders in order B, the bytes
differ, the hash differs, and File Provider sees a phantom change with no edit.
This is the exact revert-loop class that already burned this project (memory:
`fp-rename-revert-loop-fix`).

**Fix, mandatory before any custom field syncs:** drive frontmatter emission
from the type def's declared field list (an ordered array), rendering only
declared keys in declared order, values re-serialized canonically. Add a
round-trip byte-equality test (web-parse to store to render) mirroring the
existing markdown round-trip test, and make it a gate.

### The parser has no workspace context (why the naive "registry lookup" fails)

`parsePostMarkdownFile(fileText)` takes only a string and throws on any unknown
type via `fieldPostType` (`:420-428`). So a custom-typed file today would fail
to sync entirely, not degrade, and unknown types would default to `blog`
(public) folder mode. **Fix:** thread the resolved type registry into the
parse/render pair as an argument (`parsePostMarkdownFile(text, typeRegistry)`).
Every caller (sync route, MCP `tools.ts`, File Provider ingest) already has the
workspace; pass its registry down. An unknown type resolves to a safe unlisted
fallback kind, never a throw and never `blog`.

### Self-contained export and offline render

For interop (drag a textpack into Bear or another workspace) and future offline
desktop render, write the **resolved type snapshot** into the exported textpack,
and add a `types[]` array to the workspace sync doc (`WriteSyncWire.swift:86-95`
currently carries `blog + folders` only) so the File Provider client can fetch
and cache type defs alongside folders. A type-def change must bump the workspace
change cursor (`schema.ts:119-128`) so clients re-fetch; the AFTER trigger fires
on posts and folders today and would need to cover `custom_types`.

---

## 5. Sharing and the container-as-page

From the container map: a folder is already a page, but through two disjoint
paths with no shared spec seam.

- **Public path:** `t/[handle]/c/[...path]/page.tsx` to `CategoryListing`, whose
  look comes solely from `blog.homeLayout` (`CategoryListing.tsx:264-289`).
  `resolveCategory` hard-gates on `folder.mode !== "blog"` (`categories.ts:105`),
  so only blog-mode subfolders get a public page (the unlisted-forever contract).
- **Workspace path:** `FolderPage.tsx`, whose look comes from a 3-value
  `folder.mode` ternary (`:1355-1411`) plus a browser-local `localStorage` view
  toggle (`WorkspaceViewModeControl.tsx:22-54`), which is not server-persisted,
  not shared, and not a render spec.

`folders.mode` is a free text column (`schema.ts:289`) but every read collapses
it to one of three values via `cleanFolderMode` (`store.ts:1790-1793`), it is
not user-settable (subfolders inherit `parent.mode`, `store.ts:916`), and there
is no jsonb bag on folders at all. To make a folder a container page with its
own look: add a container render-spec reference on the folder (either widen past
`cleanFolderMode` or add `folders.render_spec jsonb` / `folders.type_id`), and
make **both** `CategoryListing` and `FolderPage` render from that one spec.

### Permission: 60% built, two roles missing

Named-people folder sharing is real and solid: `ShareDialog scopeType="folder"`
to `shareScopeAction` (`actions.ts:1389-1420`) to `inviteScopeShare`
(`shares.ts:109-195`), owner/manager-gated (`actions.ts:1350-1375`),
editor/viewer roles, cascading to descendants
(`resolveFolderAccess`, `permissions.ts:454-505`), every mutation audited. The
"add named writers" case maps directly onto this.

Missing:

- **Public-link role.** `ShareDialog`'s "General access" is hardcoded
  "Only people invited" (`ShareDialog.tsx:433-437`); Copy link just copies the
  browser URL and grants nothing. No `public` / `anyone` string exists.
- **Team-only role.** The closest is a workspace-scope `member` grant
  (`permissions.ts:216-224`), which is workspace-wide, not per-folder. There is
  no `folders.visibility` column.

The cascade plumbing is the right foundation to extend a visibility model
(public / team / invited) onto. Permission stays orthogonal to the render spec:
the spec never encodes access, so a type can be shared freely as pure
presentation.

---

## 6. The AI authoring loop (what is actually achievable)

The AI contract is "AI generates specs, never code" and the default layer is
Apple on-device foundation models (roughly 3B class). "Keep tweaking
conversationally with live preview" cannot mean the small local model free-forms
a valid nested render spec every turn; small models drift on nested schema and
invent keys (the exact thing the validator rejects), so every rejected spec is a
dead conversational turn the user watches fail.

The honest, reliable design:

- **The model emits a constrained diff over an existing valid spec** (set field
  X, add view Y from the fixed layout set), not a free-form spec. The
  interpreter's closed vocabulary is the guardrail, not the model's care.
- **Live preview is the validator.** Each turn: model proposes a constrained op,
  `validateTypeDef` / `validateRenderSpec` checks it, and the preview updates
  only on a valid result; on an invalid one the app repairs or rejects locally
  and never shows a broken frame.
- **The floor is on-device-reliable; cloud only widens the vocabulary.** The
  realistic UX is "pick a starting template, then nudge it with words, with a
  visible menu of what is changeable," not "describe any type and watch it
  materialize." Open-ended natural-language type creation belongs to provider
  ladder rung 2 (cloud, tool-calling) and even there is a support-ticket
  generator, so it is a widening, not the floor.
- **Type-by-tagging is the low-commitment entry (Tana / Anytype).** Let a user
  write a plain document, then say "make this a Recipe," and back-fill fields.
  Do not force type selection up front.
- **The type can carry its own AI instructions (Flint Note).** Because the app
  is AI-native, store per-type agent guidance (how to summarize, tag, or render
  this kind) on the type row.

---

## 7. The gallery (fork-to-own): the untrusted-import surface, and why it is last

Read this section together with the phasing correction in section 10. The
interpreter and the gallery are NOT one deferral. The interpreter renders YOUR
OWN AI-authored types on your own content through your own server, so its trust
surface is the same as any other post you write, and it is the heart of the
vision (build it in Phase 2). The gallery is different: it is the point where
**someone else's type definition flows into your workspace**, which is the only
place custom types become untrusted input. That is what makes the gallery last,
not the rendering.

Concrete holes both stress passes raised, all specific to import:

- A shared render spec is remote input executing in other users' reader and
  editor if the interpreter is anything more than pure data. Even pure data
  leaks: unbounded repeat counts are a DoS, a raw-HTML field binding is stored
  XSS, a background-image URL to an attacker host is exfiltration. The closed
  `validateRenderSpec` from Phase 2 already blocks these for your own types; the
  gallery's addition is that it must **re-validate on import**, never trusting a
  publisher's validation.
- Forking plus updates is a supply-chain problem. Silent live updates of a
  shared spec are a standing RCE-shaped surface. Imports must be pinned
  snapshots (copy bytes, never live-link), and every update re-runs the full
  import validation and is opt-in with a visible diff.
- Slug collisions and provenance: a built-in slug like `article` must be
  reserved; imported types need `origin_id` + `origin_version` + an immutable
  content hash; sharing and MCP resolve types by workspace and id, never by bare
  slug (two workspaces' "same" slug can diverge in fields).

Recommendation: **the public fork-to-own gallery is the last phase, gated on
import re-validation + pinned snapshots + provenance.** This is a moderation and
supply-chain program, so it opens only after the type system is allow-list-safe
(section 8) and the closed-vocabulary interpreter (section 3) is shipped and
gated. Deferring the gallery does NOT defer the interpreter; the interpreter for
your own types comes first, in Phase 2.

---

## 8. The non-negotiable prerequisites (do these BEFORE any type is user-definable)

Both adversarial passes independently flagged this as the single most likely way
the feature ships a leak. **Privacy today is a denylist, so every custom type is
public by default**, decided by no line of code:

- `PRIVATE_POST_TYPES = ["note", "bookmark"]` (`content.ts:60`) and
  `isPrivatePostType` (`content.ts:63-66`).
- Public exposure filters as `!isPrivatePostType(p.type)`
  (`store.ts:514`, `:541`).
- `folderPathForPostType` sends anything unknown to `blog`, the public folder
  (`store.ts:821`).
- The same two literals are re-hardcoded on the public page
  (`t/[handle]/[slug]/page.tsx:93-95`, `:277-280`) and a THIRD time in the
  OG-image routes (`opengraph-image.tsx:25-26` on both `t` and `u`).

A novel type like `journal` flows into every one of these as not-private, so it
publishes, feeds, and gets an OG card the instant it exists.

**Prerequisites (a leak-prevention checklist, not a feature; do these even if
custom types slip):**

1. **Flip to an allow-list.** Publishability is a positive property on the type
   def (`visibility: "public" | "unlisted"`). Rewrite `isPrivatePostType` as a
   registry lookup where **an unknown or unresolvable type defaults to
   unlisted** (fail-closed). Collapse the four-plus duplicated denylists into
   that one function and delete the inline literals in the page and OG routes.
2. **`folderPathForPostType` default is a non-public quarantine**, not `blog`.
   Unknown routes to the notes-equivalent unlisted bucket.
3. **The markdown kind-mapping fall-through throws or quarantines**, never
   coerces an unknown type to a public blog kind
   (`markdown-files.ts:86-96`, `:116-120`).
4. **Every registry mutation (create, fork, update, install) writes
   `action_audit`** and goes through `store.ts`, never a side channel. An
   unlogged capability change is the audit hole.
5. **A public-route test:** an anonymous GET of a custom-typed unlisted doc must
   404 and its `opengraph-image` must return empty, asserted against the
   registry predicate, not a literal type list.

---

## 9. Versioning and migration

The revision and CAS machinery is already monotonic, so most of this comes free,
but two traps are sharp:

- **Crash-on-boot from a strict version gate.** `validateModeSpec` pins
  `schemaVersion === 1` and rejects any other version outright
  (`modes.ts:201-205`), with the built-ins fed through it at module init
  (`:246`). A `validateTypeDef` "in the spirit of" it inherits that: bump to
  version 2 and every stored v1 spec throws at load, crashing the app on boot
  unless all specs are rewritten atomically. **Fix:** make `validateTypeDef`
  version-**tolerant**: accept `1..N` and upgrade older specs through explicit
  migrators, never reject a known-older version.
- **Field rename silently drops data.** `metadata` keyed by field name means a
  rename orphans every existing post's value. **Fix:** key `metadata` by a
  stable field **id** so a rename is a label-only change; make field removal a
  soft tombstone, not a destructive drop; stamp each post with the `type_version`
  it was authored against and render old docs through a compat path.
- **Add-only within a version.** An additive change (new optional field, new
  view) renders old docs immediately with the field simply absent, no backfill.
  A breaking change mints a new `schema_version` (or a new row); existing docs
  keep referencing the old one, the way `slugHistory` (`schema.ts:358-362`)
  preserves old identity rather than rewriting it.
- **Concurrency.** A `custom_types` row carries the same `revision` / CAS as
  posts and folders (`schema.ts:301-303`, `406-408`) so two agents editing one
  type def conflict with a 412 instead of clobbering. A type-def change bumps the
  workspace change cursor so cached clients re-fetch.

---

## 10. Phasing: build the interpreter, sequence it behind two walls

The review's original 1 to 6 order front-loads the enum-to-registry migration
and touches the privacy invariants first, which is the highest-risk,
lowest-visible-value place to start. The correction is a sequencing one, not a
cut: the AI-authored render interpreter IS the vision (describe how a document
looks, keep tweaking it, then describe the container page), so the plan builds
it. What must precede it is two safety walls, and what genuinely comes last is
the PUBLIC gallery, because import is the only place a type becomes untrusted
input.

Two claims must be kept apart, because an earlier draft of this doc conflated
them:

- **The interpreter on your own types is tractable and is the goal.** A custom
  type you author (or the AI authors) in your own workspace renders on your own
  content through your own server. Its trust surface is identical to any other
  post you write. The closed, token-only render vocabulary (section 3) means a
  spec can only recompose the primitives the designer already built, on the
  existing tokens, with the DESIGN.md contracts (60% ink floor, accent rule,
  measure, motion) applied BY the interpreter. So the interpreter does not
  trade away taste the way a pixel-canvas would: every output is inside the
  design system by construction. The one thing it cannot do without new React
  is a genuinely novel body BLOCK (a recipe ingredient table); recomposition of
  existing primitives, which is what "make my posts look this way" needs, is
  fully in reach.
- **The public gallery is a moderation and supply-chain program, and it is
  last.** Not because rendering is risky, but because importing a stranger's
  spec is (section 7).

Fixed-layout curated types are a de-risking stepping stone for the field and
sync plumbing, not the destination; the earlier "80% of the value" framing
oversold them. `modes.ts` is still the model to generalize (a fixed five view
primitives, each real code), but the interpreter grows past it rather than
stopping there.

**Build order:**

- **Phase 0 (wall 1, ship even if the rest slips): fail-closed privacy.**
  Section 8 in full. Invert to an allow-list, quarantine unknown-type folder
  routing, make the kind-mapping fall-through non-public, one fail-closed
  predicate replacing the four-plus denylists, plus the public-route test. No
  custom type ships until this lands.
- **Phase 1: typed fields plumbing (de-risk sync/round-trip).** Add a `fields`
  schema and `posts.metadata jsonb` (keyed by field id), a `validateTypeDef`
  strict reject-unknown validator, declared-field-ordered frontmatter emission,
  and the round-trip byte test. Recast the built-ins as `DocumentType` rows and
  replace the 5-site renderer ternary with a `rendererForType(type)` registry
  (dispatch sites: `t/[handle]/[slug]/page.tsx:289`, `t/[handle]/page.tsx:276`
  and `:534`, `PostWorkspaceShell.tsx:3496`, `PostEditLayerClient.tsx:1562`).
  Optionally ship one or two curated fixed-layout types here to prove demand
  while the interpreter is being built. No spec is interpreted yet, so this
  stays on safe ground.
- **Phase 2 (wall 2 + the vision): the interpreter for your own types.** Define
  the closed render-spec grammar (section 3) and its `validateRenderSpec` gate
  (wall 2, must exist before any spec renders), then build the `SpecReader` that
  interprets item AND container specs into the existing primitives. This is the
  whole vision, all on your own AI-authored types:
  - item render from a spec (the readers already expose a half-built `slots`
    seam a `SpecReader` fills);
  - the container-as-page: one render path both `CategoryListing` and
    `FolderPage` read from, driven by a spec on the folder, plus the public-link
    and team-only visibility roles on the existing collaborator cascade;
  - the AI authoring loop: constrained nudges over a valid spec, validated every
    turn, preview-as-validator, on-device floor and cloud widening (section 6).
- **Phase 3 (last, untrusted import): the public fork-to-own gallery.** Import
  re-validation, pinned snapshots, provenance, diff-before-update, moderation
  (section 7). This opens only after Phase 2 is shipped and gated.

The sequencing is deliberate: the two walls (fail-closed privacy, closed
`validateRenderSpec`) make the interpreter safe for your own content, and the
gallery's untrusted-import surface is the only thing that waits for a later
phase.

---

## 11. File-level touch points (the map)

Render and dispatch:
- `src/components/{Reader,ProjectReader,TalkReader}.tsx` (the three readers; each
  already exposes a half-built `slots` seam a `SpecReader` would fill), `PostCard.tsx`,
  `PostByline.tsx`, `ProjectGallery.tsx`.
- The renderer ternary duplicated at 5 sites (listed in Phase 2).
- `src/styles/{tokens.css,broadsheet.css,cards.css,project.css,talk.css}` and
  `DESIGN.md` (the contracts the interpreter must apply, never let a spec set).

Format, storage, sync:
- `src/lib/markdown-files.ts` (sole emit/parse; the five closed lists; the
  `type:` reference flip; declared-order emission; thread the registry into
  parse).
- `src/lib/db/schema.ts` (the `post_type` pgEnum to reopen; new
  `custom_types` table; `posts.metadata jsonb`; `folders.render_spec` or
  `type_id`; the change-cursor trigger).
- `src/lib/store.ts` (the single content access point; `savePost` write set;
  `mapPost` read set; `cleanFolderMode`; `folderPathForPostType` quarantine;
  registry mutations must live here for audit).
- `src/lib/mcp/tools.ts` and `src/lib/ai/tools.ts` (unknown-key handling; the
  `.strict()` schemas and closed `itemKind` enum to widen).
- Mac: `WriteSyncWire.swift` (add `types[]` to the workspace doc),
  `TextBundlePackage.swift` (resolved snapshot on export),
  `MarkdownIdentity.swift` and `SyncEngine.swift:1300` (the strip-before-upload
  precedent for the `type:` reference).

Container and sharing:
- `src/components/{FolderPage,CategoryListing}.tsx`, `src/lib/categories.ts`
  (the blog-mode-only public gate), `src/lib/permissions.ts` (the cascade to
  extend with visibility), `src/lib/shares.ts`,
  `src/components/workspace/ShareDialog.tsx` (add public-link and team-only),
  `src/app/editor/actions.ts` (the share gate).

Validation and gating:
- `src/lib/modes.ts` (the validator pattern to generalize into `validateTypeDef`
  and `validateRenderSpec`).
- A new render-spec rejection test as a release gate, alongside
  `scripts/test-oauth-mcp-loop.py`.
- Privacy: `src/lib/content.ts` (`isPrivatePostType` to invert), the public page
  and OG routes holding duplicated literals to delete.

---

## 12. Open questions for the Codex iteration

1. Do the built-in kinds (article, project, talk, note, bookmark) get fully
   recast as `DocumentType` rows in Phase 1, or do they stay native with only
   custom types going through the registry until later? Recasting is cleaner but
   touches the hottest render paths.
2. Container render: widen `folders.mode` past `cleanFolderMode`, or add a
   dedicated `folders.render_spec` / `folders.type_id`? The latter is less likely
   to collide with the three system modes.
3. `posts.metadata`: `jsonb` (need declared-order emission regardless) or `json`
   (preserves key order but loses jsonb query ability)? Declared-order emission
   makes `jsonb` safe, so this is really "do we ever need to query into
   metadata."
4. Field `reference` type: in-workspace only for v1, or cross-workspace later?
   Cross-workspace references interact with sharing and provenance.
5. How much of the type def travels in the exported textpack snapshot: the full
   resolved spec, or a minimal shape sufficient for Bear-style interop? Full is
   more self-contained; minimal is smaller and less to keep in sync.
6. Where does per-type AI instruction live and how is it scoped (workspace,
   shared with the type on import)?

---

Grounding: this plan was assembled from a nine-agent design pass (three code
readers over the render, format, and container seams; two research agents over
document-type products and safe-render-spec prior art; two adversarial
stress-tests). The stress-test corrections are treated as the winning
constraints on safety wherever they conflict with the first-pass design, which
is why the fail-closed privacy allow-list is Phase 0 and the closed
`validateRenderSpec` gate precedes any rendered spec. The interpreter itself is
NOT deferred: it is the vision, built in Phase 2 on your own AI-authored types
once those two walls exist. Only the public fork-to-own gallery waits for a
later phase, because import is the one place a type becomes untrusted input.
Baseline context: `docs/review-2026-07-22.md`.
