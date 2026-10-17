# TextText completion checklist for the implementation agent

Prepared October 17, 2026. This is an execution plan, not a claim that work passed.

## Start here

Read [HANDOFF](../HANDOFF.md), this checklist, and the current task's references. The [master plan](shared-app-durability-execution.md) defines scope; the [playbook](shared-app-executor.md) defines architectural constraints. This checklist supplies the task order and completion evidence. If historical status conflicts, inspect current code/artifacts and record the correction. Do not repeat a fixed reproduction merely because an older paragraph says it is pending.

Paste into the next agent:

> Finish `/Users/shokunin/dev/TextText/docs/plans/shared-app-finish-checklist.md` in order on main. Read current AGENTS.md and HANDOFF first. Start with T01 and execute one task at a time. For each task, inspect existing implementation and tests, implement only the missing behavior, run relevant checks, commit named files, push verified work, and record evidence and the next exact action. Continue all ready work without asking again for authorized local installs or Oracle deployment. Preserve user content and unrelated edits. Never count simulated clients as physical acceptance, bypass close guards, reset journals, or claim an unrun gate passed. A missing account or unavailable machine blocks only its dependent tasks. Public Mac distribution and OpenAI account sign-in are excluded. Use the latest installed identities, not October 12 assumptions. Stop only on completion, an explicit user pause, or a dependency that prevents all useful work.

### Known baseline, to be rechecked

- HEAD at planning time: `f246a1f1`; it only removes retired references. Save fix `e61d2622` is committed and tested but has no recorded installed/deployed receipt.
- Recorded Mac: 0.204 build 1260. Recorded Windows: `candidate-25e161b899b84b3182631c25e2ac5f44`, source `6f55e0f5`. Both contain the local-file close fix. Existing-note reopen and normal close passed; new-item installed edit/reopen remains open.
- Source checks for `e61d2622`: 92 focused tests, 407 shared-client tests, TypeScript, Mac native suite. Preserve these receipts; rerun only as required by changed source/build verification.
- Windows SSH failure was account lockout from WebView2 bad-password attempts. A machine policy prevented the reproduced launch-triggered failures. Reboot and overnight persistence remain unverified.
- Runs 171–174 failed. Run 176 passed one concurrent round. Neither establishes complete reliability.
- Unrelated dirty paths: `mac/Package.resolved`, `src/components/workspace/assistant/attachments.ts`, `src/lib/workspace/__tests__/tabs.test.ts`, `mac/scripts/__pycache__/`, `scripts/.probe-editor.ts`. Coordinate ownership before touching them. Do not stage them with this work.

### Execution and evidence rules

Use main; no worktrees. Pull before editing. If a dirty path overlaps a task, coordinate with its worker or work on another task. A pristine committed archive is acceptable for building without unrelated edits, as in the existing Mac receipt; it is not another development checkout.

One expensive build or physical campaign at a time. Keep task changes small enough to review. Do not start architecture changes while diagnosing a new installed regression. After two failed fixes of the same reproduction, capture/reduce the ordering before another code change.

Read fleet-work and its fleet-map pointer before machine work; browser-verification before browser interaction; DATABASE-OPERATIONS before database/build-secret work; DESIGN before visual edits; relevant installed Next guides before Next code. Use the existing SSH profile/key. No new account/key/tunnel, no GitHub Actions, no public release. This plan needs no persistent build/install job. Do not use a reboot as a surprise debugging step: first confirm no unsaved work or active jobs and coordinate interruption with the owner.

For each task, create or extend a short receipt in `docs/verification/` with: task/master IDs; source commit and artifact identity; invariant; exact reproduction/check commands; exit codes; expected/actual result; redacted evidence location; remaining uncertainty; rollback/recovery; next exact action. Keep secrets, complete user documents, browser profiles, and raw journals out of git. Temporary evidence must have a durable redacted summary before it is relied on.

Mark a task done only when its exit checks pass. Use `blocked: <specific missing input>` when necessary; continue independent tasks. An expected rejection passes only if content survives and the correct error is asserted. A timeout, missing actor, skipped check, or absent receipt is not a pass. Update the ledger at the bottom after every task; update master checkboxes only for fully covered IDs.

