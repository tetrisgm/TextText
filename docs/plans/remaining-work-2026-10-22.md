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

October 23 latest: one human-invoked `release/ship-all.sh` run exited 0 at
`d7a06af4` and installed that full commit on Oracle web, Mac 0.203 build 1278,
and Windows. All three passed a real exact-content edit, save, normal close,
and reopen. The installed Mac assistant also staged a feed proposal for review
without applying it. The owner's Mac package pin remained byte-identical.
[Mac/web receipt](../verification/2026-10-23-d7-mac-web-installed.md),
[Windows receipt](../verification/2026-10-23-windows-d7-installed-acceptance.md).
The previous `644deafd` run stopped before delivery on stale generated MCP
documentation; `d7a06af4` corrected the two generated files and passed the
Mac documentation gate. Cross-client sync and Phase 2 targets remain open.

October 23 latest: the human-invoked unified `a868426a` run exited 0 and
delivered that full commit to Oracle web, Mac 0.203 build 1277, and Windows.
Each surface passed one real exact-content edit, save, normal close, and reopen
check. The deployed missing-folder GET returned an empty result without making
a directory. [Mac/web receipt](../verification/2026-10-23-a868-mac-web-installed.md),
[Windows receipt](../verification/2026-10-23-windows-a868-installed-acceptance.md).
Cross-client sync remains blocked by three older invalid empty server folder
names; removal awaits the owner's explicit approval. Phase 2 latency targets
have not passed. The `2b470873` candidate failed pre-delivery test gates, and
the first two `a868426a` attempts stopped at Apple timestamp preflight; the
successful run followed a genuine timestamped desktop probe. None of those
failed attempts delivered a partial release.

October 23 update: `98b5314a` is delivered on all three surfaces with real
exact-content normal reopen checks. The invocation delivered web/Mac but stopped
on Windows PowerShell 5 backup path limits; guarded recovery installed the same
verified Windows candidate. The next release must exercise the permanent backup
fix through the complete unified command. [Mac/web receipt](../verification/2026-10-23-mac-web-installed-acceptance.md),
[Windows receipt](../verification/2026-10-23-windows-98b-installed-acceptance.md).

Status: complete for the unified release step. The October 23 `24104475`
invocation exited successfully and delivered the same full commit to Oracle web,
the canonical Mac app (0.203 build 1276), and the Windows installed app. Real
create/edit/normal-quit/reopen checks passed on each surface; see the [Mac/web
receipt](../verification/2026-10-23-mac-web-241-installed.md) and [Windows
receipt](../verification/2026-10-23-windows-241-installed-launch.md). This establishes Phase 1 delivery, while cross-client sync
and the Phase 2 latency targets remain open.

The sync npm entry now owns the browser-policy producer and
local database setup ([focused Mac checks](../verification/2026-10-22-release-sync-entry.md)).
The combined command is implemented ([checks](../verification/2026-10-22-ship-all-entry.md));
its first invocation passed full release and sync gates at `b05a675e`, then stopped
before delivery when the source changed to include release safety fixes.
The owner pin was restored exactly and no surface was delivered
([first-run receipt](../verification/2026-10-22-unified-release-first-gate.md)).
[Normal-quit checks](../verification/2026-10-22-release-normal-quit.md),
[Windows session fix](../verification/2026-10-22-windows-normal-quit-session.md),
and [backup preservation](../verification/2026-10-22-deploy-backup-preservation.md)
are integrated. A fresh invocation and installed exit checks remain pending. Keep the standalone
Sparkle resolution in git; preserve the owner's Store resolution around releases.

The `b9eb96fb` invocation passed full release and sync gates, then failed packaging
when the build shell ran the installed sandbox-inheriting Codex helper for its
version. No surfaces were delivered; the original owner pin was restored.
The owner explicitly reaffirmed same-commit release first. `84e40a53` fixes
packaging using verified same-bundle version metadata, retaining sandbox settings,
and overlaps Windows candidate building with the Mac checks. A fresh invocation
and all installed exit checks remain required.

