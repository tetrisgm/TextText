# Database operations

- Development, tests, and Mac builds use local Postgres from `.env.local`. Production is a separate PostgreSQL instance on the existing Oracle ARM server, bound to `127.0.0.1:5433`.
- Production database and authentication secrets stay in root-owned `/etc/texttext/runtime.env` (0600). The Mac keeps recovery credentials in login Keychain service `texttext-oracle`. Never print secrets or put them in command arguments.
- Use the human-invoked `release/ship.sh`; `--web-only` deploys the app without publishing a Mac update. It uses the existing SSH identity and the host in `TEXTTEXT_ORACLE_HOST` or `~/.config/texttext/oracle-host`. Database preflight and migrations run on Oracle, not through a public database port.
- The owner authorized a fresh production database rather than paying to export the suspended Neon database. Do not copy local development fixtures into production.
- [Oracle operations](../release/oracle/README.md) describes validated daily Oracle-local backups, recovery, resource limits, and deployment rollback. For an existing installation, deployment verifies the incoming release and uses that release's backup implementation before migrations. Application rollback does not undo schema changes.
- Local backup and deployment preflight reserve 2 GiB of free Oracle storage by default, configurable with `TEXTTEXT_STORAGE_MIN_FREE_BYTES`; a space refusal preserves existing validated archives.
- The owner deleted the Vercel Blob store on 2026-09-30 before copying its
  objects. Media and Mac release artifacts previously held there are unavailable.
  Database backups remain local to Oracle by owner decision and require no Blob
  or R2 configuration. Verify the newest archive with a real scratch restore;
  local retention does not protect against loss of the VM or its block storage.
  See the current [handoff](HANDOFF.md) and
  [Oracle procedure](../release/oracle/README.md).
