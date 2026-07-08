# Membership Review

Scope: read-only adversarial review of `main..HEAD`, focused on workspace membership and folder multiplayer authorization. I did not modify code outside this file, did not run a dev server, and did not push.

## 1. NOTE/BOOKMARK UNLISTED FOREVER - FAIL

### FAIL: `getFolderPosts()` can list private item types when they are in the legacy Blog bucket.

The resolver has the right top-level type guard for workspace grants: `workspaceGrantAppliesToItem()` rejects `note` and `bookmark` at `src/lib/permissions.ts:164`-`172`, and public `getPosts()` now excludes them at `src/lib/store.ts:194`-`208`. Direct public item, markdown, and OG surfaces also reject private types at `src/app/t/[handle]/[slug]/page.tsx:51`-`55`, `src/app/t/[handle]/[slug]/page.tsx:135`-`136`, `src/app/t/[handle]/[slug]/index.md/route.ts:15`-`22`, and `src/app/t/[handle]/[slug]/opengraph-image.tsx:21`-`28`.

The leak is the folder listing path. `getFolderPosts()` treats `folder_id IS NULL` and any `blog` / `blog/...` folder as Blog-folder content at `src/lib/store.ts:690`-`697`, but it never excludes `posts.type = 'note'` or `posts.type = 'bookmark'` in the database predicate at `src/lib/store.ts:706`-`713`.

Concrete exploit scenario:

1. A pre-backfill, imported, or otherwise malformed private row exists: `posts.type = 'note'` or `'bookmark'`, `posts.folder_id = NULL` or a blog-mode folder id. This is plausible because the store explicitly treats null `folder_id` as legacy Blog content at `src/lib/store.ts:666`-`668`.
2. The owner invites Mallory as a workspace `member`.
3. Mallory opens `/t/acme`. `hasBlogWorkspaceContent` becomes true from `workspaceAccess.canEditContent` at `src/app/t/[handle]/page.tsx:360`-`363`, so the route calls `getFolderPosts(handle, "blog", { publishedOnly: false })` at `src/app/t/[handle]/page.tsx:376`-`381`.
4. The private note/bookmark is rendered in the Blog home list/card/single layout at `src/app/t/[handle]/page.tsx:455`-`483`, leaking title and body-derived preview to a workspace member who was never explicitly granted that private item.

Public unauthenticated variant: if the same malformed note/bookmark row is `status = 'published'`, `/t/acme` leaks it through the same `getFolderPosts(..., publishedOnly: true)` call. A public category page can also leak a malformed published private row in a blog subfolder because `resolveCategory()` calls `getFolderPosts(handle, folder.path, { publishedOnly: true })` at `src/lib/categories.ts:103`-`111`.

Feeds, sitemap, `posts.json`, `folder.json`, `llms.txt`, and normal public post markdown use `getPosts()`, so they pass for current database rows because `selectPosts()` excludes private types.

## 2. GUEST ISOLATION - FAIL

### FAIL: a Blog-folder grant can inherit to null-folder private rows.

The same legacy Blog-bucket assumption also breaks folder-grant isolation. `resolveItemAccess()` maps a post with no `folderId` to the Blog folder at `src/lib/permissions.ts:492`-`500`. Folder grants are then applied as normal item grants at `src/lib/permissions.ts:511`-`516`; the note/bookmark type guard only disables workspace grants, not folder grants.

Concrete exploit scenario:

1. A private note exists with `posts.type = 'note'`, `posts.status = 'draft'`, and `posts.folder_id = NULL`.
2. The owner grants Mallory viewer access to the Blog folder, not to the note.
3. Mallory opens the note URL directly. The post page asks `resolveItemAccess()` at `src/app/t/[handle]/[slug]/page.tsx:127`-`136`; because `resolveItemAccess()` treated the null folder as Blog, Mallory gets `canView` from the Blog folder grant and the private-page guard lets the note render.

