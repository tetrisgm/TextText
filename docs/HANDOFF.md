# TextText handoff

Read `AGENTS.md` first; it is the contract. This file is the durable working
state: the goal, the scorecard, and the facts that keep future sessions from
relearning. Keep this shape: short sections, bullets, newest decisions win.
Narratives live in `git log`.

## The goal (owner, 2026-08-14)

TextText is a proven agent canvas. An agent connected any way (CLI, hosted
MCP, in-app assistant) can do real document work on par with pen.dev and
paper.design's canvas manipulation and Notion AI's documented capabilities.
Done means each capability exercised against a running build by a real agent
connection and observed in the UI. Green tests do not count; observed
behavior does. Prior sessions' claims (especially Codex-era) are treated as
unverified until exercised. The Notion-look polish continues, but behavior
outranks look, and the owner's Notion screenshots set the bar, not the old
polish ledger.

## Capability scorecard

- [x] Create with substance: agent-created note with body, right folder,
  idempotent replay on the same key. Observed 2026-08-14.
- [x] Complete rewrite under observation: agent replaced an open document's
  entire body; the change appeared live with the agent's presence chip and
  its named cursor at the end of its own text. Observed 2026-08-14.
- [x] Transform: note became a Broadsheet article via set_item_template,
  retitled with excerpt and tags via update_item; rendered look verified in
  the open browser. Observed 2026-08-14.
- [x] Workspace operations: search matches titles and body text;
  append_to_item replayed=true on a same-key retry with exactly one block in
  the body, which is the changelog pattern. Observed 2026-08-14.
- [x] Rules under agency: every agent mutation has an action_audit row typed
  external_agent; a real foreign-workspace item id reads back as not-in-this-
  workspace (fails closed, no existence oracle); comments land attributed to
  the agent. Observed 2026-08-14.
- Both agent papercuts are fixed (2026-08-15) and verified live:
  set_item_template takes template_version optionally and defaults to the
  look's current version, and append_to_item takes `markdown` like its
  siblings while still accepting the original `markdown_fragment`.
- How to run the loop: mint a token (POST /api/link/start, approve in a
  signed-in browser, poll), then drive `/api/mcp` per the transport contract
  in scratchpad agent.py: `_meta` trio in the body plus MCP-Protocol-Version,
  Mcp-Method, and Mcp-Name headers. 34 tools.

## The spec and the removal pass (2026-08-14)

- `docs/SPEC.md` is the owner-ratified constitution: five pillars plus an
  explicit out-of-scope list. Code no pillar justifies gets removed.
- The REMOVE bucket is done, five commits, ~5,900 lines: legacy TipTap
  editor cluster (14 deps), legacy project-gallery reader and its CSS,
  App Store listing draft, merge-accounts and spent repair scripts, the
  entire guest/anonymous/claim machinery (plan tier, tokens, cookies, UI),
  and 27 dead exports. `blogs.edit_token_hash` drops via
  `scripts/migrate-drop-edit-token-hash.mjs` at next release.