## Milestone 1: deliver the existing fix and close the immediate regression

### T01 — Refresh source, artifacts, and work ownership

Maps: P0.1, P8.1. Depends: none.

1. Run `git status --short`, `git log -8 --oneline`, `git log origin/main..HEAD --oneline`, then `git pull --ff-only`. Record overlapping active work without changing it.
2. Read the installed Mac plist/signature and Windows executable/candidate seal. Read Oracle's current deployment metadata through the existing documented connection. Record packaged shared-UI fingerprint separately from version labels and private test actors.
3. Check which historical receipt directories still exist. Preserve redacted summaries, not user payloads. Do not manufacture missing historical traces.
4. Write one identity table: source, Mac app, Windows app, Oracle, browser assets, private actors, rollback. Flag each mismatch and which tests it invalidates.

Exit: current identities and dirty-file ownership are known; no old candidate is silently counted as current. Next: T02.

### T02 — Verify the SSH workaround remains effective

Maps: prerequisite for Windows gates. Depends: T01; may proceed alongside independent local work sequentially.

Read [account-lockout receipt](../verification/2026-10-11-windows-account-lockout.md), fleet references, recent backups/config mtimes, and running work before any configuration change.

1. Read the existing WebView2 policy, runtime version, sshd service state, and OpenSSH/Admin plus Security 4625/4740 events since the last verified period. Filter by the failing account/process; unrelated event counts are not proof of recurrence.
2. Confirm new WebView2 processes receive the existing feature-disable argument. Use the existing smoke workflow to create at least 18 fresh environments, then recheck matching failures and existing SSH access. Do not weaken lockout policy or clear logs.
3. If failures recur, preserve timestamps, process/runtime identity and token errors, then diagnose before editing config. A successful single SSH command is not the exit criterion.
4. Verify after the next coordinated Windows reboot. Collect a later event window spanning at least one overnight period with normal app use. Record OS boot time and policy/process evidence. If no reboot/overnight window is available, leave this portion pending and continue app work.

Exit: launch-triggered regression absent, reboot persistence demonstrated, later observation clean of the identified failure signature. Keep the workaround described as a workaround. Next: T03; T02's long observation can remain pending.

### T03 — Build and install the existing source fix

Maps: interim P8.1–P8.3; does not complete final delivery. Depends: T01, working Windows access.

Read the [Mac receipt](../verification/2026-10-12-mac-local-install.md), [Windows receipt](../verification/2026-10-11-native-local-file-receipt.md), scripts below, and [Oracle operations](../../release/oracle/README.md). Inspect script parameters before execution.

1. Select one coherent commit containing `e61d2622`. Verify the source tree/fingerprint for all candidates. Use isolated build output and local PostgreSQL; exclude unrelated uncommitted work.
2. Mac: use `mac/scripts/build-store.sh` or the documented existing local build shape, then `mac/scripts/install-local.sh`. Choose a fresh build number after inspecting installed/build metadata. Preserve native Apple authentication, extensions, and rollback. The prior local build lacks release attestation; do not label its overall runtime health as passing or bypass newly failing health checks without diagnosis.
3. Windows: run `windows/scripts/build.ps1`, which tests and seals but does not install. Install its actual sealed output with `windows/scripts/install.ps1 -Candidate <absolute-candidate-directory>`. Close the real app normally before install. Record installed seal and rollback directory.
4. Oracle: check backup validity, deployment identity and active work; run the existing web-only path `npm run deploy:web` after reading `release/ship.sh` and its required checks. Verify deployed identity, health and authenticated smoke. Preserve unrelated services. No public Mac distribution.
5. Check installed/served fingerprints and authenticated browser asset identity against candidate inputs. A successful build alone is insufficient.

Exit: existing fix delivered on all three surfaces, or exact platform blocker recorded. Next: T04. If installation fails, preserve logs and use documented rollback only if compatible with current persisted formats; never reset content to recover an app binary.

### T04 — Installed ordinary-use and close regression

Maps: P0.4–P0.5, P2.4, interim P8.4. Depends: corresponding T03 platform.

