# TextText handoff

## Current work (October 12)

Goal: durable TextPack sync and live collaboration across Mac app/browser/CLI and Windows app/browser/CLI. The acceptance matrix is [six-client-sync-acceptance.md](verification/six-client-sync-acceptance.md). Preserve user content and recovery journals. Do not publish a public Mac release without an explicit request.

Mac 0.204 build 1260 is installed in `/Applications/TextText.app` from a pristine committed snapshot; it reopened an existing acceptance note after normal quit without a recovery banner. See [Mac local install](verification/2026-10-12-mac-local-install.md). Windows candidate `candidate-25e161b899b84b3182631c25e2ac5f44`, matching source commit `6f55e0f5`, is installed at `C:\Users\Shokunin\AppData\Local\Programs\TextText`. Required native tests, 406 shared-client tests, TypeScript, UI build, publish, and desktop smoke passed. Source identity, seal, rollback, and production-window reopen are in [native empty-home verification](verification/2026-10-11-native-empty-home.md). The [SSH root cause](verification/2026-10-11-windows-account-lockout.md) is separately recorded. The current Windows local-file/home close checks and rollback are in [the local-file receipt](verification/2026-10-11-native-local-file-receipt.md).

Physical six-client receipts under `/private/tmp/texttext-six-20261011/results/`: fresh asset fixture 156 converged text with Mac and PC CLI binary replacements (runs 156-157), reopened exact hashes (158), survived PC app offline/restart (159), and after the native retry survived Mac app offline/restart (164). Separate-process exact-hash reopens passed (166, 168). Three same-position concurrent rounds converged all 18 edits across six clients and Windows normal close passed (167). Mac run 164 and the current Windows candidate builds passed local required checks. Focused collaboration tests and TypeScript pass after the background-open fix.

Current blockers: runs 171–174 still need a narrow explanation for the rejected flush, and run 176 is only one passing round. The recurrent SSH fault was Windows account lockout caused by bad-password attempts from WebView2. A persistent WebView2 feature policy prevented failures across 18 fresh environments; original SSH configuration was restored and verified. The corrected Windows candidate passed, was sealed against commit `63045c8e`, and installed with rollback preserved. An existing note reopened through the production window and the installed executable closed normally; a new-item edit/reopen check remains. See [native receipt](verification/2026-10-11-native-empty-home.md). Do not infer general sync reliability from one passing round.

Packet B fixed false browser-only `flushLocal()` success after storage failure. Browser journals commit through versioned IndexedDB transactions, with the validated localStorage copy retained for migration and recovery. Blocked database open, unsupported schema, migration abort, quota, offline reopen, and native checkpoint rejection are covered. Focused collaboration/navigation tests (97), TypeScript, Chromium persistence/recovery, the client sync gate (406), server commit-before-ack tests (29), and Mac typed-result unit test pass. The previous Windows native smoke passed before the latest guard tightening. Typed results now include a unique client lifecycle ID. Both native close guards also require workspace, item, lifecycle, generation, and durable outcome; the Mac unit test and portable Windows guard tests pass, including malformed JSON types. The current installed Windows candidate adds a guarded local-file durability receipt; details are in the local-file receipt above. Storage-adapter conformance and full crash-boundary fixtures remain open. Further acceptance gates include background-open recovery, same-entry binary conflicts while editing, whole TextPack/folder/delete/restore, two-account permissions, and sustained latency/resource checks. The Windows close guard intentionally keeps the editor open if durable save is unconfirmed; do not bypass it without evidence.

The [synchronous browser transaction failure](verification/2026-10-12-browser-transaction-sync-throw.md) is fixed in source: a thrown IndexedDB request now rejects instead of leaving save/close pending. The 92 focused tests, 407 shared-client tests, TypeScript, and full Mac native suite pass. This source change has not yet been built or installed in either local app or deployed to Oracle.

The [application parity inventory](verification/application-parity-matrix.md) maps the shared workspace UI and the remaining separate native sync engines/runtime gaps. The current execution ledger is in [the playbook](plans/shared-app-executor.md).

Keep unrelated dirty files untouched: `mac/Package.resolved`, `src/components/workspace/assistant/attachments.ts`, `src/lib/workspace/__tests__/tabs.test.ts`, `mac/scripts/__pycache__/`, and `scripts/.probe-editor.ts`. No website or public release was deployed.

## Execution order

Start with the [detailed completion checklist](plans/shared-app-finish-checklist.md), prepared October 17: T01 refreshes current identities; T03–T04 deliver the committed save fix and verify new-item installed close/reopen. It breaks the remaining master scope into 27 tasks with dependencies and evidence requirements. Historical October 12 identities above must be rechecked.

Continue the [implementation playbook](plans/shared-app-executor.md) and [master plan](plans/shared-app-durability-execution.md). Packet A candidate installation and existing-note reopen are verified; finish the historical refusal explanation and a new-item installed edit/reopen. Packet B is in progress; the first storage-failure regression is fixed, but the browser persistence contract is not complete.

## References

- [Prior detailed handoff and receipts](archive/texttext-handoff-pre-6a6f0462.md)
- [Six-client acceptance](verification/six-client-sync-acceptance.md)
- [Live binary sync protocol](verification/live-binary-sync.md)
- [Oracle operations](../release/oracle/README.md)
