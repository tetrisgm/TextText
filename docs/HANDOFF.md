# TextText handoff

Read `AGENTS.md` first; it is the contract. This file is the durable working
state: a summary, the open list, and the facts that keep future sessions from
relearning. Keep this shape: short sections, bullets, newest decisions win.
Full narratives live in `git log`; commit messages carry the reasoning.

## Summary (2026-08-14)

- Web is deployed through the 0.175 release plus dev-lane commits since; the
  Mac app runs as a single Developer ID install at `/Applications/TextText.app`
  (0.175 build 182), with TestFlight as the shareable lane and no App Store
  submission planned.
- Public URLs are live: `<handle>.texttext.app/<folder>/<slug>` on a
  sessionless origin, per-folder slugs, tombstone redirects, constant-404
  fail-closed everywhere.
- The AI rail is the one home for AI: binary open/closed, avatar launcher
  bottom right, greeting plus context starters when a provider is connected,
  and a per-path connect state (Claude, Codex, ChatGPT, MCP, API key) with
  in-place copy actions.
- New workspaces seed the two AI guide notes (owner decision 2026-08-14,
  reversing 2026-08-08 empty-by-default).
- The Notion polish loop is standing: rounds land small, verified by
  screenshot in both themes, ledger below.
- Owner directives in force: loop until the app looks and feels like Notion;
  document every feature only after exercising it; a content leak is fatal.

## Open, in priority order

- Polish loop next rounds: fixed chrome should adopt the scheme of a
  pinned-appearance page it floats over (dark chips on a light page);
  rail connect-block vertical rhythm; Library composer weight; typography
  rhythm against Notion's 14px UI.
- The dev workspace has no AI provider key, so greeting starters, selection
  actions end to end, proposals, and AI presence during runs remain
  unexercised and undocumented. One key unblocks all of it.
- Feature docs (`/docs/features`) cover only what has been exercised; extend
  as verification proceeds (publishing flow detail, File Provider, Spotlight,
  share extension, MCP workflows).
- Installed-app auth verification: sign out, auth sheet round trip, and a
  post-release health review were still pending after 0.175 installed.
- From the 2026-08-12 session, still open: `blog-folder-feed` hardcodes the
  stock Article feed instead of `article.collection`; no UI writer for a
  folder's look (`set_folder_template` is assistant/MCP-only); template
  gallery shows duplicate cards after a second `customize` with no retire
  affordance; `set-collection-layout` lacks `index`/`timeline`/`single`
  readers; eight visual-critique findings (Checklist/Bookmark polish,
  Project orphan checkmarks).
- App Store record still says 1.0 PREPARE_FOR_SUBMISSION, app ships 0.175;
  only matters if a Store submission ever happens.

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
  `saveBookmarkCapture` once wrote projections without the document - the
  repair script and invariant live with the canonical-documents work
  (2026-08-10).
- Account deletion: CLOSE (atomic) then PURGE (resumable); tombstones fence
  resurrection; audit rows are anonymized, never deleted.
- Merging accounts: `scripts/merge-accounts.ts` reports by default; folder
  path and live slug collisions handled; synthetic `merged:` tombstone so a
  live subject is not fenced.
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