On actual installed Mac and Windows apps and deployed web, use uniquely named disposable fixtures in the existing authorized workspace. Record fixture IDs; do not modify existing personal notes for fault tests.

1. Open home, create a note, type distinct title/body, navigate away/back, close normally, relaunch, and verify exact content from an independent read. Repeat local offline edit/close/reopen/reconnect.
2. On Windows test home close with no editor, duplicate file activation while opening, repeated activation after completion, activation after navigating away, close during activation, and close while remote traffic continues.
3. Inject storage rejection only through a controlled fixture/test adapter. Assert the guard refuses close, preserves recoverable content, and reports a useful reason. Restore storage and verify save/close/reopen succeeds.
4. Exercise installed Windows UI in its interactive desktop session; an SSH session's zero window handle is not an app regression. Private acceptance actors supplement, but do not replace, installed executable checks.
5. Retain exact failure ordering and native refusal reason if any dialog recurs. Do not remove the guard or increase timeouts to make it disappear.

Exit: real new-item edit/save/close/reopen succeeds on each surface, including offline durability. Update product changelog with the required skill after delivery. This is the first safe pause milestone, not completion of the full plan.

### T05 — Finish the historical close-failure diagnosis

Maps: P0.2–P0.5, P2.4. Depends: T01; independent of T02 observation.

Read [lifecycle audit](../verification/document-lifecycle-audit.md), `MainWindow.Activation.cs`, `RendererFlushGuard.cs`, `MainWindowCloseTests.cs`, and `TextText.LiveAcceptance/Stress.cs` under `windows/`.

1. Compare available 171–176 traces. Distinguish activation's earlier rejection from the later close request. The known run174 trace does not prove the original checkpoint refusal reason.
2. Map operation origin, request ID, workspace/item/lifecycle, captured/persisted generation, hook invocation, and native refusal. Add missing metadata-only diagnostics.
3. Use controlled scheduling to reproduce duplicate activation, stale completion, and close during activation; retain existing regressions rather than rewriting them.
4. Correct audit statements using observed evidence. If old failure cannot be reproduced, record exactly which reason remains unknowable and the targeted regression/diagnostic coverage that now exists.

Exit: each historical failure is explained or has a bounded documented diagnostic gap. The latter allows implementation to proceed, but remains visible in final acceptance; one passing rerun does not erase it.

## Milestone 2: one truthful durability and lifecycle contract

### T06 — Complete adapter conformance

Maps: P1.1–P1.4, P5.1–P5.3. Depends: T01. Existing browser false-success and synchronous IDB exception fixes are already implemented.

Read [durability ordering](../verification/collaboration-durability-ordering.md), `src/sync/engine/client.ts`, `src/local-vault/collaboration-client.test.ts`, and navigation-flush implementation/tests. Inventory current coverage before adding tests.

Create a table with browser, Mac checkpoint, Windows checkpoint columns. For each adapter exercise: empty/restored state; successful commit; synchronous request exception; transaction abort; quota/disk failure; unavailable file; invalid/future journal; blocked migration; cancellation; stale lifecycle/lease; failed replacement; restart replay; failure followed by recovery.

Each case asserts returned outcome, acknowledged generation, durable bytes, retained pending work, and whether upload was allowed. Use the production adapter, not a separate model. Native checkpoint success despite browser-copy failure and native rejection despite successful browser-copy write need distinct assertions. Never equate a clean queue with persistence.

Exit: all applicable cells have tests/receipts; not-applicable cells explain the platform boundary. Commands: focused client tests, `npm run test:sync:client`, TypeScript; Mac tests and Windows suites for changed native adapters.

### T07 — Close and navigation generation barriers

Maps: P2.3–P2.4, P5.3. Depends: T06.

1. Capture accepted local generation G when close/navigation starts. Continuous remote updates must not move this barrier.
2. Schedule local input immediately before capture, during persistence, and after its completion but before release. Either extend the captured barrier for accepted new input or fence input before final release; document the chosen existing-compatible behavior.
3. Assert no accepted edit is lost, no stale lifecycle result releases another document, close remains possible offline, and storage failure retains ownership/content.
4. Cover account change/sign-out with pending work: no old-account replay under new credentials. Keep recovery accessible to its authorized owner.

