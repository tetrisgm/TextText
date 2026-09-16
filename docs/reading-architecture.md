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
- **Cadence and cron**: `feed_connections.poll_interval_minutes` halves on
  news and stretches by half when quiet (10 min to 24 h). `vercel.json`
  schedules `GET /api/workspace/reading/cron` every fifteen minutes; the route
  requires `Authorization: Bearer $CRON_SECRET` and refuses without it.
- **Digest**: `blogs.reading_digest_hour` (UTC) sends one email a day to the
  owner: alerts first (new matches are kept), then the day's articles by
  source; `reading_digest_sent_on` is the once-per-day key.
- **Export**: `GET /api/workspace/reading/export` (JSON or CSV, all or kept,
  bounded to 5,000 rows).
- **Reader-compatible API**: base URL `https://texttext.app/api/reader`.
  Password is a TextText API token (email ignored). Implements ClientLogin,
  token, user-info, subscription/list, tag/list, unread-count,
  stream/items/ids (with continuation), stream/items/contents,
  stream/contents/*, edit-tag (read, starred), mark-all-as-read,
  subscription/edit and quickadd (subscribe, unsubscribe as detach keeping
  everything, rename). Item ids are the first sixteen hex digits of the UUID.
  Labels are the feed folders' parent folders.

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
