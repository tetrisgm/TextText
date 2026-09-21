# Personal workspace implementation plan

Status: approved direction, implementation goal active. September 21, 2026.
This plan supersedes the news-only Home composition in DESIGN.md and earlier
Artifact plans. Superhuman is a responsiveness reference, not a Home layout.
No implementation milestone below is complete merely because related code exists.

## Outcome

Build one coherent workspace for frequent short visits: capture a thought,
resume writing, skim RSS, save a source, and develop it into a document.
Home combines capture, Continue, and a personal timeline. News has its own
destination. Bookmarks contains deliberate saves. Writing contains notes and
articles. Nested folders organize any mixture. User-defined types participate
in the same workflows. Desktop retains left navigation and right AI chat.

The complete goal includes implementation, local production build, real UI
verification, regression and performance checks, and committed/pushed work.
Public deployment and installation use release/ship.sh only when requested.

## Product decisions

- Home: compact capture field, at most three Continue entries, then a dated
  timeline with Everything, Writing, Saved, and News filters.
- Continue means recently opened, not recently autosaved; restore reading or
  editing position. It is a small center section, never another fixed column.
- Timeline entries represent creation, deliberate saving, and publishing.
  Autosaves and opens do not generate timeline noise. Dates and stable IDs
  determine order. Repeated saves are idempotent. A new-items control admits
  arrivals without shifting the viewport or keyboard selection.
- News on Home is a bounded digest of up to three real headlines per group.
  News opens the complete paginated RSS experience. No fabricated summaries,
  counts, publishers, or algorithmic promises.
- Bookmarks means explicitly saved content, including feed items you keep.
  Read later is a state, not another copy or document type. Saving a feed item
  preserves identity, provenance, annotations, position, and retention holds.
- Writing combines quick notes and longer articles with filters. New writing
  stays nonpublic by default. Changing presentation never publishes content.
- Quick capture accepts text or a URL. A URL with commentary preserves both.
  Save text before remote extraction; network or AI failure cannot lose input.
  Titles, filing, and template selection are optional during capture.
- Folders retain their hierarchy and access rules. Mixed folders support a
  suitable default view and an explicit persisted view choice. Types do not
  force separate folder trees. Moving an RSS folder preserves its subscription.
- Built-in and custom types share creation, search, folders, Home, and AI.
  Type authoring supplies a name, icon where supported, typed fields, starter
  content, and validated item/collection presentation. No executable templates.
- Reopening restores the current workspace location; Home is one command away.
  Desktop rails default visible, remain resizable/collapsible, and remember
  explicit choices. Narrow screens use accessible drawers/destinations.
- AI scope is visible: current item plus explicitly attached sources. Preserve
  conversation across navigation and existing review-before-apply behavior.

## Existing foundations and investigation targets

| Concern | Existing foundation | Required audit/change |
| --- | --- | --- |
| Shell | PostWorkspaceShell, WorkspaceSidebarChrome, artifact.css | Separate Home/News/Writing/Bookmarks routing; rail geometry and persisted preferences |
| Home | WorkspaceRootPages, open history, Artifact components | Compose capture/Continue/timeline without mounting every destination |
| RSS | reading/home.server, list.server, ingestion, provenance | Reuse paging and source identity; exclude unsaved imports from saved library |
| Saved content | Keep/read state, retention holds, bookmark capture | Verify explicit saved membership and saved timestamp, dedupe and undo |
| Documents | DocumentSnapshot, DocumentRenderer, store | Preserve content, revisions, permissions and full-document Yjs |
| Custom types | presentation/schema, template-library, existing type studio | Expose complete manual definition and normal creation flows; verify versioning |
| Navigation | Workspace commands, tabs, capture intent | Consistent shortcuts, exact return position and focus restoration |
| Native | Existing Mac app/capture and local persistence | Audit global capture, reopen path and offline durability before extending |

