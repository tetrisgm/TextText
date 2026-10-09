# Six-client attempt full1235: failed

Fixture `5f211864-df09-4bf6-9410-918c19dfb0eb`, workspace
`be28ae03-c64e-4695-80af-04f048f86f37`; coordinated start
2026-10-09 05:31:02 UTC. Mac app, Safari, Windows app, visible Edge,
and atomic TextPack writers on both machines all supplied input.

## Observed failure

Windows accepted its six local markers but received no browser markers.
After the PC CLI atomic replacement at 05:31:17.803 UTC, its editor reported
an external-file conflict at 05:31:18.066 UTC. The terminal receipt failed on
missing `[pc-web:full1235:00]`; `native.flushResult` returned `ok:false`.
Preserve the failed editor and its local recovery state.

Mac app and Safari converged with each other and received Edge and Mac CLI
changes. They did not receive the Windows app or PC CLI markers. Both Mac
editors subsequently finished normally. This is not a six-client pass.

## Test limitations to correct

- Windows used the isolated production-window runner referencing source
  3319, not a newly built current-source runner. Its ready condition checks
  contenteditable, not an established collaboration session.
- The newly created empty Mac TextPack was copied to the PC before startup
  because its stopped app had not downloaded it. Investigate baseline
  adoption and local-to-shared promotion for this case.
- Safari autocapitalized the first typed marker. A manual correction during
  concurrent input altered that text further. First-marker corruption is
  not independently proven to be a sync bug. Use pasted atomic markers for
  convergence assertions and a separate controlled typing/selection test.

## Evidence and next work

Mac evidence: `/tmp/texttext-six-full1235/`, including plan, CLI snapshots,
CLI event receipts and copied Windows `full1235-app-receipts/events.jsonl`
and `result.json`. Original Windows receipts remain under
`C:\Users\Shokunin\dev\full1235-{app,browser,cli}-receipts`.
Browser profile files are live and are not a complete copied backup.

Trace why Windows stayed in local persistence before accepting input.
Validate baseline readiness and promotion against the actual sync state;
do not merely delay the test or suppress the conflict banner. Rebuild the
runner from the candidate source before the next acceptance attempt.

## Baseline diagnosis

PC `sync.json` has no baseline for this item. It retained conflict operation
`a7d2b4f7-2e8e-4b05-8f61-76a4901afb9d`, remote revision
`688889f75100d035a8f0e89d97d1cbe999ce8a8deb4c50d72180230923325580`,
local hash `7f39779628ca068920124a6b5585428039f4768d4aea14df9ff1ed2d466aea2b`.
Both preserved archives were copied to the Mac receipt directory as
`pc-{initial,remote}-conflict.textpack`. Their bodies are empty and their
document snapshots have identical values, with different JSON object order.
The local Markdown additionally contains `workspace`, `mode`, `slug` and an
empty `excerpt`, emitted by the shared client's Markdown projection.

Windows archive equivalence compared document JSON bytes, so harmless object
ordering could itself prevent baseline adoption. That comparison now handles
JSON object order and whitespace, rejects duplicate properties, and continues
to compare Markdown and all other entries exactly. The native core suite passes
(`/tmp/texttext-json-equivalence-tests.log`). This is a partial correction:
the extra Markdown projection fields still require a metadata-preserving
reconciliation policy before this particular pair can join collaboration.
No test data, pending journal or conflict operation has been cleared.

The next candidate conditionally uploads additive generated header fields
(`workspace`, `mode`, `slug`, empty `excerpt`) rather than throwing them away.
It requires an otherwise equivalent archive and identical Markdown body, keeps
all existing remote header values, persists the downloaded base and uses the
normal durable upload queue. Empty ZIP directory entries do not affect equality.
Authored additional fields and changed values still require reconciliation.
Native regressions cover restart before commit, lost ACK, competing server
content, duplicate headers and authored metadata exclusions. All native core
tests pass in `/tmp/texttext-metadata-adoption-tests.log`. A separate read-only
probe against the actual retained archives passes in
`/tmp/texttext-metadata-real-fixture`.

Claude Fable 5.1 Low independently reviewed the change via CLI; findings are
in `/tmp/texttext-metadata-claude-review.json`. Its broad-field and local-race
concerns led to a narrower field set and pre-adoption hash check. Server writer
inspection confirms that ordinary uploads persist input bytes; concurrent merges
use the existing three-way archive reconciler. Installed-client verification
and recovery of the already-conflicted fixture are still outstanding.
