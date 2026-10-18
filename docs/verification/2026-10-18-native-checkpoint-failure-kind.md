# Typed native checkpoint failure diagnostic

The installed1266 zero-input failure remains unresolved. Its preserved export reported code503 with withheld details and a clean generation1/epoch1/sequence0 checkpoint. This change adds a bounded diagnostic category for the next controlled capture; it neither identifies that original cause nor changes saving, retirement, recovery, reopening or retry behavior.

Native classification switches on typed known failures and an explicit Cocoa filesystem-code whitelist. It does not export exception domains, numeric native codes, paths, userInfo or underlying errors. The optional `checkpointFailureKind` field is emitted only for `collaborationCheckpoint`. The TypeScript bridge binds that field to the original pending request method and accepts only the exact33-value union. Unknown future strings, malformed values, inherited properties and getters do not become exported categories. The explicit typed `unknown` category remains allowed; absence stays absent for older bridges. Existing error code/status/message handling is unchanged.

The recovery diagnostic keeps this optional allowlisted field alongside its existing sanitized scalar context. It never infers a category from an arbitrary exception message or HTTP code. The integration regression preserves the same clean503 fatal state and retained journal while proving the original category survives the safe export.

## Verification

- Native focused gate:26 tests pass,0 skip,0 failures (Kit2 classification tests and AppCollaboration24, including checkpoint-only bridge scope). Log: /private/tmp/texttext-native-checkpoint-kind-focused-20261018.log. The exact pre-existing Package.resolved bytes were restored afterward.
- Relevant TypeScript tests:125 pass across bridge, checkpoint diagnostic and collaboration client. Log: /private/tmp/texttext-checkpoint-failure-kind-js-20261018.log. Tests require complete exact parity with all33 native enum values and reject future/untrusted classification data.
- TypeScript no-emit without incremental output passes; log /private/tmp/texttext-checkpoint-failure-kind-tsc-20261018.log. All ten owned-path diff checks pass; exact hashes: /private/tmp/texttext-checkpoint-failure-kind-final-source-20261018.json. No browser, installed-app action, live account operation or checkpoint replay is performed by this verification.

```sh
npx vitest run src/local-vault/bridge.test.ts src/sync/engine/checkpoint-diagnostic.test.ts src/local-vault/collaboration-client.test.ts
npx tsc --noEmit --incremental false
```

This is future candidate diagnostic source. A freshly built and installed matching candidate is required to capture an actual failure category; existing installed failure evidence must not be relabeled with a guessed category.