Read docs/document-types.md and docs/reading-architecture.md for architecture.
All content access remains through src/lib/store.ts. Mutations are audited.
UI, assistant, CLI and MCP reuse shared commands. Authorization is enforced on
queries and mutations, including timeline projections and local cache scoping.
Do not introduce a separate content model or route the app through its MCP API.

## Sequence and acceptance gates

### 1. Baseline, design and shell

- Inventory the current paths with realistic local data: empty workspace,
  existing owner workspace shape, deeply nested folders, and large RSS fixture.
- Record first usable paint, warm reopen, capture readiness, navigation, typing,
  scroll and synchronization baselines before changing application code.
- Update DESIGN.md to the agreed composition. Establish shared light/dark tokens,
  editorial rows, bookmark previews, writing typography and responsive behavior.
- Separate the destinations while preserving old links and item URLs. Keep
  settings, starred, shared and Trash reachable without crowding primary routes.
- Remove double reservation of assistant width; honor sidebar state on folder
  selection and explicit assistant collapse; react correctly to viewport changes.
- Acceptance: both rails fit without overlap or blank reserved space; every
  destination works at desktop and phone widths with keyboard and both themes.

### 2. Membership and timeline read model

- Define explicit classification using existing origin, saved state and templates.
  Feed origin alone never means saved; presentation alone never means public.
- Inventory existing timestamps and history before adding storage. Add only
  missing durable save/publish events needed for truthful timeline ordering.
- Expose a bounded permission-filtered projection with stable event IDs,
  keyset pagination, type filters and a snapshot boundary for new arrivals.
- Reuse existing store data and cached summaries; no body fetch per list row,
  full-workspace RSS hydration, or AI work on the request path.
- If schema changes are needed, use additive idempotent migrations, bounded
  backfill, honest fallback dates, and transactionally coupled audit writes.
- Acceptance: no duplicates across pages, deterministic tie ordering, correct
  feed/saved distinction, no hidden or trashed items, no cross-workspace leaks.

### 3. Home and durable capture

- Build the three-part Home with readable text posts, document excerpts,
  saved-source previews and bounded news groups. Empty states offer useful actions.
- Wire capture through existing creation commands, preserving the first typed
  characters during navigation and asynchronous creation. Support retry without
  duplicates, IME, multiline input, and failure/reload recovery.
- Derive Continue from open history; restore exact item and position. Persist
  filters, scroll and selection per destination without remounting the editor.
- Queue new timeline entries behind an explicit new-items control; own successful
  captures can be revealed without displacing unrelated ongoing work.
- Acceptance: capture text and URLs, reopen after reload, disconnect/reconnect,
  retry, filter and paginate; no input loss or unexpected reordering.

### 4. News and saved library

- Retain Artifact-style RSS browsing, topics, reader controls and source settings
  in News and feed folders. Keep full feed volume out of Home and initial payloads.
- Build the Shiori-inspired saved library with coherent list/image treatments,
  useful excerpts, graceful image failures, folders, search and reading states.
- Save from News or capture using the same membership command. Repeated save,
  already-bookmarked URLs, retention expiry and undo must preserve identity.
- Acceptance: save an RSS item, find it in Bookmarks and its folder, reopen at the
  same position, and verify it survives feed cleanup; unsaved RSS stays in News.

### 5. Writing and source integration

- Make notes/drafts/articles easy to browse and create under Writing. Reuse the
  existing editor and shared renderer with a calm article reading presentation.
- Add selection-to-note: choose an existing note or create one, append the exact
  passage with source link, and preserve any concurrent edits.
- Add write-from-source(s): attach references to a draft and make them accessible
  to the user and the explicitly scoped AI conversation.
- Let a short note become an article by changing presentation with content,
  attachments, history and collaboration intact; publishing remains explicit.
- Acceptance: capture -> read -> save -> quote into note -> develop article ->
  reopen; verify quotes, links, both concurrent writers, history and visibility.

### 6. Mixed folders and custom types

