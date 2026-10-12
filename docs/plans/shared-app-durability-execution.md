# Shared application and durable collaboration: execution plan

Status: planned, not complete. Owner: TextText implementation agent.
Created: October 11, 2026. Execute on `main` in this repository.

## Objective and scope

Deliver one application experience across Mac, Windows, and web, backed by durable collaboration and ordinary editable TextPack files. Mac app, Mac browser, Mac direct-file writer, Windows app, Windows browser, and Windows direct-file writer must work simultaneously. Agents can use ordinary filesystem tools, workspace commands, or hosted MCP. Normal concurrent work must preserve the editor and recover automatically.

Oracle hosts the service and storage. Keep unrelated Oracle services intact. iCloud workspace folders remain supported. OpenAI account sign-in is deferred until approved credentials are available. Native Apple sign-in, existing account functionality, templates, agents, and extensions remain in scope. Public Mac distribution requires an explicit owner request; authorized local installs and requested Oracle deployments do not require another approval.

This plan supersedes ad hoc retries as the execution order. It complements the detailed [six-client acceptance contract](../verification/six-client-sync-acceptance.md), [sync contract](../../sync/README.md), and [binary contract](../verification/live-binary-sync.md). Existing passing receipts remain evidence for unchanged behavior; do not repeat unaffected suites indiscriminately.

## Starting evidence and uncertainty

- Shared Yjs client, reconciliation, server persistence, renderer, workspace commands, and an automatic six-client runner already exist. Preserve them where they meet the contracts below.
- Native file synchronization still has substantial Swift and C# implementations. Audit ownership and behavior before moving code.
- Browser navigation uses remote flushing while native navigation uses local checkpoints in `src/local-vault/navigation-flush.ts`. Their durability semantics need alignment.
- Windows runs 171–174 converged text but failed normal close. Run 174 had a rejected guard result before the close probe and no recorded wrapped-hook invocation during it. This does not identify the originating operation.
- Run 175 passed one simultaneous round and normal Windows close. Receipt: `/private/tmp/texttext-six-20261011/results/stress-2026-10-12T02-31-06-349Z-175`. Treat the defect as intermittent and unresolved.
- Run 175's detailed Windows trace was not retrieved because SSH reset after the completed run. PC availability is not evidence about document correctness. Retry the established SSH path without changing machine networking or creating access paths.
- Current uncommitted Windows diagnostics and the speculative removal of WebView disabling require review. Do not ship that removal merely because one later run passed.
- Installed versions, candidate paths, and earlier receipts are recorded in [HANDOFF](../HANDOFF.md); inspect actual binaries before relying on those records.

## Execution rules

1. Read repository instructions and the current handoff. Inspect dirty files, active workers, running processes, and exact source/build identities. Preserve unrelated changes.
2. Execute phases in dependency order. A phase is complete only with its listed evidence. Update the ledger below after each coherent commit.
3. Before changing a protocol, record the old and new behavior, compatibility handling, and failure recovery. Avoid a simultaneous rewrite of storage, UI, protocol, and packaging.
4. For a reproduced defect, first preserve its failure and add a deterministic regression. Retain failing receipts when reruns pass.
5. Tests operate on isolated fixtures and bounded processes. Do not create build/release watchers, scheduled installers, or automatic source-fixing jobs.
6. Source changes require relevant Mac checks and platform checks when applicable. Commit only the files belonging to the work unit. Do not push other workers' unverified changes or the existing unpublished backlog inadvertently.
7. Every work unit records: hypothesis, changed files, failing reproduction, passing verification, source/build identity, remaining uncertainty, and exact next action. Keep large traces outside the handoff and link them.
8. A genuine disk failure or revoked permission must remain truthful. Never bypass persistence checks or weaken permissions to make a test pass.

## Target contracts

### State and acknowledgement

Distinguish applied, locally durable, materialized in the user file, and durably acknowledged by the server. An operation has a stable identity; a local persistence acknowledgement identifies its document lifecycle and generation. Generation numbers are local persistence positions, not a global CRDT ordering.

