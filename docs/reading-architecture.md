# Reading architecture

How feeds become folders of ordinary items, what keeps an item, and how the
assistant reasons over what was kept. Decisions are recorded with the reason;
the code they describe is under `src/lib/reading/` and
`src/app/api/workspace/reading/`.

## Decisions

1. **Feed folders are folders.** A connection points at one `folders` row
   created by `createSubfolder` under a bookmarks-mode parent
   (`connections.server.ts`). Nesting, moving, sharing, and Trash are the
   folder's own, unchanged. One active connection per folder, enforced by a
   partial unique index.
2. **Imported items are bookmarks.** `createDraftInFolder` with
   `origin: "feed"` produces a schema-v1 bookmark whose `fields.sourceUrl` is
   the permalink. Provenance (publisher, authors, permalink, availability,
   source hash) is a sidecar row, `reading_provenance`, so the document schema
   did not change. Every source version is a `reading_source_revisions` row;
   the item's body follows the source only while nobody has edited it.
3. **Imported items stay out of the whole-workspace pool.** `getWorkspacePoolPosts`
   selects `origin = 'manual'`. Reading folders render a server-paged list
   (`list.server.ts`, keyset cursor, at most 100 rows) and merge one item into
   the client pool with `addPost` when it is opened, so a workspace following
   thousands of articles does not hydrate them into every page.
4. **Jobs, not a scheduler.** `reading_jobs` is leased with
   `FOR UPDATE SKIP LOCKED` and run in bounded batches by the request that
   needs it (adding a feed) and by `POST /api/workspace/reading/tick`, which
   the open folder calls when its sources look stale. Nothing installs cron
   or launchd; a deployment that wants unattended polling points a scheduler
   at the tick.
5. **Embeddings without another service.** `reading_embeddings` stores a
   unit-length `real[]` per item; similarity is a dot product in SQL. Lexical
   search always runs; the semantic side runs only when the workspace's AI key
   is an OpenAI key, through the same owner-identity path the assistant uses.
   pgvector is not installed locally, so nothing assumes it; adding an index
   later changes this table, not the retrieval contract.
6. **Protection is written with the act.** `setPostStarred`, `createItemComment`,
   and `setKeep` write a `retention_holds` row in the same transaction or
   statement as the star, comment, or keep; undoing releases only that reason.
   Links from notes and a person's edits are found by the cleanup sweep, not on
   the editor's save path (`retention.server.ts`). Cleanup moves an
   unprotected, expired item to Trash with a revision-guarded statement that
   flips its receipt to a tombstone in the same write.
7. **No textpack change.** Provenance does not enter the file format in this
   release; exporting an imported item exports an ordinary bookmark.

## Flags

Read from the environment at startup (`flags.ts`):

| Flag | Default | Effect |
|------|---------|--------|
| `TEXTTEXT_READING_ENABLED` | on | Feed connections and imports. |
| `TEXTTEXT_READING_SUMMARIES` | on | Reserved for the Summaries view. |
| `TEXTTEXT_READING_SEMANTIC` | on | Embedding jobs and the semantic side of search. |
| `TEXTTEXT_READING_CLEANUP` | off | The unattended retention sweep. The owner's explicit preview and run ignore this flag. |

## Surfaces and policy

Tools derive from `src/lib/ai/tools.ts` and keep each surface's policy:

| Tool | Hosted MCP | Signed-in CLI | Rail assistant |
|------|------------|---------------|----------------|
| `list_reading_sources` | read | read | read (server) |
| `search_reading` | read | read | read (server) |
| `keep_item` | direct, audited | direct | staged proposal |
| `add_feed` | direct, audited | refused (fetches a chosen URL) | not available: open-world tools are never staged; feeds are added from the folder menu |

Visibility fails closed: every reading query intersects with the folders the
caller can access, and a caller with no access sees an empty list.

## Fetching

`fetch.server.ts` uses the workspace's SSRF-gated fetch: loopback and private
ranges are refused after DNS resolution, redirects are bounded, bodies are read
to a byte ceiling (8 MB), and conditional headers keep a healthy feed cheap.
Parsing refuses DOCTYPE and entity declarations before the XML parser sees
them. Discovery verifies advertised and conventional feed paths by fetching
and parsing; it never fabricates a candidate.

## Reading like Reader (added 2026-09-16)

- **Keyboard**: in a reading folder j/k move, o or Enter opens, m toggles
  read, s stars, e keeps, v opens the original; inside an article n/j and
  p/k step older and newer. "Read as I scroll" and "Mark above read" are in
  the folder. Per-folder view preferences persist in the browser.
