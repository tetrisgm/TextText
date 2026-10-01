# Database operations

- Development, tests, and Mac builds use local Postgres from `.env.local`. Production is a separate PostgreSQL instance on the existing Oracle ARM server, bound to `127.0.0.1:5433`.
- Production database and authentication secrets stay in root-owned `/etc/texttext/runtime.env` (0600). The Mac keeps recovery credentials in login Keychain service `texttext-oracle`. Never print secrets or put them in command arguments.
- Use the human-invoked `release/ship.sh`; `--web-only` deploys the app without publishing a Mac update. It uses the existing SSH identity and the host in `TEXTTEXT_ORACLE_HOST` or `~/.config/texttext/oracle-host`. Database preflight and migrations run on Oracle, not through a public database port.
- The owner authorized a fresh production database rather than paying to export the suspended Neon database. Do not copy local development fixtures into production.
- [Oracle operations](../release/oracle/README.md) describes encrypted daily off-server backups, recovery, resource limits, and deployment rollback. Application rollback does not undo schema changes; take and verify a backup before migrations.
- The owner deleted the Vercel Blob store on 2026-09-30 before copying its
  objects. Media and Mac release artifacts previously held there are unavailable.
  The off-box backup code is being changed to private Cloudflare R2, but this
  does not restore the backup job until a bucket and credentials are configured
  on Oracle and an upload, read, and scratch restore pass. See the current
  [handoff](HANDOFF.md) and [Oracle procedure](../release/oracle/README.md).
