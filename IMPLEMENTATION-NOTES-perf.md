# Performance Implementation Notes

## Repeated query costs found

- Folder switching re-renders the workspace route for every `?folder=` change. The route was already using `Promise.all` for the main folder reads, but it fetched the current user separately and then did active-folder item access sequentially.
- The accessible store helpers repeated the same access work during one render:
  - `getAccessibleFolders` called `getFolders` and `accessibleFolderIdsForUser`.
  - `getAccessibleFolderCounts` called `getFolders`, `getAccessibleAllPosts`, `accessiblePostIdsForUser`, and `accessibleFolderIdsForUser`.
  - `getAccessibleFolderPosts` called `getFolderPosts` and `accessiblePostIdsForUser`.
- The permission helpers repeatedly resolved the same blog ownership base, folder rows, and collaborator rows across `resolveWorkspaceAccess`, `resolveFolderAccess`, `accessibleFolderIdsForUser`, and `accessiblePostIdsForUser`.
- Collaborator matching loaded all collaborator rows for the requested scopes, then filtered the caller in memory. That was unnecessarily broad for workspaces with many collaborators.
- Accessible folder counts loaded full post records, including bodies, just to count visible sidebar rows.

## Batched and memoized reads

- Added request-scoped `react` `cache` wrappers in `src/lib/permissions.ts` for:
  - blog ownership/user base resolution
  - folder rows by blog id
  - collaborator rows by caller
  - accessible folder id sets
  - accessible post id sets
- Narrowed collaborator matching to query only rows for the caller's bound `userId` and unbound matching invite email.
- Permission resolvers now filter the cached caller collaborator rows in memory for each target scope set.
- Added request-scoped `cache` wrappers in `src/lib/store.ts` for:
  - `getFolders`
  - `getFolderPosts`
  - `getFolderCounts`
- Reworked `getAccessibleFolderCounts` to count from minimal post folder rows instead of full post bodies.
- Added early returns for accessible helpers when there is no database or no user, avoiding unnecessary folder/post reads.

## Parallelized render work

- `src/app/t/[handle]/page.tsx` now fetches `getCurrentUser()` in the initial `Promise.all` with blog, edit access, query, and cookies.
- Active folder item loading and active folder permission resolution now run together with `Promise.all`.

## Prefetch and image loading

- `src/components/PostWorkspaceShell.tsx` now prefetches folder destinations with `router.prefetch` on folder row hover and focus.
- The home workspace shell now passes `homePath` into the sidebar so folder prefetch targets are available there.
- `src/components/FolderPage.tsx` memoizes sorted folder lists to avoid resorting on local UI state changes.
- `src/components/Reader.tsx` adds async decoding for reader images, keeps markdown body images lazy, and lazy-loads bookmark screenshot covers.

## Verification

- `npx tsc --noEmit` passes.
