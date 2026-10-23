# Web delivery aa8f8a1b

Source `aa8f8a1b59e58ffed3fe0ed8b956da8370e7e885`, deployment `texttext-oracle-20261023T023701Z-aa8f8a1b`, delivered through the human-invoked Mac `npm run deploy:web` path. The previous release, `4eca8353`, is retained as the rollback target.

The release includes the Windows/shared changes `56d144f7`, `67efe404`, `680a8581` and `ca7c5540` (just-created notes stay editable while the listing catches up), the server folder-alias guard `9e7daa62`, and the owner's `aa8f8a1b` variable renames.

## Gates (same source, genuine runs)

All gates ran on the Mac.

**Run 1, full ship gates.** Passed:
- `npm test`: 601 files passed, 32 skipped
- `test:db`: 29 files
- the 543-test node suite

`test:sync` stopped because it must run through `scripts/with-local-database.mjs`.

**Run 2.** `test:sync` stopped because `FolderSyncRecoveryBridgeTests` skipped without `TEXTTEXT_MIRROR_POLICY_BUNDLE`. The required-suite guard correctly refused it.

**Run 3.** The fresh bundle came from its real producer, `node src/local-vault/__tests__/mirror-policy.browser.mjs`, which passed. Then `node scripts/with-local-database.mjs npm run test:sync` exited 0.

**Run 4.** `npm run deploy:web -- --skip-tests` validated the run 3 receipt with `test:sync:check`. It then ran:
- TypeScript
- the Oracle tooling tests
- bootstrap verification (49 migrations)
- the production build and the bundled PDF worker check

On Oracle, it verified the runtime, took the pre-switch database backup `texttext-20261023T023906Z-256b95da.dump`, migrated, switched, and ran 13 authenticated smoke checks, all passing:
- session
- cookie origin
- file workspace read
- empty folder creation and retry
- note create and read
- note edit, retry and read
- native search contract
- quick capture receipt
- canonical storage and audit
- deletion and Trash
- same-identity restore
- pre-restore upload fence
- scratch workspace removal

The run 3 deploy attempt had stopped before switching, because the pre-deploy backup refused: free space was below the archive budget plus the floor. Existing backups were preserved.

## Mac checkout handling

- The owner's `attachments.ts` and `tabs.test.ts` edits, variable renames that pass ESLint and TypeScript, were committed as `aa8f8a1b` at the owner's request.
- `mac/Package.resolved` was not committed. That edit drops the Sparkle pin that the direct-distribution build still uses. It was stashed for each run and restored, with SHA256 `eea669ec…` checked before and after every time.
- Untracked files were untouched.

## Oracle storage cleanup (owner-approved, 2026-10-22)

- Deleted the 22 TextText releases dated October 8 to 11, about 18 GB. The script checked the count was exactly 22 and that none was the current or previous target.
- Kept the October 17, 17, 18 and 19 releases and the new `aa8f8a1b` release.
- The owner said Algorave and Interplanetary must stay running, but should not hold large storage.
  - Removed the non-current Algorave release `1e890081cd78` (746 MB). Current `aef7c8f53706` is unchanged.
  - Vacuumed `/var/log/journal` from 2.5 GB to 189 MB. No configuration was changed.
- Every service stayed active: `texttext`, `algorave`, `algorave-https` and `interplanetary-namespace`. The disk went from 38 GB used and 7 GB free to 18 GB used and 27 GB free.
