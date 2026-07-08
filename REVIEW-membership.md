# Membership Review

Scope: read-only review of `main..HEAD`, focused on the membership/folder multiplayer permission model. I did not run a dev server or modify code outside this file.

## 1. NOTE/BOOKMARK UNLISTED FOREVER - FAIL

### FAIL: a workspace `member` can see and edit every note/bookmark without an item or folder grant.

Root cause:

- `src/lib/permissions.ts:164`-`168` maps a `workspace` collaborator with role `member` to effective `editor` for non-workspace targets. Only `guest` is denied at this cross-target step.
- `src/lib/permissions.ts:482` applies that workspace-derived role inside `resolveItemAccess`.
- `src/lib/permissions.ts:512` and `src/lib/permissions.ts:547` collapse any effective workspace row to `"all"` for folder/post accessible helpers.
- `src/app/t/[handle]/page.tsx:362`-`387` treats `workspaceAccess.canEditContent` as `hasFullWorkspaceContent`, then loads all folders/counts and all drafts in the Blog home request path.
- `src/app/t/[handle]/page.tsx:407`-`410` loads an active non-blog folder with `getFolderPosts` instead of the accessible helper when `hasFullWorkspaceContent` is true.
- `src/app/t/[handle]/[slug]/page.tsx:127`-`137` lets the same workspace-derived item access view private notes/bookmarks and enter edit mode.

Exploit scenario:

1. Owner has a private note `payroll-plan` in the Notes folder (`type = note`, `status = draft`).
2. Owner invites `bob@example.com` to the workspace as `member`, not to the note or Notes folder.
3. Bob signs in and opens `/t/acme?folder=notes` or `/@owner?folder=notes`.
4. The workspace grant binds, `member` becomes item/folder `editor`, `hasFullWorkspaceContent` becomes true, and Bob receives the Notes folder listing including `payroll-plan`.
5. Bob can open `/t/acme/payroll-plan?edit=1` and edit its content.

Public unauthenticated listings mostly rely on `status = published` rather than explicit type filters. I did not find an in-app mutation path that can publish `note` or `bookmark`: `src/lib/store.ts:988`-`990` forces them to draft, and editor/sync/MCP update paths reject cross-mode type changes. Still, `src/app/t/[handle]/[slug]/index.md/route.ts:15` only checks `post.status !== "published"` and lacks the explicit note/bookmark guard already present in the OpenGraph routes.

## 2. GUEST ISOLATION - FAIL

### FAIL: an item-only editor sees folder navigation/count metadata.

Root cause:

- `src/lib/permissions.ts:499`-`505` builds accessible-folder scopes only from workspace and folder grants, so an item-only grant correctly produces no accessible folders.
- `src/app/t/[handle]/[slug]/page.tsx:163`-`168` still computes `getAccessibleFolders` and `getAccessibleFolderCounts` for the collaborator edit route.
- `src/lib/store.ts:795`-`810` builds counts by mapping each visible post's `folderId` through all workspace folders, which can expose the containing folder path even without a folder grant.
- `src/app/t/[handle]/[slug]/page.tsx:223`-`236` passes those `folders` and `counts` into `PostEditLayer`.
- `src/components/PostEditLayer.tsx:1350`-`1358` forwards them to `WorkspaceSidebarChrome`.
- `src/components/PostWorkspaceShell.tsx:611` substitutes hard-coded `FALLBACK_FOLDERS` whenever `folders.length === 0`.
- `src/components/PostWorkspaceShell.tsx:664`-`668` renders the tree with the supplied counts, and `src/components/PostWorkspaceShell.tsx:475` reads `counts[folder.path]`.

Exploit scenario:

1. Owner grants `eve@example.com` `editor` on one private note only. Eve has no workspace grant and no Notes-folder grant.
2. Eve opens `/t/acme/secret-note?edit=1`.
3. The page correctly resolves item edit access, but `getAccessibleFolders` returns `[]`.
4. The client shell replaces that empty list with `Blog`, `Notes`, and `Bookmarks` fallback folders. If the item is in the Notes root, the sidebar shows `Notes` with count `1`; if it is in a custom folder, the serialized `counts` prop can still reveal a path such as `notes/layoffs`.

