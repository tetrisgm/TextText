# Membership Review

Scope: read-only adversarial review of `main..HEAD`, focused on the workspace membership and folder multiplayer permission model. I did not run a dev server or modify code outside this file.

## 1. NOTE/BOOKMARK UNLISTED FOREVER - FAIL

### FAIL: public feed/agent listings trust `status = published` without excluding private item types.

Root cause:

- `src/lib/store.ts:194`-`218` implements `selectPosts(handle, true)` as "all non-deleted rows with `posts.status = "published"`"; `getPosts` exposes that at `src/lib/store.ts:233`-`238`.
- Public listing routes call `getPosts()` directly:
  - `src/app/t/[handle]/feed.json/route.ts:17` then emits title/summary/content text at `src/app/t/[handle]/feed.json/route.ts:27`-`40`.
  - `src/app/t/[handle]/feed.xml/route.ts:17` then emits title/link/summary at `src/app/t/[handle]/feed.xml/route.ts:36`-`54`.
  - `src/app/t/[handle]/atom.xml/route.ts:17` then emits title/link/summary at `src/app/t/[handle]/atom.xml/route.ts:37`-`58`.
  - `src/app/t/[handle]/sitemap.xml/route.ts:16` then emits post URLs at `src/app/t/[handle]/sitemap.xml/route.ts:28`-`36`.
  - `src/app/t/[handle]/folder.json/route.ts:20` and `src/app/t/[handle]/folder.json/route.ts:26` render manifest entries from those posts.
  - `src/app/t/[handle]/posts.json/route.ts:23` and `src/app/t/[handle]/posts.json/route.ts:37`-`48` expose kind/title/excerpt/URLs.
  - `src/app/t/[handle]/llms.txt/route.ts:25` and `src/app/t/[handle]/llms.txt/route.ts:59`-`68` expose markdown links and body summaries.

Concrete exploit scenario:

1. A legacy/import/admin path leaves a correct private row as `type = "note"` or `type = "bookmark"` but `status = "published"`. I did not find a normal app mutation that creates this state: `savePost` forces note/bookmark saves to draft at `src/lib/store.ts:997`-`999`, and the editor input does the same at `src/app/editor/actions.ts:314`-`319`.
2. An unauthenticated visitor requests `/t/acme/feed.json`, `/t/acme/llms.txt`, `/t/acme/posts.json`, `/t/acme/folder.json`, or `/t/acme/sitemap.xml`.
3. The note/bookmark appears in the public listing. `feed.json` and `llms.txt` leak a body-derived summary, not just the slug.

Direct item surfaces are better guarded: the page treats notes/bookmarks as private at `src/app/t/[handle]/[slug]/page.tsx:51`-`55` and `src/app/t/[handle]/[slug]/page.tsx:135`-`136`; `index.md` rejects them at `src/app/t/[handle]/[slug]/index.md/route.ts:15`-`22`; OpenGraph rejects them at `src/app/t/[handle]/[slug]/opengraph-image.tsx:21`-`28`. The resolver also prevents workspace grants from projecting onto private types/folders at `src/lib/permissions.ts:164`-`172` and `src/lib/permissions.ts:588`-`595`.

## 2. GUEST ISOLATION - PASS

No concrete over-broad guest listing found.

- Item-only grants produce no folder set: `accessibleFolderIdsForUser` only considers workspace/folder scopes at `src/lib/permissions.ts:525`-`560`.
- The post route passes `counts = {}` when a collaborator has no accessible folders at `src/app/t/[handle]/[slug]/page.tsx:174`-`183`.
- The sidebar no longer synthesizes Blog/Notes/Bookmarks for restricted users; fallback roots are used only when `canManageFolders` is true at `src/components/PostWorkspaceShell.tsx:611`-`612`.
- Folder grants expand by structural descendants, not siblings, through `descendantFolderIds` at `src/lib/permissions.ts:317`-`332`; item listings are then filtered by `accessiblePostIdsForUser` in `src/lib/store.ts:771`-`781`.
- The workspace home chooses an active folder only from `getAccessibleFolders` for non-owners at `src/app/t/[handle]/page.tsx:382`-`410`.

## 3. COLLABORATOR CONTENT-ONLY - FAIL

