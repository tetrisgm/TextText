# Session handoff — 2026-08-11

For the next agent picking up TextText. Read `AGENTS.md` (root) and
`docs/HANDOFF.md` first; they are the standing contract and the accumulated
facts. This file is the narrative of one long session: what shipped, what is
verified versus merely tested, the open bugs with their real causes, and the
mistakes that cost hours so you do not repeat them.

Everything below landed on `main` through `merge-gate --cmd` (the Linux lane is
down, see Workflow). Commits are cited so you can read the full reasoning in
`git log`; the commit messages carry more detail than this summary.

---

## 1. Where the product stands

- **Web**: deployed to production (Vercel, texttext.app) through `bc477fad`.
  The two commits after it (`5a1182c2`, `e8ccfab8`) are docs-only.
- **Mac, TestFlight edition**: build **0.174 (181)** is VALID in App Store
  Connect, distributed to the internal group, and installed on this Mac at
  `/Applications/TextText.app` (single copy, MAS receipt, signature verifies).
- **Mac, Developer ID edition**: unchanged today except scripts; last shipped
  0.174 via Sparkle.
- **App Store submission**: NOT submitted. TestFlight only, by owner decision.
  The version record says `1.0` / PREPARE_FOR_SUBMISSION while the app ships
  `0.174`; Apple requires these to match at submission time only. Owner has
  not chosen which way to align them.

## 2. What shipped today, by topic

### TestFlight pipeline (`40a01471`, `58fa6cd2`, `2367e231`, `908b0d83`)

Three Store-only requirements the notarized path never needed, each found as a
rejection:

1. **90886**: every bundle whose embedded provisioning profile asserts an
   application identifier must carry the same identifier in its signature.
   Team-prefixed, so it cannot be checked in; `mac/scripts/build-app.sh`
   injects it for the app, `mac/scripts/embed-extensions.sh` for each
   extension, from the team resolved out of the signing identity.
2. **90360**: extensions need `LSMinimumSystemVersion` too. Copied from the
   container app so they cannot drift.
3. **ITMS-90546**: the Store reads the icon from a compiled `Assets.car` via
   `CFBundleIconName`; a loose `AppIcon.icns` is not enough. The catalog in
   `mac/Assets.xcassets` is generated from the existing icns (one source);
   `actool` compiles it at build time. **This error passes local validation
   and only appears by email after upload.** `altool --validate-app` saying
   "VERIFY SUCCEEDED" is necessary, not sufficient — build 178 passed
   validation and then failed.

Build numbers are burned forever once uploaded: 178 (failed, no asset
catalog), 179, 180 (superseded, missing the container fix), 181 (current).
Next upload must be **182+**. `mac/Info.plist` `CFBundleVersion` is at 181.

Credentials for `altool`/`asc`: login Keychain, service `asc`, a JSON blob
with `key_id` and `issuer_id`; the .p8 lives in
`~/.appstoreconnect/private_keys/`. `asc auth status` does not expose the
issuer id. TestFlight: internal group "Internal"
(`6a650855-e0a5-460d-9836-0bae5cbc87c1`), tester ramine@ramine.net. The
account holder still has to be enrolled as a tester and redeem the invite —
being ACCOUNT_HOLDER grants nothing in the TestFlight app.

### One installed copy (`98ad0d7a`)

The App Store installer refuses to overwrite an app it does not own, so
installing the TestFlight build beside a Developer ID build produced
`TextText 2.app` — two bundles claiming `app.texttext.mac`, the same app
group, and the same File Provider domain. `release/ship.sh` now removes any
numbered `TextText <n>.app` sibling carrying our bundle id after it installs.
The reverse direction cannot be fixed from our side: if a Developer ID build
has shipped since the last TestFlight install, `rm -rf
/Applications/TextText.app` before pressing Install in TestFlight, or a
numbered copy appears again.

**Owner rule (memory + hard feedback): our Mac apps run from `/Applications`
only. Never launch or install from `mac/build/` or any scratch path.** I
launched from `mac/build/` to test and the app's own move-to-Applications
prompt tried to remove the installed copy — a scary permission dialog on the
owner's desktop. To test a real build, install it properly first.

### State unification across editions (`82338180`, `7c4b54d1`)

