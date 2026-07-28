# Texttext MCP workspace command reference

Texttext exposes one file-backed workspace command surface to three consumers:
the product UI, the workspace-configured assistant, and external agents over
MCP. The application calls the commands directly. It does not call its own MCP
endpoint.

`src/lib/ai/tools.ts` is the source of truth for the 31 tool names, schemas,
mutability, confirmation requirements, and MCP annotations. The MCP adapter
registers those definitions in `src/lib/mcp/tools.ts`.

## Endpoint and transport

- Endpoint: `https://{host}/api/mcp` using MCP Streamable HTTP.
- `/api/mcp/mcp` is also served for clients that append a transport segment.
- There is no legacy SSE endpoint. Send one POST per JSON-RPC message.
- `/.well-known/mcp.json` provides zero-configuration server discovery.
- An unauthenticated request returns a `WWW-Authenticate` challenge pointing
  to `/.well-known/oauth-protected-resource`.

## Authentication and OAuth lifecycle

The normal connection flow is OAuth authorization code with PKCE S256:

1. The client follows the protected-resource and authorization-server
   metadata advertised by Texttext.
2. Public clients can register at `/oauth/register` and request the least
   privilege they need: `read` or `sync`. A client that requests both
   advertised scopes receives effective `sync` access.
3. Texttext shows the signed-in owner a consent page naming the client and
   requested access. The owner must click Approve.
4. The authorization code exchange returns a `wsk_` bearer access token and a
   `wrt_` refresh token. Access tokens expire after 3,600 seconds.
5. Every refresh returns a new access token and a new refresh token. The old
   refresh token is consumed. Reusing it is treated as a replay and revokes
   the complete refresh-token family, including its access tokens.

Refresh-token families have a 180-day absolute lifetime and expire after 30
days without use. Owners can also revoke a connection immediately from
`/connect`. Access and refresh secrets are stored only as SHA-256 hashes.

Clients that cannot complete OAuth can create a manual `wsk_` token at
`/connect` and send it as:

```http
Authorization: Bearer wsk_...
```

Manual tokens currently carry `sync` access and remain valid until revoked.

## Scopes

| Scope | Access |
|-------|--------|
| `read` | Call the eight content-read tools: `get_workspace`, `list_folders`, `list_items`, `list_trash`, `read_item`, `search`, `list_comments`, and `list_item_assets`. |
| `sync` | Call all 31 tools, including the 22 mutations and access listings. It also grants every `read` operation. |

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

## Tools (31)

| Tool | Scope | Main input | Effect |
|------|-------|------------|--------|
| `get_workspace` | `read` or `sync` | none | Return workspace identity, supported modes, scope capabilities, and effective access. |
| `list_folders` | `read` or `sync` | none | List accessible folders with ids, paths, modes, parents, and counts. |
| `list_items` | `read` or `sync` | `folder_path?`, `limit?` | List live items in one folder with metadata, revision, and hash. |
| `list_trash` | `read` or `sync` | none | List soft-deleted item and folder restoration units. |
| `read_item` | `read` or `sync` | `id` | Return one live item as Markdown with metadata. |
| `search` | `read` or `sync` | `query`, `limit?` | Search accessible live titles, excerpts, and bodies. |
| `create_folder` | `sync` | `parent_path`, `name` | Create a subfolder that inherits its parent's mode and privacy rules. |
| `rename_folder` | `sync` | `folder_id`, `name` | Change a folder's display name while preserving its stable id and path. |
| `delete_folder` | `sync` | `folder_id` | Move a folder subtree and its live items to Trash. |
| `restore_folder` | `sync` | `folder_id` | Restore a folder subtree and the items deleted with it. |
| `create_item` | `sync` | `folder_path` plus `markdown`, or structured fields | Create one unpinned draft in the target folder. |
| `update_item` | `sync` | `id`, content, `if_match_hash?` | Update title, excerpt, and/or body without changing status, kind, folder, or pin state. |
| `append_to_item` | `sync` | `id`, `markdown_fragment`, `if_match_hash?` | Append Markdown to the body without changing metadata. |
| `move_item` | `sync` | `id`, `folder_path`, `if_match_hash?` | Move an item between folders of the same mode. |
| `delete_item` | `sync` | `id`, `if_match_hash?` | Soft-delete an item by moving it to Trash. |
| `restore_item` | `sync` | `id` | Restore one item from Trash with its previous status. |
| `set_item_status` | `sync` | `id`, `status`, `if_match_hash?` | Publish or unpublish a blog item. Notes and bookmarks reject publication. |
| `set_item_metadata` | `sync` | `id`, metadata, `if_match_hash?` | Update supported presentation metadata without changing content or status. |
| `set_item_pinned` | `sync` | `id`, `pinned`, `if_match_hash?` | Pin or unpin an item in workspace and public listings. |
| `list_access` | `sync` | `scope_type`, `scope_id?` | List direct workspace, folder, or item access grants. |
| `grant_access` | `sync` | target, `email`, `role` | Invite an email address with an explicit role. |
| `set_access_role` | `sync` | target, `access_id`, `role` | Change an existing direct access role. |
| `revoke_access` | `sync` | target, `access_id` | Revoke a direct access grant. |
| `list_comments` | `read` or `sync` | `id`, `state?` | List item comments, replies, anchors, and resolution state. |
| `add_comment` | `sync` | `id`, `body`, reply or anchor fields | Add a collaboration comment or reply. |
| `set_comment_resolved` | `sync` | `id`, `comment_id`, `resolved` | Resolve or reopen a comment thread. |
| `recapture_bookmark` | `sync` | `id`, `if_match_hash?` | Queue a fresh full bookmark capture without hiding the completed capture. |
| `list_item_assets` | `read` or `sync` | `id` | List referenced cover, body, gallery, video, capture, and screenshot assets. |
| `add_item_asset` | `sync` | `id`, `source_url`, `placement`, `if_match_hash?` | Import a public image or video into Texttext storage and attach it. |
| `remove_item_asset` | `sync` | `id`, `asset_url`, `if_match_hash?` | Remove item references to an asset without deleting shared storage. |
| `set_item_cover` | `sync` | `id`, `source`, cover fields, `if_match_hash?` | Set a URL cover, automatic cover selection, or no cover. |

The shared contract marks folder and item Trash/restore, publication changes,
access changes, and asset removal as requiring explicit human confirmation
immediately before the call. External clients are responsible for presenting
that confirmation. The in-app assistant gates those calls through its own
confirmation callback.

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

The workspace owner can connect an Anthropic or OpenAI API account and choose
the model used by the in-app assistant. The API key is encrypted on the server,
is write-only in Settings, and is sent only to the selected provider.

A ChatGPT or Claude consumer subscription does not include provider API usage.
People who want to work from those subscribed products can connect ChatGPT,
Claude, Cursor, or another MCP host to the endpoint documented here.

## Sibling surface: sync API

Bulk and file-level integrations use `/api/sync/v1`: workspace and folder
manifests with ETags, file GET/POST/PUT/PATCH/DELETE, change polling, assets,
and the bookmark capture pipeline. It uses the same `wsk_` bearer tokens but
requires `sync`. Existing-file mutations require current validators such as
`If-Match`. A sync DELETE also moves the item to Trash rather than permanently
deleting it.
