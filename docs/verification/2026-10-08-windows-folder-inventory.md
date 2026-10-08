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

Source only. Physical Windows packaging and installed UI acceptance are still
required; the previously verified 0428bfca candidate does not contain this fix.