A local durable record must contain everything needed to replay or materialize accepted work after termination. Capture a close barrier for accepted local work and complete it without waiting for unrelated incoming traffic or server availability. Do not chase a perpetually moving remote generation. Never report local durability before the storage transaction commits. The server acknowledges only after its transaction commits; retries reuse the operation identity.

A browser can provide transactional local persistence but cannot guarantee survival of explicit site-data deletion or all browser eviction. Request persistent storage where supported, handle denial/quota failures, and document that boundary without turning routine navigation into a network wait.

### Ownership and lifecycle

A shared document coordinator owns CRDT state, local persistence, materialization, file integration, transport, and subscriptions. UI mounting does not own document durability. Multiple views reference the same appropriate document session; explicit lifecycle identity fences stale replies. Serialize transitions, deduplicate opens, and drain accepted local work before releasing ownership. Handle multiple processes/tabs through explicit leases/fencing or supported isolation, not assumed singleton behavior.

### Files and synchronization

Retain a baseline for every materialized file version. External writes are validated snapshots reconciled against that baseline. Repeated filesystem events and our own writes are idempotent. Invalid intermediate bytes and provider eviction are not deletion. Device journals, locks, credentials, and caches live outside provider-synchronized workspace content.

Text merges use the existing Yjs and baseline reconciliation machinery. Binary replacement conflicts preserve both bytes and provenance. Deletes/restores use lifecycle fencing. Stable identity survives moves; copies and duplicate identities have explicit behavior. Permission loss preserves local work without uploading it under an unauthorized account.

### Application parity

Shared application code owns navigation, creation, templates, rendering/editing, search behavior, commands, accounts UI, sharing, comments, agents, recovery UI, and sync policy. Adapters own OS filesystem primitives, storage, credentials, native authentication, menus, extensions, and window events. Platform capabilities may differ; their product semantics must be documented and tested.

## Phase 0: baseline and diagnostic audit

Dependencies: none.

- [ ] P0.1 Record exact local source, server deployment, installed Mac/Windows, bundled web assets, private test actors, and browser build identities. Flag mismatches before interpreting results.
- [ ] P0.2 Retrieve Windows run 175 event trace and compare with 171–174. Record activation/close origin, transition state, hook presence, request identity, requested generation, persisted generation, and reason for refusal. Log metadata only.
- [ ] P0.3 Map open/edit/checkpoint/external-write/upload/ack/navigation/close/reopen through the modules below. Include lock ownership, cancellation propagation, and every writer of the same file/journal.
- [ ] P0.4 Classify each recovery banner and native dialog by actual failure. Separate storage failure, permissions, stale lifecycle, temporary transport failure, missing hook, and coordinator busy state.
- [ ] P0.5 Reproduce the Windows failure with a small controlled lifecycle test. Check duplicate file activation and close during activation explicitly. Remove or justify speculative changes.

Primary modules: `src/sync/engine/client.ts`, `src/local-vault/VaultApp.tsx`, `src/local-vault/CollaborativeVaultEditor.tsx`, `src/local-vault/navigation-flush.ts`, `windows/TextText.Windows/MainWindow.cs`, `MainWindow.Activation.cs`, `RendererFlushGuard.cs`, `WindowsBridge.cs`, `mac/Sources/TextText/LocalVaultCollaboration.swift`.

Deliverable: `docs/verification/document-lifecycle-audit.md` with a sequence/ownership map, confirmed defects versus hypotheses, and reproduction commands. Exit: close failure explained by an observed ordering and reproduced independently of a full six-client run, or an explicitly bounded diagnostic gap that remains open. A passing rerun is not an exit.

## Phase 1: executable durability and adapter contracts

Dependencies: P0 ownership map.

