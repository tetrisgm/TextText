# Write: Codex continuation handoff (2026-07-17)

You (Codex, `gpt-5.6-sol`) are taking over an autonomous build effort on **Write**
(Apple-grade multi-tenant blogging + notes platform: Next.js App Router web at
write.ramine.net on Vercel/Neon/Blob, plus a native macOS app in `mac/` with a
File Provider extension and Sparkle auto-update). Work on `main` in `~/dev/write`.
Read `AGENTS.md`, `CLAUDE.md`, and `DESIGN.md` first. NO em dashes anywhere.

## Current release state (as of this handoff)
- Last CLEAN public release: **0.93** (write.ramine.net serves 0.93/98).
- **0.94 is shipping now** via the autobuild daemon (features below). It reconciles
  to 0.94/build 100. If for any reason it did not finish, the daemon retries; a
  clean `main` whose HEAD subject is not `Release Write ...` means there is
  unshipped work and the daemon will build it.
- Nothing public is broken. An earlier partial 0.94 attempt only left an orphaned
  local `/Applications/Write.app` at 0.94/99 and unused versioned blobs.

## DONE (committed on main; do not redo)
1. **Three core features** (commit `6c398ce`), Codex-built + adversarially reviewed:
   - **Tags**: first-class cross-folder `posts.tags[]` (GIN index), `#`-autocomplete
     chips, tag view, public `/tags/[tag]` archives, AI retag via set_item_metadata
     + MCP. Migration `scripts/migrate-add-tags.mjs` **already applied to prod Neon**
     and wired into `release/ship.sh`. Notes/bookmarks stay unlisted
     (getPostsForTag applies publicPostTypePredicate unconditionally). Frontmatter
     round-trips byte-for-byte (no sync churn; empty tags omit the key).
   - **Note links + backlinks**: `[[slug|label]]` wikilink Tiptap atom, `[[`
     suggestion menu, server-side backlink graph from FULL bodies, "Linked from"
     panel. Public reader FAILS CLOSED: a link to a private/draft/missing target
     renders as plain text, never an href or metadata. Backlinks are owner-only.
     Reuse `src/lib/wikilinks.ts extractWikiLinks` + the existing resolver; do NOT
     write a second parser.
   - **Mac quick capture**: Carbon global hotkey (Cmd-Shift-Space, no Accessibility
     prompt), floating HUD panel, menu-bar "New note", durable offline outbox,
     files into the Notes folder via the sync API only (never writes the FP mount).
2. **Three ship-pipeline fixes** (the pipeline was wedged; all fixed):
   - `9161179` raised vitest `testTimeout`/`hookTimeout` to 30s (the native-tool
     parity test spawns a Node subprocess and false-failed under parallel load).
   - `10f152a` ship gate now tolerates a transient installed-health `warning`
     (finder.provider = FP mount still registering post-install), blocks only on
     `fail`.
   - `407d06f` build number is now `max(source, installed) + 1` so a ship that
     installed build N then failed can't deadlock retries at the same build.

## PENDING WORK, in priority order

### 1. MCP revision (docs + implementation) -> `docs/codex/mcp-brief.md`
Make the MCP integration as simple/thorough/well-crafted as paper.design/docs/mcp.
Consolidate ~31 tools to 26 (clean read/write split, consistent envelopes),
surface tags + wikilinks in read/update, rewrite `src/app/docs/ai/page.tsx` into
Paper's structure (per-client connect blocks, verifying, troubleshooting, guides,
tools table) for our HOSTED OAuth model. Full spec + hard constraints in the brief.
- RELEASE GATE: `python3 scripts/test-oauth-mcp-loop.py` must pass. It hits a LIVE
  server at http://localhost:3000, so run it against `npm run dev` (Codex sandbox
  cannot bind ports; the maintainer/you-with-network runs it). Do NOT use
  Response.redirect() in the OAuth approve route.

