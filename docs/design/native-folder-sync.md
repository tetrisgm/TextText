# Native Cloud Sync Folder Integration

## Purpose

Write's Mac app currently mirrors the server workspace into a normal folder, usually `~/Write`, by polling `/api/sync/v1` every 60 seconds, listening to the same API through a long poll, and watching local disk changes with FSEvents. The requested native integration is a different product surface: Finder should treat Write as a cloud storage provider, with standard cloud badges, on-demand downloads, eviction, pinning, and context actions.

This document began as design only. Since then the File Provider has been
built along these lines (kit + bridge + replicated extension + read + write);
`docs/file-provider-plan.md` is the live plan and status of record. This
document is kept for the design rationale and for the accurate readout of the
native SyncEngine, which still ships as the mirror until the cutover.

## Current Implementation Readout

The current Mac app is a SwiftPM AppKit executable target under `mac/Sources/Write`, built into a Developer ID app bundle by `mac/scripts/build-app.sh`. The committed bundle id is still the placeholder `com.example.write.mac`; release builds inject the real id. This design assumes the product bundle id is `net.writeapp.write.mac`.

Current sync pieces:

- `SyncEngine.swift`: serial sync loop. It fetches `/api/sync/v1/workspace`, creates local folders, pulls folder manifests with ETags, downloads markdown files, pushes edits with `If-Match`, creates new posts from new `.md` files, creates server folders from new directories, deletes server posts when indexed files disappear, and preserves conflicts as `name (conflicted copy yyyy-mm-dd hhmm).md`.
- `FolderWatcher.swift`: FSEvents over the sync root. It debounces local changes for push-only passes.
- `ChangeListener.swift`: long polls `GET /api/sync/v1/changes?cursor=...&wait=25`, then triggers `SyncEngine.syncNow()` and `CaptureAgent.poke()`.
- `StateStore.swift`: stores credentials, cached workspace JSON, the post id to file hash/path index, per-folder manifest ETags, and trash under `~/Library/Application Support/Write`.
- `OpenFileHandler.swift`: maps opened `.md` files inside the sync root back to post ids by looking up the sync index, then opens the web editor URL.
- `CaptureAgent.swift`: unrelated to file projection, but shares the sync token and change signal. It drains pending bookmark captures from `/api/sync/v1/captures`.

Current server API pieces:

- `GET /api/sync/v1/workspace`: authenticated workspace metadata plus folders.
- `GET /api/sync/v1/folders/{folderId}/manifest`: per-folder manifest with ETag based on rendered JSON hash.
- `GET /api/sync/v1/files/{postId}`: rendered markdown file plus ETag based on the markdown content hash.
- `PUT /api/sync/v1/files/{postId}`: parse markdown, require `If-Match`, reject stale writes with `412`, reject client-fixable parse or save errors with `400`, return the new manifest item.
- `POST /api/sync/v1/files`: parse markdown, create a draft, save it, return the created manifest item.
- `POST /api/sync/v1/files?folder=<id>`: folder-scoped create; files a new item directly into a folder so the folder's mode dictates the kind, keeping notes and bookmarks unlisted (added for the File Provider write path).
- `PATCH /api/sync/v1/files/{postId}`: move and/or rename (`{folder?, slug?}`) without re-sending the body (added for the File Provider write path).
- `DELETE /api/sync/v1/files/{postId}`: delete a post.
- `POST /api/sync/v1/folders`: create a subfolder under a parent path.
- `PATCH /api/sync/v1/folders/{folderId}`: rename a folder (`{name}`) (added for the File Provider write path).
- `GET /api/sync/v1/changes`: coarse workspace cursor for posts and folders.
- `src/lib/markdown-files.ts`: renders and parses the markdown file vocabulary. The server hash is the currency for sync.

The important behavior to preserve is not the local path polling. It is the server-authoritative markdown render, slug canonicalization, folder mode to item kind behavior, `If-Match` conflict detection, and never silently discarding user edits.

## Recommendation

Superseded by what shipped. The original recommendation here was to spike the File Provider first, then decide whether to fund the rewrite. That decision has been made and executed: the File Provider is built and is the chosen direction. `docs/file-provider-plan.md` is the live plan and status of record.

What exists now:

- `mac/Sources/WriteFileProviderKit`: the pure-Swift, framework-free core (server client, item model, `WorkspaceEnumerator`, change cursor, and the `FileProviderHandoff` app-group token handoff), fully unit-tested against a fake server.
- `mac/Sources/WriteFileProviderBridge`: the FileProvider-framework adapter (`WriteFileProviderItem: NSFileProviderItem`, identifier and capability bridges).
- `mac/Extensions/WriteFileProviderExtension`: the `NSFileProviderReplicatedExtension` principal class (enumerate, materialize file bodies on demand, and write back), embedded and signed by `mac/scripts/embed-extensions.sh`. The container app registers one `NSFileProviderDomain` ("Write") per workspace on sign-in.
- Read and write are both implemented. Finder edits, creates, deletes, renames, and moves map onto `/api/sync/v1` (see the endpoint list above, including the folder-scoped create and the move/rename `PATCH` added for this path). Notes and bookmarks stay unlisted, server-enforced via folder mode.

