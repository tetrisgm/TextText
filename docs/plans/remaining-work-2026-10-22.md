# TextText remaining work plan

Written October 22, 2026, after the owner's scope change. T21–T27 (the six-client runner and matrix, endurance, performance, account switching, and final delivery and changelog closure) are obsolete. This plan replaces the open rows of the [finish checklist](shared-app-finish-checklist.md) for current work. Older plans remain history.

## Goal

Mac, Windows and web behave as one application: the same editor, look and workflows, the same version everywhere, and reliable open, edit, save, quit and reopen. Work is finite. Each phase has an exit check run against real installed clients, not simulations.

## Current state (verified October 22)

| Surface | Version | State |
| --- | --- | --- |
| Web (Oracle) | `aa8f8a1b` | Delivered; 13 authenticated smoke checks pass. [Receipt](../verification/2026-10-22-web-aa8f8a1b-delivered.md) |
| Windows | `ca7c5540` content (installed candidate `0c0c29a8…`) | Three real first-session save, close and reopen cycles pass, with exact hosted readback. [Receipt](../verification/2026-10-22-windows-first-session-close-blocked-profile.md) |
| Mac | `56d144f7` (0.204, build 1274) | Missing `ca7c5540` (new notes editable during slow listing) and later native changes |

All three already share one editor: the `src/local-vault` React app, served by the web, embedded in WKWebView on the Mac and in WebView2 on Windows. They differ only in the native file, sync and window layer: Swift on the Mac, C# on Windows.

## Phase 1: one release step for all three surfaces (start here)

Problem: each surface ships on its own schedule, so versions drift.

Work:
1. Add `release/ship-all.sh` on the Mac. It is human-invoked and is not a job or hook. From one clean commit it runs:
   - web: the existing `deploy:web`, with its full gates;
   - Mac: `mac/scripts/build-store.sh`, then `install-local.sh`, with a fresh build number and the existing stopped backup;
   - Windows: `ssh pc` to `build.ps1` through the PC's elevated OpenSSH session, then `install.ps1`.

   It refuses to run unless all three can be built from the same commit. It prints the per-surface identities.
2. Fold the lessons from October 22 into the scripts, not into people's memory:
   - export `TEXTTEXT_MIRROR_POLICY_BUNDLE` from its real producer before `test:sync`;
   - run `test:sync` through `scripts/with-local-database.mjs`;
   - make Windows checkouts require `core.autocrlf=false`;
   - before an Oracle deploy, check that free space covers the backup budget and floor, and fail early with a clear message.
3. Handle the owner's uncommitted `mac/Package.resolved` by script, not by hand. Today `test-sync.sh` already preserves it. Decide once whether the standalone pin (with Sparkle) or the store pin (without Sparkle) belongs in git. The current committed file keeps Sparkle; the working copy omits it.

Exit: one invocation brings web, Mac and Windows to the same commit. Each surface then passes one real check: create a note, type, quit normally, reopen, and see the exact content. The Mac then includes `ca7c5540`.

Effort: about 1 day. Mac build time dominates.

## Phase 2: Windows startup and open responsiveness

Problem: on a real 1,100-note workspace, launch can still show "The connection is taking longer than expected". A restored note can show "Opening document…" for tens of seconds while `SyncEngine.SyncAsync` runs 10 or more full workspace scans per pass and holds the store. Per-file costs are fixed (`67efe404`, `680a8581`); the number of scans is not.

Targets on that real workspace, release build, measured with timestamps on the installed app (five launches each):
- workspace listing visible in under 3 s;
- restored note editable in under 3 s;
- no bootstrap timeout notice on a normal launch.

Work, in order, stopping when the targets pass:
1. Let bridge reads that do not need the full sync pass (`list`, `read`, `collaborationConfig`) be served between sync scans instead of queuing behind the whole pass. Hold the store per scan, not per pass. Check whether this is already true, and where reads actually wait, using stack samples (`dotnet-stack`, as on October 22).
2. Reuse one scan inside a single synchronous decision where provably no await or lock release intervenes. A prepared candidate patch is not landed: `ProtectedPathDecision`, which saves about 1 of roughly 11 scans per pass. Keep every recheck that guards against interleaved edits.
3. Cache the inventory scan by directory generation, which the registry already does for its own index. A pass then rescans only when files changed.
4. Check whether the Mac has the same scan pattern. Fix it in the same pass if so.

