# TextText handoff

## Current work (October 11)

Source `c6c11fe1` converges same-entry attachment conflicts on the server
winner while preserving both complete TextPacks. Mac 42-test sync suite and
Windows core regression suite pass.
Store-shaped Mac 0.203 build 1255 is installed in `/Applications`. It opened
the existing iCloud workspace, found the six-client test note, and saved and
reopened a test marker. The matching Windows candidate is installed. No website
or public Mac release was deployed.

The Windows normal-close race remains open. In physical seed 123 all six
editors converged text and attachment bytes, but the PC app did not answer
`close-probe` within 100 seconds. Its last native trace showed a clean,
nonretired journal with no pending edits before `window.Close()`. Source now
bounds the whole WebView script dispatch and acknowledgment; Windows smoke
passes that regression plus close retry tests. Physical seed 124 again
converged all six clients, but SSH reset during shutdown, leaving close
unverified. Receipts:
`/private/tmp/texttext-six-20261011/results/stress-2026-10-11T21-39-30-447Z-123`
and `stress-2026-10-11T21-45-48-281Z-124` alongside it. Do not ship the
uncommitted close change until a fresh physical close and reopen pass.

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

Same-entry attachment races passed on two fresh physical six-client fixtures,
with all six text edits retained and no rejected events. In seed 115 Windows
won; the Mac kept its losing attachment in a conflict copy. Seed 116 reopened
the result on all six clients. In seed 117 the Windows editor was temporarily
offline and Mac won; Windows kept its losing attachment in a recovery TextPack.
Seed 118 reopened that result on all six clients. Receipts are
`/private/tmp/texttext-six-20261011/results/stress-2026-10-11T20-50-42-691Z-115`,
`stress-2026-10-11T20-51-50-684Z-116`,
`stress-2026-10-11T20-58-04-898Z-117`, and
`stress-2026-10-11T20-59-58-183Z-118` alongside it. Both races are labeled
diagnostic, not full acceptance. The source changes used private test actors;
the installed Mac and Windows apps have not been replaced with these builds.

Next: finish the normal Windows “Keep editing” close path, whole TextPack and folder
operations, delete/restore, two-account permissions, and sustained latency and
resource measurements. Do not certify
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
with a focused regression test. Both platforms now preserve full local and
remote packs before adopting the server's attachment bytes in the main file.
The Mac keeps a persisted conflict until adoption finishes, so a stopped
process can retry that step. The Windows binary outbox clears after adoption.
Mac 42-test sync suite and Windows core suite pass. Fresh physical six-client
convergence now has both winner directions; normal close behavior, conflict
presentation, and the remaining acceptance matrix still need verification.

Unrelated dirty files in `mac/Package.resolved`, assistant attachments, tabs
tests, `mac/scripts/__pycache__/`, and `scripts/.probe-editor.ts` belong to
other work; preserve them.

## References

- [Six-client acceptance and receipts](verification/six-client-sync-acceptance.md)
- [Live binary sync protocol](verification/live-binary-sync.md)
- [Detailed prior handoff](archive/texttext-handoff-2026-10-11-stress.md)
- [Earlier history](archive/texttext-handoff-through-2026-10-11.md)
- [Oracle operations](../release/oracle/README.md)
