# TextText handoff

## Current work (October 11)

Goal: durable TextPack sync and live collaboration across Mac app/browser/CLI and Windows app/browser/CLI. The acceptance matrix is [six-client-sync-acceptance.md](verification/six-client-sync-acceptance.md). Preserve user content and recovery journals. Do not publish a public Mac release without an explicit request.

Mac 0.204 build 1259 is installed in `/Applications/TextText.app`. It reopened the existing iCloud workspace and stress fixture 156 without a recovery banner; the previously observed recovery on build 1258 cleared on reopening, with clean persisted browser and native journals. The matching verified Windows candidate `candidate-6df48cc9b50346c48df2654a051c979e` is installed at `C:\Users\Shokunin\AppData\Local\Programs\TextText`; its executable hash matches the sealed candidate and its previous version is preserved beside it. Commit `ecc36ea3` pauses rather than falsely retiring a stale pending journal when a window opens in the background. Mac build 1259 passed required checks, and the PC build passed native tests, 400 shared-client tests, TypeScript, UI build, and desktop smoke.

Physical six-client receipts under `/private/tmp/texttext-six-20261011/results/`: fresh asset fixture 156 converged text with Mac and PC CLI binary replacements (runs 156-157), reopened exact hashes (158), survived PC app offline/restart (159), and after the native retry survived Mac app offline/restart (164). Separate-process exact-hash reopens passed (166, 168). Three same-position concurrent rounds converged all 18 edits across six clients and Windows normal close passed (167). Mac run 164 and Windows candidate builds passed local required checks. Focused collaboration tests and TypeScript pass after the background-open fix.

Remaining: repeat background-open and close recovery probes on both installed apps; prove explicit same-entry binary conflict resolution while editing; complete acceptance matrix for whole TextPack/folder/delete/restore/two-account permissions and sustained latency/resource checks. An intermittent Windows `Keep editing` dialog occurred on fixture 150 but did not recur on fresh fixtures 152-154, 164, or 167. The Windows close guard intentionally keeps the editor open if its durable save is unconfirmed; do not claim the underlying binary conflict eliminated without a targeted repeat.

Keep unrelated dirty files untouched: `mac/Package.resolved`, `src/components/workspace/assistant/attachments.ts`, `src/lib/workspace/__tests__/tabs.test.ts`, `mac/scripts/__pycache__/`, and `scripts/.probe-editor.ts`. Main has unpushed work; no website or public release was deployed.

## References

- [Prior detailed handoff and receipts](archive/texttext-handoff-pre-6a6f0462.md)
- [Six-client acceptance](verification/six-client-sync-acceptance.md)
- [Live binary sync protocol](verification/live-binary-sync.md)
- [Oracle operations](../release/oracle/README.md)