Still open: on-device end-to-end verification against a throwaway workspace, and the actual retirement of the native mirror (deferred to the proven cutover).

The reasoning below still holds and is why the cutover is staged rather than a flag-day switch: File Provider is the right primary target for the requested Finder behavior, but it is a large native subsystem with packaging, entitlement, concurrency, and OS integration risks. The existing mirror is simple, recoverable, and already protects user data. So the native SyncEngine in the readout above keeps shipping as the mirror until the File Provider writes are proven, at which point it is retired and the app offers to clean up the old `iCloud Drive/Write` folder (never auto-deleting). A rushed replacement would create the highest risk exactly where users expect Dropbox-level reliability.

## macOS Primary Target: File Provider

### Process Architecture

Add a separate File Provider extension target to the Mac app bundle:

- Container app: `net.writeapp.write.mac`
  - Owns sign-in, menu bar status, update flow, domain add/remove controls, diagnostics, and migration from the old `~/Write` mirror.
  - Starts or continues the `/api/sync/v1/changes` long poll when the user is linked.
  - Calls `NSFileProviderManager.add(_:)` through the Objective-C API `+[NSFileProviderManager addDomain:completionHandler:]` to register a domain.
  - Calls `NSFileProviderManager.remove(_:completionHandler:)` or the removal-mode API when disconnecting.
- File Provider extension: `net.writeapp.write.mac.FileProvider`
  - Extension point: `com.apple.fileprovider-nonui`.
  - Principal class implements `NSFileProviderReplicatedExtension`.
  - Runs out of process and may be launched, killed, and relaunched by the system.
  - Must be concurrency safe. The system can call enumeration, downloads, uploads, metadata updates, and deletes concurrently.
- Optional File Provider UI extension: `net.writeapp.write.mac.FileProviderUI`
  - Extension point: `com.apple.fileprovider-actionsui`.
  - Uses `FPUIActionExtensionViewController` for custom context menu actions and auth/error UI.
- Shared app group:
  - Stores credentials, provider metadata database, cursors, pending error records, and lightweight caches.
  - The current `StateStore` path under Application Support is app-local and must not be the extension's only source of truth.

The container app and extensions need stable bundle identifiers. Changing them later can orphan registered domains, app group state, Sparkle update trust, and Finder's provider registration.

### Domains

Use one `NSFileProviderDomain` per linked Write account or workspace. For the current one-blog account model, one visible domain is enough:

- Domain identifier: stable, non-secret string such as `write.<blogHandle>` or a hash of the account id. Do not include tokens.
- Display name: `Write` for a single account, or `Write - <blog name>` if multi-account support arrives.
- Registration:
  - On link, create `NSFileProviderDomain(identifier:displayName:)`.
  - Call `NSFileProviderManager.add(domain, completionHandler:)`.
  - If the account changes, remove the old domain using `NSFileProviderManager.remove(domain, completionHandler:)`.
  - On sign-out with dirty local data, prefer the macOS 13+ removal mode equivalent of `NSFileProviderManager.remove(domain, mode: .preserveDirtyUserData, completionHandler:)`. VERIFY exact behavior for Developer ID builds and user-facing preserved locations.
- Manager lookup:
  - Use `NSFileProviderManager.manager(for: domain)` to signal the provider and inspect global progress.

The extension is initialized per domain through `init(domain:)`. It should derive the linked account from the domain identifier plus app group state, not from process-global singleton state.

### Item Model

Use stable provider item identifiers:

- Root: `NSFileProviderItemIdentifier.rootContainer`.
- Working set: `NSFileProviderItemIdentifier.workingSet`.
- Folder: `folder:<folderId>`.
- Post file: `post:<postId>`.
- Local temporary creations before the server returns an id: `local:<uuid>`, mapped to `post:<postId>` after `POST /files` succeeds. The completion handler for `createItem(basedOn:...)` should return the server id item so the system can replace the temporary identifier.

Each item should implement `NSFileProviderItem`:

- `itemIdentifier`
- `parentItemIdentifier`
- `filename`
- `contentType`, using `UTType.folder` for folders and markdown or plain text type for files
- `capabilities`
- `documentSize`, if known after render or fetch
- `creationDate` and `contentModificationDate`, mapped from manifest `createdAt` and `updatedAt`
- `itemVersion`, using `NSFileProviderItemVersion(contentVersion:metadataVersion:)`
  - `contentVersion`: UTF-8 bytes of the server markdown hash from the manifest or GET ETag.
  - `metadataVersion`: bytes of a stable hash over filename, parent id, dates, status, and decoration-relevant metadata.