- Audit existing folder mode restrictions; remove only presentation restrictions,
  preserving permissions, subscriptions and native file identity.
- Persist folder view choices; support mixed content, nesting, moves and search.
- Surface existing type studio through New and settings; provide manual controls
  for fields, defaults/starter content and validated presentation without AI.
- Preview using DocumentRenderer; save immutable versions; do not silently
  change documents pinned to earlier versions. Retiring a type leaves items usable.
- Acceptance: define a Book review with author/rating/body, create it, find it in
  Home/search/folder, export/import it, edit the type and verify old items survive.

### 7. Keyboard, native reopening and contextual AI

- Register commands centrally and expose their actual bindings in the command
  menu. Reuse current bindings where possible; prevent collisions with editing.
- Support destination jumps, creation, search, row navigation, open/back, save
  and folder movement. Restore focus after dialogs and navigation; guard IME.
- Reuse or extend native global capture so capture does not navigate away from
  current writing. Retain input after interrupted save and explain sync state.
- Keep AI initialization off the critical path; maintain visible scope and
  conversation while switching sources/documents. Hidden rails stay hidden.
- Acceptance: complete the main loop using keyboard only; capture from another
  app; reopen repeatedly; verify context changes and staged edits target correctly.

### 8. Integrated verification and completion

- Run relevant unit, database, permission and migration tests as each boundary
  changes. Run the full required gates and a local production build at integration.
- Exercise empty, loading, offline, extraction failure, revoked-access and large
  workspace states. Test real UI at phone, laptop and wide desktop in both themes.
- Repeat benchmark fixtures under comparable conditions: article/back, channel,
  folder, note and new destinations must stay below 200ms p95. Target locally
  cached command feedback within 100ms; establish measured reopen/capture budgets
  in phase 1 and report cold launch separately from warm reopening.
- Preserve or improve baseline typing/scroll and two-editor convergence. Test
  immediate typing in a new note, reload recovery, conflicting edits and restore.
- Confirm timeline/bookmarks queries stay bounded with at least 5,000 feed items;
  no unnecessary full bodies, repeated counts, per-row requests or eager AI calls.
- Record screenshots, commands, results, environment and limitations in one
  verification receipt. Commit small coherent changes and push only passing work.
- Goal complete only when all functional gates pass and the local production
  build is usable. A plan, screenshots, or a shell-only change is not completion.
- On a release request, use release/ship.sh, verify installed/public versions and
  follow texttext:project-changelog for the existing project record. Preserve the
  known credential blocker if access to that separate workspace is still absent.

## Working constraints and scope

Work on main; pull before edits. Preserve unrelated September 17 changes in
attachments.ts, tabs.test.ts and scripts/.probe-editor.ts. Local development,
tests and builds use local Postgres; read DATABASE-OPERATIONS before DB work.
Read relevant installed Next.js guides before code and browser-verification
guidance before UI verification. No infrastructure repair or new background
build/release jobs. No new social network, ranking engine, analytics dashboard,
external integration suite or replacement collaboration system is required.

Track phase completion here with evidence links as work lands. Do not convert
unverified existing features into completed acceptance claims.

## Implementation checkpoints

- Timeline refresh now follows the current server snapshot through the oldest
  loaded row, capped at 500 rows. Reconciliation removes rows not returned by
  that revalidation, including older deleted or inaccessible items, and uses
  the refreshed pagination cursor. An in-flight More items response cannot
  overwrite a completed refresh. Fourteen targeted tests, TypeScript and lint
  pass, covering multi-page refresh, the bound and stale-row removal. Real
  browser folder-access revocation and exact scroll restoration remain open;
  the running production preview predates this change.
- Home now distinguishes workspace access denial (401/403/404) from transient
  request failures. Denial hides its capture, Continue, news and timeline;
  clears session content snapshots; fences late requests; and remains hidden
  on remount until a successful timeline request restores access. Ordinary
  connection failures retain cached content. Thirteen targeted tests, TypeScript
  and targeted ESLint pass, including late feed completion and access recovery.
  This does not yet verify item-level revocation in older loaded timeline pages
  or the live browser denial flow. The running 3103 preview predates this change.
