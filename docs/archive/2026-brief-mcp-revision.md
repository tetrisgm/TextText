# TextText MCP, Paper-grade: implementation and documentation brief

> **ARCHIVED / DELIVERED (historical record).** This Paper-grade MCP revision brief
> was delivered. For the CURRENT surface see `docs/mcp.md` and
> `docs/agent-interoperability.md`; `src/lib/ai/tools.ts` is the source of truth
> for tool names. Nothing below is current project status.

## Task

Revise TextText's MCP integration to the level of craft in `paper.design/docs/mcp`, in both the running implementation and the documentation. Consolidate the tool surface (31 tools becomes 26: 8 read, 18 write), normalize result envelopes, surface the just-landed `tags` and `[[wikilinks]]`, and rewrite the connect docs into Paper's six-part shape. Do this as one coherent change across the shared command surface, the MCP layer, the Swift native contract, the docs, and the OAuth release gate.

Repo: `~/dev/TextText`, branch `main` (work in place, uncommitted). Stack: Next.js App Router (this is NOT stock Next.js; APIs differ from training data, consult `node_modules/next/dist/docs/` before writing framework code). Web app plus its own docs pages. Public MCP endpoint: `https://TextText.app/api/mcp`.

Standard to match: `paper.design/docs/mcp` for simplicity, thoroughness, and craft. Copy voice everywhere: verb-first, sentence case headings, second person, present tense, example prompts written as quoted user requests, no marketing. NO em dashes anywhere in code, copy, or docs.

## Hard constraints (do not violate any of these)

- **`WORKSPACE_TOOL_DEFINITIONS` is the shared THREE-consumer command surface, not an MCP-only registry.** AGENTS.md binds it: the editor UI, the Apple on-device assistant, and the MCP server all call the same workspace commands. Any tool removed, renamed, or reshaped must be updated in lockstep across the web executor, the in-app assistant, the editor actions, AND the hand-maintained Swift contract, or the build and parity tests go red. This is the single biggest failure mode of a naive edit.
- **Notes and bookmarks are unlisted FOREVER.** The `isAlwaysDraftType` guards in `create_item`, `update_item`, `set_item_status`, and `restore_item` stay. No tool merge may let a note or bookmark become published.
- **`src/lib/store.ts` remains the only content access point, and every mutation writes an `action_audit` row.** No new content path. No mutation without an audit row.
- **The OAuth approve route must NOT use `Response.redirect()`.** It uses `next/navigation` `redirect()` (a thrown `NEXT_REDIRECT`). Leave it exactly as is. `Response.redirect` 500s the approval because of immutable headers.
- **`python3 scripts/test-oauth-mcp-loop.py` must pass.** It asserts an EXACT ORDERED tool list (see correction 7 below), not just a set of names.
- **`tags` and `[[wikilinks]]` just landed and must be reflected** in read and update results. A wikilink parser already exists; do not write a second one (see correction 2).
- **No localhost / no-auth docs.** Our server is hosted OAuth. Docs describe the hosted URL and click-to-approve OAuth, plus a bearer-token fallback for no-OAuth hosts. There is no local-server story.
- **Markdown files round-trip byte-for-byte.** Computed fields (`tags`, wikilinks, backlinks) live ONLY in the JSON envelope, never in the file body. `parsePostMarkdownFile` rejects unknown frontmatter keys, so serializing a computed field into frontmatter breaks round-trip.
- **Do not break `/api/sync/v1`, the OpenAPI action surface, collaboration guards, or any MCP privacy invariant.** Only MCP tool definitions, the shared metadata mutators being folded, the `McpItemEntry` shape, and docs change. `McpItemEntry.file` still points at `/api/sync/v1/files/{id}`.
- Do not touch scope names (`read`, `sync`), well-known paths, or the approve route.

## Orienting facts (current state, verified)

