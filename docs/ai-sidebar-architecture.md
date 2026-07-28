# Assistant and workspace command architecture

This document describes the implemented AI architecture as of 2026-07-28.
Texttext has one shared workspace tool contract, an in-app provider adapter, a
local Mac agent bridge, and a hosted MCP adapter for external agents. The web
product does not call its own MCP server.

## Architectural invariants

- `src/lib/ai/tools.ts` is the source of truth for the 31 public workspace
  tool names, Zod input schemas, JSON schemas, mutability, confirmation class,
  and MCP annotations.
- The in-app assistant, local Mac bridge, and hosted MCP server consume that
  same contract. Their execution adapters differ because they run in different
  trust and transport boundaries.
- Product UI and assistant mutations use the same pool mutations and server
  actions. MCP mutations enter through server-side handlers and the same
  content store.
- `src/lib/store.ts` remains the content access boundary. AI code does not
  bypass permissions, revision checks, privacy rules, or auditing.
- Notes and bookmarks stay private and unlisted forever, regardless of which
  consumer calls a command.
- Every mutation is audited. MCP records the actor as `external_agent` with
  per-token attribution.
- A delete command means Move to Trash. The shared surface exposes restore,
  but no permanent delete.

## Shared 31-tool contract

The eight read-scope tools are:

1. `get_workspace`
2. `list_folders`
3. `list_items`
4. `list_trash`
5. `read_item`
6. `search`
7. `list_comments`
8. `list_item_assets`

The 23 sync-scope tools are:

1. `create_folder`
2. `rename_folder`
3. `delete_folder`
4. `restore_folder`
5. `create_item`
6. `update_item`
7. `append_to_item`
8. `move_item`
9. `delete_item`
10. `restore_item`
11. `set_item_status`
12. `set_item_metadata`
13. `set_item_pinned`
14. `list_access`
15. `grant_access`
16. `set_access_role`
17. `revoke_access`
18. `add_comment`
19. `set_comment_resolved`
20. `recapture_bookmark`
21. `add_item_asset`
22. `remove_item_asset`
23. `set_item_cover`

`list_access` is read-only but requires `sync` because membership information is
workspace administration data. The contract has no permanent-delete tool.
Folder and item deletion move content to Trash. Restores, publication changes,
access changes, and destructive asset operations require explicit human
confirmation immediately before execution.

MCP live-item mutations accept an optional `if_match_hash`. External callers
should always send the latest hash from `list_items`, `search`, or the previous
mutation. The in-app adapter instead saves against the current pool revision
through the normal UI actions. A stale in-app save fails and rolls back its
optimistic state rather than relying on a model-supplied hash.

## Execution adapters

### MCP server

`src/lib/mcp/tools.ts` loops over `WORKSPACE_TOOL_NAMES`, registers every
shared definition, and dispatches each call to its server-side implementation.
It resolves the workspace from the authenticated token, applies workspace,
folder, and item permissions, reads or writes through `src/lib/store.ts`, and
records each mutation in `action_audit`.

The scope guard in `src/lib/mcp/auth.ts` runs before tool execution:

- `read` can call tools whose definitions require the `read` scope.
- `sync` can call all tools, including access-management operations.
- A mutation attempted with `read` returns `403 insufficient_scope` and names
  `sync` in the bearer challenge.

MCP exposes every canonical definition in `tools/list`; authorization determines which
ones the current token may call.

### In-app assistant

The in-app assistant calls the workspace command surface through the
workspace-configured Anthropic or OpenAI provider. The workspace owner chooses
the provider and model in Settings and supplies the API key. The key is
encrypted server-side, is write-only in the UI, and is never returned to the
browser.

Texttext does not send an in-app assistant request through `/api/mcp`. MCP is an
external interoperability adapter, not an internal transport.

### Local Mac agent bridge

The Mac app exposes a loopback-only MCP endpoint at
`http://127.0.0.1:47118/mcp` while Texttext is open. Claude Code and Codex can
use it without a Texttext token. The bridge executes the same workspace
commands against the signed-in Mac app and is never exposed beyond localhost.
It is a transport for external local agents, not an AI model inside Texttext.

## Assistant status

The assistant is available on the Mac app and web after a workspace owner
connects Anthropic or OpenAI. Texttext does not use an owner-funded shared
gateway and does not automatically fall back to an on-device model.

Current assistant behavior includes:

- workspace, folder, Trash, shared-items, reader, editor, and exact text
  selection context
- one conversation transcript per workspace context, retained for the browser
  session
- all canonical workspace tools, with progress events surfaced in the conversation
- confirmation gates for Trash, restore, publication, access, and destructive
  asset changes
