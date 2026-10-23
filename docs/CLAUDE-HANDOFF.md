# TextText completion handoff for Claude

Prepared October 19, 2026, Pacific time. Repository: `/Users/shokunin/dev/TextText`, branch `main`. Documentation baseline: `9d63c64a3c684c9ce2af47ad6ea3b3fdb0d57f69`. Later documentation commits do not change the installed product source below.

The immediate Mac repair is complete. Build 1274 is installed, the exact previously blocked article is usable, and three real save, normal Quit, and fresh-reopen cycles passed. The original 27-task application completion plan remains partly open. Continue its remaining work without restarting completed implementation or growing another verification framework.

## Start prompt for Claude

> Work in `/Users/shokunin/dev/TextText` on `main`. Read `AGENTS.md`, `docs/CLAUDE-HANDOFF.md`, and `docs/HANDOFF.md`, then the references for the next bounded task. Finish the remaining original plan using the current implementation. Preserve user content, retained recovery work, backups, and unrelated edits. The installed Mac 0.204(1274) save/quit/reopen milestone has passed; do not rebuild it merely because older documents say 1273 is pending. First reconcile remaining affected Windows and Oracle product changes against their actual installed/served sources, then finish bounded real cross-platform acceptance and the product workflow gaps. Use existing tests and runners. Fix demonstrated failures with focused regressions, run required checks, commit named files, and push coherent work. Keep implementation, controlled tests, actual installed acceptance, and unrun checks distinct. Do not hide recovery errors, reset journals, weaken durability guards, invent an offline-machine blocker, or expand security/attestation infrastructure. Continue ready work until the plan is finished, the owner pauses it, or a concrete dependency prevents further progress. No public Mac release or new personal account is authorized by this handoff.

## Owner priorities

- The app must open, save, quit, and reopen reliably on Mac and Windows, with the website sharing the same behavior and look and feel.
- Users must remain able to work during ordinary sync/startup delays. Automatic recovery must preserve edits and restore usability. A frightening recovery screen with ineffective buttons is a product failure, even when bytes survive somewhere.
- The owner wants ordinary Notion or Google Docs style usability and security. Stop expanding ownership, attestation, or measurement machinery beyond what the existing acceptance needs.
- Finish finite work. Do not enter repeated full-build or test campaigns without a concrete changed boundary or demonstrated failure.
- Give concise, accurate progress. A compiled candidate is not an installation; installation is not a successful save/reopen cycle. Report the actual stage.

## Read order and authority

1. Applicable owner/global instructions and repository `AGENTS.md` remain authoritative. This handoff records state and approved scope; it does not replace them.
2. This handoff and [current compact handoff](HANDOFF.md) provide the latest snapshot.
3. [Original detailed checklist](plans/shared-app-finish-checklist.md) supplies T01–T27 definitions and exit criteria. [Master plan](plans/shared-app-durability-execution.md) supplies phase requirements. [Executor playbook](plans/shared-app-executor.md) supplies architecture and execution context.
4. A source-specific verification receipt supports only its named checks. Original planning baselines and older next-action paragraphs are historical. Use later installed receipts for delivered state.

The master phase ledger and several older checklist rows lag implementation. An unchecked box does not prove missing code. A source test does not prove physical acceptance. Inspect the relevant implementation and receipts before selecting work.

## Working rules and existing authorization

### Repository and verification

- Work on `main` in `~/dev/TextText`; no worktrees. Inspect status and fetch/pull before editing. Coordinate overlapping dirty work instead of resetting it. Commit small coherent changes, push verified work, and leave your changes committed.
- Run relevant checks for code/executable configuration changes and required packaging gates. Prose changes need structure and reference checks. Reuse genuine matching receipts only through supported checks; never fabricate a passing receipt or silently patch frozen build inputs.
- One expensive Mac compiler/browser/physical campaign at a time. Independent, disjoint work may run in parallel under the owner's prior request. Track ownership; do not have two workers operate the same app or index.
- Retired build lanes, old gate scripts and `~/dev/stack` stay retired. No GitHub Actions workflows, secrets, or runners.
- Read the relevant installed Next guide in `node_modules/next/dist/docs/` before writing Next code. Read `DESIGN.md` before reader/editor visual changes; verify light and dark. Product copy has no em dashes.

