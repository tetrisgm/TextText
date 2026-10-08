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
`src/lib/mcp/vault-contract.ts` defines the 27 hosted tool
names, file-backed schemas and descriptions. Shared mutability and MCP
annotations come from `src/lib/ai/tools.ts`. The MCP registry advertises
this hosted catalog rather than every internal workspace command.
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
| `read` | Call the 8 read-scope tools: `get_workspace`, `list_folders`, `list_items`, `read_item`, `search`, `list_comments`, `list_trash`, `list_document_templates`. |
| `sync` | Call all 27 tools, including the 19 that mutate content or read administration data. It also grants every `read` operation. |
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
## Tools (27)

| Tool | Scope | Effect |
|------|-------|--------|
| `get_workspace` | `read` or `sync` | Return this workspace's handle, name, your effective access, and server capabilities. |
| `list_folders` | `read` or `sync` | List every folder you can see with its id, path, mode, and item count. |
| `create_folder` | `sync` | Create one ordinary folder inside an existing parent_path; use an empty parent_path for the workspace root. Requires editing permission on the parent and a stable idempotency_key. Does not set folder templates or privacy. |
| `list_items` | `read` or `sync` | List accessible files, optionally restricted to an exact folder path. Omit folder_path to list the workspace. Returns titles, paths and hashes. |
| `read_item` | `read` or `sync` | Read an accessible file's complete DocumentSnapshot, Markdown body, path and current content hash. |
| `search` | `read` or `sync` | Search item titles, excerpts, and bodies you can access, and return matches with snippets. |
| `create_item` | `sync` | Create a private file using title, body, excerpt, kind and optional fields. Uses Notes, Blog, Bookmarks, Gallery or Presentations unless folder_path is supplied. Pass idempotency_key for retry safety. Pass capture for text or a standalone URL, or markdown for a complete Markdown file with frontmatter. These are alternatives to structured fields. Pass template_id to create from the latest accessible template artifact, or template_version to pin a version. Explicit fields override starter defaults. |
| `update_item` | `sync` | Edit title, body, excerpt, tags, declared template fields (null clears one), one guarded Markdown section, or one image's summary/tags via asset_metadata with its stable asset id. Null image summary clears it; original bytes and neighboring photos remain unchanged. Requires the current if_match_hash from read_item. Unsupported metadata and publication changes fail without changing the file. |
| `append_to_item` | `sync` | Append markdown or markdown_fragment to a file using the current if_match_hash from read_item. Pass a stable idempotency_key so a lost response can be retried exactly once. |
| `add_item_asset` | `sync` | Import one public image URL into TextText and attach it as cover, body, or gallery. |
| `remove_item_asset` | `sync` | Detach one asset by its ID from document references and gallery. Requires current hash and stable idempotency key. Original archive bytes are retained for recovery; this is not permanent media deletion. |
| `list_comments` | `read` or `sync` | Read accessible file comment threads filtered by open, resolved or all state. |
| `add_comment` | `sync` | Add a file comment or reply, up to 4000 characters. Pass idempotency_key for retry safety. Quote anchors are not supported yet. |
| `set_comment_resolved` | `sync` | Resolve or reopen one comment thread. |
| `move_item` | `sync` | Move a file to a destination folder, preserving its filename and contents. Requires source path and if_match_hash from read_item, plus a stable idempotency_key. Destination folder editing permission is required. |
| `delete_item` | `sync` | Remove a file from the workspace while retaining its recovery copy. Requires path and if_match_hash from read_item and a stable idempotency_key. Permanent deletion is not supported. Use list_trash and restore_item to restore. |
| `list_trash` | `read` or `sync` | List currently deleted files you can access, with original paths and hashes. Does not list historical recovery copies or folders. |
| `restore_item` | `sync` | Restore a deleted file privately with its same identity and a new editing session. Requires original path/hash from list_trash and a stable idempotency_key. Optionally choose folder_path if the original location is occupied. Requires destination folder editing permission. |
| `list_document_templates` | `read` or `sync` | List validated built-in presentation templates and accessible Templates/*.textpack look definitions. Custom looks include source_item_id and source_hash; pin those when applying. This command does not edit or create templates. |
| `set_item_template` | `sync` | Apply a validated presentation while preserving document content, assets and audience. Requires current if_match_hash and a stable idempotency_key. Custom looks require source_item_id and source_hash from list_document_templates. Live editors receive the new presentation in their existing session. |
| `create_item_type` | `sync` | Create a new reusable look from a validated blueprint as a Templates TextPack. Requires a stable idempotency_key and template library editing permission. Does not modify folders or existing items. |
| `save_item_as_look` | `sync` | Save the current validated presentation and theme of an accessible item as a new Templates TextPack. Requires if_match_hash from read_item and a stable idempotency_key. Source writing and assets are not copied or changed; only declared template example content is retained. |
| `update_item_type` | `sync` | Create the next immutable workspace template version in a new Templates TextPack. Requires source_item_id/source_hash and base_version from list_document_templates, current source/library editing authority and a stable idempotency_key. Send the full edited blueprint for authored templates, or a full compatible definition for source-less looks. Existing files and pinned items remain unchanged; apply the new version separately with set_item_template. |
| `remix_item_type` | `sync` | Copy an exact built-in or accessible workspace template into a new Templates TextPack with its own identity and version 1. Requires a new name, stable idempotency_key and library editing access. Custom templates require source_item_id/source_hash from list_document_templates. Preserves validated presentation and authoring source; does not copy private document writing/assets or change existing items. |
| `retire_document_template` | `sync` | Retire a custom template identity from future creation and pickers using a file-backed library record. Requires source_item_id, source_hash and stable idempotency_key. Existing embedded documents stay unchanged. Explicitly deleting the retirement record restores availability; retrying this operation never recreates a deleted marker. |
| `set_folder_template` | `sync` | Set the pinned template for future generic items in one folder. Requires current folder view if_match_hash, or null to create a new definition, exact template version and stable idempotency_key. Custom templates require source_item_id/source_hash. Existing items and collection layout remain unchanged. Explicit template choices override this default. |
| `move_folder_tree` | `sync` | Move or rename an ordinary folder tree to an exact workspace-relative destination path. Stages a review of every file, folder and inherited access before execution. File contents and identities are preserved. Requires a stable idempotency key. This can change what readers can see. Obtain explicit human confirmation immediately before calling it. |
<!-- /generated:tool-table -->

## Source preconditions for generated field edits

`update_item.text_edit.source_precondition` optionally binds a field edit to
an independent source passage in the same item. For example, an excerpt edit
can require that the body passage used to generate it still matches. The
existing destination `field`, `start`, `end`, and `expected_text` guard remains
required. `selection_envelope`, when supplied, still guards that destination.

The source object uses the selection envelope format:

- `itemId`: the same item id as `update_item.id`.
- `field`: `title`, `excerpt`, or `body`.
- `revision`: the nonnegative safe integer revision read before generation.
- `start` and `end`: exact UTF-16 offsets, with an exclusive end, at most 1,000,000.
- `text`: the exact source passage, including whitespace, from 1 to 4,000
  UTF-16 code units. Its length must equal `end - start`.
- `hash`: lowercase hexadecimal SHA-256 of the UTF-8 encoding of
  `JSON.stringify([itemId, field, revision, start, end, text])`.

The hash binds the envelope; it does not grant access. Unknown properties and
malformed envelopes are refused. Both passages are checked against the loaded
authoritative document. The source revision and collaboration version/epoch
fence the same atomic append that writes the destination delta and its audit.
A changed source or failed fence returns the existing tool error shape:
`isError: true` with a text content block containing
"This passage changed or is not saved yet. Select it again after saving. Nothing changed."
Regenerate from a fresh selection after this refusal.

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
host using that product's model account. ChatGPT can use the OAuth consent flow
after the new source is deployed; the current production website has not been
updated. Other supported clients use a manual workspace token in a protected
bearer field. Plan, role, and workspace policy can limit which custom MCP
capabilities a host makes available.

## Free-text command

`run_command` (MCP) and `POST /api/agent/command` (HTTP, same `wsk_` bearer)
take one sentence and answer with the workspace command it means, arguments
included, validated by that command's schema. Reads run at once; a write is
returned as a plan unless `execute: true`. The candidates are exactly the
commands the connection could invoke directly (read tools for a read-only
connection, the local allowlist for the CLI, all of them for a full hosted
connection), and execution goes through the same executor, so scopes,
item-agent limits, staged proposals, and audit are unchanged. Common
sentences are read without a model; the rest use the workspace's own AI
key and say what is missing when there is none. The answer shape is
`{ status: "ran" | "planned" | "unmapped", plan?, result?, note?, reason? }`.

## Sibling surface: sync API

Bulk and file-level integrations use `/api/sync/v1`: workspace and folder
manifests with ETags, file GET/POST/PUT/PATCH/DELETE, change polling, assets,
and the bookmark capture pipeline. It uses the same `wsk_` bearer tokens but
requires `sync`. Existing-file mutations require current validators such as
`If-Match`. A sync DELETE also moves the item to Trash rather than permanently
deleting it.

### Item connection tokens

Prefer the item's Add agent control for a single-item connection. This reuses
`api_tokens` with one `item:<uuid>:read` or `item:<uuid>:edit` scope and a
seven-day expiry. It does not include `sync`. See
[Connect an agent from an item](agent-interoperability.md#connect-an-agent-from-an-item)
for client setup and the local shared-device limitation.

Item tokens use the same bearer parser, hash lookup, expiry, and revocation
checks as workspace tokens. Both hosted dispatch and the shared executor deny
all commands except exact-id `read_item`, content-only `update_item`, and
`append_to_item`; the latter two also require edit permission. Resource reads
and prompt retrieval are denied for item tokens. Sync and app-session exchange
reject them. Item reads omit backlinks, cross-item link resolution, and the
unusable sync file URL. An authenticated read publishes agent presence without
changing the document. Token ids, not client names, identify remote presence.