- Concurrent editing passed in the production preview on 3103: two browser
  sessions opened local note c13e473f-01b3-4f25-b9ec-d4dad6264d83 and typed
  different sentences concurrently. Both sessions converged with both complete
  sentences and the original source reference, reported Saved and Synced, and
  reload preserved the merged body. This covers a small document, not measured
  collaboration latency or concurrent source capture. A browser-side navigation
  timing attempt could not access the performance API through the read-only
  evaluation scope; no timing result was obtained or accepted.
- Saved-reading production loop passed on 3103: a kept RSS item appears once in
  All saved and Read Later, opens the original reader, and leaves both lists
  when Read Later is removed. Existing note backlinks remain. Implicit source
  retention does not make an item a deliberate bookmark.
- Added template-lifecycle.db.test.ts to exercise actual local storage: create a
  typed document, update its definition, retire the type, export and parse a
  textpack, install it into another workspace and persist the imported document.
  The original version, fields and body survive; importing a later version into
  the retired source workspace does not revive its picker entry. This proves
  the storage/serialization path, not the complete UI import flow.

- Source capture now offers Open note after a successful save. It refreshes the
  destination metadata before navigating, supports newly created destinations,
  and reports navigation failure separately without repeating the append/create.
  Link-only saves no longer claim a passage was saved. TypeScript, targeted lint
  and a fresh production build passed (.texttext/personal-build-source-handoff,
  log /tmp/texttext-source-handoff-build.log, preview localhost:3103).
  Production UI verified New note -> Save -> Open note -> reload; source link
  and contextual AI target persisted for c13e473f-01b3-4f25-b9ec-d4dad6264d83.
  The over-limit local fixture's plan was temporarily paid and restored to free.
  Development preview 3100 returned an obsolete pool projection despite the
  include query; direct current-code and fresh-production checks passed. Do not
  use that long-lived development process as final runtime evidence.

- Updated production verification at 809f17fa: build passed with local Postgres
  (.texttext/personal-build-809f17fa, log /tmp/texttext-personal-build-809f17fa.log).
  The current production preview is localhost:3102; 3101 is the prior build.
  Home headline -> NASA reader passed. Selected the visible introductory passage
  by dragging, used Add to note to append to local fixture 79609afc-57f3-41ea-beee-06e19a1bf998,
  reopened it through Writing and reloaded. Original content, exact selected
  passage (Markdown-escaped), both source links and Article presentation survived.
  AI scope followed the reader and destination document. This does not yet prove
  concurrent writing or a newly created destination in this flow.
- Home visually checked in production at 1280x720 desktop and 390x844 phone,
  light and dark. Desktop retains both rails; phone uses bottom destinations.
  Returning to desktop restored both rails and document scrollWidth equaled
  innerWidth (1280). Restored system appearance and cleared the viewport override.
  Other destinations/themes and quantitative p95 timing remain outstanding.

- Production build passed at 43d13816 using local Postgres, with output in
  .texttext/personal-build and log /tmp/texttext-personal-production-build-current.log.
  A local-only server runs at localhost:3101 for verification; development stays
  on 3100. Its first interaction check exposed Home opening with a stale pool
  callback. Home now waits for the selected item to enter the rendered pool
  before opening headlines or timeline entries. The headline-to-reader handoff
  was verified in development with the matching AI context. Rebuild production
  after this correction before measuring navigation. Neither build is released.

- RSS reader verification exposed a refresh bug: the intentionally manual-only
  pool evicted the open feed item and rendered News at the article URL. Refresh
  now asks the owner-only endpoint to revalidate up to 50 opened feed IDs with
  bounded list projections. Workspace and deletion predicates still apply;
  arbitrary or cross-workspace IDs cannot widen the result. The 5,000-item
  database suite passes including explicit inclusion, duplicate/invalid IDs and
  workspace isolation. RSS readers also expose Add to note. Reloaded reader and
  its destination dialog were verified locally; fresh navigation still needs a
  performance pass. TypeScript and targeted lint pass.
