# Private actor read-proof gate registration

The standalone Windows TextText.LiveAcceptance.Tests project is now required by the ordinary Windows build, immediately after bridge tests. A nonzero exit refuses the candidate. The manual native sync verifier runs the same project on the Mac and requires its positive portable-test marker, so a zero-test or wrong-project invocation cannot count. Its fingerprint now includes both the test project and windows/scripts/build.ps1. Generated bin/obj output remains excluded.

This helper project only checks actor validation and read-only evidence. It does not launch the private actor, installed app or acceptance campaign. Existing interactive disposable desktop smoke remains required by the ordinary build. No new candidate was built or installed for this wiring change.

## Checks

- Verifier unit suite: 9 pass, including test-source fingerprint invalidation and structural required-call/smoke/no-actor-launch checks.
- Manual shell syntax and actual Windows PowerShell parser: pass.
- Exact newly registered actual Windows command: 15 private actor checks pass. On the Mac, the same command passes six portable checks and refuses filesystem evidence without Windows native identity.
- Source/diff checks: pass. Source hashes: /private/tmp/texttext-private-actor-gate-wiring-source-20261018.json. Logs: /private/tmp/texttext-private-actor-gate-wiring-node-20261018.log and texttext-private-actor-gate-wiring-mac-20261018.log; actual PC tests-gate-registration.stdout.log is retained in /private/tmp/texttext-pc-leaf-overlay-4_7_7nmt.

The committed private Mac actor entry is sync/stress/build-private-actor.mjs, which compiles TextTextApp with -DTEXTTEXT_STRESS_ACTOR. The future private candidate pipeline was separately prepared by its owner to run NativeStressLeafMoveTests, NativeStressFolderCaseTests and NativeStressWindowLifecycleTests with that flag and require a passing case in each suite. No Mac actor source or wrapper was modified by this gate registration.