That violates the invariant that an item-only guest must not see the folder tree or counts. I did not find a comparable over-broad listing for folder grants: folder access expands descendants via `parentId`, not siblings.

## 3. COLLABORATOR CONTENT-ONLY - PASS

I did not find a non-owner path that mutates status, slug, type, date, pinned, folder, move, or delete.

- Server actions: `src/app/editor/actions.ts:696`-`709` sends non-owner saves through `collaboratorContentPatch`, which is limited to title/body/cover fields at `src/app/editor/actions.ts:343`-`362`. Pin/move/delete actions still require `getBlogEditAccess` owner/guest-edit-token access at `src/app/editor/actions.ts:926`-`954` and `src/app/editor/actions.ts:966`-`980`.
- Sync PUT: `src/app/api/sync/v1/files/[postId]/route.ts:124`-`141` preserves non-owner type/status/slug/date/pinned/folder by only overlaying title/cover/body fields. DELETE is owner-only at `src/app/api/sync/v1/files/[postId]/route.ts:166`-`168`; file creation is owner-only at `src/app/api/sync/v1/files/route.ts:15`-`18`; captures are owner-only at `src/app/api/sync/v1/captures/[postId]/route.ts:52`-`55`.
- MCP: `src/lib/mcp/tools.ts:466`-`485` uses the same owner vs non-owner split for `update_item`, and `append_to_item` only changes body at `src/lib/mcp/tools.ts:525`-`529`. `create_item` and folder creation are owner-only at `src/lib/mcp/tools.ts:336`-`337` and `src/lib/mcp/tools.ts:216`-`220`.

This PASS does not cancel the invariant 1 failure: a workspace `member` can become a content editor for private notes/bookmarks, but I did not find a route where that non-owner can mutate non-content fields.

## 4. INHERITANCE / INVITE LIFECYCLE - PASS

No concrete bypass found.

- Revoked grants are excluded by the resolver query at `src/lib/permissions.ts:241`-`244`, share listing/update/revoke paths at `src/lib/shares.ts:101`-`106`, `src/lib/shares.ts:201`-`207`, `src/lib/shares.ts:229`-`235`, and `/shared` at `src/lib/shares.ts:302`-`305`.
- Pending email grants do not match anonymous callers because `matchingCollaboratorRows` returns no rows without a user at `src/lib/permissions.ts:230`-`234`. For signed-in callers, the email must match the unbound invite at `src/lib/permissions.ts:246`-`249`, then binding writes the current user's `userId` at `src/lib/permissions.ts:252`-`267`.
- `/shared` repeats the same email-binding pattern and filters revoked rows at `src/lib/shares.ts:300`-`320`.
- Ancestor inheritance uses structural `parentId` traversal, not string prefixes: `src/lib/permissions.ts:281`-`293` for ancestors and `src/lib/permissions.ts:296`-`312` for descendants. I did not find a path-prefix collision that grants sibling access.

## 5. MANAGE AUTHORITY - PASS

No concrete escalation found.

- `canManage` is only owner or stored workspace `admin` at `src/lib/permissions.ts:137`-`139`.
- Share actions gate every scope through `manageableScopeForSharing`; non-owner/non-admin users are rejected at `src/app/editor/actions.ts:761`-`765`.
- The same helper verifies workspace, folder, and item scope IDs belong to the target handle at `src/app/editor/actions.ts:767`-`782`.
- Request-side role cleaning does not accept `admin` as an assignable workspace role: `src/app/editor/actions.ts:742`-`750`; the lower-level share cleaner also maps `admin` input to `member` at `src/lib/shares.ts:45`-`52`.

Members, guests, item editors, and folder editors therefore cannot invite, remove, change roles, or share folders through the exposed action surface.

## Additional Note

Sync API and MCP auth both resolve the bearer token user's owned blog, not arbitrary shared workspaces (`src/app/api/sync/v1/auth.ts:17`-`32`, `src/lib/mcp/auth.ts:34`-`39`). That prevents collaborator-token leakage across someone else's workspace, but it also means those machine surfaces do not actually expose shared workspaces to collaborators in the current code.
