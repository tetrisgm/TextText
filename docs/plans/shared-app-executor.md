# TextText implementation playbook

Status: executable handoff, not implementation completion. Updated October 11, 2026.

Read this first, then the [master plan](shared-app-durability-execution.md). The master plan defines scope and phase IDs; this document defines how to execute it with a smaller model. Keep both current. A checked task requires linked evidence, not an assertion.

## Paste this into the implementation agent

> Work in `/Users/shokunin/dev/TextText` on main. Read AGENTS.md, docs/HANDOFF.md, docs/plans/shared-app-executor.md, and the current packet's referenced files. Finish the shared-app durability plan in order. Start with packet A; inspect actual state rather than assuming the handoff is current. Complete one bounded packet at a time, preserve unrelated edits, run the relevant checks, commit your work, and update the ledger with exact receipts and the next command. Continue into the next ready packet without asking for permission already granted. Use existing implementations and libraries; never add a second merge engine. Do not suppress recovery errors, bypass durability checks, or substitute simulated actors for required physical acceptance. Do not mark the plan complete until the installed Mac/Windows apps and Oracle web deployment pass the acceptance gates. OpenAI account sign-in and public Mac distribution are excluded for now. If infrastructure is unavailable, diagnose it from the fleet instructions and continue independent work. Stop dependent work only at a genuine unresolved dependency; record exactly what is missing.

## Decision baseline

These are architectural requirements, not invitations to redesign the product:

- One shared application UI and command layer for Mac, Windows and web. Keep native shells thin. Preserve native Apple authentication, OS menus, filesystem coordination and extensions through adapters.
- Keep Yjs as the live document merge engine and the existing validated DocumentSnapshot/TextPack schema. A TextPack is an interoperable materialization; external agents need no proprietary CLI to edit it.
- One shared coordinator owns document state and policy. It must run independently of a particular editor component. Account + workspace + document + lifecycle identify a session; path alone does not.
- Native filesystem primitives remain native. Share merge/retry/outbox/lifecycle decisions; do not demand identical low-level disk code on three platforms.
- Oracle remains the cloud host and storage. Files may live in iCloud on the Mac. Device locks, credentials, journals and caches stay outside the synchronized content folder.
- The UI stays usable while offline or reconnecting. A locally durable edit can permit close without server acknowledgement. An edit only held in memory cannot.
- Do not change schema, transport, lifecycle and packaging simultaneously. Migrate one vertical slice with restart/compatibility tests before deleting its old path.
- “Automatic repair” means bounded production recovery plus regression protection. It does not mean unattended AI edits, repeated builds, or retrying forever.

## Current evidence to retain

Commit `92d680fa` adds Windows activation deduplication, preserves close requests during activation, and adds native regressions/diagnostics. The latest close fix passed Windows smoke but has not been installed in a newly sealed Windows candidate.

- Run 175 trace is now available: `/tmp/texttext-pc-events175.jsonl`.
- Run 176 passed one physical concurrent round and Windows close: `/private/tmp/texttext-six-20261011/results/stress-2026-10-12T03-06-06-569Z-176`.
- Final native smoke receipt: `C:\Users\Shokunin\dev\texttext-release-136bc176\windows\build\smoke-receipts-8c7ac8ba999e41f99674107c6438950f`.
- Candidate `candidate-fadaf025bf7b467fb41ef79c41f86172` predates the final close-request fix. Do not install it as evidence of that fix.
- Mac installed identity was 0.204 build 1259. Re-read its plist before using this fact.
- PC SSH recovered using the qualified local account. Both existing profiles now use it. Read the fleet reference; do not create another key/profile or assume an SSH error means the PC is off.
- Runs 171–174 failed. Keep those failures. One successful round does not close their diagnostic gap.

Temporary receipt paths may disappear. Before relying on one, check existence and copy redacted summaries into a durable verification record. Never commit tokens, browser profiles, full user documents or raw journals.

## Operating loop and limits

