# Captured native credential lifetime, October 17

T07 source fixes. Existing installed artifacts remain unchanged.

The Mac collaboration relay previously retried an old 401 request with a replacement token whenever the workspace binding matched. Renewal now requires the same verified stable account ID. A changed or unknown account cannot send the retry. A successful old response also cannot complete into a replacement account. Local checkpoint leases capture their credential identity; replacement credentials cannot checkpoint/recover through the old lease or supply a retirement reason when releasing it.

The Mac connection controller can capture verified credentials atomically. It preserves an actor for verified same-account renewal, but stops its workers and clears inherited capabilities when the account changes. Returning to the original account can reopen its retained state. Its HTTP transport pins the account header and rejects a retoken operation with another account identity.

Windows HTTP sync supports an immutable expected account plus an atomic verified credential provider. Both initial calls and retries refuse a provider for another account. Legacy token-only transports pin their first token rather than treating an arbitrary replacement as a verified renewal. No response body or credential is placed in error messages.

## Verification

- Focused Mac relay/connection/window lifecycle tests: 34 passed. `/private/tmp/texttext-t07-captured-native-connection.log`.
- Full required native gate passed, including 34 app tests, 101 File Provider kit tests (one separately covered no-space skip), 40 agent tests and portable Windows core: `/private/tmp/texttext-t07-captured-account-final-gate.log`.
- Exact-source Windows core passed on the PC: `C:\Users\Shokunin\dev\texttext-t07-captured-account-core.log`.
- Regressions assert one HTTP request on account replacement, two on verified same-account renewal, unchanged local bytes, rejected old-lease writes, no foreign retirement, retained queue identity and cleared foreign capabilities.
- Initial Mac relay compilation failed due to a misplaced new configuration argument; corrected before these passing runs. `/private/tmp/texttext-t07-captured-native-relay.log` preserves that failure.

## Activation limits

The native window factories still supply the legacy credential adapter. Verified account propagation through those factories, root ownership, explicit legacy adoption and actual installed switches remain open. A legacy token change now fails closed; stable-account renewal requires the verified provider. Complete upgrade/recovery handling before final native delivery. No T07 completion claim is made.