Exit: deterministic timing tests and native boundary tests pass; product dialogs describe action rather than internal result JSON.

### T08 — Move session ownership out of the editor

Maps: P2.1–P2.2, P2.6. Depends: T06–T07.

Read `src/sync/client.ts`, `src/sync/engine/client.ts`, `CollaborativeVaultEditor.tsx`, `VaultApp.tsx`, and [runtime decision](../verification/shared-runtime-decision.md). Search for existing coordinator/lease abstractions first.

1. Define acquire/release handles keyed by account, workspace, item and lifecycle. Document states opening/ready/reconnecting/draining/closed/retained-error and transitions before editing callers.
2. Move persistence, CRDT, transport and subscriptions into the shared owner. Views only acquire/release; repeated release is harmless; one view cannot destroy a session still held by another.
3. Fence late open/checkpoint/network completions, serialize transitions, and preserve error-held work. Test two views, cancelled open, rapid A→B→A, and release during remote delivery.
4. Migrate callers in one vertical slice at a time. Search for remaining old production call sites before deleting replaced lifecycle paths.

Exit: a view unmount cannot discard accepted work; coordinator outlives the view until safe release; one authoritative writer per lease.

### T09 — Multiple tabs/processes and editor continuity

Maps: P2.2, P2.5, P5.3. Depends: T08.

1. Inspect existing browser locks and native leases. Specify crash takeover/expiry using current mechanisms; a JS singleton is not cross-process ownership.
2. Test competing same-document tabs/windows, killed owner, takeover, and late stale-owner writes. Test account/workspace separation.
3. Preserve editor instance, selection, scroll, valid undo history and IME composition through reconnect, background refresh and file reconciliation. Test composing text while remote edits arrive.
4. Verify real WKWebView, WebView2 and browser behavior; check listeners, subscriptions and sessions after repeated opens/releases.

Exit: stale owners cannot write, takeover restores durable work, ordinary reconnect does not remount the editor, and resources return to their settled bounds.

## Milestone 3: shared behavior and correct external files

### T10 — Complete feature inventory and policy migration design

Maps: P3.1–P3.2, P3.6. Depends: inventory can begin after T01; implementation depends on T08.

Expand [parity matrix](../verification/application-parity-matrix.md) to one row per flow: home/List/Cards, folders, each template's creation/editing, search, settings/logout, comments/sharing/presence, agents, import/export, attachments, extensions, offline startup and updates. Each row needs UI entry point, shared command owner, adapter, legacy path, test, physical receipt and intentional difference.

Retain the existing runtime decision: shared active-document TypeScript runtime, native background mirror while no editor exists, no new daemon/runtime. Resolve how portable background policy executes in each current host before migrating it; merely copying JS policy back into Swift/C# is not consolidation. If the existing host cannot run a proposed slice while the UI is absent, record a bounded architecture decision and compatibility plan before implementation.

Exit: complete feature/owner map and implementable host plan; unresolved host limitations remain explicit.

### T11 — Consolidate native policy one slice at a time

Maps: P3.3, P3.6. Depends: T06, T08, T10.

Inspect `mac/Sources/TextTextFileProviderKit/LocalVaultSync.swift`, `windows/TextText.Core/SyncEngine.cs`, shared reconciliation and durable queues.

1. Extract pure reconciliation decisions first; run identical serialized input/output fixtures through both adapters and the shared owner.
2. Then migrate retry/outbox scheduling; verify persisted operation identity, retry bounds, offline restart and authentication failure classification.
3. Then migrate lifecycle policy; test background mirror with no editor and handoff to an active collaboration lease.
4. Remove an old writer only after its replacement passes conformance and restart. Never enable both writers for the same content. Record remaining native OS primitives and enforce dependency boundaries with existing boundary tests.

Exit: portable policy has one authoritative implementation; both adapters pass the same behavior fixtures; background sync remains functional.

### T12 — Stable external reads and compare-and-swap materialization

Maps: P4.1–P4.3. Depends: T06, T08, relevant T11 slice.

Use shared `src/sync/engine/reconcile.ts`, `pack-reconcile.ts`, native file stores and existing external-checkpoint race tests.