- SUSPECT bucket ruled by the owner 2026-08-14: assistant skills, demo
  mode (the seed module and the store's demo branches), `bench/`, and both
  dated docs (deleted, not archived) are all gone.
- The one ruling not carried out as written: the collaboration verifiers
  were not duplicates. My audit read `verify-collaboration-live.ts` and
  `verify-live-collaboration.ts` as one check under two names. They are
  four layers (in-process merge on the release gate, database soak with an
  offline reconnect, two real browsers proving a human SEES a caret, and
  epoch fencing cited from `db/schema.ts`). Renamed to
  `verify-collaboration-{database,browsers,epoch}.ts` instead of deleted;
  all four are listed in `docs/document-types.md`. Say so if you still want
  them cut.
- Postgres is now required. A missing `DATABASE_URL` throws
  `TextText requires DATABASE_URL` from store.ts instead of quietly serving
  fixture content. `scripts/setup-local-db.sh` no longer seeds; the database
  starts empty and signing in provisions the workspace.
- Kept by ruling: the `project` "Media post" item type. It is the
  video-focused blog post (the shape ramine.net publishes), not a legacy
  gallery. Its reader is the DocumentRenderer gallery node.
## The two build pillars (2026-08-15)

- **Outbound MCP is built.** Workspace Settings has Connected MCP servers;
  TextText handshakes, lists tools, stores them, and the connection is saved
  OFF until the owner allows it. Remote tools are namespaced `slug__tool`,
  the URL is SSRF-checked before every connection, descriptions are capped
  and fenced, tokens are encrypted with `lib/secret-box.ts`. Proof:
  `npm run eval:mcp:outbound` drives Settings in Chromium against
  `scripts/mock-mcp-server.mjs` and reads the mock's own log to show the call
  arrived. The mock ships a deliberately hostile tool description; the run
  asserts from the receiving side that no document text was forwarded.
- **Template management is built.** The folder menu has Change look (the
  agent could do this and a person could not). Retiring a look exists for the
  first time, in the UI-facing store and as `retire_document_template`. Proof:
  `npm run eval:folder-look`, both themes.
- **`/docs/mcp` is the reference**, generated from the tool registry so it
  cannot drift: 33+ tools grouped by what they do, eight client setups with
  real commands, a verify step, the outbound direction, and the safety
  boundary. A test fails if a tool name is ever hardcoded there.

## Outbound MCP after the 2026-07-28 revision (2026-08-15)

- The revision retired `initialize`, replaced server-initiated requests with
  Multi Round-Trip Requests (`resultType: "input_required"`), and added
  `ttlMs`/`cacheScope` to list results. Our INBOUND server was already built
  to it: `server/discover` answers, every result carries `resultType`, and
  the cacheable lists carry hints. Verified live, not read off a comment.
- The outbound CLIENT was not, because I wrote it by learning our own
  server's errors rather than from the spec. Three defects, all fixed:
  `input_required` read as an empty success and returned "Done."; the
  retired `initialize` cost a round trip per connection per turn; cache
  hints were ignored so every message re-listed every server.
- OAuth was ruled unnecessary (owner, 2026-08-15). Local servers need no
  auth, and hosted ones mostly issue static tokens. The cost is a worse
  first five minutes and any OAuth-only server being unconnectable.
  Note that DCR is deprecated in favour of CIMD if this is ever revisited.
- Per-call approval was dropped: MRTR is the protocol's own mechanism, so
  bespoke approval UI would have been reinventing it worse.

## Local MCP servers (Mac only, by physics)

- Paper listens on `127.0.0.1:29979`; pen.dev and Figma are the same shape.
  Nothing hosted can reach a person's loopback, and an https page cannot
  either (mixed content), so `LocalMcpBridge.swift` makes the call natively
  and refuses any address that does not RESOLVE to loopback.
- Local tools live on the NATIVE rung only, since that rung executes tools
  in the app on the person's machine. Hosted servers stay on the cloud rung.
- `outbound-protocol.ts` is isomorphic and shared by both clients, so a
  server on somebody's laptop cannot get a laxer parser than a hosted one.
- Local connections take no token, and the form no longer offers the field
  for a loopback address. Storing one would mean handing it to the browser to
  reach Swift, and no token ever reaches a browser. A local server that
  required auth is unsupported, deliberately and visibly rather than by a
  field that silently does nothing.

## Templates simplified to A+B (owner, 2026-08-15)

- The authoring API is GONE: `customize_document_template`,
  `preview_document_template`, `presentation/operations.ts`, two test files
  and two eval scripts, plus most of the system prompt, which had become a
  manual for a vocabulary nobody could use. ~1,400 lines.
- Making a look is now: shape a document, then "Save as look" in its menu, or
  `save_item_as_look` for an agent. A look is a template plus the theme the
  document carries. `saveDocumentAsLook` in store.ts is the one implementation.
- Verified live: `npm run eval:save-as-look` drives the real menu in Chromium,
  names a look, checks the document did not change, and confirms the look is
  in the workspace's templates. The gallery's own rendering is proven by
  `npm run eval:folder-look`.
- Known rough edge: a look saved during a session shows up in the picker on
  the next load, because the gallery reads the pool fetched at page load.
- The catalogue is ten. Cutting it to nine left no look declaring
  `collection.layout: "timeline"`, so a blog could not read as a dated run at
  all once folder looks took over how an index renders. `texttext.timeline`
  restores it (owner ruling 2026-08-16): Article's document, field for field,
  with a timeline index. It sits after the original five, which stay first and
  byte-compatible. `single` was NOT restored, deliberately; `now` still exists
  and still resolves for documents pinned to it.
- `blog.cardStyle` is deleted (owner ruling 2026-08-16), column and all:
  `scripts/migrate-drop-card-style.mjs`. It chose whether published cards
  showed their cover, it was set from the same Blog popover the layout picker
  lived in, and it lost its only UI when that popover went. Card style is a
  property of how a folder index renders, and looks govern those now, so a
  second stored answer on the workspace row was the shape the ruling removed.
  A Covers toggle was built on Home first and deleted before it shipped:
  `WorkspacePostOption` renders no covers, so it would have been a control on
  Home that silently changed the published Blog page. Cards always show the
  cover they have.
- `npm run eval:home-layout` is the live proof, both themes. It needs
  `NEXT_PUBLIC_ROOT_DOMAIN=localhost:3000` on the dev server, because the
  published Blog page is a workspace subdomain.

## The blank landing page, and why it was blank (fixed 2026-08-16)

A signed-out visitor at `/` saw white above the fold, in every browser and in
a production build. The DOM was correct, the layout was correct, the h1
reported opacity 1 and hit-tested as itself, and nothing painted, not even a
background colour set on it by hand.

The cause was one rule in the document engine:

    .tt-document:not(.tt-collection-item):not([data-preview])::before {
      content: ""; position: fixed; inset: 0; z-index: -1;
      background: var(--paper, #fff);
    }

A document that IS the page paints its paper across the window, which is
right for a reader. The landing page embeds a look demo further down, and that
demo threw the same fixed, full-window sheet over everything above it. The
sections after the demo painted because they come later in paint order; the
hero did not. A `position: fixed` div appended at runtime painted on top,
which is what made it look like a compositor fault rather than a stacking one.

The fix is the mechanism the engine already had: an embedded document passes
`preview`. Three of five call sites were not passing it. The rule now carries
the hazard in a comment, because the guard is opt-out and the set of places a
document can be embedded is open-ended.

`npm run sweep` now fails on a surface that comes back blank. It compares the
PNG byte length of a capture against a flat 8x8 of the same page: a surface
with text and rules compresses far worse than a rectangle. That check is the
only thing in this session that would have caught it, and cheap.

Two traps worth keeping:

- `IntersectionObserver({trackVisibility: true})` is not a paint oracle. It
  reported the heading invisible in states where the page painted, and a
  bisect built on it named an innocent rule with total confidence. Pixels, or
  nothing.
- Disabling one stylesheet at a time proves nothing here, because the engine
  CSS is injected by the renderer itself as well as by the page. Removing the
  page-level copy while the renderer kept emitting its own is why the CSS
  looked exonerated for an hour.

## Traps found while building these

- `position: fixed` does not escape an ancestor with `backdrop-filter`. The
  look gallery opened from the sidebar rendered inside a 260px column with
  its card names cut to three letters. Portal to `document.body`.
- A dead-export sweep removed `textTextChangeSequence` from `db/schema.ts`.
  Nothing imported it, and drizzle-kit builds its model from that module's
  exports, so the next `drizzle-kit push` tried to DROP the sequence that
  `posts.revision` defaults from. Schema declarations are load-bearing
  without importers.
- Never truncate a JSON body before parsing it. The outbound client capped
  the raw reply, which turned a large but legitimate `tools/list` into a
  parse error rather than protecting anything.
- A controlled checkbox bound to server state ignores the click for a whole
  round trip and reads as broken. Keep an optimistic override until the
  server answers.

## Open, in priority order

- Finish the scorecard above; each unchecked line is one loop iteration.
- Fixed observation hazards: verify `window.innerWidth` is nonzero before
  trusting any browser measurement (a restarted pane can be 0x0 and serves
  stale compositor frames to screenshots).
- The in-app assistant lane is exercisable without a real key:
  `node scripts/mock-ai-provider.mjs` plus
  `TEXTTEXT_AI_BASE_URL=http://localhost:3999/v1 npm run dev`, then save any
  fake key in workspace settings. Exercised 2026-08-14: greeting, root and
  item-named starters, quick actions, chat round trip with provider
  attribution, and the Rewrite proposal cycle (preview, apply, undo) all
  observed live. Only real-provider quirks remain untested by the mock.
- Feature docs (`/docs/features`) grow only with exercised behavior, and
  `npm run eval:features` now enforces that: it drives the claims the page
  makes and names the ones it cannot drive. It caught /connect still promising
  OAuth after the removal. Add a check when you add a claim.
- `npm run sweep` photographs every surface, both themes, for a design pass.
  It asserts nothing on purpose. It is what found the landing page.
- Installed-app auth verification (sign out, auth sheet round trip) still
  pending.
- Mac round trip 2026-08-16. The app builds, installs, launches, renders
  correctly in BOTH themes, is signed in, opens Home on List (the new
  default), and talks to the dev server. Screenshots taken unattended.
- Screen Recording was NEVER the blocker; the 2026-08-15 note claiming it was
  is wrong. `screencapture -l <window>` returns a window's own backing store,
  and a WKWebView renders its content out of process, so the web view is not
  in it: that is the black rectangle, on a machine with the permission
  granted. `-R` failed separately because the rect was taken from
  CGWindowList without checking it fits the display. Capture the whole screen
  with `screencapture -x` and read that. The display here is 1800x1169 points
  at 2x, so a full capture is 3600x2338.
- Open, and now precisely characterised: THE MAC APP NEVER LINKS. On a Mac
  with no stored credentials the web view mints an app token successfully
  (`POST /api/app/token` returns 200, observed in the dev server log) and the
  native side persists NOTHING. Watched for 24 seconds across a clean quit and
  relaunch: `~/Library/Application Support/TextText/credentials.json` is never
  written, and `find ~/Library -newermt "-10 minutes" -path "*exttext*"`
  returns nothing at all. That is why the File Provider domain is never added
  (`syncFileProviderDomain` returns at its first guard,
  `store.loadCredentials()`), why `~/Library/CloudStorage/TextText-*` is
  absent, and why the bundled `texttext` CLI reports no workspace. The
  window still works because the web view has its own session cookie; the
  NATIVE half of the app has been unlinked this whole time.
- The chain, all of it verified present and correctly named, which is what
  makes the failure interesting: the injected `mintScript`
  (WebAppWindowController:212) runs only when `appToken == nil`, which was the
  case; it posts `{action:"linked", token, origin}` to the handler registered
  as `textTextApp` (:187); the handler (:682) accepts exactly that shape and
  calls `onLinked`; `onLinked` is wired to `handleAppLinked` whenever the
  window is created (AppDelegate:2398); `handleAppLinked` calls
  `store.saveCredentials`. Every link in that chain reads correct, and the
  bytes never land.
- Next step is instrumentation, not more reading: put an os_log at the top of
  the message handler, inside the `linked` guard, and in `handleAppLinked`,
  rebuild, relaunch, and read subsystem `app.texttext`. Note that the app
  currently emits NOTHING to that subsystem in an hour of running, which is
  itself a signal worth keeping.
- Also found: there are two minting paths and only one is live.
  `AppLinkBridge.tsx` posts the same message shape through a server action and
  is the `/connect/app` flow; the injected script posts through
  `POST /api/app/token`. The log shows the injected one ran.
- The workspace menu (the "test's blog" chip that holds Sign out) does not
  open under synthetic clicks, so a sign-out cannot be driven from outside the
  app. Signing out at the state level works instead: quit, move
  `account.json` and `credentials.json` aside, relaunch. Restore them the same
  way, because the app cannot sign itself back in while this bug stands.
- NotchNook owns a 1800x250 window at layer 25 across the top of the screen,
  so computer-use clicks in the top 250px land on it and are refused. Move the
  target window below y=250 first.
- App Store record 1.0 vs shipped 0.175: submission-time only.

## Workflow and dev loop

- Work on `main` in `~/dev/TextText` (contract of 2026-08-12; no worktrees,
  no merge-gate). A stale pre-commit hook still demands merge-gate; commit
  with `OWNER_OVERRIDE=1`. The hook is a persistent job, not ours to remove.
- Dev loop: `npm run dev`; build the Mac app with
  `TEXTTEXT_PRODUCT_ORIGIN=http://localhost:3000` plus the usual bundle id,
  app group, and Sparkle key; install with `mac/scripts/install-local.sh`.
- Dev builds (http origin) are Safari-inspectable and append one layout line
  per load to `$(getconf DARWIN_USER_TEMP_DIR)/texttext-layout.log`. Trust the
  probe over screenshots; computer-use screenshots downscale and lie about
  geometry.
- The Mac webview ignores synthetic automation clicks (hover works, real
  clicks work); drive the same UI in a browser at localhost instead.
- `window.__ttDraftDebug` (dev only) reads the selection draft store; every
  writer in that store fails silent by design.
- HMR resets module-level state (the draft store empties); reload the page
  before concluding anything after editing `workspace-item-draft.ts`.
- Verification tools: `npm run eval:collaboration:browser` drives two people
  and an agent through 24 checks; the release gate runs live workspace
  proofs. Local Postgres only; production Neon never leaves release lanes.
- Releases, deploys, uploads: owner-ask only. TestFlight build numbers burn
  on upload; next is 183+.

## Design: the Notion polish loop

- Loop discipline: name the loudest deltas, fix, screenshot light and dark at
  1400, commit, repeat.
- Rounds landed 2026-08-14:
  - `d90650df` rail state machine is binary; overlay state and hover-peek
    deleted; pin button gone; saved "open" reads as docked.
  - `8aa78c43` centered 1000px content column; quiet search field; sidebar
    boundary is a color not a line; unboxed item icons and create box.
  - `249384da` bare-glyph history arrows and toggles; counts as facts;
    whispering section headings.
  - `4714b447` `--workspace-rail-inset`: the shell publishes how much right
    edge the docked rail owns; ALL fixed chrome adds it to its right offset.
    Any new fixed element must add the inset or it will sit on the rail.
  - `a3065460` + `27666973` connect CTAs as per-path rows (see AI rail).
- Starters and connect rows are soft filled cards (Notion), not hairline
  outlines; scrollbars thin and trackless; toolbar controls surface on hover.
- DESIGN.md rules bind: both themes always, sentence case, no em dashes,
  taste over decoration.

## Assistant and AI rail

- One layout mechanism: pinned = real grid column via `has-assistant-pinned`;
  hidden = module overlay off-canvas, clipped (`overflow: clip` on the
  overlay root; a translated hidden panel otherwise adds one panel-width of
  horizontal scroll to every page).
- Sizing the rail with `!important` is banned; three stacked mechanisms once
  reserved 600px for a 240px rail.
- Connect state lists every path from `AGENT_INTEGRATIONS`: Claude/Codex copy
  one install command, ChatGPT links to its apps page, MCP copies
  `https://texttext.app/api/mcp`, API key is the quiet line. Copy must run
  `execCommand` synchronously inside the click's activation, then fall back
  to the async API; the reverse order spends the activation and goes mute.
- The hosted MCP URL and sibling strings are lowercase on purpose; a
  mixed-case copy of the origin already broke Mac sign-in once
  (case-sensitive host comparison).
- Starters render only with a provider connected; they name the open item,
  clip titles at 48 chars, and map Trash/Shared to their own sets.
- `assistantAgentIdentity()` is the one derivation of which AI is present
  (native connection wins, else cloud provider); it feeds the rail header,
  the bottom-right avatar launcher, and document presence. The inline copies
  it replaced had drifted (API-key AIs never appeared on documents).
- Agent presence is real Yjs awareness for MCP agents and the in-app
  assistant alike (`runWorkspaceToolForSession` -> `agentPresence`,
  actorType "ai", connection name "Assistant").
- The selection pipeline: the editor registers the open item's draft and
  mirrors every selection into `workspace-item-draft` (its "subtitle" maps to
  the store's "excerpt"). The selection toolbar reads that store, never
  `window.getSelection()` (blind to textareas), and refreshes on a 60ms
  settle after mouseup/keyup/selectionchange. It once shipped fully dead with
  a green suite: the store had no writer.
- `/docs/features` documents only exercised behavior, by rule stated on the
  page. `/docs` indexes it.

## Mac app: editions, TestFlight, sign-in

- Distribution model (owner, 2026-08-11): Developer ID + Sparkle is the
  everyday lane; TestFlight for shareable builds; no Store submission.
- One canonical install at `/Applications/TextText.app`, either edition.
  `release/ship.sh` replaces any edition and sweeps numbered duplicates;
  `npm run testflight:prepare` handles the reverse direction before a
  TestFlight install (Apple's installer will not overwrite a Developer ID
  copy; it creates "TextText 2.app").
- Both editions share state in `<app group container>/TextText` via
  `AppGroupContainer`; outside the sandbox the system's `containerURL()`
  answer is a lie (naive path) and is trusted only when
  `APP_SANDBOX_CONTAINER_ID` is set. One-time copy migration, container wins.
  `~/Library/Group Containers` is unreadable from a shell; "0 files" from
  `find` there means nothing.
- Store builds require: `com.apple.application-identifier` +
  team id signed into every bundle whose profile asserts them (90886);
  `LSMinimumSystemVersion` in extension plists (90360); a compiled
  `Assets.car` with `CFBundleIconName` (ITMS-90546, passes local validation
  and fails after upload). Profiles live in gitignored `mac/profiles/`;
  Store builds only work from a checkout that has them.
- Sign-in is an `ASWebAuthenticationSession` sheet against
  `/connect/app/native` (callback scheme hard-coded server-side; the app
  rejects unknown `state`). Device-link (`/connect/link`) remains for CLI and
  headless. Google refuses OAuth in embedded webviews; that is why the sheet
  exists.
- Sign-out is one native operation: web asks the bridge, the app clears
  credentials/index/File Provider state, then clears only the host's Auth.js
  cookies and loads `/signin`. The old split sign-out (web-only or
  native-only) produced the owner-sees-public-empty-blog dead end.
- `getBlogEditAccess` compares `blogs.owner_id` with the session `userId`
  (resolving legacy JWTs through `user_identities`), never provider subjects.
- ASC credentials: login Keychain service `asc` (JSON: `key_id`,
  `issuer_id`); .p8 in `~/.appstoreconnect/private_keys`. TestFlight internal
  group "Internal"; the owner must be enrolled as a tester like anyone else.

## Public URLs (live since 0.175)

- Shape: `<handle>.texttext.app/<folder path>/<slug>` on a sessionless public
  origin; the proxy strips Cookie/Authorization and preflights locations so
  drafts, private items, dead tombstones, missing paths, and unknown hosts
  all return byte-identical constant 404s.
- Private work stays on the root origin (`/@writer/...`), which keeps auth,
  editing, shares, collaboration.
- `posts.folder_id` is required; live uniqueness is `(folder_id, slug)`;
  `public_url_tombstones` + DB triggers reserve every public path across
  rename/move/unpublish/trash/merge/delete; a tombstone redirects only while
  its target is still public; advisory locks serialize path checks.
- One eligibility rule everywhere: public visibility AND published status AND
  article-like type. Feeds, sitemap, OG, JSON, robots, sync canonicals all
  emit workspace origins and enforce it.
- Legacy flat `/t/` and `/@` links redirect through frozen tombstones only
  for pre-migration items.
- Public footer links to the platform (report) must be absolute; relative
  links get rewritten as tenant content.
- Owner constraint: a content leak torpedoes the app. Leak tests live with
  the migration; keep them green.

## Data and canonical documents

- One schema-v1 `DocumentSnapshot` is the content model; store.ts is the only
  access point; visibility fails closed; every mutation audits.
- Search/list projections (title/body columns) are derived from the snapshot;
  the invariant lives with the canonical-documents work (2026-08-10).
- Account deletion: CLOSE (atomic) then PURGE (resumable); tombstones fence
  resurrection; audit rows are anonymized, never deleted.
- Account merge tooling was removed 2026-08-14 (spec: superseded by
  `user_identities` provider linking; recoverable in git history).
- Starter guides seed at provisioning (`starterAgentGuideValues`);
  `backfillWorkspaceAgentGuides()` retrofits older workspaces; both are
  idempotent per `(folder_id, slug)`.

## Resolved episodes (one line each, dates in git log)

- Apple consent screen "write app": appleid.apple.com caches its own copy;
  only a portal Save syncs it.
- Sparkle stays: it serves the Developer ID lane; TestFlight serves sharing.
- `runtimeServerDeploymentId: false` in next.config.ts prevents the E970
  all-routes-500 outage; do not remove.
- Looks are named Article/Note/Bookmark/Gallery/Talk/Checklist/Project/
  Newsletter; a test fails on competitor names.
- 56-agent visual critique and the 24-check collaboration proof exist as
  repeatable verification lanes.