### Content and architecture

- One validated schema-v1 `DocumentSnapshot`; article, note, bookmark, gallery and talk are templates. Shared rendering: `src/components/document/DocumentRenderer.tsx`.
- `src/lib/store.ts` is the content access point; mutations write `action_audit`. Notes and bookmarks remain unlisted; visibility fails closed.
- Full-document Yjs, awareness and epoch fencing remain the collaboration architecture. UI, assistant, CLI and MCP use existing workspace commands. Do not add a second merge engine, daemon or application runtime.
- The shared session owner outlives views until safe release. Native filesystem coordination remains native. Share portable decisions through the existing policy host.
- Local durability can permit offline close without server ACK. Memory-only accepted edits cannot. Never remove a guard, increase a timeout, reset a journal or fake a baseline to pass a test.
- Compare validated snapshots and decompressed asset bytes for semantic equality. ZIP containers can differ in metadata while document and image content match.

### Machines, secrets and deployment

- Before machine, infrastructure, OAuth or sign-in work, read `~/.codex/references/fleet-work.md` and its pointer to `~/dev/ssh/README.md`. Before browser verification, read `~/.codex/references/browser-verification.md`.
- Use existing SSH profiles and `~/.ssh/id_ed25519`; do not create keys, profiles, tunnels or another access path. Windows account qualification and Edge/WebView2 mitigation are documented in the fleet references. Authentication failure does not establish that the PC is off.
- Never expose credentials in source, logs, prompts or command arguments. Local tests/builds use local PostgreSQL, never production Neon. Read [database operations](DATABASE-OPERATIONS.md) before database or release-secret work.
- One-off local Mac builds/installs and Oracle product deployments needed for this work are already authorized. Use supported scripts. Public Mac distribution still requires an explicit new request.
- `git push` deploys nothing. Oracle is the website host; Vercel `write` is paused. Read [Oracle operations](../release/oracle/README.md), inspect recent backups, current identity, configuration mtimes and running work before infrastructure changes. Preserve unrelated services, including Algorave.
- Website deployment uses the existing Mac web-only release path (`npm run deploy:web`); inspect current script arguments and required receipt validation. Do not copy a historical `--skip-tests` invocation without matching genuine receipts and supported validation.
- No new accounts as a general workflow. The owner separately approved the mandatory Oracle deployment smoke's temporary synthetic TextText account/workspace/token and cleanup. That narrow fixture exception is already granted; do not ask again or treat it as permission for external signups.
- A previous request permitted a second test account, and real two-account tests subsequently ran. Discover the existing authorized sessions/receipts before declaring T23 blocked. Do not create another account from the older suggestion.
- Destruction, resets, overwrites of existing content, new release jobs, and surprise reboots are not routine fixes. Read targets first and obtain any required explicit authorization. Prior cleanup approvals applied to named archives/caches, not arbitrary future deletions.
- Do not message another chat/person without explicit authorization for that destination and purpose. Prior authorization to coordinate the MediaMedia Edge workaround was specific.

## Current delivered identities

These are recorded observations, not a guarantee that the owner has not since updated a machine. Recheck before a new campaign.