### FAIL: non-owner content edits can rewrite a published post's `published_at` timestamp.

Root cause:

- `mapPost` truncates database timestamps into a date-only string at `src/lib/store.ts:83`-`86` and assigns it to `post.date` at `src/lib/store.ts:110`.
- `savePost` treats any `post.date` on a published post as an authored date and writes `publishedAt: new Date(post.date)` at `src/lib/store.ts:1018`-`1025`.
- Non-owner update paths spread the existing mapped `Post` back into `savePost`, preserving that date-only string:
  - Server action: `src/app/editor/actions.ts:696`-`709`.
  - Sync PUT: `src/app/api/sync/v1/files/[postId]/route.ts:124`-`141`.
  - MCP `update_item`: `src/lib/mcp/tools.ts:466`-`485`.
- Public published ordering uses `posts.publishedAt` at `src/lib/store.ts:213`-`216`.

Concrete exploit scenario:

1. Owner publishes article A at `2026-07-08T17:30:00Z`.
2. Bob has only `editor` on article A.
3. Bob sends a body-only edit via the app, sync PUT, or MCP `update_item`.
4. The non-owner branch ignores Bob's submitted `date`, but it still sends the existing `post.date = "2026-07-08"` into `savePost`.
5. `savePost` rewrites `published_at` to `2026-07-08T00:00:00Z`. Bob changed a non-content date field and can alter same-day public ordering.

I did not find a non-owner path that changes status, slug, type, pinned, folder, move, or delete. Those are ignored or owner-gated in the server action, sync PUT/DELETE, and MCP tool paths.

## 4. INHERITANCE / INVITE LIFECYCLE - PASS

No concrete bypass found.

- Revoked grants are excluded in the core resolver query at `src/lib/permissions.ts:262`-`265`, share listing/update/revoke at `src/lib/shares.ts:101`-`106`, `src/lib/shares.ts:201`-`207`, `src/lib/shares.ts:229`-`235`, and `/shared` at `src/lib/shares.ts:302`-`305`.
- Anonymous callers cannot claim pending email grants because `matchingCollaboratorRows` returns no rows without a user at `src/lib/permissions.ts:251`-`255`.
- Pending email rows require the authenticated session email to match at `src/lib/permissions.ts:267`-`270`, then bind to the current signed-in user's id at `src/lib/permissions.ts:276`-`288`. After a row is bound, a different user id is filtered out at `src/lib/permissions.ts:293`-`297`.
- The session email comes from `auth()` via `getCurrentUser`, not a request parameter, at `src/lib/session.ts:9`-`22`.
- Ancestor inheritance uses `parentId` traversal (`src/lib/permissions.ts:302`-`314`) and descendant traversal also uses `parentId` (`src/lib/permissions.ts:317`-`332`), so I did not find a path-prefix sibling collision.

## 5. MANAGE AUTHORITY - PASS

No concrete member/guest escalation found.

- `canManage` is owner or stored workspace `admin` only at `src/lib/permissions.ts:137`-`139`.
- All share actions route through `manageableScopeForSharing`, which rejects callers who are neither owner nor workspace-admin at `src/app/editor/actions.ts:757`-`765`.
- The same helper verifies workspace/folder/item scope ownership under the requested handle at `src/app/editor/actions.ts:767`-`782`.
- Request role cleaning does not let callers assign `admin`: `src/app/editor/actions.ts:742`-`750`; lower-level share cleaning maps workspace `admin` input to `member` at `src/lib/shares.ts:45`-`53`.
- Sync and MCP machine surfaces are not collaborator-management surfaces; folder/file creation and deletion remain owner-only in `src/app/api/sync/v1/folders/route.ts:22`-`25`, `src/app/api/sync/v1/files/route.ts:15`-`18`, `src/app/api/sync/v1/files/[postId]/route.ts:162`-`168`, and `src/lib/mcp/tools.ts:216`-`220`.

Additional scope note: sync and MCP bearer auth currently resolve the token holder's owned blog, not arbitrary shared workspaces (`src/app/api/sync/v1/auth.ts:17`-`32`, `src/lib/mcp/auth.ts:34`-`39`). That limits collaborator-token leakage across another person's workspace in the current code.
