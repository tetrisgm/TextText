# Manual verification coverage and private actor inputs

October 18, 2026. Source/test integration; no new installed candidate or physical campaign.

The manual core/client verifier now discovers every `sync/stress/*.test.mjs` file rather than selecting only three runner files. Discovery fails when the suite is absent; execution uses concurrency two. This includes identity/source sealing, close lifecycle, malformed repair, file bursts, keyboard history and private-build regressions. Actual browser fixtures for journal compatibility, folder recovery, backlinks and folder/grid invalidation also run before issuing a source receipt. Windows bridge regression sources now invalidate that receipt.

The existing native command selects and checks execution of folder helper and real WK bridge suites. It also runs portable Windows bridge tests after the existing portable Core suite. Actual Windows-only handle/bridge cases remain a separate PC gate, with explicit skips on the Mac.

Private Mac actor builds preserve exact tracked Package.resolved bytes around the additional actor compilation and bin-path query, including failure. The ordinary signed Store build already preserves those bytes, but its wrapper does not cover the later direct Swift actor invocation. This prevents SwiftPM Store-only dependency resolution from invalidating pristine-source attestation. No dependency versions, signed capabilities, account material, installation or public release changed.

## Checks

- All 17 runner test files: 152 tests passed in 60.348 seconds, `/private/tmp/texttext-runner-all-protocols-20261018.log`.
- Private actor resolution and artifact-source fixtures: nine passed, `/private/tmp/texttext-private-actor-resolution-20261018.log`. Exact bytes are restored on success and thrown failure; the original failure propagates.
- Gate/source-fingerprint fixtures: eight passed, `/private/tmp/texttext-folder-backlinks-gate-tests-20261018.log`.
- `bash -n scripts/test-sync.sh` passed.
- Existing current native gates passed the selected folder/bridge suites; Windows portable Core946/bridge58 and actual-PC Core995/bridge81 pass in the [Windows receipt](2026-10-18-windows-folder-case.md). Mac final folder/Core/CLI/WK counts are in the [Mac receipt](2026-10-18-folder-case-reconciliation.md).

No whole-source gate receipt is issued while other workers continue editing. The next complete verification must use a frozen source fingerprint. A real newly built private actor and complete physical acceptance remain pending.
