# TextText handoff

## Objective

Finish the [27-task checklist](plans/shared-app-finish-checklist.md) and [master plan](plans/shared-app-durability-execution.md) on main. Continue ready work until completion or a dependency prevents all useful work. Public Mac distribution and OpenAI account sign-in are excluded. Source/private-actor tests do not replace installed physical acceptance.

## Active work, October 18

1. **Native local-to-shared input handoff:** reviewed and pushed in35c726dd. Single mounted editor, exact Yjs transfer/restart, bounded versioned recovery drafts, native private profile floor4 and generation/CAS/ACK guards pass588 registered client tests,28 controlled browser scenarios, TypeScript/verifier checks,33 Mac native tests and Windows Core/bridge/WPF checks. Independent source review found no blockers. [Source receipt and limits](verification/2026-10-18-single-editor-native-handoff.md), [native compatibility proof](verification/2026-10-18-native-local-handoff-floor.md). Preparing frozen normal build1268 and full build gates; not yet installed. No live profile migration occurred. Physical typing/save/reopen acceptance remains.
2. **Apple callback fix:** immutable Auth.js response headers caused live HTTP500. Repair0d937226 passed regression/TypeScript and a full standard web-only release dry run. Prepared exact artifact is ready locally; upload/deploy is blocked by the existing space guard and pending approval below. [Candidate and exact space math](verification/2026-10-18-apple-fix-web-candidate.md), [cause and source repair](verification/2026-10-18-apple-resume-immutable-response.md). The owner's Apple attempt also failed OAuth state validation; a fresh attempt follows deployment, not before it.
3. **T20 folder defaults:** actual authenticated CLI create-only/default-switch/restore, immutable pins, explicit override, idempotent retry after default changes and stale-CAS refusal pass. Installed Mac UI shows expected v1/v2/note presentations. Default is restored to custom v2. [Evidence and limits](verification/2026-10-18-folder-default-pinning.md). Browser/Windows UI, assistant/MCP, audit/permission/response-loss and retirement remain separate obligations.

## Actual delivered state

| Surface | Verified state |
| --- | --- |
| Mac | `/Applications/TextText.app`, **0.204 (1267)**, source090388f3. Full release/sync/native/signature/18-health gates and official install/runtime health pass. Two fresh delayed-input notes saved exactly; first independently quit/reopened. Immediate input navigated unexpectedly; app normally closed after preserving test notes and T20 UI checks. [Installed evidence](verification/2026-10-18-mac-1267-installed-check.md). |
| Windows | Installed F994 candidate3f89d7fb5e0a4c899087c6d79ef28593; owner PID40636 remains open/responding. Latest same-source642ce9f4 normal candidate61ceeb41e8114e2bb5c6e39fcbbdc20a and private actor pass/sealed, not installed. [Receipt scope](verification/2026-10-18-mac-1266-installed-check.md). |
| Oracle | `texttext-oracle-20261018T174659Z-f994b8f`, active, prior public/loopback/source identity and13 authenticated smoke checks pass. TextText and unrelated Algorave services remain active; no later deployment occurred. |
| CLI | Signed source55890b9c; shim targets `~/.local/share/texttext-cli/source-55890b9c/texttext`. Signature/arm64/help verified; previous binary retained. CLI hosted commands use existing authentication and do not modify selected local packs. |

## Unresolved failures and preserved work

- **Clean new-note checkpoint failure:**1265 and1266 entered recovery before typing. Supported copy/reopen preserved owned notes.1266 export captures clean generation1/epoch1/seq0, code503 with withheld details; this is a generic native code, not proof of HTTP. Native pack/projection/checkpoint match; later state has no same-item outbox/conflict.1267 bounded typed diagnostic is installed, but the failure did not recur in two delayed-input attempts. Cause remains unresolved; diagnostic-only changes are not a fix. [1266 capture](verification/2026-10-18-mac-1266-installed-check.md), [typed diagnostic](verification/2026-10-18-native-checkpoint-failure-kind.md).
- **1264 rapid-input rejection:** original pending update and acknowledged batch remain retained. Controlled whitespace-title representation conflict maps503 and does not prove the original generic400/413/422 retirement cause. No automatic retirement revival or journal reset. [Repair and limits](verification/2026-10-18-authored-title-whitespace.md), [installed review](verification/2026-10-18-mac-1264-installed-review.md).
- Latest verified preinstall backup: `PreinstallBackups/20261018-before-1267-native-diagnostic`,2,425 vault/808 actual device-state/46 prior-app files, manifestf5fef458e2b58a5cfdc29e801ba9de9d56858adef8cb779eab66d13b1bde4173. Later owned UI/CLI work changed current state; create a new stable backup before the next install. Preserve older backups and every pending journal; never run an older binary against upgraded state. [Earlier retained-state review](verification/2026-10-18-mac-1266-installed-check.md).

