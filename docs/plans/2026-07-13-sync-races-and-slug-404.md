# Plan: sync races + the slug 404 (Finder <-> app <-> server)

Status: DRAFT for review (Codex). Written 2026-07-13, after shipping v0.55
(build 58), which added os_log tracing to the sync path but changed no behavior.

## 1. Context

Three writers can mutate a post's title/body/folder concurrently:

1. The app editor (web view) via `save_post` (`savePost` in `src/lib/store.ts`,
   revision CAS).
2. The File Provider extension via `modifyItem` -> PATCH/PUT
   (`mac/Extensions/WriteFileProviderExtension/FileProviderExtension.swift`,
   If-Match CAS). The OS schedules these on its own slow, deprioritized clock.
3. The MountBridge, our fast two-way reconciler
   (`mac/Sources/Write/MountBridge.swift`): FSEvents-watched, baseline-directed
   (per-post last-agreed title/body), pushes Finder edits, pulls app edits by
   evict + re-materialize.

Change propagation: every post/folder mutation bumps `blogs.change_seq`
(triggers `posts_bump_blog_seq` / `folders_bump_blog_seq`); the app's
ChangeListener polls `/api/sync/v1/changes` and calls `signalEnumerator`;
`WriteEnumeratorAdapter` (mac) anchors enumeration on that cursor and expires
(full re-list) whenever it moves.

Instrumentation (shipped v0.55): read the whole dance with

    /usr/bin/log show --last 10m \
      --predicate 'subsystem == "net.writeapp.write"' --info --style compact

Categories: `mountbridge` (every reconcile decision with the compared values),
`fileprovider` (modifyItem branch + fields + results, conflict errors),
`fileprovider-handoff` (now .debug). Server side: `action_audit` rows for every
mutation.

## 2. Observed failures (evidence from the owner's session, 2026-07-13)

### F1: Finder folder rename never propagated

Renamed "Shoku's blog" -> "Shoku blog" in Finder while ALSO renaming posts.
Server kept the old name; NO `sync.rename_folder` audit row exists (the request
never left the Mac); Finder reverted to the old name.

A clean, isolated folder rename WORKS (traced live on v0.55: modifyItem ->
renameFolder -> server updated in ~1s). The failure needs the concurrency:

- Post renames bump `change_seq`. `WriteEnumeratorAdapter.enumerateChanges`
  uses the change_seq cursor as the anchor for EVERY container, including the
  workspace container (the folder list). So an unrelated post edit expires the
  folder-list anchor, forces a full re-list, and the re-list carries the
  SERVER's folder names. The framework applies them over the user's
  not-yet-pushed local rename (folder itemVersion.metadataVersion is
  name-based, so the old server name reads as a remote metadata change).
  The rename is clobbered before either push path fires.
- Belt-and-braces gap: MountBridge's own folder push resolves a directory's
  folder id by majority-voting the frontmatter slug of contained posts
  (`folderId(for:)`, MountBridge.swift). Unlike the file loop (which guards
  dataless files), the vote reads file contents with NO dataless guard, and an
  empty/unreadable vote returns nil, which silently drops the rename
  (`guard let fid ... else { continue }`).

### F2: Title storm; the user's "!!!!" was reverted (data loss)

Audit timeline (UTC): 17:04:42..17:04:50 `sync.patch_file` x5 (Finder renames
landing), 17:04:54 `save_post` x2 "Madonna's Worst Album!!!!" (the app editor),
then 17:05:01..17:07:30 `sync.patch_file` "Madonna's Worst Album" (WITHOUT the
"!") repeatedly, with the FP logging `sync write error: conflict` (If-Match 412)
every 20-60s. Final DB title: "Madonna's Worst Album". The "!!!!" the user
typed was silently reverted.

Mechanics (partially confirmed; the exact interleave needs a traced repro):

- MountBridge decides pushes against a manifest snapshot fetched at PASS START.
  A pass can take seconds (it fetches file bodies). An app `save_post` landing
  mid-pass makes the snapshot stale; the title axis can then see the lagging
  mount filename as a "local rename" and PATCH the old title over the newer
  server title. The If-Match it sends is the stale snapshot hash; sometimes
  that 412s (the FP conflicts we logged), sometimes it wins the race.
- Aggravator: `movePostFile` treats a same-title PATCH as a no-op (good), but
  the route still writes a `sync.patch_file` audit row for no-ops, so the log
  overstates the fight and hides the one write that did the damage.

