# Home as a personal front page: design review (P0)

Revision: 2026-09-17, against main at 0.188.
Brief: the owner's `RSS_ARTIFACT_PROMPT.md` and `RSS_ARTIFACT_PLAN.md` (r3).
Status: repository-grounded design and plan. No application code, schema,
or data was changed for this document. Implementation needs a separate go.

## 0. What this review is grounded in

Owner-described (from the brief): the direction, the two questions Home must
answer, the Artifact references N01 to N07, the boundaries in section 5 of
the plan, and the acceptance IDs TT-HOME-001 to 044.

Repository-confirmed (read for this review):

- Home: `src/components/workspace/WorkspaceRootPages.tsx`. The root view is
  Start here (dismissable), the Reading module when the workspace follows
  feeds, then the library: a filter row (All, Articles, Notes, Bookmarks
  with counts), a sort control, and a list of at most 30 pool items.
  "Recent" sorts by the person's open history, then `updatedAt`
  (`src/lib/workspace-activity.ts`, `sortSidebarDocuments`); "Last edited"
  follows updates only. The pool excludes feed items by design
  (`getWorkspacePoolPosts`, manual origin only).
- Reading module (replaced by `src/components/workspace/home/` in P1): `ReadingOverviewModule.tsx`
  and `overview.server.ts`: counts, source chips with health and unread,
  the latest unread items, Catch me up, Save brief, Manage sources. It
  ticks `/api/workspace/reading/tick` when sources look stale.
- Lists: `src/lib/reading/list.server.ts`, `listReadingItems`, keyset
  paging, scope by folder and descendants, state all/unread/kept/starred,
  date basis published or received, per-person read state joined in.
  Duplicates are materialized at import (`duplicate_of_post_id`) and hidden.
- Summaries: `src/lib/reading/summaries.server.ts`. `clusterReadingItems`
  groups a bounded list (300 considered) by canonical URL, then by title
  token Jaccard at 0.5 within three days; groups of two or more become a
  Summary whose id is the sorted member ids joined. Headline is the
  shortest member title. `summary-text.server.ts` writes one model line
  per cluster key with the workspace's own model, cached in
  `reading_summary_texts` keyed by cluster key, and attaches it on read.
