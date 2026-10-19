# Windows stable profile leases and pre-open proof

## Scope and behavior

Actual-PC isolated fixtures reproduced three failures before repair: a stable floor-4 handoff preparation, a real `TextPackStore.Write`, and a real `WindowsBridge` opening all attempted unnecessary exclusive profile preparation under an independent shared reader. This is platform parity evidence, not an installed Windows failure or physical acceptance result.

Already version-2 ownership now takes the existing shared verification path during no-op generic preparation. Already floor-4 handoff preparation verifies and returns before exclusive prerequisite migrations. Initial migration and actual floor changes retain exclusive locking and retained-profile checks.

Only native CreateFile sharing/lock errors 32/33 become the internal lease-busy subtype and the public typed preparation refusal. Other I/O errors remain ordinary failures. Requested handoff version 1 can emit `handoff_not_open` only from that synchronous preparation catch before `editing.OpenAsync`, after cancellation, private-state/existing-principal, and tracked editor-owner checks. Account mismatch, unknown I/O, cancellation, existing sessions and post-open errors are not certified. WPF preserves this exact code explicitly.

Required item/path/hash strings are read before ownership/profile preparation. Successful recovery removes its tracked editor token only after the actual recovery finishes. Tests cover malformed inputs without profile publication, real migration contention, successful retry, stable opening, duplicate-editor refusal, recovery followed by certified preparation refusal, and changed retained principal under an exclusive lock. The fixture retries only exact certified pre-open refusals, at most 50 attempts separated by 20 ms; unknown failures fail immediately.

## Final checks

| Gate | Result |
| --- | --- |
| Actual PC full Core | 1106 assertions passed |
| Actual PC bridge | 114 assertions passed |
| Actual PC WPF compile | Exit 0 |
| Actual PC verifier and native wire tests | 14 passed, no skips |
| Mac portable full Core | 978 assertions passed |
| Mac portable bridge | 64 assertions passed |
| Mac native wire tests | Passed |

Final PC source snapshot and raw logs: `/private/tmp/texttext-pc-profile-busy-principal-final-t8vh0yci` (same basename under the PC temporary directory). Base commit `51c6925f28eedcab2a1e5ce469f5602d879f91e4` plus the exact `input.json` overlay hashes; all overlay files still matched after the gates. This is a diagnostic snapshot, not a sealed delivery candidate.

Final Mac logs: `/private/tmp/texttext-windows-profile-principal-mac-final-66mwv3jg`. The earlier external-artifacts Mac attempt refused the test host's checkout lookup before running the suite; the final invocation used isolated ignored artifacts beneath the checkout. It was an invocation failure, not a product regression.

Original RED evidence remains in `/private/tmp/texttext-pc-profile-busy-red-lue6dyrb` and `/private/tmp/texttext-pc-profile-write-bridge-red-p9ihwtdu`. The latter diagnostic deliberately continued both failed children to collect both errors; its canned final status is not a passing receipt. Intermediate failures also preserve the deliberately stalled transport fixture, the obsolete no-op migration exclusion assertion, and genuine certified migration contention before the fixture's bounded retry was added.

The new wire test is registered in `windows/scripts/build.ps1`, the manual native sync gate, and the sync input fingerprint. Diff checks passed. Owner Package.resolved remained SHA-256 `eea669ec76b68673014c10c95b90e721c14d67c99de5756f5c8071c968306edb`.

## Owner preservation

Bounded Security audit: 2026-10-19 01:15:23–01:25:53 UTC, zero matching Shokunin 4625/4740 events. Existing WebView workaround remained present; installed owner PID 40636 remained responding in session 1 with unchanged boot time. Audit receipts: `/private/tmp/texttext-pc-profile-busy-verified-p6v20r0y/security-{start,end}.json`.

No installed app, owner workspace/profile, account, credentials, SSH configuration, or runtime policy changed. No installation, owner app closure, public release, or six-client acceptance is claimed. Fresh normal/private candidates must use the eventual coherent frozen commit.