- Integration test run: 3,518 passed, 122 skipped, one large-paste timeout under
  full-suite load. Both large-paste tests passed in an isolated rerun (35.58s).
  This is not a clean full-suite timing result. Logs:
  /tmp/texttext-personal-full-suite.log, /tmp/texttext-personal-paste-isolated.log,
  /tmp/texttext-rss-refresh-db.log. Final production build remains pending.

- Bookmarks search/folder/Read Later and Writing type/folder preferences survive
  destination remounts and reloads in workspace-scoped browser session storage.
  Content snapshots are not persisted there. Hydration renders defaults before
  applying restored preferences. In the desktop browser, search -> article ->
  Back and full reload both restored the saved search. Exact scroll/row-focus
  restoration and loaded-page caching still require completion.

- Bookmarks has server-side text search scoped to folder, saved membership and
  Read Later. Searches remain paginated; literal wildcard characters do not
  widen matches. Local database checks cover scope intersections and anonymous
  access. The desktop UI was verified with a matching query and an empty result.
  Search and Bookmarks first pages skip unused folder-summary count queries.

- Writing now exposes the shared New menu and type builder directly, including
  Article and custom types. Its labels and pagination cover all writing rather
  than only notes. The live desktop menu was verified, and the linked-source
  excerpt now renders readable text. Typecheck, targeted lint and 55 related
  tests pass; article creation/save/reopen from this destination remains to be
  exercised end to end.

- Home refresh now reconciles title changes and removals within the refreshed
  page range, retaining older loaded pages and staging new arrivals. Save-state
  events refresh the timeline; overlapping responses are ordered. The news
  digest uses the RSS Home query instead of sampling mixed saved-reading rows,
  and news errors no longer disappear when the timeline succeeds. Seven focused
  timeline/session tests pass. Full loaded-range access invalidation and live
  refresh/focus verification remain pending.
- Removed the remaining type-based restriction in the bulk-move toolbar so
  mixed selections expose folder destinations. Existing mutation permission
  checks still apply; no folder grants were widened.

- Desktop regression corrected at a 792 CSS-pixel mouse-driven window: both
  rails stay docked and the mobile destination bar stays hidden. Aligned the
  sidebar/assistant compact rules and removed duplicate mobile padding from
  the center column. Visually checked at 792 and 984 CSS pixels. Typecheck,
  targeted lint and 119 relevant tests pass. Destination commands are available
  in the palette; keyboard-only Open Writing was verified in the local browser.
  The broad unit run found obsolete news-only Home contracts (now updated) and
  a large-paste timeout requiring isolated re-verification.
- Local production build completed successfully using local Postgres and
  `.texttext/personal-build` (desktop/navigation implementation at `c9e23e07`).
  The large-paste provider regression passed in isolation: two tests, 40.23 s.
  The broad run had 3,505 passes; its old Home contracts now pass in the targeted
  run, and its only other failure was that large-paste timeout under load.
  The 5,000-feed-item scale suite now checks timeline and Bookmarks membership,
  seven-item pages, no cross-page repeats, no full bodies in timeline rows, and
  query times under two seconds. All four scale tests pass. These are server
  query bounds, not evidence of the separate 200 ms UI navigation requirement.
  Document previews now show internal-link labels instead of raw wiki markup;
  four focused content/boundary checks pass.

- Saved library now provides nested-folder filtering, All saved/Read Later,
  excerpts and larger previews. Pagination drops responses from previous scopes.
  Typecheck and targeted lint pass; visual acceptance remains pending.
- Bookmark readers now offer Add to note for a selected passage or source link,
  targeting an existing note or creating a private note through shared commands.
  Append uses the idempotent live-content mutation path. Literal quote tests and
  57 shared-command tests pass, as do typecheck and targeted lint. Live reader,
  concurrent-editor and source-retention verification remain required.
