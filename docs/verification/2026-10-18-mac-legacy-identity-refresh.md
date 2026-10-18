# Mac legacy cached account identity refresh

## Failure and bounded fix

Installed 0.204 (1263), source `f994b8f1eee9ff6615856916f180001dc23a00ba`, had legacy signed-in credentials without `accountId`. Local-workspace startup bypassed the existing authenticated metadata refresh, and Review saved work returned silently. A real controller regression reproduced the missing task before the fix: `/private/tmp/texttext-legacy-id-review-red.log`.

Local-workspace startup, sign-in and throttled foreground recovery now reach the existing ServerClient identity verification. Main-thread generation, token and origin checks reject stale results. Independently verified identity is cached even when the separate workspace read fails. This does not start the legacy mirror beside the local window.

Review now presents verification/retry guidance. An already-open legacy window retains its original credential pin and journals. Normal close/reopen is required before the existing explicit saved-work review; no owner marker is fabricated and no adoption is automatic.

## Verification

Latest production-source focused gate: **79 tests, three optional skips, zero failures**, `/private/tmp/texttext-legacy-id-final-source-green.log`. Includes lifecycle, connection, collaboration, state location and foreground recovery throttle tests. The three skipped fixtures require `TEXTTEXT_LEGACY_VIEWER_BUNDLE`, `TEXTTEXT_SESSION_OWNER_BUNDLE` and `TEXTTEXT_COMPOSITION_BUNDLE`; they are not claimed as passes.

Final exact corrected test-source rerun: **four tests, zero skips/failures**, `/private/tmp/texttext-legacy-id-exact-final-tests.log`. Covers actual nil-ID review sheet, local-window hydration despite failed workspace read, unchanged pending bytes and absent actual device-state owner marker, failed-fetch retry, and token/origin/generation stale-result refusal. Existing legacy-window pin and explicit review fixtures passed in the expanded gate.

Intermediate evidence remains preserved: an initial meaningful controller RED; one later test-only compilation typo (unwrapping a nonoptional String), corrected before green; earlier narrower green runs. The pre-existing owner Package.resolved bytes are identified by SHA-256 `eea669ec76b68673014c10c95b90e721c14d67c99de5756f5c8071c968306edb` and excluded from this change. A mistaken attempted reconstruction was detected by that hash before commit; the root worker independently verified and restored exact matching bytes before commit. Unrelated owner files were excluded.

## Remaining delivery

This is a source fix, not installed acceptance. A fresh coherent candidate and required release gates precede installation. Then verify actual cached identity hydration, normal reopen and the supported explicit saved-work review against preserved real pending journals. No public Mac release or user-content mutation is claimed here.