1. Persist document identity, baseline, current fingerprint and pending intent through existing journals. Read/validate stable external bytes, derive changes against baseline, merge into Yjs, commit merged intent, replace projection only if the observed external version still matches, then advance baseline.
2. Schedule another external write between every step. Retry from fresh bytes without losing already accepted operations.
3. Cover in-place and atomic rename-over saves, repeated watcher events, own writes, rapid writes, text.md-only edits, malformed ZIP then repair, and separate metadata/assets.

Exit: no silent overwrites or echo operations; invalid temporary bytes preserve the prior durable state; retries are finite and persistent failures retain recoverable content.

### T13 — Identity, folders, deletion and stale writers

Maps: P4.4, P5.3. Depends: T12.

Write expected outcomes first for move, case-only rename, copied pack with duplicate ID, path collision, folder move, delete, restore, and stale upload after restore. Use existing `folder-move-*.test.ts` and native epoch/retirement tests.

Test each with an active editor, pending offline operation, and restart. Account for Windows path constraints. Stable identity survives moves; copied identity follows the documented policy; retired lifecycles cannot resurrect deleted content. Verify listings and open editor selection.

Exit: deterministic identity behavior and retained pending work across all cases; no arbitrary winner selected by path enumeration.

### T14 — Text and binary conflict recovery

Maps: P4.6. Depends: T12–T13.

For text/fields, assert baseline-aware merge semantics for overlapping replacements/deletions. If external snapshot intent is ambiguous, preserve alternatives durably and provide an understandable choice. Do not introduce another CRDT or whole-file last-writer-wins.

For binaries, test two distinct replacements of the same entry and changes to different entries while all editors stay open. Same-entry conflicts must preserve both byte hashes/provenance through restart and allow selecting/exporting a retained version. Different-entry changes merge. Compare decompressed entry content, never ZIP container hashes.

Exit: both conflict alternatives recoverable, selection results valid, no silent asset loss. Follow DESIGN and check light/dark for any recovery UI.

### T15 — Provider behavior and derived views

Maps: P4.5, P4.7, P7.5. Depends: T12–T14.

1. Verify credentials, leases, caches and recovery journals live outside synchronized content folders.
2. On disposable real iCloud fixtures, exercise eviction/download, temporarily unavailable bytes, duplicate arrival from iCloud and TextText transport, and reconnect. Provider unavailability is not deletion. If eviction cannot be safely induced, leave that physical gate unverified.
3. Test search results, backlinks, thumbnails and file lists after text/metadata/asset change, move/delete/restore, and direct filesystem write. Assert one logical invalidation after commit and no idle echo writes.

Exit: real provider evidence plus correct derived views; unsupported provider/power-loss guarantees remain stated.

## Milestone 4: restart, compatibility and product workflows

### T16 — Crash-boundary matrix and server replay

Maps: P1.5, P5.1–P5.3. Depends: affected contracts from T06–T15.

Inventory existing `sync/recovery.test.ts`, `sync/compatibility.test.ts`, native recovery tests, server transaction tests before adding gaps. Read DATABASE-OPERATIONS and use local PostgreSQL.

For each boundary, interrupt immediately before and after: journal commit, intent write, TextPack replace, checkpoint/baseline advance, outbox commit, server file/database commit, audit receipt, ACK delivery, session release. Kill/reconstruct from disk; do not reuse in-memory state. Assert every acknowledged generation/operation remains recoverable, a lost ACK replays the same operation once, changed bytes with reused operation ID reject, and stale epochs cannot overwrite restored state. Test database outage between file receipt and audit completion.

Exit: every boundary has a named test and expected recovered state. Distinguish process-crash proof from untested machine power-loss guarantees.

### T17 — Persisted upgrades and rollback compatibility

Maps: P5.5, P8.2. Depends: T16.

Inventory each persisted format/version, old reader/writer, new reader/writer and migration. Test retained pending edits, interruption at each migration write, supported mixed versions, future-version refusal, and restart after aborted migration. Preserve old durable bytes until replacement validates. Never repair unknown format by clearing it.

Record whether the prior app can read candidate-written state. If not, define forward recovery without rolling back data. Exercise the supported upgrade path with fixture journals on both native platforms and browser storage.