1. Read the packet, relevant code and test entry points. Inspect git status and pull before editing. Existing dirty changes are listed in HANDOFF; do not sweep them into your commit.
2. Write the concrete invariant and reproduction before changing production behavior. A missing feature instead needs a failing acceptance test.
3. Implement the smallest complete slice. Keep only one expensive build or physical stress campaign active; use bounded output and finite deadlines. Delegate only when authorized and with disjoint file ownership.
4. Run the focused regression, type checks, and required adapter checks. Broaden only for a changed boundary or remaining risk. Record failures as well as passes.
5. Review the diff for lost content paths, security changes, stale callbacks and generated noise. Commit only named files. Update the evidence record and select the next packet.
6. Before pushing, inspect the unpublished backlog. Push coherent verified work; do not silently publish unrelated historical commits. A git push deploys nothing.

After two unsuccessful fixes for the same reproduction: stop changing production code, capture the precise operation order, reduce the failure, and revise the hypothesis. Do not raise timeouts or remove checks without evidence. If a required test cannot run, leave that gate open and continue an independent packet.

Use this record per work unit in `docs/verification/` (one short entry per commit):

```
Packet / master IDs:
Invariant:
Failure reproduction and receipt:
Implementation and source commit:
Verification command, exit status and receipt:
Platforms and candidate identities:
Remaining uncertainty:
Next exact action:
```

## Packet A: verify baseline and complete the close diagnosis

Master: P0.1–P0.5, part of P2.4. No dependency.

Read `docs/verification/document-lifecycle-audit.md`, Windows activation/close/guard files, `windows/TextText.Smoke/MainWindowCloseTests.cs`, and `windows/TextText.LiveAcceptance/Stress.cs`.

1. Record source HEAD, dirty files, installed Mac/PC executable identity, hosted deployment identity, and actor bundle digests. Distinguish production binaries from private actors.
2. Build a fresh Windows candidate including `92d680fa` using `windows/scripts/build.ps1`. This script builds and seals; it does not install. Read `windows/scripts/install.ps1` before invoking its actual parameters. Use the established one-off install workflow, retain rollback, then verify the installed executable matches the seal.
3. Test duplicate activation while pending, repeated activation after completion, activation after navigating away, close during activation, close during remote traffic, and storage rejection. Repeat opens must not discard edits or leave the window permanently busy.
4. Instrument origin/request/lifecycle/generation and native refusal reason where missing. Metadata only. Distinguish activation's prior failure from the later close request.
5. Correct stale audit statements. The close-during-activation regression now exists; the original checkpoint rejection still needs an explanation. If it no longer reproduces, retain the bounded uncertainty and expand deterministic ordering tests rather than claiming the hypothesis is proven.

Done when: installed candidate verified, controlled order tests pass, every known close failure is explained or explicitly tracked with a targeted test gap. Do not wait for this investigation to finish before starting independent packet B.

## Packet B: truthful local durability

Master: P1.1–P1.4, P5.1–P5.3. Depends on the existing ownership map.

Read `src/sync/engine/client.ts`, `src/local-vault/collaboration-client.test.ts`, `src/local-vault/navigation-flush.ts` and its tests. Inspect all persistence call sites before changing an interface.

First reproduction: the storage-failure test currently asserts error/read-only/recoverable memory. Add an assertion that `flushLocal()` cannot return true for the unsaved edit when no native checkpoint exists. Current implementation only checks `unreadableJournal` in that branch; verify the suspected failure before fixing it.

Then introduce an explicit local durability result carrying lifecycle, captured generation and outcome. Suggested outcomes: durable, pending, storage-unavailable, invalid-journal, stale-lifecycle. Names can follow existing conventions. Never conflate remote acknowledgement, a clean pending list and local persistence.

Track successfully persisted state separately from attempted/in-memory state. Cover initial empty state, restored journals, serialization/size failure, quota failure, recovery after storage becomes available, native checkpoint success despite browser-storage failure, and native checkpoint rejection. Do not treat every frozen client as nondurable: durable retained recovery is a distinct state.

