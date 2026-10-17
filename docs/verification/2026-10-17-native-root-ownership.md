# Native root ownership and legacy realm fence, October 17

T07/T17 source work, not installed. No existing user state was adopted.

Both native factories now maintain a device-private version1 root/account ownership marker. The marker binds origin, workspace, stable actor and canonical root digest. It survives an absent sync state. A verified existing sync state can attest the same owner; unbound nonempty folders require explicit review rather than ownership assignment. Unknown marker versions, foreign accounts and an active adoption intent fail closed without rewriting retained records. Markers are not stored in portable workspace identity.

A pending adoption also blocks ordinary sync and checkpoint paths in current source. The manual native gate now requires the account identity and root ownership suites; a zero-test filter cannot satisfy them.

The Mac relay is explicitly bound to its window's captured credential lifetime. An unknown replacement token cannot open a new session in the original legacy realm after the prior session closes. Local release remains safe and cannot add a foreign retirement reason. Late configuration completion is fenced as well as HTTP completion.

## Verification

- Full required native gate passed: 37 Mac app tests, 107 File Provider kit tests (one separately covered no-space skip), 40 agent tests and portable Windows core. `/private/tmp/texttext-t17-root-final-native-gate.log`.
- Separate Mac root/connection tests passed: `/private/tmp/texttext-t17-mac-root-ownership.log`.
- Windows root tests passed on Mac and PC. Production WindowsBridge refusal is exercised before a foreign worker/listing/upload can start, preserving the exact original marker. PC logs: `C:\Users\Shokunin\dev\texttext-t17-root-core.log` and `C:\Users\Shokunin\dev\texttext-t17-root-bridge.log`.
- Root cases cover same owner, missing cursor, foreign workspace/account, unbound nonempty contents, interrupted adoption and future marker version. Ordinary source files/projections are not rewritten by these checks.

## Next dependency

Implement the [explicit adoption transaction](account-adoption-transaction.md), recovery UI, old browser-profile handling and interrupted migration/compatibility fixtures. The current refusal is preservation, not a successful upgrade. Cross-process exclusion and background native callers still require T09/T11/T17 evidence. No installed or physical account-switch completion claim is made.