- 31 registered tools. The `/docs/ai` lede hardcodes "17" (`src/app/docs/ai/page.tsx:97`), which is stale; derive every count from `WORKSPACE_TOOL_NAMES` / `WORKSPACE_TOOL_DEFINITIONS`.
- The write side sprawls: four item-metadata mutators (`set_item_status`, `set_item_metadata`, `set_item_pinned`, `set_item_cover`), a redundant `list_item_assets`, and a redundant `set_access_role` alongside `grant_access`.
- `read_item` returns raw markdown text; every other tool returns JSON. Envelopes are inconsistent (`{item}`, `{changed,item}`, `{ok,id,trashed}`, `{query,results}`).
- Auth is sound: `withMcpAuth` + `enforceMcpToolScope`, PKCE S256, `wsk_`/`wrt_` rotation, well-knowns at root and at the `/api/mcp` path.
- `llms.txt` (`src/app/llms.txt/route.ts:14-18,50-66`) is ALREADY fully derived from `WORKSPACE_TOOL_NAMES` / `WORKSPACE_TOOL_DEFINITIONS`. It updates itself once tools.ts changes. Do not re-hardcode any count or name there.

---

## PART 1 - Implementation

### 1a. Result-shape normalization (do this first; it touches many tools)

Extend `McpItemEntry` in `src/lib/mcp/items.ts`, populated by `itemEntry(blog, post)`, with three computed fields. **Name them so they do not collide with the existing frontmatter `links` key** (`markdown-files.ts` treats `links` as project/talk external URLs via `addLinks`/`fieldLinks`/`post.links`, and `markdownContentUpdate` protects `["links", post.links]`). Use:

```
tags: string[]                 // normalizeTags(post.tags); always present, may be []
wikilinks: WikiLink[]          // outbound [[...]] parsed from body (NOT named `links`)
backlinks: BacklinkRef[]       // items whose body links to this one (read_item only)
```

- `WikiLink = { raw: string; targetId?: string; targetSlug?: string; title?: string; resolved: boolean }`. Unresolved links keep `resolved:false` so an agent can create the missing note.
- `BacklinkRef` identifies the linking item (id, slug, title). **Exclude trashed items and unresolved/tombstoned targets** so the graph is not polluted by deleted notes.
- **Do NOT create a new parser.** `src/lib/wikilinks.ts` already exports `extractWikiLinks(markdown)` (code-fence aware) and `src/lib/wikilink-syntax.ts` exports `splitWikiLinkText`; `resolveWikiLinkRenderTargets` already resolves targets with a fail-closed private-type guard (`renderTargetForResolution` drops notes/bookmarks/drafts on public paths). Build `wikilinks` and `backlinks` on top of `extractWikiLinks` plus the existing resolver. A parallel parser would drift from the renderer and could re-introduce the private-note leak the existing resolver prevents.
- `backlinks` is computed only for `read_item` (a full-workspace scan). List and search entries carry `tags` and `wikilinks` but omit `backlinks` (too expensive per entry).

**One envelope for every tool that returns an item:**

- List tools: `{ folder?, items: McpItemEntry[] }`.
- `read_item`: `{ item: McpItemEntry, markdown: string, assets: AssetRef[] }` (JSON now, not raw text). **`markdown` and `item.hash` MUST come from ONE render.** Use `renderItemFile(blog, post)` once; it returns `{text, hash}` together. Feed `text` into `markdown` and `hash` into `item.hash` so they never diverge and the `if_match_hash` CAS stays valid. `assets` is `listItemAssetReferences(post)`. This absorbs `list_item_assets`. `tags`/`wikilinks`/`backlinks` live only in the JSON envelope, never in `markdown`.
- Every mutation returns `{ item: McpItemEntry }`. Keep booleans only where they carry real meaning: deletes return `{ item, trashed: true }`, restores `{ item, restored: true }`, `recapture_bookmark` returns `{ item, queued: true }`. Remove the no-op `{changed:false,item}` early returns; returning the unchanged item is enough.

### 1b. READ tools - keep 8, tighten descriptions

| Tool | Change | Verb-first one-line description |
|---|---|---|
| `get_workspace` | keep | "Return this workspace's handle, name, your effective access, and server capabilities." |
| `list_folders` | keep | "List every folder you can see with its id, path, mode, and item count." |
| `list_items` | keep | "List the live items in one folder with their ids, titles, tags, status, and content hash." |
| `read_item` | improve (now JSON) | "Read one item's markdown, metadata, tags, outbound links, backlinks, and assets by id." |
| `search` | keep | "Search item titles, excerpts, and bodies you can access, and return matches with snippets." |
| `list_trash` | keep | "List soft-deleted items and folder restore-units. Nothing here is permanently deleted." |
| `list_comments` | keep | "List comment threads on one item, with anchored quotes and resolution state." |
| `list_access` | keep | "List who can access the workspace, one folder, or one item, and their role." |

