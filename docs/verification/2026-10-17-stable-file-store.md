# Stable file reads and staged-write checks

October 17 T12 source slice. No installed delivery claim.

Mac document, metadata, template and final compare-and-swap reads now capture bounded regular-file bytes. The reader checks descriptor and current-path identity, size and change timestamps before/after reading, retries at most three times, then refuses unstable content. ZIP/schema/asset validation consumes that captured version. Both write APIs return the validated prepared projection; a later external save cannot be reported as the caller's committed version.

Windows projection reads now reject files above 64 MiB before allocating and hold the existing read-sharing boundary through capture. Writes recheck the expected hash after staging and flushing, immediately before replacement. External changes during staging refuse the write while preserving the accepted operation receipt and external bytes.

## Passing focused checks

- Mac: 8 new stable-file tests plus 13 connection-controller and 48 sync tests, `/private/tmp/texttext-t12-store-native-focused.log`.
- Portable Windows Core suite on Mac, `/private/tmp/texttext-t12-store-core.log`. The actual Windows open-writer sharing check is explicitly skipped on Mac; it requires PC execution.
- Cases include in-place and rename-over writes, repeated changes, deletion/creation during staging, partial archive and repair, oversized files, bounded retries, retained unacknowledged operation intent and successful fresh reconciliation. Mac post-commit external replacement is exercised against both write APIs.
- Complete native gate passes with the new named stable-file suite required by the runner: `/private/tmp/texttext-scheduler-store-native-final.log`. Four opt-in disk-full/child-helper cases are skipped in this invocation; this does not replace their dedicated prior receipts.
- Actual PC Core suite passes, including refusal while another process holds an in-place writer and recovery after that writer closes: `/private/tmp/texttext-schedule-store-pc-core-full.log`, exit 0 in `/private/tmp/texttext-schedule-store-pc-core.log`. Remote log `C:\Users\Shokunin\dev\texttext-schedule-store-core-1254.log`.

## Remaining boundary

### Same-path rename follow-up

The Mac no-op rename path now checks the caller's expected hash before returning success. Its new regression first failed because stale input returned a newer document without refusal (`/private/tmp/texttext-same-path-rename-before.log`, exit 1). With the correction, all 9 `StableFileSnapshotTests` pass, including preservation of the external bytes and successful same-path rename using the current hash. The combined run `/private/tmp/texttext-lifecycle-samepath-swift-final.log` separately failed one new lifecycle fixture; that wider gate is not claimed here.

### Rename, clone and import results

The three publication paths now return their captured/prepared document instead of rereading a destination that another writer may already have changed. A post-publication test hook replaces that destination with different bytes; each operation still returns its own original content/hash, clone/import retain their fresh identities, a fresh read sees the later external content, and source bytes survive clone/import unchanged.

- Before correction: all three variants failed their returned-content/hash assertions, `/private/tmp/texttext-publish-result-before.log`. The same run's 52 sync tests passed after correcting the lifecycle test's invalid non-UUID fixture ID.
- After correction: all 10 stable-file tests and both actual WKWebView policy-host tests pass, exit 0, `/private/tmp/texttext-lifecycle-publish-wk-final.log`. Command: `TEXTTEXT_STORE=1 TEXTTEXT_MIRROR_POLICY_BUNDLE=/private/tmp/texttext-t11-lifecycle-policy-fixture swift test --package-path mac --jobs 2 --filter 'LocalVaultMirrorPolicyHostTests|StableFileSnapshotTests'`. The unrelated package lock bytes were restored exactly.

This does not close the final-check-to-replacement race described below. Idempotent replay APIs keep their existing current-identity semantics.

An uncooperative writer can still change the destination between the final hash check and OS replacement. These checks do not provide a filesystem-wide atomic hash comparison. Full T12 remains open: preserving an atomically displaced destination needs a separate journaled replacement primitive, capability checks and crash recovery, including cross-volume behavior. Do not describe these tests as power-loss proof or as physical watcher/provider acceptance.

Other creation paths and physical provider behavior still require their own acceptance. Completed idempotent retries intentionally returning the current unique identity are a different contract and must continue preserving later work.