- Source notes now use internal document references recognized by retention
  cleanup. Fifteen quote/retention tests pass against local Postgres, including
  cleanup protecting the generated reference. In the local browser, Add to note
  appended a source to `Workspace integration check September 21`; a store read
  confirmed the original paragraph and source reference both persisted. This
  does not yet verify selecting a passage or concurrent writers in the live UI.
  Browser verification also found and fixed News/Bookmarks deep-link parsing;
  reloading Bookmarks now displays its library and folder filter.

- `8f443639`: desktop rail geometry and explicit visibility choices corrected;
  sidebar tests pass. Native visual acceptance is still pending.
- `de6bf1df`: dedicated bookmarked query includes manual bookmarks and explicit
  feed saves, separately from Read Later. Five local database tests pass,
  including anonymous visibility and releasing a feed save.
- Initial Home composition now reuses the durable capture queue, displays three
  recent opens, previews personal material and a bounded news group. News,
  Bookmarks and Writing have independent navigation. This is an intermediate
  implementation: state restoration, visual acceptance and benchmark evidence
  remain required.
- Timeline now comes from a bounded store query and authenticated route, with
  snapshot/keyset pagination, save-hold timestamps, creation/publication ordering,
  and no autosave reordering. Home groups dates, loads further pages, and stages
  new entries behind New items on focus or capture. Database checks cover
  terminating pagination, no repeats/newer arrivals, stable autosave dates,
  anonymous access, filter-bound cursors and exact feed-save timestamps.
  Warm cache/return-position and large-fixture performance checks remain open.
- Mixed-folder type gates removed from draft creation, direct/bulk UI moves and
  assistant/MCP commands. Explicit kinds select their matching built-in template
  unless a template is explicitly supplied. Local database tests verify notes,
  articles and bookmarks in one folder, private drafts, preserved document/ID on
  moves, and audit records. Folder rendering, nested-feed moves and native sync
  acceptance remain to be verified in the integrated app.
- Capture preserves commentary after a URL on its own first line and keeps the
  full body of thoughts longer than the title limit. Existing queue and intent
  tests pass; UI capture/reload verification remains open.
- Local browser verification on September 21: Home capture of a multiline note
  saved, opened in the editor, and retained its full body after reload. AI context
  followed the opened item. Corrected routing so the primary Notes folder wins
  over Documentation. Home now exposes New and New type; a manually defined
  Book review verification type with Author and Rating saved and appeared in New.
- Added workspace-owned, memory-only timeline/news snapshots and filter retention
  for returning to Home. Session tests cover filter isolation and clearing.
  Exact scroll/focus return and production timing are still unverified.
- Custom-type UI round trip passed in the local preview: manually added Author
  and numeric Rating, saved Book review verification, created an item from New,
  entered title/body/author/rating, waited for Saved and reloaded. All values
  survived. Local fixture visual-demo exceeded its free item allowance; its plan
  was temporarily changed to paid for this check and restored to free afterward.
  Test document IDs: 79609afc-57f3-41ea-beee-06e19a1bf998 (capture) and
  0ed70aa4-2854-4455-aba7-d8fdf9685bec (custom type). These are local-only fixtures.
  Preview uses localhost:3100 and .texttext/personal-dev; log is
  /tmp/texttext-personal-dev.log. Revalidate the running process before reuse.
- Writing now classifies authored notes/articles by canonical template, with a
  legacy fallback. Custom types remain in Everything; feed and bookmark sources
  stay outside authored writing. The existing capture fixture was changed to
  Article through Look, reached Saved, and appeared under Articles in the local
  browser with its original body and source link. This is a presentation change,
  not a publish action. Three classification regression tests pass. Compact
  desktop creation controls now wrap instead of clipping New type; verified at
  the browser's normal 792 CSS pixel viewport with both sidebars visible.
