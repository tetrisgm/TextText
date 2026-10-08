# Oracle creation receipt deployment

Deployed source `0428bfca` as
`texttext-oracle-20261008-0428bfca-creation` through the Mac web-only ship entry
point with exact passed release/sync receipts and the separately built immutable
Linux ARM64 archive. Previous release retained. No public Mac release.

Deployment exited zero. Fresh schema, migration retry/content protection and
nonempty bootstrap refusal checks passed. Live authenticated checks passed:
session, browser mutation origin enforcement, workspace read, empty-folder
creation/retry, note creation/read, note edit/retry/read, search contract,
quick-capture receipt, storage/audit, deletion/Trash, same-identity restore/retry,
pre-restore upload fencing/recovery, and scratch cleanup.

This does not attest Google sign-in, reference-service visual fidelity or
interactive cross-client concurrency. Those remain separate acceptance work.

Log: `/tmp/texttext-oracle-0428bfca-deploy.log`.