### 2. Superhuman UI batch (18 items + 3 Mac hardening) -> `docs/codex/ui-batch-brief.md`
Workspace nav/focus/sidebar/home/action-bar + Mac menu-bar. Grounded to exact
file anchors in the brief (activeRegion focus model, Cmd+number nav, 42-cell
calendar bug, star-on-left, marquee text-select, right-sidebar re-pin migration,
Mac toggle-window + paste-clipboard, and 3 LOW quick-capture hardening findings
folded into Group 6).

### 3. Autobuild supersession (design below) -> `release/autobuild.sh`
Owner rule: only ever build the LATEST HEAD. If a build did not finish (failed or
newer commits landed while building), CANCEL it and build the latest. No catching
up on superseded work. Batch this infra commit with a feature ship (a script-only
change should not trigger a standalone Mac+web build).

## How to run Codex (fast mode)
```
codex exec -C ~/dev/write -s workspace-write -c 'mcp_servers={}' \
  -m gpt-5.6-sol -c model_reasoning_effort="high" -c service_tier=priority \
  --skip-git-repo-check < docs/codex/mcp-brief.md
```
- `service_tier=priority` IS "fast mode" (there is no `--fast` flag). Owner prefers
  `high` + priority, not `xhigh`, for build work.
- The sandbox mounts `.git` READ-ONLY: Codex CANNOT `git commit` (index.lock
  EPERM). Leave changes uncommitted; the integrator commits. Codex may exit 144
  after finishing if it tries to bind a dev-server port; that is not a failure.
- Verify each unit: `npx tsc --noEmit`, `npm test`, `npm run build`; for Mac,
  `cd mac && swift build && swift test`.

## The autobuild pipeline (how shipping works)
- `release/autobuild.sh` (launchd `net.writeapp.write.autobuild`) watches git:
  if HEAD subject is not `Release Write ...` and the tree is clean, it debounces
  45s then runs `release/ship.sh <ver>`, and on success commits `Release Write
  <ver>` + pushes. Log: `release/.autobuild.log`.
- `release/ship.sh` does the full pipeline: migrations -> npm test -> build ->
  swift build/test -> notarize -> publish blobs -> `vercel --prod` -> verify
  public release -> install to /Applications -> verify installed health.
- Restart the daemon after editing autobuild.sh:
  `launchctl bootout gui/$(id -u)/net.writeapp.write.autobuild` then
  `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/net.writeapp.write.autobuild.plist`.

## Discipline that keeps ships green
- ONE writer at a time on the working tree. The daemon's clean-tree gate means a
  Codex run (dirty tree) blocks a ship; that is fine (serializes automatically).
- Keep the machine relatively quiet during a ship's `npm test` phase; heavy
  concurrent load can slow tests (30s timeout now absorbs this).
- After committing a unit, let the ship COMPLETE before launching the next Codex
  run. Do NOT sit and babysit each ship - commit + push, the daemon owns the rest.

## Autobuild supersession - design to implement (item 3)
In `release/autobuild.sh`, replace the synchronous `./release/ship.sh "$ver"` call:
- Run it in the background (`... & ship_pid=$!`). While it runs, poll `git rev-parse
  HEAD`; if it advances past the SHA being shipped (`stable`), recursively kill the
  ship process tree (it spawns swift/xcodebuild/notarytool/vercel) and `continue`
  the loop to rebuild the new HEAD.
- Recursive kill helper: for each `pgrep -P $pid`, recurse, then `kill -TERM`.
- On ship failure: only `sleep $FAIL_BACKOFF` if HEAD is UNCHANGED (broken commit).
  If HEAD moved, log and `continue` immediately (build latest, no backoff).
- Killing mid-publish is safe: ship.sh publishes idempotently; the latest build
  re-publishes the coherent final state.
- Adversarially check: don't orphan grandchild processes; don't kill the wrong pid;
  ensure `restore_bump` still runs on abandon so the tree stays clean.
