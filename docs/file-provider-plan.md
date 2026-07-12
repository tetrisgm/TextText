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

Owner's call on sequencing: build writes first and ship Phase 2+3 together as
one editable release, then retire the native SyncEngine mirror at the cutover
(once writes are proven against a throwaway workspace). Until that proven
cutover, the File Provider coexists with the existing native mirror.

Status legend below: DONE means built and unit-tested; BUILT means built and
unit-tested but pending on-device verification; pending means not started.

### Phase 1: WriteFileProviderKit (pure Swift, headless-testable) - DONE
`mac/Sources/WriteFileProviderKit`: a pure-Swift, framework-free core. The
server client (`WriteSyncAPI` protocol + `LiveWriteSyncAPI`, an async
URLSession client on the `wsk_` bearer), the item model (`WriteItemIdentifier`
round-tripping through raw strings, with the three reserved cases pinned to
Apple's literal constant values so bridging is free; `WriteItem` /
`WriteItemMapper` carrying kind, capabilities, content type, hash, and
timestamps), the `WorkspaceEnumerator` (root -> top-level folders, folder ->
subfolders + files, working set, change cursor), and `FileProviderHandoff`
(the {origin, token, handle} JSON the app writes into the shared app-group
container and the extension reads). No extension yet. Fully unit-tested
against a fake server.

### Phase 2: Read-only replicated extension + domain registration - DONE
`mac/Sources/WriteFileProviderBridge` adapts the kit to the FileProvider
framework (`WriteFileProviderItem: NSFileProviderItem`, identifier and
capability bridges; note Apple aliases the capability bits, so
`.allowsReading == .allowsContentEnumerating` and
`.allowsWriting == .allowsAddingSubItems`).
`mac/Extensions/WriteFileProviderExtension` is the
`NSFileProviderReplicatedExtension` principal class `FileProviderExtension`
(a class conforming to that protocol is what makes the extension replicated;
extension point `com.apple.fileprovider-nonui`) plus `WriteEnumeratorAdapter`
(`NSFileProviderEnumerator`): it enumerates the workspace and folders, exposes
items, and materializes content on demand via `fetchContents`. The container
app registers one `NSFileProviderDomain` (displayName "Write") per workspace
on sign-in and removes it on sign-out via `NSFileProviderManager.add` /
`remove` (the 2-arg init is the replicated variant), publishes the handoff,
and signals the enumerator on remote change (reusing the app's existing
long-poll, which stays in the app, not the extension). The appex is embedded
and signed by `mac/scripts/embed-extensions.sh` with the Developer ID profile
at `mac/profiles/Write_FileProvider_Developer_ID.provisionprofile`
(App ID `net.writeapp.write.mac.fileprovider`), sandboxed with the app group
and `com.apple.security.network.client` entitlements. Files appear under
Locations in the Finder sidebar. Unit-tested; on-device verification against a
throwaway workspace is still pending.

### Phase 3: Writes and conflicts - BUILT (unit-tested; on-device verification pending)
The File Provider is an editable Finder surface. New server `/api/sync/v1`
endpoints back the write path:

- `POST /files?folder=<id>` files a new item directly into a folder; the
  folder's mode dictates the kind, keeping notes and bookmarks unlisted.
- `PATCH /files/{id} {folder?, slug?}` moves and/or renames without re-sending
  the body.
- `PATCH /folders/{id} {name}` renames a folder.

PUT (content edit, If-Match) and DELETE already existed. The extension maps
each Finder mutation onto these: edit -> PUT, create -> folder-scoped POST then
a slug rename to the Finder name, delete -> DELETE, rename -> PATCH slug,
move -> PATCH folder, folder rename -> renameFolder. Folder delete and folder
move are deferred (not advertised as capabilities). The privacy invariant is
preserved: notes and bookmarks stay unlisted, server-enforced via folder mode.
Verified by unit tests (part of the 61 File Provider tests, 143 total mac
tests, all green); on-device end-to-end verification against a throwaway
workspace is still pending.

### Phase 4: Native polish - pending
Cloud badges, on-demand eviction (remove download), offline availability, sync
progress, precise per-item change deltas (the current remote signal is
coarse), and Finder context-menu actions.

### Phase 5: Retire the old path - pending (gated on writes being proven)
Once the File Provider writes are verified on-device against a throwaway
workspace, retire the native folder SyncEngine so the File Provider is the
single writer, and offer to clean up the old `iCloud Drive/Write` folder
(never auto-deleting user files). Ship as the default. Explicitly gated: this
phase does not start until Phase 3 writes are proven.

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