`read_item` is the one behavioral change (text becomes the JSON envelope with `tags`/`wikilinks`/`backlinks`/`assets`). An agent that reads an item now sees its tags and link graph without a second call.

### 1c. WRITE tools - 18, after 5 removals

**Remove these five names entirely** (folded into a survivor). All five are on the shared surface, so removal cascades across consumers (see 1e):

- `set_item_metadata` → folded into `update_item`.
- `set_item_pinned` → folded into `update_item` (optional `pinned`).
- `set_item_cover` → folded into `update_item` (`cover` / `cover_caption` / `cover_height`; the "asset must be imported first" guard moves into `update_item`).
- `list_item_assets` → folded into the `read_item` result (`assets[]`).
- `grant_access` AND `set_access_role` → BOTH replaced by a single `set_access` upsert. (The design's checklist omitted `grant_access`; it must be removed too, or the count is wrong.)

**`update_item` - the one item-patch tool** (merges the three `set_item_*` mutators). Schema:

```
update_item({
  id,
  // content
  title?, body?, excerpt?|null, tags?: string[], markdown?,   // markdown XOR structured, as today
  // owner-only metadata (rejected for non-owner editors, per current guards)
  slug?, accent?|null, cover?|null, cover_caption?|null, cover_height?|null,
  date?,           // YYYY-MM-DD, only on an already-published item
  pinned?: boolean,
  if_match_hash?,
})
```

- Description: "Update one item's content or metadata: title, body, excerpt, tags, slug, cover, pin, and publication date. Cannot publish, unpublish, or move an item." The explicit "Cannot publish/move" clause is what stops mis-calls toward `set_item_status` / `move_item`.
- Keep every existing invariant: non-owner editors may only touch `title` / `body` / `tags` (via `savePostContentPatch`); `date` only when published; notes/bookmarks forced to `draft`; live co-editor body guard; `cover` url must reference an already-imported asset.
- `tags` is a full-list replace (matches `normalizeTags`). Document on the field: "The complete tag list; replaces existing tags."
- **Audit:** emit one `mcp.update_item` row whose `inputSummary` names the changed field groups. Additionally append an `mcp.pin_item` / `mcp.unpin_item` row when `pinned` flips, to preserve public-ordering audit fidelity. Fold the old `mcp.set_item_metadata` and `mcp.set_item_cover` audit rows into `mcp.update_item`.
- **Markdown-path asymmetry (must be resolved explicitly).** `markdownContentUpdate` (`src/lib/mcp/tools.ts:385-446`, guard at 408-435) currently rejects any change to `slug/status/date/accent/cover/coverCaption/coverHeight/pinned/...` sent via a full `markdown` file. As written, `update_item` would accept a cover change via a structured arg but 400 the same change via frontmatter. Resolve it this way: **keep `markdownContentUpdate` rejecting `status`, `type`, and any folder-implying key** (this preserves "cannot publish/move"), but **relax it to accept the now-updatable owner metadata keys** (`slug`, `accent`, `cover`, `coverCaption`, `coverHeight`, `date`, `pinned`) so the structured path and the markdown path have identical capability. State this behavior in the tool description and in code comments.

**Keep these, with tightened descriptions:**

| Tool | Verb-first description | Schema notes |
|---|---|---|
| `create_item` | "Create one draft item in a folder from fields or a full markdown file. Never published, never pinned." | unchanged; `markdown` XOR structured. **Update the error string at `src/lib/mcp/tools.ts:750`** which currently says "Create it first, then use set_item_pinned." to point at `update_item`'s `pinned`. |
| `append_to_item` | "Append a markdown block to the end of one item's body without touching its metadata." | keep; the capture-into-notes workhorse. Note: its `markdown_fragment` param is MCP-only and deliberately absent from the native surface (`native-tool-parity.test.ts:55`). |
| `set_item_status` | "Publish or unpublish one blog item. Notes and bookmarks can never be published." | audience-gated; kept separate from `update_item`. |
| `move_item` | "Move one item to another folder of the same mode." | unchanged; keeps the cross-mode block. |
| `delete_item` | "Move one item to Trash. It stays restorable; this never permanently deletes." | returns `{item, trashed:true}`. |
| `restore_item` | "Restore one item from Trash with its previous status." | returns `{item, restored:true}`. |
| `add_item_asset` | "Import one public image or video URL into TextText and attach it as cover, body, or gallery." | openWorld; unchanged. |
| `remove_item_asset` | "Remove references to one asset URL from an item's cover, body, and gallery." | unchanged. |
| `recapture_bookmark` | "Re-fetch one bookmark from its saved URL. The current capture stays visible until the new one lands." | openWorld; returns `{item, queued:true}`. |
| `add_comment` | "Add a comment or reply on one item, optionally anchored to an exact quote." | unchanged. |
| `set_comment_resolved` | "Resolve or reopen one comment thread." | unchanged. |
| `create_folder` | "Create a subfolder under an existing folder path; it inherits the parent's mode and privacy." | unchanged. |
| `rename_folder` | "Rename one folder. Its id and path do not change." | unchanged. |
| `delete_folder` | "Move one folder subtree to Trash. Restorable; never permanently deleted." | unchanged. |
| `restore_folder` | "Restore one folder subtree from Trash." | unchanged. |
| `revoke_access` | "Revoke one person's access to the workspace, a folder, or an item." | unchanged. |

**`set_access` - new (merges `grant_access` + `set_access_role`), upsert by email:**

```
set_access({ scope_type, scope_id?, email, role })
```

- Description: "Grant or change one person's role on the workspace, a folder, or an item, by email."
- Internally: if a share for that email exists on the scope, update its role; else invite. Removes the `access_id` indirection an LLM had to fetch first. Keep the `validateAccessTarget` role/scope refinement.

**Final write set (18):** `create_item`, `update_item`, `append_to_item`, `set_item_status`, `move_item`, `delete_item`, `restore_item`, `add_item_asset`, `remove_item_asset`, `recapture_bookmark`, `add_comment`, `set_comment_resolved`, `create_folder`, `rename_folder`, `delete_folder`, `restore_folder`, `set_access`, `revoke_access`.

**No new tools beyond `set_access`.** TextText has no canvas-selection lifecycle, so no `finish_working_on_nodes` analogue; the hash/revision CAS already fills that role.

**Alias / deprecation decision (state it explicitly in the output).** The parity test comment notes a legacy-alias mechanism already exists. Recommended: hard-remove the five names (pre-1.0 is defensible) and do NOT keep aliases, so the surface stays clean. If you instead keep short-lived aliases for already-connected external agents, they must be kept out of the native surface exactly as the existing aliases are. Whichever you choose, call the decision out in the final report rather than leaving it implicit.

### 1d. Privacy / sync invariants (restated as the guardrail)

- Notes and bookmarks stay `draft`/unlisted at the action layer regardless of tool merges. Keep every `isAlwaysDraftType` guard.
- Every mutation still writes `action_audit`; `store.ts` remains the only content path; `move_item` keeps the cross-mode block.
- `/api/sync/v1` and the OpenAPI action surface are untouched. `McpItemEntry.file` still points at `/api/sync/v1/files/{id}` so the HTTP twin stays valid.

### 1e. Shared-surface cascade (the removals/renames touch these consumers - all must be updated in lockstep)

- `mac/Sources/TextText/NativeAI.swift` - holds `agentToolContractJSON`, a hand-maintained copy of the tool contract. Regenerate it to match the new 26-tool surface. `src/lib/ai/__tests__/native-tool-parity.test.ts:41` asserts `nativeToolContract()` deep-equals `WORKSPACE_TOOL_NAMES`, and `:56` asserts `schemas.set_item_pinned.properties.pinned`. Update that assertion to the folded `update_item.properties.pinned`. Removing a tool from the surface without updating the Swift contract fails the parity test and the build.
- `src/app/editor/actions.ts:1326` references `"set_item_cover"` - route it to `update_item`.
- `src/components/workspace/assistant/useNativeAssistant.ts:150-151,591` - the label map and `executor("set_item_metadata", ...)` call. Update to `update_item` (and fold cover/pin labels).
- `src/lib/ai/agent-tools.ts:471-479` - the access-tool confirmation special-casing on `grant_access` / `set_access_role`. Fold both branches into a single `set_access` branch. Keep `confirmDestructive` behavior for the audience-changing and destructive tools.
- `src/lib/ai/__tests__/tools.test.ts` - the name list plus `parseWorkspaceToolInput("set_item_metadata", ...)`; update to the new names.
- `src/components/workspace/assistant/__tests__/native-assistant.test.ts:353` - update the referenced tool name.

### 1f. Auth / well-known (verify; fix only if a check fails)

- `/.well-known/oauth-authorization-server` must advertise `scopes_supported: ["read","sync"]`, `code_challenge_methods_supported: ["S256"]`, and the `registration_endpoint`. Confirm present.
- Both PRM documents must resolve: root `/.well-known/oauth-protected-resource` AND the resource-specific `/.well-known/oauth-protected-resource/api/mcp`. Keep the 401 in `withMcpAuth` pointing `resource_metadata` at the `/api/mcp` variant.
- `enforceMcpToolScope` must keep answering read-only mutation attempts with **403 `insufficient_scope`** (not 401) so a `read` client degrades cleanly instead of looping the OAuth dance. It is already correct; add a test asserting a `read`-scope `update_item` returns 403.
- Do NOT touch scope names, well-known paths, or the approve route's `redirect()`.

### 1g. Files to touch (implementer checklist)

- `src/lib/ai/tools.ts`: remove `set_item_metadata`, `set_item_pinned`, `set_item_cover`, `list_item_assets`, `grant_access`, `set_access_role`; expand `update_item` schema (`slug`, `accent`, `cover`, `cover_caption`, `cover_height`, `date`, `pinned`); add `set_access`; rewrite all descriptions per 1b/1c. The final object-literal insertion order determines `tools/list` order and the OAuth-loop assertion order - order deliberately: 8 read tools first (as in 1b), then the 18 write tools (as listed in 1c).
- `src/lib/mcp/items.ts`: add `tags` / `wikilinks` / `backlinks` to `McpItemEntry` and `itemEntry`, built on `src/lib/wikilinks.ts` `extractWikiLinks` plus the existing resolver. Exclude trashed/tombstoned targets from backlinks.
- `src/lib/mcp/tools.ts`: fold the three metadata mutators into the `update_item` case (keep every owner-only, audience, co-editor, and `isAlwaysDraftType` guard; emit `mcp.pin_item`/`mcp.unpin_item` on pin flip; fold `mcp.set_item_metadata`/`mcp.set_item_cover` audit into `mcp.update_item`); relax `markdownContentUpdate` (385-446) per 1c while keeping `status`/`type`/folder-keys rejected; make `read_item` return `{item, markdown, assets}` from one `renderItemFile` call; fix the `create_item` error string at line 750; merge `grant_access`+`set_access_role` into a `set_access` upsert; normalize every mutation to the `{item}` envelope.
- `mac/Sources/TextText/NativeAI.swift`: regenerate `agentToolContractJSON` to the new surface.
- `src/app/editor/actions.ts`, `src/components/workspace/assistant/useNativeAssistant.ts`, `src/lib/ai/agent-tools.ts`: update per 1e.
- Tests: `src/lib/mcp/__tests__/tools.test.ts` (renamed/removed tools; add read-scope-mutation-403 test; add tags-round-trip test; update the `mcp.set_item_cover` audit assertion at `:951` to `mcp.update_item`), `src/lib/ai/__tests__/tools.test.ts`, `src/lib/ai/__tests__/native-tool-parity.test.ts` (update `:56` pinned assertion), `src/components/workspace/assistant/__tests__/native-assistant.test.ts:353`.
- `scripts/test-oauth-mcp-loop.py`: rewrite `EXPECTED_TOOLS` (lines 37-68) to the exact ordered 26-name list matching the final object-literal order, including `set_access`; the equality at line 287 is ORDERED, so order must match. `EXPECTED_OPEN_WORLD_TOOLS` stays `{recapture_bookmark, add_item_asset}`.

---

## PART 2 - Documentation

Rewrite `src/app/docs/ai/page.tsx` into Paper's six-part shape. Remove the hardcoded "17" at line 97; derive every count from `WORKSPACE_TOOL_NAMES`. Voice contract: verb-first, sentence case headings, quoted user requests as example prompts, no em dashes, no marketing, second person, present tense.

### Section headings, in order

**1. `# Connect your AI to TextText`** (page title)

**2. `## Overview`**
- What an MCP server is: "An MCP server is an authenticated API that an AI assistant can call on your behalf. Connect one once, and your assistant can read and write your TextText workspace from wherever it runs."
- What TextText's server does: reads and writes the folders and markdown items in your one workspace; respects your sharing; keeps notes and bookmarks unlisted; logs every change.
- The URL, stated once, in a code block: `https://TextText.app/api/mcp`.
- One line on scopes: `read` inspects, `sync` also writes; the approval page shows which one a client asked for.

**3. `## Getting started`** - one copy-paste block per client, each three lines max (command, then "then approve in your browser," nothing else), in this order:
- **Claude Code (CLI):** `claude mcp add --transport http texttext https://TextText.app/api/mcp` then run `/mcp` and approve in the browser.
- **Claude Desktop / claude.ai:** Settings → Connectors → Add custom connector → paste the URL → Add → Approve.
- **Cursor:** the "Add to Cursor" deeplink button (already generated in the doc) or `.cursor/mcp.json`: `{ "mcpServers": { "texttext": { "url": "https://TextText.app/api/mcp" } } }`
- **VS Code / Copilot:** `.vscode/mcp.json` (key is `servers`, needs `type`): `{ "servers": { "texttext": { "type": "http", "url": "https://TextText.app/api/mcp" } } }`
- **Codex CLI:** `~/.codex/config.toml`: `[mcp_servers.texttext]` / `url = "https://TextText.app/api/mcp"` (streamable HTTP; Codex runs the OAuth flow).
- **Any other client:** mcp-remote fallback `{ "mcpServers": { "texttext": { "command": "npx", "args": ["-y", "mcp-remote", "https://TextText.app/api/mcp"] } } }`, plus the manual-token option: mint a `sync` token at `/connect` and pass `Authorization: Bearer wsk_...` in the client's `headers`.

**4. `## Verifying the connection`** - one prompt: "Ask your assistant: *'What folders are in my TextText workspace?'* It calls `list_folders`, asks to connect if it has not, and lists Blog, Notes, and Bookmarks." (Read-only, zero side effects, works on `read` scope.)

**5. `## Troubleshooting`** - front-load the number-one cause first, Paper-style:
- **"Reconnect a stale session."** "The most common problem is a long-running assistant session that connected before you approved access. Restart the session (or run `/mcp` in Claude Code) and try again."
- "The client shows no TextText tools" → restart the MCP host after editing config.
- "Approval page will not open" → the client lacks OAuth; mint a token at `/connect` and use the bearer-header config.
- "A write was rejected as a conflict" → the item changed since you read it; read it again and retry (this is the hash guard working).
- "Read-only connection" → you approved `read`; reconnect and approve `sync` to write.

**6. `## Guides`** - the three narrative workflows from Part 4.

**7. `## Reference`** - two tables (read then write), one line each, generated from `WORKSPACE_TOOL_DEFINITIONS` so counts and descriptions never drift:
- **Read tools** (8): name + description. One sentence above: "Any connected assistant can call these."
- **TextText tools** (18): name + description. One sentence above: "These require the `sync` scope. TextText marks publishing, moving to Trash, restoring, and sharing as destructive or audience-changing; clients that support confirmations will ask you first." (Do not claim all clients confirm; confirmation is a client-honored annotation for arbitrary MCP clients, only enforced for the in-app assistant via `agent-tools.ts confirmDestructive`.)
- Below the tables, keep at most five total bullets: how approval works, audit log, soft-delete only, revoke anytime, prompt-injection caution.

### `llms.txt` (`src/app/llms.txt/route.ts`)

It is ALREADY derived from `WORKSPACE_TOOL_NAMES` / `WORKSPACE_TOOL_DEFINITIONS`, so it updates itself once tools.ts changes. **Do not re-hardcode any name or count.** Verify the rendered output shows the read/write split as 8/18, includes `set_access`, and drops the five removed names. Confirm it ends with the two Paper-style pointers: "Human setup: `/docs/ai`. Approval flow: `/api/mcp` advertises OAuth from its 401." Keep the sync-API and OpenAPI sections.

### `/connect` (`src/app/connect/page.tsx`)

Tighten the lede: replace "Give an agent or sync client access to your blog" with a one-line pointer to the canonical URL plus the two verbs (`read` inspects, `sync` writes), and link the rewritten `/docs/ai` as "Setup for Claude, Cursor, VS Code, and Codex." Keep it a quiet page; the real instructions live in the doc.

---

## PART 4 - Example prompts and the three guides

**Verify prompt (read):** "What folders are in my TextText workspace?" → `list_folders`.
**Verify prompt (write):** "Create a draft note in TextText titled 'MCP test'." → `create_item(folder_path:"notes", kind:"note", title:"MCP test")`; returns the draft, nothing goes public.

### Guide 1 - `### Capture research into Notes`
**Prompt:** "Research the current EU AI Act enforcement timeline and save what you find as a note in my TextText workspace."
**Expected agent behavior:** `get_workspace` → `list_folders` (finds the `notes` folder) → `create_item(folder_path:"notes", kind:"note", title:"EU AI Act enforcement timeline", body: first findings)` → `append_to_item(id, markdown_fragment:...)` as it gathers more, so it never rewrites the whole body. The note is created as a draft and stays unlisted forever; the agent never calls `set_item_status`. Closes by reading it back with `read_item` to confirm. Note in the guide that `append_to_item`'s `markdown_fragment` is an MCP-only affordance (the native on-device assistant omits it), so this exact fragment step applies to external MCP clients.

### Guide 2 - `### Publish a drafted article`
**Prompt:** "Polish my 'Ship logs' draft in TextText and publish it."
**Expected agent behavior:** `search("Ship logs")` → `read_item(id)` (gets markdown, tags, current hash) → `update_item(id, body:..., tags:[...], if_match_hash: <hash>)`. Then, because publishing is audience-changing, the agent asks for confirmation and only then calls `set_item_status(id, status:"published")`. If the item changed under it, `update_item` returns a conflict and the agent re-reads and retries. Demonstrates the read → edit → confirm → publish gate.

### Guide 3 - `### Sync tags across a workspace`
**Prompt:** "Find every TextText post tagged 'draft-idea' and add the tag 'q3' to each."
**Expected agent behavior:** `search("draft-idea")` or `list_items` per folder → for each hit, `read_item(id)` to get `tags[]` and the current `hash` → `update_item(id, tags:[...existing, "q3"], if_match_hash:<hash>)`. Because `tags` is a full-list replace and `read_item` now returns `tags[]` directly, the agent round-trips tags without parsing frontmatter. One guarded write per item.

---

## VERIFY (all must be green; run before finishing)

- `npx tsc --noEmit` - green (types across web + shared surface).
- `npm test` - green, including `src/lib/ai/__tests__/native-tool-parity.test.ts` (the Swift contract must match the new surface), the MCP tools tests, and the assistant tests. Add/adjust: read-scope `update_item` returns 403 `insufficient_scope`; `read_item` tags round-trip; audit row name change from `mcp.set_item_cover` to `mcp.update_item`.
- `npm run build` - green (full check; this app is small and building is cheap).
- `python3 scripts/test-oauth-mcp-loop.py` - green, with `EXPECTED_TOOLS` rewritten to the exact ordered 26 names in final definition order.
- Do NOT run a dev server; the app is plain DOM and these checks are sufficient here.
- The sandbox mounts `.git` read-only. Leave everything uncommitted. Do NOT commit, push, release, or bump any version; the maintainer commits.

## OUTPUT (report back, concise, per area)

1. **Implementation:** the final ordered tool list (8 read, 18 write) exactly as it appears in `WORKSPACE_TOOL_DEFINITIONS`; every changed file with `file:line` anchors for the load-bearing edits (tool removals, `update_item` schema, `set_access`, `read_item` envelope, `markdownContentUpdate` relaxation, audit-name changes, the `create_item` line-750 string, the Swift contract regeneration).
2. **Shared-surface cascade:** confirmation that `NativeAI.swift`, `editor/actions.ts`, `useNativeAssistant.ts`, and `agent-tools.ts` were updated and the parity test passes.
3. **Docs:** the rewritten `/docs/ai` section list, the connect matrix (client → exact command/JSON), and confirmation that `llms.txt` renders the 8/18 split with no hardcoded names.
4. **Verify results:** the pass/fail of each of the four checks above.
5. **Deferred / decisions:** the alias-vs-hard-removal decision you made, and anything intentionally left out of scope.