- [ ] P1.1 Define typed persistence requests/results and lifecycle/generation barriers. Replace ambiguous booleans internally with actionable outcomes; keep product copy separate.
- [ ] P1.2 Specify crash-consistent ordering for journal, TextPack projection, baseline, and outbox. Use existing proven transactional/atomic mechanisms where possible. Document fsync/rename and browser transaction guarantees, including a crash between each step.
- [ ] P1.3 Define adapter conformance fixtures for read, commit, replacement, cancellation, stale lease, unavailable file, quota/disk failure, and restart replay.
- [ ] P1.4 Audit browser persistence. Add transactional durable storage if the current implementation is insufficient. Version its schema and test migration and failed migration without deleting pending work.
- [ ] P1.5 Define server durable acknowledgement and idempotency behavior against existing receipts/transactions. Test commit-before-ack and lost-ack replay.

Exit: tests demonstrate the meaning of each acknowledgement on Mac, Windows, browser, and server. Every accepted-and-durably-acknowledged operation survives the relevant process crash. No remote dependency in the local close barrier.

## Phase 2: shared document lifecycle

Dependencies: P1.

- [ ] P2.1 Extract coordinator ownership from React effects where the audit finds lifecycle coupling. Reuse `src/sync/client.ts` and the existing engine; do not invent a second merge engine.
- [ ] P2.2 Implement reference-counted views and explicit transition serialization with stale-response fencing. Define tab/process ownership and crash takeover.
- [ ] P2.3 Route native close, browser navigation, workspace changes, sign-out, and file activation through the same lifecycle contract. Sign-out/account changes also enforce account boundaries and retained-work policy.
- [ ] P2.4 Fix the confirmed Windows defect and retain its deterministic regression. Verify navigation does not wait on unrelated incoming updates.
- [ ] P2.5 Keep the editor mounted through reconnect, file reconciliation, and ordinary background refresh. Preserve selection, undo context where valid, scroll position, and IME composition.
- [ ] P2.6 Delete replaced lifecycle callbacks/guards only after all callers use the new contract.

Exit: close/open races, duplicate activation, multiple windows, stale callbacks, background opening, and persistence interruption pass deterministically and in real native windows. Genuine persistence failures preserve content and report a specific actionable error.

## Phase 3: shared application and native policy consolidation

Dependencies: P1; implement alongside P2 only in non-overlapping modules.

- [ ] P3.1 Inventory every user feature and route on Mac, Windows, and web. Mark shared implementation, platform adapter, legacy duplicate, or missing. Include the old home route versus vault home.
- [ ] P3.2 Choose the supported runtime host for shared coordination in each shell, including when no editor is open. Write an architecture decision before adding a runtime or dependency. Account for memory, packaging, offline startup, shutdown, and security.
- [ ] P3.3 Move duplicated reconciliation/retry/outbox/lifecycle policy from `LocalVaultSync.swift` and `TextText.Core/SyncEngine.cs` into the shared implementation in small vertical slices. Native adapters retain required OS coordination. Run adapter conformance after each slice.
- [ ] P3.4 Use the same navigation, account menu, List/Cards toggle, search, settings, creation commands, templates, editor, comments, sharing, and agent UI across supported clients.
- [ ] P3.5 Ensure templates and agent creation/modification use validated DocumentSnapshot/TextPack primitives and shared commands. Verify preview, apply, edit, save-as-template, version, and retirement without raw internal JSON in ordinary flows.
- [ ] P3.6 Add import/dependency boundaries and parity checks. Remove superseded production paths and document remaining intentional platform differences.

Deliverable: `docs/verification/application-parity-matrix.md`. Exit: each in-scope feature has one shared behavior owner, passing parity evidence, and only justified OS-specific differences. Do not merely synchronize three independent implementations by convention.

## Phase 4: external-file and provider integration

Dependencies: P1–P3 relevant coordinator and storage interfaces.

