# Catalog write guard and scoped notice

The production sync store's `ensureVaultFolders` accepted a trailing-space folder even after the creation UI guard shipped. The actual Mac store regression first failed because provisioning resolved successfully. It now validates the entire batch with the existing portable-name validator before setup, recovery, or directory creation. Unicode names retain their exact catalog spelling. Existing catalog reads are unchanged.

The shared account status consumes `catalogIssues` with reason `nonportable-name`, showing held-folder guidance and at most three quoted, bounded paths. React escapes the text. Authentication and retained conflict guidance take precedence; this notice does not claim the transport is healthy or authorize repair.

Mac checks: focused provisioning, folder move, case move, and notice suites passed 20 tests; the final bounded-path notice suite passed 8 tests; TypeScript passed. The Windows server test cannot exercise directory fsync and was not counted as server acceptance. Scratch test fixtures were retained. Installed warning acceptance awaits the next unified release.
