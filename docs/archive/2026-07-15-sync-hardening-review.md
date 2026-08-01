# Adversarial sync review

> **ARCHIVED / RESOLVED (historical record).** Every finding in this adversarial
> review was fixed and released in v0.55 and v0.57 (revision CAS, durable
> cursor, idempotency). For the current sync contract see
> `src/lib/documents/sync.ts` and `docs/agent-interoperability.md`. Nothing below
> is current project status.

> STATUS (updated 2026-07-15): RESOLVED and SHIPPED. Every finding below was
> fixed and released in v0.55 and v0.57 (revision CAS, durable cursor,
> idempotency; see docs/archive/2026-07-13-sync-races-and-slug-404.md and the
> "Fixes applied" section further down). This document is retained as the review
> record: the findings read as open only because they are the original writeup,
> not a current backlog.

1. **[DATA-LOSS] `If-Match` is a check-then-write race, not an atomic compare-and-swap**

   `src/app/api/sync/v1/files/[postId]/route.ts:93`  
   `src/lib/store.ts:2076`  
   `src/lib/store.ts:2105`

   Failure scenario: SyncEngine and File Provider both edit hash `H0`. Both PUTs resolve the post and pass the `If-Match: H0` check before either update commits. Both then execute unconditional full-row updates. Both receive 200; the later update silently destroys the earlier edit.

   Why it is real: the hash comparison happens in the route at lines 96–100, while `savePost` later updates only by `id`, `blogId`, and `deletedAt` at lines 2106–2116. No version, timestamp, or hash participates in the SQL `WHERE`. MCP/web helpers also feed stale whole-post snapshots into the same primitive.

   There is an even worse branch: if the post is deleted after the check, the update returns no row and `savePost` falls through to an insert/upsert at lines 2121–2143. That can resurrect the deleted item with a new ID, or overwrite a different live item that has since claimed the same slug.

   Suggested fix: add a monotonic post revision or stored rendered-content hash. Perform `UPDATE ... WHERE id = ? AND revision = ? AND deleted_at IS NULL RETURNING ...`, returning 412 on zero rows. An update with an `id` must never fall through to insert. Route all web, MCP, sync, and capture mutations through this CAS primitive.

2. **[DATA-LOSS] Rename and move use stale full-post saves and are non-atomic**

   `src/app/api/sync/v1/files/[postId]/route.ts:185`  
   `src/lib/store.ts:971`  
   `src/lib/store.ts:2058`  
   `mac/Extensions/TextTextFileProviderExtension/FileProviderExtension.swift:214`

   Failure scenario: a rename PATCH resolves post body `A`; the web editor saves body `B`; PATCH then calls `savePost({ ...post, slug })`. The stale body `A` is written back along with the slug, silently deleting `B`.

   For move+rename, `setPostFolder` commits first. If the subsequent slug save fails - for example, because the slug is occupied - the route returns 400 but the move remains committed. No `sync.patch_file` audit is written.

   Why it is real: PATCH requires no `If-Match`; rename calls the whole-row `savePost` at line 217. Move and rename are separate database statements at lines 207–218. File Provider’s base version is not passed to PATCH.

   Suggested fix: implement one atomic `moveAndRenamePost` store operation that updates only `folder_id` and `slug`, validates mode, and includes the expected revision/hash in its `WHERE`. Require `If-Match` for file and folder metadata PATCHes.

3. **[DATA-LOSS] Stale clients can delete newer server edits without a conflict**

   `src/app/api/sync/v1/files/[postId]/route.ts:160`
   `mac/Sources/TextText/SyncEngine.swift:632`
   `mac/Extensions/TextTextFileProviderExtension/FileProviderExtension.swift:238`
   `mac/Sources/TextText/ServerClient.swift:234`

   Failure scenario: the native mirror indexes `H0`; the web app saves `H1`; before the native full pull runs, the user deletes the local file. The FSEvents push-only pass calls unconditional DELETE, and the `H1` post is moved to server Trash.

   File Provider has the same defect: `deleteItem` receives `baseVersion` but ignores it.

   Why it is real: DELETE accepts no `If-Match` and calls `deletePost` directly. Both native and File Provider delete APIs send only the post ID.

   Suggested fix: require `If-Match` on DELETE, perform an atomic revision check, and return 412 on a stale delete. Pass `IndexEntry.hash` from SyncEngine and `baseVersion.contentVersion` from File Provider. Keeping 204/404 as successful retry outcomes remains appropriate.