Exit: the targets pass on the installed Windows app, the Core suite passes, and a focused scan-count regression passes.

Effort: 2–4 days.

## Phase 3: application parity flows (T19)

Use the 24 flow rows of the [application parity matrix](../verification/application-parity-matrix.md):
- home and all files
- List and Cards
- folders and move
- folder presentation and defaults
- note card
- article and blog
- bookmark
- gallery
- talk
- feeds
- template picker
- save as template, version and retire
- shared editor and presence
- navigation, close and quit
- search and Command-K
- backlinks
- account and workspace chooser
- settings and providers
- sign-out and retained work
- share and permissions
- publish and public reading
- comments
- assistant and folder agents
- CLI and hosted MCP

For each flow on each surface (web in a browser, installed Mac, installed Windows), in light and dark:
1. Drive it through the real UI. On Windows, use WebView2 remote debugging plus real keystrokes, as on October 22. On the web, use the browser. On the Mac, use the installed app, plus WKWebView inspection where needed.
2. Record pass, fail, or an intentional capability difference, for example native file pickers or OS menus, with one line of evidence.
3. Fix failures in the shared editor first. Fix in native code only when the cause is native. Add a focused regression for each fix.

Batch the work by area, so each batch ends with one release (Phase 1 step):
- A: navigation, list, folders, search
- B: the five templates and feeds
- C: comments, share, publish, presence
- D: settings, account, sign-out
- E: assistant, CLI, MCP

Exit: the matrix has a real result for every row on all three surfaces, and no unexplained failures.

Effort: 1–2 weeks, depending on the failures found.

## Phase 4: templates and agent workflows (T20)

For article, note, bookmark, gallery, talk and feeds:
- create, place in a folder, edit the body, metadata and assets;
- preview and apply a template, save as a template, version it, and retire it.

Run each through four entry points: the UI, the built-in assistant, the local `texttext` CLI, and hosted MCP. Check:
- permission refusal for a viewer;
- an `action_audit` entry for every mutation;
- an idempotent retry after a lost response, with no duplicate;
- human-readable proposals and results.

Exit: each entry point creates and edits valid content and templates with correct permissions, audit and retry behavior.

Effort: 3–5 days. It overlaps Phase 3 batches B and E.

## Phase 5: held items (owner decisions)

1. Two retained rename and conflict items, `5749b5ac` and `926668f8`. Their content is preserved, and their local and server paths disagree. Resolve them through the product's own recovery UI with the owner present. No filesystem workarounds.
2. PC SSH persistence across a reboot. One owner-scheduled reboot, then confirm `ssh pc` and the Edge/WebView2 mitigation still work.
3. Optional cleanup, with the owner's approval of exact paths:
   - several hundred historical `~/dev/texttext-*` work folders on the PC;
   - old `TextText-previous-*` app copies on the PC;
   - the remaining Oracle releases from Oct 17 and 18, once the current release has been stable for a week.

## Phase 6 (decision): consolidate the native file and sync layer

Only if TextText stays in active development. Move the sync queue, journals, recovery, rename and conflict logic from the duplicated Swift and C# code into one shared TypeScript engine running in the embedded editor. The shared mirror-policy host already does this for the decision rules. Native code would keep only atomic file writes and fsync, file watching, credential storage, and window and quit handling.

Do it one subsystem at a time:
1. folder listing and inventory;
2. outbox and upload;
3. pull and apply;
4. recovery journals;
5. rename and conflict.

For each subsystem, run the old and new implementations side by side and compare their decisions on real workspaces before switching. Use the existing cross-platform conformance tests as the safety net.

Exit, per subsystem: identical decisions on the conformance suite and on a copy of the owner's real workspace, then the native copy is removed.

Effort: several weeks. Decide after Phase 3.

## Order and parallelism

- Phase 1 first. It also delivers the Mac update.
- Phase 2 (Windows-only) can run in parallel with Phase 3 batch A on the web and Mac.
- Phases 3 and 4 run in batches; each batch ends with one Phase 1 release.
- Phase 5 items happen whenever the owner is available.
- Phase 6 is a later decision.
