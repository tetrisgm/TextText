# Release regression boundaries

The pristine `862aaddf06cc63469e3131f992998c7d0d96a09a` Mac build stopped at its required full web unit gate: 5,368 passed, two failed and 161 skipped. It was not installed; app, private actor and CLI build steps did not proceed. Failure evidence: `/private/tmp/texttext-final-local-store-1270-862aaddf-20261019/normal-build-failure.json`; full log SHA256 `5899b488f0a65dbf7006ec29709322f4d2c821c22d8e0c915f741454c0523a0f`.

- The portable creation-parent guard already refused a symlink, but returned the generic non-directory message. It now identifies a symlink separately, preserving the refusal and the existing assertion. Non-directory parents remain refused.
- The native route test extracts actual production Swift command-response definitions. Its old end boundary also captured the new unrelated CLI inventory type, whose remote-item dependency was absent from the standalone test. The extraction now ends at that explicit type boundary and asserts both boundaries exist; all original response decoding assertions remain. No decoder or response contract changed.

Both complete focused suites passed on the Mac: **42 tests passed, one existing skip**, exit zero. Log `/private/tmp/texttext-release-two-regressions-fixed-20261019.log`, SHA256 `32039a5658e85fe982287a51b1156a27fdb42f6e839ecc3046cfe87d14980597`. Command: `node node_modules/vitest/vitest.mjs run src/lib/vault/server-store.test.ts src/lib/mcp/__tests__/native-file-command-route.test.ts --maxWorkers=2`.

The failed frozen candidate remains evidence, not delivery. A fresh matching source build and full release gate are still required. A separate Windows bridge fixture failure is under diagnosis and is not covered by these fixes. No live account, installed app, document or infrastructure changed.