## External dependencies

- **Windows normal close:** human saved-work review/normal close remains requested. After exit, create a fresh stable actual vault/device-state backup, verify the sealed candidate, then official installation. No force-close, fabricated markers, ad hoc native automation or reboot.
- **Oracle space:** at21:25UTC free7,811,076,096 bytes. Prepared232,778,146-byte archive plus660,910,211 logical unpacked bytes would breach the unchanged5GiB backup allowance +2GiB floor. Separate approval is pending for **ten exact redundant October9 upload archives**,3,119,945,605 bytes. Earlier eleven October8 archives were already deleted under their own approval. No new deletion/upload. Proposal `/private/tmp/texttext-oracle-oct9-approval-proposal-20261018.json`; revalidate paths, backups, mtimes and running work before an approved deletion. Preserve unpacked/current/previous releases and backups.
- **Authentication/changelog:** hosted TextText MCP needs existing-connection renewal; no managed reconnection tool was found and computer-use access to Codex is explicitly blocked. Owner app UI is required; create no connection/token/profile. Existing `Shoku's Space/My Notes/TextText Changelog.textpack` is outside current CLI workspace; no duplicate. Browser Apple completion returned500/no TextText session; repair is prepared, not deployed.
- **SSH persistence:** workaround remains present; latest actual PC candidate interval20:05:53–20:11:45UTC had zero matching Shokunin4625/4740 events. Boot remains October14; coordinated reboot proof still pending other active work. Existing Edge-fix coordination authorization does not permit unrelated chat messaging. [Lockout evidence](verification/2026-10-11-windows-account-lockout.md).

## Remaining acceptance

- T19–T20: remaining platform UI/light-dark, wider assets/assistant/MCP/permissions/audit, template retirement and real response-loss checks. Prior retirement proposal expired; no retirement applied. Do not reuse its expired preview.
- T21–T22: current all-six readiness and separate durable reopen, then physical operation/crash/provider matrix. Browser lost-ACK, bounded external leaf move and immutable mixed-schedule drivers pass source gates; physical campaigns remain unrun. New finite quiet-dwell correlation642ce9f4 is source-tested/sealed in the latest Windows candidate; full T24/resource acceptance is not implied.
- T23: historical real viewer/edit/revoke/regrant passed; current native account transitions and agent identity remain. Preserve existing second account's revoked pending work; create no accounts.
- T24–T25: actual100 mixed rounds,60-minute soak, resource/idle bounds and release-hardware performance distributions remain. Null/unmeasured telemetry is not zero.
- T26–T27: coherent final delivery/installed matrix, existing TextText changelog and evidence closure remain.

## Work ownership and references

Main only, no worktrees. One heavy Mac compiler/gate at a time; PC compiler is independent. Serialize Git index changes. Preserve unrelated `mac/Package.resolved`, assistant attachments, tabs test, `mac/scripts/__pycache__/` and the untracked editor probe. Owner Package.resolved SHA-256 remains `eea669ec76b68673014c10c95b90e721c14d67c99de5756f5c8071c968306edb`; save/restore exact bytes around Swift.

[Historical handoff](archive/texttext-handoff-2026-10-18-before-1265.md), [execution ledger](plans/shared-app-finish-checklist.md), [six-client contract](verification/six-client-sync-acceptance.md), [Oracle operations](../release/oracle/README.md), [title focus source check](verification/2026-10-18-title-promotion-focus.md).
