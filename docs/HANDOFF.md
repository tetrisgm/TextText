# TextText handoff

## Current work (October 11)

Source `76322731` defers an open Mac editor's binary upload until it has
imported a simultaneous direct-file text edit; 39 Mac sync tests pass.
Store-shaped Mac 0.203 build 1254 is installed in `/Applications` and opened
the current iCloud workspace with the final test note. The matching Windows
candidate is installed. No website or public Mac release was deployed.

Physical six-client receipts on fresh fixtures:

- PC CLI combined text/attachment replacement and fresh-process reopen:
  `/private/tmp/texttext-six-20261011/results/stress-2026-10-11T19-22-46-762Z-101`
  and `stress-2026-10-11T19-23-55-901Z-102` alongside it.
- Mac CLI combined text/attachment replacement and reopen after the fix:
  `stress-2026-10-11T19-46-53-400Z-109` and
  `stress-2026-10-11T19-48-30-176Z-110` alongside it. The earlier seed 105
  lost a CLI text marker; its failure receipt is retained.
- Both CLIs replacing **different** assets during two rounds while four editors
  changed text, followed by all six reopening: `stress-2026-10-11T20-01-04-011Z-111`
  and `stress-2026-10-11T20-02-33-181Z-112` alongside it. Zero rejected edits,
  exact final text and both asset hashes.

Next: same-entry asset conflict with preserved versions, whole TextPack and folder
operations, delete/restore, two-account permissions, and sustained latency and
resource measurements. The normal Windows “Keep editing” close path has not
been separately reproduced on the latest installed candidate. Do not certify
full sync or ship a public release until the remaining matrix passes.

Unrelated dirty files in `mac/Package.resolved`, assistant attachments, tabs
tests, `mac/scripts/__pycache__/`, and `scripts/.probe-editor.ts` belong to
other work; preserve them.

## References

- [Six-client acceptance and receipts](verification/six-client-sync-acceptance.md)
- [Live binary sync protocol](verification/live-binary-sync.md)
- [Detailed prior handoff](archive/texttext-handoff-2026-10-11-stress.md)
- [Earlier history](archive/texttext-handoff-through-2026-10-11.md)
- [Oracle operations](../release/oracle/README.md)