| Surface | Delivered identity and scope | Durable reference |
| --- | --- | --- |
| Mac | Canonical `/Applications/TextText.app`, `0.204(1274)`, product source `56d144f7c9f017a68c713813ccbcc2145fa0002e`; executable SHA256 `60aa171c629b51a0f5868353437c9f38a9467076f59905d1edd67fddfff72157`. Three real normal cycles passed. | [Installed acceptance](verification/2026-10-19-mac-1274-installed-acceptance.md), [candidate](verification/2026-10-19-mac-1274-56d144f7-candidate.md) |
| Windows | Source `1d1154f2a9a92d7b3696b7d6f4abfbaf73983707`; EXE SHA256 `d9f1d0da0a52fb6c90f12f2b2c89a7524fd1b19773c326681bd9dd9339a6a291`. Nonempty normal save and fresh reopen passed. Initial-session immediate close refusals remain recorded. | [Windows inventory recovery and installed acceptance](verification/2026-10-19-windows-inventory-profile-scan.md) |
| Local CLI | Existing shim targets `~/.local/share/texttext-cli/source-56d144f7/texttext`; signed binary SHA256 `f44b331112196828706885322dfbabc2778a2d152b5ea55f6c86d291092c6732`. Updated before Mac1274 launch for current persisted format support. | [Mac installed acceptance](verification/2026-10-19-mac-1274-installed-acceptance.md) |
| Oracle website | Source `4eca8353f455d5960e5c4cd592bece0aefff70fa`; deployment `texttext-oracle-20261019T021551274Z-4eca8353-1c86ff`. Health and 13 authenticated smoke checks passed. Later relevant product changes await delivery. | [Web delivery](verification/2026-10-18-web-4eca8353-delivered.md) |

Mac final observed PID was 82443, left open on the healthy article. Windows final recorded PID was 48840, left open on its saved note. PIDs are historical observations: never signal a process based only on these numbers.

### Preserve unrelated work

At handoff these paths remain owner/other-worker changes. Do not stage, overwrite or clean them:

- `mac/Package.resolved`, SHA256 `eea669ec76b68673014c10c95b90e721c14d67c99de5756f5c8071c968306edb`.
- `src/components/workspace/assistant/attachments.ts`.
- `src/lib/workspace/__tests__/tabs.test.ts`.
- Untracked `mac/scripts/__pycache__/` and `scripts/.probe-editor.ts`.

The implementation agents' build/install work is finished at this handoff; there is no intended active build or endurance run to inherit. Check processes before starting another. Earlier draft measurement work is retained outside the repo at `~/.codex/retained-work/texttext-measurement-drafts-20261019`; it is not a request to land that framework.

## The Mac failure and its completed repair

The old1273 app displayed “The file changed before shared editing opened,” a save warning and ineffective recovery/reopen behavior. Merely dismissing that screen did not fix the product.

Three causal corrections are included in installed56d144f7:

1. `10e102b3`: schedule the native mirror after successful external/image compare-and-swap replacement. The old mirror could run before replacement and lose the later wake, leaving baseline and current file mismatched.
2. `56d144f7`: dispose the exact failed shared-open owner before retrying. An ordinary initial native `local_changed`, before a client or lease exists, can use a fresh same-item local editor through existing durable-close behavior. Explicit handoff drafts and existing item/legacy/pending/unreadable browser journals retain their barriers. Later shared promotion uses existing guards.
3. `56d144f7`: successful recovery-copy handling must not access a nonexistent client's throwing getter. Verified no-client recovery returns to the workspace. Existing retirement checks remain for sessions with a client.

No timeout, baseline/CAS/epoch guard or pending-native-journal deletion was introduced as a shortcut. See [failed shared-open repair](verification/2026-10-19-failed-shared-open-recovery.md) and [postwrite wake](verification/2026-10-19-native-postwrite-mirror-wake.md). Their earlier source-only wording describes the stage when those receipts were written; the later1274 receipt establishes installation.

The candidate also exposed a test fixture race: restoring last location and explicitly opening the same file raced two startup requests. The test-only correction is `0ffb9f5e`. The actual frozen56 candidate was not patched: its complete sync gate reran and passed with the original test. See [fixture diagnosis](verification/2026-10-19-native-handoff-startup-fixture.md). Do not change production guards for that fixture race or relabel the failed run as passed.

### Actual installed acceptance

Previously blocked owned article: `7ba1c77c-f4b6-4725-814e-4f20252e2063`, `Notes/Six-client acceptance mixed 1273 20261019 d6f52401-7ba1c77c.textpack`.

