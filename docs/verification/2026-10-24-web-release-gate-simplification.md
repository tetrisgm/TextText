# Web release checks, October 24, 2026

`release/ship.sh --web-only` previously ran the entire application, database,
and sync suites on every web release. Ordinary web changes now run TypeScript
and the focused Oracle packaging, smoke, restore, and bootstrap script tests
before building the web archive. Change-specific tests run with the change.

The Oracle deployment script still checks storage, verifies the package and
checksum, backs up before migration, and performs live health and authenticated
document/audit smoke checks. The Mac public release path is unchanged.

Verification: `bash -n release/ship.sh` passed. No deployment was invoked.
