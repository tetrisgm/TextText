# Production Mac close and quit (T07)

The production LocalVaultWindowController had no `windowShouldClose` handler, and AppDelegate had no `applicationShouldTerminate` durability handler. Sign-out used the typed renderer flush, while the private stress actor explicitly called that guard before exit. A previously passing actor shutdown did not prove production Command-W or Command-Q waited for pending persistence.

## Reproduction and fix

A real, isolated WKWebView in the production window controller returned a deliberately delayed typed save receipt. `performClose` released the window before requesting that receipt. The new integration test failed with `Production close released the window before its durable renderer reply`; log `/private/tmp/texttext-t07-mac-close-before.log`.

Production window close now waits for the existing renderer durability contract before hiding the window. It resigns editor keyboard focus and ignores pointer input until the close completes or fails, so text cannot slip in after the captured barrier. Window/session retention on reopen remains intact. A rejected/expired save restores input and presents the Keep editing sheet.

Application quit now returns AppKit's deferred termination result, flushes the local window, and replies only after the bounded save decision. A successful quit keeps input fenced until process termination; failure restores input and leaves the app open. A loading page must supply an explicit idle/durable result; missing readiness no longer implies save success.

NativeSaveBarrier coalesces concurrent requests, times out after eight seconds, and rejects late receipts after timeout/cancellation or a newer retry. It does not cancel or erase accepted disk intent. The helper is a native window adapter; Yjs, journals and merge policy remain in the shared engine.

## Verification

- The previously failing real WKWebView/production-window close test passes, including keyboard/pointer input fencing while the reply is held.
- Three deterministic scheduler tests cover shared requests, failed/cancelled saves, timeout, late replies and independent retry.
- Existing native typed-receipt and session tests pass.
- Full `swift test --package-path <isolated-source>/mac --scratch-path <existing-build-cache> --jobs 2` passed on the Mac. Source was commit `4102b6a2` plus the named native changes; unrelated dirty checkout files were excluded. Log `/private/tmp/texttext-t07-mac-final.log`. Empty supplementary Swift Testing bundles are not counted as tests.

These native changes are source-only until a new local app candidate is built, installed and checked. Mac build 1261 does not contain them. Multiple-window/account transitions, broader coordinator ownership and current-source six-client acceptance remain open.