- Opened its original text and image in1274 without the recovery screen.
- Typed a fresh marker, imported a fresh image with the native picker, reopened the editor and typed another marker.
- Normal CmdQ exited PID81070 naturally; fresh PID81753 rendered original content, new markers and both images.
- Created/typed normal note `64069cf7-15f0-4e86-9c75-3caa75bb7687`, `Notes/Untitled 22.textpack`; normal Quit and PID81993 fresh reopen retained exact title/body.
- Reopened the original article through the registered Finder handler, normal Quit, then fresh PID82443 showed exact text and both images again.
- Independent authenticated hosted reads matched both complete snapshots and asset inventories. Both JPEGs are53,704 bytes with SHA256 `ed06a94f6b494148666ddcc13727aa3912aa8b750dab26da7d3f50fa620c6baf`. Article ZIP hashes differ while document/assets match; this is not content divergence.

The old1273 stuck instance required a maintenance TERM after its original, recovery copy and supported session export were verified preserved. That maintenance stop is expressly excluded from the three successful normal1274 cycles.

### Build and backup evidence

- Candidate passed genuine release22, full core/native sync, strict signature, arm64 app/three extensions and18 health checks. The exact3,393-file source input matched before and after. Native sync had560 actual method passes,12 existing explicit skips and zero failures. See the candidate receipt for all pins and separate source-gate counts.
- Complete stopped preinstall backup: `~/Library/Application Support/TextText/PreinstallBackups/20261019-before-1274-56d144f7/manifest.json`, SHA256 `fcad8f1ca4e63b3bdd5d4a9a9d90d7cd48ad608ecef84a8888e1f30fbf978856`,284,916,940 bytes. App, whole vault, device state and opaque credentials matched before/after/copy.
- Private candidate root: `/private/tmp/texttext-final-local-store-1274-56d144f7-20261019/`; normal candidate receipt SHA256 `9122c6f03c2c5e849f877179a89410ef6e5448e05cf24302f64f96927474a6a9`.
- Private installed evidence: `/private/tmp/texttext-mac-1274-56d144f7-installed-20261019/`; healthy screenshot `final-article-window.png`, cycle receipts, hosted proof and final manifest. These temporary paths may expire; committed receipts are the durable summaries.
- Current persisted writer floor6 prevents old readers from safely writing new state. Preserve rollback binaries, but do not downgrade data or reinstall an old writer as a recovery strategy. Forward recovery may be required.

## Original task status and remaining exits

**October22 owner scope change:** the six-client physical runner and matrix (T21–T22), endurance runs (T24), performance measurement (T25), account switching (T23), and final delivery/changelog closure (T26–T27) are obsolete. Do not run, prepare or report them as open work; their historical receipts remain evidence only.


“Source verified” means implementation checks passed; any listed real-device gate is still open. Grouped history in older ledgers must not be counted as27 fully completed tasks.

