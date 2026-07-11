# Apple Workspace Boundary

Write for macOS uses a normal folder as the local source of truth for user
content. The preferred location is:

```text
~/Library/Mobile Documents/com~apple~CloudDocs/Write
```

Finder shows this as `iCloud Drive/Write`. When iCloud Drive is unavailable,
Write falls back to:

```text
~/Write Local
```

The status window and activity log surface the fallback state. The fallback is
not `~/Write`, because that path is the legacy mirror migration source.

## Folder Sync

iCloud Drive is responsible for moving files between Macs, materializing files
that are not downloaded yet, conflict files created by the system, storage
optimization, and Finder visibility.

Write does not use CloudKit, File Provider, or an iCloud container entitlement
for this workspace. The app is a non-sandboxed Developer ID app and accesses
the visible iCloud Drive path through `FileManager`.

Write coordinates reads and writes with `NSFileCoordinator` and registers an
`NSFilePresenter` for the workspace root. It also watches the folder with
FSEvents and observes ubiquitous item changes with `NSMetadataQuery`.

## Workspace Shape

The local workspace is ordinary files and folders:

```text
Write/
  Blogs/
    <handle>/
      blog.yaml
      Posts/
        published-post.md
      Media/
  Notes/
    note.md
  Bookmarks/
    2026/
      bookmark.md
  Drafts/
    draft.md
  Media/
  .write/
    workspace.yaml
    state/
  .write-local.nosync/
    state/
      sync-marker.txt
```

Markdown files carry normal Write front matter plus local identity keys:

```yaml
writeId: "server-post-id"
writeFolderId: "server-folder-id"
writeKind: "note"
```

Those keys are local identity metadata. Before comparing content hashes or
sending file bodies to the backend, Write strips them so server hashes still
match the server-rendered markdown vocabulary.

Phase 1 mirrors markdown content. Media directories are visible scaffolding, but
post images and uploads that already live in backend Blob storage are not yet
downloaded into `Media/`; that belongs to the later publishing/media sync work.

## Local Index

Application Support stores the per-device sync index that maps stable server
item ids to relative file paths, content hashes, modification times, folder
ids, and item kinds. It is a cache and can be rebuilt by scanning markdown
files for `writeId` front matter, but a rebuilt scan is not treated as the
three-way delete baseline.

No user-authored markdown body exists only in `.write` or in Application
Support. Application Support still stores credentials, cached account metadata,
and the authoritative per-device sync index. The `.write-local.nosync` marker
is also per-device and is not intended to sync through iCloud.

## Publishing Backend

The backend remains the publishing and account authority. It handles login,
public URLs, collaboration, comments, capture jobs, MCP access, audit rows, and
server-side publication state.

The macOS app still uses `/api/sync/v1` to exchange markdown files with that
backend. iCloud file sync does not publish content by itself. A local edit
becomes a backend edit only when the existing sync engine pushes it through the
sync API.

## External Edits

Files created, edited, renamed, moved, or deleted in Finder are detected by the
folder watcher and by index reconciliation during sync passes.

When a file with a known `writeId` moves or is renamed, Write updates the local
index instead of treating the old path as a delete and the new path as a new
post. A rename also updates the markdown `slug` front matter so the existing
sync API can carry the change onward.

Deletes remain intentional only when the per-device workspace marker under
`.write-local.nosync/state` is present. If the whole workspace appears newly
created or lost, Write drops the index and mirrors from the backend instead of
propagating mass deletion.
