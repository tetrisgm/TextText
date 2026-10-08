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
runs the authenticated document/audit smoke before accepting the release. The
pre-migration backup runs from the checksum-verified incoming release rather
than `current`, so it does not depend on stale backup code. A transient systemd
service loads `/etc/texttext/backup.env`, drops to `ubuntu`, permits network
access only to loopback, and writes only to the TextText backup directory. It
must produce and validate a local archive before migration. It does not address
or restart Algorave.
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

The entry point installs an HTTP shutdown lifecycle through Node's
[HTTP diagnostic channels](https://nodejs.org/download/release/v22.23.3/docs/api/diagnostics_channel.html).
On SIGTERM/SIGINT it reports active request categories/counts/ages and inbound
socket counts immediately and after 10/20 seconds. It closes only inbound
sockets that have never started an HTTP request. Node's server close otherwise
waits for these pre-request sockets until their header timeout. Executing
requests and writes remain owned by Next. It never logs URLs, IDs,
headers or bodies or extends shutdown. An idle socket count
with no requests points to connection draining; remaining request categories
identify which handler needs investigation. Verify this evidence from the next
normal rollout before claiming the production timeout resolved.

Keep the root-owned runtime environment at `/etc/texttext/runtime.env`, mode
0600. systemd reads it before dropping privileges. It must set `DATABASE_URL` to
the dedicated local PostgreSQL instance (currently port 5433) and production auth
settings. Media is stored under `/home/ubuntu/texttext/state/media`; set
`TEXTTEXT_MEDIA_ROOT` to that path and `MEDIA_ORIGIN=https://texttext.app`.
Set `PORT=3400`; the entry point
forces `HOSTNAME=127.0.0.1`, validates a loopback database, and rejects development
sign-in. Reserve/check port 3400 before installing the unit; do not stop another
application to claim it.

The database uses separately unpacked, signed Ubuntu PostgreSQL 16 packages
under `postgres/`. It does not change the shared machine's package setup or
create a login account. Data is under `state/postgres`, checksums enabled,
40 connections maximum, 256 MiB shared buffers, and 512 MiB maximum WAL.
Use `dynamic_shared_memory_type=mmap`: logind can remove POSIX shared memory
owned by the existing `ubuntu` identity after its last interactive session ends.

The supplied HTTPS configuration reserves loopback 8444 for Caddy, which
terminates TextText TLS, renews certificates, limits request bodies, and streams
responses to port 3400. HAProxy routes public 443 by TLS hostname; TextText's
client address is passed with PROXY v2. Other TLS traffic passes unchanged to
PartyParty on loopback 8443, preserving its certificates and renewal behavior.
This requires an explicitly approved PartyParty listener change, recorded in a
systemd override so its normal deployment cannot reclaim public 443. Radio and
its Cloudflare tunnel keep their existing configuration.

Keep database 5433, app 3400, and private HTTPS ports on loopback only. No shared
response cache is added. Service examples never install themselves, create
users, modify routing, or open firewall ports. `/etc/texttext` permits traversal
for public routing files; secret environment files remain root-owned 0600.

## Backups and recovery

Prepare `/home/ubuntu/texttext/backups` owned by `ubuntu`, mode 0700. The separate
root-owned `/etc/texttext/backup.env`, mode 0600, needs:

- `DATABASE_URL` for the local database only.
- `TEXTTEXT_BACKUP_DIR=/home/ubuntu/texttext/backups`.
- `PG_DUMP` and `PG_RESTORE` absolute paths if not on systemd's PATH.
- Optional `TEXTTEXT_BACKUP_KEEP` and `TEXTTEXT_BACKUP_MAX_BYTES` overrides.
  Defaults retain at most seven archives and 5 GiB total.
- Optional `TEXTTEXT_STORAGE_MIN_FREE_BYTES`. The default reserves 2 GiB for
  the app, media, and release artifacts.

`backup.mjs` creates a PostgreSQL custom-format dump, validates its archive table
of contents, fsyncs it, and atomically renames it into place. Archives are mode
0600. One additional partial dump may exist while a backup is running. A failed
dump removes its partial file and preserves prior backups. Retention never
touches unrelated files in the directory. Before starting `pg_dump`, the backup
requires enough available filesystem space for its full configured archive
budget plus the free-space floor. Refusal leaves existing validated archives
unchanged.

The timer performs one backup each day, including one catch-up after downtime.
It never builds, deploys, restarts, or reinstalls the app. Monitor failed timer
runs. Linux service and manual CLI invocations both acquire `/usr/bin/flock`;
the kernel releases the lock on process exit or reboot. The empty lock file can
remain safely. The service denies non-loopback network access. These backups stay
on the Oracle VM by owner decision and do not cover loss of that VM or its block
storage.

Take a fresh backup and run the full drill during a quiet period to compare all
table counts:

```sh
sudo /usr/bin/node /home/ubuntu/texttext/current/release/oracle/restore-drill.mjs \
  --scratch --compare-live
```

Stage `release/oracle/restore-drill.mjs` and its `entrypoint.mjs` helper together
if the running release does not contain them. Defaults read the deployed code
from `/home/ubuntu/texttext/current`, backup settings from
`/etc/texttext/backup.env`, and the local database administrator connection from
`/etc/texttext/database-admin.env`. These paths can be overridden with
`--release`, `--backup-env`, and `--admin-env`.

The drill selects the newest private archive by its immutable UTC filename,
checks its owner, mode, size, identity, SHA-256 digest, and PostgreSQL table of
contents, then restores it into a new randomly named database. It checks the
archive's table inventory, enabled protection triggers, the canonical document
audit, and every public table's row count. `--compare-live` also requires live
row counts to remain unchanged during the drill and match the backup; a changed
workspace needs a fresh quiet-period run. The receipt contains row counts and
the local archive digest, never document content or credentials. Success removes
the scratch database. The live database and backup archive remain unchanged.
This tool has no timer or automatic job.

## Local checks

```sh
node --test release/oracle/test.mjs release/oracle/test-smoke.mjs \
  release/oracle/test-restore-drill.mjs
```

Linux startup, native image processing, service sandboxing, proxy streaming, and
an actual local scratch restore must additionally be verified on the destination.