The accessible listing helper has the same issue: for a folder grant, `accessiblePostIdsForUser()` adds posts in descendant folders and also adds null-folder posts when the granted folder is Blog at `src/lib/permissions.ts:604`-`609`, without checking post type. A guest granted a blog subfolder can also see a malformed note/bookmark stored in that subfolder through `getAccessibleFolderPosts()` at `src/lib/store.ts:773`-`783`.

Normal item-only and folder-only guests otherwise look isolated: item-only users get an empty folder tree/counts (`src/app/t/[handle]/[slug]/page.tsx:174`-`183`), restricted sidebars do not synthesize fallback roots (`src/components/PostWorkspaceShell.tsx:611`-`612`), and folder inheritance is by `parentId`, not path prefix (`src/lib/permissions.ts:317`-`332`).

## 3. COLLABORATOR CONTENT-ONLY - PASS

No concrete non-owner metadata mutation found.

Non-owner web saves go through `resolveItemAccess()` and `savePostContentPatch()` at `src/app/editor/actions.ts:697`-`706`. The content patch helper only accepts title/body/cover fields and calls `savePost(..., { preservePublishedAt: true })` at `src/lib/store.ts:1097`-`1128`, preserving slug, status, type, date/published_at, pinned, and folder.

Sync PUT follows the same split at `src/app/api/sync/v1/files/[postId]/route.ts:122`-`136`. MCP `update_item` does too at `src/lib/mcp/tools.ts:467`-`483`. MCP `append_to_item` only supplies a new body while reusing the existing post and explicitly passes `date: undefined` at `src/lib/mcp/tools.ts:519`-`526`, so I did not find a normal path to rewrite authored date or publish metadata there.

Owner-only move, pin, delete, create, capture, and folder creation surfaces reject collaborators through owner/edit-credential checks, for example `src/app/editor/actions.ts:923`-`977`, `src/app/api/sync/v1/files/[postId]/route.ts:156`-`164`, and `src/lib/mcp/tools.ts:217`-`221`.

## 4. INHERITANCE / INVITE LIFECYCLE - PASS

No concrete leak found.

Revoked grants are excluded in the resolver query at `src/lib/permissions.ts:262`-`265`, share listing/update/revoke paths at `src/lib/shares.ts:101`-`106` and `src/lib/shares.ts:201`-`235`, and `/shared` aggregation at `src/lib/shares.ts:302`-`305`.

Pending email grants require an authenticated session email match before binding at `src/lib/permissions.ts:267`-`288`; anonymous callers return no rows at `src/lib/permissions.ts:251`-`255`. After a row is bound, a different user id is filtered out at `src/lib/permissions.ts:293`-`297`. The email source is the server session (`src/lib/session.ts:9`-`22`), not a request parameter.

Ancestor and descendant inheritance are structural, not string-prefix based: `folderAndAncestorIds()` walks `parentId` at `src/lib/permissions.ts:302`-`314`, and `descendantFolderIds()` expands by `parentId` at `src/lib/permissions.ts:317`-`332`.

## 5. MANAGE AUTHORITY - PASS

No concrete member/guest escalation found.

Manage authority is owner or stored workspace `admin` only at `src/lib/permissions.ts:137`-`139`. All share list/invite/revoke/role server actions route through `manageableScopeForSharing()`, which rejects callers who are neither owner nor workspace-admin at `src/app/editor/actions.ts:749`-`762` and then verifies the requested workspace/folder/item belongs to the handle at `src/app/editor/actions.ts:764`-`779`.

Members/guests cannot assign `admin`: action-level role cleaning only accepts `member` or `guest` for workspace shares at `src/app/editor/actions.ts:739`-`747`, and lower-level share cleaning maps workspace `admin` input back to `member` at `src/lib/shares.ts:45`-`53`.

Sync and MCP are not collaborator-management surfaces. Their bearer auth resolves the token holder's owned blog (`src/app/api/sync/v1/auth.ts:17`-`32`, `src/lib/mcp/auth.ts:34`-`39`), and create/delete/folder/capture operations remain owner-only.
