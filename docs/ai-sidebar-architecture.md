# Assistant and workspace command architecture

This document describes the implemented AI architecture as of 2026-07-15.
Write has one shared workspace tool contract, a native on-device assistant in
the Mac app, and a hosted MCP adapter for external agents. The web product does
not call its own MCP server.

## Architectural invariants

- `src/lib/ai/tools.ts` is the source of truth for the 17 public workspace
  tool names, Zod input schemas, JSON schemas, mutability, confirmation class,
  and MCP annotations.
- The native assistant and MCP server consume that same contract. Their
  execution adapters differ because one runs in the signed-in page and the
  other runs on the server.
- Product UI and assistant mutations use the same pool mutations and server
  actions. MCP mutations enter through server-side handlers and the same
  content store.
- `src/lib/store.ts` remains the content access boundary. AI code does not
  bypass permissions, revision checks, privacy rules, or auditing.
- Notes and bookmarks stay private and unlisted forever, regardless of which
  consumer calls a command.
- Every mutation is audited. MCP records the actor as `external_agent` with
  per-token attribution.
- A delete command means Move to Trash. The 17-tool surface exposes restore,
  but no permanent delete.

## Shared 17-tool contract

The six read tools are:

1. `get_workspace`
2. `list_folders`
3. `list_items`
4. `list_trash`
5. `read_item`
6. `search`

The eleven mutation tools are:

1. `create_folder`
2. `rename_folder`
3. `create_item`
4. `update_item`
5. `append_to_item`
6. `move_item`
7. `delete_item`
8. `restore_item`
9. `set_item_status`
10. `set_item_metadata`
11. `set_item_pinned`

The contract deliberately has no workspace administration, member management,
folder deletion, folder restoration, or permanent-delete tool. It marks
`delete_item`, `restore_item`, and `set_item_status` as requiring explicit
human confirmation immediately before execution. Restore is audience-changing
because an item returns with its previous status, so a restored published item
can become public again.

MCP live-item mutations accept an optional `if_match_hash`. External callers
should always send the latest hash from `list_items`, `search`, or the previous
mutation. The native adapter instead saves against the current pool revision
through the normal UI actions. A stale native save fails and rolls back its
optimistic state rather than relying on a model-supplied hash.

## Execution adapters

### MCP server

`src/lib/mcp/tools.ts` loops over `WORKSPACE_TOOL_NAMES`, registers every
shared definition, and dispatches each call to its server-side implementation.
It resolves the workspace from the authenticated token, applies workspace,
folder, and item permissions, reads or writes through `src/lib/store.ts`, and
records each mutation in `action_audit`.

The scope guard in `src/lib/mcp/auth.ts` runs before tool execution:

- `read` can call only the six read tools.
- `sync` can call all 17 tools.
- A mutation attempted with `read` returns `403 insufficient_scope` and names
  `sync` in the bearer challenge.

MCP exposes all 17 definitions in `tools/list`; authorization determines which
ones the current token may call.

### Native assistant

`src/lib/ai/agent-tools.ts` projects the same 17 definitions into the native
agent format. Its executor runs in the signed-in page and maps calls onto the
same optimistic pool updates and server actions used by the workspace UI.
Failed server writes roll back optimistic state. Native tool results are
compact, context-window-aware projections of workspace state; they are not the
MCP wire responses.

`src/lib/ai/native.ts` is the typed page-side client for the Mac app's
`nativeAI` bridge. Tool calls originate in Apple's on-device model, cross into
the page through a request-correlated callback, run in the registered page
executor, and return to the model. The native model therefore cannot perform
an operation that the current signed-in page cannot perform.

Write does not send an in-app assistant request through `/api/mcp`. MCP is an
external interoperability adapter, not an internal transport.

## Assistant status

The assistant is implemented and available inside Write for Mac when Apple's
Foundation Models runtime reports available. Text generation and agent tool
calling require macOS 26 or later, eligible hardware, Apple Intelligence
enabled, and a ready on-device model. Vision OCR is used for image text on
supported Mac releases.

Current assistant behavior includes:

- workspace, folder, Trash, shared-items, reader, editor, and exact text
  selection context
- one conversation transcript per workspace context, retained for the browser
  session
- all 17 workspace tools, with progress events surfaced in the conversation
- confirmation gates for Move to Trash, restore, and publication changes
- quick actions for summarize, rewrite, title, tags, and excerpt
- preview, apply, undo, and stale-source checks for quick-action edits
- text attachments and private on-device OCR for image attachments when the
  capability probe allows it
- background job state that keeps a reply attached to the context that
  submitted it even if the user navigates elsewhere

On the plain web, or when the bridge or model is unavailable, the assistant
explains why it cannot run. It does not silently fall through to a cloud model.

## Provider ladder

The intended order remains local first, optional cloud second, and external
agents third. Only the following states are implemented today:

1. **Apple on-device: shipped.** This is the in-app assistant provider in
   Write for Mac. Utility operations and agent commands run locally through
   `mac/Sources/Write/NativeAI.swift` and the `nativeAI` bridge.
2. **Bring-your-own cloud: not shipped.** There is no in-app OpenAI or
   Anthropic provider setting, key store, provider adapter, assistant API
   route, automatic cloud fallback, or provider-hosted web search. Public
   documentation must not imply otherwise.
3. **External agents over MCP: shipped.** ChatGPT, Claude, Cursor, Claude
   Code, and other MCP hosts can connect to `/api/mcp`. Their model and billing
   remain in the external client. That is not an in-app provider integration.

No provider secret is stored in a Markdown folder. A future cloud rung must
remain opt-in, preserve the local-first default, and execute the same workspace
contract rather than create a parallel command system.

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
callback for the three confirmation-marked operations: Move to Trash, restore,
and publication status changes. MCP descriptions and annotations tell external
clients which calls need confirmation; those clients are responsible for
presenting it.

`delete_item` soft-deletes one live item into Trash. `list_trash` returns
restorable items, and `restore_item` restores the previous status. The shared
tool contract currently covers item Trash only. The product UI has additional
folder Trash controls, but agents do not receive folder delete, folder restore,
Empty Trash, or permanent-delete commands.

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
- Reusable versions live in `~/dev/stack` under `mcp-kit` and
  `mac-kit/templates/native-ai`. Port contract or OAuth hardening back to the
  kit and note it in the kit README.
