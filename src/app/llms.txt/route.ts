// Platform-level llms.txt: what Write is and where its machine surfaces
// live, for agents landing on the root domain. Per-blog llms.txt (under
// /@{username}/llms.txt) indexes one blog's posts; this file describes the
// platform. Terse and factual on purpose.

import { rootDomainUrl } from "@/lib/site-url";

export function GET() {
  const origin = rootDomainUrl().origin;

  const text = `# Write

Write is a publishing platform. Each blog is a workspace of folders, and every
item in a folder is a markdown file: single-line "key: value" frontmatter,
then the body. Folder modes:

- blog: public writing (kinds: article, media_post, video_post)
- notes: private notes, always unlisted
- bookmarks: private saved links, always unlisted

## Public surfaces, per blog

Base URL: ${origin}/@{username}

- {base}/llms.txt: published posts with summaries and markdown file links
- {base}/folder.json: manifest of published items, sha256 hash per file
- {base}/posts.json: published posts as JSON
- {base}/{slug}/index.md: one post as its markdown file
- {base}/feed.xml, {base}/atom.xml, {base}/feed.json: feeds
- {base}/sitemap.xml: sitemap

## Authenticated surfaces (blog owners)

Tokens are created at ${origin}/connect and sent as
"Authorization: Bearer wsk_...".

- MCP server, streamable HTTP: ${origin}/api/mcp
  Tools: list_folders, list_items, read_item, create_item, update_item,
  append_to_item, search. There is no delete tool; deletion needs the owner.
- Sync API: ${origin}/api/sync/v1
  GET /workspace, GET /folders/{folderId}/manifest,
  GET|PUT|DELETE /files/{postId}, POST /files.
  PUT requires If-Match with the file's ETag; a stale hash answers 412.
  OpenAPI schema for ChatGPT Actions: ${origin}/api/sync/v1/openapi.json

Human setup guide: ${origin}/docs/ai
`;

  return new Response(text, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
