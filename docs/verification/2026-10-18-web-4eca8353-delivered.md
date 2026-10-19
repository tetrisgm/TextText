# Oracle web delivery: 4eca8353

The unchanged standard Mac `npm run deploy:web -- --skip-tests` completed successfully with the previously verified Linux ARM64 archive, SHA-256 `114345193e5bb28ab6b29c3869375c1126f249565e7f549a9aa1f8463697f9dd`. It reused genuine passed receipts and reran its normal checks, backup, migration, health and authenticated smoke. No guards were weakened. Source commit: `4eca8353f455d5960e5c4cd592bece0aefff70fa`; see [the matching Mac candidate](2026-10-18-mac-1269-candidate.md).

## Approved storage cleanup

The owner's “kill the blockers with ssh” instruction authorized the exact ten previously proposed October 9 incoming `release.tar.gz` archives. Before deletion, every leaf and ancestor was checked for symlinks; each archive remained regular with its exact proposed size and freshly captured inode/mtime. All ten matching unpacked releases existed. The newest existing backup passed PostgreSQL archive table-of-contents validation before mutation.

Only those ten archive leaves were deleted: **3,119,945,605 bytes** (3.12 GB). Unpacked releases, backups, current deployment and other services were preserved. The earlier storage finding was a read-only preflight, not a failed 4eca8353 upload. Separately, the initial same-normal-source dry run refused the local work-unit guard; its original `failure.json`, `standard-web-dry-run.result.json` and corresponding logs remain under `/private/tmp/texttext-web-4eca8353-dry-run-20261018/`. That failed attempt is not relabeled as passed. Fresh-source standard preparation and this deployment subsequently succeeded after the approved cleanup. Proposal: `/private/tmp/texttext-oracle-oct9-approval-proposal-20261018.json`; fresh before/after proof: `/private/tmp/texttext-oracle-oct9-deletion-receipt-20261018.json`, SHA-256 `dfd033ca60ea06eaa803bdaee5b13958ff826f96b0e84d231a305d72d78b0e7e`.

## Verified result

Public `/api/app/build` and the deployment's loopback health/identity checks agree on `texttext-oracle-20261019T021551274Z-4eca8353-1c86ff`. All **13 authenticated smoke checks** passed, including durable retry, canonical audit, deletion/Trash, same-identity restore, stale upload fencing and scratch-workspace removal. The previous application release remains available.

Fresh pre-migration backup `texttext-20261019T033609Z-dd80959a.dump` is **312,102 bytes**; independent `pg_restore --list` succeeded with **354 output lines**. This validates its archive table of contents, not a new scratch-restore drill. TextText and its PostgreSQL remained active; Algorave app, PostgreSQL and HTTPS services were also active. Final free storage: **9,956,892,672 bytes** (9.95 GB).

The final committed-source proof remains **3,158 files**, SHA-256 `e100bcf09a1bc9c689ba62610ea88f3aa01328a1563a0497b1c276f577f650f2`, matching the normal candidate before and after deployment. The only new compiler cache was validated against locked TypeScript 5.9.3 and retained by reversible same-volume rename with its inode/hash preserved. No source or normal app artifact was changed.

Final delivery receipt: `/private/tmp/texttext-web-4eca-final-delivery-receipt-20261018.json`, SHA-256 `096f5c0958886c0b931a5c46da50535fbc33d909060a105cb06400f78e2ab298`. Private raw log: `/private/tmp/texttext-web-4eca-authorized-deploy-20261018.log`, SHA-256 `b39751aa8655f7ac47b0c48a2d787222538741573a6849bad6f84aa7cf0d1466`. Public build, backup and service observations: `/private/tmp/texttext-web-4eca-live-verification-20261018.json`.

This is web deployment and bounded smoke evidence. It does not claim installed native acceptance, a physical six-client campaign or full performance acceptance.