### F3: 404 in the app web view after a title edit

Posts are addressed by slug only: `src/app/t/[handle]/[slug]/page.tsx` and
`src/app/u/[username]/[slug]/page.tsx`, both `notFound()` on a miss. There is
no old-slug redirect. Madonna's slug changed `madonna-s-best-album` ->
`madonna-s-worst-album`; the web view sat on the old-slug URL; escape
re-rendered into the 404.

The slug-change SOURCE is unconfirmed, and that is itself a finding. Paths
audited, all of which should NOT have reslugged this post:

- `movePostFile` (sync PATCH) deliberately never reslugs ("rename != reslug",
  store.ts ~line 1111).
- PUT `/api/sync/v1/files/[postId]` uses `parsed.fields.slug ?? post.slug`;
  the mount file's frontmatter carried the old slug.
- The edit layer (`PostEditLayerClient.deriveSlugFromTitle`) and the full
  editor (`EditorApp.updateSelectedTitle` / `postForPersist`) auto-slug ONLY
  when the current slug is a placeholder (`untitled-*`). Madonna's was real.
- `slugForNewFile` applies only to file CREATION.

Either some path escapes those guards under a race (e.g. auto-slug armed
earlier in the session while the slug was still a placeholder, then kept armed)
or a writer we have not considered reslugged it. We currently cannot tell,
because slug changes leave no trace.

## 3. Fixes

### Fix A (server): slug history + redirect + slug-change audit

The durable kill for F3 regardless of source, plus the missing forensics.

1. Schema: `posts.slug_history jsonb` (array of previous slugs, newest first,
   capped at 20). New migration script mirroring
   `scripts/migrate-add-revision.mjs`; must be run against Neon before deploy.
2. Choke point: one store helper applies every slug change (both `savePost`
   and `movePostFile` route through it). On change it appends the old slug to
   history, removes the new slug from history if re-taken, and records an
   `action_audit` row `post.slug_changed` (targetType item, targetId post id,
   inputSummary "old -> new"). The NEXT occurrence of F3 is then a one-line
   query.
3. Reader routes: on slug miss, look up the handle's posts by
   `slug_history @> [slug]`. If found AND the viewer may see the post (the
   exact same visibility gate the canonical page applies: notes/bookmarks and
   invisible drafts still 404), issue a 307 redirect to the canonical path.
   307 not 308: slugs can be reclaimed by other posts later; exact-match
   always wins over history so a reclaimed slug serves the new post, and we do
   not want the old mapping cached permanently.
4. Editor client: after a save whose response slug differs from the URL slug,
   `router.replace` to the canonical path (the `navigateAfterSave` plumbing in
   `PostEditLayerClient` already exists; verify it fires on the escape path
   inside WKWebView).

### Fix B (server): stop auditing no-op PATCHes

`movePostFile` already short-circuits no-ops; return a `changed` flag (or
compare pre/post) and skip `recordAction` + `revalidateBlogPaths` when nothing
changed. This removes the audit noise that made F2 look like 12 writes when it
was ~2 real ones, and makes the audit log a reliable diagnostic.

### Fix C (mac, MountBridge): never push against a stale snapshot

The invariant to add: a push may only fire if the server state AT PUSH TIME
still equals the baseline. Concretely, in the title axis and the body axis:

1. Immediately before `patchFile`/`putFile`, re-fetch the single item's current
   manifest entry (one cheap GET). If its title/hash no longer matches the
   pass-start snapshot, SKIP the push this pass (the next pass re-decides with
   fresh state; if the app really did edit, the axis will correctly pull).
2. Treat "fresh server title == filenameTitle" as agreement (skip the PATCH
   entirely); today this can generate a no-op PATCH.
3. Per-post backoff after a 412: do not re-attempt a push for that post for
   30s. Conflicts mean another writer is active; yielding is always safe
   because the baseline only advances when both sides agree.
4. Log noise: drop the "unresolved id" log for the mount root and `.Trash`
   (known non-folders).

This closes every stale-push interleave of F2 without changing the (sound)
two-axis baseline design. The app editor keeps winning for in-app edits; Finder
keeps winning for Finder edits; simultaneous edits on the SAME axis resolve to
the server (pull), with the FP keeping a conflict copy.

### Fix D (mac, FP): folder-list anchor keyed on the folder set, not change_seq

