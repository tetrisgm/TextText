# TextText handoff

## Current work (October 17)

Goal: finish the [27-task completion checklist](plans/shared-app-finish-checklist.md) for durable sync and one application experience across Mac, Windows and web. The [master plan](plans/shared-app-durability-execution.md) defines full scope. Public Mac distribution and OpenAI account sign-in remain excluded.

## Installed and hosted state

- Mac `/Applications/TextText.app`: 0.204 build 1262, from pristine source `0a5bbd15`, including the captured local barrier and production native close/quit guard. Confirmed-input immediate quit, independent read and visible reopen passed. Local Store build lacks release attestation; overall runtime health remains unverified.
- Windows: sealed `candidate-b7f4c5a5fa2a49e3b87223746055ae2d`, source `65417abd`, installed in the usual Programs/TextText directory. Full build, 410 client tests, native smoke and actual installed reopen/normal close passed. Fresh-edit/normal-close/reopen and bounded reconnect now pass; complete content independently verified on server and Mac. The foreground issue was the non-locking three-minute Flux screensaver; normal dismissal restored input, with no settings changed. Rollback retained.
- Oracle now serves `texttext-oracle-20261017T122053Z-316901bf`. The owner-approved 11 incoming archives were removed after exact-path validation; fresh backup, migration, health and authenticated smoke passed. Previous October11 deployment is retained; no storage blocker remains.

Identities, commands, hashes, rollback paths, failed harness attempts and passing receipts: [October 17 execution record](verification/2026-10-17-completion-progress.md). The existing TextText changelog contains one verified local-install entry.

## Next work and dependencies

T02 SSH workaround persistence is verified through an intervening October 13 reboot, multiple nights and three fresh desktop smoke runs with zero matching Security failures. It remains a runtime workaround. No Windows SSH or WebView policy was changed.

T05 controlled activation cases now pass, including repeat after completion, navigation away and close during activation. The original run174 refusal receipt was never recorded; its exact reason remains a bounded historical gap. T06 adapter conformance is verified: shared absent-file scenario, schema refusal, permission/replace/cancel behavior and real Mac/Windows disk-full repair/reopen pass. The [receipt](verification/2026-10-17-adapter-conformance.md) distinguishes these tests from later physical/provider/crash campaigns.

T07 now fixes captured-barrier waiting on later remote checkpoints and stale lifecycle replies; [source verification](verification/2026-10-17-captured-local-barrier.md) passes 101 focused tests, 410 client checks, TypeScript and the real browser epoch test. This newer source fix is installed on Mac; Windows delivery is installed and Oracle deployment is verified. Production Mac window close/quit are now wired to a bounded renderer guard with input fencing; [native receipt](verification/2026-10-17-mac-production-close.md) and full Mac suite pass. These native changes are installed in Mac build 1262. Windows final-close input fence now passes the production-window smoke; it is installed and verified in the fresh sealed candidate. Account boundaries remain open.

Continue T07 native account-boundary work, then T08 shared ownership. The [browser account slice](verification/2026-10-17-account-bound-browser.md) now scopes journals/draft roots and fences changed-cookie requests in source; native identity caching/checkpoints, legacy adoption and physical account-switch tests remain. It is not installed/deployed. The native Windows input-fence regression failed before and passed after the minimal production fix; see [receipt](verification/2026-10-17-windows-close-input.md). T04 installed offline/reconnect and wider scenarios remain open. T08 onward, full physical six-client matrix, 100 seeded rounds, 60-minute soak, performance and final coherent delivery are unfinished. One passing round does not complete acceptance.

The owner authorized creating a dedicated second TextText account. It is now authenticated through normal MXroute email sign-in in a private isolated browser profile; T23 viewer/edit/revoke-with-offline-work/viewer-regrant checks passed; scoped viewer read/write-denial and pending-work retention were repeated against the new current deployment. Account-switch, agent identity and current-source physical gates remain open. No developer-login bypass is authorized.

Keep unrelated dirty files untouched: `mac/Package.resolved`, `src/components/workspace/assistant/attachments.ts`, `src/lib/workspace/__tests__/tabs.test.ts`, `mac/scripts/__pycache__/`, `scripts/.probe-editor.ts`. No public Mac release was published.

## References

- [Detailed checklist and current ledger](plans/shared-app-finish-checklist.md)
- [Six-client acceptance contract](verification/six-client-sync-acceptance.md)
- [Lifecycle audit](verification/document-lifecycle-audit.md)
- [Pre-delivery handoff](archive/texttext-handoff-2026-10-17-before-installed-verification.md)
- [Oracle operations](../release/oracle/README.md)