| Task | Recorded state | Remaining action |
| --- | --- | --- |
| T01 identities | Baseline and current deliveries recorded | Refresh actual identities before the next campaign; compare affected source, not version labels alone. |
| T02 SSH persistence | Mitigation,18 fresh launches and historical15h23m observation passed | Coordinated reboot and fresh current-runtime observation. No surprise reboot or policy weakening. |
| T03 initial delivery | Mac1274, Windows1d and Oracle4eca delivered | Audit later relevant Windows/web changes and deliver the remaining affected surfaces. |
| T04 ordinary use | Mac three cycles complete; Windows nonempty save/fresh reopen complete | Preserve Windows initial-session close refusals as unresolved; finish remaining offline/reconnect and current-web ordinary-use checks. |
| T05 old close diagnosis | Controlled activation order regressions pass | Original run174 refusal reason remains a bounded historical evidence gap. Do not invent a cause or erase failures171–174. |
| T06 adapters | Conformance verified in source | Reuse coverage; physical/provider/crash cases remain under their later tasks. |
| T07 barriers | Captured-generation and native input/account fencing fixes tested | Complete real account transitions; investigate any current first-session close failure. |
| T08 ownership | Shared owner source checks pass | Include current real lifecycle/quit cases in remaining physical matrix. Do not reimplement the coordinator. |
| T09 tabs and editor continuity | Takeover, native exclusion, composition and bounded listener checks pass | Current real-client reconnect/takeover/resource acceptance. |
| T10 inventory | Feature/owner inventory and existing-WebView host plan recorded | Use the parity matrix to select uncovered flows; do not write a replacement architecture. |
| T11 native policy sharing | Many reconciliation/retry/lifecycle/path/folder/tombstone slices integrated and tested | Audit remaining native policy ownership and actual no-editor/idle behavior; explicit retained-review cases remain. |
| T12 external writes | Stable-read, retained replacement/move source checks pass | Real active-editor atomic/in-place writes, case-only paths and watcher/provider matrix. |
| T13 identity and deletion | Retained removal, causal markers and normal/folder move checks pass | All-six active-editor moves, duplicate IDs, delete/restore and stale-writer outcomes. |
| T14 conflicts | Conflict byte-retention source checks pass | Real overlapping text and same-entry/different-entry binary conflicts; durable alternatives and usable selection. |
| T15 providers and views | Some real iCloud and derived-view evidence exists | Complete unavailable/download/reconnect and search/backlink/thumbnail/list invalidation cases without treating unavailable as deleted. |
| T16 crash boundaries | Named process-kill, PostgreSQL replay and several native boundaries pass | Inventory and fill remaining journal/projection/baseline/outbox/server/audit/ACK/release boundaries. |
| T17 upgrades | Some frozen-source pending-upgrade/future-format tests pass | Full persisted-format/mixed-version/interrupted-upgrade table and supported forward recovery. |
| T18 seeded faults | Partial existing scheduling/runner checks | Cover missing production-interface schedules; save seeds and reduce failures. No new framework unless a concrete gap requires it. |
| T19 UI parity | Shared light/dark and permission baseline tested | Complete actual installed Mac/Windows/web flows, keyboard/narrow layouts and capability differences. |
| T20 templates and agents | Five template CLI flows, selected native gallery/comment/Trash/image workflows pass | Complete UI/assistant/CLI/MCP creation, edit, template version/retirement, audit, permissions and committed-response-loss retries. |
| T21 physical runner | Historical all-six append and independent reopen passed | Obsolete (owner, 2026-10-22). Do not run. |
| T22 physical matrix | Partial historical acceptance | Obsolete (owner, 2026-10-22). Do not run. |
| T23 two accounts | Real viewer/edit/revoke/regrant and retained offline work passed | Obsolete (owner, 2026-10-22). Do not run. |
| T24 endurance | Runner preparation tested; campaign unrun | Obsolete (owner, 2026-10-22). Do not run. |
| T25 performance | Preparation and isolated measurements only | Obsolete (owner, 2026-10-22). Do not run. |
| T26 final delivery | Immediate Mac repair delivered and accepted | Obsolete (owner, 2026-10-22). Do not run. |
| T27 closure | Current Mac receipt and compact handoff committed | Obsolete (owner, 2026-10-22). Do not run. |

## Concrete continuation sequence

### Step 1 Reconcile current source and delivery gaps

Read status/log, fetch/pull, preserve the listed dirty paths. Inspect affected production diffs between installed Windows1d/Oracle4eca and current committed product source. New Mac56 includes local-vault editor changes that can affect Windows as well. The server canonical folder-alias guard from `9e7daa62` is specifically recorded as absent from Oracle4eca; [CLI inventory receipt](verification/2026-10-19-cli-canonical-vault-inventory.md) explains the bug and scope.

Produce a short per-surface list of changes actually requiring build/install/deploy. Do not rebuild unchanged Mac assets for documentation commits. Use current release scripts and their exact-source required checks; preserve stopped backups and existing content. Verify hosted identity and authenticated smoke after a web rollout. Exit: actual surfaces and relevant fixes are known and delivered, or a precise dependency is recorded.

