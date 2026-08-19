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
  Mcp-Method, and Mcp-Name headers. 33 tools.

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
- FIXED 2026-08-16: the Mac app never linked, and the cause was the state
  directory. `AppGroupContainer.choose` picked the first candidate that
  EXISTED. The team-prefixed group container survives on disk from an earlier
  install, so it existed, but a Developer ID build is not sandboxed and its
  entitlement names the bare group id, so every write into the team-prefixed
  path was denied. StateStore writes through `try?`, so the denial was silent:
  `saveCredentials` appeared to work, `loadCredentials` returned nil a
  millisecond later, the app never linked, and no File Provider domain was
  ever registered. The window looked healthy throughout because the web view
  carries its own session cookie.
- Existence is now not the test; writability is. `AppGroupContainer.isWritable`
  probes with a real file create, because POSIX permissions on that directory
  say yes and the sandbox still says no. When no candidate is writable the
  resolver returns nil and StateStore keeps state in Application Support,
  which is where the Developer ID build always kept it. Two regression tests
  cover it in StateStoreLocationTests.
- How it was found, for the next silent-failure hunt: an os_log at every branch
  of the link path, streamed live across a relaunch
  (`log stream --predicate 'subsystem == "app.texttext"' --info --debug`). The
  trace read "linked: credentials saved" and then "seed: NO CREDENTIALS" three
  lines later, which named the bug in one screen after a day of reading code
  that all looked correct. `log show` after the fact returned nothing for this
  process; only `log stream` during the run worked.
- Verified after the fix, with no override: credentials persist, the domain
  registers, and `~/Library/CloudStorage/TextText-TextText` exists.
- The mount then did not enumerate, and that turned out to be a SETTING, not
  a bug: `fileproviderctl dump app.texttext.mac.fileprovider` reports
  `domain: t{6}t ... (user-disabled)`. macOS has TextText's File Provider
  switched off, so the system never launches the extension, every
  NSFileCoordinator request fails with FP -2011, and `pkd` is never even asked.
  Nothing the app does can override it; it is the owner's toggle in
  System Settings > General > Login Items & Extensions > File Providers.
- Compare states when diagnosing this, they are distinct and the wording is
  the diagnosis: Synology reads "temporarily disconnected", Write reads
  "extension not found", TextText read "user-disabled".
- The app CANNOT detect this on macOS. `NSFileProviderDomain.userEnabled` is
  `FILEPROVIDER_API_AVAILABILITY_V3_IOS`, iOS only; macOS exposes only
  `isDisconnected` and `isHidden`. An attempt to surface it was written and
  reverted because it does not compile. So a disabled mount is indistinguishable
  from a working one from inside the app, and the only tell is that
  `fileproviderctl dump` line. Worth knowing before anyone spends another day
  on it.
- App Store record 1.0 vs shipped 0.175: submission-time only.

## Workflow and dev loop

- Work on `main` in `~/dev/TextText` (contract of 2026-08-12; no worktrees,
  no merge-gate). A stale pre-commit hook still demands merge-gate; commit
  with `OWNER_OVERRIDE=1`. The hook is a persistent job, not ours to remove.
- Dev loop: use `npm run try`. It starts the local server, opens an isolated Mac
  app against it, and tears both down. `mac/scripts/install-local.sh` replaces
  the owner's canonical `/Applications/TextText.app`; it is a promotion tool,
  not a development preview command.
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
- `release/prepare-testflight-build.sh` is the non-uploading package boundary.
  It builds the Store edition, verifies Apple Distribution signing, arm64 app
  and extensions, App Sandbox, application identifier, team-prefixed app
  group, embedded profile, and absence of Sparkle, then signs a `.pkg` with a
  3rd Party Mac Developer Installer identity. It never uploads, installs, opens
  TestFlight, or changes `/Applications/TextText.app`.
  On 2026-08-19, the real Apple Distribution build completed with all three
  signed arm64 extensions, and the command produced a 3rd Party Mac Developer
  Installer-signed `0.181 (184)` package in an isolated temporary directory.
  Signature verification passed; the proof package was moved to Trash. Nothing
  was uploaded or installed.
- `npm run testflight:build:test` is the fixture contract for that boundary and
  is a required release check. It proves that an unsandboxed app or a zero
  build number cannot become a TestFlight package.
- `npm run eval:native-codex` is the real standalone-channel runtime probe. It
  verifies the signed-in account, a read-only ephemeral thread, isolation from
  inherited MCP servers, one safe dynamic tool call, and the exact response.
  It is deliberately not a release gate because provider availability and
  account usage limits are external. A quota failure remains red and must not
  be described as runtime proof.
- Channel capabilities are intentionally different. The standalone Developer
  ID app can launch the local Codex runtime and includes
  `Contents/Helpers/texttext`. The App Sandbox prevents TestFlight from
  launching `~/.local/bin/codex`, and the Store bundle excludes the CLI. In
  TestFlight, use a provider API key or an external hosted MCP/app connection.
