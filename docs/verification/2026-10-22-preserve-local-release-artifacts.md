# Preserve local release artifacts

Read-only Mac inspection found `/Applications/TextText.app` and an existing
`mac/build/TextText.app`; no numbered or hidden TextText app bundles were present
in `/Applications` or `~/Applications`. The builder deleted its prior candidate,
and the installer moved the prior installed app to Trash and removed failed
candidates during rollback. A stopped backup did not authorize that cleanup.

The combined release now renames an existing build candidate into its unique
run evidence directory before building. Its installer enables preservation and
places prior installed apps in the stopped backup's `previous-apps` directory.
Preservation refuses existing scratch/destination collisions and retains failed
or staged candidates. Rollback still restores the previous canonical app after
normal quit. Default installer behavior remains unchanged for other callers.

The complete shell fixture suite passed on Mac outside the checkout at
`/private/tmp/texttext-preserve-install-review`. It covers default installation,
health/identity failures, no forced quit, preserved previous/failed candidates,
scratch collisions and exact build-candidate preservation. The same new test
against the committed pre-preservation installer failed specifically with
`Preserve mode deleted the failed candidate`; patched source passed.

No real app was launched, closed or installed; no Mac checkout files changed.
These are script regressions, not installed acceptance. Existing builder cleanup
outside its app bundle is unchanged by this narrow coordinator fix.
