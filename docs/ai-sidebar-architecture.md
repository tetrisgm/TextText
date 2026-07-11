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

## Providers: the ladder

Default to the most private, cheapest layer available and let the user climb:

1. **Apple on-device (default inside the Mac app, later iPhone).** The
   FoundationModels framework (macOS 26+) through the `nativeAI` WKWebView
   bridge: free inference, private, offline. Owns the instant utility ops:
   title, tags, excerpt, summarize, rewrite, categorize, plus Vision OCR on
   any macOS. Availability is a runtime probe (device eligibility, Apple
   Intelligence toggle, model readiness); when unavailable the ladder falls
   through.
2. **Bring-your-own cloud (workspace settings).** OpenAI or Anthropic key,
   server-managed secrets, AI SDK adapter. Long-context work, web research,
   and anything beyond the small on-device model. Augments, never replaces,
   the local layer.
3. **External agents via MCP** (the connector surface): the user's own
   ChatGPT/Claude/Cursor acting on the workspace from outside.

WWDC26 note: Apple opened the FoundationModels framework to third-party
providers (any model conforming to their language-model protocol, session
339) and added image input. That protocol is the NATIVE home for layer 2 on
Apple platforms eventually (one Swift API, user-visible model switching),
but it needs the macOS 27 SDK (Xcode 27); the machine builds with Xcode 26.x
today, so the web-side provider adapter stays the layer-2 implementation for
now and the bridge contract already leaves room (`generate` is provider-
agnostic).

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

## How Notion does it (studied 2026-07-11, developers.notion.com/guides/mcp)

Notion's hosted MCP (mcp.notion.com/mcp) is architecturally identical to what
we shipped: streamable HTTP, RFC 9728 protected-resource metadata into RFC
8414 authorization-server metadata, dynamic client registration, PKCE, OAuth
consent. Their build-a-client guide documents the exact chain our
scripts/test-oauth-mcp-loop.py walks. Validation that our approach is the
industry-standard one; even Notion states "no true one-click automation
exists due to security requirements", so paste-URL-and-approve IS the
state of the art for ChatGPT and Claude.

Where Notion is ahead, and what we adopt:

- Zero-config discovery: they serve /.well-known/mcp.json
  ({name, description, icon, endpoint}). Adopted, same shape.