Exit: compatibility table and runnable migration/recovery fixtures; rollback instructions match data compatibility.

### T18 — Seeded failure scheduling and verification integration

Maps: P5.4, P5.6. Depends: T16–T17.

Add missing clock/storage/delivery barriers through production interfaces. Generate seeded operation/fault schedules, track accepted/durable/server-committed operations, and validate schema, recovery and allowed convergence. Preserve seed and schedule for replay; reduce discovered failures into focused regressions.

Add relevant suites to existing manually invoked verification. Ensure source fingerprints invalidate affected receipts. Do not restore retired gate infrastructure. Verify the runner itself rejects missing actors, wrong rounds, duplicate evidence and failed processes.

Exit: deterministic replay and accurate failure reporting; no simulated result promoted to physical evidence.

### T19 — Complete shared UI and platform parity

Maps: P3.4, P3.6, P8.4. Depends: T09–T11; can precede unrelated provider work.

Execute every T10 row on Mac, Windows and web using shared commands. Fix missing/duplicate behavior in the shared owner. Check home routes without deleting public reader routes, persisted List/Cards, folders, search, account/settings/logout, comments, sharing, presence, import/export and attachments. Check keyboard shortcuts, narrow windows, light/dark, and accessible recovery messages. Preserve native Apple sign-in and Mac extensions.

Exit: every row has a passing fixture/physical receipt or a justified capability difference. Code presence is not feature verification.

### T20 — Templates and real agent workflows

Maps: P3.5, P8.4. Depends: T19 and shared command ownership.

Read AI sidebar architecture, DESIGN and current validated schemas. For article/note/bookmark/gallery/talk and existing feed workflows, exercise creation, folder placement, body/metadata/assets, preview/apply, save-as-template, version and retirement. Use the picker; no user-facing Templates folder or new Tasks feature.

Run through UI, built-in assistant, local CLI and hosted MCP where applicable. Verify permission checks, audit entries and idempotent retry, including a retry after committed response loss. Show human-readable proposals/results. Attribute agent presence to authenticated actors only; ordinary filesystem edits have no invented identity.

Use existing product reference decisions (Bookmarks/Shiori, Gallery/Resurf, Blog/Medium, Notes/Supernotes, feeds/Artifact, Command-K/Superhuman) to identify concrete remaining workflow gaps in the parity matrix, not to begin an unrelated redesign.

Exit: each required real entry point creates/edits valid content and templates with correct permissions; full workflows pass on supported clients.

## Milestone 5: prove the complete application and deliver

### T21 — Extend and attest the physical runner

Maps: P6.1, P6.6. Depends: relevant focused regressions pass.

Read [stress README](../../sync/stress/README.md) and [six-client contract](../verification/six-client-sync-acceptance.md). Use existing adapters and current config schema. Old `/private/tmp` configs are examples, not current evidence.

Inventory supported scenario flags; implement missing scenarios before running them, with runner tests. Create fresh fixture IDs/session directories. Attest six roles: Mac app/browser/direct-file writer and Windows app/browser/direct-file writer. Direct-file actors use ordinary filesystem operations. Record machine, source, bundle and fixture identity, browser version and real/simulated mode. No missing actor fallback.

Run one concurrent readiness round, then a separate-process durable reopen using the prior final semantic hash and exact asset hashes. Record editor sessions/reloads, baseline preservation, expected operation set and stable convergence samples.

Exit: six current physical actors and independent reopen pass. Passing this does not cover unsupported scenario types.

### T22 — Physical correctness matrix

Maps: P6.2–P6.4, P6.6. Depends: T21 plus each scenario's focused tests.

Run separate recorded cases for:

1. Same-position and overlapping text replacements/deletions, Unicode, multi-field edits, undo/redo and sustained typing.
2. External in-place/atomic save, malformed-then-repaired pack, rapid writes, whole-pack creation/replacement, same-entry and different-entry binary races.
3. File/folder moves, case-only names, duplicate IDs, delete/restore and stale writers.
4. Rotate offline, lost ACK, kill/restart and close-during-traffic across supported roles while others continue. Unaffected editor instances must remain mounted.

