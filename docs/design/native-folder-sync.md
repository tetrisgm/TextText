# Native folder and Finder sync

Status: shipped architecture, July 2026.

## Purpose

Write is file-based without making people manage a sync engine. Finder exposes
ordinary document items, the Mac app stays responsive from local state, and the
server supplies cross-device sync and web access.

The system has two native responsibilities with a strict boundary:

1. File Provider owns the visible Finder Location and all Finder mutations.
2. The app owns its local workspace cache, editor state, and optimistic server
   synchronization.

Neither surface waits for the web UI to render. Network responses reconcile
against newer local revisions instead of replacing them.

## Finder tree

```text
Write/
  Data/
    Attachments/
      Workspace/
        Imported plain document/
          asset
  Workspace/
    Blog/
      Rich post.textbundle
    Notes/
      Plain import.md
      Rich note.textbundle
    Bookmarks/
      Rich bookmark.textbundle
```

The domain root spans every linked workspace. Identifiers include the workspace
handle and stable server ID, so workspaces and same-named documents cannot
collide.

TextBundle is the default native representation for content created by Write.
It keeps Markdown and immutable captured images in one package. Plain Markdown
and text stay supported. Assets managed for imported plain files live in the
central `Data/Attachments` tree.

## Availability policy

All documents use `downloadEagerlyAndKeepDownloaded`. The product intentionally
does not support online-only files, user-selected folders, eviction, or storage
optimization. Markdown and text assets are small, and predictable offline
availability is more valuable than reclaiming negligible disk space.

A changed server hash invalidates the stale representation and Finder fetches
the current bytes. File Provider owns materialization progress and pending
state.

## Mutation flow

The extension maps Finder operations to the sync API:

| Finder operation | Server operation |
| --- | --- |
| Create document | idempotent folder-scoped create |
| Edit document | content update with hash precondition |
| Rename document | metadata patch using stable ID |
| Move document | folder patch using stable ID |
| Delete document | soft delete with hash precondition |
| Create folder | idempotent folder create |
| Rename folder | folder metadata patch |

Folder move and delete are excluded from Finder capabilities. The app performs
those higher-level operations with explicit workspace semantics and Trash
recovery.

Write sanitizes only the Finder filename. The document title remains unchanged,
including punctuation that a filesystem cannot represent directly. Reimport
matches stable identity before display names and requires an unambiguous match.

## Conflicts and duplicate prevention

Every content write uses the current hash. A stale write reports a conflict
instead of silently overwriting either side. Client mutations are optimistic in
the app, but server reconciliation is revision-aware and cannot roll back newer
typing.

File Provider create requests use the framework's stable temporary identifier
as an idempotency key. Lost responses and retries therefore resolve to the
original item. After a provider reset, `.mayAlreadyExist` reimport adopts a
matching server item by ID or unambiguous parent-scoped name instead of creating
a duplicate.

## Status model

Finder is the authority for sync status. `FileProviderStatusMonitor` observes
pending-set changes and reads pending items plus upload and download progress.
The app presents five states:

- up to date
- syncing, including count and percentages when known
- checking
- not connected
- needs attention

The app does not infer success from a timer and does not maintain a second
eventually inconsistent cloud badge.

## Public actions

Manifest entries carry a private transport URL and a separate canonical public
URL. Finder actions resolve fresh metadata for the selected stable item, then:

- Copy Write Link writes the canonical page URL to the pasteboard.
- Share opens the app's native sharing picker with that URL.
- Manage Access opens the canonical page in the app with access controls.

The app validates deep-link origins. The extension rejects authenticated
`/api/sync/` endpoints as shareable links.

## Background robustness

- Credentials are handed off through signed app-group and keychain access.
- Enumeration and writes are cancellation-safe and completion handlers fire
  once.
- Change anchors fingerprint mapped items and expire cleanly when a safe diff
  is not possible.
- The working set spans every workspace without identifier collisions.
- Local health history records release, extension, state, index, storage, and
  Finder checks before any best-effort server submission.
- Health and status observation never reload the editor or replace client state.

## Verification

The release gate includes:

- web sync and manifest tests
- pure File Provider kit tests
- bridge and extension mutation tests
- native app tests
- staged app health verification
- signing, bundle version, update feed, signature, and public download checks

The owner-facing ship command publishes immutable artifacts first and flips the
update feed and version marker last.