- [ ] P4.1 Persist the baseline needed to reconcile external text/metadata changes with concurrent CRDT operations. Detect incomplete writes with bounded retry and stable reads.
- [ ] P4.2 Make watcher events idempotent, recognize own materialization, and handle a second external write arriving during reconciliation or materialization without overwriting it.
- [ ] P4.3 Handle atomic replacement, in-place edits, malformed-then-repaired packs, rapid successive writes, text.md-only changes, and independent metadata/attachment changes.
- [ ] P4.4 Specify and test rename/move, case-only rename, copy/duplicate identity, folder changes, explicit delete, restore, and stale upload. Test relevant Windows path constraints and collisions.
- [ ] P4.5 Keep local device state outside iCloud/other provider folders. Distinguish eviction/download failure from removal. Test duplicate arrival through cloud files and TextText transport without echo loops.
- [ ] P4.6 Specify deterministic text/field conflict outcomes and binary alternative preservation, including how users inspect/select retained versions. Normal text merges must not demand export/reopen.
- [ ] P4.7 Verify search, thumbnails, backlinks, and file lists invalidate once on committed changes, including direct CLI writes.

Exit: ordinary filesystem tools modify actual files while editors stay active; accepted work and attachments survive, identity remains stable, and caches update promptly. OS provider-specific behavior needs real provider evidence; simulated watcher events alone do not prove iCloud behavior.

## Phase 5: deterministic failure testing and compatibility

Dependencies: begin with P1, extend with every implementation phase.

- [ ] P5.1 Introduce controllable clock, delivery, and storage barriers around production interfaces. Tests must exercise production coordination, not a duplicate model.
- [ ] P5.2 Enumerate interruption points: before/after journal commit, projection replace, baseline update, outbox commit, server commit, ack receipt, session release, and upgrade.
- [ ] P5.3 Cover dropped/duplicated/reordered responses, stale epochs, permission downgrade, renewed credentials, background throttling, disk-full/quota failures, and cancellation.
- [ ] P5.4 Add seeded state-machine/property tests with operation accounting and deterministic allowed outcomes. Reduce failures into focused regressions.
- [ ] P5.5 Test retained journal/schema migration, interrupted migration, supported old/new clients, and safe refusal of unsupported future formats. Never destructively downgrade journals.
- [ ] P5.6 Add every relevant suite to the existing manually invoked verification boundary. A failed test invalidates the receipt. Do not restore retired build lanes or introduce CI infrastructure.

Exit: each known defect is caught by a small regression; supported crash points and compatibility boundaries preserve durable work. Check process termination separately from machine/power-loss guarantees.

## Phase 6: complete physical six-client acceptance

Dependencies: P2–P5 relevant scenarios pass locally.

- [ ] P6.1 Attest every actor and its shared bundle against candidate inputs. Surface simulation, stale assets, missing actors, authentication failure, or SSH failure as explicit non-passes.
- [ ] P6.2 Run overlapping text, deletion/replacement, Unicode, multi-field edits, undo/redo, sustained typing, and simultaneous direct-file saves.
- [ ] P6.3 Rotate disconnect/lost-ack/crash/restart faults across participants while other actors continue. Verify close/reopen barriers and continuous unaffected editors.
- [ ] P6.4 Run whole-pack creation/replacement, binary same-entry/different-entry changes, invalid intermediate bytes, folder moves, deletes/restores, and stale writers.
- [ ] P6.5 Run two authorized test accounts with edit/read scopes, revocation and re-grant. If a second account is unavailable, state the precise gap; do not bypass authentication or create an account without authorization.
- [ ] P6.6 Verify convergence over stable samples, expected operation accounting, exact attachment bytes, and independent durable reopen. Do not use matching ZIP container hashes as the semantic oracle.
- [ ] P6.7 Run a finite seeded soak after focused cases pass. Initial campaign: at least 100 concurrent rounds and a 60-minute bounded soak, adjusted only with recorded rationale. Keep process, memory, request, and output budgets explicit.

Exit: all required categories have physical receipts, no unexplained failures, and no hidden manual recovery. An interrupted or failed campaign remains failed; the replay is linked separately.

