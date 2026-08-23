# TextText MCP workspace command reference

TextText exposes one file-backed workspace command surface to three consumers:
the product UI, the workspace-configured assistant, and external agents over
MCP. The application calls the commands directly. It does not call its own MCP
endpoint.

This document covers the hosted endpoint. The standalone Developer ID Mac app
also includes the `texttext` CLI for same-Mac agents, with no token to paste and
no port. The sandboxed TestFlight app cannot ship a useful shell command, so
agents used with that channel connect through this hosted endpoint instead. See
`docs/agent-interoperability.md`. There is no local MCP server; the loopback
endpoint was retired in `0.146`.

<!-- generated:tool-source -->
`src/lib/ai/tools.ts` is the source of truth for the 35 tool
names, schemas, mutability, confirmation requirements, and MCP
annotations. The MCP adapter registers those definitions in
`src/lib/mcp/tools.ts`.
<!-- /generated:tool-source -->

## Protocol revision

TextText implements **MCP `2026-07-28`** and only that revision. It is stateless:
there is no `initialize` handshake, no `Mcp-Session-Id`, no GET stream, and no
SSE resumability. Every request stands alone.

`server/discover` returns the supported versions, capabilities, and server
identity in one call. A request for a version this server does not implement is
answered with `400` and `-32022`, listing what it does support.

## Endpoint and transport

- Endpoint: `https://{host}/api/mcp`, Streamable HTTP, POST only.
- `GET` and `DELETE` answer `405`. Those were the session and standalone-stream
  verbs and this revision removed both.
- `/.well-known/mcp.json` provides zero-configuration server discovery.
- An unauthenticated request returns a `WWW-Authenticate` challenge whose
  `resource_documentation` points at `/docs/mcp`, which is where a person
  creates the token it is asking for.

### Every request carries its own context

Required in `params._meta`:

| Key | Required |
|-----|----------|
| `io.modelcontextprotocol/protocolVersion` | Yes |
| `io.modelcontextprotocol/clientCapabilities` | Yes |
| `io.modelcontextprotocol/clientInfo` | No, but send it |

Required headers, which MUST match the body or the request is rejected with
`400` and `-32020`:

| Header | Mirrors | Required for |
|--------|---------|--------------|
| `MCP-Protocol-Version` | `_meta` protocol version | every request |
| `Mcp-Method` | `method` | every request |
| `Mcp-Name` | `params.name` or `params.uri` | `tools/call`, `prompts/get`, `resources/read` |

A value that is not plain ASCII is carried as `=?base64?{value}?=` and decoded
before comparison.

### Results

Every result carries `resultType: "complete"` and
`_meta["io.modelcontextprotocol/serverInfo"]`. The five cacheable results
(`tools/list`, `prompts/list`, `resources/list`, `resources/read`,
`resources/templates/list`) also carry `ttlMs` and `cacheScope`, so a client can
cache instead of poll. The catalogs are `public` and change only on deploy;
workspace reads are `private` and short-lived.

`tools/list` returns tools in a fixed order, so a client cache and an LLM prompt
cache both stay warm.

### Error codes

| Code | Meaning |
|------|---------|
| `-32020` | `HeaderMismatch`, a header disagrees with the body or is missing |
| `-32021` | `MissingRequiredClientCapability` |
| `-32022` | `UnsupportedProtocolVersion`, with `data.supported` |
| `-32601` | unknown method, returned with HTTP `404` |
| `-32602` | invalid params, including resource-not-found |

`-32002` is reserved and never emitted; resource-not-found moved to `-32602` in
this revision.

### Subscriptions

`subscriptions/listen` replaced the GET stream and `resources/subscribe`.
TextText has no server-pushed changes to offer, so it acknowledges an empty
filter and closes the stream gracefully with the empty result the spec defines,
rather than holding a connection open that would never emit.

## Authentication

Every client authenticates with a workspace bearer token. Create one at
`/connect` and send it as:

```http
Authorization: Bearer wsk_...
```

Manual tokens currently carry `sync` access and remain valid until revoked.

## Scopes

<!-- generated:scope-table -->
| Scope | Access |
|-------|--------|
| `read` | Call the 11 read-scope tools: `get_workspace`, `list_folders`, `list_items`, `read_item`, `review_brief_sources`, `open_item`, `search`, `list_trash`, `list_comments`, `list_responses`, `list_document_templates`. |
| `sync` | Call all 35 tools, including the 24 that mutate content or read administration data. It also grants every `read` operation. |
<!-- /generated:scope-table -->