- `isUploaded`, `isUploading`, `uploadingError`
- `contentPolicy`, for on-demand and pinned behavior where supported
- `userInfo`, for status, post id, folder mode, public URL, and File Provider UI predicates

If custom badges are added, item objects should also adopt `NSFileProviderItemDecorating` and return `decorations`.

### Required Protocol Methods

The extension should implement the Swift methods corresponding to these verified SDK names:

- `init(domain: NSFileProviderDomain)`
- `invalidate()`
- `item(for:request:completionHandler:)`
- `fetchContents(for:version:request:completionHandler:)`
- `createItem(basedOn:fields:contents:options:request:completionHandler:)`
- `modifyItem(_:baseVersion:changedFields:contents:options:request:completionHandler:)`
- `deleteItem(identifier:baseVersion:options:request:completionHandler:)`
- `enumerator(for:request:)`

The enumerator should implement:

- `enumerateItems(for:startingAt:)`
- `enumerateChanges(for:from:)`
- `currentSyncAnchor(completionHandler:)`
- `invalidate()`

The header names behind these are `itemForIdentifier:request:completionHandler:`, `fetchContentsForItemWithIdentifier:version:request:completionHandler:`, `createItemBasedOnTemplate:fields:contents:options:request:completionHandler:`, `modifyItem:baseVersion:changedFields:contents:options:request:completionHandler:`, `deleteItemWithIdentifier:baseVersion:options:request:completionHandler:`, and `enumeratorForContainerItemIdentifier:request:error:`.

### Enumeration

Enumeration replaces `materializeFolders`, folder manifest pulling, and most of the old path index.

Root enumeration:

- Fetch or use cached `/api/sync/v1/workspace`.
- Return top-level folders as `folder:<id>` items.
- For the current workspace, the server already returns a flat folder list with `path` and `parentId` may be missing in the Mac wire type. The File Provider store should reconstruct parentage from paths unless the server adds `parentId` to the Swift model.

Folder enumeration:

- For `folder:<id>`, call `GET /api/sync/v1/folders/{folderId}/manifest` with the cached ETag when possible.
- Return child folder items whose parent path is the enumerated folder path.
- Return post file items from the manifest as `<slug>.md` with parent `folder:<folderId>`.
- Cache all returned items in the app group metadata store.

Working set enumeration:

- For `NSFileProviderItemIdentifier.workingSet`, implement change detection.
- Existing `/api/sync/v1/changes` gives only a coarse cursor. That is enough for MVP:
  - Anchor format: a compact UTF-8 string or JSON blob under 500 bytes containing the last server cursor and a local provider generation.
  - When asked for changes from an anchor, compare to the current `/changes` cursor.
  - If unchanged, finish with the current anchor and `moreComing: false`.
  - If changed, refetch `/workspace` and all manifests, diff against the app group item store, then call `didUpdateItems` and `didDeleteItems`.
  - Finish with the new cursor as `NSFileProviderSyncAnchor`.
- If the local metadata store cannot diff safely, return `NSFileProviderErrorSyncAnchorExpired` so the system re-enumerates.

This diff-heavy strategy reuses the current server API. A later server endpoint that returns item-level changes since a cursor would reduce work, but it is not required to ship a first File Provider.

### Content Fetch and On-Demand Materialization

`fetchContents(for:version:request:completionHandler:)` replaces `SyncEngine.download`.

Flow:

1. Resolve `post:<postId>` in the metadata store.
2. If `requestedVersion` is non-nil and the hash is no longer available, return `NSFileProviderErrorVersionNoLongerAvailable`.
3. Call `GET /api/sync/v1/files/{postId}`.
4. Write the returned markdown to a regular temporary file under `NSFileProviderManager.temporaryDirectoryURL()`, or another same-volume temporary directory accepted by File Provider.
5. Return the file URL and the updated `NSFileProviderItem`.

The system owns the returned file and will clone or move it into the user-visible location. The extension must not keep mutating that file after completion.

On-demand behavior:

- Files are represented as dataless items until accessed.
- Finder and normal POSIX opens trigger `fetchContents`.
- Use `NSProgress` from `fetchContents` so Finder can show download progress.
- For provider-initiated downloads, use `NSFileProviderManager.requestDownloadForItem(withIdentifier:requestedRange:completionHandler:)` or the Swift `requestDownloadForItem` API variant. VERIFY the exact Swift overload available in the deployment SDK.

Eviction:

