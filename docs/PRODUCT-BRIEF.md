# TextText: what the product actually is

Written for an AI collaborator who has never seen this repo, so that it can
reason about the product and propose changes without first reading everything.

**Verified against the code on 2026-09-15**, not summarised from the other docs.
Six readers checked every claim in `docs/SPEC.md` against the implementation:
42 held, 9 were stale, 3 were contradicted. The corrections are folded in below
and the drift is listed at the end.

`docs/SPEC.md` is still the constitution: it decides what *should* exist. This
file describes what *does*. When they disagree, SPEC decides the product
question and this file tells you the ground you are standing on.

## In one paragraph

TextText is a text editor whose documents are textpack files, where an AI works
beside you as a collaborator, and which speaks MCP in both directions so it
composes with other AI tools. Publishing a designed public page and
collaborating on it, with people and agents alike, is part of the product.
Nothing else is. It ships as a Next.js web app at texttext.app and a Mac app
that puts the same documents in Finder as real files.

## The content model, and the three axes people confuse

There is **one content model**: a validated `DocumentSnapshot`, schema version 1,
in `src/lib/documents/model.ts`. It is `.strict()`, and the database enforces it
too, with a CHECK constraint that also forces the document's pinned template id
to match the row's `template_id`. Legacy columns are projected *from* the
snapshot, never treated as a second source.

Three separate axes sit on top of it, and conflating them is the most common
mistake:

1. **Kind** (5, closed): `article`, `media_post`, `video_post`, `note`,
   `bookmark`. Kind decides which folder an item may live in and whether it can
   ever be public. It is not a rendering concept.
2. **Folder mode** (3, closed): `blog`, `notes`, `bookmarks`. One system root
   folder per mode. Mode, not kind, is what the visibility rules key on today.
3. **Look** (open, user-authorable): a validated `TemplateDefinition` that says
   how a document reads and edits. 29 built-ins exist; 11 are in the active
   catalogue (Article, Note, Page, Living brief, Tasks, Project, Bookmark,
   Gallery, Timeline, Case study, Talk) and 18 are retired but still resolvable
   so pinned documents keep rendering. Workspaces author their own on top.

**Item looks and folder looks are one system, not two.** The same
`TemplateDefinition` is used in two positions: pinned to a document, or set on a
folder as its default and index. Any design that treats them as two kinds of
object is working against the code.

Looks are authored by *making a document and saving it* ("Save as look";
`save_item_as_look` for an agent). The older operations-based authoring API was
removed on purpose and has not returned. `create_item_type` / `update_item_type`
build the same object from a blueprint.

**Render specs are data, never markup.** A closed discriminated union of node
types, every member strict, capped at depth 12 and 160 nodes; theme is closed
enums plus one hex-colour regex. There is no raw-HTML node, no component-name
field, no `rehype-raw`, and no `dangerouslySetInnerHTML` anywhere in the render
path. `src/components/document/DocumentRenderer.tsx` is the only consumer.

## The file form

An item is a `.textpack`: a zipped textbundle carrying `info.json`, `text.md`,
`document.json`, `template.json` and `assets/`. A look travels inside it, so a
textpack carried in from another workspace installs its look.

The important qualification: **the textpack is assembled and disassembled
entirely on the Mac.** The server's system of record is a Postgres `jsonb`
column, and the sync API returns a JSON envelope, never a zip. There is no
textpack import or export in the browser at all. When the landing page says
"export your content as portable textpacks", that is delivered through the Mac
mount.

## The AI, and the three agent surfaces

`src/lib/ai/tools.ts` is the single source of truth for the workspace tool
surface. Hosted MCP, the CLI route, both assistants, `/llms.txt`,
`/openapi.json` and the docs all derive from it. It currently defines 41 tools;
do not hardcode that number, derive it.

Three surfaces consume that contract and they are **not interchangeable**:

| surface | route | tools | writes |
| --- | --- | --- | --- |
| hosted MCP (remote agents) | `POST /api/mcp`, bearer | 41 | execute directly, audited; 7 cases staged |
| local CLI (`texttext`) | `POST /api/agent/commands` | 28 of 41; 13 denied | direct, plus a proposal mode |
| in-app rail assistant | in-process | 39 cloud, 41+1 native | every write staged as a proposal the owner approves |

