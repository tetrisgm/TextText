# Windows explicit account adoption transaction, October 17

T17 source unit. No user state adopted, no installed artifacts changed, recovery UI not connected yet.

`AccountStateAdoption.AdoptAfterExplicitReview` implements the transaction in the [adoption contract](account-adoption-transaction.md) for existing Windows state. Its caller must capture a verified account, confirm the user's explicit choice and retire writers first. The helper takes no credential and grants no server authority.

It validates active state/checkpoints/intents, prepares exact original and replacement metadata copies, publishes a versioned root/account-bound intent, checks each target before replacement, publishes ownership after verification, and retains completion/backups. Queued operation IDs, cursor/lifecycle values, pending updates, projections and asset bytes remain intact. Cached write grants become denied until a fresh authorized manifest. Already-bound retries create no duplicate archive. Unknown, foreign, divergent, malformed or unsafe records remain protected.

Private directory traversal is bounded to the known active layout and refuses links/unknown subdirectories. Root ownership probing likewise avoids recursive traversal of unknown retained folders on both platforms.

## Verification

- Six controlled interruptions: each metadata preparation, intent publication, each metadata replacement and ownership publication. Same-owner recovery passes; another account and ordinary sync cannot resume a partial migration.
- Exact original backups, unchanged pack/assets, original operation replay once, stable restart after acknowledgement, idempotent completed retry.
- Future state/intent, foreign state, null intent entries, unsafe target path, corrupt original/replacement copy, preflight divergence and a target changed between replacement steps all refuse without overwriting retained bytes.
- The between-step race failed before the immediate target recheck fix: `/private/tmp/texttext-t17-windows-adoption-race-before.log`. It passes after: `/private/tmp/texttext-t17-windows-adoption-robust.log`.
- Full native gate passed (37 Mac app, 107 File Provider kit with one separately covered no-space skip, 40 agent tests, Windows core including adoption cases): `/private/tmp/texttext-t17-adoption-windows-native-gate.log`.
- Exact-source core/adoption tests passed on the physical PC: `C:\Users\Shokunin\dev\texttext-t17-explicit-adoption.log`.

## Remaining

Mac transaction, separate-process adoption restart, real storage-refusal campaign, UI consent/current authorization capture, old browser-profile recovery, cross-process exclusion and background callers. Ordinary opening deliberately remains blocked for unbound work. A valid native queue migration does not prove browser drafts or the complete T17 compatibility matrix.
