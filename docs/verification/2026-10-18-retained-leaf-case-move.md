# Retained leaf case rename

Exact six source/test SHA256 values: `/private/tmp/texttext-retained-case-only-native-full-20261018-source.json`. Package.resolved retained git blob `ecef5ee26c5bc34cddc75ad2aa80b7394857c591`.

- Same-parent leaf case aliases qualify only when the old exact spelling exists, the requested new exact spelling does not, and both aliases refer to the same actual device/inode. A bound private `caseOnly` flag is validated between registry and operation manifest.
- Validated lexical leaf URLs preserve the requested spelling. Foundation realpath otherwise normalizes an existing alias to its old spelling. The existing exclusive no-symlink Darwin rename remains in use; no overwrite or intermediate fallback was introduced.
- Exact directory leaf presence distinguishes absent original spelling from present destination after rename. Restart replay, independent source/destination Recovery observations and final-gap hash/identity refusal use those semantics. Subsequent legitimate saves remain supported.
- Local OS probe on this Mac's APFS volume: `renamex_np` with `RENAME_EXCL | RENAME_NOFOLLOW_ANY` returned zero for a qualified same-inode case alias; directory spelling changed and exact bytes were preserved. The disposable probe fixture was removed by its owner.

Evidence:

- `/private/tmp/texttext-retained-move-case-only-focused-20261018.log`: 68 selected tests, two benchmark skips, zero failures. Three new fixtures cover requested actual leaf spelling and later save, captured interruption/restart replay, and a final-gap foreign version with exact original absence and explicit Recovery acceptance.
- `/private/tmp/texttext-retained-case-only-native-full-20261018.log`: required Swift selection with `TEXTTEXT_STRESS_ACTOR`, app 50 tests (four skips), FileProvider 221 (six skips), CLI 40; zero test failures.

This source gate covers Store/Sync leaf rename. Active shared-editor rebase and containing-folder case reconciliation remain separate follow-ups; no broad case-only folder or installed application acceptance is claimed here.