- **One copy**: a later feed copy of the same canonical link is marked
  `reading_provenance.duplicate_of_post_id` at import and hidden everywhere.
- **Per-feed settings**: rename, retention (re-leases receipts still passing
  through), muted words (stop entries at the door). A permanent redirect is
  remembered as `moved_to_url` and offered, never adopted alone.
- **Full text**: `extract.server.ts` fetches the original through the gate,
  finds the article without a DOM, and records it as a source revision:
  applied when untouched, recorded otherwise.
- **Search**: operators `feed:`, `is:unread`, `is:starred`, `is:kept`,
  `before:`, `after:`, quoted phrases. Saved searches (`reading_saved_searches`)
  behave like feeds with a bounded unread count; `notify` makes one an alert.
- **Cadence, no scheduler**: `feed_connections.poll_interval_minutes` halves
  on news and stretches by half when quiet (10 min to 24 h). The app is its
  own heartbeat: the front page and any reading folder call
  `POST /api/workspace/reading/tick` when sources look stale, in bounded
  passes; nothing arrives while nobody opens the workspace, by design.
- **Digest**: `blogs.reading_digest_hour` (UTC). The tick sends one email to
  the owner the first time the workspace is touched after that hour: alerts
  first (new matches are kept), then the day's articles by source;
  `reading_digest_sent_on` is the once-per-day key.
- **Export**: `GET /api/workspace/reading/export` (JSON or CSV, all or kept,
  bounded to 5,000 rows).
- **Feedbin-compatible API**: base URL `https://texttext.app/api/feedbin/v2`,
  HTTP Basic with any username and a TextText API token as the password.
  authentication, subscriptions (list, create, rename, delete as detach),
  feeds/:id, feeds/:id/entries, taggings, tags, entries (ids, page/per_page,
  read=false, starred=true, since, mode=extended, Link: rel=next),
  entries/:id, unread_entries and starred_entries (GET ids, POST mark, DELETE
  unmark, and the POST .../delete forms). Ids are 52-bit numbers from the
  UUID's first thirteen hex digits, JSON-safe, shared with the Reader
  surface, which pads them to sixteen hex digits in its tag form.
- **Bookmark migration**: `GET/POST /api/workspace/reading/bookmarks-html`
  reads and writes Netscape bookmark files (browsers, Pinboard, Instapaper,
  Raindrop): imports become saved bookmarks with their date, tags, folders,
  and description, skipped by canonical address when already saved; export
  writes only the person's own bookmarks. Manage sources accepts either an
  OPML or a bookmark file in one Import button.