- Let Finder and the OS evict clean, uploaded, non-pinned materialized files.
- Provider-initiated eviction uses `NSFileProviderManager.evictItem(identifier:completionHandler:)`.
- Prefer `NSFileProviderItem.contentPolicy` over deprecated `NSFileProviderItemCapabilitiesAllowsEvicting`.
- For normal markdown files, use `.downloadLazily`.
- For offline-pinned files or folders, use `.downloadEagerlyAndKeepDownloaded`.
- Track `NSFileProviderMaterializedSetDidChange` and the materialized set enumerator only if the menu bar app needs local counts or if the provider wants aggressive cache policy.

Pinning:

- "Pinned" in this design means user-selected offline availability, not the existing markdown frontmatter `pinned: true` used by Write content.
- The exact API for reading user pin state and recursive downloaded state should be verified in the target macOS SDK. VERIFY whether Finder's "Keep Downloaded" maps only through content policy, a user interaction, or materialized set state visible to the provider.

### Write-Back

`createItem`, `modifyItem`, and `deleteItem` replace FSEvents push scans.

Create file:

- Called when the user creates or copies a file into the provider tree.
- If the item is a folder, call `POST /api/sync/v1/folders` with `parent_path` and `name`, then return a `folder:<id>` item.
- If the item is a markdown file, read the system-provided `contents` URL.
- Inject kind for folder mode using the same rule as `bodyEnsuringKind`: notes get `kind: note`, bookmarks get `kind: bookmark`, blog defaults to article.
- Call `POST /api/sync/v1/files`.
- Return the server item as `post:<postId>`, with server slug filename `<slug>.md`.
- If the server canonical render differs, set `shouldFetchContent` so the system fetches the canonical markdown.

Modify file:

- Called when local content or metadata changes.
- For content edits, read `contents`, determine the base server hash from `baseVersion.contentVersion`, and call `PUT /api/sync/v1/files/{postId}` with `If-Match`.
- On success, update metadata with the returned manifest item.
- If the server returns a different slug, return an item with the new filename. The system will apply the rename on disk.
- If canonical render changed, set `shouldFetchContent`.
- If `PUT` returns `412`, return a File Provider conflict result:
  - Preferred: use `NSFileProviderModifyItemFailOnConflict` support and `NSFileProviderErrorLocalVersionConflictingWithServer` when available. The extension Info.plist may need `NSExtensionFileProviderSupportsFailingUploadOnConflict`. VERIFY behavior on the target macOS baseline.
  - Fallback: preserve the old engine policy by creating a conflicted copy as a new item, then returning the remote item as canonical. This needs careful testing because File Provider, not the provider, owns the visible tree.
- If the server returns `400`, return `NSFileProviderErrorCannotSynchronize` with a user-presentable underlying error and store it in `uploadingError`.

Modify folder:

- Rename and move are harder than the current server API supports. The API can create folders but does not expose rename, move, or delete folder endpoints in `/api/sync/v1`.
- MVP should set folder capabilities to allow reading, content enumerating, and adding subitems, but not renaming, reparenting, trashing, or deleting folders.
- File moves between folders also imply changing an item's type or folder ownership. Current `PUT` explicitly refuses changing across folder modes. MVP should reject cross-folder moves when the target folder would change mode, and VERIFY whether same-mode moves require a server endpoint.

Delete:

- For `post:<postId>`, call `DELETE /api/sync/v1/files/{postId}`.
- Treat a missing post as success.
- For folders, reject non-recursive deletes with `NSFileProviderErrorDirectoryNotEmpty` or disallow delete capability until the server supports folder deletion.

### Conflict Policy

The current three-way conflict policy depends on remote hash, indexed hash, and local file hash. File Provider supplies a more native base version through `baseVersion`:

- Remote hash: current server markdown hash from manifest or `GET /files`.
- Base hash: `baseVersion.contentVersion`, set from the last item version the system had on disk.
- Local bytes: `contents` URL passed to `modifyItem`.

Policy:

- If base hash matches current server hash, `PUT If-Match` is safe.
- If base hash does not match current server hash, treat as conflict before upload or expect server `412`.
- The remote server copy remains canonical for the original item id.
- The local edit must survive as an explicit conflicted copy, not be dropped.
- Conflicted copies should not auto-push until the user edits or renames them into a normal file.

Implementation detail to validate: creating a conflicted copy inside File Provider should be done as a provider item update, not by writing directly into the user-visible location. Direct writes to the replicated location are not the provider contract.

### Remote Change Signaling

`ChangeListener` should stay conceptually, but its output changes:

- The container app keeps long polling `/api/sync/v1/changes`.
- When the cursor changes, it updates the app group cursor cache and calls:
  - `NSFileProviderManager.manager(for: domain)?.signalEnumerator(for: .workingSet, completionHandler: ...)`
- For `NSFileProviderReplicatedExtension`, signal only `NSFileProviderItemIdentifier.workingSet`. The SDK header says other container identifiers are ignored for replicated providers.
- The working set enumerator then diffs manifests and publishes updated and deleted items.