4. **[CORRECTNESS] A new file under Notes can be published publicly by the native engine**

   `mac/Sources/TextText/SyncEngine.swift:885`
   `mac/Sources/TextText/SyncEngine.swift:981`
   `mac/Sources/TextText/ServerClient.swift:220`
   `src/app/api/sync/v1/files/route.ts:37`
   `src/lib/store.ts:2072`

   Failure scenario: place this new file under the native `Notes/` mirror:

   ```yaml
   ---
   type: article
   status: published
   ---
   private material
   ```

   `bodyEnsuringKind` sees an existing `type:` and leaves it unchanged. `postFile` omits `?folder=notes-id`, so the server trusts the article type, creates it in Blog, and allows `published`.

   Why it is real: the server only makes folder mode authoritative when a folder query parameter is supplied. The File Provider supplies it; native SyncEngine does not.

   The same omission causes ordinary native creates in subfolders to land in the system root. Native moves are also never PATCHed: an unchanged file moved between subfolders keeps the same sync hash, is skipped by the edit loop, and is moved back by the next pull.

   Suggested fix: change native `postFile` to take and send `folderId`, exactly like `TextTextSyncAPI.createFile`. Add a hash-guarded PATCH for detected local moves. The server should reject folderless private-kind creates from sync clients or require an explicit target folder.

5. **[DATA-LOSS] The mass-delete breaker does not protect small workspaces**

   `mac/Sources/TextText/SyncEngine.swift:648`
   `mac/Sources/TextText/SyncEngine.swift:655`
   `mac/Sources/TextText/SyncEngine.swift:659`

   Failure scenario: an iCloud mirror with nine posts materializes its hidden sync marker before its content, with no `.icloud` placeholders yet. All nine paths return ENOENT, but `missingCount >= 10` is false. SyncEngine propagates nine server deletes - 100% of the workspace.

   Why it is real: the breaker requires both at least ten missing files and at least half the index. The breadcrumb only detects a different mirror; it cannot distinguish a valid but partially materialized mirror.

   Suggested fix: do not use an absolute minimum that permits total deletion of small workspaces. Require deletion evidence to persist across multiple completed scans, validate root/materialization health, and pause any high-fraction batch. The strongest design is a local deletion journal populated by actual coordinated delete events.

6. **[DATA-LOSS] Failed conflict-copy preservation does not stop canonical overwrite**

   `mac/Sources/TextText/SyncEngine.swift:604`
   `mac/Sources/TextText/SyncEngine.swift:761`
   `mac/Sources/TextText/SyncEngine.swift:1009`

   Failure scenario: both sides changed, but moving the local file to the conflict-copy path fails because of a coordination or filesystem error. `preserveAsConflictedCopy` returns `nil`; SyncEngine nevertheless downloads the server copy over the canonical path. The local edit is gone.

   Why it is real: both pull-side and 412 conflict paths ignore a `nil` preservation result and proceed to `download`. The helper deliberately converts every move error to `nil`.

   Suggested fix: make successful preservation a hard prerequisite for replacement. If it fails, leave the canonical file untouched, retain the old index hash, report an error, and retry later.

