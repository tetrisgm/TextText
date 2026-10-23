# Unified release signing blocker

The same-commit invocation for `446784e26fbbae03ada0e592be0b93e75927e436`
passed the Mac release and sync gates and all Windows candidate checks,
including desktop smoke. Windows candidate:
`windows/build/candidate-febde0ea1a154322bfd5e9020055b8d2`.

Mac packaging passed the previously failing embedded-runtime version step and
AppIntents generation, then failed signing the staged Codex helper with
`errSecInternalComponent`. The existing login keychain's
`SecKeychainGetStatus` flags were `2`: readable, but not unlocked. Enumerating
the existing signing identity succeeded; private-key access did not. Strict
signature verification still passed for both installed and staged helpers.
No new identity or keychain configuration was created.

The coordinator exited with failure before deployment or installation.
`delivery.json` has an empty delivered list, its lock is absent, and the owner's
`mac/Package.resolved` was restored with SHA256
`eea669ec76b68673014c10c95b90e721c14d67c99de5756f5c8071c968306edb`.
The owner opened Keychain Access. A fresh SSH probe still failed, but the same
probe launched from a new desktop Terminal window signed and strictly verified
successfully. The blocker is specific to the SSH signing context; no further
owner keychain action is required. Run the human-invoked release in the desktop
Terminal session and inspect its log remotely.

The release now checks signing before expensive gates, using a retained copy of
`/usr/bin/true`, and pins the exact selected identity for the subsequent build.
It never executes the probe or changes keychain settings. Actual Mac focused
checks passed 21 tests; documentation checks passed. Desktop signing evidence:
`/private/tmp/texttext-desktop-signing-check.TQwgJQ/result.log` and
`/private/tmp/texttext-desktop-signing-evidence-UKUCed/`.

Mac evidence:
- `/private/tmp/texttext-ship-all-446784e2.log`
- `~/dev/TextText/.texttext/ship-all/20261023065741779-446784e2/`

The owner explicitly approved the Oracle smoke test's temporary workspace
deletion/restore and cleanup for this release. This excludes existing content,
workspaces, backups, and releases. The smoke test was not reached.

## Product diagnosis prepared in parallel

Installed Windows PID `44676` was observed actively scanning in sync after
remote manifest retrieval. Its durable state contains one conflicted outbox
entry. Neither this activity nor an unchanged state-file timestamp proves a
completed remote pass; the app lacks a persisted last-success diagnostic.

The screenshot's literal bootstrap timeout has a separate retained-error cause:
successful listing/access retries do not clear their own earlier error. Native
connection events and snapshots also disagree for the same conflict state;
late initial responses can overwrite newer events, and sync events clear
unrelated action failures. These are state-management defects, not evidence
that clearing all warnings would repair sync.

Focused corrections and baseline-failing regressions are prepared outside the
checkout, pending Phase 1 acceptance. Combined with the held Phase 2 patch,
the copied-source production bridge checks pass 16 assertions and the actual
renderer checks pass five cases. They are not installed acceptance. Existing
conflicts, recovery records, edit authority, and durability guards remain intact.
