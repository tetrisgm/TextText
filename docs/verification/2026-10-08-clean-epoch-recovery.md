# Windows false recovery after clean epoch replacement

Source fix `701a2bec`. Not yet installed on Windows.

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

- Clean cold epoch mismatches now enter existing stale-file refresh behavior.
- The exact historical generic retirement is refreshed only if all pending
  markers are empty and a fresh authorized read succeeds. Native initial
  retirement, unknown reasons, corrupt journals and real pending updates retain
  their existing protection. No old Yjs IDs are submitted to a replacement epoch.
- Clean live epoch-conflict responses likewise use the file refresh path.
- Successful read-only access does not invent recovery work for a clean file.

345 shared-client tests in 38 suites and TypeScript passed. New regressions
cover cold clean epochs, actual legacy retirement, transient network failure,
revoked read access, read-only downgrade and protected real pending updates.
Logs `/tmp/texttext-clean-epoch-shared-tests.log` and
`/tmp/texttext-clean-epoch-types.log`. Physical Windows delivery/acceptance remains.