- The hosted MCP endpoint uses manually created `wsk_` workspace bearer tokens.
  TextText has no OAuth authorization server. OAuth-only clients cannot connect,
  and ChatGPT custom MCP availability varies by plan, role, and workspace
  policy. Do not promise a universal one-click ChatGPT connection.

## Finder and CLI verification (2026-08-19)

- The bundled CLI used to turn every File Provider enumeration error into an
  empty list because `DocumentStore.list()` used `try? ... ?? []`. It now fails
  with an actionable unavailable-workspace error. It lists and edits
  `.textpack`, `.textbundle`, `.md`, and `.txt`, and skips the auxiliary `Data`
  tree. An isolated CLI round trip proved list, read, append, lint, and reread
  against a real `.textpack` without touching owner data.
- The GUI does not own `sync.index`; File Provider is the sole sync owner. A
  missing legacy index is a passing transition state. A surviving index must
  still decode or health fails.
- A File Provider status with zero pending errors is not proof that Finder is
  usable. For a linked account, `finder.provider` now passes only after the real
  CloudStorage root enumerates and exposes at least one workspace folder. The
  root-level attachment `Data` directory does not count as a workspace.
- On 2026-08-19 the installed mount existed at
  `~/Library/CloudStorage/TextText-TextText`, but shell enumeration returned
  `Operation not permitted`, and `fileproviderctl dump
  app.texttext.mac.fileprovider` showed the provider and mount xattrs without an
  active `domain:` section. That state is not a successful Finder proof. If it
  persists, the owner must enable TextText in **System Settings > General >
  Login Items & Extensions > File Providers** and reopen TextText. macOS does
  not expose `NSFileProviderDomain.userEnabled` to macOS apps, so code cannot
  toggle or reliably detect this setting.

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

## AI-assisted item types (2026-08-19)

- Home, every folder menu, and the Assistant open one focused item-type
  studio. A prompt or the Editorial publication, Project board, and Quick
  notes starters produces one validated blueprint for both an item page and
  its folder page.
- `item-type-blueprint.ts` is the complete input contract. It compiles fields,
  item layout, collection layout, safe theme tokens, and example content into
  one immutable `TemplateDefinition`. Internal fields are hidden from the
  document editor.
- The UI, in-app assistant tools, and hosted MCP use
  `createItemTypeForWorkspace()` as the single persistence path. Saving can
  set a folder default and can explicitly restyle existing folder items. New
  items inherit the folder type.
- The focused studio prefers the native Codex with ChatGPT connection for
  custom prompts. It registers a preview-only `preview_item_type` dynamic
  tool, validates the returned blueprint, and saves nothing until Done. A
  direct provider API key remains a fallback, not a requirement for this path.
- `npm run eval:item-type` drives the real browser flow through creation,
  inheritance, editing generated properties, board movement, and reuse from
  the Look gallery. `npm run eval:features` checks the documented entry,
  starters, and dual previews.
- `/docs/item-types` is the public guide. A private Notes guide titled "Build
  item types with AI" is provisioned and backfilled with the other AI guides.
- The visual sweep covers 1440, 768, and 375 pixels in light and dark. On
  2026-08-19 every listed surface painted with no horizontal overflow. The
  item-type prompt, item preview, folder preview, controls, and guide were
  also inspected as pixels at desktop, tablet, and phone sizes.
- Real Keychain-backed Anthropic prompts were exercised for Medium-like
  essays, a Notion-like task board with a checklist, and Apple Notes-like
  notes. Provider generation uses validated JSON rather than the provider's
  constrained grammar because the complete blueprint exceeds Anthropic's
  optional-property limit. One bounded repair pass handles invalid model JSON.
- The focused studio keeps a 30-revision local design history with undo, redo,
  branching, version switching, and a before/current comparison. Preview modes
  cover wide, tablet, and phone frames plus sample, real folder, empty, and
  stress content. A deterministic preflight scores the current blueprint and
  blocks Done only for important findings.
- Blueprints can model people and document relations, recurrence, validated
  values, conditional sections, computed facts, and status workflows. Status
  controls expose only the initial state or transitions allowed from the
  current state. People fields store canonical document references and use a
  searchable workspace picker with a manual ID fallback.
- Collections can preserve multiple named views with their own layout,
  filters, grouping, date field, and multi-sort. A compact folder control
  switches views without changing the underlying documents.
- The Look library is a searchable visual catalog with Mine, Workspace, and
  TextText sources, real rendered previews, impact counts, Remix and Save as
  new, validated JSON import, export, immutable versions, and restore-forward.
- Native assistant turns are grounded in the active view, document, and safe
  selected text. Transformation shortcuts expose the same workspace update
  tools as typed instructions; Structure produces a reversible full-body
  proposal rather than editing around the document command surface.
- The final 2026-08-19 gate passed 924 web tests, 456 Swift tests, TypeScript,
  the 42-page production build, the item-type, feature, look, home-layout,
  outbound MCP, collaboration, and real-model sidebar evaluations, plus 36
  inspected light/dark screenshots across 1440, 768, and 375 pixel widths.

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