Mirror of the root-container anchor fix that shipped in v0.54. Give the
`.workspace(handle)` container its own anchor: a hash of the sorted
`(folder.id, folder.name, folder.parentId)` set (fetched via the existing
`workspace()` call). `enumerateChanges` then reports "no changes" for
post-only edits, so an unrelated post rename can never re-list the folder
container and clobber an in-flight folder rename (F1's trigger). A real
server-side folder rename still propagates: the ChangeListener signal fires,
the folder-set hash differs, the anchor expires, the re-list applies it.

Files: `mac/Extensions/WriteFileProviderExtension/WriteEnumeratorAdapter.swift`
(anchor strategy by container kind), `WorkspaceEnumerator` (expose a
folder-set anchor), tests in `EnumeratorAdapterTests`.

### Fix E (mac, MountBridge): robust folder id resolution

In `folderId(for:)`: skip dataless children in the vote (mirror the file
loop's guard), and when the vote is empty, fall back to structural matching:
among the parent's child directories and the server folders sharing that
parent, pair the single unmatched dir with the single unmatched server folder
(only when both are unique, else keep the logged skip). This makes a Finder
folder rename pushable even when the folder's posts are dataless or the folder
is empty.

## 4. Explicit non-goals

- No change to privacy invariants: notes/bookmarks stay unlisted; the redirect
  applies the same visibility gate as the canonical page; `movePostFile` still
  never reslugs; MCP/tool layers untouched.
- No redesign of the two-axis baseline model (it is sound; the bug is stale
  snapshots, fixed by C).
- The FP `modifyItem` write paths stay as-is (proven correct in isolation,
  unit-tested).

## 5. Test plan

Server (vitest):
- Slug-history helper: append on change, cap, reclaim-dedupe; audit row shape.
- Redirect route: visible article old slug -> 307 canonical; note/bookmark old
  slug -> 404 for anon; draft old slug -> 404 for anon, 307 for owner; exact
  match beats history when a slug is reclaimed.
- movePostFile no-op: no audit row, no revision bump (extends existing tests).

Mac (XCTest):
- MountBridge title axis: FakeAPI whose manifest changes BETWEEN pass start
  and push; assert no PATCH fires (skip), assert next pass pulls.
- MountBridge 412 backoff: assert one attempt then quiet for the window.
- Folder-set anchor: post-only change does not expire the workspace container;
  folder rename does; root container behavior unchanged.
- folderId: dataless children excluded; structural fallback pairs a renamed
  empty folder; ambiguous case still skips.

Live verification on the owner's Mac (v0.55 tracing stays in):
1. Repro F1: rename a folder AND two posts within 2s; assert the folder rename
   reaches the server (audit row) and Finder keeps the new name.
2. Repro F2: rename a post file in Finder, then within 3s retitle it with
   trailing "!!!!" in the app; assert the final server title keeps the "!!!!"
   and the trace shows a pull, not a stale push.
3. Repro F3: change a post's slug (via the editor slug field), load the old
   URL; assert 307 to the new slug; assert `post.slug_changed` audit row.

## 6. Rollout

1. Server first: migration (run against Neon), Fix A + B, deploy prod, verify
   redirect live. History starts empty; no backfill.
2. Mac v0.56: Fix C + D + E, full test suite, release ritual, install, run the
   three live repros above with the trace.
3. Update memory/runbook: new migration in the migration list; the trace
   command; repro scripts kept in `scripts/` if useful.

Estimated effort: server ~2h, mac ~3h, live verification ~1h.

## 7. Open questions (feedback wanted)

1. F3 source: given every client auto-slug path guards on placeholder slugs,
   do you see a path we missed that could reslug a draft with a real slug?
   (Suspects considered: auto-slug armed earlier in the same editor session;
   an FP create-after-evict path calling `slugForNewFile`; the AI agent tools.)
   Is "instrument via Fix A and catch the next occurrence" acceptable, or is
   there a cheaper static way to pin it now?
2. Fix C's pre-push re-check adds one GET per actual push (not per pass). Any
   objection? The cheaper alternative (send If-Match from the pass snapshot and
   treat 412 as skip) is strictly weaker: it protects the server but still
   generates conflict noise and FP retries.
3. Fix D changes anchor semantics for one container kind. Any FP framework
   gotcha with per-container anchor strategies you know of (e.g. anchor
   stability across extension restarts)?
4. 307 vs 308 for the redirect, and should the redirect also cover the
   `/index.md` machine route and feeds, or is the HTML page enough for now?
5. Sequencing: any reason not to ship server (A+B) independently ahead of the
   mac fixes?
