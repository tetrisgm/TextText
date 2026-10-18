# Retained native file replacement

October 18, 2026. Source and private-fixture verification; no installed or deployed acceptance is claimed.

## Retention and recovery contract

A replacement stages immutable candidate bytes, an exchange file and a versioned durable manifest. New document operations use a fixed hidden workspace location on the destination volume; legacy operations remain readable beside their original destination. Darwin swaps inodes; Windows uses replacement with a backup. The actual displaced file survives the final-check race, including a different document or incomplete ZIP. No automatic rollback overwrites another writer. An old open descriptor can continue writing the retained inode; later inspection reopens the conflict if its fingerprint or bytes change.

The device-private registry binds operation, stable item identity, workspace root and semantic account owner. Normal store reads, mutation replays, already-open editor checkpoints and sync upload/acknowledgement boundaries refuse an unresolved replacement. Unrelated items remain usable. Explicit recovery verifies all three observed hashes, exports retained alternatives, durably records consent, then acknowledges the helper manifest. Reconstruction finishes an interrupted acknowledgement from those exact retained hashes. Resolved records remain inspectable, including opaque bytes.

The candidate exchange inherits destination permissions, ACLs and extended metadata before the Darwin swap. Clone-on-write staging is used when supported; copy fallback retains the same contract. Free-space refusal occurs before target mutation. Artifacts are not automatically deleted. Directory flushing is exercised, but these tests do not establish machine power-loss guarantees.

## Supported profile compatibility

- Existing owner version 1 bytes are preserved exactly before an attested owner version 2 profile is published. Supported prior account factories reject the future owner version.
- Current factories accept version 2 only with the bound profile and retained original owner. Semantic principal identity does not change with the owner-format version.
- Interrupted profile publication reconstructs or refuses; a principal changed at the final publication boundary is retained and both conflicting principals are fenced. There is no blind rollback.
- Unowned local registry entries are migrated only through the existing explicit adoption transaction, with exact before/after archives, restart proof and future/foreign-field refusal.
- Raw tools and already-running old processes remain external writers. This does not claim that old binaries retroactively understand new private manifests. Close the old app normally before a supported upgrade. Candidate-written profile data requires forward recovery; do not erase it to make an older app open.

## Checks

- Full required native gate: `/private/tmp/texttext-retained-native-gate-20261018.log`, exit 0. Mac app 48 tests with 4 opt-in skips; FileProvider 172 tests with 5 opt-in skips; CLI 40 tests; portable Windows Core passes. This includes actual WK policy/session checks selected by that gate.
- Reviewed Mac replacement/recovery/adoption run: `/private/tmp/texttext-retained-reviewed-benchmark-20261018.log`, exit 0, 119 tests with 2 existing opt-in skips. Includes foreign/opaque retained snapshots, resolved reopening, late retained writers, explicit-resolution interruption, per-item sync/editor fences, immutable binary provenance, metadata, low space and folder relocation.
- Windows isolated actual-PC helper: `/private/tmp/texttext-t12-retained-windows-actual-pc.log`, 69 assertions pass. Real replacement, final-check race, old descriptors, profile publication and moved/resolved recovery are covered. Scratch/helper proof is not installed app acceptance.
- [Conflict byte retention](2026-10-18-conflict-recovery-retention.md), [shared recovery UI](2026-10-18-retained-replacement-ui.md) and [real iCloud eviction/hydration](2026-10-18-icloud-provider.md) have separate bounded receipts.

## Normal-store integration and remaining acceptance

Normal Mac `write` and exact-byte replacement now use the retained workspace exchange. Owned saves attest the supported profile before registering the operation; unowned local saves preserve bytes without inventing an account principal. Final-gap, lost-reply, permissions, replay refusal, explicit recovery and subsequent-save regressions pass. Workspace staging and per-item identity lookup reduced the 1,000-save probe (128 KiB per version) from 97.606 to 22.663 seconds (`/private/tmp/texttext-workspace-staging-benchmark-20261018.log`; exact source hashes in the adjacent `-source.json` receipt). A subsequent allocation/path-validation optimization passed 34 focused tests, including existing folder moves, with no failures (`/private/tmp/texttext-retained-layout-hotpath-20261018.log`). Reusing the preserved 1,000-version fixture, its first guard took 0.404 seconds and cached guard 0.066 seconds; this latter run did not write another 1,000 saves. The separate 1,000-document lookup campaign took 0.926 seconds. These are diagnostic measurements, not passing T25 latency distributions.

The per-item cache relies on the private registry's atomic publication contract and directory generation. Selected records and actual retained inodes are revalidated. It does not detect arbitrary in-place rewriting of an unrelated private registry record to associate it with a different identity without a directory generation change.

Read-only listing should not need to export extra copies; explicit resolution still requires durable exports. Final source enablement, native recovery journeys, coherent builds/installs and the complete physical matrix remain open. Do not promote isolated helper or synthetic browser results to those gates.

The enabled-store native gate passed with `TEXTTEXT_STORE=1 TEXTTEXT_VAULT_HTTP_TEST=1`, `swift test --package-path mac --jobs 2 -Xswiftc -DTEXTTEXT_STRESS_ACTOR` and the required native filter from `scripts/test-sync.sh`: 49 app tests (4 explicit opt-in skips), 187 FileProvider tests (6 opt-in skips), and 40 CLI tests, zero failures. Log: `/private/tmp/texttext-retained-enabled-native-final-20261018.log`; exact changed-source hashes: `/private/tmp/texttext-retained-enabled-native-final-20261018-source.json`. Portable Windows was verified separately in its integration receipt.

The first broad enabled-store run failed (`/private/tmp/texttext-retained-store-enabled-native-20261018.log`). Its adoption fixture selected the first registry entry, which was no longer necessarily its injected operation after normal saves created real retained records; it now selects the exact operation and keeps both byte-equality assertions. Separately, a deterministic cancellation regression proved the test-only shared source-policy evaluator permanently poisoned later contexts after a cancelled request (`/private/tmp/texttext-policy-cancellation-red-20261018.log`). It now rejects cancellation before publication and drains a started bounded request, preserving protocol alignment. The full passing rerun includes that regression; product lifecycle and authentication guards were not weakened.

Retained deletion, actual installed recovery journeys, full current-client performance distributions, coherent delivery and multiplayer acceptance remain open.
