# Local keyed append durability

Local `CLIWorkspace.appendMarkdown` previously ignored the supplied idempotency
key. It now commits a payload fingerprint receipt and content in the same
coordinated, synchronized TextPack replacement. There is no separate receipt
write after the content commit.

Receipts are opaque ZIP entries under the canonical bundle root's
`net.texttext.mutations/`, keyed by SHA-256
of the supplied key. They contain a fingerprint, not the key or appended text.
Ordinary native writes preserve these entries. A matching retry returns the
current document before checking its old hash; a changed payload using the same
key is rejected. Receipt count is bounded at 4096 and fails closed rather than
evicting keys and making old retries duplicate content.

Verification: `LocalVaultTests` passed 7 tests. The new regression appends once,
makes a later ordinary edit, reconstructs the workspace, retries, verifies one
append and the later edit, then rejects a different payload without changing
the file hash. Log: `/tmp/texttext-cli-append-receipt.log`.

Storage validation: 84 tests passed across LocalVault CLI, import, recovery,
shared editing, sync and TextBundle package suites. Log:
`/tmp/texttext-cli-append-storage-required.log`. The folder-view discovery
fixture now carries the validated built-in template it previously omitted.
An earlier broader run failed that invalid fixture and the bundled-editor UI
smoke; the latter remains unresolved and is not covered by the passing storage
suites. Earlier log: `/tmp/texttext-cli-append-storage.log`.

This is source verification, not an installed-client acceptance. Keyed append to
legacy non-TextPack files is rejected. Local creation idempotency is still
unfinished. Receipt preservation through web/shared-editor reconstruction and
Windows writes needs explicit verification; do not infer cross-platform
exactly-once behavior from the local regression. Manually removing receipts or
restoring an older package also removes the corresponding retry history.

Follow-up: receipt placement was corrected before installation to live inside
the canonical TextBundle root. The web parser/rebuilder uses root-relative opaque
files, so an archive-root receipt was incompatible with a renamed web rebuild.
The web package rename/edit regression passed (11 package tests;
`/tmp/texttext-receipt-web-package.log`). Windows `WithDocument` preservation
regression and native durable-sync suite passed on the Mac .NET runtime
(`/tmp/texttext-receipt-windows-core.log`); this is not a PC-installed check.
Mac CLI/import tests passed 17 tests after the placement change
(`/tmp/texttext-receipt-bundle-root.log`). Server checkpoint/MCP replacement
paths still need receipt-preservation acceptance before broader claims.
