# Interim installed delivery and upgrade finding

T03/T20/T26, October 18. Product source: `f994b8f1eee9ff6615856916f180001dc23a00ba`. [Candidate gates](2026-10-18-coherent-candidate-build.md) passed before delivery. This is an interim delivery, not completion of installed acceptance.

## Delivered identities

- Oracle serves `texttext-oracle-20261018T174659Z-f994b8f`. Public and loopback build identities, remote full source commit, active service and live canonical gallery/talk catalog verified. Standard web-only deployment exited zero; all 13 authenticated/storage/audit/delete/restore smoke checks passed and the scratch workspace was removed. Previous release retained.
- Mac `/Applications/TextText.app`: **0.204 (1263)**. Official installer exited zero with strict signature/arm64/three-extension checks and required runtime health. Finder-provider health reported a nonblocking warning; no health override was used. Normal saved-state window opened, and guarded Cmd-Q worked. Existing-account upgrade acceptance failed as described below.
- Windows normal F candidate installed in the usual Programs/TextText directory, official installed seal verified. Executable SHA-256 `cbad45e0eeaa751eff811df65e2acad946c1dd5885a86ef5b6b2f496f0225a88`. Previous directory `TextText-previous-20261018T104643-8647d142` retained. Actual owner-session first launch produced a responding visible TextText window, PID 40636. The SSH session's zero window handle was not counted as a failure; the same-session probe verified the real handle. Only the owned launch/probe task registrations were removed, without stopping the app. Actual saved-work review awaits the user's visible action; no helper fabricated adoption.
- Verified F release CLI installed with the previous executable preserved, as recorded in the candidate receipt.

No public Mac release occurred.

## Backups before native replacement

Oracle's standard incoming-release pipeline validated a fresh pre-migration backup, `texttext-20261018T174852Z-fb8bda2d.dump`, 305,362 bytes, mode 0600, SHA-256 `1acddac29e7af5439e97a2f3aaded4103ab48512d63f4ce06aa17779151151c4`. This is not a separate full restore drill.

Mac private backup: `/Users/shokunin/Library/Application Support/TextText/PreinstallBackups/20261018-before-1263-f994b8f1`, mode 0700. It preserves 2,303 vault files, 525 files from the actual bound device state, and 41 prior signed-app files. Manifest SHA-256 `b16e6a931ce736382e15e3d0f7c7680014c9e38f7e40a042c7c108cfc16ded3f`. Initial changing-source checks refused before creating a backup. A separate full-data read hydrated 39 hidden history archives; their dataless flags cleared without inode/size changes. Only then did two strict source snapshots, copied-byte verification, final unchanged-source verification and prior/copied app signing checks pass. Credentials/browser profiles were excluded by selecting only the required roots; inaccessible sandbox configuration was not bypassed.

Windows create-only private backup preserves the actual vault and `c302…` sync state, not the empty default directory: 1,110 files, 103 directories, 7,340,498 bytes. Source/copy/post hashes matched; owner+SYSTEM protected ACL and no links. Inventory SHA-256 `16faaf065abc0843f8196e9be33f3181eccca7960a7dba6062a7b00d6cf1f062`. The conflicted pending operation `b13e58ea-d878-4414-a922-4c1f34cadd80` remains preserved. No DPAPI account/token/profile copy was made.

Private evidence: `/private/tmp/texttext-f994-delivery-and-backup-receipt.json`, `/private/tmp/texttext-normal-installed-1263-f994b8f1-20261018.log`, and `/private/tmp/texttext-pc-frozen-f994b8f1-9chy9n57/installed-receipt.json`.

## Real Mac upgrade failure, retained

In the actual installed app, File → Review saved work closed the menu without an alert or review. Settings showed the correct authenticated account and workspace. Read-only inspection confirmed the older native credential lacks `accountId`; the root ownership marker remains absent. No sign-out, marker fabrication, journal reset or adoption occurred.

`reviewSavedWork` requires the window's verified account ID and silently returns when it is absent. The existing authenticated identity-cache refresh is skipped by local-workspace startup/recovery paths. A legacy window also deliberately pins its original credential lifetime; filling the cache must not relabel that window's accepted journal. The next fix must reach the existing verified identity refresh, give a useful unresolved-review result, preserve the old lifetime and support guarded reopen followed by explicit saved-work review. Installed acceptance remains open until that exact path passes.

## Other acceptance progress and open dependencies

Actual gallery and talk CLI create/read/guarded edit/exact retry/stale-write refusal passed on deployed F. Article, note and bookmark also passed current-F reads, original-create replay to the same IDs, fresh guarded edits, exact edit replay, unchanged non-body schema/template/fields/assets, stale refusal and independent reread. Their original creation was on the prior deployment; that distinction remains recorded. Saving a custom gallery look replayed to the same template; immutable v2 creation, stale-base refusal and unchanged v1-pinned item passed. Existing gallery content remained unchanged. Private exact request/result evidence: `/private/tmp/texttext-t20-live-f994-20261018`. UI picker, assets, folder defaults, retirement, assistant and hosted MCP coverage remain open.

The required existing changelog belongs to separate `Shoku's Space`; the current authorized CLI workspace search returns no match. Historical receipts already establish this workspace separation. No duplicate changelog was created. The existing hosted MCP connection still needs OAuth renewal before that record can be updated.

The first private Mac actor build correctly failed because its required native recovery suite skipped without the packaged policy fixture environment. No actor receipt/sidecar was minted. The unchanged retry has a verified current-F fixture prepared, but is held while the real installed upgrade issue is fixed. Physical six-client campaigns, endurance and measured performance remain open. Historical binaries must not be restarted against upgraded persisted formats; use forward recovery and retain the exact backups.
