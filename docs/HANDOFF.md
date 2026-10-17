# TextText handoff

## Current work (October 17)

Goal: finish the [27-task completion checklist](plans/shared-app-finish-checklist.md) for durable sync and one application experience across Mac, Windows and web. The [master plan](plans/shared-app-durability-execution.md) defines full scope. Public Mac distribution and OpenAI account sign-in remain excluded.

## Installed and hosted state

- Mac `/Applications/TextText.app`: 0.204 build 1262, from pristine source `0a5bbd15`, including the captured local barrier and production native close/quit guard. Confirmed-input immediate quit, independent read and visible reopen passed. Local Store build lacks release attestation; overall runtime health remains unverified.
- Windows: sealed `candidate-2dc3df889c6d4df2a068aae6d0a27f15`, source `0a5bbd15`, installed in the usual Programs/TextText directory. Full build, 410 client tests, native smoke and actual installed reopen/normal close passed. Fresh-edit probe is blocked by unavailable foreground input (`GetForegroundWindow=0`); no keystrokes were accepted. App closed normally; rollback retained.
- Oracle remains `texttext-oracle-20261011T180600Z-136bc176`. New archive for `0884bd4f` passed required source checks and built, but backup preflight refused free space before migration/current switch. Owner approval is pending to remove only 11 redundant October 8 incoming upload archives (3.26 GiB); every backup and unpacked release is retained. Do not lower the storage floor or delete files while approval is pending.

Identities, commands, hashes, rollback paths, failed harness attempts and passing receipts: [October 17 execution record](verification/2026-10-17-completion-progress.md). The existing TextText changelog contains one verified local-install entry.

## Next work and dependencies

T02 SSH workaround persistence is verified through an intervening October 13 reboot, multiple nights and three fresh desktop smoke runs with zero matching Security failures. It remains a runtime workaround. No Windows SSH or WebView policy was changed.

T05 controlled activation cases now pass, including repeat after completion, navigation away and close during activation. The original run174 refusal receipt was never recorded; its exact reason remains a bounded historical gap. T06 now covers Mac permission denial and Windows cancellation/blocked checkpoint replacement with restart recovery. The [adapter matrix](verification/adapter-conformance-matrix.md) lists remaining common-fixture, ENOSPC and crash-boundary gaps.

T07 now fixes captured-barrier waiting on later remote checkpoints and stale lifecycle replies; [source verification](verification/2026-10-17-captured-local-barrier.md) passes 101 focused tests, 410 client checks, TypeScript and the real browser epoch test. This newer source fix is installed on Mac; Windows delivery is installed and Oracle deployment remains blocked. Production Mac window close/quit are now wired to a bounded renderer guard with input fencing; [native receipt](verification/2026-10-17-mac-production-close.md) and full Mac suite pass. These native changes are installed in Mac build 1262. Windows final-release input and account boundaries remain open.

Continue independent T06/T07 work while Oracle cleanup approval is pending; then prepare and verify a current-source web archive through the documented web-only workflow; the older prepared archive lacks the captured-barrier change. T04 installed offline/reconnect and wider scenarios remain open. T08 onward, full physical six-client matrix, 100 seeded rounds, 60-minute soak, performance and final coherent delivery are unfinished. One passing round does not complete acceptance.

The owner authorized creating a dedicated second TextText account. It is now authenticated through normal MXroute email sign-in in a private isolated browser profile; T23 viewer/edit/revoke-with-offline-work/viewer-regrant checks passed against the existing deployed bundle. Account-switch, agent identity and current-source physical gates remain open. No developer-login bypass is authorized.

Keep unrelated dirty files untouched: `mac/Package.resolved`, `src/components/workspace/assistant/attachments.ts`, `src/lib/workspace/__tests__/tabs.test.ts`, `mac/scripts/__pycache__/`, `scripts/.probe-editor.ts`. No public Mac release was published.

## References

- [Detailed checklist and current ledger](plans/shared-app-finish-checklist.md)
- [Six-client acceptance contract](verification/six-client-sync-acceptance.md)
- [Lifecycle audit](verification/document-lifecycle-audit.md)
- [Pre-delivery handoff](archive/texttext-handoff-2026-10-17-before-installed-verification.md)
- [Oracle operations](../release/oracle/README.md)
