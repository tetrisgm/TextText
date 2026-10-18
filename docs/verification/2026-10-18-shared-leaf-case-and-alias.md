# Shared leaf case and alias recovery

Status: required native gate passed. Exact source hashes for the six owned files, two packaged policy wrapper/test files and original Package.resolved are in `/private/tmp/texttext-shared-leaf-alias-native-full-20261018-source.json`.

- Shared rebase qualifies forward or reverse same-inode case aliases, persists a private bound case flag, and uses exact leaf presence when recovering either interruption window. Pending journals, projection hashes and identity checks remain intact.
- Active sessions and closed pending checkpoints follow unique same-identity external case renames. Unknown or future move-intent fields/formats remain untouched and refuse replay.
- Retained operation lookup binds the exact original path-hash staging prefix to one casefold-equivalent actual basename. The manifest's immutable filename remains an exact binding; normal classification uses that physical filename. Writes, removals and moves through stale case aliases preserve discoverable retained operations and actual spelling.
- TextPack extension validation now matches existing Store/list case-insensitive extension support. Traversal, ownership and identity guards are unchanged.

Evidence:

- `/private/tmp/texttext-shared-leaf-case-red-20261018.log`: two new fixtures exposed four failures before fixes, including shared crash recovery and stale active path handling.
- `/private/tmp/texttext-shared-leaf-case-alias-focused-second-20261018.log`: shared cases passed; the alias fixture exposed two retained classification failures.
- `/private/tmp/texttext-alias-layout-diagnostic-20261018.log`: test-only fixture inspection isolated the immutable filename guard mismatch. Temporary diagnostic prints were removed.
- `/private/tmp/texttext-shared-leaf-case-alias-focused-final-20261018.log`: 91 FileProvider tests (four opt-in skips) and three MirrorPolicyHost tests (one explicit-bundle skip), zero failures. The extension-case fixture was added after this focused pass and requires the full gate.

- `/private/tmp/texttext-shared-leaf-alias-native-full-20261018.log`: required Swift selection with Store/HTTP fixtures, actor flag and explicit packaged policy bundle, exit zero: app 50 tests (three skips), FileProvider 228 (six skips), CLI 40, zero failures. Packaged WK policy ran instead of skipping; extension-case mutation passed. The original Package.resolved git blob `ecef5ee26c5bc34cddc75ad2aa80b7394857c591` was restored. Its earlier before-capture hash was transient during the separate broad Swift run; all eight source/test hashes matched exactly before/after the required gate.

The separate broad unfiltered run `/private/tmp/texttext-shared-case-alias-native-full-20261018.log` exposed five legacy identityless CLI write failures and a readonly window fixture failure. These are not hidden by this required-filter pass: legacy byte-preserving write compatibility is the next product repair, and the root worker owns the window fixture correction. Containing-folder case reconciliation and installed-app acceptance also remain separate follow-ups.