A mutation attempted with a `read` token returns `403 insufficient_scope` and
advertises `sync` as the required scope. The separate sync HTTP API requires
`sync` for every endpoint, including its reads.

Each token resolves only its owner's workspace. Tools do not accept a tenant
or workspace selector that could cross that boundary.

## Content model

- A workspace contains folders. Each folder has a stable id, full slash path,
  mode, parent, and item count.
- Folder modes are `blog`, `notes`, and `bookmarks`. Blog items can publish.
  Notes and bookmarks are private and unlisted forever, enforced below the
  tool layer.
- An item is a Markdown file with optional metadata frontmatter between `---`
  fences and a Markdown body.
- Live item listings include a content `hash`. Pass it back as
  `if_match_hash` on mutations. A stale hash rejects the write so the caller
  can read, merge, and retry.
- `delete_item` and `delete_folder` are soft deletes. `list_trash` lists
  restorable items and folder restoration units. Restoring a previously
  published item can make it public again.
- There is no permanent-delete MCP tool.
- Direct access grants, collaboration comments, bookmark recapture, and item
  cover and asset references use the same audited command surface.

<!-- generated:tool-table -->
## Tools (35)

| Tool | Scope | Effect |
|------|-------|--------|
| `get_workspace` | `read` or `sync` | Return this workspace's handle, name, your effective access, and server capabilities. |
| `list_folders` | `read` or `sync` | List every folder you can see with its id, path, mode, and item count. |
| `list_items` | `read` or `sync` | List the live items in one folder with their ids, titles, tags, status, and content hash. |
| `read_item` | `read` or `sync` | Read one item's markdown, metadata, tags, outbound links, backlinks, and assets by id. |
| `review_brief_sources` | `read` or `sync` | Compare a Living brief's captured workspace-source versions with the current documents. Return changed or missing sources and the exact claim ids that need review. Read-only. |
| `open_item` | `read` or `sync` | Open one exact item in TextText for the user and join its live collaboration session. |
| `search` | `read` or `sync` | Search item titles, excerpts, and bodies you can access, and return matches with snippets. |
| `list_trash` | `read` or `sync` | List soft-deleted items and folder restore-units. Nothing here is permanently deleted. |
| `list_comments` | `read` or `sync` | List comment threads on one item, with anchored quotes and resolution state. |
| `list_responses` | `read` or `sync` | List reader responses to one item's poll nodes: per-option tallies plus individual responses. Responder identity is a name only when the reader was signed in. |
| `list_access` | `sync` | List who can access the workspace, one folder, or one item, and their role. |
| `list_document_templates` | `read` or `sync` | List the immutable built-in and workspace templates available for shaping documents. |
| `create_item_type` | `sync` | Create one reusable item type from a complete blueprint. The blueprint defines the fields, the item page, the folder layout, example content, and safe theme tokens together. Use this when someone asks for a new kind of thing, such as a Medium-like blog, a Notion-like task board, or Apple Notes-like notes. If folder_path is supplied, the new type becomes that folder's look and existing items are restyled by default. |
| `save_item_as_look` | `sync` | Take the way one item currently renders and save it as a reusable look, under a name. The look then appears in the look pickers and can be applied to other items or given to a folder with set_folder_template. This replaced an operations-based authoring API: shape a document the ordinary way, with update_item and the item's own theme, then save what you made. It never changes the item. |
| `set_folder_template` | `sync` | Give a folder a look, and by default restyle everything already in it. The template becomes what the folder's index page renders from, what new items are created with, and what the items already there use. This is how a request like 'make this folder a magazine' actually lands. Pass apply_to_existing false only if the person asked for the change to affect new items alone: leaving old items behind means the index changes and not one article does, which reads as nothing having happened. |
| `retire_document_template` | `sync` | Stop offering one workspace look. It disappears from the look pickers and from list_document_templates, and every document and folder already using it keeps rendering exactly as it does now, because template versions are immutable and nothing is deleted. Built-in looks cannot be retired. Use this when someone says a look they made is no longer wanted, rather than leaving a picker full of abandoned experiments. This changes or removes existing workspace state. Obtain explicit human confirmation immediately before calling it. |
| `set_item_template` | `sync` | Apply one document template to an item without changing its content or audience. Omit template_version to use the look's current version, which is almost always what you want. |
| `create_item` | `sync` | Save something to TextText. For quick capture, pass capture alone: text becomes a private Note and a URL becomes a Bookmark, with a receipt in the result. For precise creation, pass fields or a full markdown file and choose a folder. New items are never published or pinned. Automated clients should pass a stable idempotency_key so retries cannot create duplicates. |
| `update_item` | `sync` | Update one item's content or metadata: title, body, excerpt, tags, slug, cover, pin, publication date, and custom template fields via the fields map. A full body or markdown replacement requires if_match_hash from read_item. Targeted text_edit and section edits use their own expected-content guards. Cannot publish, unpublish, or move an item. |
| `append_to_item` | `sync` | Append a markdown block to the end of one item's body without touching its metadata. Pass the text as `markdown`. Automated clients should pass an idempotency_key derived from the source event or commit. |
| `set_item_status` | `sync` | Publish or unpublish one blog item. Notes and bookmarks can never be published. This can change what readers can see. Obtain explicit human confirmation immediately before calling it. |
| `move_item` | `sync` | Move one item to another folder of the same mode. |
| `delete_item` | `sync` | Move one item to Trash. It stays restorable; this never permanently deletes. This changes or removes existing workspace state. Obtain explicit human confirmation immediately before calling it. |
| `restore_item` | `sync` | Restore one item from Trash with its previous status. This can change what readers can see. Obtain explicit human confirmation immediately before calling it. |
| `add_item_asset` | `sync` | Import one public image or video URL into TextText and attach it as cover, body, or gallery. |
| `remove_item_asset` | `sync` | Remove references to one asset URL from an item's cover, body, and gallery. This changes or removes existing workspace state. Obtain explicit human confirmation immediately before calling it. |
| `recapture_bookmark` | `sync` | Re-fetch one bookmark from its saved URL. The current capture stays visible until the new one lands. |
| `add_comment` | `sync` | Add a comment or reply on one item, optionally anchored to an exact quote. |
| `set_comment_resolved` | `sync` | Resolve or reopen one comment thread. |
| `create_folder` | `sync` | Create a subfolder under an existing folder path; it inherits the parent's mode and privacy. |
| `rename_folder` | `sync` | Rename one folder. Its id and path do not change. |
| `delete_folder` | `sync` | Move one folder subtree to Trash. Restorable; never permanently deleted. This changes or removes existing workspace state. Obtain explicit human confirmation immediately before calling it. |
| `restore_folder` | `sync` | Restore one folder subtree from Trash. This can change what readers can see. Obtain explicit human confirmation immediately before calling it. |
| `set_access` | `sync` | Grant or change one person's role on the workspace, a folder, or an item, by email. This can change what readers can see. Obtain explicit human confirmation immediately before calling it. |
| `revoke_access` | `sync` | Revoke one person's access to the workspace, a folder, or an item. This can change what readers can see. Obtain explicit human confirmation immediately before calling it. |
<!-- /generated:tool-table -->

