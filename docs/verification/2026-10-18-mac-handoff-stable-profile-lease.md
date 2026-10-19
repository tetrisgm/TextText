# Mac handoff on a stable profile lease

## Scope

An isolated real collaboration relay reproduced ordinary profile-lock contention. This does not establish the exact call site of the installed application's earlier failure, and does not establish installed acceptance.

## Reproduction and fix

`LocalHandoffBridgeTests` first negotiates and publishes floor 4 through production APIs, closes its editing session, then holds an independent `LOCK_SH` descriptor on the real profile migration lease. A new production `collaborationOpen` requesting handoff version 1 must return a native session and proof without changing the profile bytes.

Before the fix, the actual relay threw typed `busy`: one test executed, one failure. `prepareLocalHandoff` unnecessarily entered the exclusive prerequisite migration chain even when floor 4 was complete.

The fix checks an existing version-2 owner using the existing retained-profile verification path. A fully verified floor 4 returns without acquiring an exclusive migration lease. Incomplete publication still uses existing exclusive recovery. Earlier floors and initial owner migration retain the original exclusive preparation path. Unknown/future profiles and binding failures remain refusals.

After the fix, the held shared lease permits actual native opening and closing, with unchanged profile bytes. The focused existing suites also cover pending materialization, interrupted upgrades, private-state isolation, future-format refusal, and actual prior CLI refusal.

## Verification

- RED: `/private/tmp/texttext-handoff-shared-lease-red-20261018.log`, exit 1, caught `busy`.
- Final GREEN: `/private/tmp/texttext-handoff-shared-lease-final-20261018.log`, exit 0, 33 tests, zero failures or skips. The prior CLI opt-in used the previously pinned F2 executable.
- Filter: `LocalHandoffBridgeTests|LocalHandoffProfileTests|FolderPropagationProfileTests|LocalVaultCollaborationTests`, with `TEXTTEXT_STORE=1` and `-DTEXTTEXT_STRESS_ACTOR`.
- Owner `mac/Package.resolved` restored byte-for-byte: SHA-256 `eea669ec76b68673014c10c95b90e721c14d67c99de5756f5c8071c968306edb`.

No installed application, owner workspace, account, or live profile was changed. No build/install or physical acceptance is claimed.
