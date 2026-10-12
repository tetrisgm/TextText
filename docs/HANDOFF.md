# TextText handoff

## Current work (October 11)

Goal: durable TextPack sync and live collaboration across Mac app/browser/CLI and Windows app/browser/CLI. The acceptance matrix is [six-client-sync-acceptance.md](verification/six-client-sync-acceptance.md). Preserve user content and recovery journals. Do not publish a public Mac release without an explicit request.

Mac 0.204 build 1259 is installed in `/Applications/TextText.app`. It reopened the existing iCloud workspace and stress fixture 156 without a recovery banner; the previously observed recovery on build 1258 cleared on reopening, with clean persisted browser and native journals. The matching verified Windows candidate `candidate-6df48cc9b50346c48df2654a051c979e` is installed at `C:\Users\Shokunin\AppData\Local\Programs\TextText`; its executable hash matches the sealed candidate and its previous version is preserved beside it. Commit `ecc36ea3` pauses rather than falsely retiring a stale pending journal when a window opens in the background. Mac build 1259 passed required checks, and the PC build passed native tests, 400 shared-client tests, TypeScript, UI build, and desktop smoke.

Physical six-client receipts under `/private/tmp/texttext-six-20261011/results/`: fresh asset fixture 156 converged text with Mac and PC CLI binary replacements (runs 156-157), reopened exact hashes (158), survived PC app offline/restart (159), and after the native retry survived Mac app offline/restart (164). Separate-process exact-hash reopens passed (166, 168). Three same-position concurrent rounds converged all 18 edits across six clients and Windows normal close passed (167). Mac run 164 and Windows candidate builds passed local required checks. Focused collaboration tests and TypeScript pass after the background-open fix.

Current blocker: the Windows close incident remains intermittent. Runs 171–174 failed after six-client convergence; run 175 passed. The stress actor had requested the same file twice. Production now deduplicates queued/in-progress activation, and the actor makes one request. A controlled native WebView test also proves close requested during activation waits for its flush. The Windows full build and native smoke passed; fresh six-client run 176 converged and closed normally. Detailed evidence, ownership map, and remaining diagnostic work: [document lifecycle audit](verification/document-lifecycle-audit.md). The latest code is not yet installed on Windows; PC SSH began resetting after run 176. Do not infer general sync reliability from the passing round.

Remaining after close: repeat background-open recovery probes; prove explicit same-entry binary conflict resolution while editing; complete acceptance matrix for whole TextPack/folder/delete/restore/two-account permissions and sustained latency/resource checks. The Windows close guard intentionally keeps the editor open if durable save is unconfirmed; do not bypass it without evidence.

Keep unrelated dirty files untouched: `mac/Package.resolved`, `src/components/workspace/assistant/attachments.ts`, `src/lib/workspace/__tests__/tabs.test.ts`, `mac/scripts/__pycache__/`, and `scripts/.probe-editor.ts`. Main has unpushed work; no website or public release was deployed.

## Execution order

Follow [Shared application and durability execution plan](plans/shared-app-durability-execution.md). Start with P0 ownership/close-failure audit; the latest one-round run 175 passed but does not resolve the intermittent failure. The plan contains phase gates and the progress ledger.

## References

- [Prior detailed handoff and receipts](archive/texttext-handoff-pre-6a6f0462.md)
- [Six-client acceptance](verification/six-client-sync-acceptance.md)
- [Live binary sync protocol](verification/live-binary-sync.md)
- [Oracle operations](../release/oracle/README.md)
