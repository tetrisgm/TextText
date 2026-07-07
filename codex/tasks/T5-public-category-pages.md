# T5: public category pages for blog subfolders

Blog subfolders are now real (nested folders with full slash paths, mode
inherited). When a blog-mode subfolder holds PUBLISHED posts, it should have
a public listing page and its posts should show a category chip. Notes and
bookmarks subfolders stay private and are OUT OF SCOPE.

## Backend contract (live in this branch)

- `Folder = {id, name, path, mode, position, parentId?}` from
  `src/lib/content.ts`. A blog subfolder has `mode: "blog"` and a `path`
  like `blog/ideas`. System roots have no slash in their path.
- Posts carry `folderId` (the owning folder). `getFolderPosts(handle,
  folderPath, {publishedOnly})` in `src/lib/store.ts` returns posts for a
  folder path. `getFolders(handle)` lists all folders.
- Public tenant routes live under `src/app/t/[handle]/`. Claimed blogs also
  serve at `src/app/u/[username]/` via the proxy; whatever you add under
  `t/[handle]` must have its mirror under `u/[username]` (look at how
  existing pages are mirrored, e.g. the feed routes).

## File ownership (STRICT)

- CREATE: `src/app/t/[handle]/c/[...path]/page.tsx` (catch-all category
  listing) and its mirror `src/app/u/[username]/c/[...path]/page.tsx`.
  You MAY create a shared `src/components/CategoryListing.tsx` +
  `CategoryListing.module.css` that both thin route files render.
- You MAY create `src/lib/categories.ts` for shared helpers (resolve a
  folder by path, list its published posts, build category URLs).
- NEVER edit: actions.ts, store.ts (add a helper in categories.ts instead
  and call existing store functions), the sync/mcp/capture code, the
  editor components, PostActionBar, PostWorkspaceShell.
- Commit nothing. Verify with `npx tsc --noEmit` and `npm run build`
  (prefix `NEXT_TELEMETRY_DISABLED=1` if plain build crashes in the
  keychain step; that crash is a local environment issue, not your code).

## What to build

1. **Category page** at `/t/{handle}/c/{path}` where `{path}` is a blog
   subfolder path WITHOUT the leading "blog/" (e.g. folder `blog/ideas`
   -> URL `/t/{handle}/c/ideas`; folder `blog/ideas/deep` ->
   `/c/ideas/deep`). Resolve the folder; 404 if it does not exist, is not
   blog-mode, or belongs to another blog. List its PUBLISHED posts using
   the existing card components (reuse `PostCard`; match how the blog home
   renders its list, read `src/app/t/[handle]/page.tsx`). Header: the
   folder name + a breadcrumb of ancestors linking up to the blog home.
   Respect the blog's card style / home layout tokens.
2. **Category chip on cards**: when a published post lives in a blog
   subfolder, show a small category chip (folder name) linking to the
   category page. Add this WITHOUT editing PostCard's existing callers:
   if PostCard already accepts the post, derive the folder from the post's
   folderId + the folders list you pass into the listing. If you cannot do
   it without editing shared components, describe the minimal prop you
   would add in your summary and skip the chip rather than edit them.
3. **Empty state**: a category with no published posts renders the header
   and a quiet one-line "Nothing here yet" (owners see it; visitors get a
   404 only if the folder itself does not exist).

## Design contract (non-negotiable, DESIGN.md)

- This is the BROADSHEET (reader) surface: the accent rule, the 60% ink
  contrast floor, the motion rule all apply. Read DESIGN.md first.
- Reuse existing reader components and tokens; do not invent new colors.
  Check light AND dark. No em dashes. Sentence case. No exclamation marks.

## Verify

`npx tsc --noEmit` and `npm run build` clean. In your summary: the exact
URL-to-folder mapping, how 404 is decided, and whether the category chip
landed or was skipped (with the reason).
