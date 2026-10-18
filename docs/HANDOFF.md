# TextText handoff

## Objective

Finish the [27-task checklist](plans/shared-app-finish-checklist.md) and [master plan](plans/shared-app-durability-execution.md): durable sync and a consistent Mac/Windows/web experience. Public Mac distribution and OpenAI account sign-in remain excluded.

## Active work, October 18

- Native retained saves, removals and moves, including leaf case-only changes through active/pending shared editors, pass relevant Mac and actual-PC source gates. Mac old-case alias writes/removals/moves also pass. Windows alias mutation and authoritative folder-casing reconciliation remain open.
- A broader Mac suite exposed an actual compatibility regression: identityless legacy TextPack writes fail. Restore byte-preserving writes through explicit path-bound retained recovery; do not change those CLI fixtures to insert IDs. The separate offline-window fixture now passes with verified account ownership and a fresh complete bundle; set `TEXTTEXT_VAULT_WINDOW_TEST_BUNDLE` to current assets when running it.
- The physical runner supports malformed/repair holds and observed typing during normal Windows close, in addition to source/artifact/principal pins, restart re-attestation, keyboard undo/redo, multi-field observations, browser crash and ordinary file writes. These are source/driver fixtures, not the pending physical campaign; other close roles and scenario combinations remain open.
- Shared retry and lifecycle classifiers already run through the packaged TypeScript owner. Shared queue eligibility/budget selection and native consumers are being verified now. Consult the [lifecycle receipt](verification/2026-10-17-mirror-lifecycle-policy.md) before repeating that implementation.

## Verified source references

- [Shared application full gate and enabled local PostgreSQL](verification/2026-10-18-shared-full-gate.md).
- [Mac retained moves](verification/2026-10-18-retained-move.md), [Windows retained moves and case-only leaf names](verification/2026-10-18-windows-retained-move.md), [shared move recovery UI](verification/2026-10-18-move-recovery-ui.md).
- [Retained replacement](verification/2026-10-18-retained-replacement-native.md), [Mac removal](verification/2026-10-18-retained-removal.md), [Windows removal](verification/2026-10-18-windows-retained-removal.md), [profile reads and parent-path guards](verification/2026-10-18-parent-path-and-profile-reads.md).
- [Process crash/receipt replay](verification/2026-10-18-file-write-process-crash.md), [account-scoped routing](verification/2026-10-18-web-workspace-routing.md).
- [Legacy path-bound replacement work](verification/2026-10-18-legacy-path-replacement.md).
- [Shared Mac case changes and alias recovery](verification/2026-10-18-shared-leaf-case-and-alias.md), [malformed repair runner](verification/2026-10-18-malformed-repair-runner.md), [close with observed traffic](verification/2026-10-18-close-traffic-runner.md).
- [Live editor inspection](verification/2026-10-18-live-document-inspection.md), [multi-field runner](verification/2026-10-18-multi-field-runner-preparation.md), [browser crash runner](verification/2026-10-18-browser-crash-runner.md), [ordinary file writes](verification/2026-10-18-ordinary-file-write-runner.md).

## Installed and hosted state

| Surface | Current recorded delivery |
| --- | --- |
| Mac | `/Applications/TextText.app`, 0.204 build 1262, source `0a5bbd15`. Local Store shape lacks release attestation; overall runtime health remains unverified. |
| Windows | `candidate-b7f4c5a5fa2a49e3b87223746055ae2d`, source `65417abd`, installed in the usual Programs/TextText directory. Normal edit/close/reopen and reconnect passed; rollback retained. |
| Oracle | `texttext-oracle-20261017T122053Z-316901bf`; no newer deployment. [October 18 read-only preflight](verification/2026-10-18-oracle-readonly-preflight.md): active service, scheduled backup success, about 8.5 GiB free. |

New source has not been installed or deployed. Local builds/installs and required Oracle web deployments are already authorized. Final deployment still needs its own fresh backup, migration, health and authenticated smoke.

## Remaining acceptance

Complete the supported current six-client correctness/reopen matrix, active native account switches, real template/agent/MCP workflows, wider provider/crash/upgrade boundaries, 100 seeded rounds, 60-minute soak, and actual T25 latency distributions. Then produce one coherent candidate set, normal installs/deploy, compatible recovery instructions, installed acceptance and the required TextText changelog entry. Source/driver fixtures never substitute for physical acceptance.

The second acceptance account already exists and is authenticated; preserve its pending revoked work. T02 has clean launch and overnight observations but still needs a coordinated post-mitigation PC reboot; [receipt](verification/2026-10-11-windows-account-lockout.md). Do not surprise-reboot active work.

Preserve unrelated dirty `mac/Package.resolved`, `src/components/workspace/assistant/attachments.ts`, `src/lib/workspace/__tests__/tabs.test.ts`, `mac/scripts/__pycache__/`, and `scripts/.probe-editor.ts`. Preserve Package.resolved bytes around Swift commands. Run one heavy Mac gate at a time; actual-PC gates can run independently.

## Earlier evidence

[Prior handoff snapshot](archive/texttext-handoff-2026-10-18-before-current-work-summary.md) retains installed histories, bounded original-close diagnostic gaps, account/provider details and older receipts. [October 17 execution record](verification/2026-10-17-completion-progress.md), [six-client acceptance contract](verification/six-client-sync-acceptance.md), [Oracle operations](../release/oracle/README.md).
