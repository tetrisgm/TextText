# Sync races, slug recovery, and portable Finder names

Status: SHIPPED AND VERIFIED. Reviewed 2026-07-13 against the v0.55
implementation and released in v0.57 (build 60).

## Problem

Three writers can change one item concurrently:

1. The web editor saves through `src/lib/store.ts`.
2. The File Provider extension handles Finder operations on the OS schedule.
3. `MountBridge` performs the fast two-way reconciliation used by the Mac app.

The previous implementation allowed a stale Finder rename to race a newer app
save, used a workspace-wide change cursor as every File Provider container
anchor, and had no durable recovery when a public slug changed. It also treated
a Finder path component as if it could safely contain every valid post title.

Observed results included a folder rename reverting, punctuation disappearing
from a newer title, repeated conflict retries, and an old post URL becoming a
404 after a slug change.

## Implemented contract

### Server compare-and-swap

- The rendered Markdown contains a sync-only `syncRevision` field. It is not a
  user metadata field.
- Manifest and ETag hashes are computed from the exact rendered file. A metadata
  revision change therefore changes the validator even when body text does not.
- `PUT`, `PATCH`, and `DELETE` require a specific `If-Match` validator. Missing
  validators return 428 and `*` returns 412.
- Hosted metadata `PATCH` requests carry that same validator in
  `X-Write-If-Match`. Vercel consumes standard `If-Match` on `PATCH` before the
  route runs; the scoped header lets Write perform the intended file-hash and
  database-revision checks. The route still accepts standard `If-Match` for
  direct and local clients. `PUT` and `DELETE` continue to use the standard
  header.
- Every mutation is also guarded by the database revision in the update or
  delete statement. A write that lands after the HTTP hash check still causes a
  conflict instead of being overwritten.
- Metadata PATCH resolves the target folder to its immutable tenant-scoped ID.
  It does not move by a mutable path string.
- A title and a slug are separate values. Titles preserve punctuation exactly.
  Explicit slugs pass through the central URL-safe sanitizer.
- A no-op PATCH does not advance the revision, revalidate, or write audit noise.
- A create request with a supplied but unreadable content URL fails. It never
  substitutes an empty document for bytes that could not be read.

### Slug history and old URLs

- `posts.slug_history` is a `text[]` maintained by a database `BEFORE UPDATE`
  trigger. The old slug is captured atomically, duplicates are removed, a
  reclaimed current slug is removed from history, and history is capped at 20.
- A full GIN index supports historical lookup, including deleted rows needed as
  tombstones.
- Exact and historical candidates are read in one tenant-scoped query. A live
  exact slug wins. A deleted exact row reserves the URL. One live historical
  owner redirects. Ambiguous history fails closed.
- HTML and `index.md` routes issue a temporary 307 only after applying their
  normal visibility checks. Notes, bookmarks, and private drafts do not become
  public through history.
- Slug changes emit `post.slug_changed` audit records on editor and sync paths.

### Finder filename portability

The server title remains the source text. Finder receives a reversible encoded
path component from `WriteFilename`:

- NFC normalization produces one canonical spelling.
- Reserved characters `< > : " / \\ | ? *`, square brackets, controls, a
  leading dot, trailing dots or spaces, literal `~`, and Windows device names
  are escaped as UTF-8 bytes using `~HH`.
- `Why??` is stored as `Why~3F~3F.md` and decodes back to the title `Why??`.
- Files and folders share collision detection. Case-insensitive sibling
  collisions receive a deterministic suffix derived from stable item identity.
- Components stay within the 255-byte filesystem limit. An overlong component
  uses a readable prefix plus a SHA-256 marker. That on-disk shortening is
  intentionally not decoded as a title change; the server retains the complete
  title.
- Hand-authored names with unknown or incomplete escape sequences remain
  literal rather than being corrupted during decoding.

### Native reconciliation

- Every push re-fetches the exact item immediately before mutation and uses that
  validator. A returned hash is chained from content PUT to metadata PATCH.
- A 412 yields to the other writer and schedules a later pass. Stale metadata is
  never replayed with a fresh hash.
- A remote pull re-reads local bytes immediately before eviction. If Finder
  changed them while network work was pending, eviction is cancelled and the
  next pass performs normal conflict planning.
- Pending pulls are remembered. A local edit made while a pull is pending is
  converted into conflict planning rather than discarded.
- Reconcile work belongs to a session generation. Workspace switches and
  restarts cancel old work so it cannot mutate the new workspace.
- File Provider identity is authoritative for folders, including empty and
  renamed folders. Child frontmatter voting remains only as a legacy fallback.
- Enumeration anchors are fixed-size SHA-256 fingerprints of each container's
  mapped children. Unrelated post changes do not invalidate the folder list.
- File Provider metadata and content versions stay below the 128-byte limit.

## Regression gates

Server tests cover exact validators, wildcard rejection, revision races, no-op
metadata changes, slug sanitization, history precedence, tombstones, ambiguous
history, and visibility-gated redirects.

Swift tests cover reserved and Unicode names, `Why??`, DOS device names,
trailing characters, overlong names, file/folder collisions, unreadable create
content, stable fetches, stale deletes, container anchors, generation changes,
pending pulls, pre-eviction edits, and end-to-end app/Finder race interleavings.

The production verifier in `scripts/verify-sync-live.ts` creates an isolated
scratch workspace, proves the HTTP CAS and redirect behavior, and removes all
scratch rows in `finally`.

## Release order

1. Run all TypeScript, Vitest, Swift, native build, and web build gates.
2. Run the owner ship command in dry-run mode.
3. Ship through the owner command. It applies the idempotent slug-history
   migration before publishing server and native artifacts.
4. Run the production scratch verifier.
5. Verify the installed app version/build, signed update feed, public artifact,
   website, running app, and automatic update preference all match.

No MCP or OAuth surface is changed by this work.

## Shipped verification

- Vitest: 23 files and 243 tests passed.
- Swift: 239 tests passed, including portable names, collisions, overlong
  components, Finder/app races, and File Provider reconciliation.
- Production sync probe: 15 checks passed against `write.ramine.net`, including
  concurrent compare-and-swap writes, stale and wildcard rejection, metadata
  ETag changes, `Question??` title preservation, slug-history redirects, and a
  durable change cursor.
- The installed app, public update feed, website marker, and immutable ZIP all
  advertise v0.57 build 60. The feed has an EdDSA signature, the app is
  notarized, automatic updates are enabled, and the installed app is running.