The 60 second full poll can remain as a belt-and-braces signal from the container app during early rollout. It should signal the working set, not scan the visible folder.

### Finder Badges and Decorations

Native File Provider gives the standard cloud status badges from item state and operations:

- Cloud-only: dataless item, not materialized locally.
- Downloading: active `fetchContents` progress.
- Up-to-date: materialized file with current item version and no pending upload.
- Syncing: upload progress from `createItem` or `modifyItem`, plus `isUploading`.
- Error: upload/download errors returned through File Provider errors or item `uploadingError` and `downloadingError`.
- Pinned: user or provider policy keeps content downloaded. VERIFY exact user pin state API.

Custom decorations are optional and should not duplicate the standard badges.

Custom decorations:

- Info.plist key: `NSFileProviderDecorations` inside the extension's `NSExtension` dictionary.
- Item protocol: `NSFileProviderItemDecorating`.
- Item property: `decorations`.
- Decoration identifiers: app-specific `NSFileProviderItemDecorationIdentifier` strings such as `net.writeapp.write.mac.decoration.error` or `net.writeapp.write.mac.decoration.pinned`.
- Categories: `Badge`, `Sharing`, and `FolderBadge`.
- Availability: custom File Provider item decorations are practical for this app because the Mac target is already macOS 14. The prompt's macOS 12+ target should still be verified against the final deployment target and Finder behavior. VERIFY.

File Provider UI:

- Add a `FileProviderUI.framework` extension with `FPUIActionExtensionViewController`.
- Extension point: `com.apple.fileprovider-actionsui`.
- Configure `NSExtensionFileProviderActions` for actions such as:
  - Open in Write
  - Copy Public URL
  - Retry Sync
  - Show Sync Error
- Implement `prepare(forAction:itemIdentifiers:)` and complete with `extensionContext.completeRequest()` or fail with `extensionContext.cancelRequest(withError:)`.
- Implement `prepare(forError:)` for auth errors, sending users back to the container app sign-in flow.

### Entitlements, Signing, and Distribution

Known requirements from the Xcode File Provider template and SDK headers:

- File Provider extension `Info.plist`:
  - `NSExtensionPointIdentifier = com.apple.fileprovider-nonui`
  - `NSExtensionPrincipalClass = <module>.FileProviderExtension`
  - `NSExtensionFileProviderDocumentGroup = <app group>`
  - `NSExtensionFileProviderSupportsEnumeration = true`
- File Provider UI extension `Info.plist`:
  - `NSExtensionPointIdentifier = com.apple.fileprovider-actionsui`
  - `NSExtensionFileProviderActions = [...]`
- Entitlements:
  - App group entitlement: `com.apple.security.application-groups`
  - Application identifier entitlement: `com.apple.application-identifier`
  - Testing entitlement only for test domains: `com.apple.developer.fileprovider.testing-mode`
  - VERIFY whether any non-testing `com.apple.developer.fileprovider.*` entitlement is required by Apple provisioning for Developer ID distribution. The local Xcode macOS template does not show a separate non-testing File Provider entitlement, but Apple account capability approval may still be needed.
- App Sandbox:
  - Xcode's File Provider extension template enables App Sandbox for the extension.
  - The container app should share the same app group. VERIFY whether the non-sandboxed current container can keep its current behavior while holding the app group entitlement, or whether File Provider packaging forces sandbox alignment.
- Developer ID:
  - Ship the `.appex` bundles under `Write.app/Contents/PlugIns`.
  - Sign inside-out: nested extensions, frameworks, main executable, then the app.
  - Use hardened runtime and notarize the full app.
  - Avoid app translocation. The current app already prompts to move to `/Applications`; this becomes more important because File Provider can report provider translocation or disabled provider errors.
  - Sparkle updates must preserve bundle ids and extension ids, and should be tested while a domain is registered.

SwiftPM may not be enough by itself. The current package has one executable target. File Provider app extensions are usually managed by an Xcode project or a custom build system that can assemble extension bundles, plists, entitlements, and PlugIns layout. The spike must prove whether to keep SwiftPM plus custom scripts or introduce a small Xcode project for the Mac app.

## Reuse of `/api/sync/v1`

The server can stay mostly unchanged for the first native provider.

Unchanged server responsibilities:

- Auth and token scope in `auth.ts`.
- Workspace ownership and tenant isolation.
- Folder listing through `/workspace`.
- Folder manifest rendering and ETags.
- Markdown rendering and parsing in `src/lib/markdown-files.ts`.
- Markdown content hash as sync currency.
- File GET, POST, PUT with `If-Match`, DELETE.
- Folder create.
- Coarse change cursor.
- Capture endpoints and capture agent behavior.

