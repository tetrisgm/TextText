# TextText handoff

## Current work (October 11)

Goal: durable TextPack sync and live collaboration across Mac app/browser/CLI and Windows app/browser/CLI. The acceptance matrix is [six-client-sync-acceptance.md](verification/six-client-sync-acceptance.md). Preserve user content and recovery journals. Do not publish a public Mac release without an explicit request.

Mac 0.204 build 1259 remains installed in `/Applications/TextText.app`; it reopened the existing iCloud workspace and stress fixture 156 without a recovery banner. Windows candidate `candidate-dcaff9307bab48ac87f67791ec698b16`, matching source commit `01745e4e`, is installed at `C:\Users\Shokunin\AppData\Local\Programs\TextText`. Required native tests, 406 shared-client tests, TypeScript, UI build, publish, and desktop smoke passed. Source identity, seal, rollback, and repeated smoke receipts are in [Windows verification](verification/2026-10-11-windows-account-lockout.md).

Physical six-client receipts under `/private/tmp/texttext-six-20261011/results/`: fresh asset fixture 156 converged text with Mac and PC CLI binary replacements (runs 156-157), reopened exact hashes (158), survived PC app offline/restart (159), and after the native retry survived Mac app offline/restart (164). Separate-process exact-hash reopens passed (166, 168). Three same-position concurrent rounds converged all 18 edits across six clients and Windows normal close passed (167). Mac run 164 and Windows candidate builds passed local required checks. Focused collaboration tests and TypeScript pass after the background-open fix.

Current blockers: runs 171–174 still need a narrow explanation for the rejected flush, and run 176 is only one passing round. The recurrent SSH fault was Windows account lockout caused by bad-password attempts from WebView2. A persistent WebView2 feature policy prevented failures across 18 fresh environments; original SSH configuration was restored and verified. The full corrected Windows candidate passed, was sealed against commit `01745e4e`, and installed with rollback preserved. See [root cause, workaround, and receipts](verification/2026-10-11-windows-account-lockout.md). Ordinary installed workspace use remains to verify. Do not infer general sync reliability from one passing round.

Packet B fixed false browser-only `flushLocal()` success after storage failure. Browser journals commit through versioned IndexedDB transactions, with the validated localStorage copy retained for migration and recovery. Blocked database open, unsupported schema, migration abort, quota, offline reopen, and native checkpoint rejection are covered. Focused collaboration/navigation tests (97), TypeScript, Chromium persistence/recovery, the client sync gate (406), server commit-before-ack tests (29), and Mac typed-result unit test pass. The previous Windows native smoke passed before the latest guard tightening. Typed results now include a unique client lifecycle ID. Both native close guards also require workspace, item, lifecycle, generation, and durable outcome; the Mac unit test and portable Windows guard tests pass, including malformed JSON types. The full post-fix Windows candidate `candidate-dcaff9307bab48ac87f67791ec698b16` is sealed and installed; details are in the root-cause receipt above. Storage-adapter conformance and full crash-boundary fixtures remain open. Further acceptance gates include background-open recovery, same-entry binary conflicts while editing, whole TextPack/folder/delete/restore, two-account permissions, and sustained latency/resource checks. The Windows close guard intentionally keeps the editor open if durable save is unconfirmed; do not bypass it without evidence.

The [application parity inventory](verification/application-parity-matrix.md) maps the shared workspace UI and the remaining separate native sync engines/runtime gaps. The current execution ledger is in [the playbook](plans/shared-app-executor.md).

Keep unrelated dirty files untouched: `mac/Package.resolved`, `src/components/workspace/assistant/attachments.ts`, `src/lib/workspace/__tests__/tabs.test.ts`, `mac/scripts/__pycache__/`, and `scripts/.probe-editor.ts`. No website or public release was deployed.

## Execution order

Continue the [implementation playbook](plans/shared-app-executor.md) and [master plan](plans/shared-app-durability-execution.md). Packet A candidate installation is verified; finish the historical refusal explanation and ordinary installed use. Packet B is in progress; the first storage-failure regression is fixed, but the browser persistence contract is not complete.

## References

- [Prior detailed handoff and receipts](archive/texttext-handoff-pre-6a6f0462.md)
- [Six-client acceptance](verification/six-client-sync-acceptance.md)
- [Live binary sync protocol](verification/live-binary-sync.md)
- [Oracle operations](../release/oracle/README.md)
