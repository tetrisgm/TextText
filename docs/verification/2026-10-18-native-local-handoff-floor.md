# Native local handoff compatibility floor

## Scope and wire

Native configuration may advertise `localHandoff: {version: 1, profileVersion: 4}`
only for an owned private device state. Advertisement does not publish a floor.
An explicit `collaborationOpen.localHandoffVersion: 1` publishes and verifies floor
4 before acquiring the native editing lease; the reply includes the same proof.
Absent requests retain ordinary open behavior. Boolean, future, string versions
and unknown open fields refuse. Windows advertises implementation support through
`native.status.localHandoffVersion: 1`, then verifies actual private ownership in
`collaboration.localHandoffConfig` with empty parameters.

The migration retains exact prior profile-v3 bytes and actual displaced profile
history, preserving owner, principal and pending work. Existing folder operations
accept floor 4 without downgrading it. Future floor 5 refuses. Mac configuration
must be present and outside the workspace/cloud folders; an unconfigured fallback
at root/.texttext cannot enable handoff. Windows state must be outside the vault.
The bridges check their captured account before preparing the floor.

This floor protects supported earlier readers using the **same private state**.
Mac app and local CLI normally use separate bases; other devices, raw filesystem
writers, historical binaries that ignore profiles, and already running processes
are not fenced by this marker. TextPack schema remains v1. No shared workspace
floor, accounts, auth configuration, installed app, or live owner state changed.
The TS draft codec and editor transfer behavior are verified separately.

## Mac evidence

Final actual invocation selected LocalHandoffProfileTests, LocalHandoffBridgeTests,
LocalVaultCollaborationTests and FolderPropagationProfileTests with
`TEXTTEXT_STORE=1` and `-DTEXTTEXT_STRESS_ACTOR`.

- **33 tests passed, zero failures, zero skips.**
- Actual relay configuration leaves v3 unchanged; ordinary unrequested open leaves
  v3 unchanged. Invalid versions/fields refuse. Requested open publishes floor 4
  before a deliberately stale hash fails native opening, and a later valid open
  returns the handoff proof without duplicating the editing lease.
- A real `LocalVaultSharedEditingStore.materialize` pending checkpoint survives
  upgrade and fresh-store reopening with exact journal, projection and generation.
- Same vault with two private device bases upgrades only one base. No root/.texttext
  profile is published. Interrupted publication resumes with exact retained v3;
  future profiles refuse.
- Actual previous F2 release CLI artifact (source
  `55890b9cc8dbb672360c706455953a165b6258b6`, SHA-256
  `60ae57f1ac231bf855a881599878e9814e405a1b3c74118548ed12687a054abd`)
  writes successfully to an independently fresh v3 control. Its first write to
  a separate identically provisioned, production-upgraded v4 fixture refuses
  with the exact stderr line `texttext: invalidProfile`. All upgraded fixture
  files, including profile, projection and retained checkpoint fixture, remain
  byte-identical. The serialized checkpoint fixture in this old-CLI case is not
  itself an acknowledged checkpoint; the separate materialization case above is.
- Both CLI processes run under OS sandbox rules denying network and owner-home
  reads, with explicit disposable TEXTTEXT_WORKSPACE_ROOT/TEXTTEXT_STATE_DIR.
  Neither HOME nor CODEX_HOME is changed. The actual installed shim is untouched.
- The opt-in previous-CLI case explicitly skips if the pinned artifact is absent;
  such an invocation is not this compatibility proof.

The first same-root CLI control produced a legacy retention guard that obscured
format rejection. The independent-root correction removed no guards. A later
strict assertion still failed because it expected localized UI text: exact F2
main.swift prints `String(describing: error)`, producing `invalidProfile` instead.
The final assertion uses only that exact source-backed line, never generic failure.
All earlier red logs remain preserved.

Final log: `/private/tmp/texttext-local-handoff-old-cli-native-exact-error-20261018.log`.
Earlier logs share the prefix `/private/tmp/texttext-local-handoff-` and include
`old-cli-native-first`, `old-cli-native-clean`, `old-cli-native-independent`,
`bridge-native-first`, `bridge-native-second`, and `profile-native-pending`.
Every Swift invocation restored original Package.resolved bytes in finally:
`eea669ec76b68673014c10c95b90e721c14d67c99de5756f5c8071c968306edb`.

## Actual Windows evidence

Fresh disposable committed-base source plus seven named hash-pinned native
overlays; this is a diagnostic source gate, not a sealed delivery candidate.

- Focused profile checks: **15 passed**.
- Full native Core regression suite: **1,104 passed**, exit 0.
- Full Windows bridge checks: **106 passed**, exit 0.
- Actual WPF product compilation: exit 0, covering the native.status marker.

Evidence (copied to the Mac):
`/private/tmp/texttext-local-handoff-pc-final-ptkm2s4w/` contains input.json,
result.json, core.stdout.log, bridge.stdout.log, full-core-result.json,
full-core.stdout.log, wpf-result.json and wpf.stdout.log.
Earlier compile/test-harness errors remain in separate pbfp3jnc and retry-lyb9uv8p
folders. No app was installed or launched and owner process 40636 was untouched.

Final source/hash inventory:
`/private/tmp/texttext-local-handoff-native-final-source-20261018.json`.
