# Pre-deploy backup preservation

The release preflight found seven existing validated Oracle backups. The default
`keep=7` policy in `release/oracle/backup.mjs` would remove the oldest archive
after creating the deployment backup, despite the owner's ask-before-deletion
instruction.

The deployment transient service now invokes the backup through
`/usr/bin/env TEXTTEXT_BACKUP_PRESERVE_EXISTING=1`. This overrides any same-named
value loaded from the service environment. The strict `0`/`1` flag skips only
retention deletion for that invocation. Scheduled backups retain their default
policy. Archive validation, size budget, free-space floor, locking and durable
commit ordering remain unchanged.

The success path also previously deleted the saved old backup service unit.
It now retains that existing unit and prints its saved path. Failure rollback
behavior is unchanged; this does not expand cleanup or change other services.

Verification on the Mac, outside its active checkout:

- Baseline backup implementation with the new preservation regression failed
  with `7 !== 8`: an existing archive was removed from the disposable fixture.
- Final `node --test backup-preservation.test.mjs`: **6 passed**, zero failures
  or skips. Seven prior archives become eight with preservation and remain seven
  with default or explicit `0` retention. Invalid flags, insufficient free space
  and oversized output fail without removing prior fixture archives. The actual
  `/usr/bin/env` child invocation overrides an inherited `0` and retains all seven
  original archives with exact bytes.
- `bash -n deploy.sh`: passed.
- Existing Oracle runtime/packaging/deployment/backup suite plus the new
  preservation suite: **22 passed** (16 existing + 6 new), zero failures or skips.
  Run from `/tmp/texttext-oracle-regression.7lkcnr` with a read-only dependency
  link to the Mac checkout's `node_modules`; no checkout files changed.
  Repeated after retaining the prior service unit: **22 passed** and shell
  syntax passed, including a source regression requiring the retained-path
  message and refusing success-path deletion of the previous unit.

Final scratch source: `/tmp/texttext-backup-preservation-final.DUP7By` on the Mac.
Baseline RED source: `/tmp/texttext-backup-preservation.lElldL`.
No Oracle operations, server mutations or installed-app acceptance were performed.
The root agent owns integration and deployment verification.
