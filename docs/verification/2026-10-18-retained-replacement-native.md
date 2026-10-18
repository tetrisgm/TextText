# Retained native file replacement

October 18, 2026. Source and private-fixture verification; no installed or deployed acceptance is claimed.

## Retention and recovery contract

A replacement stages immutable candidate bytes, an exchange file and a versioned durable manifest beside the destination. Darwin swaps inodes; Windows uses replacement with a backup. The actual displaced file survives the final-check race, including a different document or incomplete ZIP. No automatic rollback overwrites another writer. An old open descriptor can continue writing the retained inode; later inspection reopens the conflict if its fingerprint or bytes change.

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

## Remaining enable work

The normal Mac store replacement call remains held while history cost and final integration are reviewed. The latest 1,000-save probe (128 KiB per version) took 97.606 seconds; first registry read 0.714 seconds and cached read 0.222 seconds. CPU sampling identifies repeated retained-directory/path validation. These are diagnostic measurements, not passing T25 latency distributions. Exact source hashes and subsequent measurements must accompany optimization receipts.

Read-only listing should not need to export extra copies; explicit resolution still requires durable exports. Final source enablement, native recovery journeys, coherent builds/installs and the complete physical matrix remain open. Do not promote isolated helper or synthetic browser results to those gates.
