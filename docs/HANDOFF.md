# TextText handoff

## Current work (October 11)

Goal: durable TextPack sync and live collaboration across Mac app/browser/CLI and Windows app/browser/CLI. The acceptance matrix is [six-client-sync-acceptance.md](verification/six-client-sync-acceptance.md). Preserve user content and recovery journals. Do not publish a public Mac release without an explicit request.

Mac 0.204 build 1258 is installed in `/Applications/TextText.app`. The matching verified Windows candidate is installed at `C:\Users\Shokunin\AppData\Local\Programs\TextText`; its previous version is preserved beside it. The current source includes commits `dee1e7ee` (same-epoch pending restart), `2bc2855e` (native open baseline retry), and a new uncommitted fix to pause rather than falsely retire a stale pending journal when the Mac window opens in the background. Mac build 1259 is in progress. The installed 1258 app showed an old stress fixture in recovery once, but subsequently opened that fixture normally with its current content; the persisted browser and native journals were clean. Verify build 1259 after install.

Physical six-client receipts under `/private/tmp/texttext-six-20261011/results/`: fresh asset fixture 156 converged text with Mac and PC CLI binary replacements (runs 156-157), reopened exact hashes (158), survived PC app offline/restart (159), and after the native retry survived Mac app offline/restart (164). Separate-process exact-hash reopens passed (166, 168). Three same-position concurrent rounds converged all 18 edits across six clients and Windows normal close passed (167). Mac run 164 and Windows candidate builds passed local required checks. Focused collaboration tests and TypeScript pass after the background-open fix.

Remaining: install/verify Mac 1259; repeat background-open and close recovery probes on installed apps; prove explicit same-entry binary conflict resolution while editing; complete acceptance matrix for whole TextPack/folder/delete/restore/two-account permissions and sustained latency/resource checks. An intermittent Windows `Keep editing` dialog occurred on fixture 150 but did not recur on fresh fixtures 152-154, 164, or 167. Do not claim that case eliminated without a targeted repeat.

Keep unrelated dirty files untouched: `mac/Package.resolved`, `src/components/workspace/assistant/attachments.ts`, `src/lib/workspace/__tests__/tabs.test.ts`, `mac/scripts/__pycache__/`, and `scripts/.probe-editor.ts`. Main has unpushed work; no website or public release was deployed.

## References

- [Prior detailed handoff and receipts](archive/texttext-handoff-pre-6a6f0462.md)
- [Six-client acceptance](verification/six-client-sync-acceptance.md)
- [Live binary sync protocol](verification/live-binary-sync.md)
- [Oracle operations](../release/oracle/README.md)
