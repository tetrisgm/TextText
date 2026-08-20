# TextText: the product specification

Owner-ratified 2026-08-14. This file is the constitution: when "should this
exist?" comes up, the answer is here. Anything the pillars do not justify is
out of scope, and code serving no pillar is to be removed. Changes to this
file are owner decisions, recorded with their date.

## What TextText is

A text editor whose documents are textpack files, where an AI works beside
you as a collaborator, and which speaks MCP in both directions so it composes
with every other AI-capable tool. Publishing a beautiful page and
collaborating on it, with humans and agents alike, is part of the product.
Nothing else is.

## Pillar 1: textpack files are the document

- An item is a **`.textpack`** file: a zipped textbundle, the
  Bear/Ulysses/iA Writer interchange format. The text inside is Markdown;
  the file is not "a Markdown file." The container is the document.
- The container carries what is needed to render the designed page - content,
  assets, and presentation - so an opened textpack reads like a well-designed
  page, not raw text. (Direction of travel: the render template ships in the
  bundle; today it lives beside it in the database.)
- Writing in the editor, an agent editing over MCP, and editing the file
  directly (Finder, another editor, a script) are all first-class writes to
  the same document. MCP is a door, not a hallway.
- One validated schema-v1 `DocumentSnapshot` remains the content model and
  the sync fabric; the textpack is its file form. Render specs are validated
  data, never user HTML/CSS/JS.

## Pillar 2: the AI is a collaborator, not a feature

- The rail assistant keeps its provider identity and current document context
  visible. Selection quick actions show a proposed replacement before Apply;
  ordinary freeform turns may change the document directly.
- It lives in the right rail (open by default), knows what you are looking
  at (workspace, folder, item, selection), and acts through the same
  workspace-command surface as every other client.
- Model access is bring-your-own through an Anthropic or OpenAI provider key.
  The standalone Mac edition may also connect an eligible local Codex account;
  TextText never resells inference.

## Pillar 3: MCP in both directions

- **Inbound**: a remote MCP client that accepts a bearer-authenticated server
  connects to the hosted endpoint and works under the workspace's permissions,
  with audit attribution. Claude and Codex on the same Mac normally use the
  signed-in TextText CLI instead.
- **Outbound** (built 2026-08-15): the rail assistant is itself an MCP client. The
  workspace keeps a list of connected external servers; the assistant may
  use their tools with per-connection approval. "Put this spec in Figma" and
  "document what you did into TextText" are the same conversation from
  either end.
- Outbound connections use public HTTPS addresses in this release. Desktop
  loopback MCP endpoints such as Paper, pen.dev, and Figma are not offered in
  Workspace Settings.

## Pillar 4: templates for items and folders, managed by conversation

- **Item templates** define how a document reads and how it edits.
- **Folder templates** define how a collection renders (a blog folder's
  feed, a to-do folder's checklist board) and what its items default to.
- Both are first-class objects you can create, preview, switch, and retire -
  in the UI and by talking to the assistant.
- You create one by MAKING A DOCUMENT and saving it: "Save as look" in the
  document menu, `save_item_as_look` for an agent. Owner ruling 2026-08-15:
  the operations-based authoring API is removed. It needed a procedure and a
  list of rejection rules to use, which is Notion's opposite, and a person
  could not author a look at all.
- Templates are validated render specs. Switching a template never moves or
  mutates content. Retiring one stops it being offered and never deletes a
  version, because documents pin exact versions and must keep rendering.
- The blog kinds are article, **Media post** (video-focused, the shape
  ramine.net publishes), and Video post. Media post renders through the
  gallery node, which gives a video asset a real player. Owner ruling
  2026-08-14: Media post stays. It is an item kind, not a legacy gallery.

## Pillar 5: publishing and people

- Any item can be published to a beautiful public page at a stable link;
  notes and bookmarks stay unlisted; visibility fails closed; the public
  origin is sessionless. A content leak is product-fatal.
- Public pages can bring people in: a reader can be invited into real
  collaboration on the document (the Notion model).
- Multi-human collaboration is core: sharing, live presence, comments,
  attribution - the same machinery the AI collaborator uses.
- One person, several sign-ins: Apple, Google, and email link into a single
  account (`user_identities`); signing in with a second provider connects,
  never forks.

## Platforms

The Mac app and the web are equals. The Mac app is how the product feels
native: documents as real files in Finder, Spotlight, share sheet,
Quick Look. The web is how it collaborates and interops. Features land on
both unless physically platform-bound. Distribution: Developer ID + Sparkle
for daily use, TestFlight for sharing builds; no Mac App Store storefront.

## Explicitly out of scope (owner rulings, 2026-08-14)

- App Store storefront machinery (listing, screenshots, ratings config).
- Guest/anonymous trial workspaces and the claim-on-signup flow.
- One-off migration tooling that has served its purpose (e.g. account-merge
  scripts) - superseded by provider linking above.
- Anything not justified by a pillar. When in doubt, this list wins over
  nostalgia for shipped code.
