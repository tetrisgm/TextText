# Oracle database scratch restore

T03/T17/T26 backup verification, October 18. The running release is `texttext-oracle-20261018T174659Z-f994b8f`. This is an actual restore drill, separate from archive-list validation and the earlier supplementary invocation that lacked its configured wrapper environment.

Before execution, checked current-release identity, protected configuration mtimes/modes, recent backups, free space and service state. TextText was active; the backup service was inactive. The deployed restore tool and entrypoint SHA-256 matched the reviewed repository sources. Credentials stayed in the existing protected server environment files.

Ran the documented tool through the existing fleet identity:

```sh
sudo /usr/bin/node /home/ubuntu/texttext/current/release/oracle/restore-drill.mjs --scratch
```

Exit **0**. The tool restored `texttext-20261018T174852Z-fb8bda2d.dump`, 305,362 bytes, SHA-256 `1acddac29e7af5439e97a2f3aaded4103ab48512d63f4ce06aa17779151151c4`, into a newly named disposable database. All 51 public tables, required enabled protection triggers, validated document constraint and canonical audit passed; 15 canonical database documents were checked. The tool verified removal of its own scratch database.

Post-check: current release unchanged, TextText service active, selected archive byte hash unchanged, all seven existing backup archives retained. No new backup, live database replacement, migration, service restart, release, cleanup job or infrastructure configuration change occurred.

`--compare-live` was intentionally omitted: later normal app/CLI work exists after this saved backup. This receipt proves recovery of that database archive, not equality with the newest live state, recovery of filesystem vault content or loss-of-host protection. Standard deployment still requires its fresh pre-migration backup and normal space guard.

Private full content-free receipt: `/private/tmp/texttext-oracle-existing-backup-restore-20261018.json`. The tool emits row counts and archive identity, never user document bodies or credentials.