Every case needs all six actors live, exact accepted-operation accounting, semantic equality, exact recoverable asset bytes, and independent durable reopen. Account for allowed CRDT ordering rather than demanding one arbitrary text order. Stop on first correctness failure; preserve it, reduce/fix it, rerun the affected case with a new receipt linked to the failure.

Exit: every category has an attested pass; unexplained recovery dialogs or manual repair fail the case.

### T23 — Two-account authorization and revocation

Maps: P6.5, P5.3. Depends: T21, two existing authorized accounts.

Obtain the owner's second existing account identity/session when available. Do not create one or bypass authentication. If absent, record this exact dependency and continue T24/T25 where independent.

Exercise read-only, grant edit, concurrent edits from distinct accounts, revoke while offline/pending, reconnect, re-grant, and sign-out/account switch. Assert revoked writes never reach shared state, retained local work stays recoverable to its owner, read-only cannot mutate through UI/CLI/MCP, audit/presence identity is accurate, and re-grant resumes through current authorization/lifecycle rules. Use disposable shared fixtures and owner-authorized grants.

Exit: real distinct-account receipts on supported clients. Same-account tabs and mocked permissions do not satisfy this gate.

### T24 — Finite endurance campaign

Maps: P6.7, P7.4. Depends: T22 and relevant local regressions.

Run at least 100 seeded concurrent rounds, then a bounded 60-minute soak on a stable recorded source/candidate set. Include the proven scenario mix rather than append-only traffic. Configure finite actor timeouts, output limits and cleanup ownership before start. Record seed/schedule, operation accounting, queue/listener counts, memory after warmup/settle, idle requests and idle mutation count. Follow with independent durable reopen.

Stop on the first correctness failure; a later clean rerun cannot erase it. Only kill runner-owned processes; do not kill the owner's apps to tidy a run. No infinite watcher or repeated build loop.

Exit: full completed campaigns with zero lost/duplicated operations, zero idle content mutations, bounded resources and no unexplained recovery. Failed/interrupted runs remain failures.

### T25 — Release-mode performance acceptance

Maps: P7.1–P7.5. Depends: representative final implementation; baseline may be collected earlier.

Measure installed release-mode Mac/Windows and deployed web with documented hardware/network, small/large dataset, sample counts, p50/p95/p99/max: cold/warm launch, cached open, typing, remote visibility, external-file reflection, search, durable close, reconnect and assets.

Targets from master: typing p95 <50 ms; remote text p95 <500 ms; stable small external write locally reflected p95 <1 s; cached workspace usable p95 <2 s; normal durable close p95 <1 s. Set reconnect/asset budgets from measured baseline before optimizing; do not invent passing thresholds afterward. Record idle manifest request rate and an explicit finite bound; verify no persistent growth in listeners/queues/documents. Preserve existing search baseline and test invalidation.

Exit: recorded distributions meet targets; any shortfall remains open and owner-visible. Fix only measured hot paths and repeat affected checks.

### T26 — Final coherent candidate, upgrade and installed acceptance

Maps: P8.1–P8.4. Depends: implementation and T22–T25; unresolved T23 remains a final blocker.

Freeze a coherent source commit. Build/install/deploy through T03's workflows with relevant current checks and T17 compatibility evidence. Reuse a candidate only if source/inputs match; documentation-only commits do not require rebuilding unchanged product assets. Verify seals/identities and preserve rollback.

On actual installed apps and hosted site repeat T04 plus each supported template, List/Cards, search invalidation, external file edit, shared editing, comments, agent actions, account UI, light/dark and Mac share extension. Check cold startup for blank windows/test dialogs. Private actor receipts alone cannot close this task.

If code changes after acceptance, identify which receipts become stale and rerun their affected gates. No public Mac release without a new explicit request.

Exit: installed and hosted artifacts match verified source and normal-use checks pass; remaining diagnostic/permission/provider limitations are explicitly disclosed, not marked done.

### T27 — Final evidence, changelog and clean handoff

Maps: P8.5–P8.6. Depends: all applicable tasks.

