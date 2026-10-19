# Readonly asset-proof adapter source verification

## Scope

This extends the [staged protocol](2026-10-19-staged-six-role-asset-proof.md) with guarded browser/file reader source only. No authenticated browser/native role or physical campaign ran for this source. Neither adapter advertises `binaryAssetObservation`; the coordinator still explicitly refuses asset-proof campaigns even if all actors claim capability. Native proofs and the independent six-role same-wave oracle remain incomplete. Existing sealed `8e`/`c84`/`e8` artifacts remain separate and are not relabeled.

## Read boundaries

- [pack-reader.mjs](../../sync/stress/pack-reader.mjs) mechanically separates the existing readonly pack parser, limits, error class and identity parsing. Existing file-adapter exports remain available. Parser, normalization, writer and default protocol semantics are unchanged; browser inspection does not import file-writing modules through the asset helper.
- [asset-proof-observation.mjs](../../sync/stress/asset-proof-observation.mjs) compares source/scope/session/selection authority around readonly awaits. Browser inspection uses the existing authenticated item GET with strong ETag and encoded path, current account and sealed source, page/context/session/generation/reload identity, and actual selected live document. The [existing live API](../../src/lib/documents/live-inspection.ts) validates the complete product schema on every read. Only complete canonical equality with both live reads discharges the raw helper's validation requirement. This is not rendered-pixel evidence.
- File inspection uses the actual owner/source guard, root/ancestor/file no-link regular identity and stable bytes. Its state retains `assetProofRequiresValidatedLiveSnapshot: true`; a filesystem reader has no renderer or full-schema authority. Before future acceptance, the coordinator must compare the complete raw observation with an independent product-validated live snapshot from the same wave. This phase does not implement or enable that oracle. `projection-mismatch` remains a refusal and grants no pending authority.

Both actual browser/file inventories and the sealer fixture pin the imported `packReader`, `assetProof`, `assetPackProof` and `assetProofObservation` files. Fresh committed source seals are required before any runtime use. Ordinary states and attestations are unchanged; asset fields appear only on explicit readonly requests. Invalid/non-observe descriptors refuse before the added read. No new API, account/auth flow, product writer, native code, deployment or installed app changed.

## Official registration

The default [test-sync entry](../../scripts/test-sync.sh) delegates to [sync verification](../../sync/verify.mjs). Its core/client lanes dynamically discover every `sync/stress/*.test.mjs`; recursive `sync` input fingerprinting already covers the new reader/helper/test bytes. No gate runtime or input-list change was needed. Additional [registration tests](../../sync/verify.test.mjs) explicitly require the new test names and prove changes to each new helper/test invalidate the fingerprint.

## Checks and evidence

- Main source-frozen driver/relay gate: **323 passed, zero failed, one explicit Windows-only skip** (`actual Windows PowerShell evaluates registry and last-feature literals`, on this Mac). Command: `node --test --test-concurrency=1 sync/stress/*.test.mjs windows/scripts/stress-browser-relay.test.mjs`. Log `/private/tmp/texttext-asset-adapter-main-exact-final-20261019.log`, SHA-256 `0c2d8d6db982446a110dba9a0d5c7e44c0dd9fff6f1bb28fb2abfceeda2b76ab`.
- Existing full-schema readonly live-inspection API: **3 Vitest tests passed**. Log `/private/tmp/texttext-asset-adapter-live-inspection-20261019.log`, SHA-256 `8959bb26ac0949cc26cf5d4a503396026152dbad633bc4ff558a8c6ba125c738`.
- All eleven runtime/test source hashes matched before/after. Syntax, shell syntax, whitespace and relative-reference checks passed. The final private manifest also pins the registration test and this receipt.

The guard test first failed because its new module did not exist; this is not an installed-bug claim. Scratch full verification retained 295 passes and one artifact-path mismatch because its dependency directory intentionally linked to main dependencies, so `import.meta.resolve` returned real paths. The inventory assertion was unchanged. Actual main-tree map/sealer and complete driver verification passed. Scratch source stayed separate until relay commit `8e437c4f` released dependency-map ownership.

Registration verification: **16 Node tests passed, zero failed/skipped**. Log `/private/tmp/texttext-asset-adapter-registration-final-20261019.log`, SHA-256 `01141abaeddae077e1872a375dd99e072a5f6fd9a819eb917b8d2683f0ce8d27`.
