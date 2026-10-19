# Staged asset-proof finite dwell

Initial scratch review, based on `75f5b4cbc9501d0eabd55eff0851ffd46c0cca80`. At that review boundary there was no main copy, capability advertisement, native/browser build or runtime. No actual 60-minute dwell, resource acceptance or full T24 claim.

## Contract

The existing exact 60-minute / 30-second finite-soak protocol now accepts the default-off asset-proof option with its existing compatible mixed plan. Real runs retain the existing 100-round prerequisite; simulation fixtures use two mixed rounds. Pre/post-round convergence still requires three complete six-role proof waves.

Each of the existing 121 dwell samples carries one fresh UUID asset-proof request alongside its ordinary run/sample correlation. All six actual returned proofs, full snapshots, source-qualified identity/session/generation, selected identity/path and four validated-live/two raw markers must pass within the existing 20-second response window. It is one proof wave per 30-second sample, not three. A dedicated oracle owns the dwell's 121 nonoverlapping waves (under its 256 bound). Every sample must match the fixed accepted document and complete nonempty asset map immediately; final consecutive stability must be at least three. No retry/error normalization or new handoff protocol was added.

The same adapters remain alive; no restart or path/asset mutation scenario is enabled. Sampling and cadence are still checked by FiniteSoak. Resources/listeners/native-idle mutation metrics remain null; the independent physical/resource task remains separate. Real reopen still requires the existing prior passing physical mutation receipt. It additionally binds all 121 prior asset/correlation samples, UUID uniqueness across prior phases, fixed full document/assets/path and recomputed trailing stability, then obtains fresh independent reopen proof. Consistency checks do not provide cryptographic receipt authentication.

Output forecast adds 121 full replies per role to the existing required-wave estimate. Oversized required traffic rejects before prepare. The 64MiB actual per-role ledger also counts dwell replies. The existing 16MiB compact-evidence budget includes per-role actual proof records plus the complete serialized asset ledger, including header, map and array delimiters. Full snapshots are validated before storing compact hashes; expected maps never stand in for observations.

## Tests and limits

Evidence root `/private/tmp/texttext-coordinator-asset-soak-scratch-20261019/`:

- `soak-red.log`: original reviewed coordinator refuses the valid asset-proof/soak combination.
- `soak-expanded-green.log`: initial 19 in-memory cases pass.
- `final-pure-gates-exact-ledger.log`: 117 passed, zero skips/failures: 23 soak/default-off/reopen/budget cases, 39 existing coordinator proof cases, 44 proof/wave/observation helpers and 11 finite-soak/correlation cases. Virtual clocks prove protocol boundaries; these tests are not a physical dwell.
- Negatives include missing/stale proof/correlation, wrong all-six map or hidden content, omitted snapshot, live/raw marker, identity/source/session/generation drift, duplicate and late replies, final-sample corruption, prior incomplete/inconsistent evidence, 64MiB actual output exhaustion and 64MiB/16MiB preflight refusal. Default-off still returns the original 121 samples without asset requests.
- At the scratch-review boundary, the process-spawning 91-test coordinator suite was held for normal1273 lane coordination; the later authorized main result is below.

`final-source-manifest.json` records the two proposed files, exact frozen hashes, logs and receipt. Both owned files matched before/after the final pure gate. Main coordinator remains unchanged from its recorded base.

## Separate capability preparation

`activation-preparation/` contains four hello-only proposed diffs covering all six roles, pinned to actual current source hashes. Five static/source checks and JS syntax checks pass. They are not applied, built or launched. Native compile/runtime gates and root review are still required before advertisements or actual activation. The normal product and main/native source were not edited.

## Main copy and pure gate

After review, the main coordinator matched expected SHA256 `70826cfa2120f42974453b4a2fed9bb1250d417e91c6d6827f8e4e389cc88187`; the new test and receipt paths were absent. The exact two executable files and this receipt were copied. Fresh main `pure117.log` passed all 117 tests, zero skips/failures; `discovery.log` confirms automatic verifier discovery. Both owned executable hashes matched before/after. Evidence root: `/private/tmp/texttext-coordinator-asset-soak-main-gates-20261019/`.

The initial main pure gate preceded the separately authorized process-spawning lane. `main-pure-manifest.json` preserves that earlier held-state record; it has not been relabeled.

## Final main regression result

After explicit Mac-owner coordination, `coordinator91.log` passed all 91 existing coordinator simulations with zero skips/failures (124.4 seconds). Both child commands exited zero and all children exited. The same two executable hashes remained exact from before the main 117-test gate through the final 91-test run; only this receipt was intentionally updated. `final-main-manifest.json` records the three delivery paths and final log hashes.

Main totals remain separately attributable: 117 pure/helper tests passed and 91 existing coordinator tests passed, all with zero skips/failures. Discovery and diff checks passed. Capability advertisements remain off; the conditional activation-v2 diffs and their source/builder/refusal checks are separate preparation, not applied native/browser acceptance. No staging, commit, runtime campaign or content mutation was performed by this worker.