## Safety rules for agents

1. Create new items as drafts. Use `set_item_status` only after the owner
   explicitly confirms the audience change.
2. Never try to publish notes or bookmarks. The server rejects it.
3. Treat `delete_item` and `delete_folder` as Move to Trash, not permanent
   deletion. Confirm them first, and use the matching restore tool to undo.
4. Send the latest `if_match_hash` on every existing-item mutation. On a
   conflict, read the item again, merge, and retry.
5. Every mutation writes an `action_audit` row with external-agent identity,
   action name, target, and a clipped summary.

## In-app assistant status

The standalone Developer ID Mac app can run an embedded Codex agent with an
eligible existing ChatGPT or Codex account. That path does not use provider API
credits. It depends on launching a local runtime, so the sandboxed TestFlight
app cannot offer it.

The workspace owner can also connect an Anthropic or OpenAI API account and
choose the model used by the in-app assistant. The API key is encrypted on the
server, is write-only in Settings, and is sent only to the selected provider.
Provider API billing is separate from ChatGPT and Claude consumer
subscriptions.

People can instead work from Claude, Codex, ChatGPT, Cursor, or another MCP
host using that product's model account and the TextText workspace token. The
client must support a manual bearer credential because TextText does not run an
OAuth authorization server. Plan, role, and workspace policy can limit which
custom MCP capabilities a host makes available.

## Sibling surface: sync API

Bulk and file-level integrations use `/api/sync/v1`: workspace and folder
manifests with ETags, file GET/POST/PUT/PATCH/DELETE, change polling, assets,
and the bookmark capture pipeline. It uses the same `wsk_` bearer tokens but
requires `sync`. Existing-file mutations require current validators such as
`If-Match`. A sync DELETE also moves the item to Trash rather than permanently
deleting it.