- One-click install links where clients support them: Cursor deeplink
  (cursor://anysphere.cursor-deeplink/mcp/install?name=...&config=base64) and
  VS Code (vscode:mcp/install?urlencoded-json). Adopted on /docs/ai. Notion's
  own docs do not even do this; it is Cursor/VS Code convention.
- Docs depth: a supported-tools reference and a security best-practices page
  (access model, prompt-injection warning, human-confirmation guidance).
  Adopted as sections on /docs/ai.
- Directory listings are the real one-click for ChatGPT and Claude: Notion
  appears IN the clients' connector directories, so users click "Notion"
  instead of pasting a URL. That is a business/ops submission per vendor
  (OWNER-GATED, needs the real company identity), not code. Note for later.

Roadmap deltas Notion suggests (for the shared tool module and token layer,
NOT built yet):

- Token lifecycle: Notion rotates access tokens (1h expiry) with refresh
  tokens (180d absolute, 30d inactivity). Our wsk_ tokens never expire (they
  are revocable). Adding expiry + refresh_token grant to /oauth/token is the
  main security-hardening step left.
- A read-only scope alongside "sync", so read-only connections exist.
- Workspace identity: their fetch("self") returns workspace name/id; our
  equivalent belongs in list_folders output or a small get_workspace tool.
- Documented rate limits once we enforce any (they publish 180 rpm).

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

## Shipped 2026-07-11: Notion-parity pass (Claude session)

- `src/app/.well-known/mcp.json/route.ts`: zero-config discovery document.
- `src/app/docs/ai/page.tsx`: one-click Add to Cursor / Add to VS Code links,
  a "What a connected AI can do" tools table (keep it in sync when the tool
  set grows; the MCP registration in src/lib/mcp/tools.ts is the source of
  truth), and a Security section.
- Regression gate unchanged: scripts/test-oauth-mcp-loop.py must pass.

## Shipped 2026-07-11: Apple on-device AI bridge (Claude session)

Layer 1 of the provider ladder is in the Mac app and verified with real
on-device inference on this machine (availability available; title ~4.4s
cold including model load, tags ~1.1s warm):

- `mac/Sources/Write/NativeAI.swift`: the `nativeAI` script-message bridge.
  Ops: capabilities, generate, title, tags, excerpt, summarize, rewrite,
  categorize (FoundationModels, gated `#available(macOS 26.0, *)` with
  graceful capability reasons on older systems) and ocr (Vision, any macOS).
  Stateless one-shot sessions, ~12k-char input trim to respect the small
  context window, list/quote cleanup on single-line outputs.
- `mac/Sources/Write/WebAppWindowController.swift`: registers the handler and
  injects the promise-correlated JS shim at document start, origin-gated the
  same way as the app flags (never exists on third-party OAuth pages).
- `src/lib/ai/native.ts`: the typed web-side client. `hasNativeAI()` +
  `nativeAICapabilities()` for the probe; `nativeTitle/Tags/Excerpt/
  Summarize/Rewrite/Categorize/Generate/Ocr` for the ops. On the plain web it
  reports unavailable; the assistant falls through the ladder.
- Deferred to the macOS 27 SDK: image understanding (`altText` and
  `describeImage` return a clear unsupported error today) and the
  third-party-provider protocol.

## Shipped 2026-07-12: on-device agent tool calling (Claude session)

The "perform things" class runs fully local. Proven first with a standalone
probe: the on-device model, given one create_item tool, executed "create
three draft posts: a rap song, a short story, dad jokes" as three tool calls
with real generated bodies plus a summary sentence in 11.4s.

- `NativeAI.swift` gained the `agent` op: a LanguageModelSession with
  WebProxyTool instances (FoundationModels `Tool` protocol,
  `DynamicGenerationSchema` parameters, `GeneratedContent` arguments passed
  through as JSON). Tool DEFINITIONS live in Swift (list_folders,
  list_items, read_item, create_item, update_item, append_to_item,
  move_item, delete_item, set_item_status); tool EXECUTION lives in the
  page, so the model can never do anything the signed-in page cannot.
  Plumbing: each model tool call is forwarded via
  `window.__writeNativeAIToolCall(callId, name, argsJSON, tag)`, the page
  replies over the same message handler (`{toolReply}`), continuations are
  lock-guarded with a 60s timeout and a fail-fast when no executor is
  registered. Progress events reach the page via
  `window.__writeNativeAIAgentEvent`.
- `src/lib/ai/native.ts` gained `nativeAgent(prompt, {context,
  instructions, tools, onEvent})` and `registerNativeAgentTools(executor)`.
- `src/lib/ai/agent-tools.ts` (new) is the turnkey executor:
  `createWorkspaceAgentTools({handle, getPool, confirmDestructive})` maps
  every tool onto the same pool mutations + server actions the UI uses
  (optimistic, synced, audited), enforces notes/bookmarks-never-publish in
  the executor, gates delete/publish behind the optional confirm callback,
  caps result sizes for the small context window, and provides
  `describeContext(view)` for the context envelope. The file header shows
  the exact sidebar wiring.
- The sidebar integration that remains for Codex: mount the executor, pipe
  the composer through `nativeAgent` (agent commands) or the one-shot ops
  (utility commands), and surface tool events as progress.

## Extracted to the stack repo (2026-07-11)

The whole connector surface is now also `~/dev/stack/mcp-kit` (GitHub
VaporWorks/stack): the reference copies of write's MCP + OAuth + well-known
files, the loop test, an integration-contract README with the pitfall list,
the `add-mcp` skill, and an AI-connectivity section in the template
CLAUDE.md. Write stays the laboratory: when the pattern is hardened here
(token expiry + refresh rotation, read-only scope, workspace-identity tool),
port the improvement back to the kit and note it in its README roadmap. The
kit is reference code; nothing in write imports from it.
