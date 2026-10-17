# TextText handoff

## Current work (October 17)

Goal: finish the [27-task completion checklist](plans/shared-app-finish-checklist.md) for durable sync and one application experience across Mac, Windows and web. The [master plan](plans/shared-app-durability-execution.md) defines full scope. Public Mac distribution and OpenAI account sign-in remain excluded.

## Installed and hosted state

- Mac `/Applications/TextText.app`: 0.204 build 1261, from pristine product source `175a9fb6` including save fix `e61d2622`. Actual installed new-note edit, normal quit and reopen passed. Local Store build lacks release attestation; overall runtime health remains unverified.
- Windows: sealed `candidate-f4394b42d0014eb9b9b54f191fe2dd1d`, same product source, installed in the usual Programs/TextText directory. Actual installed new-note edit, normal close and fresh file activation/reopen passed; independent file and Mac CLI reads verified content. Rollback retained.
- Oracle remains `texttext-oracle-20261011T180600Z-136bc176`. New archive for `0884bd4f` passed required source checks and built, but backup preflight refused free space before migration/current switch. Owner approval is pending to remove only 11 redundant October 8 incoming upload archives (3.26 GiB); every backup and unpacked release is retained. Do not lower the storage floor or delete files while approval is pending.

Identities, commands, hashes, rollback paths, failed harness attempts and passing receipts: [October 17 execution record](verification/2026-10-17-completion-progress.md). The existing TextText changelog contains one verified local-install entry.

## Next work and dependencies

T02 SSH workaround persistence is verified through an intervening October 13 reboot, multiple nights and three fresh desktop smoke runs with zero matching Security failures. It remains a runtime workaround. No machine configuration changed.

T05 controlled activation cases now pass, including repeat after completion, navigation away and close during activation. The original run174 refusal receipt was never recorded; its exact reason remains a bounded historical gap. T06 now covers Mac permission denial and Windows cancellation/blocked checkpoint replacement with restart recovery. The [adapter matrix](verification/adapter-conformance-matrix.md) lists remaining common-fixture, ENOSPC and crash-boundary gaps.

Continue independent T06/T07 work while Oracle cleanup approval is pending; then reuse the already verified web archive through the documented web-only workflow. T04 installed offline/reconnect and wider scenarios remain open. T08 onward, full physical six-client matrix, 100 seeded rounds, 60-minute soak, performance and final coherent delivery are unfinished. One passing round does not complete acceptance.

The owner authorized creating a dedicated second TextText account. It is now authenticated through normal MXroute email sign-in in a private isolated browser profile; T23 permission checks are in progress. No developer-login bypass is authorized.

Keep unrelated dirty files untouched: `mac/Package.resolved`, `src/components/workspace/assistant/attachments.ts`, `src/lib/workspace/__tests__/tabs.test.ts`, `mac/scripts/__pycache__/`, `scripts/.probe-editor.ts`. No public Mac release was published.

## References

- [Detailed checklist and current ledger](plans/shared-app-finish-checklist.md)
- [Six-client acceptance contract](verification/six-client-sync-acceptance.md)
- [Lifecycle audit](verification/document-lifecycle-audit.md)
- [Pre-delivery handoff](archive/texttext-handoff-2026-10-17-before-installed-verification.md)
- [Oracle operations](../release/oracle/README.md)
