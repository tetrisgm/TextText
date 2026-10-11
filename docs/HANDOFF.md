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

Same-entry asset conflict now saves both complete packs before stopping retries
on Mac and Windows. Restore while an attachment operation awaits acknowledgement
follows the same rule. Mac sync suite (41 tests) and Windows native regression
suite pass. These changes are not installed or physically six-client verified yet.

Next: physical same-entry conflict, whole TextPack and folder
operations, delete/restore, two-account permissions, and sustained latency and
resource measurements. The normal Windows “Keep editing” close path has not
been separately reproduced on the latest installed candidate. Do not certify
full sync or ship a public release until the remaining matrix passes.
The stress coordinator has a diagnostic same-entry race mode. Seed 113 ran on
six physical clients against disposable item `988ca4ca-8bbf-416d-95ad-81df3e4d3225`.
All text edits converged, but Mac and Windows retained different bytes for
`assets/data.bin` (SHA-256 `5bb4dc8f...` and `f51f46bf...`). Receipt:
`/private/tmp/texttext-six-20261011/results/stress-2026-10-11T20-25-52-080Z-113`.
The runner previously labeled this “passed” despite withholding acceptance;
it now requires matching binary hashes. Mac's open-file sync tried remote
binary receive before staging the local change, so same-entry collisions
could remain unrecorded. The order now stages/preserves the local asset first,
with a focused regression test. Both versions are preserved in a conflict;
automatic convergence, conflict presentation, and a fresh physical rerun remain.

Unrelated dirty files in `mac/Package.resolved`, assistant attachments, tabs
tests, `mac/scripts/__pycache__/`, and `scripts/.probe-editor.ts` belong to
other work; preserve them.

## References

- [Six-client acceptance and receipts](verification/six-client-sync-acceptance.md)
- [Live binary sync protocol](verification/live-binary-sync.md)
- [Detailed prior handoff](archive/texttext-handoff-2026-10-11-stress.md)
- [Earlier history](archive/texttext-handoff-through-2026-10-11.md)
- [Oracle operations](../release/oracle/README.md)