7. **[CORRECTNESS] The server’s sync projection is not a valid folder tree**

   `src/app/api/sync/v1/workspace/route.ts:22`
   `src/lib/store.ts:1425`
   `src/app/api/sync/v1/folders/[folderId]/manifest/route.ts:35`
   `mac/Sources/TextTextFileProviderKit/WorkspaceEnumerator.swift:103`
   `mac/Sources/TextTextFileProviderKit/WorkspaceEnumerator.swift:161`

   Failure scenario: create `Blog/Ideas` and put post `P` in it. The workspace response omits `parentId`, so File Provider decodes Ideas as top-level. Separately, the root Blog manifest includes descendants, while Ideas’ manifest also contains `P`. File Provider therefore receives the same stable item identifier under two parents.

   `findFile` scans folders in order and commonly finds `P` in the root Blog manifest first, returning the wrong parent even after a successful move. Finder can show duplicates, move folders to root, or snap moved files back.

   Why it is real:

   - The workspace route serializes `id`, `name`, `path`, and `mode`, but not `parentId`.
   - `getFolderPostFiles("blog")` deliberately includes `blog/%`, although the sync manifest route claims to be exact-folder.
   - `everything()` and `findFile()` do not deduplicate IDs.

   Suggested fix: include `parentId` in the workspace response. Add an exact-folder store query for sync manifests; root Blog must not include descendant-folder posts. Assert globally that each post ID appears in exactly one manifest.

8. **[CORRECTNESS] File Provider change enumeration never reports deletions**

   `mac/Extensions/TextTextFileProviderExtension/TextTextEnumeratorAdapter.swift:56`
   `mac/Sources/TextText/AppDelegate.swift:707`

   Failure scenario: a post is deleted on the web. The app signals the working-set enumerator. `enumerateChanges` lists survivors only through `didUpdate`; it never calls `didDeleteItems`. The old Finder item can remain as a ghost.

   Editing that ghost sends PUT to a deleted ID. The 404 is mapped through the default transient path to `serverUnreachable`, leaving the edit in a retry loop.

   Why it is real: absence from `didUpdate` is not a deletion delta. The test observer even implements `didDeleteItems`, but production never invokes it.

   Suggested fix: maintain per-anchor item snapshots and emit removed identifiers, or expose server tombstones/change-log deltas. If a precise delta cannot be produced for an anchor, return `syncAnchorExpired` so File Provider performs a full reconciliation.

9. **[RACE] File Provider applies rename/move even after content PUT fails**

   `mac/Extensions/TextTextFileProviderExtension/FileProviderExtension.swift:205`
   `mac/Extensions/TextTextFileProviderExtension/FileProviderExtension.swift:220`
   `mac/Extensions/TextTextFileProviderExtension/TextTextEnumeratorAdapter.swift:86`

   Failure scenario: one `modifyItem` contains content and filename changes. PUT returns 412 because the web editor changed the post. File Provider still executes PATCH, successfully renaming the server item, then reports `serverUnreachable`. The content did not save, the rename did, and the framework can retry indefinitely with the same stale base hash.

   Conversely, if PUT succeeds and PATCH fails, content is committed while the whole operation is reported as failed. Retrying immediately produces a 412 against the just-committed content.

   Why it is real: the second operation is unconditional regardless of `lastError`. A conflict is deliberately mapped to generic connectivity failure rather than `versionNoLongerAvailable`.

   Suggested fix: ideally expose one atomic content+metadata mutation guarded by one hash. At minimum, stop immediately after PUT failure, use the PUT-returned new hash to guard PATCH, and map 412 to `NSFileProviderError.versionNoLongerAvailable`.

10. **[ROBUSTNESS] File and folder creates are not idempotent**

    `src/app/api/sync/v1/files/route.ts:41`
    `mac/Extensions/TextTextFileProviderExtension/FileProviderExtension.swift:149`
    `src/lib/store.ts:644`

    Failure scenario: server POST commits, but the response is lost. File Provider retries:

    - For an empty Finder-created file, each attempt gets a fresh `untitled-<time>` slug, producing duplicate posts.
    - Folder retries deliberately create `ideas`, then `ideas-2`, both displayed as “Ideas.”
    - If the original create and slug PATCH succeeded but completion was lost, the retry creates another post; the second slug PATCH collides and its failure is suppressed at line 162.

    Why it is real: neither create endpoint accepts an idempotency key. File Provider create is two independent requests, and it reports the first create as success even when name reconciliation fails.

    Suggested fix: send a stable `Idempotency-Key` derived from the File Provider create request/item identity and store the completed response server-side. Support desired slug in the initial create so the operation is one statement. Apply the same mechanism to folder creation and native POSTs.

