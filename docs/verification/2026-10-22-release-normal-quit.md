# Release refuses a failed normal quit

Review of the real Mac installer found `stop_apps` escalated to TERM after five
seconds. Rollback ignored stop failure and could move a running app's bundle.
An isolated test of those actual functions reproduced the force-stop attempt.

The installer now refuses without signalling the app. Rollback and its failure/
exit handlers preserve current, prior and staged bundles when normal quit fails.
The regression also catches accidental cleanup by the outer exit handler.

Mac validation: original behavior RED, corrected behavior GREEN; the complete
`test-install-local.sh` fixture suite passes. These tests send no app input or
signals. Real installed acceptance remains pending.

The combined coordinator now checks a per-run `CANCEL` file and source identity
before and after each command. Cancellation waits for the current child to finish,
then restores the owner pin. Successful delivery is recorded before the next
checkpoint. Seven focused regressions pass on the PC and Mac, including refusal
to deploy when either exact-source release or sync receipt fails validation.

Web deployment reuses the genuine full release/sync gates from the same invocation
only after both receipts validate. It uses the documented `deploy:web --skip-tests`
path and builds a fresh archive; no receipt is fabricated or relabelled.

The first `b05a675e` coordinator was held before delivery to integrate this fix.
Its existing child checks were allowed to finish; no app or journal was reset.
