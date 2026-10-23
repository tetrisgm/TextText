# Windows startup: reuse unchanged decoded registry records

One sampled launch of installed `24104475` (PID 57748, process start 2026-10-23T18:52:42.841Z) found five consecutive samples in bridge construction → `SyncEngine.Load` → full replacement-registry validation, followed by a first-listing sample in `IndexedPaths` reading the same registry again. The registry contained 387 records. Evidence: `%TEMP%/texttext-startup-stack-efd7b1713ec845af823a9bda852bfb79`, including timestamped samples. Sampling perturbed execution; these are causal stack observations, not performance acceptance timings.

The identity index now reuses a previously decoded record only after its current file fingerprint matches. Directory-generation before/after checks and all selected-record owner, scope, path and recovery validation remain. No recovery data is removed, no full startup validation is skipped, and portable behavior remains uncached. The existing test observation callback counts actual record-byte reads; no persistent telemetry was added.

Focused regression: cold full validation reads and validates all 24 records; first selected lookup performs zero redundant record-byte reads but still validates the selected record. Changing a retained record forces reread and rejects invalid scope while preserving the evidence. Baseline failed the zero-redundant-read assertion; corrected five assertions passed (`%TEMP%/texttext-registry-index-red.log`, `texttext-registry-index-green.log`).

Required PC checks: elevated OpenSSH full Core suite, 1,825 PASS / 0 FAIL, exit 0 (`%TEMP%/texttext-registry-core-full.log`); WPF Release compile exit 0, zero errors, existing NU1510 warning (`%TEMP%/texttext-registry-wpf-build.log`). Independent safety review found no blocker. Coordinator owns the Mac portable check after source synchronization.

Not yet released. No additional installed launch was run after this change. The three-second listing/editable targets remain unproven.