Client changes:

- Replace filesystem scanning with File Provider callbacks.
- Replace path-index decisions with item id and item version decisions.
- Keep a provider metadata store in the app group, not just `index.json` under app-local Application Support.
- Convert remote change events into working set signals.
- Convert upload progress and errors into File Provider item state.

Optional later server improvements:

- Item-level change feed: `GET /api/sync/v1/changes?cursor=X&include_items=1`.
- Folder rename, move, and delete endpoints.
- Same-mode post move endpoint if folders become true organization containers rather than inferred by post type.
- Lightweight `HEAD /files/{postId}` or manifest item endpoint for metadata refresh.

## Current Responsibility Mapping

| Current responsibility | Current owner | File Provider seam | Server change |
| --- | --- | --- | --- |
| Workspace discovery | `SyncEngine.performPass` calls `/workspace` | Root and folder enumerators read `/workspace` | None |
| Folder creation on disk | `materializeFolders` | Folder items returned by enumeration | None |
| Remote list by folder | `pullFolder` calls folder manifest with ETag | `enumerateItems` and working set diff call folder manifest | None |
| Remote content download | `download` calls `GET /files/{id}` and writes local file | `fetchContents(for:version:request:completionHandler:)` | None |
| Remote change signal | `ChangeListener` calls `engine.syncNow()` | Container app calls `signalEnumerator(for: .workingSet)` | None |
| Local change detection | FSEvents plus push-only pass | `createItem`, `modifyItem`, `deleteItem` | None for files |
| New file create | scan unindexed `.md`, `POST /files` | `createItem(basedOn:fields:contents:...)` | None |
| Existing file edit | hash diff, `PUT /files/{id}` with `If-Match` | `modifyItem(...baseVersion..., contents:...)` | None |
| Delete file | missing indexed file, `DELETE /files/{id}` | `deleteItem(identifier:baseVersion:...)` | None |
| Folder create | new local directory, `POST /folders` | `createItem` for folder | None |
| Folder rename/move/delete | not implemented | disallow in capabilities | Later endpoint needed |
| Slug canonicalization | move local file after server response | return item with server filename and optionally `shouldFetchContent` | None |
| Conflict handling | conflicted copy next to file | baseVersion plus `412`, provider-created conflicted copy | None, but needs careful native UX |
| Server-deleted local copy preservation | move to app state trash | preserve dirty local edit through File Provider conflict path | None |
| Status menu | `engine.isSyncing`, last summary | observe File Provider progress plus provider DB errors | None |
| Open file in web editor | path to post id from `index.json` | `getIdentifierForUserVisibleFile(at:)`, or File Provider UI action | None |
| Bookmark capture | `CaptureAgent` drains captures | stays in container app | None |

## Sync Status Vocabulary

Use the standard system state wherever possible. Custom decorations should be reserved for Write-specific states the OS does not show.

| Status | Meaning | Finder badge | Custom decoration | Menu-bar app | Context menu |
| --- | --- | --- | --- | --- | --- |
| Cloud-only | Metadata exists locally, content is dataless | Standard cloud icon from File Provider | None | Optional count hidden by default | System Download Now or Keep Downloaded |
| Downloading | Content fetch in progress | Standard progress indicator from `NSProgress` | None | Global download progress from `NSFileProviderManager.globalProgress(for:)` | System cancel or progress UI where available |
| Up-to-date | Current content is materialized or dataless with no pending upload | Standard check or no-warning state | None | "Up to date" plus last server signal time | Open in Write, Copy Public URL |
| Syncing | Local create or modify is uploading | Standard syncing or uploading badge from `isUploading` and progress | None | "Syncing" with item count and progress | Show Sync Status |
| Error | Upload or download failed, auth missing, parse rejected, or cannot synchronize | Standard error badge from provider error fields | Optional `write.error` badge for persistent parse or conflict errors | Error headline, Retry, Open Status | Retry Sync, Show Error |
| Pinned | User wants content kept offline | System keep-downloaded or pinned indicator where Finder shows it | Optional only if Write has a separate offline policy | Pinned count if useful | System Keep Downloaded or Remove Download |

Do not use custom badges to replace cloud-only, downloading, up-to-date, or syncing. Users already know the system vocabulary from iCloud Drive, Dropbox, OneDrive, and similar providers.

## Future Windows Parity: Cloud Files

Windows parity should use the Cloud Files API and Cloud Filter API, not a plain watched folder.

Core pieces:

- Sync root registration:
  - Modern WinRT: `Windows.Storage.Provider.StorageProviderSyncRootManager.Register(StorageProviderSyncRootInfo)`.
  - Native Cloud Filter: `CfRegisterSyncRoot`.
  - Connection at runtime: `CfConnectSyncRoot` with a `CF_CALLBACK_REGISTRATION` table, then `CfDisconnectSyncRoot` on shutdown.