### Step 2 Finish the real cross-platform correctness matrix

Obsolete (owner, 2026-10-22). Skip this step; text below is historical.

Read [six-client contract](verification/six-client-sync-acceptance.md), `sync/stress/README.md`, and T21–T22. Existing roles are Mac app, Mac browser, Mac direct-file writer, Windows app, Windows browser and Windows direct-file writer. Direct-file actors must use ordinary filesystem operations. No simulated-role substitute.

Use existing runner/config interfaces, fresh owned fixture IDs and current identities. Start with one readiness/convergence round and separate durable reopen, then the named matrix: overlapping text/Unicode/undo; in-place/atomic/malformed-then-repaired packs; same/different binary entries; file/folder/case moves; deletion/restore/stale writers; rotate offline/lost ACK/kill/restart/close during traffic. Account for the previously failed Mac-web shutdown case. Existing Mac1274 ordinary acceptance does not close that browser process failure.

On the first correctness failure, preserve ordering and bytes, reduce it to a focused regression, fix the cause and rerun affected checks. After two unsuccessful fixes, reduce the ordering before another change. Do not keep rebuilding and rerunning the entire campaign blindly. Exit: each required named scenario has actual current-client evidence.

### Step 3 Close product workflow and account gaps

Use [application parity matrix](verification/application-parity-matrix.md), T19–T20 and T23 as the finite inventory. Check home List/Cards, folders/search, each template, comments/sharing/presence, attachments/import/export, assistant, CLI/MCP, settings/account UI and Mac extensions. Use `DESIGN.md`, light/dark and native input conventions. Record intentional capabilities rather than forcing every OS primitive to be identical.

Test real account switch/sign-out with pending work and revoke/regrant on current clients. Basic two-account tests have already passed; reuse their authorized sessions when available. If a fresh Apple login requires owner password/2FA, only that interaction is blocked. Continue independent workflows. Exit: each required row has a real result, source-specific regression where needed, and no unexplained identity or retained-work failure.

### Step 4 Finish remaining crash and compatibility boundaries

Inventory named existing T16–T18 tests before adding any. Use local PostgreSQL and actual production interfaces. Kill/reconstruct at missing commit boundaries; test replay identity, audit/ACK gaps, migration interruption, retained pending work, future-format refusal and old/new writer compatibility. Keep process-crash proof distinct from untested power-loss guarantees. Exit: boundary/format tables link runnable checks with expected recovered states.

### Step 5 Run the finite endurance and performance acceptance

Obsolete (owner, 2026-10-22). Skip this step; text below is historical.

Use the existing runner after correctness is green. Original T24 requires at least100 seeded mixed rounds plus60 minutes of bounded observation, then independent durable reopen. It has not run. Define actor deadlines, output bounds, ownership and cleanup before starting. Stop on a correctness failure; retain failed runs separately. Do not extend an incomplete run until it looks successful.

Measure release-mode real clients with hardware/network/dataset/sample counts and p50/p95/p99/max. Original targets: typing p95<50ms; remote text p95<500ms; stable small external write reflection p95<1s; cached workspace usable p95<2s; normal durable close p95<1s. Reconnect and asset budgets must come from a recorded baseline before tuning. Verify zero idle content mutations and finite manifest/listener/queue/document/memory bounds. Exit: measured targets pass or specific shortfalls remain owner-visible. Runner instrumentation preparation is not a measurement result.

### Step 6 Final delivery and closure

Obsolete (owner, 2026-10-22). Skip this step; text below is historical.

Freeze affected product source after needed fixes, reuse only valid matching artifacts, install/deploy the affected surfaces, and run the remaining T26 ordinary-use flows. Use the existing `texttext:project-changelog` procedure for the actual shipped version in `Shoku's Space/My Notes/TextText Changelog.textpack`; preserve the body and deduplicate by shipped change/version. Do not create a replacement changelog in the repo or another workspace.