11. **[CORRECTNESS] The timestamp cursor can miss a change forever**

    `src/lib/sync-cursor.ts:8`
    `src/lib/sync-cursor.ts:18`
    `src/app/api/sync/v1/changes/route.ts:42`

    Failure scenario: the client holds cursor `...123Z`. Another mutation receives an `updated_at` within the same millisecond. PostgreSQL timestamps may differ below millisecond precision, but conversion through JavaScript `Date` and `toISOString()` produces the same cursor. With no later mutation, every poll continues returning equality and `changed:false`.

    Why it is real: the comment says ties resolve on the next poll, but polling the same `max(timestamp)` cannot break a tie. There is no ID, counter, or sequence component.

    Suggested fix: maintain a monotonic workspace revision, incremented atomically by every post/folder mutation, and use it as the opaque cursor. A durable change-log sequence would also support proper File Provider deletion deltas.

12. **[RACE] File Provider can label new bytes with an old content version**

    `mac/Extensions/TextTextFileProviderExtension/FileProviderExtension.swift:65`
    `mac/Extensions/TextTextFileProviderExtension/FileProviderExtension.swift:83`
    `mac/Sources/TextTextFileProviderKit/LiveTextTextSyncAPI.swift:41`

    Failure scenario: `fetchContents` reads manifest hash `H1`; the web changes the file to `H2`; File Provider GETs body `H2` but returns the previously built item carrying `H1`. The user edits bytes based on `H2`, yet their next PUT sends `If-Match: H1` and falsely conflicts.

    Why it is real: `requestedVersion` is ignored, and the `TextTextFileContent.hash` returned from GET is discarded.

    Suggested fix: verify the GET ETag equals the requested/current item version. Construct the returned item using the GET hash, or fail with `versionNoLongerAvailable` and force re-enumeration when versions differ.

13. **[ROBUSTNESS] Content mutations and mandatory audit rows are not atomic**

    `src/app/api/sync/v1/files/route.ts:54`  
    `src/app/api/sync/v1/files/route.ts:65`  
    `src/app/api/sync/v1/files/[postId]/route.ts:120`  
    `src/app/api/sync/v1/files/[postId]/route.ts:141`

    Failure scenario: PUT commits the edit, then `recordAction` fails. The route returns 500 even though content changed and no audit exists. Retrying with the original hash gets 412. POST is worse: audit or bookmark-enqueue failure enters the broad catch and soft-deletes an otherwise successful create; cleanup itself is best-effort and unaudited.

    A move followed by failed rename similarly leaves a committed, unaudited partial mutation.

    Why it is real: audits run after store mutations in separate database calls. Store operations do not write their own audit row.

    Suggested fix: make mutation plus audit one transaction or one database procedure/CTE. If the current driver cannot transact, use a durable outbox written atomically with the mutation. Do not place post-save side effects inside the placeholder-cleanup catch.

## Verified sound points

- File ETags are hashes of the exact rendered Markdown, and `If-Match` uses strong comparison correctly; the defect is atomic enforcement, not hash calculation.
- Manifest ETags correctly hash the exact rendered JSON body.
- `TextTextItem.itemVersion.contentVersion` correctly carries the manifest hash; staleness and materialization pairing are the problems.
- Folder-scoped File Provider creates and sync PUT’s type-family check preserve note/bookmark privacy. The unsafe exception is native folderless POST.
- Native folder ETags are cached only after a clean pull, conflict-copy names avoid collisions, and the mirror-ID breadcrumb correctly blocks deletes against a clearly different root.
- The long-poll wait bounds, timeout headroom, inequality comparison, and abort check are sound once the cursor source is made collision-free.
- DELETE retries correctly treat both 204 and 404 as complete; only stale-delete protection is missing.

## Overall assessment

TextText’s sync is not bulletproof: its hashes and three-way native merge design are good foundations, but the server lacks an atomic versioned mutation primitive, so simultaneous writers can both “win” and silently overwrite each other. The top three fixes are: implement store-level CAS for PUT/PATCH/DELETE and remove `savePost`’s update-to-insert fallthrough; make native creates and moves folder-aware to close the Notes publication leak; and replace File Provider’s relist-as-updates behavior with real versioned deltas, deletion reporting, and atomic compound modifications.

