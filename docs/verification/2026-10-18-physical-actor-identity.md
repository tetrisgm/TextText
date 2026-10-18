# Physical actor identity preparation, 2026-10-18

Status: runner/source preparation. No physical six-client acceptance is claimed.

## Contract

Real coordinator configuration requires six expected identity pins. Initial
attestation and native restart validate role, machine, fixture, actual runtime,
fixed artifact hashes, source receipt and principal scope. Restart requires the
relay's fresh generation/session and the first observation must use that session.
Only allowlisted normalized identity fields enter summaries. Browser deployment
identity comes from uncached `/api/app/build`, actual browser version and loaded
same-origin script response digests; a trusted deployment pin maps it to source.
No new Next API was added. CLI actors report workspace owner binding scope,
not authenticated account identity, plus initial pack/body/document/asset hashes.
Independent reopen requires a prior successful physical receipt with matching
fixture, pins, assets and durable semantic hash.

Mac actor uses the product verified-credential controller factory. Its principal
comes from the captured window account, checked against current same-account
credentials and canonical root before actor work, including input chunks.
Windows checks the captured account, workspace and root against the actual
window. Same-account token refresh is permitted. Both hash actual loaded native
artifacts and UI files rather than receipt-selected alternate paths.

The human-invoked private wrapper builds fresh archived committed source and
records source bytes, executable modes, symlinks, allowed generated inputs,
fixed ordered build steps and actual output hashes. Sealing rechecks all of
these and uses create-only JSON outside signed bundles. This is trusted local
build provenance, not cryptographic build attestation. Store actor sidecars
must explicitly live in an existing sandbox-readable app-group/session parent;
see `sync/stress/README.md`. No wrapper build, install or deployment was run.

## Evidence

- Identity/source/sealer unit tests: 15 passed, zero failures;
  `/private/tmp/texttext-identity-sealer-final-20261018.log`.
- Full current stress JavaScript suite: 87 passed, zero failures, 34.00 seconds;
  `/private/tmp/texttext-identity-stress-all-20261018.log`.
- Strict coordinator cases cover absent real pins, dropped unknown fields,
  absent observed identity and full restart identity/session rejection;
  `/private/tmp/texttext-identity-strict-coordinator-20261018.log`.
- Actual Windows LiveAcceptance-only compile: passed in 2.14 seconds, zero
  errors and one existing NU1510 warning;
  `/private/tmp/texttext-identity-pc-compile-20261018.log`.
  Core/MainWindow referenced DLL hashes were identical before and after.
  Actor source SHA256:
  `2aa748e97884357ed99c5cd4f0b73024bda799387d98454b6eb77f92f44c5eb1`.
  Actor DLL SHA256:
  `05b31d0ad6892acf0edf97b8b8c9ccc0e5d93a60a52b88f79c3101864932a9a9`.
- Mac verified controller factory/accessor compiled in root combined stress-flag
  gate 93336 (app 50, FileProvider 194, CLI 40). Final relay generation metadata also compiled in the passing stress-flag
  gate `/private/tmp/texttext-removal-bound-ack-native-20261018.log` (app 50,
  FileProvider 198, CLI 40; 10 explicit opt-in skips).

Remaining: create coherent private candidates and pins
before any physical campaign. Existing compile/test evidence does not prove
runtime account attestation, authenticated browser session, or six-client sync.
