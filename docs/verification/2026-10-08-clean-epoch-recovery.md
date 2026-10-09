# Windows false recovery after clean epoch replacement

Final source `8090227e`. Oracle deployed and Mac 0.204 (1220) installed.
Windows candidate verified; installation and acceptance pending.

## Observed state

The canonical installed PC process 44968 was responding. Its native checkpoint
for item `273adce8-01cb-4934-8079-c0397efc82a3` (Agent template creation verification
1185) reports Pending false, zero pending journal updates, no batch, no dirty
flag, and no native retirement reason. The journal itself contains the exact
legacy “This file or its access changed. Recover your saved edits before
reopening.” retirement. The owner screenshot shows recovery controls for it.
No journal or document was removed or rewritten by this investigation.

## Cause and correction

Cold native opening restored an acknowledged old Yjs epoch, then retired it on
epoch mismatch even without pending edits. Reopening thereafter stopped on the
retired marker before checking current access. Normal file replacement could
therefore leave an otherwise clean editor stuck in recovery.

- Clean cold checkpoints adopt a fresh authorized baseline, including when the
  file hash is unchanged but the Yjs epoch changes.
- The exact historical generic retirement is refreshed only if all pending
  markers are empty and a fresh authorized read succeeds. Native initial
  retirement, unknown reasons, corrupt journals and real pending updates retain
  their existing protection. No old Yjs IDs are submitted to a replacement epoch.
- Clean live epoch-conflict responses likewise use the file refresh path.
- Successful read-only access does not invent recovery work for a clean file.

346 shared-client tests in 38 suites and TypeScript passed. New regressions
cover cold clean epochs, actual legacy retirement, transient network failure,
revoked read access, read-only downgrade and protected real pending updates.
Logs `/tmp/texttext-clean-epoch-final-tests.log` and
`/tmp/texttext-clean-epoch-final-types.log`. The physical PC build also passed
346 shared tests, native suites, TypeScript, packaging and interactive desktop smoke.
Candidate: `C:\Users\Shokunin\dev\texttext-client-8090227e\windows\build\candidate-4557fa2f057441269d23adc0fd3778c4`.
The final access recheck failed on both existing PC SSH profiles; no alternate
access path was created. Physical Windows installation/acceptance remains.

Oracle independently reports epoch 2, sequence 0 for this item; the clean PC
checkpoint was epoch 1, sequence 13. Actual Mac 1220 opened this same note without
recovery controls. During Oracle deployment its connection recovered automatically
without clicking Retry; the transient pending-edits message cleared. No content
was discarded. Saved-body cache invalidation and extensions remain unverified on 1220.