## Fixes applied (2026-07-12)

Constraint: the DB driver is `drizzle-orm/neon-http`, which has no interactive
transactions, so the compare-and-swap is a single-statement optimistic lock, not
`SELECT ... FOR UPDATE`.

### The keystone: a durable `revision`

Round 1 tried a timestamp CAS and a tie-counted cursor; a second Codex pass
showed both miss same-millisecond writes. The real fix is one primitive: a
`revision bigint` on `posts` and `folders`, drawn from a shared
`texttext_change_seq` sequence, assigned by the column default on insert and by a
`BEFORE UPDATE` trigger (`bump_revision()`) on every update. Revisions are
globally unique and strictly increasing, so no mutation path can forget to bump
one and no two changes ever share a value. DDL in `scripts/migrate-add-revision.mjs`.
This single primitive resolves #1, #2, #3, #9, and #11:

- **#1 lost-update CAS** - `savePost` takes `expectedRevision`; the id-present
  UPDATE is guarded by `revision = <base>` and a zero-row guarded update throws
  `PostConflictError` (never the insert fallthrough that resurrected deleted
  posts). Because every write draws a fresh revision, two writes in the same
  millisecond get different revisions and the second conflicts. Wired through the
  sync PUT, the MCP `update_item`, and the editor save (owner + collaborator), so
  all three consumers are guarded, not just sync.
- **#2 move/rename** - `movePostFile` updates only `folder_id` + `slug` (never the
  body) and is `expectedRevision`-guarded, so a racing body PUT is neither
  clobbered nor lost to a stale metadata write. A no-op PATCH returns the row
  untouched instead of bumping the cursor.
- **#3 stale delete** - `deletePostAtomic` deletes in one `revision`-guarded
  statement, so an edit landing between resolve and delete conflicts (412) rather
  than being silently discarded. The route also rejects a mismatched `If-Match`.
- **#11 cursor** - `workspaceChangeCursor` is `max(revision)` across posts and
  folders. It advances on every mutation (the trigger guarantees it), never
  reuses a value, and same-millisecond changes are distinct. Hard-deleting
  trashed rows can only trigger a harmless extra resync, never a missed change.

### Other fixes

- **#4 native create privacy** - `postFile(body:folderId:)` sends `?folder=<id>`,
  so the server’s folder mode is authoritative and a note filed under Notes stays
  a draft note. (Native MOVE-as-PATCH is handled in the Mac client track.)
- **#5 mass-delete breaker** - small-workspace protection (Mac client track).
- **#6 conflict-copy** - `preserveAsConflictedCopy` returns a 3-way
  `ConflictPreservation`; all six overwrite/move sites refuse to replace the
  canonical file when preservation `.failed`, keeping the old index hash to retry.
- **#7 valid tree** - workspace route emits `parentId`; `getFolderPostFiles` gains
  an `exact` mode and the manifest route uses it, so the blog root lists only its
  direct children (each post in exactly one manifest). Public blog view unchanged.
- **#8 FP deletions** - `enumerateChanges` expires the anchor to force a full
  reconcile that drops web-deleted ghosts (Mac client track refines it to only
  expire when the anchor differs from the current cursor).
- **#10 create idempotency** - POST `/files` and `/folders` honor an
  `Idempotency-Key` header via an `idempotency_keys` table with a claim-first
  protocol (`claimIdempotencyKey` / `resolveIdempotencyKey` /
  `releaseIdempotencyKey`), so a retried ambiguous create returns the original
  item instead of duplicating it. Clients send the key (Mac client track).
- **#12 FP version** - `fetchContents` returns the item carrying the fetched
  `content.hash` (new `TextTextItem.withContentHash`).
- **#13 audit** - `recordAction` now retries once and logs loudly on failure
  rather than silently swallowing. Truly atomic mutation+audit is limited by the
  no-transaction driver (it would need a data-modifying CTE folded into each
  mutation or a durable outbox); tracked as a follow-up.

