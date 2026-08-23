# Assistant and workspace command architecture

This document describes the implemented AI architecture. TextText has one
shared workspace tool contract, a standalone-Mac native Codex adapter, an
in-app API provider adapter, the `texttext` CLI in the standalone app, and a
hosted MCP adapter for remote agents. The web product does not call its own MCP
server.

## Architectural invariants

- `src/lib/ai/tools.ts` is the source of truth for the public workspace tool
  names, Zod input schemas, JSON schemas, mutability, confirmation class, and
  MCP annotations. The lists in this document are generated from it by
  `scripts/sync-tool-docs.ts`; edit the registry, not the list.
- The in-app assistant and the hosted MCP server consume that same contract.
  Their execution adapters differ because they run in different trust and
  transport boundaries. The signed-in `texttext` CLI uses the authenticated
  agent-command route for its read, create, update, and append operations. That
  route dispatches the matching workspace commands rather than editing through
  a File Provider mount or a second local server.
- Product UI and assistant mutations use the same pool mutations and server
  actions. MCP mutations enter through server-side handlers and the same
  content store.
- `src/lib/store.ts` remains the content access boundary. AI code does not
  bypass permissions, revision checks, privacy rules, or auditing.
- Notes and bookmarks stay private and unlisted forever, regardless of which
  consumer calls a command.
- Every connected mutation is audited. MCP records the actor as
  `external_agent` with per-token attribution. The signed-in CLI keeps the
  authenticated account identity and may add a bounded, self-declared agent
  label and intent. Explicit `TEXTTEXT_WORKSPACE_ROOT` offline writes do not
  claim server audit or presence.
- A delete command means Move to Trash. The shared surface exposes restore,
  but no permanent delete.

<!-- generated:tool-contract -->
## Shared 35-tool contract

The 11 read-scope tools are:

1. `get_workspace`
2. `list_folders`
3. `list_items`
4. `read_item`
5. `review_brief_sources`
6. `open_item`
7. `search`
8. `list_trash`
9. `list_comments`
10. `list_responses`
11. `list_document_templates`

The 24 sync-scope tools are:

1. `list_access`
2. `create_item_type`
3. `save_item_as_look`
4. `set_folder_template`
5. `retire_document_template`
6. `set_item_template`
7. `create_item`
8. `update_item`
9. `append_to_item`
10. `set_item_status`
11. `move_item`
12. `delete_item`
13. `restore_item`
14. `add_item_asset`
15. `remove_item_asset`
16. `recapture_bookmark`
17. `add_comment`
18. `set_comment_resolved`
19. `create_folder`
20. `rename_folder`
21. `delete_folder`
22. `restore_folder`
23. `set_access`
24. `revoke_access`
<!-- /generated:tool-contract -->

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

The standalone Developer ID app can launch a local Codex App Server process and
stream a native turn over its private JSON-RPC pipe. It uses an eligible account
already available to that local runtime and registers TextText's workspace
commands as dynamic tools. The sandboxed TestFlight app cannot launch a command
from the person's home directory, so it cannot offer this path.

The in-app assistant can also call the workspace command surface through the
workspace-configured Anthropic or OpenAI provider. The workspace owner chooses
the provider and model in Settings and supplies the API key. The key is
encrypted server-side, is write-only in the UI, and is never returned to the
browser. This path works in the web product and both Mac channels.

TextText does not send an in-app assistant request through `/api/mcp`. MCP is an
external interoperability adapter, not an internal transport.

### Agents on this Mac

An agent running on the same Mac with the standalone app uses the `texttext`
CLI (`mac/Sources/TextTextCLI`), which ships inside that app bundle. The CLI
loads the signed-in app's tenant-scoped device credential and calls the
authenticated sync and agent-command routes. There is no port, token to paste,
or second sign-in. Finder and File Provider integration are optional rather
than a prerequisite for agent work. An explicit `TEXTTEXT_WORKSPACE_ROOT`
keeps the file backend available for tests and offline file workflows.

Commands with an item identity publish short-lived, best-effort presence. The
device credential authenticates the person and workspace; the requested agent
name and intent are bounded, self-declared metadata attached to the connected
audit row. Presence never authorizes or blocks an edit. Creates and appends
accept a stable idempotency key, while updates use the current document hash and
stop on conflict so the agent can reread and reconcile. The sandboxed
TestFlight edition excludes the bundled CLI, so external agents there use
hosted MCP when their client supports bearer credentials.
`docs/agent-interoperability.md` is the transport reference.