The two editions are the same app from two channels but kept state in
different places (Developer ID: `~/Library/Application Support/TextText`;
Store: sandbox-redirected copy of that path). Switching editions signed you
out with an empty library. State now lives in `<app group container>/TextText`
via `mac/Sources/TextText/AppGroupContainer.swift`, with a one-time
copy-forward (container always wins; legacy left intact for rollback).

The second commit matters: **outside the sandbox,
`containerURL(forSecurityApplicationGroupIdentifier:)` consults nothing and
returns a naive `<home>/Library/Group Containers/<group id>`**. That directory
exists (empty leftover) on this machine, so trusting it re-split the editions
into different folders. The system answer is trusted only when
`APP_SANDBOX_CONTAINER_ID` is set; otherwise candidates decide, team-prefixed
(`52WM463HR2.group.app.texttext`) first.

**Verification status: UNVERIFIED on real hardware.** Tests pass, but the
terminal cannot read `~/Library/Group Containers` — macOS denies it and
`find` returns empty as if the directory were empty. I reported "0 files" as
fact twice before realizing. Do not trust shell reads there; verify through
the app's behavior (sign in, relaunch, switch editions) instead.

The sandboxed edition cannot read the legacy directory, so the Store build
needs one manual sign-in the first time; after that the editions share bytes.

### Native sign-in sheet (`93f679ce`)

The Sign In button used to run the device-link flow: external browser, "link
this Mac to your account?" consent page. That flow is RFC 8628, built for
TVs; on a Mac the app and browser are the same device and the question is
meaningless. The deeper reason it existed: **Google refuses OAuth inside
embedded web views** (`disallowed_useragent`) and Apple restricts it.

The replacement is `ASWebAuthenticationSession` — a system sheet, not an
embedded view, so all providers work and Safari's session usually makes it
one tap:

- Server: `src/app/connect/app/native/route.ts`. Callback scheme
  **hard-coded** to `texttext-app://auth` — the route must never read a
  redirect target from the request; that line is the security boundary.
  Validates `state` shape before touching the database; signed-out visitors
  round-trip through `/signin`; does the same first-touch work as the typed
  approval (`resolveOwnedWorkspace`, `getUserIdBySub`, audit row); creates an
  already-approved `deviceLinks` row. No new storage, no new token path: the
  app claims through the existing `/api/link/poll`, which mints exactly once.
- Mac: `mac/Sources/TextText/AuthSessionController.swift`. Generates `state`,
  rejects any callback whose state it did not issue or whose scheme is not
  ours. Wired to the Sign In button in `AppDelegate`; `LinkController` and
  `/connect/link` remain for the CLI and headless agents, where a device code
  is the right answer.
- Tests: 7 server (redirect steering, state validation, signed-out mints
  nothing, audit), 7 Mac (callback checks, state entropy/URL-safety).

**Verification status: the route is verified against production
(400 without state, 303 to /signin with one, `redirect_uri` ignored). The
sheet itself has NEVER RUN.** It only reproduces from a signed-out state.
Verifying it means: owner present, sign out in the Mac app (build 181 has the
code), press Sign In, watch the sheet, complete auth, confirm the token lands
and state is written to the group container. This is the top verification
gap. Note the sign-out attempt itself hit the navigation bug below.

### AI rail — the Notion-style goal (owner directive)

Owner goal: working with AI in TextText should feel like Notion AI — a rail
that is open most of the time, context-aware, with AI at the point of
writing. Five pieces, all landed and deployed:

1. `bb6aaebd` + **`bc477fad`** — rail opens **pinned** by default on windows
   ≥1100px, reflowing the document column. The second commit fixes a bug I
   shipped in the first and caught only by opening the app: the migration
   derived pinned/hidden from the window width and **persisted** it. The Mac
   app opens a narrow window, so the first read recorded "hidden" forever and
   maximizing could not recover. A window size is a fact, not a decision:
   the width-derived default is now recomputed every read and never stored;
   only explicit pin/hide choices persist. Migration key is at v5.
   **Every test passed with the bug in place** — none persisted a state and
   re-read it on a wider window. Screenshots caught it, tests did not.