- Placeholders:
  - Use `CfCreatePlaceholders` to create placeholder files and directories under the registered sync root.
  - Store the Write item identity in the placeholder `FileIdentity` blob. Keep it under the 4 KB limit.
  - Use `CfUpdatePlaceholder` for remote metadata changes and `CfConvertToPlaceholder` only when converting existing files. VERIFY exact use for migration from a non-cloud `~/Write` style folder.
- Hydration:
  - Register `CF_CALLBACK_TYPE_FETCH_DATA`.
  - The callback receives required and optional byte ranges in `CF_CALLBACK_PARAMETERS.FetchData`.
  - Fetch markdown with `GET /api/sync/v1/files/{postId}`.
  - Respond with `CfExecute` using `CF_OPERATION_TYPE_TRANSFER_DATA`.
  - Explicit hydration can be requested with `CfHydratePlaceholder`.
  - Use `CF_CALLBACK_TYPE_CANCEL_FETCH_DATA` to cancel network work when the platform no longer needs a range.
- Directory population:
  - Register `CF_CALLBACK_TYPE_FETCH_PLACEHOLDERS` if using on-demand directory population.
  - Respond with `CfExecute` using `CF_OPERATION_TYPE_TRANSFER_PLACEHOLDERS`.
  - Reuse `/workspace` and folder manifests like the Mac provider.
- In-sync state:
  - After successful upload or after creating placeholders from known server metadata, call `CfSetInSyncState`.
  - Use `CF_IN_SYNC_STATE_IN_SYNC` and `CF_IN_SYNC_STATE_NOT_IN_SYNC`.
  - Pass USN when available to avoid marking a file in sync after it changed again.
- Local edits:
  - Watch the sync root using Windows change notifications or a USN journal based watcher.
  - Push changed markdown through `PUT /files/{postId}` with `If-Match`.
  - New local files go through `POST /files`.
  - Deletes go through `DELETE /files/{postId}`.
  - Cloud Filter has delete and rename notification callbacks such as `CF_CALLBACK_TYPE_NOTIFY_DELETE`, `CF_CALLBACK_TYPE_NOTIFY_DELETE_COMPLETION`, `CF_CALLBACK_TYPE_NOTIFY_RENAME`, and `CF_CALLBACK_TYPE_NOTIFY_RENAME_COMPLETION`.
- Status UI:
  - Use standardized Cloud Files hydration and sync state icons in File Explorer.
  - For provider-level status flyout, implement `Windows.Storage.Provider.IStorageProviderStatusUISource`. Microsoft docs list this under `Windows.Storage.Provider.CloudFilesContract` v7 and Windows 11 Insider Preview build 10.0.23504, so production availability must be verified. VERIFY.
  - Additional context verbs use Desktop Bridge-compatible APIs, typically COM local servers implementing shell interfaces such as `IExplorerCommand`.

Packaging and identity:

- Microsoft states the sync engine itself must be a desktop app, not a UWP app.
- Cloud Files APIs are designed with Desktop Bridge as an implementation requirement. For a modern client, plan on MSIX/package identity.
- A pure unpackaged Win32 approach may be able to use some registry-based sync root and navigation pane integration, but status UI, packaged COM activation, and Store-like identity are cleaner with MSIX. VERIFY final installer constraints.
- Cloud Files requires NTFS for placeholder support.

The same server API can be reused. The Windows client needs an equivalent metadata store, hash/version mapping, and conflict policy. It should not reuse Mac File Provider assumptions directly, but the logical item ids and server sync contract should match.

## Phased Plan

| Phase | Scope | Effort | Risk |
| --- | --- | --- | --- |
| 0. Spike | Create a minimal File Provider extension target, app group, fake domain, fake root/folder/file, one `fetchContents`, Developer ID signing, notarization, Sparkle update through an installed app | 1 to 2 weeks | High. Entitlements, packaging, and Finder provider lifecycle are unknown in this repo |
| 1. Read-only enumerate | Real domain registration after link, `/workspace` root enumeration, folder manifest enumeration, working set anchors, long-poll to `signalEnumerator`, read-only `fetchContents` for markdown | 3 to 5 weeks | High. Anchor correctness, extension concurrency, and Finder cache invalidation need real machine testing |
| 2. Read/write | Implement file create, modify, delete, upload progress, `If-Match` conflicts, canonical slug rename, parse error surfacing, folder create, folder mutation capabilities | 5 to 8 weeks | Very high. This is where data-loss bugs live |
| 3. On-demand | Dataless-first policy, eviction, explicit download, offline pinning, materialized set tracking, menu-bar progress sourced from File Provider | 3 to 5 weeks | Medium to high. OS behavior varies across macOS releases and Finder UI paths |
| 4. Custom decorations and UI | `NSFileProviderDecorations`, `NSFileProviderItemDecorating`, File Provider UI extension actions, custom retry/error/open actions | 2 to 4 weeks | Medium. Valuable polish, but not core correctness |

