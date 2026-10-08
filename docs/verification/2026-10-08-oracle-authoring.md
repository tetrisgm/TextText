# Oracle template authoring deployment

Source `1ae33f2012738bf4b7cde385d4b84c541f7405ad` deployed as
`texttext-oracle-20261008-1ae33f20-authoring` using the verified Linux ARM64
archive and established Oracle deployment script. Deployment exited zero;
the previous release was retained. No public Mac release.

All thirteen authenticated live checks passed, including session, mutation
origin enforcement, workspace reads, empty-folder creation/retry, note
creation/edit/retry, search, quick capture, audit, Trash/restore and stale
upload fencing. Canonical document audit passed. Existing backups were checked
before deployment; unrelated Algorave services were active and were not changed.

Relevant source tests: 842 core tests plus the required native suites passed
for Mac 1216; 35 template tests and TypeScript passed. Unaffected prior release
checks were not repeated. This does not attest visual parity or Google sign-in.

Log: `/tmp/texttext-oracle-authoring-1ae33f20-deploy.log`.