1. Use `texttext:project-changelog` for the shipped version in the existing TextText Changelog document. Preserve existing body and deduplicate entries; verify the write and actual shipped identities.
2. Commit/push named verified files. Leave unrelated dirty work intact. Remove only authorized, identified runner-owned fixtures/processes; keep failure and recovery evidence.
3. Update master checkboxes from evidence, parity rows and this ledger. Archive resolved narrative; HANDOFF contains only current state, open dependencies, installed identities and references.
4. Deliver a concise final report: what works, exact installed/deployed versions, verification receipts, rollback location, and any excluded/unverified scenario. Public distribution and OpenAI account sign-in remain excluded; two-account or provider gates remain unfinished if unrun.

Exit: all required tasks have evidence or explicitly owner-approved scope changes. Do not call the whole plan complete because the original close dialog stopped appearing.

## Command reference and stop conditions

Run from the repository root on Mac. These commands exist today; inspect test configuration before expanding scope.

```sh
node node_modules/vitest/vitest.mjs run src/local-vault/collaboration-client.test.ts src/local-vault/navigation-flush.test.ts
node node_modules/typescript/bin/tsc --noEmit --pretty false
npm run test:sync:client
npm run mac:test
node --test sync/stress/stress.test.mjs
node scripts/with-local-database.mjs npm run test:sync
node sync/stress/run.mjs <fresh-real-config.json>
```

Windows entry points: `windows/scripts/build.ps1`, `windows/scripts/smoke.ps1`, and separate `windows/scripts/install.ps1 -Candidate <absolute-path>`. Inspect parameters and use existing interactive-session machinery for desktop verification. Encode nontrivial PowerShell correctly because SSH may land in cmd.exe. Never paste credentials into arguments.

A safe pause follows a committed verified task with a current receipt and exact next command; it does not require finishing a whole milestone. Record running process ownership and stop only task-owned bounded processes as appropriate. On a failure preserve artifacts, keep the affected gate open, and work on an independent task. Missing Windows access, second account, provider state, or a reboot window is a specific dependency, not permission to declare completion.

## Execution ledger

Initial states reflect repository evidence on October 17; no new implementation/physical checks were run while writing this plan.

| Tasks | State | Next action / dependency |
| --- | --- | --- |
| T01 | Baseline recorded | [October 17 receipt](../verification/2026-10-17-completion-progress.md); current browsers/actors will be attested during their runs |
| T02 | Verified workaround | October 13 reboot, multi-night window, three fresh desktop smoke runs and zero matching Security failures; [receipt](../verification/2026-10-17-completion-progress.md) |
| T03–T04 | Native and web delivery verified; wider T04 open | Both installed apps pass edit/quit/reopen; Windows reconnect converges; Oracle deployed with backup/health/authenticated smoke; offline and wider scenarios open |
| T05 | Controlled orders verified; historical gap retained | Fresh smoke covers completed repeat and navigation-away activation; original run174 refusal receipt is unavailable |
| T06 | Native failure regressions added | Mac permission denial and Windows cancellation/replacement recovery pass; [matrix](../verification/adapter-conformance-matrix.md) retains remaining common-fixture/ENOSPC/crash gaps |
| T07 | Barrier defects fixed in source | [Receipt](../verification/2026-10-17-captured-local-barrier.md); production Mac close/quit guard and fence pass native checks and installed build1262 quit/reopen; Windows candidate installed/edit/close/reopen/reconnect passes; Windows close input fence passes native smoke and actual installed edit/close/reopen; account transitions remain |
| T08–T09 | Open | Shared ownership, fencing and continuity after contract work |
| T10 | Partial inventory | Complete per-flow ownership and host feasibility |
| T11–T15 | Open | Policy slices, external files, identities/conflicts/providers |
| T16–T18 | Partial existing tests | Complete crash/upgrade matrix and seeded scheduling |
| T19–T20 | Open acceptance | Product parity and real template/agent workflows |
| T21–T22 | Partial historical evidence | Current physical actors and full scenario matrix |
| T23 | Real viewer/edit/revoke/regrant passed | Offline pending work retained and not uploaded while revoked; current-source, account-switch and agent identity checks remain |
| T24–T25 | Open | Endurance and measured performance |
| T26–T27 | Waiting | Final coherent delivery and evidence closure |
