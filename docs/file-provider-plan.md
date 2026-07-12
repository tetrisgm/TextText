# Write for macOS: File Provider plan

Replace the iCloud Drive/Write folder with a File Provider so Write is a
first-class location in the Finder sidebar, with cloud badges, on-demand
downloads, sync progress, and native conflict handling. write.ramine.net
becomes the single source of truth; there is one sync system, not two.

## 1. Why

Today the Mac app has two sync systems that do not coordinate: iCloud Drive
moves files between the user's Macs, and the native SyncEngine mirrors those
files to and from the server. The web view is a third surface. That split is
the source of the friction (stale views, coordination bugs). A Replicated
File Provider collapses this: the extension IS the folder AND the sync, it
talks straight to the server, and Finder shows it natively.

## 2. Architecture

- One `NSFileProviderDomain` per signed-in workspace, display name "Write".
  It appears under Locations in the Finder sidebar; files live under
  `~/Library/CloudStorage/Write`, materialized on demand.
- An `NSFileProviderReplicatedExtension` backed by the EXISTING `/api/sync/v1`
  API (workspace, folder manifests, file get/put/delete, the change cursor).
  The extension is a new client of the same server contract the native engine
  already uses, so the server needs little or no change.
- The server is the source of truth. The extension enumerates from it, fetches
  content on materialization, and pushes creates/edits/deletes/renames back
  with the existing hash + If-Match conflict model.
- The extension reads the `wsk_` sync token from the shared app group
  container; the container app mints it (as it already does for the native
  engine) and writes it there.

## 3. What it replaces

- The `iCloud Drive/Write` folder as the canonical local store.
- The native folder-mirroring `SyncEngine` and its FSEvents/NSMetadataQuery
  watching. The File Provider framework owns materialization and change
  observation.
- WriteWorkspaceCore's iCloud root resolution / migration paths become
  vestigial (kept until the File Provider path is proven, then retired).

The web view, App Intents, Spotlight, Share extension, and Quick Look stay.
Spotlight and Quick Look actually get easier: the File Provider surfaces real
files the system indexes and previews.

## 4. Migration (no data loss)

The server already holds every item (the native engine has been syncing it),
so there is nothing to upload. On first run the File Provider domain simply
enumerates the workspace from the server and materializes on demand. The old
`iCloud Drive/Write` folder is left in place, untouched; once the File
Provider is proven the app offers to retire it (never auto-deletes user
files). No file is ever moved or deleted as part of the switch.

## 5. Entitlements and portal (owner-gated, like Share/Quick Look)

- New App ID `net.writeapp.write.mac.fileprovider` with the App Group
  `group.net.writeapp.write` (already registered).
- A Developer ID provisioning profile for it (one more `.provisionprofile`
  into `mac/profiles/`).
- The extension is sandboxed with the File Provider extension point, the app
  group, and network access. The container app keeps the app group so it can
  hand the token across.

## 6. Phases

### Phase 1: WriteFileProviderKit (pure Swift, headless-testable)
The server client (reuse the sync API contract), the item model
(NSFileProviderItemIdentifier <-> server ids, folders, item kinds,
capabilities, content types), the enumeration + change-cursor logic, and the
metadata mapping. No extension yet. Fully unit-tested against a fake server.

### Phase 2: Read-only extension
The `NSFileProviderReplicatedExtension` wrapping the kit: enumerate the
workspace and folders, expose items, and materialize content by fetching file
bodies from the server. Register the domain from the container app on sign-in.
Files appear in the Finder sidebar and open read-only. Verify with a real
domain against a throwaway test workspace.

### Phase 3: Writes and conflicts
Create, modify, delete, and rename map to server POST/PUT/DELETE with
If-Match. Honor the privacy invariants (notes and bookmarks stay unlisted,
soft-delete semantics). Conflict resolution via the existing hash model, with
the framework's conflict surfaces.

### Phase 4: Native polish
Cloud badges, on-demand eviction (remove download), offline availability, sync
progress, and Finder context-menu actions. Wire the change cursor to
`signalEnumerator` for near-instant updates.

### Phase 5: Retire the old path
Once the File Provider is proven on the real workspace, retire the native
folder SyncEngine and offer to clean up the old `iCloud Drive/Write` folder.
Ship as the default.

## 7. Risks

- File Provider is one of Apple's heavier APIs; correctness around
  enumeration anchors, working set, and eviction is subtle.
- It manages the user's files, so every phase runs against a throwaway test
  workspace first; the real workspace is touched only at the ship step.
- Developer ID File Provider extensions ship fine (Dropbox, etc.) but need the
  portal setup in section 5 before Phase 2 can register a real domain.

## 8. Non-goals

iOS/iPadOS File Provider, CloudKit as the backend (the server is the backend),
a second sync system alongside this one, and any automatic deletion of the
user's existing iCloud files.