Browser target: transactional IndexedDB persistence with a versioned schema unless the audit demonstrates an equally strong existing transactional mechanism. Preserve the old journal until migration commits and round-trip validation succeeds. A transaction-abort or blocked upgrade must preserve pending work. No network request may race ahead of the required local commit.

Close/navigation captures accepted local generation G; it waits for persistence covering G, not for incoming traffic to stop. When new local input remains allowed during close, either extend the barrier deliberately or fence input for the final release; test that race explicitly.

Done when: failed persistence cannot produce a durable acknowledgement; crash/reload restores every acknowledged operation; local navigation works offline; typed outcomes reach the native boundary without exposing internal JSON to users.

## Packet C: shared coordinator and stable editor lifetime

Master: P2.1–P2.6. Depends on B.

Create or extend the coordinator under `src/sync/`; first search for existing ownership abstractions. Move ownership, not just function names. React views acquire/release handles; coordinator owns persistence, CRDT, transport and reconciliation until safe release.

Implement explicit states such as opening, ready, reconnecting, draining, closed, and retained-error. Keep connection state separate from editability and local durability. Every async response checks the session lifecycle before applying. Release is idempotent; cancelled views cannot destroy a session held by another view.

Route open, navigation, close, account change and sign-out through one transition contract. Browser tabs/processes require explicit ownership/fencing; choose a lease or independently journaled actor design and test crash takeover. Do not assume a module singleton spans processes.

Replace effect-driven destroy/recreate during ordinary refresh. Preserve editor instance, selection and IME composition through reconnect and external changes. Never automatically replay old-account edits under a new account.

Done when: deterministic races and real WebView tests pass; offline close/reopen is durable; ordinary reconnect does not unmount the editor; replaced hooks have no remaining production callers.

## Packet D: whole-application parity and runtime choice

Master: P3.1–P3.4, P3.6. Inventory can start immediately; migration depends on B/C.

Produce `docs/verification/application-parity-matrix.md` with rows for home/List/Cards, folders, creation, every template, editing, search, account/settings/logout, comments/sharing/presence, agents, import/export, attachments, extensions, offline startup, and updates. Columns: shared owner, Mac adapter, Windows adapter, web adapter, regression, physical evidence, intentional difference.

Write an architecture decision before migrating native sync policy. Compare extending the existing shared JS runtime with embedding an additional runtime; prefer existing packaging if it supports coordinator lifetime when no editor is open. Record memory, startup, sandbox/filesystem access, background lifetime and failure recovery. Do not switch to Electron/Tauri or ship a new runtime merely to get code sharing.

Migrate one native-policy slice at a time: pure reconciliation decisions, then retry/outbox scheduling, then lifecycle policy. Both adapters must run the same conformance fixtures before removing old policy. Maintain one authoritative writer during each migration; never run old and new writers concurrently against user files.

Route legacy home and current vault home into the same supported application behavior. Preserve List/Cards as a user setting across clients. OS differences belong behind capability interfaces, not platform forks of the product.

Done when: each feature has one shared behavior owner; native adapters contain justified OS primitives; parity matrix contains evidence rather than “supported” labels.

## Packet E: filesystem correctness

Master: P4.1–P4.7. Depends on B/C and D's relevant policy slice.

Define the persisted tuple for each file: stable document identity, lifecycle, materialized baseline, current file fingerprint and pending intent. The exact representation must fit the existing journal. Implement and test this order: read stable external bytes; validate; compare to saved baseline; derive changes; merge into the current CRDT; durably record merged intent; replace projection only if the external version still matches; advance baseline. A changed file during replacement restarts reconciliation from fresh bytes, without forgetting the already accepted operation.

Test both plain in-place saves and atomic rename-over saves using ordinary filesystem APIs. Duplicate/own-write events must not create operations. Invalid ZIP or temporarily unavailable iCloud bytes must not delete a document. Require bounded retries and explicit retained state after persistent failure.