These estimates assume one senior macOS engineer with access to Developer ID signing, real test machines, and enough time to repeatedly reset File Provider state. They do not include Windows implementation.

## Major Risks

- Data loss through incorrect conflict handling. The old engine explicitly preserves local bytes. The File Provider version must be proven with concurrent web edits, local edits, deletes, moves, and offline work.
- Packaging churn. The repo is SwiftPM-only today. File Provider extensions may force an Xcode project or more complex custom bundle assembly.
- Entitlement uncertainty. App groups are known, testing mode is known, but non-testing File Provider entitlement provisioning for Developer ID needs account-level verification.
- Finder cache state. Bad anchors or item id changes can require domain reimport or removal. Recovery tooling is required.
- Folder semantics. The current server API cannot fully support Finder folder rename, move, or delete.
- On-demand edge cases. POSIX tools, editors with atomic save behavior, Spotlight, Quick Look, antivirus-like scanners, and backup tools can trigger hydration and metadata changes in surprising orders.
- Markdown canonicalization. Server rewrites frontmatter. The provider must tell the system when to fetch canonical content so Finder does not keep stale local bytes.
- App translocation. File Provider can be disabled or fail when running from a translocated app. The existing move-to-Applications flow should be treated as mandatory for release.

## Validation Matrix

Minimum Mac validation before replacing the old sync root:

- Fresh install, link account, domain appears in Finder.
- Sign out, domain removal preserves dirty local edits.
- Remote create, edit, delete from web, Finder updates through `signalEnumerator`.
- Finder open of cloud-only file hydrates markdown and opens in editor.
- Local edit uploads with `If-Match` and returns to up-to-date.
- Local edit plus concurrent web edit produces a visible conflicted copy.
- New local `.md` creates a post and renames to the server slug.
- Server canonical render is fetched after create and modify.
- Server rejected file shows a persistent error and does not hot-loop.
- Offline edit queues or fails visibly without data loss. VERIFY desired product behavior.
- App update while a domain is registered keeps the domain working.
- Notarized Developer ID build from `/Applications` passes `codesign`, `spctl`, and File Provider runtime launch.

## References Consulted

- Apple Developer Documentation:
  - `NSFileProviderReplicatedExtension`: https://developer.apple.com/documentation/fileprovider/nsfileproviderreplicatedextension
  - `NSFileProviderManager`: https://developer.apple.com/documentation/fileprovider/nsfileprovidermanager
  - `NSFileProviderItemDecorating`: https://developer.apple.com/documentation/fileprovider/nsfileprovideritemdecorating
  - `FileProviderUI`: https://developer.apple.com/documentation/fileproviderui
- Local Xcode SDK headers under `FileProvider.framework` and `FileProviderUI.framework` for exact method names and Info.plist keys.
- Microsoft Learn:
  - `CfRegisterSyncRoot`: https://learn.microsoft.com/en-us/windows/win32/api/cfapi/nf-cfapi-cfregistersyncroot
  - `CfCreatePlaceholders`: https://learn.microsoft.com/en-us/windows/win32/api/cfapi/nf-cfapi-cfcreateplaceholders
  - `CfConnectSyncRoot`: https://learn.microsoft.com/en-us/windows/win32/api/cfapi/nf-cfapi-cfconnectsyncroot
  - `CF_CALLBACK_TYPE`: https://learn.microsoft.com/en-us/windows/win32/api/cfapi/ne-cfapi-cf_callback_type
  - `CF_CALLBACK_PARAMETERS`: https://learn.microsoft.com/en-us/windows/win32/api/cfapi/ns-cfapi-cf_callback_parameters
  - `CfExecute`: https://learn.microsoft.com/en-us/windows/win32/api/cfapi/nf-cfapi-cfexecute
  - `CfHydratePlaceholder`: https://learn.microsoft.com/en-us/windows/win32/api/cfapi/nf-cfapi-cfhydrateplaceholder
  - `CfSetInSyncState`: https://learn.microsoft.com/en-us/windows/win32/api/cfapi/nf-cfapi-cfsetinsyncstate
  - `StorageProviderSyncRootManager`: https://learn.microsoft.com/en-us/uwp/api/windows.storage.provider.storageprovidersyncrootmanager
  - `IStorageProviderStatusUISource`: https://learn.microsoft.com/en-us/uwp/api/windows.storage.provider.istorageproviderstatusuisource
  - Build a Cloud Sync Engine that Supports Placeholder Files: https://learn.microsoft.com/en-us/windows/win32/cfapi/build-a-cloud-file-sync-engine
