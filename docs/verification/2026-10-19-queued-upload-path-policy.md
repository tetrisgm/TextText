# Queued-upload path policy and wrappers

Pure policy and host/wrapper integration only. Native queued-upload adoption still needs adapter integration; this receipt does not claim the observed native Mac discrepancy is fixed. No installed app, account, live workspace or deployment changed.

## Observed native discrepancy

On frozen `ea5e84fb`, a controlled transport first creates a real staged upload. Native deletion records an intent, then an ordinary external write restores the exact same-ID pack. The server reports a path-only move with unchanged revision and lifecycle. Mac replaces the queued operation ID and moves the projection despite the retained deletion intent; Windows preserves the original command, intent and projection.

Mac diagnostic: one test with two immutable-fact assertion failures and one missing-original-path read assertion. Pending hash, base revision and lifecycle remain unchanged; the deletion-intent hash remains unchanged and the destination exists. This is not a data-loss claim or a complete historical-byte inventory. Windows control: five passing assertions.

Evidence manifest: `/private/tmp/texttext-queued-path-native-red-source-20261019.json`, SHA-256 `9f18c51e28e7e6c0aa34fd91bbc3f4221cb1ac57f8ae5d05c77b1846a493603c`. Earlier harness setup/compile refusals are separate from this behavioral evidence.

## Approved contract

The strict 24-field observation returns `defer`, `keep`, or `reissue-at-remote-path`. All three pending/baseline/remote lifecycle values must be known and equal; the base, baseline and remote revision must match. Unknown generations conservatively preserve the original command. The remote observation must be authoritative. Captured staged payload verification means actual hash-valid bytes with the same item identity.

Reissue requires a unique verified projection at an exact declared endpoint and either no intent or an exact already-materialized rename intent. Deletion, unknown or mismatched intents defer. Paths are never case-folded or normalized. `keep` and `defer` do not authorize clearing pending commands, intents or baselines, or sending bytes.

Native owners retain responsibility for current account/root/lease/permission proofs, post-await revalidation, a new operation ID, durable original payload retention and filesystem/state publication. Those primitives are not implemented by the policy or wrappers.

Host API: `queuedUploadPath`; Swift: `LocalVaultMirrorQueuedUploadPathObservation` and `queuedUploadPath(_:)`; C#: `MirrorQueuedUploadPathObservation` and `QueuedUploadPathAsync`. Existing saved-rename API and its 23 fields remain unchanged. Replies require exact fields/observation/scope/request/page/generation/action, followed by a current-page handshake.

## Verified source gates

- Pure policy: 38 serialized vectors plus three strict-schema/generation/detachment tests.
- Combined host/pure unit gate: 52 tests pass.
- Packaged Chromium policy host: pass, including offline vectors and reload fences.
- Native Swift policy wrappers: five tests pass, three queued-upload and two existing saved-rename tests. All 38 queued vectors run through the actual source host; forged replies and post-decision reload refuse.
- Actual WKWebView packaged host: three tests pass using the fresh bundle containing queued-upload vectors. It ran `--skip-build` against the binaries just compiled above; no diagnostic RED class was selected.
- TypeScript: `tsc --noEmit --incremental false` exits zero.
- Actual PC: full Core compilation succeeds; the dedicated wrapper harness runs 226 assertions, including all 38 queued vectors and unchanged saved-rename/regression checks. This is not a full Core runtime-suite claim.

Fresh actual-PC evidence: `/private/tmp/texttext-queued-wrapper-pc-20261019-ms_3rsdg/result.json`. Its 3216-file source proof is identical before/after and records compiled Core/test/host hashes. The private Program branch exists only in the diagnostic archive; repository Program was not edited.

## Unicode test-helper correction

The first PC wrapper run correctly refused a mismatched Unicode echo. A private diagnostic confirmed `NativePolicyTestHost` decoded Node stdout as code page 437: U+00E9 became U+251C/U+2310, and U+0301 became U+2560/U+00FC. The helper now explicitly uses strict UTF-8 without a BOM for redirected stdin/stdout. No normalization or relaxed equality was added. The original refusal and sanitized scalar diagnostic remain under `/private/tmp/texttext-queued-wrapper-pc-20261019-bfxkpjtt/`.

Mac gate logs use `/private/tmp/texttext-queued-wrapper-*20261019*`. Exact owner `Package.resolved` bytes were restored after Swift gates, SHA-256 `eea669ec76b68673014c10c95b90e721c14d67c99de5756f5c8071c968306edb`. Isolated native diagnostics are not registered as passing main-source tests before their adapter fixes.
