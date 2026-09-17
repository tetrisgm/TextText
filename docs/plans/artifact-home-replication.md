# Home as Artifact: replicate the experience, keep TextText underneath

Revision: 2026-09-17. Written for the agent that continues this work.
Supersedes the restraint clauses of `home-artifact-news.md` (section 2 of
the r3 brief told the builder not to copy Artifact's composition; the owner
has since said the opposite: replicate Artifact one to one, and adapt
TextText's functionality underneath). Everything else in that plan still
holds: the content model, the bounds, the heartbeat, the privacy rules.

## 0. Where we are, honestly

0.189 shipped a Home that follows the r3 brief's "desktop adaptation":
a mode row, a topic strip, one image-led lead, compact headline rows with
hairline dividers, and a Recent column. It is not Artifact. The owner
opened it and saw the old library, because his workspace follows no feeds
and the front page only appears when a workspace has sources. Two
conclusions:

1. The visual target was wrong. The brief's section 2 said "do not scale a
   phone screenshot to desktop" and "avoid a giant hero"; the owner wants
   the phone screenshot, scaled with care, because that is the experience.
2. A Home that depends on the person having already added feeds is not
   Artifact. Artifact worked at first launch because it curated publishers
   and asked for ten topics. TextText must ship a publisher catalogue and
   the same onboarding, or the front page is an empty room.

What survives from 0.189 and should be kept, not rewritten: the read
model (`src/lib/reading/home.server.ts`), the materialized Summaries and
topics (`summaries-materialize.server.ts`, tables `reading_summaries`,
`reading_topics`), the pure ranker (`rank.ts`), personal state
(`reading_summary_state`, `reading_preferences`), the three agent tools,
and the tests. The UI in `src/components/workspace/home/` is what gets
replaced.

## 1. The evidence: Artifact's screens, from originals

All 28 originals are on disk twice: at `~/Downloads/artifact-reference/`,
where they were downloaded, and beside the owner's own recovered boards in
`~/Downloads/ARTIFACT_VISUAL_REFERENCES_RECOVERED/`, under `screens/`, with a
self-contained captioned gallery at `artifact_screens_local.html` there. The
boards in that folder load their images from the web, so the local copies are
the ones to trust when a source goes away. They are press and review
material, kept locally as design reference rather than in the repository.

Screens viewed for this plan (all originals, not reconstructions):
TechCrunch product shot (light For You), the "Popular in your network"
pair (light For You, search and bell), the clickbait trio (dark For You,
long-press sheet), the Summarize menu, the comments trio (reader and
comments), and from Gold's Guide's February 2023 walkthrough: Personalize
your feed, For You (light and dark), a topic feed with a location header,
Headlines, a Headlines story page, Read Later, the reader, the long-press
sheet, and the hidden-publisher toast. Written sources: TechCrunch
(2023-02-22 launch, 2023-03-07 ranking, 2023-04-25 summaries, 2023-06-02
clickbait rewriting), Wikipedia's timeline, Interesting Engineering's
guide, Gold's Guide.

### 1.1 Information architecture

Three bottom tabs: **Home** (house icon), **Headlines** (globe icon),
**Profile** (person icon). Above the feed: a full-width **Search** pill
with a **bell** at its right. Below that: a horizontally scrolling row of
**topic tabs**: "For You" first, then the person's chosen interests ("U.S.
Politics", "Stocks", "Tech Companies", "Tech", "Gaming", "Travel",
"Architecture"...), ending in an ellipsis that opens topic management. The
active tab is bold; the others are grey; no underline in the originals,
the weight change carries it.

### 1.2 The For You feed

One column, white (light) or near-black (dark), no card borders. Two unit
shapes, mixed:

- **Compact row.** Left: publisher favicon (16px, rounded 3px), publisher
  name (13px, grey), time ("3d", "2h", grey). Below: headline, 17px,
  semibold, up to three lines, near-black. Below: "43 reads" (12px, grey).
  Right: a 64 to 72px square thumbnail with 8px radius, vertically
  centred on the text block. Rows separated by a 1px hairline with 16px
  side gutters and 14px vertical padding.
