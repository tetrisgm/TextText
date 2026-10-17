# Account-aware native factories, October 17

T07 source activation; not installed or deployed. Legacy adoption must be completed before delivery.

## Wiring

Mac windows now obtain the origin, token and cached account ID from one credential record. Connection and collaboration actors use that provider. Stable, deterministic WKWebView profiles separate account/origin storage; an account change fences native input and retains the original realm. Cached UI permissions are also account-scoped. An existing legacy window keeps unbound journals for its exact original credential lifetime: merely hydrating an account cache does not relabel accepted work. A new window uses the verified profile. Unknown legacy state remains protected for explicit recovery/adoption.

Existing credentials with a warm workspace cache now still trigger stable identity discovery. Account and workspace response caches compare the captured credential before writing. No older native storage/profile is reset or removed.

Windows captures the account when a workspace opens, passes it through WorkspaceContext to sync and checkpoint stores, and exposes it to the shared transport configuration. Its WebView2 profile includes the account. The renderer relay uses the captured credential and expected-account header, rejects a conflicting renderer header, and refuses a different current account. Cached same-account renewal is distinguished from an unverified replacement token.

## Verification

- Required native gate passed: 37 Mac app tests, 101 File Provider kit tests (one separately covered no-space skip), 40 agent tests and portable Windows core. `/private/tmp/texttext-t07-factory-final-native-gate.log`.
- Additional Mac credential/location tests passed with the factory and capability tests: 52 focused tests before the final legacy-window lifetime regression; the latter passes in the required gate. `/private/tmp/texttext-t07-factory-capabilities-mac.log`.
- Exact-source PC WPF build passed, zero errors, existing NU1510 warning: `C:\Users\Shokunin\dev\texttext-t07-factory-build.log`. PC startup/identity/bridge tests passed: `C:\Users\Shokunin\dev\texttext-t07-factory-startup.log`.
- Focused Windows transport 17 tests; complete client gate 420 tests; TypeScript passed. `/private/tmp/texttext-t07-factory-client.log`, `/private/tmp/texttext-t07-factory-client-gate.log`, `/private/tmp/texttext-t07-factory-tsc.log`.
- Mac profile API verified against the installed SDK's WKWebsiteDataStore header (available since macOS14, the project minimum). Account/profile stability, different-account separation and invalid identity tests pass.

## Remaining dependency

New verified native actors deliberately refuse unbound persisted queues/checkpoints. Provide explicit legacy recovery/adoption and interrupted-upgrade fixtures before installing these factories. Account profile separation also preserves old generic browser drafts in their original profile; recovery must account for those bytes. Root identity markers, a complete persisted-format inventory and physical same-profile/account switches remain open. T07 is not complete from source tests alone. Bring this T17 prerequisite forward before T08 activation/final delivery; do not weaken the refusal to make legacy opening appear successful.
