# Staged same-wave asset oracle verification

## Scope

The pure [wave oracle](../../sync/stress/asset-proof-wave.mjs) requires exactly six roles. It reuses the existing [12-field proof parser](../../sync/stress/asset-proof.mjs) and the parser's newly exported strict asset-map validator. A nonempty, detached expected asset map is mandatory; six agreeing but wrong, extra or missing maps cannot pass. Observations always come from actual reply fields, never the expected pin.

Each wave binds a fresh UUID, a bounded monotonic deadline, role-specific checked artifact/principal scope and actual non-file session/generation pins. Direct-file roles have no invented live session. Four product-validated live snapshots with marker `false` and two original raw file snapshots with marker `true` must have exact full canonical equality within that wave. Product schema validation remains the producer's responsibility. The oracle copies no product schema validator and does not convert raw fields into validated content. Proofs, snapshots and maps are detached and deeply frozen; getters, sparse arrays, foreign/subclass array prototypes and symbolic map keys refuse.

Three complete stable waves are required. ZIP hashes may differ across sources; stability compares each role's own archive hash. The UUID ledger is capped at 256 waves **per convergence phase**, not an entire 100-round campaign. Future integration must create a phase owner with fresh checked pins and independently prove normal reopen; this pure helper does not implement reopen or acceptance.

The coordinator remains explicitly unavailable for asset-proof campaigns, and adapters advertise no capability. No native producer was copied from scratch, no coordinator was changed, and no physical campaign, browser, compiler, deployment or installed acceptance ran for this slice. Existing normal/private artifacts remain separate; future runtime imports require reviewed fresh seals.

## Registration and checks

The default [test-sync entry](../../scripts/test-sync.sh) delegates to [sync verification](../../sync/verify.mjs), which dynamically discovers `sync/stress/*.test.mjs`. Recursive `sync` fingerprinting already covers both new files. The additive [registration assertions](../../sync/verify.test.mjs) require discovery and prove either file's mutation invalidates the fingerprint. No unused role-runtime pin or native gate change was added.

Main canonical five-suite gate: **68 passed, zero failed/skipped** (proof 6, pack proof 7, observation 5, wave 33, verifier 17). Actual command:

`node --test --test-concurrency=1 sync/stress/asset-proof.test.mjs sync/stress/asset-pack-proof.test.mjs sync/stress/asset-proof-observation.test.mjs sync/stress/asset-proof-wave.test.mjs sync/verify.test.mjs`

Primary log: `/private/tmp/texttext-asset-wave-main-valid-final-20261019.log`. All four executable input hashes match before and after this fresh run. The pack reader is exercised transitively; no standalone reader suite exists.

Preparation limitation: the earlier exact invocation was `node --test --test-concurrency=1 sync/stress/asset-proof.test.mjs sync/stress/asset-pack-proof.test.mjs sync/stress/asset-proof-observation.test.mjs sync/stress/asset-proof-wave.test.mjs sync/stress/pack-reader.test.mjs sync/verify.test.mjs`. Its nonexistent `pack-reader.test.mjs` argument selected no suite and contributes no coverage. That original 68-test log remains unchanged at `/private/tmp/texttext-asset-wave-main-final-20261019.log`; the valid command above was separately rerun.

The scratch pure gate passed 39 tests, including 33 new wave tests and six existing proof tests. Coverage includes all-six matching wrong/extra/missing asset maps, missing one pinned asset, hidden full-document drift and omission, marker/source/scope/session mismatches, duplicate/stale samples, deadline/clock refusal, detached pins, per-role archive stability and the finite phase ledger. These are source tests, not six-client physical proof.

Existing coordinator simulation regressions: **91 passed, zero failed/skipped**, including staged asset-proof refusal before any prepare/edit. Command: `node --test --test-concurrency=1 sync/stress/stress.test.mjs`. These pure timed simulations took 124 seconds; no actual browser/native compiler or physical campaign ran. All four executable input hashes match before and after both gates. `git diff --check` and receipt-relative-reference checks pass.

Exact evidence:

- `/private/tmp/texttext-asset-wave-main-final-20261019.log`, SHA-256 `ca5f661920f7e5019486b6a93cdbebf64f252bb265e436b1ef1bc985b39871af`.

- `/private/tmp/texttext-asset-wave-main-coordinator-20261019.log`, SHA-256 `a9fe0a874df6fbe1d5908817b1ca308c72bd8cf8fd354daa746a61b7f8fa2006`.

- Primary valid five-suite log `/private/tmp/texttext-asset-wave-main-valid-final-20261019.log`, SHA-256 `e36a47c7d4b2333a6782c12d56d3090ff9b01252a8e1d7e5b0942c1d0f0a5b49`.