That last row is the one SPEC gets wrong. SPEC says freeform turns "may change
the document directly"; on the web and API-key path they do not. Every write is
a durable proposal approved in the conversation. Direct writes survive only on
the native Mac path. Selection quick actions do show a preview before Accept, as
described.

Model access is bring-your-own: an Anthropic or OpenAI key, or on the standalone
Mac an eligible local Codex account. TextText never resells inference.

Outbound, the rail assistant is itself an MCP client: the workspace keeps a list
of connected external servers and the assistant may call their tools. Approval
is **per call**, as a durable proposal, not per connection. Loopback addresses
are rejected outright by an SSRF gate, so desktop-local MCP endpoints are not a
supported path however much the surrounding code suggests otherwise.

Agent item tokens are **7-day, reusable, revocable bearer credentials**, not the
one-time tokens older notes describe.

## Collaboration and publishing

Collaboration is full-document Yjs with awareness and epoch fencing, a durable
IndexedDB outbox on the client, and materialization and relay routes on the
server. Roles in code are owner / editor / commenter / **viewer** (SPEC says
"reader"; the code does not).

Publishing is narrower than SPEC implies. Only items in a `blog`-mode folder
(article, media post, video post) can be published, to a stable canonical link
that survives renames. **Notes and bookmarks can never be published**, enforced
at every entry point, and visibility fails closed. The public origin is
sessionless. Treat "any publishable item" as the accurate phrasing.

Bringing a public reader into real collaboration is **half-built**, and this is
the highest-value gap in the product. Email invites work end to end. The
link-based half does not: `document_capability_links` is read, redeemed and
revoked correctly by every consumer, but **nothing in the codebase ever creates
a row**. The "share a link, they click, they are in" story is unreachable today
even though everything downstream of it is finished.

## Platforms

The Mac app is a WKWebView shell hosting the same web app, plus the things only
a native app can do: a File Provider extension that puts documents in Finder
under `~/Library/CloudStorage`, Spotlight indexing, a Share extension, Quick
Look previews, App Intents, quick capture, a global hotkey, and a local Codex
adapter. Template and look surfaces are web UI, hosted in that window.

Distribution is Developer ID plus Sparkle for daily use and TestFlight for
sharing builds. There is no Mac App Store storefront, by owner ruling.

## Repo layout and commands

Web app in `src/`: routes and API handlers in `src/app`, UI in `src/components`,
and content access funnelled through `src/lib/store.ts`. Mac app is a SwiftPM
package in `mac/` with no `.xcodeproj`: 11 libraries plus the app and the
`texttext` CLI, with the three extensions in `mac/Extensions/`. Build, sign and
release scripts split between `mac/scripts/` and `release/`.

    npm run dev          web dev server on :3000
    npm run mac:dev      runs the Mac app against that dev server
    npm test             vitest, web
    npm run mac:test     swift test, 9 targets
    npm run ship         owner-invoked release; never automate it

## Known drift, so you do not propagate it

Found while verifying, all in code or docs on `main`:

- `src/lib/store.ts` calls itself "the ONLY content access point". It is the
  sole *write* path for item content, which is the useful invariant, but "only"
  is no longer literally true and nothing enforces it.
- A comment in `src/lib/mcp/protocol.ts` references a `legacy.ts` adapter that
  does not exist.
- `mac/Sources/TextText/LocalMcpBridge.swift` is complete, well documented, and
  referenced by nothing. Reading it alone implies a live loopback capability
  that is not wired up.
- The CLI's own help describes writing through the File Provider mount; its
  default transport is the authenticated sync API.
- A Media post does not automatically render through the gallery node. It
  renders through whatever look its document pins, which in a Blog folder with
  stock defaults is Article.
- Previewing and retiring a look: previewing is a human surface only, and
  retiring is reachable *only* by asking an assistant or MCP client, with no UI
  affordance on either platform.

Two likely bugs, unconfirmed by tests but traced in code:

- Email magic-link identities are written with provider `apple`, because the
  provider is inferred from the subject format and the email format changed.
  That misreports sign-in methods and would block later connecting a real Apple
  identity, given the unique index on (user_id, provider).
- Two of the four move paths lack the folder-mode guard the other two have.
  Privacy still holds because publication is additionally type-gated, but the
  invariant the visibility module is built on is not maintained by all movers.