- **Reader-compatible API**: base URL `https://texttext.app/api/reader`.
  Password is a TextText API token (email ignored). Implements ClientLogin,
  token, user-info, subscription/list, tag/list, unread-count,
  stream/items/ids (with continuation), stream/items/contents,
  stream/contents/*, edit-tag (read, starred), mark-all-as-read,
  subscription/edit and quickadd (subscribe, unsubscribe as detach keeping
  everything, rename). Labels are the feed folders' parent folders. Both
  surfaces were exercised over HTTP against the dev server with a real token
  (ClientLogin, user-info, subscription/list, stream/items/ids; Basic auth,
  subscriptions, paged entries with Link, unread_entries).

## Home as a personal front page (added 2026-09-17)

The home page of a workspace that follows feeds is a news front page
with recent work beside it. Design and acceptance map:
`docs/plans/home-artifact-news.md`.

- Read model: `src/lib/reading/home.server.ts`, served by
  `GET /api/workspace/reading/home`. A unit is a Summary or a single
  article. At most 300 recent feed items feed a page; a page is 20 units of
  a named snapshot. Feed items never enter the client pool.
- Materialized Summaries: `reading_summaries` (stable key, member ids,
  coverage revision, evidence hash, cached text and the hash it was written
  against), kept current by the tick's `summarize_recent` job
  (`summaries-materialize.server.ts`, at most every ten minutes, as the
  owner, after polls and before the digest). Topics: `reading_topics`
  (saved searches, source folders, derived k-means clusters when the corpus
  is embedded; derived only past 40 embedded items, capped at 8).
- Ranking: `rank.ts`, version 1, no model call. Terms: freshness, new
  coverage against the person's seen watermark, explicit interest,
  affinity to what they keep and star (embeddings), breadth of sources,
  minus already-seen repetition and the person's reductions; then a
  diversity pass over the first twelve. Every term that fired travels with
  the unit so "Why this is here" is a list, not a story. The mode label
  says what the order is: "Newest first" before the first materialization,
  "Ranked by freshness and coverage", or "Ranked with your preferences".
- Personal state, in the open: `reading_summary_state` (seen revision,
  hidden), `reading_preferences` (topic_more, topic_less, source_less).
  Store functions with `reading.*` audit rows; Settings, Reading
  preferences lists and undoes every rule and resets hidden Summaries.
  Seen is recorded from rows that stayed 60 percent visible for 400 ms,
  batched, and never lowered. Hide and preferences touch For You and topic
  views only: Latest, folders, search, digests, alerts, exports, and the
  Reader and Feedbin APIs read none of it.
- Agents: `hide_summary`, `set_reading_preference`,
  `clear_reading_preferences` (the last confirmation-gated, hosted only).
- Keyboard: j, k, o or Enter, m, s, e, v as in reading folders; l and h
  expand and collapse a Summary's sources; x hides; comma opens Less like
  this; a key acts on the focused member when one is.
- Measured on the 5,000-item fixture (`scale.db.test.ts`, PERF-03, local
  Postgres, 2026-09-17): materialize 77 ms, For you cold 43 ms, warm 40 ms,
  ranked over a full 300-item window 56 ms, page two 41 ms, Latest 42 ms,
  source topic 40 ms, page payload under 1 KB per unit.

## Outbound notifications (added 2026-09-17)

Where a workspace speaks when nothing is calling in. `notification_channels`
holds Apprise-style URLs and plain webhooks per workspace
(`src/lib/notifications/urls.ts` resolves each into one request in that
service's dialect: ntfy, Discord, Slack, Telegram, Pushover, a JSON
endpoint, a self-hosted Apprise API, or `https://` receiving
`texttext.notification.v1` JSON). Channels choose events: `reading.digest`,
`reading.alert` (one per alert, so a channel can take alerts alone), and
`github.backup`.

- The digest (`sendReadingDigest`) dispatches to channels alongside email.
  A channel failure never touches the email. A workspace with channels but
  no email address still gets its digest through them.
- Deliveries go through `fetchPublicResource`: public hosts only, pinned
  DNS, ten-second timeout. A self-hosted Apprise or ntfy on a private
  address is refused by design.
- The URL carries its own credential, as Apprise URLs do. It is stored as
  entered, shown masked from the moment it is saved, never echoed back by
  the API, and never logged. Only the delivery outcome is recorded on the
  row (`last_status`, a short detail).
- Writes go through the store (`addNotificationChannel`,
  `updateNotificationChannel`, `removeNotificationChannel`) with
  `notifications.*` audit rows; each dispatch writes one
  `notifications.dispatch` row with the delivered count.
- Settings, Notifications: add, pause, test, remove, and per-event
  checkboxes. Outbound only: nothing new listens.

## What it costs to open (added 2026-09-18)

Against local Postgres a round trip is a fraction of a millisecond, so a page
can make fifty and still feel instant in development while taking seconds in
the Mac app, where each one is an HTTPS request to Neon. The count is what
the speed is made of.

### What it says today, and the one thing that is wrong

Opening an article 63ms median, going back 84, switching channel 24. Opening
a folder is 318ms, every time, and it is the defect.

It is a one-time initialisation, not the folder: the first folder opened
after a page load takes about 470ms and every one after it takes 25, whichever
folder each is. Opening the first article pays the same kind of cost once.
The content region goes blank at 40ms and the folder arrives at 460ms, so the
person watches an empty pane for four hundred milliseconds.

Ruled out by measurement, so nobody repeats it: JavaScript execution (the CPU
profile is idle through the gap), the navigation animation (identical with
reduced motion), the view transition (identical with startViewTransition
removed before any module loads), page warm-up (identical after six seconds
of settling), how much content there is (identical with the news list at
display:none, and identical for a folder of three items and one of forty),
text shaping caches, IndexedDB, fetch, requestIdleCallback and
scheduler.postTask. What remains is the first mount of that view.

The codebase already has the shape of the answer for the editor:
`scheduleAfterLoadIdle` preloads its chunk after the cold path, because "an
item opened and edited before that mounts the editor cold". That warms the
chunk, not the mount, and the mount is what costs 470ms here.

`npm run bench` is the other half, and the one that decides whether the app
is fast: it drives the real surfaces against a production build and reports
click to rendered, median and 95th percentile, against a 200ms budget. Two
traps it is built to avoid. A presence check for a predicate ("is there an
h1") is often already true on the page the action starts from, so the clock
stops on the same frame and reports seven milliseconds for a page load; every
predicate here waits for something that was not true before. And the first run
of an action in a fresh server pays for that route being initialised, which
happens once per process, so it is reported in its own column rather than
folded into a tail that would describe something nobody experiences twice.

`npm run perf:queries` prints it for every read a person waits on. The Home
was twenty-seven round trips for For You and fifty for a channel, most of
them the same two questions: which workspace this handle is, and what folders
it has. `src/lib/request-scope.ts` opens a scope around reads and holds one
answer per question for the length of one; it does nothing when no scope is
open, so nothing that has not opted in can be surprised by it. React's own
`cache()` covers a rendering tree, which is not where a route handler runs.

A channel cost more than the whole feed because it read every source
separately. The strip already lists the connections and a connection carries
its folder id, so a channel is the same single pass the feed makes, narrowed
by `ReadingScope.onlyFolderIds`.

For You is fifteen, a channel fourteen, Latest ten, the overview seven.
`src/lib/reading/__tests__/home-query-budget.db.test.ts` fails if one grows.

## Checking the Home against what it is a port of (added 2026-09-18)

`npm run home:design-compare` captures the Home at the reference captures'
own device metrics, 393pt at 3x, and compares it with them. The reference is
scanned pixel by pixel because there is no DOM behind it; ours is read from
the DOM, because scanning a line that carries a descender over-reads its cap
height by about a quarter and that bias would sit on one side only. Everything
is reported as a multiple of the article headline, because the reference
column is 358pt and a desktop column is not.

It found what a reading of the stylesheet could not: the thumbnail was a fixed
7rem, which is 0.17 of a desktop column and 0.31 of the column at phone width,
against the original's 0.19. It follows the container now and lands on 68pt at
phone width, the number the original was measured at.

Current drift, in multiples of the headline: tab +0.03, headline 0.00,
publisher -0.10 (deliberate, recorded in DESIGN.md), metadata -0.05, section
title +0.07, thumbnail 0.00.

## Proving sync is safe rather than believing it (added 2026-09-18)

Two systems, doing opposite jobs.

`src/lib/__tests__/concurrent-writes.db.test.ts` runs the real write paths
against each other on one document, in randomized interleavings, and checks
two promises after every round: a write is accepted or refused and never
silent, and there is always a way back. It catches a write path that can lose
text before it ships. TEXTTEXT_CONCURRENCY_SEED reproduces a failure and
TEXTTEXT_CONCURRENCY_ROUNDS turns it up. It found the coalescing window
comparing each write only with the one before it, so a burst of small edits
could carry a document a thousand characters with nothing on file but where
it started.

`npm run sync:check` asks every workspace whether it still agrees with
itself: the columns against the document, the collaborative markers against
their item's revision, retired logs against the current epoch, feed receipts
against the items they claim. It reports and repairs nothing, because the
first thing to know about drift is that it happened.
`sync-consistency.db.test.ts` breaks each of those deliberately and asserts
the report names it, so no check can quietly be one that always passes.

Two things the checker deliberately does not compare, because the document
cannot hold what the column does:

- **Links.** The snapshot keeps one, in `content.fields.sourceUrl`, while the
  column keeps a list with the labels a person wrote. Existing items have
  columns richer than their documents. The sync write path now refuses a file
  carrying more than one link rather than dropping the rest silently, but the
  schema still cannot represent them.
- **A bookmark's excerpt.** It comes from the capture; the document's
  subtitle is its own field and is often empty.

Both are gaps in the schema rather than drift, and reporting them on every
workspace would make the checker noise.

## Residual risks, recorded

- DNS rebinding between the gate's lookup and the socket connect is a known
  residual of the shared `fetchPublicResource` (documented there); the feed
  fetcher inherits it and adds no new exposure.
- Cleanup and protection serialize on the post row (holds insert with
  `FOR SHARE` on the live post; the sweep's guarded UPDATE re-checks holds and
  stars), so a hold that commits first is honored. A note that cites an
  expiring article saved during the milliseconds between the sweep's
  reference scan and its guarded UPDATE is not protected by that sweep; the
  article moves to Trash, where it is restorable, and the next poll never
  re-imports it.

## Not verified here

- Embedding calls against a live OpenAI key: the retrieval path is proved with
  a deterministic in-test embedder; the provider call is exercised only when a
  workspace key or the development override is present.
- Native (Mac) File Provider behaviour with large feed folders: imported items
  are ordinary posts to the sync surface, and no measurement was taken.