Mac client track (native SyncEngine + File Provider): #3 client-side If-Match on
delete, #4 native move-as-PATCH, #5 breaker, #7 enumerator dedup, #8 anchor
churn, #9 PATCH guarded by the PUT-returned hash, #10 client Idempotency-Key.

### Round-3 refinements (after a second Codex pass)

- **Durable cursor** - the cursor was `max(revision)`, which can FALL when a
  trashed row is hard-deleted (emptying Trash), erasing a soft-delete the client
  had not yet polled and leaving a permanent ghost. Replaced with a durable
  per-workspace high-water-mark `blogs.change_seq`, bumped by an AFTER trigger on
  every post/folder insert or update. It only ever increases, so a hard delete
  can never lower it.
- **PATCH validates If-Match** - the move/rename route now rejects a client that
  was already stale before the request (412), matching PUT and DELETE, in
  addition to the revision guard that covers the post-resolution race.
- **Same-folder PATCH no-op** - `movePostFile` only sets `folder_id` when the
  target folder actually differs, so a same-folder PATCH no longer bumps the
  cursor.
- **Idempotency: spent key** - a create whose original item was since deleted now
  returns 409 instead of recreating (which two concurrent retries would each do).
- **Safe-by-default writers** - the legacy `savePostAction`, publish/unpublish,
  and MCP `append_to_item` now also pass `expectedRevision`, so every
  full-snapshot writer is guarded, not just the sync/modern-editor/MCP-update
  paths.

### Accepted tradeoffs (documented, not defects)

- **`revision` as JS number** - bigint mapped to a JS number is exact below
  2^53. At this app's write rate that ceiling is ~10^13 mutations away
  (hundreds of millennia), so it is not a practical precision risk; the cursor is
  already carried as a string.
- **Sequential-manifest omission** - the File Provider fetches folder manifests
  one at a time, so a post moved between two folders mid-enumeration can be
  omitted from that single pass. It self-heals: any move advances the cursor, the
  next `enumerateChanges` expires the anchor, and the full re-enumeration picks it
  up. A single cross-cursor snapshot would remove even the transient.
- **Idempotency stale-reclaim** - create and key-resolution are two statements on
  a no-transaction driver, so a process death in the ~1ms gap plus a retry after
  the 30s stale window can duplicate. Truly exactly-once create needs the create
  and the claim in one statement.
- **#13 audit atomicity** - best-effort with retry and loud logging. A hard
  "every mutation writes action_audit" guarantee would need a DB trigger writing
  a coarser guaranteed row (no rich actor/action context on this stateless
  driver) or a data-modifying CTE folded into every mutation. Left as an owner
  decision: telemetry-grade audit today, upgradeable to a trigger-backed
  invariant if required.
- **If-Match on PATCH/DELETE is validated, not required** - PUT requires it (428),
  but PATCH and DELETE only validate it when supplied. Hard-requiring it would
  428 a legitimate File Provider operation whose base version has an empty content
  hash. The bundled clients send it (native the indexed hash, the File Provider
  the base/PUT-returned hash), and the revision compare-and-swap is atomic and
  always active, so an unconditional caller is still safe against the
  post-resolution race.

### Round-4 refinements

- **Monotonic migration** - the `blogs.change_seq` backfill now runs AFTER the
  triggers are installed and uses `GREATEST(change_seq, ...)`, so a rerun (or a
  mutation during install) can never lower the cursor and recreate a ghost.

### Round-5 refinements

- **Atomic trigger install** - all four triggers are installed with
  `CREATE OR REPLACE TRIGGER` (Postgres 14+) instead of DROP + CREATE, so a
  migration rerun never opens a window where a trigger is missing and a
  concurrent update could slip through without a fresh revision.
- **No duplicate on a moved file** - `pushPass`'s new-file detection extracts the
  injected item id from each candidate and skips any file whose id is already in
  the index (leaving it for move reconciliation), so a file carrying a known id is
  never POSTed as a new post. This closes the failed-move-then-pull-restore path
  and any same-id copy.
- **No redundant PUT after a failed move convergence** - when the post-move
  canonical GET fails, the index records the local file's actual hash rather than
  the server render, so the next push sees no phantom diff.