The loopback MCP server this section used to describe was retired in `0.146`.
Deleting the port deleted the whole local trust problem with it.

## Assistant status

The assistant is available through the native Codex path in the standalone Mac
app, or on either Mac channel and the web after a workspace owner connects
Anthropic or OpenAI. TextText does not use an owner-funded shared gateway and
does not automatically fall back to an on-device model.

Current assistant behavior includes:

- workspace, folder, Trash, shared-items, reader, editor, and exact text
  selection context
- one conversation transcript per workspace context, retained for the browser
  session
- progress events surfaced in the conversation
- all canonical workspace tools in the standalone native path, with
  confirmation gates for Trash, restore, publication, access, and destructive
  asset changes
- only tools that need no confirmation in the API-key cloud path
- quick actions for summarize, rewrite, title, tags, and excerpt
- preview, apply, undo, and stale-source checks for Rewrite and Summarize
  selection quick actions; ordinary freeform turns can mutate through workspace
  tools without this proposal UI
- background job state that keeps a reply attached to the context that
  submitted it even if the user navigates elsewhere

Attachments follow the provider boundary. Configured cloud providers accept
bounded local text and Markdown context, with the file contents embedded in the
request and no upload token or persistent provider copy. Images and other
binary files remain available only through the standalone native OCR path;
cloud turns reject them with a recovery message instead of pretending they
were attached.

## Provider connections

1. **Native Codex in the standalone Mac app: shipped.** The Developer ID app
   can use an eligible ChatGPT or Codex account already connected to the local
   Codex runtime. It does not consume provider API credits. TestFlight cannot
   launch this runtime because of the App Sandbox.
2. **Bring-your-own API key: shipped.** A workspace owner can add an Anthropic
   or OpenAI API key and select a supported model in Settings. The encrypted
   key stays server-side and is never returned to the browser. The assistant
   exposes only tools that need no confirmation and cannot fetch a
   model-chosen URL.
3. **Agents on this Mac: shipped in the standalone app.** Claude Code and Codex
   use the bundled `texttext` CLI. The model and billing stay with that client;
   the CLI reuses the signed-in device credential and authenticated server
   command route.
4. **Hosted external agents over MCP: shipped.** A remote MCP client that
   exposes a bearer-token field can connect to `/api/mcp` with a revocable
   workspace token. OAuth-only clients are not compatible because TextText does
   not run an OAuth authorization server.
5. **Native agent plugins: shipped.** The repository is a Claude and Codex
   plugin marketplace. `plugins/texttext` packages reusable skills for
   conversation capture, project changelogs, publishing, and collaboration;
   the installed skills invoke the bundled CLI. Hosted MCP and its bearer token
   are an explicit remote-client fallback, not a hidden plugin dependency.

TextText never receives a user's Claude, ChatGPT, or Codex password.

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

## External access

The hosted MCP endpoint accepts a workspace bearer token created at `/connect`.
Each token belongs to one workspace, carries `sync` access, has a descriptive
agent name for presence and audit attribution, and remains revocable from the
same page. TextText has no OAuth authorization server, consent page, refresh
token family, or dynamic client registration endpoint.

The resource metadata and the MCP `401` response both direct a client to the
token flow. A client must let the person provide a bearer credential. The app
never asks for the person's Claude, ChatGPT, or Codex password.

Workspace Settings keeps these boundaries visible in one Connections overview:
the workspace provider key, native Codex session when the standalone app is
present, active machine client tokens, outbound MCP servers, and sign-in
methods. Hosted tokens carry a `kind` such as `mcp` or `app`, so the UI can
explain the transport instead of guessing from the freeform token name. Each
capability has its matching control: remove the provider key, revoke a token,
remove an outbound MCP server, or disconnect the native TextText Codex
session. Native disconnect stops TextText's embedded runtime; it does not
claim to sign the person out of Codex in other applications.

## Maintenance

- Keep `docs/mcp.md`, `/docs/ai`, `/llms.txt`, and `/openapi.json` aligned with
  `WORKSPACE_TOOL_DEFINITIONS`. `/docs/mcp` generates its tool table from that
  registry, so it cannot drift.
- Add or change a workspace tool in the shared registry first, then implement
  both execution adapters and their tests.
- Keep privacy and auditing below the tool layer.
- Hosted MCP agents authenticate with a workspace bearer token from `/connect`.
  The local CLI instead reuses the signed-in app's device credential. TextText
  runs no OAuth authorization server (owner ruling 2026-08-15).
