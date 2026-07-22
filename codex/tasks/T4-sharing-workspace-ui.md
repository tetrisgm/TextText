# T4: sharing dialog + workspace menu + folder tree + shared-with-me

Four self-contained React components for Texttext's workspace. The backend is
DONE in this branch; you build UI components ONLY, as new files. They will
be mounted by the maintainer afterwards, so each must be a clean island
with typed props and no assumptions about where it renders.

## Backend contract (live in this branch, do not modify)

Server actions in `src/app/editor/actions.ts`:
- `sharePostAction(handle, postId, email, role)` -> `PostShare[]`
- `revokePostShareAction(handle, postId, shareId)` -> `PostShare[]`
- `listPostSharesAction(handle, postId)` -> `PostShare[]`
- `createSubfolderAction(handle, parentPath, name)` -> `Folder`
- type `PostShare = {id, email, role: "editor"|"viewer", accepted: boolean,
  createdAt: string}` (from `src/lib/shares.ts`)
- `Folder = {id, name, path, mode, position, parentId?}` (full slash paths;
  parentId null for the three system roots) from `src/lib/content.ts`
- Server-side data for shared-with-me: `getSharedPostsForUser` +
  `emailForSub` in `src/lib/shares.ts` (import into a server component),
  entry type `SharedWithMeEntry = {postId, role, title, slug, blogHandle,
  blogUsername, blogName, updatedAt}`. Build post paths with
  `blogPostPath({handle: blogHandle, username: blogUsername ?? undefined},
  {slug})` from `src/lib/public-paths.ts`.
- Sign out: `SignOutButton` component exists at
  `src/components/SignOutButton.tsx` (client, calls next-auth signOut).

## File ownership (STRICT)

- CREATE ONLY, under `src/components/workspace/`:
  - `ShareDialog.tsx` (+ `ShareDialog.module.css`)
  - `WorkspaceMenu.tsx` (+ `WorkspaceMenu.module.css`)
  - `FolderTree.tsx` (+ `FolderTree.module.css`)
  - `SharedWithMe.tsx` (+ `SharedWithMe.module.css`)
- CSS Modules only; do NOT edit global stylesheets, layout.tsx,
  PostWorkspaceShell.tsx, actions.ts, or anything existing.
- Commit nothing; no dev servers. Gate: `npx tsc --noEmit` + `npm run build`
  (unmounted components still typecheck and lint through the build).

## Components

1. **ShareDialog** (client). Props: `{handle: string; postId: string;
   postTitle: string; open: boolean; onClose: () => void}`. The Notion
   share popover shape: email input + role select (editor/viewer) + Invite
   button; list of current people (email, role chip, "invited" vs
   "accepted" state, revoke via inline two-tap confirm, no browser
   confirm()); a general-access row that reads "Only people invited"
   (static for now); "Copy link" button (copies window.location minus the
   edit params). Loads shares via listPostSharesAction on open; optimistic
   busy states; errors as a quiet inline line, never alert().
2. **WorkspaceMenu** (client). Props: `{blogName: string; email: string |
   null; settingsHref: string; onInvite?: () => void}`. A top-left
   click-target (workspace name + chevron) opening a small menu: header
   with workspace name + account email, then items: Settings (link),
   Invite members (calls onInvite when provided), divider, Log out
   (render SignOutButton inside). Popover closes on outside click and
   Escape; trap nothing; aria-expanded + menu roles.
3. **FolderTree** (client). Props: `{folders: Folder[]; activePath: string
   | null; countsByPath?: Record<string, number>; onNavigate: (path:
   string) => void; onCreateSubfolder: (parentPath: string, name: string)
   => Promise<void>}`. Builds the tree from parentId; system roots in
   `position` order with their existing names; subfolders alphabetical.
   Disclosure triangles (rotate 90deg, transition under
   prefers-reduced-motion: none); per-row hover "+" that inline-edits a
   new subfolder name (Enter commits via onCreateSubfolder, Escape
   cancels); depth-capped at 4 (hide "+" at depth 4).
4. **SharedWithMe** (server component). Props: `{entries:
   SharedWithMeEntry[]}`. Quiet list: title, "from {blogName}", role chip,
   relative updated time (hydration-safe: render the ISO date string via
   a fixed formatter, no Date.now()); links to the post path. Empty ->
   render nothing (null).

## Design contract (non-negotiable)

- Match the Apple-editor chrome (`.applecms` patterns, src/styles/apple.css
  for reference: SF system font stack, 6px radii, 8pt spacing grid, iOS
  system colors via existing custom properties). Use CSS variables from
  the existing sheets, not hex literals; verify light AND dark.
- Sentence case, verb-first buttons, no exclamation marks, NO EM DASHES.
- Nothing animates on load. Menus/popovers may fade 120ms.

## Verify

`npx tsc --noEmit` and `npm run build` clean. In your summary: each
component's props, its states (loading, error, empty), and any place you
intentionally deviated from this brief and why.
