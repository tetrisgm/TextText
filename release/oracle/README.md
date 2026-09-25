# Oracle runtime packaging

The Mac builds and verifies TextText. Oracle runs the resulting standalone
application on Linux ARM64; it does not build or install releases on a schedule.
The only scheduled task described here is the database backup.

## Prepare a release

Use the human-invoked release entry point, `release/ship.sh`, for publishing.
These packaging commands are its local building blocks, not another release lane:

```sh
TEXTTEXT_STANDALONE=1 TEXTTEXT_NEXT_DIST_DIR=.texttext/oracle-build \
  node scripts/with-local-database.mjs npm run build
node release/oracle/prepare-migrations.mjs --out .texttext/oracle/migrations-RELEASE
node release/oracle/package.mjs --dist-dir .texttext/oracle-build \
  --migrations-dir .texttext/oracle/migrations-RELEASE \
  --out .texttext/oracle/texttext-RELEASE.tar.gz
```

The archive includes the standalone server, browser assets, public files, and
lockfile-pinned Linux ARM64 production dependencies. Native Sharp/libvips and
Next SWC dependencies are selected for glibc Linux rather than copied from the
Mac. No lifecycle installation scripts run. `.env` files and `.npmrc` are
excluded. The adjacent `.sha256` file verifies transfer integrity.

`oracle-release.json` records the commit, deployment identity, target platform,
and build directory. The caller must run required source checks before packaging;
packaging alone is not a verification receipt. Existing archives are never
replaced. A deployment must unpack into a new release directory, verify the
checksum, then switch `current` and pass local health checks before accepting it. Keep the previous
release for rollback. No script in this directory automatically deletes releases.

`deploy.sh --dry-run` prepares and verifies an archive without contacting a
server. Set `TEXTTEXT_ORACLE_ARTIFACT` to reuse an already prepared archive
without rebuilding, and `TEXTTEXT_ORACLE_HOST=ubuntu@<existing host>` for a
human-invoked deployment (or save that host in `~/.config/texttext/oracle-host`).
`TEXTTEXT_ORACLE_ROOT` defaults to
`/home/ubuntu/texttext`. The existing fleet key is used; no identities are created.
The release entry point owns the source/test receipt. Archive reuse verifies
checksum and target metadata, not whether the source passed its tests.

The destination must already have the service and protected environment files.
For the first deployment into a pre-created, empty database only, set
`TEXTTEXT_ORACLE_BOOTSTRAP=1`; it refuses an existing application release, and the
bootstrap helper refuses a nonempty database. Later deployments require an
initialized local database. Deployment backs up an existing release, runs the
prepared migration chain, switches the `current` symlink, restarts only
`texttext.service`, checks the deployment identity and sign-in response, then
runs the authenticated document/audit smoke before accepting the release.
On failure after switching, it restores the previous application symlink and
restarts TextText. Database schema changes are not automatically reversed;
migrations must retain compatibility with the previous application. Archives,
incoming files, and old releases remain for inspection and manual cleanup.

## Runtime

Use the existing `ubuntu` identity and Node 22. The service example assumes
`/usr/bin/node`; set its actual absolute path before installation. Prepare
`/home/ubuntu/texttext/state` and the selected release's
`.texttext/oracle-build/cache` as writable directories. Application code stays
read-only inside the service. The example CPU and memory ceilings protect other
workloads on the shared VM; validate them against available capacity.

Keep the root-owned runtime environment at `/etc/texttext/runtime.env`, mode
0600. systemd reads it before dropping privileges. It must set `DATABASE_URL` to
the dedicated local PostgreSQL instance (currently port 5433), production auth
settings, and existing Blob/media credentials. Set `PORT=3400`; the entry point
forces `HOSTNAME=127.0.0.1`, validates a loopback database, and rejects development
sign-in. Reserve/check port 3400 before installing the unit; do not stop another
application to claim it.

Put the existing reverse proxy in front of port 3400, with request/body/rate
limits, streaming support, and private responses excluded from shared caching.
Database port 5433 must remain loopback-only. Service examples never install
themselves, create users, modify the proxy, or open firewall ports.

## Backups and recovery

Prepare `/home/ubuntu/texttext/backups` owned by `ubuntu`, mode 0700. The separate
root-owned `/etc/texttext/backup.env`, mode 0600, needs:

- `DATABASE_URL` for the local database only.
- `TEXTTEXT_BACKUP_DIR=/home/ubuntu/texttext/backups`.
- `PG_DUMP` and `PG_RESTORE` absolute paths if not on systemd's PATH.
- `TEXTTEXT_BACKUP_UPLOAD=1`, required by the production backup service.
- The existing `BLOB_READ_WRITE_TOKEN` and `TEXTTEXT_BACKUP_BLOB_ACCESS=public`
  for the existing public Blob store; only ciphertext is uploaded.
- A dedicated `BACKUP_ENCRYPTION_KEY`: 32 cryptographically random bytes encoded
  as base64. Keep its recovery copy in the owner's credential store, separate
  from this VM. Losing it makes the off-server backups unreadable.

`backup.mjs` creates a PostgreSQL custom-format dump, validates its archive table
of contents, and atomically retains it. Local plaintext dumps are mode 0600.
Default local retention is at most seven files and 5 GiB total; one additional
dump may exist temporarily during backup. A failed dump preserves prior backups.
After a valid dump, local retention runs even if the off-server upload fails.

Off-server files use authenticated AES-256-GCM with a fresh random nonce. They
are confined to `backups/oracle/texttext/` in the existing Blob store. Each upload
is downloaded and checked by SHA-256 before old remote files are pruned. Retention
keeps at most seven distinct UTC days, one file per day, and 500 MiB total; each
upload is capped at 100 MiB. A temporary eighth file can exist during verification.
Byte budgets may retain fewer days. The defaults can be lowered or deliberately
raised through `TEXTTEXT_BACKUP_KEEP`, `TEXTTEXT_BACKUP_MAX_BYTES`,
`TEXTTEXT_BACKUP_UPLOAD_MAX_BYTES`, and `TEXTTEXT_BACKUP_REMOTE_MAX_BYTES`.
Blob storage, upload operations, and verification downloads remain metered.

The timer performs one backup each day, including one catch-up after downtime.
It never builds, deploys, restarts, or reinstalls the app. Monitor failed timer
runs. Linux service and manual CLI invocations both acquire `/usr/bin/flock`;
the kernel releases the lock on process exit or reboot. The empty lock file can
remain safely. The directory lock used by the Mac test fixtures is not used in
production.

To recover, download a selected ciphertext file and use the key from the
independent credential store in a private environment file:

```sh
node release/oracle/backup.mjs --env-file /private/path/backup.env \
  --decrypt /private/path/archive.dump.aes256gcm --out /private/path/recovered.dump
```

The output must not exist. Authentication failure removes partial plaintext.
Restore it into a separate scratch PostgreSQL database first, verify canonical
documents, users, media references, and row counts, then plan promotion. The
decrypt command never touches a database. Regularly perform a full off-server
download/decrypt/restore drill; listing an archive is not a restore test.

## Local checks

```sh
node --test release/oracle/test.mjs
```

Linux startup, native image processing, service sandboxing, proxy streaming, and
an actual off-server restore must additionally be verified on the destination.
