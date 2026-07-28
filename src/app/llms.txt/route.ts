// Platform-level llms.txt: what Texttext is and where its machine surfaces
// live, for agents landing on the root domain. Per-blog llms.txt (under
// /@{username}/llms.txt) indexes one blog's posts; this file describes the
// platform. Terse and factual on purpose.

import {
  WORKSPACE_TOOL_DEFINITIONS,
  WORKSPACE_TOOL_NAMES,
} from "@/lib/ai/tools";
import { rootDomainUrl } from "@/lib/site-url";

export function GET() {
  const origin = rootDomainUrl().origin;
  const readTools = WORKSPACE_TOOL_NAMES.filter(
    (name) => WORKSPACE_TOOL_DEFINITIONS[name].mutability === "read",
  );
  const mutationTools = WORKSPACE_TOOL_NAMES.filter(
    (name) => WORKSPACE_TOOL_DEFINITIONS[name].mutability === "write",
  );

  const text = `# Texttext

Texttext is a publishing platform. Each blog is a workspace of folders, and every
item in a folder is a Markdown file with metadata frontmatter and a body.
Folder modes:

- blog: public writing (kinds: article, media_post, video_post)
- notes: private notes, always unlisted
- bookmarks: private saved links, always unlisted

## Public surfaces, per blog

Base URL: ${origin}/@{username}

- {base}/llms.txt: published posts with summaries and Markdown file links
- {base}/folder.json: manifest of published items, sha256 hash per file
- {base}/posts.json: published posts as JSON
- {base}/{slug}/index.md: one post as its Markdown file
- {base}/feed.xml, {base}/atom.xml, {base}/feed.json: feeds
- {base}/sitemap.xml: sitemap

## Authenticated MCP surface

MCP Streamable HTTP endpoint: ${origin}/api/mcp

The endpoint advertises OAuth discovery from its unauthenticated 401 response.
The click-to-approve flow uses authorization code with PKCE S256. Clients
should request the least privilege they need:

- read: ${readTools.length} workspace inspection tools
- sync: all ${WORKSPACE_TOOL_NAMES.length} tools, including access management and mutations

A client requesting both advertised scopes receives effective sync access.

OAuth access tokens begin with wsk_ and expire after 3,600 seconds. Each token
exchange also returns a wrt_ refresh token. Refresh tokens rotate on every use;
reusing a consumed refresh token revokes the complete token family. Refresh
access has a 180-day absolute lifetime and a 30-day inactivity lifetime.

Clients without OAuth can create a manual sync-scoped wsk_ bearer token at
${origin}/connect. Manual tokens remain valid until revoked. Send access tokens
as "Authorization: Bearer wsk_...".

The shared ${WORKSPACE_TOOL_NAMES.length} tools are:

- Read: ${readTools.join(", ")}
- Mutations: ${mutationTools.join(", ")}

Protocol-native context:

- texttext://agent-guide: reliability, privacy, and automation rules
- texttext://workspace: connected workspace and visible folders
- texttext://items/{id}: one item with Markdown, metadata, and assets

Reusable prompts:

- maintain_project_documents: one durable document per project with retry-safe updates
- use_live_document_canvas: keep one visible item current while a person and agent work together
- capture_conversation: save useful prompts, answers, and decisions
- prepare_release_note: append one release entry exactly once

delete_item and delete_folder are soft deletes. list_trash exposes restorable
items and folder restoration units. restore_item and restore_folder restore
them. A restored published item can become public again. There is no
permanent-delete MCP tool.

The command surface also manages direct workspace, folder, and item access;
collaboration comments; bookmark recapture; and item cover and asset references.
Every mutation is audited.

New items are drafts. Notes and bookmarks cannot publish. Existing-item writes
should send the latest if_match_hash; stale writes are rejected. Every mutation
is audited.

Automations should pass idempotency_key to create_item and append_to_item.
Derive creation keys from stable source identities, such as repository URLs.
Derive append keys from stable events, such as commit SHAs or release versions.
Reuse the same key after a timeout. Successful replays return replayed: true and
do not duplicate content.

## Sync API and OpenAPI actions

Sync API: ${origin}/api/sync/v1

The sync API requires the sync scope for every route. It provides workspace and
folder manifests, file GET/POST/PUT/PATCH/DELETE, changes, assets, and bookmark
capture. Existing-file mutations use If-Match conflict checks. DELETE moves an
item to Trash.

OpenAPI actions: ${origin}/openapi.json

The OpenAPI document is a smaller sync-backed action surface, not the complete
${WORKSPACE_TOOL_NAMES.length}-tool MCP contract.

## In-app assistant

The workspace owner can connect an Anthropic or OpenAI API account and choose
the model used by the in-app assistant. It calls the same
${WORKSPACE_TOOL_NAMES.length} workspace commands directly through the signed-in
page and does not use Texttext's MCP endpoint. ChatGPT, Claude, Cursor, and
other hosts can connect as external MCP clients.

Human setup: ${origin}/docs/ai. Approval flow: ${origin}/api/mcp advertises OAuth from its 401.
`;

  return new Response(text, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
