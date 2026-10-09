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