Update the task ledger, master checkboxes and parity rows from actual receipts. Archive resolved narrative; compact HANDOFF should state current identities, open work and references. Leave user changes and necessary failure evidence intact. The original plan is complete only when its applicable exit criteria pass or the owner explicitly changes scope.

## Genuine dependencies and retained uncertainties

- **Windows first-session close:**1d saved nonempty content locally/hosted and passed fresh reopen and normal close from the reopened note. Two initial session close refusals remain. Back to Notes followed by close is not evidence that immediate close from that first editing session passed. Reproduce only on current affected source and retain truthful distinction.
- **Old Mac-web shutdown:** historical all-six append/reopen passed, followed by a separate60-second browser shutdown failure. Native Mac1274 cycles do not explain or erase it.
- **Changelog access:** existing item is in a separate legacy provider workspace. Prior local reads attempted a denied history write; a private copy read lacked item identity. Existing hosted connection renewal required owner UI unavailable to the earlier tool. Check current access once before repeating a blocker; do not create a token, connector or duplicate item as a workaround.
- **Apple transitions:** authenticated browser navigation passed. A new native/fresh Apple callback/account transition still needs its actual flow; the owner may be needed for authentication/2FA.
- **SSH persistence:** qualified existing account plus Edge/WebView2 mitigation worked. Historical overnight observation passed; coordinated reboot and fresh runtime observation remain. A failed SSH attempt is not evidence that the always-on PC is off.
- **Historical close traces:** the exact original run174 checkpoint refusal reason was not recoverable. Keep the bounded diagnostic gap, metadata-only instrumentation and focused regression coverage; no need to recreate every old run indefinitely.
- **Retained rename/conflict work:** existing mixed5749b5ac and guarded926668f8 have historical path/review discrepancies and retained content. Refresh exact identities/state before any move. Do not reset, fabricate approval/lifecycle, or use filesystem edits to bypass a protected product command.

An unavailable input blocks only its dependent task. Do not repeatedly ask for permissions already granted. Do not claim unknown results as passes to avoid reporting an unfinished requirement.

## Commands and operational entry points

Inspect scripts/config before use; examples identify existing tools, not permission to run every expensive command on every edit.

```sh
cd /Users/shokunin/dev/TextText
git status --short
git log -8 --oneline
git fetch origin main
git pull --ff-only

# Focused source checks selected by the changed boundary
node node_modules/typescript/bin/tsc --noEmit --pretty false
npm run test:sync:client
npm run mac:test
node --test sync/stress/stress.test.mjs

# Full sync with local database when required by the actual task/build
node scripts/with-local-database.mjs npm run test:sync

# Real runner only after reviewing current schema and a fresh finite config
node sync/stress/run.mjs /absolute/path/to/current-real-config.json
```

Mac packaging/install: `mac/scripts/build-store.sh` and `mac/scripts/install-local.sh`. Windows: `windows/scripts/build.ps1` then separate `windows/scripts/install.ps1 -Candidate <actual-sealed-absolute-path>`. These are separate build/install steps; inspect current options. Windows UI acceptance must run in the existing interactive desktop session, not infer window absence from an SSH session.

New Mac builds must use a fresh build number after reading installed metadata. The finished1274 build does not need repeating unless affected product source changes. Preserve native Apple sign-in and extensions. Supported canonical installer verification/health must remain enabled. Old candidate recipes under `/private/tmp` are evidence/examples, not a replacement release workflow or current-source artifact.

## Record each completed work unit

Keep one concise receipt with: task IDs; invariant; source and installed/served identity; exact focused checks and exit status; actual versus controlled scope; failure/replay reference; retained data and recovery/compatibility; remaining uncertainty; next action. Keep secrets, raw journals, full user documents and browser profiles out of git.

For final reporting, distinguish these claims: implemented, source-tested, packaged, installed/deployed, actual normal-use verified, and full-plan complete. The Mac1274 repair reaches actual normal-use verified. The whole application completion plan remains open as listed above.