The `446784e2` invocation passed Mac release/sync gates and Windows candidate
checks, including desktop smoke, then stopped at Mac signing: the existing login
keychain is locked. No surface was delivered and the owner pin was restored.
The same signing probe subsequently passed from desktop Terminal; use that session
for the human-invoked release. No further owner keychain action is required.
An early signing probe now runs before expensive gates and pins the build identity.
[Signing blocker receipt](../verification/2026-10-23-unified-release-signing-blocker.md).
The owner approved cleanup of this release's temporary Oracle smoke-test data
only; existing content, workspaces, backups and releases are excluded.

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

October 23 latest: installed `d7a06af4` failed the target on its first
uninstrumented launch: workspace still absent at +8.53 s, restored note visible
at +15.45 s. Exact content survived normal quit/reopen and no timeout banner
appeared. This decisive failure stopped repeated timing attempts. The shipped
retained-registry read reuse was insufficient. A production transport harness
found a second redundant `files.list` call for folders already present in the
first response; its one-call correction and regression are in progress, without
claiming it accounts for the full delay. The five-launch installed exit check
remains open. [Receipt](../verification/2026-10-23-windows-d7-installed-acceptance.md).

October 23 later evidence: the installed `a868426a` app passed one exact-content
normal reopen check, without a latency claim. A single sampled launch of the
prior installed build showed duplicate retained-registry reads during bridge
construction and first listing; sampling perturbed timing, so it is diagnostic
only. A focused cache/read-count correction is in progress. The five-launch
installed timing exit check remains open.

October 23 status: checkpoint scheduling/fairness, state reporting, scoped-error,
listing and initial-construction changes are committed as `41959359` and
`317aab3c`. Full PC/Mac native suites, WPF compilation and renderer regressions
pass ([receipt](../verification/2026-10-23-sync-foreground-checkpoints.md)).
Installed `24104475` missed the target on the second measured real launch:
listing first appeared at 4.457 s and the restored note at 6.701 s. Exact
content survived normal quit and reopen, without a timeout banner. Further
launch repetitions stopped after that clear failure. A separate live sync
failure now blocks multiplayer: three trailing-space folders created by a web
metadata GET appear in the server catalog, which both native clients reject
before ordinary item reconciliation. The read-side creation cause is fixed in
`9aeb8f79`; retained folders and native recovery remain open. [Windows launch
receipt](../verification/2026-10-23-windows-241-installed-launch.md), [folder
read correction](../verification/2026-10-23-folder-view-read-only.md).

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

October 23 latest: `d7a06af4` delivers server `add_feed` and stage-only Mac and
Windows native assistant adapters. A real installed Mac proposal reached the
review page and remained unapplied. Canonical asset-add and template
save/version/retire commands are still missing from native assistant tool lists;
the root-only reviewed adapter and retry identity are in progress. No four-entry
point workflow or multiplayer acceptance is claimed yet.

October 23 progress: reviewed file-backed feed commands and durable proposal
staging are committed as `20baf011` (with a line-ending-only follow-up
`1b09e725`). Focused Mac checks and Mac/PC typechecks pass; native assistant
adapters, one batch release, and real four-entry-point acceptance remain open.

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

## Done on October 22 (for context)

Commits, oldest first:
- `67efe404`, `680a8581`: Windows native. Share the profile, folder-case and owner checks across blocked-item and inventory passes. The 1,100-file inventory dropped from 4.7 s to 2.0 s, and the "startup listing timeout" cause is fixed.
- `ca7c5540`: shared editor. A just-created note stays editable until its listing row arrives.
- `aa8f8a1b`: the owner's variable renames in `attachments.ts` and `tabs.test.ts`.
- `fae7a2d8`: retired T21–T27.

Delivered:
- Windows installed and verified with three real first-session cycles plus hosted readback.
- Web deployed as `aa8f8a1b`, with 13 smoke checks passing.
- Oracle cleaned up with approval: 22 old TextText releases, one non-current Algorave release, and a journal vacuum. 27 GB free; every service still active.

Receipts: [Windows](../verification/2026-10-22-windows-first-session-close-blocked-profile.md), [web](../verification/2026-10-22-web-aa8f8a1b-delivered.md).