2. `8aa92914` + `f6ee9f98` — empty state: greeting on the reader's clock
   ("Good afternoon, Ramine") plus three starters that **name the open item**
   ("Sharpen my writing on <title>"), from
   `src/components/workspace/assistant/starters.ts`. Context comes from the
   composer's existing chip (`starterContextFromChip`) so the two can never
   disagree. Trash/Shared map to their own starter sets. Title clip is 48
   chars (34-char real titles were being cut mid-word at 32).
3. Composer placeholder is now "Do anything with AI"; the context chip above
   it already existed.
4. `9bce832e` — **New chat** in the rail header clears the transcript for the
   current context (sessionStorage copy included), hidden when there is
   nothing to clear. Transcripts are keyed per context; before this the only
   way to reset was to navigate away and back.
5. `5418c8f2` — `SelectionActions.tsx`: select text while editing and
   rewrite / summarize / excerpt float above the selection. **It owns no AI
   logic** — same quick actions the rail runs, same selection it reads,
   results arrive as proposals with accept/undo. Title/tags stay in the rail
   (whole-item actions). Geometry (`anchorFor`) and trivial-selection guards
   are unit-tested; taking focus is prevented so the selection survives.

Verified by screenshot on this Mac: rail docked, chip reads "Ramine's blog ·
Workspace", root starters correct.

**Known gap, small, unfixed:** when no AI provider is connected the rail
correctly leads with "Connect an AI provider" but still renders the starters,
which would fail if clicked. Disable or hide them without a provider. (The
owner's workspace currently has NO provider connected, so end-to-end starter
→ AI response has also never been exercised.)

## 3. Open bugs, with their actual causes

### The owner is served the stranger's view of their own blog (top bug)

`src/app/t/[handle]/page.tsx:560` renders the visitor empty state
("Nothing published…") only when `!canEdit`. The owner saw it twice — so
`canEdit` resolves false for the signed-in owner on `/t/[handle]` inside the
Mac app's web view. **The session is not recognized on the public route.**
Every earlier fix (pointing sign-out at `/signin`) treated symptoms; the dead
end came back through another door. Start at `access.canEdit` (~line 387) and
check whether the session cookie is sent on `/t/` requests from the web view.

Note the failure direction is *closed* — the owner sees less than they are
entitled to, never more. If the URL migration adopts the sessionless public
origin (below), this behavior becomes the design and the fix moves to the app.

### The Mac app strands the owner on the public page

Clicking the workspace title in the Mac app navigates the web view to the
public blog page. Combined with the bug above, an owner with nothing
published sees what looks like an emptied account, with no way back that
reads as "back". Fix in the app regardless of how the canEdit bug resolves.

## 4. Decided but not started: the URL migration

Owner decisions, recorded in `docs/HANDOFF.md` (commits `5a1182c2`,
`e8ccfab8` — read both sections in full before touching routes):

- Every item gets an automatic, readable link: **folder in the path, then
  slug**. `/t/` expresses neither and dies.
- Namespace is the **workspace** (multi-person), never the username.
- Preferred shape: `<workspace>.texttext.app/<folder>/<slug>` (Notion Sites
  style). Acceptable fallback: `texttext.app/<workspace>/<folder>/<slug>`.
- **Slugs unique per folder** (decided). Schema change: `posts_blog_slug_idx`
  is per-blog today.
- **Owner rates a content leak as fatal to the product.** Six security
  invariants are recorded in HANDOFF and are requirements: one generic 404
  for everything the viewer may not see (no enumeration oracle); publishing
  is the only act that exposes a folder name; tombstone redirects die the
  moment their target stops being public; every side channel (sitemap, RSS,
  search, OG, pool payload) filters with the page's own rule; prefer a
  **sessionless public origin** if subdomains (no cookies read at all — the
  private/public boundary becomes an origin boundary); leak tests land in the
  same commit as the migration.

Sequencing the owner accepted: canEdit bug first (same fault line as cookie
handling), then the migration as one deliberate piece — routes, schema,
redirects, canonicals, sitemap, and `release/app-store-listing.md` which
cites current URLs.

## 5. Workflow facts you will hit immediately

- **Canonical `~/dev/TextText` stays clean on `main`.** Work in a worktree
  (`git -C ~/dev/TextText worktree add ~/dev/TextText--<name> -b <branch>
  origin/main`), push early, land with `merge-gate`.