- **Featured card.** Full-width image, 16:9, 8px radius, then the same
  publisher line, then the headline at 19px semibold, then reads. Every
  fourth or fifth unit, never two in a row.

Occasional inserts, same width: "Popular in your network" eyebrow (red
star, red text, 12px) above a compact row; a "New Articles" floating pill
at the top when the feed has fresh results; a location header ("Freehold
>" with a weather glyph and temperature) on a topic feed. A grey, dimmed
row is a story or publisher the person hid, with a bottom toast:
"Business Insider hidden. You can change this in your settings."

### 1.3 Long press on a unit

A bottom sheet with icon rows: **Show Fewer**, **Read Later**, **Share**,
**Hide Publisher**, **Report**. Later versions: Share, Share with Image,
Read Later, Dislike, Mark as Clickbait Title, Copy Link.

### 1.4 Headlines

A list titled "Headlines": each row is a story headline (17px semibold, up
to three lines), "26 Articles · 336 Reads" beneath, a square thumbnail at
right. Tapping opens a **story page**: the story headline centred at the
top, a full-width lead image, then the coverage as compact rows
(publisher, time, article headline, reads, thumbnail). This is the
Summary, one level up.

### 1.5 The reader

Article opens in an in-app web view of the original page. Bottom bar:
back, share, bookmark (Read Later), more. Top right "Aa" opens a menu:
**Summarize** (magic wand), **Open Reader Mode** (book), **Disable Auto
Dark Mode**, **Decrease Font Size**, **Increase Font Size**. Summarize
writes a short summary above the text, with playful styles (explain like
I'm five, emoji, Gen Z). AI-rewritten headlines carry a star glyph.

### 1.6 Profile

Read Later (list with "✓ Read" state and a Clear action), reading history,
Your Stats (categories read, most-read publishers, topics narrower than
categories, unlocked after ten reads), Manage Interests, Publisher
Subscriptions, Content Requests, notification settings, hidden publishers.

### 1.7 Onboarding

"Personalize your feed. Select 10 or more topics." Topic chips grouped
under headers (Most Popular, Lifestyle, Health, ...), a "0 selected"
button that becomes "Continue". Then straight into the feed. Artifact
asked for ten topics and suggested reading 25 articles before judging
the recommendations.

### 1.7a What the first open says

Before any personalization exists, Artifact says so in a sheet over the feed:
a progress ring at 0, "Artifact is learning", "Feed improves each time you
read", and "Read 25 articles for Artifact to better personalize your feed.
Track progress on your profile." (G03). This is the honest answer to the
problem 0.189 solved with a mode label, and it is better: the app admits the
feed is not yet personal and says exactly what closes the gap.

### 1.7b Inside a topic: a Headlines carousel

A topic feed opens with a "Headlines" heading and a horizontally scrolling row
of story cards, each an image with its headline overlaid and "35 articles ·
480 reads" beneath, then the ordinary feed continues (G07). The same Summary
unit at two sizes: a card in the carousel, a row in the list.

### 1.7c Reading History tells you how far you got

Each row in Reading History carries the publisher and a progress figure:
"22% read", "6% read", or a blue check reading "Read" (G13). Read Later uses
the same check (G12). Artifact measured reading, not just opening.

### 1.7d The profile settings menu, in full

Subscriptions, Manage Interests, Content Request, Blocked Publishers, Terms of
Service, Privacy, Push Settings, Send Feedback, Account Options, Sign out
(G16). Profile itself leads with a progress ring and a Super Reader goal, a
streak line, Invite Friends, then Read Later with a count, Reading History and
Publisher Subscriptions (G15). The ring, the goal and the streak are
gamification and stay out by the owner's brief; everything below them maps
directly onto the Profile tab in section 2.1.

### 1.8 Ranking

Curated publishers only (quality and corrections practice). Signals:
clicks, dwell time, read completion, shares; explicit topics; an
epsilon-greedy exploration share of 10 to 20 percent; interests that
decay after their news cycle ends. Feedback: Show Fewer, Hide Publisher,
Dislike. Later: Discover (shared links), comments, reputation, places,
text to speech. Those social features are out of scope by the owner's
brief.

## 2. The target: Artifact on TextText

Principle: **the screen is Artifact's; the data is TextText's.** Where
Artifact had a global concept (reads across all users, popular in your
network, hand-curated publishers), map it to the workspace's own truth or
to a curated catalogue we ship; never fake a number.

### 2.1 Surface mapping

| Artifact | TextText |
|---|---|
| Home tab (For You + topic tabs) | Home of a workspace: the news feed fills the content column. The library moves behind the Profile tab and the sidebar. |
| Headlines tab | Summaries list: every materialized `reading_summaries` row with two or more sources, newest first, "N articles" (sources) in place of reads; tap opens the story page. |
| Profile tab | Read Later (kept items), History (read state, newest first), Your Stats, Manage Interests, Hidden publishers, Notifications. |
| Search pill | Reading search across articles, publishers, and topics (existing `searchReading` plus a publisher and topic match). |
| Bell | Inbox of the workspace's own events: saved-search alerts, digest sent, backup outcome. Read from `action_audit` for this person, bounded. |
| Topic tabs | `reading_topics`, ordered by the person's pinned interests first (new: `reading_interests` per person). Ellipsis opens Manage Interests. |
| Reads count | Not available honestly. Show **read time** ("4 min") from word count, and on a Summary "N sources". A count of reads inside the workspace (collaborators) can be shown as "read by 2" only when there are collaborators; never a global number. |
| Popular in your network | Dropped for a solo workspace. With collaborators: "Popular in your workspace", items opened by two or more members. |
| New Articles pill | The ranking snapshot changed since the page loaded (a tick completed, or the materializer ran). One pill, tap to apply. Already the "New results" affordance in the read model; needs the pill UI. |
| Show Fewer | `topic_less` on the unit's strongest derived topic, with the target named in the toast. |
| Hide Publisher | New kind `source_hidden`: an exclusion for the person's Home and Headlines, listed under Hidden publishers with Undo. Not an unsubscribe; Latest, folders, and clients still see it. |
| Dislike | `hide_summary` for a Summary; for an article, `article_dislike` row (new) that removes it from the person's Home only. |
| Read Later | Keep (`setKeep`); the Read Later list is the kept scope, with a "Read" check when read state says so. |
| Report / Mark as Clickbait | "Rewrite headline": one model call over the article's own text producing a plain headline, cached in `reading_headline_rewrites`, shown with a star glyph and the original on hover. No community threshold; it is the person's workspace. |
| Summarize (with styles) | Per-article summary in the reader: one model call, cached in `reading_article_summaries` (item, style, text hash). Styles: plain, explain like I'm five, emoji, poem. Grounded in the article text only. |
| Reader mode | Existing full-text extraction (`extract.server.ts`), rendered as the item body. |
| Font size, auto dark | Existing app theme; font size control in the reader bar. |
| Personalize your feed | Interests picker over a shipped catalogue (new): topics grouped like Artifact's, each mapped to a starter set of feeds. Choosing ten topics subscribes the workspace to their feeds in bulk. |
| Publisher curation | A shipped catalogue of feeds per topic (a new catalogue module under `src/lib/reading/`), reviewed by hand, with the feed URL, site, and a short line. The person can add any feed as today. |
| Your Stats | Aggregates over read state and provenance: categories read, top publishers, narrow topics (derived), counts for the last 30 days. |
| Percent read (G13) | Real, and we have the input: `reading_read_sessions` plus the item's word count gives a truthful "38% read" without a scroll log. Show it in History and on a Read Later row. |
| "Artifact is learning" (G03) | The cold-start sheet, said in TextText's terms: a ring over the feed on first open, "For you gets better as you read", with the count of articles read so far. It replaces the mode label as the honest signal, and disappears once the ranking has signal. |
| Headlines carousel in a topic (G07) | The same Summary unit at card size, scrolled horizontally under a "Headlines" heading at the top of a topic view, leading into the story page. |
| Text to speech, comments, Discover, Links, places, reputation | Out of scope. |

### 2.2 Desktop composition

Artifact is a phone. On the Mac and the web, keep the phone's column and
give it room: a **single centred column, 640px wide** (edge to edge on
phones), with the three tabs as a **top segmented bar** inside the
column (Home, Headlines, Profile), the search pill and bell above the
topic tabs exactly as on the phone. The TextText sidebar stays; the
assistant stays. Nothing else competes in the column: no Recent column,
no library, no counters. Recent work lives in the sidebar and under
Profile; the owner's Superhuman speed lives in the keyboard.

Why a centred column and not a wide grid: every Artifact screen is a
column, and its rhythm (image, publisher, headline, reads) is what people
recognise. Widening it into a grid is how 0.189 stopped looking like
Artifact.

### 2.3 Visual spec (light and dark)

Measured from the originals at 393pt width, scaled to a 640px column.

- Column: 640px, side gutters 20px. Background `#ffffff` light,
  `#0b0b0c` dark (Artifact's dark is near-black, not grey).
- Text: near-black `#111` on light, `#f2f2f2` on dark; secondary grey
  `#6b6b6b` light, `#9a9a9a` dark. Face: the app's `--ac-font-text`
  (Inter, SF-alike), which is what Artifact used.
- Search pill: 40px tall, full column width, 20px radius, fill `#f2f2f3`
  light and `#1c1c1e` dark, magnifier and "Search" placeholder centred.
  Bell 24px at the right, 12px gap.
- Topic tabs: 15px, medium weight; active near-black, inactive grey; 20px
  between tabs; horizontal scroll with no scrollbar; ellipsis at the end.
  Row height 40px, no underline, no pill.
- Compact row: grid `minmax(0,1fr) 72px`, gap 16px, padding 14px 0,
  hairline `1px` at 8 percent alpha of the text colour. Publisher line
  13px grey with a 16px favicon at 3px radius and the time after a middle
  dot. Headline 17px, weight 600, line height 1.25, three lines max.
  Meta line 12px grey ("4 min read", or "3 sources" on a Summary).
  Thumbnail 72px square, 8px radius, object-fit cover, background the
  pill fill while loading.
- Featured card: image 16:9 at column width, 8px radius, 12px below it
  the publisher line, headline 19px weight 600, meta line. Every fourth
  or fifth unit when it has an image; never two in a row.
- Hidden row: text at 40 percent opacity, thumbnail dimmed, toast below.
- Toast: 44px tall, column width minus 32px, 12px radius, fill
  `#1c1c1e` light and `#2c2c2e` dark, white text 13px, eye icon at right.
- Headlines row: headline 17px weight 600, "N articles · M sources" 12px
  grey, 72px thumbnail. Story page: headline centred 20px weight 600, lead
  image 16:9, then compact rows.
- Long-press sheet: a bottom sheet on touch; on desktop a context menu at
  the pointer (right click) and the "More" key, same rows and icons.
- Reader bar (desktop): back, share, keep (bookmark), more; "Aa" menu
  with Summarize, Reader mode, font size.
- Motion: none beyond the "New Articles" pill sliding in; respect reduced
  motion.

### 2.4 Keyboard (kept, extended)

j k move, o or Enter open, s star, e keep (Read Later), m read, v
original, x dislike or hide the Summary, comma Show Fewer, h hide
publisher (with undo), Tab cycles Home, Headlines, Profile, slash focuses
search, 1 to 9 pick topic tabs. Return restores tab, topic, snapshot,
focus, and scroll.

## 3. Data and backend deltas

Keep: `reading_summaries`, `reading_topics`, `reading_summary_state`,
`reading_preferences`, `rank.ts`, the tick job, the home route.

New tables (one migration, a new migration script beside the others in `scripts/`,
idempotent, registered in `run-release-migrations.sh` and `db:push`):

- `reading_interests` (user_id, blog_id, topic_key text, position,
  created_at): the ten-plus topics the person picked, ordered. `topic_key`
  is a catalogue key ("tech-companies"), not a `reading_topics` id, so it
  survives materialization.
- `reading_catalogue_subscriptions` (blog_id, topic_key, connection_id):
  which feeds the catalogue subscribed for which topic, so Manage
  Interests can unsubscribe cleanly and never touch feeds the person added
  by hand.
- `reading_article_state` (user_id, post_id, disliked_at, hidden_publisher
  is not here; see next): per-article dislike for Home only.
- `reading_preferences` gains kind `source_hidden` (exclusion) beside
  `source_less` (demotion). Hidden publishers list in Profile.
- `reading_headline_rewrites` (post_id, blog_id, text_hash, headline,
  model, created_at): one rewrite per article version.
- `reading_article_summaries` (post_id, blog_id, style, text_hash, text,
  model, created_at): one summary per article version and style.
- `reading_read_sessions` (user_id, post_id, opened_at, closed_at,
  seconds): dwell, recorded by the reader on close, capped, used as the
  weak positive signal Artifact used. Never a scroll log.

Catalogue: a new catalogue module under `src/lib/reading/`, a hand-written list. Groups as
Artifact's picker: Most Popular, Technology, Business, Science, Lifestyle,
Health, Culture, Sports, World. Each topic: key, label, three to six feeds
(URL, site, one line). Start with what is known to serve clean RSS: The
Verge, Ars Technica, Wired, TechCrunch, MIT Technology Review, Hacker
News front page, Stratechery (free posts), Bloomberg Technology (if
RSS), Financial Times (headlines), The Economist (sections), Nature news,
Quanta, Ars science, NASA, The Guardian sections, BBC sections, Reuters
sections, AP sections, NPR sections, The Athletic (if RSS), ESPN, Eater,
Bon Appétit, Dezeen, ArchDaily, Architectural Digest, Vogue, Hypebeast,
Polygon, Kotaku, Rock Paper Shotgun, Pitchfork, Variety, Deadline, The
Ringer. Validate each with the existing feed fetcher in a unit test that
runs only with a flag (`TEXTTEXT_CATALOGUE_CHECK=1`), so the catalogue
does not rot silently.

Ranking additions to `rank.ts` (version 2):

- Dwell affinity: mean of read sessions over 30 seconds on the unit's
  topics, decayed over 30 days, weight 1.
- Exploration: with a seeded pseudo-random draw keyed by (snapshot,
  person), 15 percent of positions 4 to 20 are filled from candidates
  outside the person's interests. Deterministic per snapshot, so paging
  is stable.
- Interest decay: a `topic_more` older than 30 days with no opens in its
  topic counts half.
- Exclusions before scoring: hidden publishers, disliked articles, hidden
  Summaries.

Summaries and headline rewrites: the tick's `summarize_recent` job also
writes at most four article summaries (plain style) for the newest
articles that have full text, and at most four headline rewrites for
articles whose title matches a clickbait heuristic (question or ellipsis
endings, "you won't believe", numbers plus "reasons"), all with the
workspace model. Other styles are written on demand from the reader.

Your Stats: a new stats module under `src/lib/reading/`: for the last 30 days,
reads by category (topic), top publishers, narrow topics (derived), total
reads and minutes (from sessions). One bounded query each.

Inbox: a new inbox module under `src/lib/reading/`: last 50 `action_audit` rows for
this person and workspace with action names in a small allowlist
(reading.send_digest, reading.alert, github.run_backup), plus alert
matches from saved searches with `notify`.

Onboarding: when a workspace has no feeds, Home shows "Personalize your
feed" (Artifact's picker) instead of the library, with the catalogue
groups. Continue subscribes the chosen topics' feeds in one request
(`POST /api/workspace/reading/interests` with the keys), records the
interests, and lands on For You with a "Checking your sources" state
until the first tick imports. A person can skip to the library.

## 4. Client work

Replace `src/components/workspace/home/HomeNews.tsx` and `HomeRecent.tsx`
with `ArtifactHome/` components:

- `HomeColumn.tsx`: the centred column, segmented tab bar, search pill,
  bell, topic tabs, and the active pane.
- `FeedPane.tsx`: For You and topic feeds; units as CompactRow and
  FeaturedCard; the New Articles pill; the hidden-row treatment with
  toast; keyboard; seen tracking (kept from 0.189); context menu.
- `HeadlinesPane.tsx` and `StoryPage.tsx`.
- `ProfilePane.tsx`: Read Later, History, Your Stats, Manage Interests,
  Hidden publishers, Notifications.
- `Onboarding.tsx`: Personalize your feed.
- `ReaderBar` changes in `src/components/workspace/reading/ReadingReaderBar.tsx`:
  Aa menu with Summarize (styles), Reader mode, font size; keep; share
  (copies link); star glyph on rewritten headlines with the original on
  hover.
- Styles in `ArtifactHome.module.css` per section 2.3, both themes.

The library (filters, sort, view mode) stays reachable from the sidebar's
All items and from Profile; the root page mounts the column when the
workspace has feeds or is onboarding, and the library otherwise, plus the
"Personalize your feed" entry point.

## 5. Sequence for the next agent

Each step is one commit with tests, verified in the browser with the
`dev-with-ai` launch config, both themes, 640px and phone widths.

1. **Catalogue and onboarding.** `catalogue.ts`, `reading_interests`,
   `reading_catalogue_subscriptions`, the interests route, the
   Personalize picker, the no-feeds state. Test: choosing ten topics
   subscribes their feeds once, unsubscribing a topic detaches only
   catalogue feeds. This is the step that makes the owner's workspace
   show news at all.
2. **The column and the For You feed.** Replace the Home UI with the
   Artifact column: tabs, search pill, bell, topic tabs, compact and
   featured units, hairlines, hidden rows, toast, New Articles pill,
   context menu with Show Fewer, Read Later, Share, Hide Publisher,
   Dislike. Wire to the existing read model; add `source_hidden` and
   article dislike. Compare side by side with the eleven originals
   before calling it done.
3. **Headlines and the story page.** Over `reading_summaries`.
4. **Reader: Aa menu.** Summarize with styles, reader mode, font size,
   headline rewrite with the star glyph, keep and share in the bar.
5. **Profile.** Read Later, History, Your Stats, Manage Interests, Hidden
   publishers, Notifications inbox.
6. **Ranking v2.** Dwell sessions, exploration, decay, exclusions. Tests
   over one corpus with contrasting people, determinism per snapshot.
7. **Proof.** PERF on the 5,000-item fixture for every pane, captures in
   both themes at 640px and 375px, keyboard and return, the no-key path,
   and an adversarial review. Update `docs/reading-architecture.md`,
   `docs/HANDOFF.md`, the tool docs, and this plan's status.

Estimated size: steps 1 and 2 are the bulk; 3 to 5 reuse existing
functions; 6 is a day; 7 is half a day.

## 6. Rules that do not change

Feed items are private bookmark-kind items; Home is private; nothing
here is public. Every user-initiated write goes through `src/lib/store.ts`
with an audit row. No scheduler; the tick is the heartbeat and every job
is bounded. Feed items never enter the whole-workspace client pool. The
model is called only from the tick's bounded job or on an explicit tap in
the reader, never while rendering a list. Copy says Summary, never Story,
and has no em dashes. React compiler lint rules hold. Hide Publisher and
Dislike affect Home and Headlines only; Latest, folders, search, digests,
exports, and the Reader and Feedbin APIs see everything.

## 7. Decisions the owner should confirm

1. Reads counts: show read time and source counts instead of Artifact's
   global reads. (Recommended; the alternative is a fake number.)
2. Hide Publisher as an exclusion from Home, distinct from the existing
   Less from a source demotion. (Recommended.)
3. The catalogue's first list of feeds. The draft in section 3 is a start;
   the owner's own taste should shape it before it ships.
4. Social: comments, Discover, Links stay out. (Assumed.)

## 8. For the owner's workspace today

The workspace follows no feeds, so 0.189's front page never appears. Until
step 1 lands, import `docs/plans/artifact-starter-feeds.opml` from
Settings, Manage sources, Import: it holds a starter set across
technology, science, design, and world news, and the front page appears
on the next open. The catalogue in step 1 replaces this file.