Test moves, case-only renames, copies with duplicate IDs, delete/restore and stale writers. Define deterministic outcomes before implementation. For overlapping text use the agreed baseline merge semantics, not silent whole-file last-writer wins. Arbitrary external saves cannot reveal intent perfectly; preserve ambiguous content durably and expose a usable version choice when necessary.

For same-entry binary conflicts preserve both distinct byte sequences with provenance; prove both recoverable hashes. Different-entry changes should merge. Never use ZIP archive hashes as semantic equality.

Done when: six active actors see external file edits quickly without editor teardown, no echo writes occur, retained alternatives survive restart, and search/backlinks/thumbnails update after the same committed change. Real iCloud eviction/download behavior needs provider evidence, with unsupported scenarios listed explicitly.

## Packet F: server, crashes and upgrades

Master: P1.5, P5.1–P5.6. Depends on the affected contract from B/C/E.

Read `docs/DATABASE-OPERATIONS.md` before database work. Tests use local PostgreSQL. Use production transaction code in tests.

Inject barriers before/after journal commit, projection replacement, baseline advancement, outbox commit, server commit, response delivery and session release. Kill and reconstruct the client from disk rather than reusing its in-memory objects. Lost acknowledgements replay the same operation ID and produce one logical mutation. Stale epochs cannot overwrite restored/deleted documents; permission revocation cannot be treated as a transient retry forever.

Version persisted formats. Test current-to-next migration, interruption at every migration write, old pending work, future-version refusal, and rollback compatibility. Retain the old durable copy until successful migration; do not “repair” unknown formats by resetting them.

Add seeded scheduling/property tests using production interfaces. Verify operation accounting, valid snapshots, durable recovery and convergence. A seed and schedule must reproduce failures locally. Wire relevant checks into existing manually invoked verification, with source fingerprints invalidating stale receipts.

Done when: every durability boundary has a failure/restart test; supported upgrades preserve pending work; server ACK follows commit; source changes invalidate corresponding acceptance receipts.

## Packet G: agent/template/product completion

Master: P3.5 plus P8 feature checks. Depends on shared commands and D.

Read `docs/ai-sidebar-architecture.md`, `DESIGN.md`, and current template schemas. Use existing workspace commands for UI, built-in agent and hosted MCP. Local filesystem editing remains independently supported.

Test item creation, folder placement, metadata/body/attachment edits, template creation from existing primitives, preview/apply, save-as-template, versioning and retirement. Verify permissions and idempotent retries. Ordinary users should see a human-readable proposed change and result, not source hashes or raw JSON. Agent presence represents the authenticated actor; do not falsely attribute anonymous filesystem writes to a named person.

Product targets: Bookmarks/Shiori, Gallery/Resurf, Blog/Medium, Notes/Supernotes, feeds/Artifact references and Command-K/Superhuman. Use repository reference assets and current owner decisions. Tasks are excluded by the owner's request. Templates are offered in a picker, not a user-facing Templates folder. Creation/editing workflows count, not only static rendering. Inspect light/dark on all three clients.

Done when: shared commands and real agent entry points produce valid items/templates; test fixtures exercise full workflows; parity matrix links results and remaining visual differences.

## Packet H: physical acceptance and performance

Master: P6 and P7. Depends on focused regressions for each tested scenario.

Read `sync/stress/README.md` and the six-client acceptance contract. Reuse the automatic runner; extend it where a scenario is missing. The old config directory `/private/tmp/texttext-six-20261011/freshclose176/` is an example, not a current attestation. Generate fresh fixture IDs/session directories and attest current actors.

Campaign order:

1. Startup/readiness, one simultaneous round, and independent durable reopen.
2. Same-position/overlapping replacements, deletion, Unicode, undo/redo, multi-field edits and sustained typing. Assert allowed semantics, not an arbitrary insertion order.
3. External in-place and atomic saves, invalid-then-repaired packs, rapid successive writes, asset races, moves and delete/restore.
4. Rotate offline/lost-ACK/crash/restart across roles while the others continue. Close during traffic and reopen from independent disk state.
5. Two authorized accounts: read-only, edit, revocation, re-grant. Existing same-account sessions do not prove multi-user authorization. Record a missing second account as a genuine outstanding gate; do not create one silently.
6. At least 100 seeded concurrent rounds plus a finite 60-minute soak after focused cases pass. Stop on first correctness failure; preserve the schedule and reduce it into a regression before rerunning.