## Phase 7: performance and resource acceptance

Dependencies: P3/P4; measure baseline early, final acceptance after P6.

- [ ] P7.1 Measure cold/warm launch, cached navigation, typing latency, remote visibility, local file reflection, search, close, reconnect, and large assets separately.
- [ ] P7.2 Use real release-mode clients and record hardware, network conditions, dataset sizes, sample counts, p50/p95/p99, and maximums. Use representative small and large workspaces.
- [ ] P7.3 Initial healthy-network targets: typing p95 <50ms; remote text visibility p95 <500ms; stable small external write reflected locally p95 <1s; cached workspace usable p95 <2s; normal durable close p95 <1s. Reconnect target and asset throughput budgets must be set from baseline before tuning.
- [ ] P7.4 Prove zero idle content writes/mutation uploads, bounded manifest reads, watcher coalescing, and no persistent growth in listeners, queues, or retained documents. Record memory after warmup and settle; avoid interpreting allocator caching as a leak without evidence.
- [ ] P7.5 Preserve measured search improvements; test invalidation on relevant changes. Fix hot paths and repeat only affected measurements plus necessary integration checks.

Exit: budgets met or an explicit owner-visible shortfall remains open. No claim of completion with unmeasured performance.

## Phase 8: candidate installation and normal-use readiness

Dependencies: P0–P7 complete.

- [ ] P8.1 Verify coherent source commits and required receipts. Review pending changes and the existing unpushed backlog before pushing. Build candidates once from recorded inputs.
- [ ] P8.2 Verify upgrade with retained pending journals and preserve rollback binaries. Rollback must remain compatible with data written by the candidate; otherwise document recovery direction.
- [ ] P8.3 Install authorized Mac and Windows candidates and deploy requested Oracle changes through the documented workflow. Preserve unrelated services and inspect backups before infrastructure changes.
- [ ] P8.4 Verify installed startup, existing files, direct-file edit, search invalidation, editing, close/reopen, account UI, both home layouts, sharing/comments, templates, agent actions, and extensions. Check light/dark and platform input conventions.
- [ ] P8.5 Remove only runner-created fixtures/processes and obsolete implementation paths with verified scope. Keep failure receipts and needed recovery evidence. Do not delete user content.
- [ ] P8.6 Use the required TextText project changelog skill for shipped product changes. Update handoff with installed identities, receipts, remaining exclusions, and rollback references.

Exit: installed clients and Oracle run the verified behavior, all required evidence exists, and deferred OpenAI sign-in/public distribution are clearly distinguished from unfinished requirements. Mark the active goal complete only then.

## Progress ledger and next action

| Phase | State | Commit/evidence | Remaining blocker |
| --- | --- | --- | --- |
| P0 Baseline/audit | Not started under this plan | Earlier run 175 pass; runs 171–174 fail | Retrieve close trace; isolate rejected operation |
| P1 Durability contract | Not started | Existing sync engine/journals are inputs | Acknowledgement and adapter audit |
| P2 Lifecycle | Not started | Existing lifecycle code is input | Deterministic reproduction |
| P3 Shared app | Not started | Shared renderer/commands already exist | Parity/duplicate-policy inventory |
| P4 External files | Not started | Prior physical receipts linked in acceptance contract | Remaining races/provider semantics |
| P5 Regression campaign | Not started | Existing suites retained | Controlled fault boundaries |
| P6 Six clients | Incomplete existing evidence | Acceptance contract | Full matrix and soak |
| P7 Performance | Incomplete existing evidence | Preserve prior search receipts | Cross-platform distributions/resources |
| P8 Install/readiness | Not started | Existing installed builds in handoff | Prior phase gates |

Next execution: P0.1–P0.5. First inspect current dirty Windows changes, retrieve the run 175 trace if reachable, and compare activation/close lifetimes. Produce the ownership map and deterministic failing case before another broad six-client campaign. Continue local audit work if PC access is temporarily unavailable.
