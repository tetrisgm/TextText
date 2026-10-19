# Release regression boundaries

The pristine `862aaddf06cc63469e3131f992998c7d0d96a09a` Mac build stopped at its required full web unit gate: 5,368 passed, two failed and 161 skipped. It was not installed; app, private actor and CLI build steps did not proceed. Failure evidence: `/private/tmp/texttext-final-local-store-1270-862aaddf-20261019/normal-build-failure.json`; full log SHA256 `5899b488f0a65dbf7006ec29709322f4d2c821c22d8e0c915f741454c0523a0f`.

- The portable creation-parent guard already refused a symlink, but returned the generic non-directory message. It now identifies a symlink separately, preserving the refusal and the existing assertion. Non-directory parents remain refused.
- The native route test extracts actual production Swift command-response definitions. Its old end boundary also captured the new unrelated CLI inventory type, whose remote-item dependency was absent from the standalone test. The extraction now ends at that explicit type boundary and asserts both boundaries exist; all original response decoding assertions remain. No decoder or response contract changed.

Both complete focused suites passed on the Mac: **42 tests passed, one existing skip**, exit zero. Log `/private/tmp/texttext-release-two-regressions-fixed-20261019.log`, SHA256 `32039a5658e85fe982287a51b1156a27fdb42f6e839ecc3046cfe87d14980597`. Command: `node node_modules/vitest/vitest.mjs run src/lib/vault/server-store.test.ts src/lib/mcp/__tests__/native-file-command-route.test.ts --maxWorkers=2`.

The failed frozen candidate remains evidence, not delivery. A fresh matching source build and full release gate are still required. The separate Windows bridge fixture correction is described below. No live account, installed app, document or infrastructure changed.

## Stable Windows handoff fixture

The same frozen official PC build passed all 1,638 Core assertions, then refused a bridge opening with “Pending file sync must finish before joining shared editing.” The isolated original fixture and one full passive diagnostic each passed; the original timing was not deterministically reconstructed. Its setup started a background worker without awaiting native file readiness.

Adding the supported `files.ready` precondition exposed a concrete second problem: both baseline entries had `Refresh=true`, their placeholder revision was `r1`, and the worker reported `Specified method is not supported.` The shared stalled transport deliberately throws from `DownloadAsync`, so this stable-profile fixture could not complete refresh. That diagnostic and the original required failure remain in `/private/tmp/texttext-pc-frozen-862aaddf-awqmeb97/`.

Only this fixture now uses a dedicated stateful transport: actual uploaded bytes and hashes, manifest/download, identity/CAS validation and exact operation replay. The general stalled transport and its blocked-worker cases are unchanged. A bounded native readiness precondition follows release of the profile reader and precedes the existing certified-open retry. No pending-sync IOException is caught, no production guard is relaxed, and all original profile-lock, cancellation, account and duplicate-owner assertions remain.

- Actual PC: two fresh full Windows bridge processes each passed **120 checks**, exit zero, after a no-incremental compile. Named test overlay SHA256 `1cf5525788bb28e2178c560ac1e76f4583cd58a02d5f8b2f84f0940db0c4a4c6`; production Windows sources retain the frozen F862 identity. Logs: `stateful-overlay-two-process.stdout.log` and `.stderr.log` in the PC evidence directory above. These are regression checks, not a passing original candidate build.
- Portable Mac: **69 checks passed**, with one explicit actual-Windows fixture skip, exit zero. The test source hash matched before/after. Log `/private/tmp/texttext-bridge-stateful-fixture-portable-mac-20261019.log`, SHA256 `61f4c7572ff682fa2bf419c7bb2cd0e5127e9e5ce66ce386224fff413179ebe9`.

Fresh whole-source release/build gates are required after these changes. No app, actor or CLI candidate was installed, and no live account, owner content or security configuration changed.

Final PC fixture result: `/private/tmp/texttext-pc-frozen-862aaddf-awqmeb97/stateful-fixture-result.json`, SHA256 `9d1925447285c56ba727c24fe4e7de76eae224391ae0c2740597c10bd9fd7a7a`. All 3,236 frozen inputs matched before/after the named overlay run; owned children were absent, matching account-security events were zero, and the existing owner process remained unchanged and responsive.
