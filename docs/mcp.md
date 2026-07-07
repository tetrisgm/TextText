# The Write MCP: manipulate markdown files over folders

Write's machine surface is deliberately simple: **a workspace is folders of
markdown files**. The MCP server exposes exactly that. Any AI that can call
MCP tools can list folders, read files, create files, and edit files, and
that is the whole content model; there is nothing else to learn.

This document is the integration contract for third parties (Claude,
ChatGPT, or anything speaking MCP over Streamable HTTP).

## Endpoint and transport

- Endpoint: `https://{host}/api/mcp` (Streamable HTTP; also served at
  `/api/mcp/mcp` for clients that append the transport segment).
- SSE is not offered. One POST per JSON-RPC message.
- Server framework: `mcp-handler` + `@modelcontextprotocol/sdk`.

## Authentication

Bearer tokens, minted by the human at `https://{host}/connect`:

```
Authorization: Bearer wsk_...
```

- Tokens are stored hashed (SHA-256); a leaked database row cannot be
  replayed. Revocation at `/connect` is immediate.
- A token maps to its owner's ONE workspace. There is no cross-tenant
  access and no way to name another workspace: tenant isolation is by
  construction, not by checks inside tools.
- Missing/invalid token: proper MCP 401 with `WWW-Authenticate`.
- Scopes exist on the token (`sync` today) but all MCP tools currently
  assume workspace access; finer scopes are roadmap.

Claude Code config example:

```json
{
  "mcpServers": {
    "write": {
      "type": "http",
      "url": "https://{host}/api/mcp",
      "headers": { "Authorization": "Bearer wsk_..." }
    }
  }
}
```

## The content model (read this, skip the rest)

- A workspace holds **folders**; each folder has a full slash `path`
  ("blog", "notes", "bookmarks", "blog/ideas", ...) and a `mode`.
- Modes: `blog` items can publish; `notes` and `bookmarks` items are
  **unlisted forever** (enforced server-side at every layer; no agent can
  publish a note, ever).
- Subfolders inherit their parent's mode and act as categories. Nesting
  caps at four levels.
- An **item is a markdown file**: single-line JSON-ish frontmatter between
  `---` fences, then the body. `read_item` returns exactly the bytes the
  sync API serves; `create_item`/`update_item` accept the same format.
- Every item has a content `hash` (sha256 of the rendered file). Pass it
  back as `if_match_hash` on updates for conflict safety (compare-and-swap).

## Tools (8)

| Tool | Input | Effect |
|------|-------|--------|
| `list_folders` | none | Folders (id, name, path, mode, parentId) + blog meta |
| `create_folder` | `parent_path`, `name` | New subfolder (category) under an existing folder |
| `list_items` | `folder_path?` (default "blog") | Manifest entries for one folder |
| `read_item` | `id` | The markdown file, verbatim |
| `create_item` | `folder_path`, `markdown` | New item (always created as draft) |
| `update_item` | `id`, `markdown`, `if_match_hash?` | Replace the file (412-style error on hash mismatch) |
| `append_to_item` | `id`, `markdown_fragment` | Append to the body, everything else untouched |
| `search` | `query` | Substring search over title/excerpt/body, 25 results |

There is deliberately no delete tool and no publish tool: destructive and
audience-changing acts stay with the human (or the sync API where If-Match
discipline is mandatory).

## Rules for agents (also served at /docs/ai and /llms.txt)

1. Create as drafts; ask the human before publishing anything.
2. Never try to publish notes or bookmarks (the server refuses anyway).
3. Read-modify-write with `if_match_hash`; on conflict, re-read.
4. Every mutation is audited (actor type `external_agent`, per-token
   attribution). Assume the human reviews the log.

## The audit trail

Every mutation writes an `action_audit` row: actor user, actor type
(`human` / `ai` / `external_agent`), action name (`mcp.create_item`, ...),
target, and a clipped summary. Nothing an agent does is silent.

## Sibling surface: the sync API

Bulk/file-level integrations (the Mac app, backup scripts) use the sync API
instead: `GET /api/sync/v1/workspace`, per-folder manifests with ETags,
file GET/POST/PUT/DELETE with mandatory `If-Match`, `GET /changes`
long-poll for near-instant change signals, and the bookmark capture
pipeline (`GET /captures`, `PUT /captures/{id}`). Same bearer tokens. The
markdown format is byte-identical between both surfaces.

## Native integrations roadmap (ChatGPT and friends)

Bearer-token MCP works TODAY with any client that lets the user paste a
header (Claude Code, Claude.ai custom connectors, local MCP hosts).
Connector directories that require OAuth (ChatGPT connectors, some hosted
agent platforms) need one addition on our side, in order:

1. OAuth 2.1 authorization-code + PKCE in front of token minting (the
   /connect page already owns the consent surface; the grant should mint a
   scoped `wsk_` token per authorization).
2. Dynamic client registration (RFC 7591) if the target directory demands
   it; otherwise a fixed client id per directory.
3. MCP `WWW-Authenticate` OAuth metadata is already emitted by the auth
   layer, so discovery mostly works once the endpoints exist.

Until then, ChatGPT-side integration is possible through Actions (OpenAPI
over the sync API with the bearer token), which needs only an OpenAPI file;
see `docs/PLAN-2026-07-07.md` for where that sits in the queue.
