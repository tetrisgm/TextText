# Native stable account identity, October 17

T07 source work. Existing installed artifacts remain unchanged.

Native linked credentials now support an optional stable account ID. A new Windows or Mac link discovers the authenticated actor through `/api/vault`, with the existing home-workspace account profile endpoint as the older-server fallback. IDs are validated without token hashing. An unchanged credential can use its verified cache offline. Legacy credential records still decode without inventing an identity.

Windows upgrades an existing credential before opening its workspace and checks cancellation/credential replacement before saving. Discovery failure offers a reconnect/retry action and preserves saved work. Mac upgrades an existing credential during a successful metadata refresh; it serializes cache compare-and-save with sign-in/sign-out in the current app process. Late responses cannot overwrite a replacement credential or undo sign-out. Link cancellation is checked under the link generation lock before credential persistence. Workspace cache writes from those responses also compare the captured credential.

## Checks

- Mac identity, credential compatibility, late-response/sign-out, link URL and checkpoint suites passed: 24 app tests plus 49 File Provider kit tests (one separately covered no-space environment skip), zero failures. `/private/tmp/texttext-t07-mac-identity-cache-final.log`.
- Windows exact WPF build passed on the PC: `C:\Users\Shokunin\dev\texttext-t07-identity-build-final2.log`. The first build caught a missing HttpClient import, fixed before the passing run. Existing NU1510 package-pruning warning remains.
- PC Windows startup suite passed including legacy credential decoding, stable identity round trip, direct/fallback authenticated discovery, offline cache, cancellation, malformed identity, bad origin, trailing newline and authorization refusal: `C:\Users\Shokunin\dev\texttext-t07-identity-startup-final.log`.
- Portable Windows core passed after strict end-of-string identity validation: `/private/tmp/texttext-t07-native-account-strict.log`.

## Limits

These caches do not yet activate account IDs in production collaboration transports. Native root/outbox ownership, legacy adoption, physical switching and mixed-version recovery remain open. The Mac compare-and-save lock is process-local; cross-process lifecycle work belongs to T09. Do not report T07 complete from this unit.
