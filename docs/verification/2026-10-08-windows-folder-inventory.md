# Windows empty-folder inventory

The native manifest previously inferred folders only from document paths.
Empty folders were materialized by sync but omitted from the desktop folder
list, preventing an agent from selecting them as creation destinations.

`TextPackStore.ScanInventory` now returns documents and visible directories
from one traversal. The bridge caches that combined snapshot, invalidates it
on filesystem changes, and includes folders in its manifest revision. A
filesystem event racing a scan prevents retention of the stale cache.

Native regressions cover empty/nested directories without documents, restart
after rename, child deletion, private directory exclusion and symlink
exclusion/preservation. The complete native durable sync suite passed on the
Mac; Windows shell compilation passed without warnings or errors.

Logs: `/tmp/texttext-windows-folder-inventory-core.log`,
`/tmp/texttext-windows-folder-inventory-shell.log`.

Source `fcb1cd42` passed physical PC packaging, Core/Agent suites, 338 shared
client tests, TypeScript, and interactive desktop smoke. Log:
`/tmp/texttext-windows-fcb1cd42-build.log`.
Candidate:
`C:\Users\Shokunin\dev\texttext-client-fcb1cd42\windows\build\candidate-37ab7610907e411aad1cceb3e9c2085e`.
Smoke receipts:
`C:\Users\Shokunin\dev\texttext-client-fcb1cd42\windows\build\smoke-receipts-5f07192292d24e35a3bf7aa637d9914b`.
Not installed: canonical app process 44968 is still responding with unknown
unsaved state. The older 0428bfca candidate does not contain this folder fix.
