# Database operations

- Development, tests, and Mac builds use local Postgres from `.env.local`. Production is a separate PostgreSQL instance on the existing Oracle ARM server, bound to `127.0.0.1:5433`.
- Production database and authentication secrets stay in root-owned `/etc/texttext/runtime.env` (0600). The Mac keeps recovery credentials in login Keychain service `texttext-oracle`. Never print secrets or put them in command arguments.
- Use the human-invoked `release/ship.sh`; `--web-only` deploys the app without publishing a Mac update. It uses the existing SSH identity and the host in `TEXTTEXT_ORACLE_HOST` or `~/.config/texttext/oracle-host`. Database preflight and migrations run on Oracle, not through a public database port.
- The owner authorized a fresh production database rather than paying to export the suspended Neon database. Do not copy local development fixtures into production.
- [Oracle operations](../release/oracle/README.md) describes encrypted daily off-server backups, recovery, resource limits, and deployment rollback. Application rollback does not undo schema changes; take and verify a backup before migrations.
- Vercel Blob remains the existing media/release-artifact and encrypted-backup store. Its token stays in login Keychain service `texttext-release`, account `BLOB_READ_WRITE_TOKEN`; it is not a database or app compute service.
