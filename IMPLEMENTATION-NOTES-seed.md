# Starter note and bookmark seeding

## Creation chokepoints

- `src/lib/store.ts:660` is the shared system-folder insertion point. `ensureWorkspaceFolders(blogId)` inserts Blog, Notes, and Bookmarks with `onConflictDoNothing`, then reads the settled folders back. This remains lazy for old workspaces, so it does not seed starter items by itself.
- `src/lib/store.ts:1643` is the anonymous workspace creation path used by `createAnonymousBlogHandle` in `src/app/editor/actions.ts:112`. The new `blogs` row is inserted at `src/lib/store.ts:1653`, and `provisionNewWorkspaceDefaults(inserted[0].id)` runs at `src/lib/store.ts:1665` only when that insert created a row.
- `src/lib/store.ts:1712` is the signed-in owner creation path reached from `resolveOwnedWorkspace` at `src/lib/workspace.ts:39` when there is no owned or guest workspace. The new `blogs` row is inserted at `src/lib/store.ts:1735`, and `provisionNewWorkspaceDefaults(inserted[0].id)` runs at `src/lib/store.ts:1741` only when that insert created a row.
- Guest claiming is handled by `claimBlogForUser` from `src/lib/workspace.ts:23`. That is not a new workspace creation, so it does not seed again. The guest workspace was already seeded by the anonymous creation path.

## Seeded content

- Note in the Notes folder:
  - `type`: `note`
  - `slug`: `welcome-to-notes`
  - `title`: `Welcome to Notes`
  - `body`:

```text
This is a private place for rough ideas, reminders, and drafts.

Try keeping:
- one idea you want to revisit
- a question for your next post
- a small checklist before you publish
```

- Bookmark in the Bookmarks folder:
  - `type`: `bookmark`
  - `slug`: `write-ai-setup-guide`
  - `title`: `Write AI setup guide`
  - `links[0].href`: `https://write.ramine.net/docs/ai`
  - `links[0].label`: `write.ramine.net`
  - `captureStatus`: `pending`
  - `capture.url`: `https://write.ramine.net/docs/ai`
  - `body`: empty

Both rows are inserted with `status: "draft"`. The bookmark seed writes the pending capture fields directly so the normal capture list can pick it up later, but it does not call `markCapturePending`, `lightCaptureBookmark`, or any fetch/screenshot path during workspace creation.

## Idempotency

`provisionNewWorkspaceDefaults` is called only after a successful new `blogs` insert. Existing owned workspaces, lazily repaired folder sets, later resolves, and claimed guest workspaces skip it.

The starter post insert also uses the live-post unique key, `posts_blog_slug_idx`, with `onConflictDoNothing`. If the creation flow is retried after the starter rows already exist, the database ignores the duplicate slugs instead of creating another note or bookmark.