For every run record six role attestations, accepted operation IDs, stable convergence samples, native projection contents/assets, browser durable reopen, editor instance/selection continuity, queue/listener counts, idle mutation counts, and latency distributions. A missing/disconnected actor is not a pass. Direct-file roles must use ordinary filesystem writes, not only TextText CLI commands.

Measure release-mode cold/warm launch, cached open, typing, search, external-write reflection, remote visibility, close and reconnect. Targets are in P7.3. Record hardware/network/data size and p50/p95/p99/max. Measure idle request budget and settled memory; zero idle content mutations. Retain search baseline and verify invalidation. Do not claim “instant” or “bulletproof” from a single mean or append-only result.

Done when: all required scenario categories have attested physical receipts, full operation/asset accounting, no unexplained recovery UI, and performance budgets pass. Browser/site-data deletion and power-loss limits remain honestly documented.

## Packet I: deliver and close the plan

Master: P8. Depends on all applicable gates above.

Build from a coherent recorded source snapshot. Use existing one-off Mac/Windows install and Oracle deploy workflows, after reading their current docs and scripts. Recheck backups/current processes before Oracle changes and preserve Algorave. Public Mac release is excluded.

Verify the installed artifacts, not only test actors: startup, account menu, existing notes, new item from each supported template, List/Cards, search/invalidation, file edit, save/close/reopen, shared editing, comments, agent actions, and Mac share extension. Confirm normal startup does not show test dialogs or blank windows. Preserve rollback compatible with persisted state.

Clean only identified runner-owned fixtures/processes with the applicable authorization. Retain failure receipts. Update the TextText project changelog using its skill, mark master task IDs from evidence, and leave a concise handoff. Any outstanding gate remains explicit; completion cannot be substituted with “ready except sync.”

## Verified command entry points

Run from the repository root on Mac unless specified. Read script options before supplying paths; these are entry points, not permission to run every suite every packet.

```sh
git status --short
git pull --ff-only
node node_modules/vitest/vitest.mjs run src/local-vault/collaboration-client.test.ts src/local-vault/navigation-flush.test.ts
node node_modules/typescript/bin/tsc --noEmit --pretty false
npm run test:sync:client
npm run test:sync
npm run mac:test
node --test sync/stress/stress.test.mjs
node sync/stress/run.mjs <fresh-real-config.json>
```

`npm run test:sync` requires the local database workflow documented by the repo. Do not substitute production database credentials. Native Windows entry points are `windows/scripts/build.ps1` and `windows/scripts/smoke.ps1`; install is a separate `windows/scripts/install.ps1` invocation after inspecting its parameters. The existing PC checkout is `C:\Users\Shokunin\dev\texttext-release-136bc176`; verify/synchronize relevant source and fingerprints before building. Use PowerShell encoded commands for nontrivial remote commands because SSH lands in cmd.exe.

## Execution ledger

| Packet | State | Next concrete step |
| --- | --- | --- |
| A | Partial | Build/install final Windows close fix; finish identity/refusal audit |
| B | Ready | Reproduce failed browser persistence returning a successful local flush |
| C | Waiting for B | Design lifecycle/result interface against the ownership map |
| D | Inventory ready | Produce feature ownership matrix and runtime decision |
| E | Waiting for contracts | Enumerate external-write/materialization interleavings |
| F | Existing tests, incomplete | Inventory covered crash boundaries, add missing failpoints |
| G | Audit ready | Inventory shared agent/template command paths and workflow gaps |
| H | Partial historical evidence | Attest new candidates, then run focused cases before soak |
| I | Waiting for gates | Install/deploy only verified candidates and check real use |
