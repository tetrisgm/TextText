# Shared browser and native document ownership

Packet C / T08 and application shutdown in T07. October 17, 2026. Source verification; no new installed-build acceptance claim.

## Invariant and implementation

`src/local-vault/document-session.ts` owns the collaboration client, native lease/checkpoints, projection reconciliation, file-change subscription, awareness and presence. Browser, WKWebView and WebView2 editors acquire the same page-level contract. Keys include origin, account, workspace and item, plus the native root. React no longer creates/destroys these clients or directly closes their leases.

Last release pauses activity and awaits persistence before releasing the native lease. Reacquisition invalidates the prior drain. Cancelled opens finish acquiring before releasing. Failed storage retains the exact document and lease. File mutations require an exclusive handle and fence editor input. Recovery releases ownership only after the native adapter validates the separate saved copy and journal retirement completes. Epoch adoption rebinds attached views and replaces owner-held awareness.

Application close/sign-out flush owners whose views have already left. A failed hidden draft returns `ok: false`, `idle: false` and pending durability even on home. Concurrent file mutations or newly acquired owners invalidate the captured flush. Previously, flushing only the visible editor could miss a hidden failed draft.

## Verification

- `node sync/verify.mjs --client-only`: 439 tests and TypeScript passed. Includes 16 owner tests for two views, cancelled open, delayed/failed persistence, reacquisition, reset/mutation, hidden-owner flush and acquisition races.
- `node src/local-vault/__tests__/session-owner.browser.mjs`: actual IndexedDB delay/rejection, recovery, account separation and two handles pass.
- `node src/local-vault/__tests__/native-session-owner.browser.mjs`: controlled native adapter passes delayed checkpoint, cancelled open, retained failure, rejected/accepted recovery copy and hidden-owner flush.
- `node src/local-vault/__tests__/session-views.browser.mjs` and `--native`: actual React views share one open/presence join; unmount preserves the remaining editor; offline last-release/reopen preserves exact text. Native mode also mounts production `VaultApp` home and checks both global shutdown/sign-out hooks against a hidden failed draft, then explicit recovery.
- `node --import tsx src/local-vault/__tests__/epoch-adoption.browser.mjs`: real file-relay adoption passes focus/caret/undo continuity, awareness replacement, late input, lost recovery acknowledgement and failed checkpoint retention.
- Full `bash scripts/test-sync.sh --native-only` with legacy/owner fixture bundles: 42 Mac app, 116 Kit (three existing helper/manual skips), 40 agent tests and Windows Core passed. Log `/private/tmp/texttext-t08-complete-native.log`.
- Actual WKWebView `LocalVaultSessionLifecycleTests/testSharedOwnerKeepsNativeLeaseUntilWKCheckpointCompletes`: retained lease during held checkpoint, same owner on reacquire, exact text committed before one close. Fixture `/private/tmp/texttext-t08-native-owner-fixture`.
- Actual PC WebView2 `SharedOwnerTests` in full interactive smoke passes equivalent lease/reacquire/text assertions. Receipt `C:\Users\Shokunin\dev\texttext-delivery-65417abd\windows\build\shared-owner-smoke-20261017`. Build: zero errors, existing NU1510 warning. Temporary `TextText-T08-Owner-Smoke` task unregistered.

Local logs: `/private/tmp/texttext-t08-shutdown-{client,native-browser,owner-browser,web-views,native-views}.log`, `/private/tmp/texttext-t08-application-shutdown-recovery.log`, `/private/tmp/texttext-t08-final-{client,epoch,web-views,wk}.log`.

## Failed attempts and limits

The initial WK fixture attempted input before an editable baseline. Explicit fixture readiness/retry and a focused window corrected the harness; production guards were preserved. An initial recovery fixture failed validation because Markdown and document JSON differed; production `writePayload` corrected it. The application test initially expected a failed native checkpoint to resume automatically after storage repair. The native fence correctly refused; the test now uses explicit durable-copy recovery.

These are isolated host fixtures, not newly installed apps. PC staging contains test modifications and is not a pristine candidate. Installed/hosted identities remain those in HANDOFF. Native background policy, physical account transitions, separate-process ownership, the six-client campaign and final delivery remain open. A page singleton is not cross-process exclusion.

Next: T09 competing browser journals, abrupt owner loss/takeover and late replay, then native process fencing and editor continuity.
