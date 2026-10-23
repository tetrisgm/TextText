# Windows long-path stopped backup, October 23

`98b5314a` delivered web and Mac, then Windows stopped backup failed at `Copy-Item`: destination expansion pushed retained account-adoption paths beyond Windows PowerShell 5 limits. A disposable fixture reproduces `PathTooLongException`. The first recovery attempt also exposed PS5 recursive inventory failure on deeper vault recovery paths. Both partial backups remain intact; no journals or retained records were removed.

The reviewed one-off recovery used existing PowerShell 7 for all-reparse-point root/tree inspection and Node for exact directory inventories, SHA256 copy verification and exclusive destination creation. It verified original normal quit, clean exact source, candidate/stage/installed receipts, unchanged source and stopped process. The unchanged supported installer installed `98b5314ad0c7cc1193bb7e2828b967af6b4b12fd`, exit0. Real installed acceptance is recorded separately by the coordinator.

- Complete stopped backup: `%LOCALAPPDATA%/TextText-backups/ship-all-20261023074103440-98b5314a-longpath-d6faf14e454e4234983667b792c6d95a`.
- Previous application: `%LOCALAPPDATA%/Programs/TextText-previous-20261023T011552-da079358`.
- Retained recovery sources/receipt: `%TEMP%/texttext-backup-longpath-fix/`.

Permanent fix: preflight resolves PowerShell 7 before heavy builds; stopped backup keeps all existing reparse, stopped-process and exact-content guards while supporting long paths. `TEXTTEXT_WINDOWS_POWERSHELL7` on the Mac explicitly supplies an existing absolute PC runtime path through the encoded SSH command. Otherwise PC `TEXTTEXT_POWERSHELL7`, PATH `pwsh`, or standard Program Files PowerShell7 is used. No runtime is installed automatically. For this PC the explicit existing runtime is `C:\Users\Shokunin\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe`.

Validation: `node --test windows/scripts/backup-directory.test.mjs windows/scripts/backup-runtime.test.mjs` passes3/3 on PC and Mac (`/private/tmp/texttext-backup-checks-98b`). Cases cover >260 path exact binary bytes, hidden/empty directories, existing/nested-target refusal, root/nested links, and literal escaped runtime argument transport. `test-backup-runtime.ps1 -PowerShell7 <existing runtime>` passes2/2 on PC: explicit runtime selection and clear missing-runtime refusal. No simulations counted as installed acceptance.
