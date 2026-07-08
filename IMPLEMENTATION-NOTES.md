# Workspace Membership And Folder Multiplayer

## Schema And Migration

- The existing `collaborators` table already supports `scope_type`, `scope_id`, nullable `user_id`, `invited_email`, `role`, `invited_by_id`, and `revoked_at`.
- No physical schema change was required. `role` is a text column, so workspace rows now use `admin`, `member`, or `guest`; folder and item rows use `editor` or `viewer`.
- This repo uses `drizzle-kit push` through `npm run db:push`; there are no checked-in migration files to generate.

## Permission Resolver

- Core resolver file: `src/lib/permissions.ts`
- Main signatures:
  - `resolveWorkspaceAccess({ handle, user }): Promise<EffectiveAccess>`
  - `resolveFolderAccess({ handle, folderId?, folderPath?, user }): Promise<EffectiveAccess>`
  - `resolveItemAccess({ handle, postId, user }): Promise<EffectiveAccess>`
- `EffectiveAccess` returns `role`, `canView`, `canEditContent`, `canManage`, `isOwner`, `userId`, `blogId`, and `workspaceRole`.
- Resolution takes the max effective role across owner, workspace grant, ancestor folder grants, and item grant. Pending email invites bind to the signed-in user row on first matching access.

## Enforcement Points Touched

- Server actions: `src/app/editor/actions.ts`
  - Scoped share actions for workspace, folder, and item.
  - Owner and membership-admin can invite, remove, and change collaborator roles.
  - Collaborator saves are content-only: title, body, cover fields.
  - Status, slug, type, date, pinned, delete, move, and folder creation remain owner-only.
- Store: `src/lib/store.ts`
  - Added accessible folder, post, and count helpers used by route and API layers.
- Public and workspace routes:
  - `src/app/t/[handle]/page.tsx`
  - `src/app/t/[handle]/[slug]/page.tsx`
  - Folder and item guests only see accessible folders/items.
- Sync API:
  - Workspace and manifest listings filter through accessible store helpers.
  - File reads require view access.
  - File updates require editor access and are content-only unless owner.
  - File creation, folder creation, deletes, and captures are owner-only.
- MCP:
  - Folder, item, and search listings filter by effective access.
  - Reads require view access.
  - Updates and appends require editor access.
  - Non-owner updates are content-only.
- Realtime collab:
  - `src/lib/collab.ts` now uses `resolveItemAccess`, so workspace and folder grants apply to Yjs read/write authorization.

## UI

- `ShareDialog` now supports item, folder, and workspace scopes.
- Item and folder sharing offer `Can edit`, `Can view`, and remove.
- Workspace members dialog is mounted from the workspace menu and offers `Member`, `Guest`, and remove.
- Folder share buttons were added to the workspace sidebar for owner/admin users.

## Review Fixes

- Workspace grants now project only onto blog-mode folders and blog-mode items. Notes/bookmarks, and folders whose mode is `notes` or `bookmarks`, require explicit folder or item grants.
- Accessible folder counts now count only inside folders the caller can access, and item-only collaborators pass an empty folder tree and empty counts into the editor shell.
- The `index.md` route now explicitly returns 404 for note and bookmark items, matching the OpenGraph private-item guard.

## Review Fixes Round 2

- Public published listings now exclude `note` and `bookmark` rows in the store-level `selectPosts(handle, true)` predicate. Owner/collaborator listing helpers still use the unrestricted branch, so accessible private notes and bookmarks remain visible only to authorized users. Public blog home, feeds, sitemap, `posts.json`, `folder.json`, and `llms.txt` continue to receive published article/project/talk rows through `getPosts`.
- Non-owner content edits now go through `savePostContentPatch`, which only applies title/body/cover fields, reasserts owner-only fields from the existing post (`date`, `pinned`, `status`, `slug`, `type`, and `folderId`), and calls `savePost` in preserve-published-at mode. In that mode `published_at` is omitted from the update, so the existing database timestamp is left unchanged instead of being rebuilt from the mapped date-only string. Owner saves keep the existing authored date behavior.

## TODOs

- Decide whether `admin` should become a first-class visible workspace role. The resolver supports it, but the UI only exposes Member and Guest.