- quick actions for summarize, rewrite, title, tags, and excerpt
- preview, apply, undo, and stale-source checks for quick-action edits
- background job state that keeps a reply attached to the context that
  submitted it even if the user navigates elsewhere

Attachments are deferred until provider uploads can be implemented without
leaking workspace data or provider credentials.

## Provider connections

1. **Bring-your-own API key: shipped.** A workspace owner can add an Anthropic
   or OpenAI API key and select a supported model in Settings. The encrypted
   key stays server-side and is never returned to the browser. The assistant
   exposes only tools that need no confirmation and cannot fetch a
   model-chosen URL.
2. **Local agents over MCP: shipped.** Claude Code and Codex can connect to the
   Mac app at `http://127.0.0.1:47118/mcp`. Their model and billing remain in the
   external client, and local file changes remain immediate.
3. **Hosted external agents over MCP: shipped.** Claude.ai, hosted Codex,
   ChatGPT, Cursor, and other MCP hosts can connect to `/api/mcp` using OAuth.
   Claude, Codex, and ChatGPT are the primary documented clients. Cursor and
   other standards-compatible hosts remain supported secondary clients.
4. **Native agent plugins: shipped.** The repository is a Claude and Codex
   plugin marketplace. `plugins/texttext` packages the hosted OAuth MCP
   connection with reusable skills for conversation capture, project
   changelogs, publishing, and collaboration. The product connection center
   leads with these installs. Raw MCP commands and bearer tokens are advanced
   fallbacks, not the primary experience.

ChatGPT connects as a hosted app because it does not install repository plugins.
It uses the same OAuth endpoint and command surface. Texttext never receives a
user's Claude, ChatGPT, or Codex password.

No provider secret is stored in a Markdown folder. The cloud rung remains
opt-in and executes the same workspace contract rather than creating a
parallel command system. Apple Foundation Models are not an active provider or
fallback.

## Context model

The sidebar resolves a stable view snapshot containing a context level,
folder path when relevant, and item id when relevant. Item ids remain
authoritative across renames and moves. In the editor, the context also carries
the selected field, exact source range, and selected text. If no text is
selected, instructions state that the whole current item may be used when
appropriate.

Conversations are keyed independently for the workspace root, each folder,
Trash, Shared with me, and each item. A request captures its context before it
starts, so navigation does not redirect its progress or final reply into a
different conversation.

## Safety, privacy, and Trash

Read operations can run immediately. Mutations still pass through normal
permissions and revision checks. The in-app executor requires a confirmation
callback for every confirmation-marked operation. MCP descriptions and
annotations tell external clients which calls need confirmation; those clients
are responsible for presenting it.

`delete_item` soft-deletes one live item into Trash. `delete_folder` moves a
folder and its live contents to Trash as one restoration unit. `list_trash`
returns restorable items and folders. Restore commands recover only content
from the same deletion operation, so restoring a folder cannot revive an item
that was independently trashed earlier. Agents do not receive Empty Trash or
permanent-delete commands.

The server enforces the privacy invariant below both adapters. A note or
bookmark cannot be published or moved into a public-mode folder, and a public
item cannot cross into a private-mode folder through the tool surface.

## OAuth and external access

The hosted MCP endpoint uses OAuth authorization code with PKCE S256 and a
human click-to-approve consent page. Discovery follows this chain:

```text
/api/mcp 401 challenge
  -> /.well-known/oauth-protected-resource
  -> /.well-known/oauth-authorization-server
  -> /oauth/register
  -> /oauth/authorize
  -> /oauth/token
```

OAuth clients request `read` or `sync`; clients requesting both advertised
scopes receive effective `sync` access. Authorization-code
exchange returns a `wsk_` access token valid for one hour and a `wrt_` refresh
token. Refresh tokens rotate on every use. Reuse of a consumed refresh token
revokes the full family and all access tokens in it. Families have a 180-day
absolute lifetime and a 30-day inactivity lifetime. Manual tokens created at
`/connect` currently carry `sync`, do not expire automatically, and remain
revocable.

OAuth, well-known metadata, and MCP auth changes must keep
`python3 scripts/test-oauth-mcp-loop.py` passing. The approve route must not use
`Response.redirect()` because its immutable headers previously caused approval
to fail.

## Maintenance

- Keep `docs/mcp.md`, `/docs/ai`, `/llms.txt`, and `/openapi.json` aligned with
  `WORKSPACE_TOOL_DEFINITIONS` and the OAuth constants in `src/lib/oauth.ts`.
- Add or change a workspace tool in the shared registry first, then implement
  both execution adapters and their tests.
- Keep privacy and auditing below the tool layer.
- Reusable versions live in `~/dev/stack` under `mcp-kit` and the Mac kit
  templates. Port command-contract, local-bridge, or OAuth hardening back to
  the relevant kit and note it in the kit README.
