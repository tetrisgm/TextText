# Staged six-role asset-proof protocol, 2026-10-19

## Scope

This is shared parser and coordinator admission preparation only. No native, browser, or file adapter implements or advertises the new proof. No physical campaign, installed application, recovery workflow, deployment, or account changed.

The opt-in `assetProof: {version: 1}` requires nonempty explicit expected asset hashes and all six `binaryAssetObservation: 1` attestations. It then refuses with `asset-proof-adapters-unavailable` before prepare or edit, even if every actor claims capability. Missing capability refuses earlier. Default campaigns retain the existing two-file asset oracle; absence of the opt-in does not add a config field.

## Strict readonly contract

[asset-proof.mjs](../../sync/stress/asset-proof.mjs) validates exact own data properties for the twelve required proof fields, canonical lowercase UUID correlation/workspace/item IDs, role-specific source, caller-pinned scope/path, bounded lowercase SHA-256 values, actual selected session fields, and 1–32 safe `assets/` entries. Unknown properties, getters, sparse document arrays, unsafe paths, and non-JSON document values refuse. Accepted asset maps are detached and frozen.

The supplied complete document observation is hashed using the existing article observation/canonical JSON convention. An omitted subtitle remains distinct from an empty subtitle. Archive hashes are source-specific and are not an all-machine equality requirement. Validation establishes consistency with caller-supplied readonly facts; it does not itself acquire authenticated bytes or prove rendered pixels.

Future adapters must obtain actual readonly observations under their existing principal/session fences, correlate a fresh sample, and include the helper in their real copied/sealed input inventories when they import it. There are no unused role-runtime pins in this phase. Native/local pack, authenticated server pack, and direct local pack sources remain distinct. This receipt does not close T22 binary convergence/recovery or T24 telemetry/soak acceptance.

## Verification

Relevant parser and coordinator tests cover source/scope/sample/session mismatch, full-document omission semantics, bounded/detached asset maps, malformed data, and refusal with zero prepare/edit dispatches both with missing and claimed-all-six capabilities. Final counts and exact input hashes are retained in the private final manifest supplied for review.

The first focused test attempt incorrectly expected `Coordinator.run()` to reject; it actually returns a failed summary. That fixture-only failure is retained at `/private/tmp/texttext-asset-proof-focused-20261019.log`. The corrected test checks exact failure codes and zero mutation dispatches. This is not evidence of an installed product defect.

Final source-frozen Node gate: **97 passed, 0 failed, 0 skipped** (`node --test --test-concurrency=1 sync/stress/asset-proof.test.mjs sync/stress/stress.test.mjs`). All four code/test input hashes match before and after. This comprises six parser tests and 91 existing/new coordinator tests. Log: `/private/tmp/texttext-asset-proof-exact-final-20261019.log`, SHA-256 `c58be4f53b15d3b891eac848bf00109dadffbd3cab7ec2d91b99fa750de25178`. Syntax, diff whitespace, and receipt-relative-reference checks also passed. Intermediate 95/96-pass runs preceded the final parser tightenings and remain intermediate evidence only.