- Search: `search.server.ts` with operators; embeddings in
  `embeddings.server.ts` (OpenAI text-embedding-3-small, 512 dims, unit
  vectors in `reading_embeddings`, indexed by the app's tick). Saved
  searches in `reading_saved_searches` (name, query, folder, notify).
- Read and holds: `reading_read_state` per person; `retention_holds` with
  reasons starred, keep, comment, reference, edit. Keep is `setKeep` in
  `retention.server.ts`; star is `setPostStarred` in the store.
- Keyboard: `ReadingFolderView.tsx` maps j, k, o or Enter, m, s, e, v;
  the reader bar adds p and n. Read on scroll is a per-folder preference.
- Images: feed parsing collects `enclosure` attachments
  (`feed-parse.ts`), but `ingest.server.ts` does not store them, and no
  og:image is read at import. Full-text extraction (`extract.server.ts`)
  exists on demand only.
- The heartbeat: `/api/workspace/reading/tick` (polls, retention, index,
  digest) and now `/api/github/backup` tick. No scheduler.
- Design contract: `DESIGN.md` has the broadsheet (public blog) and the
  Apple editor system (`src/styles/apple.css`, `.applecms`). The workspace
  uses the `--ac-*` tokens; reading views are "a calm, dense list."

References inspected: the Artifact product shot (For You feed: a top strip
of For You, Tech, Travel, Architecture..., one image-led lead entry, then
compact rows of publisher mark, publisher, headline, small thumbnail) and
the three-screen composite (Categories list, the profile's Topics and
Categories summary, the Personalize your feed topic picker). The gallery
(`artifact_news_gallery.html`) and `artifact_news_references.md` named in
the brief were not in the package I received, so N-numbered items are
matched by their captions in the plan, not by viewing them. Recorded as an
inspection gap; nothing below claims to have seen N02, N05, N06, or N07.

## 1. The composition

Two regions inside the existing shell, no new rail:

```text
sidebar | Home                                              | assistant
        | [For You] [Latest]   Tech  Politics  Design  More | (when open)
        |                                                   |
        | NEWS (primary, ~2/3 of canvas)   RECENT (~1/3)    |
        | lead Summary, image-led          Note, 3 min ago  |
        | compact Summary                  Draft, today     |
        | compact article                  Bookmark         |
        | compact Summary                  Kept article     |
        | ...                              All items        |
        |                                                   |
        | (secondary utilities in the toolbar menu)         |
```

Wide canvas (the content column has room for a 640px news column plus a
280px recent column with a 40px gutter, measured on the real shell, not a
viewport width): news is the main column, Recent is a quiet second column
aligned to the top of the news list, four to six rows then "All items."
Narrow canvas (assistant open on a laptop, or a small window): one column,
Recent first as a short strip of three rows plus "All items," then the
mode row, then the news. One Recent region in both layouts.

The library that exists today does not disappear: "All items" opens the
current filter row, sort, and full list in place (`?view=library` in the
same local-view state machine, `src/lib/workspace/local-view.ts`), so
counts, filters, and the recent-view mode keep working exactly as now.

Reference mapping (N-numbers by the plan's captions):

- N01 For You and topic feed: the mode plus topic strip, a lead entry with
  image, compact entries beneath. Applied as the news column's rhythm.
- N03 Home and Local: one image-led entry sets hierarchy; a within-feed
  topical block leads into the topic view. Applied sparingly: at most one
  lead per page of news and one inline topic block when a topic has three
  or more fresh Summaries.
- N02 Headlines: grouped coverage with source expansion. Applied as the
  Summary unit: headline, one grounded line, sources, expand in place.
- N07 outer screens: light type scale, white space, hairline dividers,
  thumbnail rhythm. Applied as the news typography below.
- N05, N06: article access and clean reading. Applied as "open the
  existing reader," nothing new.

Not copied: the topic picker as a gate, streaks, reputation, comments as a
network, the purple category cards.

### Typography and surface

Within the Apple editor system: headline `600 17px/1.3 var(--ac-font-text)`
for a lead, `600 15px/1.35` for compact rows, metadata `500 12px/1.35
var(--ac-label-2)`, the generated line `400 14px/1.45 var(--ac-label)` with
a small "Summary" eyebrow that marks AI authorship once per unit. Hairline
separators (`var(--ac-separator)`), no cards, no shadows, no counters. The
active mode is the only filled control; topics are text tabs with an
underline. Images are 96px thumbnails on compact rows and a 16:9 lead image
with reserved height; absent images collapse to text rows, never a grey
block. Both themes through the existing tokens.

### The news unit

Summary: headline (from the cached line's headline when the model wrote
one, else the shortest member title as today), one grounded line (the
cached text, clamped to two lines, expandable), sources as names with a
count ("Wired, The Verge and 3 more"), relative time of the newest member,
one state word at most ("New coverage", "2 unread", or nothing), an
optional thumbnail, and a quiet menu (Hide this Summary, Less like this,
Keep the representative, Open original). Headline opens the reader on the
newest unread member, else the newest member. The sources control expands
the member list in place, each member with its own title, publisher, and
read state; opening a member opens exactly that item.

Article (a singleton): title, publisher, excerpt, time, thumbnail if any.
No generated line, no synthesized count.

### Navigation state

One composable state: mode (forYou or latest), topic (null or a topic id),
and a ranking snapshot cursor. Latest is `listReadingItems` unread-first
by received time over the same scope, the ordinary chronological list.
Entering a topic narrows both modes; clearing returns to all followed
sources. The state lives in the URL (`?news=forYou&topic=...`) so return
from the reader restores it; expansion, scroll, and focus restore from the
existing local view state the folder views already keep.

## 2. Reuse and gap map

| Need | Exists, reuse as is | Gap, smallest addition |
|---|---|---|
| Recent rows | pool posts, `sortSidebarDocuments` recent order, open handlers | a `recentDeliberate()` selector: manual items only, plus kept feed items through one bounded server query (`listReadingItems` with state kept, limit 6) |
| Feed corpus paging | `listReadingItems` keyset, read state joined, duplicates hidden | none |
| Summary membership | `clusterReadingItems` over 300 considered | stable identity and revisions: see 3 |
| Summary text | `reading_summary_texts` by cluster key, model-written once | headline field and evidence revision on the row |
| Topics | saved searches (exact queries), embeddings, source folders | a derived topic set per workspace: see 3 |
| Per-person state | read state, holds, saved-search alerts | seen watermark, hidden Summaries, interest and reduction rules: see 3 |
| Images | enclosure attachments parsed, safe fetch gate, blob store | store one representative image URL per item at import when the feed gives one; og:image only through the on-demand full-text path |
| Ranking | none | a pure scorer over a bounded candidate window, versioned |
| Heartbeat | reading tick | one more bounded job kind: `summarize_recent` (grouping and text for the newest window), run by the same tick |
| Keyboard | j k o m s e v, p n, Enter | the same handler over the news list; a Summary row's o opens its representative; m and e act on the representative only unless the member list is expanded and a member is focused |
| Commands for agents | 46 workspace tools, run_command | three small writes: `hide_summary`, `set_reading_preference`, `clear_reading_preferences`, registered like every other tool |

## 3. Data delta (shared once per workspace, personal once per person)

Shared, derived, never a document edit:

- `reading_summaries`: id (uuid), blog_id, stable_key (the cluster's oldest
  member id, which survives members joining), member_ids (uuid[]),
  coverage_revision (integer, bumped only when a non-duplicate member
  joins or leaves), evidence_hash (of member ids plus their source content
  hashes), headline, text, text_model, text_evidence_hash, topic_ids,
  representative_post_id, image_url, first_at, latest_at, updated_at.
  Replaces the on-read clustering for Home; `clusterReadingItems` stays as
  the grouping rule, now run by the tick job over the newest window and
  reconciled by stable_key (merge: the younger key is retired with a
  pointer; split: a new key). The text is regenerated only when
  `text_evidence_hash` differs from `evidence_hash`, and shown with "based
  on earlier coverage" when they differ and the model has not caught up.
- `reading_topics`: id, blog_id, label, kind (saved_search or derived),
  saved_search_id, centroid (real[] 512, derived only), member_count,
  pinned_position, updated_at. Derived topics come from k-means over the
  workspace's embedded items (bounded to the last 2,000 embedded), labeled
  by the two most frequent title tokens, capped at 12, recomputed by the
  tick when the embedded count grows by 20 percent. Without embeddings,
  topics are saved searches and source folders only, labeled as such.
- `posts` gets nothing. `reading_provenance` gets `image_url` (nullable).

Personal:

- `reading_summary_state`: user_id, summary_id, seen_revision (integer),
  hidden_at (nullable). Seen is recorded by a bounded batch from the
  client when a row has been within the viewport for 400 ms, never on
  prefetch; it never decreases.
- `reading_preferences`: user_id, blog_id, kind (topic_more, topic_less,
  source_less), target_id, weight (fixed per kind), created_at. Undo
  deletes the row. This is the whole taste profile and it is readable in
  Settings.
- Affinity is not stored. It is computed per request from existing state:
  Keep and star rows (strong), read rows with `read_revision_id` set by an
  open rather than a bulk mark (weak), decayed over 30 days, over the
  bounded candidate window only.

Every write goes through the store with an audit row, and through the
three tools above for agents.

## 4. Ranking, inspectable

Candidates: Summaries and singleton articles with latest_at in the last 7
days in the scope, not hidden, capped at 400 by latest_at. Score, version
1, deterministic:

```text
score = 3.0 * freshness            (1.0 at 0 h, 0.5 at 24 h, 0 at 7 d, linear in log time)
      + 2.0 * new_coverage         (coverage_revision > seen_revision, else 0)
      + 2.0 * explicit_interest    (any topic_more on a topic of the unit)
      + 1.0 * affinity             (cosine of unit centroid to the person's Keep/star centroid, 0 without embeddings)
      + 0.5 * breadth              (distinct sources, capped at 3, over 3)
      - 2.0 * seen_repeat          (seen_revision == coverage_revision)
      - 2.0 * reduction            (topic_less or source_less on the unit; a mixed-source unit loses only the reduced sources' share)
```

Then a diversity pass: no source more than 3 of the first 12, no topic
more than 4 of the first 12, stable tie-break on summary id. The page is
cut from that order with a snapshot id (a hash of candidate ids and the
score version) so paging and return do not reshuffle. "Why this is here"
lists the non-zero terms by name. No model call in the request path.

Feedback: Hide this Summary sets hidden_at (undo clears it). Less like
this offers the unit's topics and sources as targets when there is more
than one, applies one row, and names the effect in the undo notice.
Preferences affect For You and topic views only; Latest, folders, search,
digests, alerts, Reader and Feedbin clients, and exports read nothing
from them.

## 5. Automation and the no-model path

The reading tick gains `summarize_recent`: over items received since the
last run (bounded to 500), regroup with the existing rule, reconcile keys,
write text for at most 8 clusters per run with the workspace model, and
refresh the topic assignment for new items. It runs after polls and
before the digest, within the tick's existing job budget, and yields to
retention and index work already queued. Home reads the table; it never
waits for the job. A "New results" affordance appears when a tick
completes during the visit.

Without an AI key: grouping, headlines from titles, sources, freshness and
preference ranking, Recent, reading, Keep, Latest, and saved-search
topics all work; the generated line is simply absent, and topics say
"from your saved searches" instead of pretending.

## 6. Keyboard and return

The news list is one listbox with the folder view's handler: j and k
move, o or Enter opens the representative (or the focused member when
expanded), Right or l expands sources, Left or h collapses, m marks the
representative read (or the focused member), s stars it, e keeps it, v
opens the original, x hides the Summary, comma opens Less like this.
Return from the reader restores mode, topic, snapshot, focused unit,
expansion, and scroll from the URL and the local view state. Modified
clicks on headlines open new tabs because they are real links.

## 7. Sequence

P1, composition (one commit): the two-region Home, the mode and topic
row over saved searches and source folders, the news unit over today's
`readingSummaries` (still clustered on read, cached text as now), Recent
from the pool plus kept items, All items in place, utilities into the
toolbar menu, images from enclosures stored at import, light and dark,
open-assistant reflow, keyboard over the list. Everything visible and
usable, honestly unpersonalized ("newest first" label until P2).

P2, targeting (one commit): the summaries table and tick job, stable keys
and revisions, seen and hidden state, preferences and the three tools,
the scorer and diversity pass, derived topics when embeddings exist,
Settings, Reading preferences listing rules with undo and reset. For You
becomes real; the label changes.

P3, proof (one commit): reference comparison, the 5,000-unread fixture
timings (`scale.db.test.ts` extended), accessibility passes, all-seen,
no-feed, no-key, source-outage states, captures in both themes and with
the assistant open, and the handoff.

## 8. Checks

Existing tests to extend: `summaries.test.ts` (identity across merge and
split), `search.db.test.ts` and `scale.db.test.ts` (candidate window
timings), `retention.db.test.ts` (no new holds from seen or hidden), the
reading route tests, `tools.test.ts` (three tools), and a new
`ranking.test.ts` (pure scorer: contrasting preferences over one corpus,
reversal, reset, diversity caps, snapshot stability). Browser checks with
the dev launch config: both themes, the narrow layout with the assistant
open, keyboard flow and return, image absence. Measured, not asserted:
cold and warm Home, SQL plans for the candidate query with 5,000 unread
items, payload size. None of these have been run for this review.

Acceptance IDs: TT-HOME-001 to 005 and 043 are P3 visual and capture
checks; 006 to 009 and 040 are P1 composition tests; 010 to 014 and 016
to 017 are P1 navigation tests; 015, 018 to 023, 025 to 029, 031 to 035
are P2 unit and DB tests; 024 and 026 are `ranking.test.ts`; 030 and 032
are grounding tests over the summaries table; 036 to 039 are the
`scale.db.test.ts` extension and tick job tests; 041 and 042 are the
existing regression suites and lint; 044 is this document.

## 9. Open questions for the owner, none blocking P1

- Kept feed items in Recent: include them by default, or only when the
  person has kept something in the last 30 days? Proposed: include, since
  Keep is deliberate.
- Derived topic labels from title tokens can be blunt ("Apple, iPhone").
  Proposed: accept for P2, allow renaming in Settings later.
- The 12-topic cap and the 7-day candidate window are starting values,
  chosen for the benchmark workspace, not measured.