Not landed:
- a `ProtectedPathDecision` rescan patch: low value, fragile test;
- the Mac rebuild: Phase 1.

## Operational notes learned on October 22

- **October 23 release corrections.** Run `release/ship-all.sh` from the Mac's
  desktop Terminal session: signing succeeds there while SSH's Background
  keychain session remains locked. Inspect logs over SSH. The early signing
  probe retains evidence and pins the actual build identity. Windows stopped
  backups require PowerShell 7 for long-path reparse inspection and use verified
  Node copies. Set Mac `TEXTTEXT_WINDOWS_POWERSHELL7` to the existing PC runtime
  `C:\Users\Shokunin\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe`
  for this fleet; the coordinator passes it explicitly and checks it before
  building. Permanent correction: `702c0968`. Preserve failed partial backups.
- **Windows build privilege.** `windows/scripts/build.ps1` needs the symlink privilege that only an elevated token has. From the PC, run it through the PC's own OpenSSH (`ssh -i ~/.ssh/id_ed25519 Shokunin@127.0.0.1 ...`, which is high integrity), or from the Mac through `ssh pc`. The desktop smoke test still opens its own interactive task.
- **Windows checkout line endings.** Windows Git's system `core.autocrlf=true` breaks hash-pinned node tests. Set `git config core.autocrlf false` in the checkout before building.
- **Driving the real Windows app.** Launch the installed app with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`. Read state and focus fields through CDP (`http://127.0.0.1:9333/json`). Type with real `SendKeys` into the foreground window. Close with `CloseMainWindow`, and time it with `WaitForExit`. For stalls, sample native stacks with `dotnet-stack report -p <pid>` (installed under `%LOCALAPPDATA%\TextTextBuild\tools`, with `DOTNET_ROOT=%LOCALAPPDATA%\TextTextBuild\dotnet`).
- **Reaching the Mac.** Off the home LAN, `ssh -o HostName=10.6.0.3 mac` (WireGuard) may work when `ssh mac` (192.168.1.216) times out. The Mac cannot `git push` over HTTPS non-interactively. Fetch its commits to the PC over SSH and push from there.
- **Web deploy, the sequence that passed.** On the Mac:
  1. stash only `mac/Package.resolved`;
  2. `export TEXTTEXT_MIRROR_POLICY_BUNDLE=$(mktemp -d)` and run `node src/local-vault/__tests__/mirror-policy.browser.mjs`;
  3. run `node scripts/with-local-database.mjs npm run test:sync`;
  4. run `npm run deploy:web -- --skip-tests`, which validates that sync receipt; `npm test` and `test:db` had passed for the same commit;
  5. restore the stash.
- **Mac checkout state.** It may be behind `origin/main`, so run `git pull --ff-only` there first. The owner's `mac/Package.resolved` edit (SHA256 `eea669ec…`) stays uncommitted until Phase 1 decides it.

## Prompt to continue (Codex or Claude)

> Work in the TextText repository on `main` (Mac: `~/dev/TextText`; PC: `%USERPROFILE%\dev\texttext`). Pull first; preserve the owner's uncommitted `mac/Package.resolved`. Read `AGENTS.md`, `docs/HANDOFF.md`, and `docs/plans/remaining-work-2026-10-22.md`, which is the authoritative plan. Tasks T21–T27 of the older checklist are obsolete; do not run or prepare them. Execute the plan in order, starting with Phase 1: one human-invoked release step that builds and installs web, Mac and Windows from the same commit, which also brings the Mac up to `ca7c5540` or later. Then Phase 2 (Windows startup and open responsiveness, with measured targets), then Phases 3–4 in batches, each ending with one release. Follow the plan's "Operational notes learned on October 22" for builds, deploys, and driving the real Windows app. For every change: find the cause from real evidence first, add a focused regression, run the required checks, verify on the real installed app or the live site (open, edit, save, quit normally, reopen with exact content), commit small, push, and add a short receipt under `docs/verification/`. Never hide errors, bypass durability guards, reset journals, or count simulations as installed acceptance. Ask before deleting anything on servers or machines. Stop only when the plan's exit checks pass or an owner decision is required, and update `docs/HANDOFF.md` and the plan's status as you go.
