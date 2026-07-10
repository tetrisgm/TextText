# Assistant sidebar architecture

The assistant should manipulate the same file-backed workspace model as the
rest of Write. It should not call Write's MCP server from inside Write.

## One command surface

Define workspace commands once at the domain boundary. Commands receive an
explicit workspace, folder, item, selection, and actor context. They return a
previewable change set before mutating Markdown files, media, or folder
metadata.

Examples:

- create, rename, move, restore, and delete folders or items
- read and replace a document or a selected range
- attach or replace local media
- change folder view and post presentation metadata
- search the web, save sources, and insert attributed Markdown

The native and web UI call this command surface directly. An AI provider
adapter turns model tool calls into the same commands. The MCP server exposes
the same commands to external clients. This keeps MCP as an interoperability
adapter instead of making the product depend on its own network protocol.

## Context

Every assistant request carries a stable context envelope:

```text
workspace id
folder id and mode
active item id
selected Markdown range, if any
visible item ids and current search/filter
attachment ids
```

The sidebar context chip is only a summary of that envelope. Item IDs, not
titles or routes, remain authoritative while content is renamed or moved.

## Providers

Provider configuration belongs in workspace settings. A provider adapter
supplies authentication, model selection, streaming, and tool-call transport.
Initial adapters can support OpenAI and Anthropic APIs. An external MCP client
is a separate connection path and does not replace the in-app provider.

No provider secret is written into a Markdown folder. The web app stores
server-managed credentials; the native app can use Keychain-backed secrets.

## Safety and collaboration

Read-only requests can stream immediately. Mutating requests produce a local
optimistic change set, save through the normal file transaction path, and
remain undoable. Destructive or broad multi-item operations require a concise
preview and confirmation. Collaboration events are emitted by the same save
transaction, so AI edits and human edits share conflict handling and history.

This also leaves a clean path to a Mac folder workspace: the domain command
surface can target a local filesystem adapter, while the web product targets
the current server-backed file store.

## How Paper does it (studied 2026-07-10, paper.design/docs/mcp)

Paper is desktop-first, so its answer is a machine-local MCP server hosted by
the app itself: streamable HTTP on 127.0.0.1:29979/mcp, no credentials, scoped
to "the currently opened file". Their tools are the app's domain operations
(read the node tree, screenshot, write_html, update_styles, batch renames),
and agent edits appear live in the document. Two details worth copying:

- Distribution: they publish an agent-plugins marketplace repo
  (paper-design/agent-plugins) plus copy-paste configs for Claude Desktop,
  Claude Code, Cursor, Copilot, Codex, and others. Their AI story is "bring
  your own agent; we are the tool surface." They do not document an in-app
  chat, and nothing suggests their app consumes its own MCP server.
- Presence: a finish_working_on_nodes tool clears a visible "agent is working
  here" indicator, so the human sees where the agent is acting.

What we do NOT copy: the localhost server. Write is web-first and already has
the hosted equivalent with real auth: /api/mcp with wsk_ bearer tokens minted
at /connect, audit rows on every mutation, and the notes/bookmarks
unlisted-forever invariant enforced below the tool layer.

## The two AI directions

1. Agents come to Write (exists today). Claude, ChatGPT, Cursor, or any MCP
   client connects to /api/mcp with a wsk_ token. The user's own subscription
   pays for the model; Write needs no provider key. Context is explicit: the
   agent lists folders and items and names what it acts on. What this needs is
   Paper-grade distribution, not new architecture: one-click connect cards on
   /docs/ai (claude mcp add, Claude Desktop config, Cursor deep link, ChatGPT
   connector) and optionally our own agent-plugins marketplace repo.

2. Write hosts the AI (the assistant sidebar). The in-app assistant with
   automatic context: at root it manipulates the workspace ("create three
   posts about..."), inside a post it manipulates that post ("rewrite this,
   change the header, research online and summarize here"). This path needs a
   model provider configured in workspace settings.

Both directions call the same command surface; neither goes through the other.

## Tool schemas defined once

The MCP server already exposes list_folders, create_folder, list_items,
read_item, create_item, update_item, append_to_item, and search. Define each
tool's zod schema + handler once (src/lib/ai/tools.ts) and register the same
definitions in both the MCP handler and the assistant's provider adapter
(Vercel AI SDK tool calling). Gaps to fill for the assistant's goals:
delete_item, move_item, set_item_status (publish/unpublish), and
set_item_metadata (title/slug/accent/cover). The assistant adapter adds a
provider-hosted web_search tool (both Anthropic and OpenAI offer one) for
"research online, then write it here".

## Provider selection (workspace settings)

- Setting lives per workspace: provider (anthropic | openai) + model + key.
- Keys are server-managed secrets (encrypted at rest, never in Markdown,
  never client-visible); the Mac app inherits the web session so it needs
  nothing extra.
- The adapter goes through the AI SDK so both providers are one provider
  string apart; a later OAuth path ("sign in with Claude / ChatGPT") slots in
  behind the same setting when those programs open up.
- No key configured: the sidebar stays usable as UI but shows the connect
  path to direction 1 (use your own agent via MCP) plus the settings link.

## Phases

1. Foundation: extract the shared tool schema/handler module; extend the tool
   set (delete, move, status, metadata); wire the MCP handler to it. External
   agents get the richer surface immediately.
2. Assistant: /api/assistant streaming route (AI SDK), context envelope from
   the client pool view state, tool calls executed as optimistic + undoable
   commands, destructive or multi-item operations gated behind a preview
   confirm. Working-indicator presence on items the assistant touches.
3. Distribution: /docs/ai connect cards per client, agent-plugins repo,
   llms.txt already in place. Later: the Mac app can host a Paper-style
   localhost MCP that forwards to the same commands with live view context.

## Shipped 2026-07-10: click-to-approve connector discovery (Claude session)

Phase 3's server half is live, built to slot under the assistant work without
touching it (no assistant/, PostWorkspaceShell, or store files were modified):

- `src/lib/mcp/resource-metadata.ts`: RFC 9728 metadata builder (reuses
  mcp-handler's generateProtectedResourceMetadata + getPublicOrigin) and the
  shared CORS/OPTIONS response for the well-known endpoints.
- `src/app/.well-known/oauth-protected-resource/route.ts` and
  `.../oauth-protected-resource/api/mcp/route.ts`: root and path-suffixed
  forms, both naming this origin as the authorization server and
  `{origin}/api/mcp` as the resource.
- `src/app/.well-known/oauth-authorization-server/route.ts`: now sends CORS
  headers + OPTIONS for browser-based clients.
- `src/app/docs/ai/page.tsx`: rebuilt as per-client connect instructions
  (ChatGPT, Claude, Claude Code, Cursor, token fallback, Ollama note) plus
  the existing OAuth developer, Actions, and content-rules sections.
- Nothing changed in `src/lib/mcp/handler.ts`: withMcpAuth already emits
  `resource_metadata` pointing at the root well-known path by default, and
  `/oauth/token` already mints wsk_ tokens that `verifyWriteApiToken`
  accepts. The chain was complete except for the metadata documents.

Integration notes for the assistant track: the shared tool module (phase 1)
should be consumed by `src/lib/mcp/tools.ts` registration; nothing in the
discovery layer cares about tool shape, so extending the tool set requires no
connector changes. The consent page (`src/app/oauth/authorize/page.tsx`) is
the place to surface per-client names/logos later.