- **The PC Linux lane is DOWN** (since Aug 8; WSL has no networking in either
  mode; do NOT re-diagnose, do NOT touch `.wslconfig` or run
  `wsl --shutdown` — shared machine, owner-approved repair only, and the
  owner explicitly deferred it). Land with:
  `merge-gate --cmd 'npm ci && npx tsc --noEmit && npm test'`
  (add `&& (cd mac && swift test)` when Mac code changed) — verifies on the
  Mac; say so in summaries.
- **Web deploy** (owner said deploys on ask; today's asks covered them):
  source `release/secrets.sh`, `require_release_secret DATABASE_URL` and
  `BLOB_READ_WRITE_TOKEN`, then via `scripts/work-unit.ts`:
  `node scripts/sync-vercel-runtime-env.mjs`, `npx vercel build --prod
  --yes`, `npx vercel deploy --prebuilt --prod --yes`. Never `vercel --prod`
  directly (it can become a Git deployment and skip the release marker).
- **Store build**: `mac/scripts/build-store.sh` only works in canonical —
  provisioning profiles live in gitignored `mac/profiles/` and a worktree
  silently skips extension embedding. Package with `productbuild --component
  mac/build/TextText.app /Applications --sign "3rd Party Mac Developer
  Installer: …"`, upload with `xcrun altool --upload-app`.
- **Sign-in setup is never an ask** (stack `6eb6de2`,
  `~/dev/stack/runbooks/oauth-for-a-new-project.md`): find credentials by
  shape, drive consoles via the Claude-in-Chrome extension (signed in),
  verify by probing the provider, never ask the owner to click through a
  console. Only a logged-out console goes back to the owner.
- `next.config.ts` has `runtimeServerDeploymentId: false` — do not remove; it
  prevents the E970 all-routes-500 outage.
- Dev DB is local Postgres, never production Neon (see AGENTS.md).

## 6. Gotchas that cost real time (do not relearn these)

- `~/Library/Group Containers` is unreadable from the shell; `find` returns
  empty with no error. Any "the container is empty" conclusion from a
  terminal is void.
- Those two empty probe containers (`group.app.texttext.probe`,
  `group.app.texttextprobe`) cannot be `rm`'d (containermanagerd);
  harmless — leave them.
- App Store dialogs do not appear in allowlist-filtered screenshots. An
  invisible "Close This App to Update" dialog sat on the owner's screen while
  I reported the update complete. Also: that dialog can go stale — the update
  had finished and Continue was a no-op.
- `altool` validation passing means little for Store acceptance (ITMS-90546
  arrives by email post-upload).
- A transient `SSL certificate problem: self signed certificate` appeared
  mid-merge-gate; the push had actually succeeded. Verify against
  `git log origin/main`, retry, never touch `sslVerify`.
- Verify outcomes, not mechanisms: the rail bug shipped green through the
  whole test suite and was caught in one screenshot. When a change is
  user-visible, look at it.

## 7. Verification ledger

| Item | Status |
| --- | --- |
| TestFlight 181 installed, single copy, receipt + signature | Verified on this Mac |
| Auth route on production (signed-out paths, redirect hard-coding) | Verified against texttext.app |
| **Auth sheet round trip (sign out → sheet → sign in)** | **NEVER RUN — top gap; needs owner present** |
| **Edition state unification on real hardware** | **Unverified (shell cannot read the container)** |
| AI rail pinned + greeting + starters render | Verified by screenshot |
| Starter → AI response end-to-end | Never run (no provider connected in owner workspace) |
| Selection toolbar in a real editor session | Unit-tested; not exercised by hand |
| App Store version record | Verified: `1.0` PREPARE_FOR_SUBMISSION vs app `0.174`; blocks submission only |

## 8. Suggested order of work

1. **canEdit/ownership bug** on `/t/[handle]` — root-cause, don't patch
   symptoms; decide jointly with the sessionless-public-origin question.
2. **Verify the auth sheet** with the owner present (sign out in the Mac app,
   run the sheet, confirm token + container state). Fix the title-click
   stranding while in there.
3. **Disable starters when no provider is connected**; then connect a
   provider and exercise a starter and the selection toolbar end-to-end.
4. **URL migration** per the recorded invariants — one deliberate piece with
   the leak tests in the same commit.
5. At submission time only: align the `1.0` version record with the shipped
   version.
6. Deferred by owner: Linux lane repair.
